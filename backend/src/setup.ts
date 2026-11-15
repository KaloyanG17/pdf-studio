import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/** Builds the Nest app with the settings shared by the local server and the Vercel function. */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true, // Stripe webhooks are verified against the exact bytes received
  });
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useBodyParser('json', { limit: '100mb' });
  return app;
}
