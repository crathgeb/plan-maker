// Network mode (--host): reachable from other devices, guarded by a per-run key.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { planCopy, repo, startServer } from './helpers.mjs';

/** A non-loopback IPv4 address of this machine, so requests arrive "from the network". */
const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

function call(host, port, opts = {}, body) {
  return new Promise((ok, bad) => {
    const req = request({ host, port, ...opts }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', bad);
    req.end(body);
  });
}

describe('network mode on every interface (--host 0.0.0.0)', { skip: !lan && 'no network interface' }, () => {
  let server, files, port, key;
  before(async () => {
    files = planCopy(join(repo, 'templates/plan.html'));
    server = await startServer(files.plan, ['--host', '0.0.0.0']);
    port = Number(new URL(server.url).port);
    // The network lines print just after the "open →" line the helper waits for.
    for (let i = 0; i < 40 && !/Ctrl-C/.test(server.output()); i++) await new Promise((r) => setTimeout(r, 50));
    key = server.output().match(/\?key=([\w-]+)/)?.[1];
  });
  after(() => server?.stop());

  test('prints a keyed URL for each network address', () => {
    assert.match(server.output(), /network mode/);
    assert.ok(key, 'a key in the printed URLs');
    assert.match(server.output(), new RegExp(`http://${lan.replace(/\./g, '\\.')}:${port}/\\?key=`));
  });

  test('this machine at 127.0.0.1 needs no key', async () => {
    assert.equal((await call('127.0.0.1', port, { path: '/' })).status, 200);
  });

  test('from the network: no key or a wrong key is refused', async () => {
    assert.equal((await call(lan, port, { path: '/' })).status, 403);
    assert.equal((await call(lan, port, { path: '/api/notes' })).status, 403);
    assert.equal((await call(lan, port, { path: '/?key=nope' })).status, 403);
    // A rebinding page can say it is "localhost", but its request still comes from the network.
    assert.equal((await call(lan, port, { path: '/', headers: { host: 'localhost' } })).status, 403);
  });

  test('the key becomes a cookie, which then opens everything', async () => {
    const first = await call(lan, port, { path: `/?key=${key}` });
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/');
    const cookie = String(first.headers['set-cookie']).split(';')[0];
    assert.match(cookie, new RegExp(`^pm_key_${port}=`));
    assert.equal((await call(lan, port, { path: '/', headers: { cookie } })).status, 200);
    const put = await call(lan, port, { path: '/api/notes', method: 'PUT', headers: { cookie, 'content-type': 'application/json' } }, '{"version":1}');
    assert.equal(put.status, 204);
  });

  test('health is public but names the plan only by a hash', async () => {
    const h = JSON.parse((await call(lan, port, { path: '/api/health' })).text);
    assert.equal(h.app, 'plan-maker');
    assert.match(h.planHash, /^[0-9a-f]{16}$/);
    assert.equal(h.plan, undefined);
  });

  test('a second start reuses the server and reprints the keyed URLs', () => {
    const out = execFileSync(process.execPath, [join(repo, 'scripts/review.mjs'), files.plan, '--no-open', '--port', String(port), '--host', '0.0.0.0'], { encoding: 'utf8' });
    assert.match(out, /already reviewing/);
    assert.ok(out.includes(`?key=${key}`));
  });
});

describe('loopback stays the default', () => {
  let server;
  before(async () => {
    server = await startServer(planCopy(join(repo, 'templates/plan.html')).plan);
  });
  after(() => server?.stop());

  test('no network mode, no key', () => {
    assert.doesNotMatch(server.output(), /network mode|key=/);
  });
});

describe('trusted networks skip the key (--trust)', { skip: !lan && 'no network interface' }, () => {
  let server, port;
  before(async () => {
    // Trust exactly this machine's LAN address, so requests sent to it count as "from a trusted network".
    server = await startServer(planCopy(join(repo, 'templates/plan.html')).plan, ['--host', '0.0.0.0', '--trust', `${lan}/32`]);
    port = Number(new URL(server.url).port);
    for (let i = 0; i < 40 && !/Ctrl-C/.test(server.output()); i++) await new Promise((r) => setTimeout(r, 50));
  });
  after(() => server?.stop());

  test('says which networks are trusted', () => {
    assert.match(server.output(), new RegExp(`trust → no key needed from ${lan.replace(/\./g, '\\.')}/32`));
  });

  test('a trusted device addressing the server by IP needs no key', async () => {
    assert.equal((await call(lan, port, { path: '/' })).status, 200);
    const put = await call(lan, port, { path: '/api/notes', method: 'PUT', headers: { 'content-type': 'application/json' } }, '{"version":1}');
    assert.equal(put.status, 204);
  });

  test('a MagicDNS name is accepted, a rebinding domain is not', async () => {
    assert.equal((await call(lan, port, { path: '/', headers: { host: `box.tail1234.ts.net:${port}` } })).status, 200);
    assert.equal((await call(lan, port, { path: '/', headers: { host: `evil.example:${port}` } })).status, 403);
  });

  test('a bad --trust value is rejected at startup', async () => {
    await assert.rejects(startServer(planCopy(join(repo, 'templates/plan.html')).plan, ['--host', '0.0.0.0', '--trust', 'office']));
  });
});

describe('one network address (--host <ip>) still answers on localhost', { skip: !lan && 'no network interface' }, () => {
  let server, port;
  before(async () => {
    server = await startServer(planCopy(join(repo, 'templates/plan.html')).plan, ['--host', lan]);
    port = Number(new URL(server.url).port);
    for (let i = 0; i < 40 && !/Ctrl-C/.test(server.output()); i++) await new Promise((r) => setTimeout(r, 50));
  });
  after(() => server?.stop());

  test('open → is the keyless localhost URL; net → is the keyed one', () => {
    assert.equal(server.url, `http://127.0.0.1:${port}/`);
    assert.match(server.output(), new RegExp(`net  → http://${lan.replace(/\./g, '\\.')}:${port}/\\?key=`));
  });

  test('localhost needs no key, the network address does', async () => {
    assert.equal((await call('127.0.0.1', port, { path: '/' })).status, 200);
    assert.equal((await call('localhost', port, { path: '/' })).status, 200);
    assert.equal((await call(lan, port, { path: '/' })).status, 403);
  });
});
