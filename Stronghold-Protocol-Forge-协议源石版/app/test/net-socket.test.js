// test/net-socket.test.js — the TCP tuning server/net.js applies to every adopted socket.
//
// Why this is tested rather than assumed: `ws` exposes the TCP handle only as the private `_socket`, and Node's
// Socket has no getter for the keepalive interval, so a silent regression (a renamed option, a dropped call, an
// exception swallowed by the try/catch) would leave no trace anywhere else in the suite. A phone that leaves the
// network without a FIN then keeps a half-open socket the app-level ws heartbeat only notices on the next ping.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Network, SessionRegistry, NET_DEFAULTS } from '../server/net.js';

const noop = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Boot a real HTTP server + ws server wired to `net.handleConnection`, connect one client, and hand the
 * server-side WebSocket to `fn`. Returns whatever `fn` returns.
 */
async function withAdoptedSocket(net, fn) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => net.handleConnection(ws, req));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await new Promise((res, rej) => { client.on('open', res); client.on('error', rej); });
    await new Promise((r) => setTimeout(r, 30)); // let the server-side handler run
    const serverWs = [...wss.clients][0];
    return await fn(serverWs);
  } finally {
    client.close();
    wss.close();
    await new Promise((r) => server.close(r));
  }
}

function makeNet(options) {
  const registry = new SessionRegistry();
  return new Network({ registry, handler: { onMessage: () => ({ ok: true }) }, log: noop, options });
}

describe('server/net.js TCP tuning', () => {
  test('keepAliveMs has a default and is overridable through the Network options', () => {
    assert.equal(typeof NET_DEFAULTS.keepAliveMs, 'number');
    assert.ok(NET_DEFAULTS.keepAliveMs > 0, 'a 0 interval would disable probing');
    assert.equal(makeNet().opts.keepAliveMs, NET_DEFAULTS.keepAliveMs);
    assert.equal(makeNet({ keepAliveMs: 1234 }).opts.keepAliveMs, 1234);
  });

  test('handleConnection calls setNoDelay(true) and setKeepAlive(true, keepAliveMs) on the adopted socket', async () => {
    const calls = [];
    // A stub socket: this asserts the exact calls the server makes, which Node's real Socket cannot report back.
    const stubSocket = {
      setNoDelay(v) { calls.push(['setNoDelay', v]); },
      setKeepAlive(enabled, ms) { calls.push(['setKeepAlive', enabled, ms]); },
    };
    const net = makeNet({ keepAliveMs: 4321 });
    const serverWs = { _socket: stubSocket, on() {}, close() {} };
    net.handleConnection(serverWs, { socket: { remoteAddress: '127.0.0.1' } });

    assert.deepEqual(calls, [['setNoDelay', true], ['setKeepAlive', true, 4321]]);
  });

  test('a socket without the methods (or a throwing one) does not break adoption', () => {
    const net = makeNet();
    // no _socket at all
    assert.doesNotThrow(() => net.handleConnection({ on() {}, close() {} }, undefined));
    // methods that throw: the tuning is best-effort and must not stop the connection being adopted
    const throwing = { _socket: { setNoDelay() { throw new Error('nope'); }, setKeepAlive() { throw new Error('nope'); } } };
    assert.doesNotThrow(() => net.handleConnection({ _socket: throwing._socket, on() {}, close() {} }, undefined));
  });

  test('a real adopted socket accepts the tuning and stays open', async () => {
    const net = makeNet();
    await withAdoptedSocket(net, (serverWs) => {
      const sock = serverWs._socket;
      assert.ok(sock, 'ws exposes the TCP handle as _socket');
      assert.equal(serverWs.readyState, WebSocket.OPEN, 'tuning must not disturb the connection');
    });
  });
});
