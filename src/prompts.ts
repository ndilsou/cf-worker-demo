import { zodToJsonSchema } from 'zod-to-json-schema';
import { liquid } from 'language-literals';
import { Liquid } from 'liquidjs';
import { z } from 'zod';

const engine = new Liquid();

export function renderString(template: string, context: Record<string, any>) {
	return engine.parseAndRender(template, context);
}

export function schematize<T extends z.ZodTypeAny>(schema: T) {
	return {
		jsonSchema: zodToJsonSchema(schema),
		parse: (input: string | null | undefined): z.infer<typeof schema> => {
			if (!input) {
				throw Error('Invalid input');
			}
			const result = schema.parse(JSON.parse(input));
			return result;
		},
	};
}

export const systemExtractCount = liquid`\
You are a state of the art unstructured data extraction AI that can extract information from a user message.
<schema>
You **MUST** output a json object that conforms to the following schema:
{{ outputSchema | json }}
</schema>

Your response **MUST** be only a json like this example:
{"a":1,"b":"wow"}`;

export const UpdateCount = schematize(
	z.object({
		delta: z.number().int().describe('The integer amount to add or remove to the current count, ex. -10 or 5'),
	})
);
