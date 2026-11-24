import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cadences, flavors, grinds, quote, weights } from './public/catalog.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const databasePath = resolve(process.env.PILOT_DB ?? '.data/drafts.sqlite');
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
database.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    request_key TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
    flavor TEXT NOT NULL, grind TEXT NOT NULL, weight TEXT NOT NULL,
    cadence TEXT NOT NULL, price INTEGER NOT NULL CHECK (price > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT
`);
const insert = database.prepare(`
  INSERT INTO drafts (request_key, reference, flavor, grind, weight, cadence, price)
  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_key) DO NOTHING
`);
const findDraft = database.prepare(`
  SELECT reference, flavor, grind, weight, cadence, price FROM drafts WHERE request_key = ?
`);
const prune = database.prepare("DELETE FROM drafts WHERE created_at < datetime('now', '-7 days')");
prune.run();
const cleanup = setInterval(() => {
  try {
    prune.run();
  } catch (error) {
    console.error('pilot draft cleanup failed', error.code ?? error.name);
  }
}, 60 * 60 * 1000);
cleanup.unref();

const assetTypes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/save-draft.js': ['save-draft.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/catalog.js': ['catalog.js', 'text/javascript; charset=utf-8'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
  '/favicon.ico': ['favicon.ico', 'image/x-icon'],
  '/assets/hero.webp': ['assets/hero.webp', 'image/webp'],
  '/assets/hero-small.webp': ['assets/hero-small.webp', 'image/webp'],
  '/assets/arabic.woff2': ['assets/arabic.woff2', 'font/woff2'],
};

const options = { flavor: flavors, grind: grinds, weight: weights, cadence: cadences };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxBody = 1024;
const headers = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function saveDraft(request, response) {
  const activePort = server.address().port;
  const origin = `http://${host}:${activePort}`;
  if (request.headers.host !== `${host}:${activePort}` || request.headers.origin !== origin) {
    return json(response, 403, { error: 'origin' });
  }
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return json(response, 415, { error: 'content_type' });
  }
  if (Number(request.headers['content-length']) > maxBody) {
    return json(response, 413, { error: 'size' });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBody) {
      request.resume();
      return json(response, 413, { error: 'size' });
    }
    chunks.push(chunk);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return json(response, 400, { error: 'json' });
  }
  const validOption = ([key, map]) => typeof payload[key] === 'string' && Object.hasOwn(map, payload[key]);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof payload.requestKey !== 'string' || !uuid.test(payload.requestKey) ||
      Object.keys(payload).length !== 5 || !Object.entries(options).every(validOption)) {
    return json(response, 422, { error: 'selection' });
  }

  const { requestKey, flavor, grind, weight, cadence } = payload;
  const saved = findDraft.get(requestKey);
  if (saved) {
    return existingDraft(response, payload, saved);
  }

  const now = Date.now();
  if (now - windowStarted >= 60_000) {
    windowStarted = now;
    writesInWindow = 0;
  }
  if (writesInWindow >= 30) {
    response.setHeader('Retry-After', String(Math.ceil((60_000 - (now - windowStarted)) / 1000)));
    return json(response, 429, { error: 'retry_later' });
  }
  const reference = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const { changes } = insert.run(requestKey, reference, flavor, grind, weight, cadence, quote(payload));
  const draft = findDraft.get(requestKey);
  if (!changes) return existingDraft(response, payload, draft);
  writesInWindow++;
  return json(response, 201, draft);
}

function existingDraft(response, payload, draft) {
  if (!Object.keys(options).every(key => payload[key] === draft[key])) {
    return json(response, 409, { error: 'conflict' });
  }
  return json(response, 200, draft);
}

let windowStarted = Date.now();
let writesInWindow = 0;
const server = createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, async (request, response) => {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  try {
    const path = request.url.split('?')[0];
    if (path === '/api/drafts') {
      if (request.method === 'POST') return await saveDraft(request, response);
      response.setHeader('Allow', 'POST');
      return json(response, 405, { error: 'method' });
    }
    if (!Object.hasOwn(assetTypes, path)) return json(response, 404, { error: 'not_found' });
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return json(response, 405, { error: 'method' });
    }
    const [file, type] = assetTypes[path];
    const asset = readFileSync(new URL(`./public/${file}`, import.meta.url));
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': asset.length,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : asset);
  } catch (error) {
    console.error('pilot request failed', error.code ?? error.name);
    if (!response.headersSent) json(response, 500, { error: 'server' });
    else response.end();
  }
});

server.listen(port, host, () => console.log(`http://${host}:${server.address().port}`));
