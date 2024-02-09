import type { FC } from 'hono/jsx';
import { Hono } from 'hono';

const Layout: FC = (props) => {
	return (
		<html>
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<script src="https://cdn.tailwindcss.com"></script>
			</head>
			<body class="bg-sky-950 text-white">{props.children}</body>
		</html>
	);
};

export const ResultPage: FC<{ delta: number }> = ({ delta }) => {
	const s = `I have updated the counter by ${delta}`;
	return (
		<Layout>
			<main class="w-full h-full flex flex-col items-center justify-center">
				<h1 class="text-4xl font-bold text-stone-50">AI Counter</h1>
				<div class="mt-4 rounded border border-stone-50 max-w-2xl flex flex-col w-full p-4 gap-2">{s}</div>
			</main>
		</Layout>
	);
};

const app = new Hono();

app.get('/', async (c) => {
	return c.html(
		<Layout>
			<main class="w-full h-full flex flex-col items-center justify-center">
				<h1 class="text-4xl font-bold text-stone-50">AI Counter</h1>
				<form action="/update-count" method="POST" class="mt-4 rounded border border-stone-50 max-w-2xl flex flex-col w-full p-4 gap-2">
					<textarea
						name="message"
						placeholder="Say by how much to increment or decrement the counter..."
						class="text-black rounded p-2 bg-slate-200"
					/>
					<button type="submit" class="rounded border border-stone-50 p-2 w-fit px-4">
						Count
					</button>
				</form>
			</main>
		</Layout>
	);
});

export default app;
