import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './setup';

/**
 * Vercel Function entry: the Nest app is created once per instance and reused across
 * requests (Fluid Compute keeps instances warm), then each request goes to its Express router.
 */
let ready: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null;

function instance() {
  return (ready ??= createApp().then(async (app) => {
    await app.init();
    return app.getHttpAdapter().getInstance();
  }));
}

export async function handler(req: IncomingMessage, res: ServerResponse) {
  const express = await instance();
  express(req, res);
}
