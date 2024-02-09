/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { z } from 'zod';
import { Hono } from 'hono';
import { Ai } from '@cloudflare/ai';
import { stream, streamText, streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import pages, { ResultPage } from './pages';
import { UpdateCount, renderString, systemExtractCount } from './prompts';

type Env = {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	DEMO_KV: KVNamespace;
	AI: Ai;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	DO_COUNTER: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	DEMO_QUEUE: Queue<DeltaMsg>;
};

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	return c.json(err);
});

app
	.route('/', pages)
	.get('/ai', async (c) => {
		const ai = new Ai(c.env.AI);
		const output = await ai.run('@hf/thebloke/openhermes-2.5-mistral-7b-awq', {
			prompt: 'Tell me about Workers AI',
		});
		return c.json(output);
	})
	.get('/total', async (c) => {
		const id = c.env.DO_COUNTER.idFromName('counter');
		const counter = c.env.DO_COUNTER.get(id);
		try {
			const value = await counter.fetch('https://example.com/').then((res) => res.json());
			const total = Total.parse(value);
			return c.json(total);
		} catch (e) {
			console.error(e);
			return c.json({ error: e.message });
		}
	})
	.post(
		'/total/ai',
		zValidator(
			'json',
			z.object({
				username: z.string(),
			})
		),
		async (c) => {
			return streamSSE(c, async (stream) => {
				// const total = MaybeTotal.parse(await c.env.DEMO_KV.get('count', { type: 'json' }));
				const id = c.env.DO_COUNTER.idFromName('counter');
				const counter = c.env.DO_COUNTER.get(id);
				const total = Total.parse(await counter.fetch(new Request('/')).then((res) => res.json()));

				const ai = new Ai(c.env.AI);
				const { username } = c.req.valid('json');

				const output = await ai.run('@hf/thebloke/openhermes-2.5-mistral-7b-awq', {
					stream: true,
					messages: [
						{
							role: 'user',
							content: `# Instruction #\nTell me what the current total is and when it was last updated. Ensure the last update timestamp is provided in a human readable way and the user is greeted by their provided name.\n\n# Input #\nUsername: ${username}\nData: ${JSON.stringify(
								total
							)}`,
						},
					],
				});
				await stream.pipe(output);
			});
		}
	)
	.post(
		'/update-count',
		zValidator(
			'form',
			z.object({
				message: z.string().min(1).max(512),
			})
		),
		async (c) => {
			const { message } = c.req.valid('form');
			const ai = new Ai(c.env.AI);
			const output = await ai.run('@hf/thebloke/openhermes-2.5-mistral-7b-awq', {
				messages: [
					{
						role: 'system',
						content: await renderString(systemExtractCount, {
							outputSchema: UpdateCount.jsonSchema,
						}),
					},
					{
						role: 'user',
						content: message,
					},
				],
			});
			const { delta } = UpdateCount.parse(output.response);

			await sendDeltaMessage(c.env.DEMO_QUEUE, delta);
			return c.html(<ResultPage delta={delta}/>);
		}
	)
	.get('/inc', async (c) => {
		await sendDeltaMessage(c.env.DEMO_QUEUE, 1);
		return c.json({ message: 'OK' });
	})
	.get('/dec', async (c) => {
		await sendDeltaMessage(c.env.DEMO_QUEUE, -1);
		return c.json({ message: 'OK' });
	});

async function sendDeltaMessage(queue: Queue<DeltaMsg>, delta: number) {
	await queue.send({ delta, timestamp: new Date().toISOString() });
}



type DeltaMsg = {
	delta: number;
	timestamp: string;
};

const Total = z.object({
	count: z.number().int(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

const MaybeTotal = Total.optional().default(() => {
	const createdAt = new Date();
	return {
		count: 0,
		createdAt,
		updatedAt: createdAt,
	};
});

type Total = z.infer<typeof Total>;

export class DurableCounter {
	state: DurableObjectState;
	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		if (url.pathname !== '/') {
			return new Response('Not found', { status: 404 });
		}

		let value = await this.state.storage.get('count')
		if (typeof value === 'string') {
			value = JSON.parse(value);
		}
		let total = MaybeTotal.parse(value);

		let delta: number;
		switch (request.method) {
			case 'GET':
				// serves the current value.
				break;
			case 'POST':
				delta = parseInt(url.searchParams.get('delta') || '1');
				total = this.getNewTotal(total, delta);
				await this.state.storage.put('count', total);
				break;
			default:
				return new Response(undefined, { status: 404, statusText: 'Not found' });
		}

		return new Response(JSON.stringify(total), {
			headers: {
				'content-type': 'application/json',
			},
		});
	}

	private getNewTotal(lastTotal: Total | null | undefined, delta: number = 1) {
		let total;
		if (lastTotal) {
			total = {
				count: lastTotal.count + delta,
				createdAt: lastTotal.createdAt,
				updatedAt: new Date(),
			};
		} else {
			const createdAt = new Date();
			total = {
				count: delta,
				createdAt,
				updatedAt: createdAt,
			};
		}
		return total;
	}
}

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<DeltaMsg>, env: Env): Promise<void> {
		let cumdelta = 0;
		for (const message of batch.messages) {
			const payload = message.body;
			cumdelta += payload.delta;
		}

		const id = env.DO_COUNTER.idFromName('counter');
		const counter = env.DO_COUNTER.get(id);
		await counter.fetch(new Request(`https://example.com/?delta=${cumdelta}`, { method: 'POST' }));
	},
};
