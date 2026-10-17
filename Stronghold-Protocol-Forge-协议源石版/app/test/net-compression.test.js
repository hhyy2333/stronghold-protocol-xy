// test/net-compression.test.js — permessage-deflate is really negotiated, really compresses, and cannot be
// silently turned off.
//
// WHY. `server/http/websocket.js` turns on permessage-deflate for /ws: over 60 real m.public frames the bytes
// written to the socket fall 481 140 B → 9 072 B (53x, 98 % less), because the frame is ~99 % identical every
// 100 ms. Nothing else covers this — `test/net-socket.test.js` pins the TCP tuning only — so dropping the option
// back to `false` would leave no trace anywhere, and the loss is invisible in play (it is bandwidth, not
// behaviour). That is exactly the kind of regression that needs a test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { WS_DEFLATE } from '../server/http/websocket.js';

/**
 * Boot a real ws server with `opt`, connect one real client, return what was negotiated and the outcome.
 * @param {object|false} opt the server's perMessageDeflate value
 * @param {object} [clientOpt] the client's WebSocket options
 */
async function handshake(opt, clientOpt = { perMessageDeflate: true }) {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: opt });
  server.on('upgrade', (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, clientOpt);
  let offered = null;
  client.on('upgrade', (res) => { offered = res.headers['sec-websocket-extensions'] || null; });
  const outcome = await new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 3000);
    client.on('open', () => { clearTimeout(t); res('open'); });
    client.on('error', (e) => { clearTimeout(t); res('error:' + e.message); });
    client.on('unexpected-response', (_q, r) => { clearTimeout(t); res('http:' + r.statusCode); });
  });
  try { client.terminate(); } catch { /* ignore */ }
  wss.close();
  await new Promise((r) => server.close(r));
  return { offered, outcome };
}

/**
 * Send `frames` from a real server to a real client and count the bytes that reach the socket.
 * @param {object|false} opt the server's perMessageDeflate value
 * @param {string[]} frames the payloads
 * @returns {Promise<{ wire: number, payload: number, negotiated: string }>}
 */
async function wireBytes(opt, frames) {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: opt, clientTracking: false });
  const sockets = [];
  let wire = 0;
  wss.on('connection', (ws) => {
    sockets.push(ws);
    const sock = ws._socket;
    const write = sock.write.bind(sock);
    sock.write = (chunk, ...rest) => { wire += Buffer.byteLength(chunk); return write(chunk, ...rest); };
  });
  server.on('upgrade', (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { perMessageDeflate: true });
  await new Promise((res, rej) => { client.on('open', res); client.on('error', rej); });
  const negotiated = client.extensions || '';
  await new Promise((r) => setTimeout(r, 50));

  const start = wire;
  for (const f of frames) {
    for (const ws of sockets) ws.send(f);
    // space the frames so each becomes its own message with its own flush marker
    await new Promise((r) => setTimeout(r, 2));
  }
  await new Promise((r) => setTimeout(r, 200));
  const total = wire - start;

  client.terminate();
  wss.close();
  await new Promise((r) => server.close(r));
  return { wire: total, payload: frames.reduce((a, s) => a + Buffer.byteLength(s), 0), negotiated };
}

/** A frame shaped like the real m.public: many short, highly repetitive fields. */
function publicFrame(i) {
  return JSON.stringify({
    t: 'm.public',
    phase: 'PREP',
    round: 8,
    players: Array.from({ length: 4 }, (_, s) => ({
      seat: s, name: `玩家${s}`, lp: 24, funds: 12, level: 6, ready: true, alive: true,
      board: Array.from({ length: 8 }, (_, k) => ({
        uid: `u${s}${k}`, chessId: 'chess_char_1_02_a', col: k, row: 2, facing: 'RIGHT',
      })),
    })),
    tick: i,
  });
}

describe('WS permessage-deflate (the /ws bandwidth switch)', () => {
  test('the option the server actually uses negotiates compression', async () => {
    const { offered, outcome } = await handshake(WS_DEFLATE);
    assert.equal(outcome, 'open');
    assert.match(offered, /permessage-deflate/);
  });

  test('it declares no server-side requirement (declaring one can answer 400 instead of degrading)', async () => {
    const { offered } = await handshake(WS_DEFLATE);
    assert.doesNotMatch(offered, /server_no_context_takeover/);
    assert.doesNotMatch(offered, /server_max_window_bits/);
    assert.ok(!('serverNoContextTakeover' in WS_DEFLATE), 'serverNoContextTakeover must not be declared');
    assert.ok(!('serverMaxWindowBits' in WS_DEFLATE), 'serverMaxWindowBits must not be declared');
  });

  test('a client that cannot compress still connects (the point of declaring no requirement)', async () => {
    const { outcome } = await handshake(WS_DEFLATE, { perMessageDeflate: false });
    assert.equal(outcome, 'open');
  });

  test('a client that REQUIRES no-context-takeover still connects (the case that 400s if declared)', async () => {
    const { outcome } = await handshake(WS_DEFLATE, {
      perMessageDeflate: { serverNoContextTakeover: true, serverMaxWindowBits: 15 },
    });
    assert.equal(outcome, 'open', 'a declared requirement would answer HTTP 400 here');
  });

  test('the baseline this replaces negotiates nothing (so the assertion above is not vacuous)', async () => {
    const { offered } = await handshake(false);
    assert.equal(offered, null);
  });

  test('real m.public-shaped frames really shrink on the wire', async () => {
    const frames = Array.from({ length: 40 }, (_, i) => publicFrame(i));
    const on = await wireBytes(WS_DEFLATE, frames);
    const off = await wireBytes(false, frames);
    assert.match(on.negotiated, /permessage-deflate/);
    assert.equal(off.negotiated, '');
    // both delivered the same payload; the compressed path must be dramatically smaller.
    assert.ok(on.wire > 0 && off.wire > 0, 'bytes were measured');
    assert.ok(
      on.wire * 5 < off.wire,
      `expected >5x fewer bytes, got on=${on.wire} off=${off.wire} (payload ${on.payload})`,
    );
  });
});
