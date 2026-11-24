import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

let child, url, directory, path;
const first = { requestKey: randomUUID(), flavor: 'bright', grind: 'filter', weight: '500', cadence: '14' };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sikka-test-'));
  path = join(directory, 'test.sqlite');
  child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', PILOT_DB: path } });
  const [chunk] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  url = chunk.toString().trim();
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(body, overrides = {}) {
  return fetch(`${url}/api/drafts`, {
    method: 'POST',
    headers: { Origin: url, 'Content-Type': 'application/json', ...overrides },
    body: JSON.stringify(body),
  });
}

test('serves only declared public routes with deployment-intent and browser headers', async () => {
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(await result.text(), /lang="ar-SA" dir="rtl"/);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/api/drafts`)).headers.get('allow'), 'POST');
  const head = await fetch(`${url}/assets/hero.webp`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('persists one server-priced draft under concurrent retries', async () => {
  const responses = await Promise.all([request(first), request(first)]);
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 201]);
  const [a, b] = await Promise.all(responses.map(result => result.json()));
  assert.deepEqual(a, b);
  assert.equal(a.price, 109);
  assert.match(a.reference, /^[A-F0-9]{16}$/);
  assert.equal((await request({ ...first, weight: '250' })).status, 409);
  const db = new DatabaseSync(path, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS count FROM drafts').get().count, 1);
  await backup(db, join(directory, 'backup.sqlite'));
  db.close();
  const restored = new DatabaseSync(join(directory, 'backup.sqlite'), { readOnly: true });
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(restored.prepare('SELECT reference FROM drafts').get().reference, a.reference);
  restored.close();
});

test('rejects unsupported input, price fields, missing context and oversize bodies', async () => {
  assert.equal((await request({ ...first, weight: '300' })).status, 422);
  assert.equal((await request({ ...first, price: 1 })).status, 422);
  assert.equal((await request({ ...first, requestKey: 'draft' })).status, 422);
  assert.equal((await request(first, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await request(first, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request({ ...first, weight: 'x'.repeat(1100) })).status, 413);
  assert.equal((await fetch(`${url}/api/drafts`, {
    method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: '{',
  })).status, 400);
});

test('limits new writes and still permits retries of a saved draft', async () => {
  for (let i = 0; i < 29; i++) {
    assert.equal((await request({ ...first, requestKey: randomUUID() })).status, 201);
  }
  const throttled = await request({ ...first, requestKey: randomUUID() });
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get('retry-after')) > 0);
  assert.equal((await request(first)).status, 200);
});
