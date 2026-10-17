// WebSocket permessage-deflate, end to end (server/http/websocket.js WS_DEFLATE): a browser-like client negotiates
// it against a bare http server and against the real startServer(), a large JSON frame goes out compressed, a client
// without the extension gets plain frames, and a compressed client frame whose INFLATED size is over the 64 KB limit
// closes the socket (1009) exactly like a plain one.
//
// The config itself — the fork's measured tuning (threshold 64, level 3, memLevel 3, concurrencyLimit 32, and
// deliberately NO serverNoContextTakeover / serverMaxWindowBits) — is pinned by test/net-compression.test.js, which
// also measures the wire saving on real m.public-shaped frames. This file covers the paths that go through
// attachWebSocket() and the live server, which that one does not.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocket, WS_DEFLATE } from '../server/http/websocket.js';
import { startServer } from '../server/index.js';

const BIG = JSON.stringify({ t: 'm.public', players: Array.from({ length: 200 }, (_, i) => ({ playerId: `p_${i % 4}`, name: '阿米娅', lp: 30, phase: 'PREP' })) });
const SMALL = JSON.stringify({ t: 'pong', at: 12345 });

/** A bare http server whose /ws sends BIG then SMALL to every socket (a stand-in for net.js Network). */
async function fakeServer() {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const network = {
    admission: () => null,
    handleConnection: (ws) => { ws.send(BIG); ws.send(SMALL); },
  };
  const wss = attachWebSocket(server, { network, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${server.address().port}/ws`, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}

/** Connect, collect two messages, report the server's Sec-WebSocket-Extensions answer and the bytes the socket read. */
function receive(url, opts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    const msgs = [];
    let negotiated = '';
    ws.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || ''; });
    ws.on('error', reject);
    ws.on('message', (data) => {
      msgs.push(String(data));
      if (msgs.length === 2) {
        const read = ws._socket.bytesRead;
        ws.close();
        resolve({ msgs, read, extensions: negotiated });
      }
    });
  });
}

describe('WebSocket permessage-deflate', () => {
  let srv;
  before(async () => { srv = await fakeServer(); });
  after(async () => { await srv.close(); });

  test('negotiated with the fork tuning: a large frame is compressed and arrives intact', async () => {
    const r = await receive(srv.url);
    assert.match(r.extensions, /permessage-deflate/);
    // The fork tuning declares NO server-side requirement: declaring either turns it into one and `ws` answers a
    // client that cannot meet it with 400 instead of degrading (see server/http/websocket.js WS_DEFLATE and
    // test/net-compression.test.js).
    assert.doesNotMatch(r.extensions, /server_no_context_takeover/);
    assert.doesNotMatch(r.extensions, /server_max_window_bits/);
    assert.deepEqual(r.msgs, [BIG, SMALL], 'the payloads arrive intact');
    assert.ok(BIG.length > 10000);
    assert.ok(r.read < BIG.length / 4, `compressed on the wire: ${r.read} bytes read for ${BIG.length} of payload`);
    // The measured fork threshold (net-compression.test.js measures what it buys; this pins the value so a silent
    // switch back to the `ws` default of 1024 — under which a proxy-negotiated no-context-takeover side would let
    // small frames through uncompressed — fails here).
    assert.equal(WS_DEFLATE.threshold, 64);
  });

  test('a client without the extension gets the same messages uncompressed', async () => {
    const r = await receive(srv.url, { perMessageDeflate: false });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.ok(r.read > BIG.length + SMALL.length, `plain frames: ${r.read}`);
  });
});

test('the real server negotiates compression at /ws and keeps the 64 KB inflated frame limit', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    assert.match(ws.extensions, /permessage-deflate/);
    // a compressed client frame whose inflated size is over the limit closes the socket (1009), like a plain one
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ t: 'hello', name: 'x'.repeat(70 * 1024) }));
    assert.equal(await closed, 1009);
  } finally {
    await srv.close();
  }
});
