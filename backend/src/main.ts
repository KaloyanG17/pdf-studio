import { createApp } from './setup';

/** Local development server. On Vercel the same app runs as a function (see serverless.ts). */
async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`PDF Studio API listening on http://localhost:${port}/api`);
}
bootstrap();
