// Applies supabase/migrations/*.sql to the database in POSTGRES_URL_NON_POOLING.
// Reads .env.local (written by `vercel env pull`) when the variable isn't already set.
// Every migration is idempotent, so running this again is safe.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (!process.env.POSTGRES_URL_NON_POOLING && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) throw new Error('POSTGRES_URL_NON_POOLING is not set (run `vercel env pull` first)');

const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
await client.connect();
const dir = path.join(root, 'supabase', 'migrations');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await client.query(readFileSync(path.join(dir, file), 'utf8'));
  console.log(`applied ${file}`);
}
await client.end();
