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
import { zValidator } from '@hono/zod-validator'

type Env = {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	DEMO_KV: KVNamespace;
	AI: Ai;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
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
  return c.json(err)
})

app
	.get('/', (c) => c.text('Hello Cloudflare Workers!'))
	.get('/ai', async (c) => {
		const ai = new Ai(c.env.AI);
		const output = await ai.run('@hf/thebloke/openhermes-2.5-mistral-7b-awq', {
			prompt: 'Tell me about Workers AI',
		});
		return c.json(output);
	})
	.get('/total', async (c) => {
		const total = MaybeTotal.parse(await c.env.DEMO_KV.get('count', { type: 'json'}));
		return c.json(total);
	})
	.post('/total/ai', zValidator(
    'json',
    z.object({
      username: z.string(),
    })
  ),async (c) => {
		return streamSSE(c, async (stream) => {
		const total = MaybeTotal.parse(await c.env.DEMO_KV.get('count', { type: 'json' }));
		const ai = new Ai(c.env.AI);
		const {username} = c.req.valid("json")

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
		// return c.json(output);
			await stream.pipe(output);
		});
	})
	.get('/inc', async (c) => {
		await c.env.DEMO_QUEUE.send({ delta: 1, timestamp: new Date().toISOString() });
		return c.json({ message: 'OK' });
	})
	.get('/dec', async (c) => {
		await c.env.DEMO_QUEUE.send({ delta: -1, timestamp: new Date().toISOString() });
		return c.json({ message: 'OK' });
	});

function getNewTotal(lastTotal: Total | null, delta: number = 1) {
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

type DeltaMsg = {
	delta: number;
	timestamp: string;
};

const Total = z.object({
	count: z.number().int(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

const MaybeTotal = Total.nullable();

type Total = z.infer<typeof Total>;

// const DeltaMsg = z.object({
// 	delta: z.number().int(),
// 	timestamp: z.coerce.date(),
// });

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<DeltaMsg>, env: Env): Promise<void> {
		console.log('received batch');
		for (const message of batch.messages) {
			// const payload = DeltaMsg.parse(message.body);
			const payload = message.body;
			const previousTotal = MaybeTotal.parse(await env.DEMO_KV.get('count', { type: 'json' }));
			console.log('previousTotal', previousTotal);
			let total = getNewTotal(previousTotal, payload.delta);

			await env.DEMO_KV.put('count', JSON.stringify(total));
		}
	},
};
