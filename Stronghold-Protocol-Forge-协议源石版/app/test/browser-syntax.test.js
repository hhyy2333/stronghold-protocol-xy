// test/browser-syntax.test.js — the syntax floor of everything the browser runs.
//
// test/client-static.test.js already guards CSS features and a few *APIs* (Object.hasOwn, .at(), structuredClone,
// .findLast) against the supported browsers. This file guards *syntax*, which fails differently: a parser rejects the
// whole module, so one file stops the client on one browser class with no error a player can act on.
//
// The floor is the one docs and client-static.test.js already state: desktop Chrome / Edge / Firefox (incl. ESR 115) /
// Safari 15+, iPadOS / iOS 15+ Safari, Android Chrome. Read the other way, that is the *lowest* engine the code may
// use to parse:
//
//   Chrome 89 / Firefox 89 / Safari 15   top-level await          (server/sim/content/*.js is served at /sim/ and
//                                                                 loaded by public/js/battle/runner.js — the repo
//                                                                 deliberately uses it, so the floor cannot be lower)
//   Chrome 85 / Firefox 79 / Safari 14   ||= ??= &&=
//   Chrome 75 / Firefox 70 / Safari 13   numeric separators (60_000)
//   Chrome 74 / Firefox 90 / Safari 14.1 private fields
//
// So `ecmaVersion: 2022` is the correct parser level: it accepts what the repo legitimately uses (top-level await,
// private fields, ||=, numeric separators) and rejects what it must not use (regex `v`, hashbang, and anything after).
// Two things ES2022 accepts but the floor does NOT are checked separately, because acorn cannot express them as a
// version: class static blocks and the regex `d` flag are both later than Safari 15.
//
// This is deliberately NOT an `ecmaVersion: 2020` gate: that would reject the top-level await the battle sim is built
// on (27 files) and the numeric separators used throughout (108), i.e. it would fail on correct code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/** Every `.js` under `dir`. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// Everything the static server can hand to a browser (server/http/static.js mounts /shared/ → shared/,
// /sim/ → server/sim/, everything else → public/). `nodeData.js` is the one file the sim mount denies.
const PUBLIC_JS = walk(path.join(PUBLIC, 'js'));
const SHARED_JS = walk(path.join(ROOT, 'shared'));
const SIM_JS = walk(path.join(ROOT, 'server', 'sim')).filter((f) => !/nodedata\.js$/i.test(f));
const BROWSER_JS = [...PUBLIC_JS, ...SHARED_JS, ...SIM_JS];

/** The parser level that matches the documented browser floor (see the header). */
const ECMA_VERSION = 2022;

/**
 * Regex flags later than Safari 15, and the browser each needs.
 * `d` (hasIndices) needs Safari 15.4; `v` (unicodeSets) needs Safari 17.
 */
const LATE_REGEX_FLAGS = {
  d: 'Safari 15.4 / Chrome 90 (hasIndices)',
  v: 'Safari 17 / Chrome 112 (unicodeSets)',
};

/** Walk every node of an ESTree AST without a dependency on acorn-walk. */
function eachNode(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) eachNode(n, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) if (key !== 'type') eachNode(node[key], visit);
}

describe('browser syntax floor (Chrome 89 / Firefox 89 / Safari 15)', () => {
  test('the scan covers the client modules, the shared modules and the served sim', () => {
    assert.ok(BROWSER_JS.length > 300, `expected the whole browser surface, got ${BROWSER_JS.length} files`);
    for (const f of ['public/js/main.js', 'shared/constants.js', 'server/sim/Battle.js']) {
      assert.ok(BROWSER_JS.some((p) => path.relative(ROOT, p).replace(/\\/g, '/') === f), `${f} is in the scan`);
    }
  });

  test(`every browser-served module parses at ecmaVersion ${ECMA_VERSION}`, () => {
    const bad = [];
    for (const file of BROWSER_JS) {
      try {
        acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: ECMA_VERSION, sourceType: 'module' });
      } catch (err) {
        bad.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} :: ${err.message}`);
      }
    }
    assert.deepEqual(bad, [], `syntax newer than the browser floor:\n  ${bad.join('\n  ')}`);
  });

  test('the transformed simdata.js the server serves also parses (its Node-only block is stripped at serve time)', () => {
    // server/http/static.js rewrites /sim/simdata.js before sending it; mirror that here so the gate sees what a
    // browser really receives rather than the Node file.
    const raw = readFileSync(path.join(ROOT, 'server', 'sim', 'simdata.js'), 'utf8');
    const browserCode = raw.replace(/if\s*\(\s*IS_NODE\s*\)\s*\{[\s\S]*?\n\}/, '/* browser: nodeLoader omitted */');
    assert.doesNotThrow(
      () => acorn.parse(browserCode, { ecmaVersion: ECMA_VERSION, sourceType: 'module' }),
      'the browser form of simdata.js must parse at the browser floor',
    );
  });

  test('no class static initialization block (Safari 16.4 / Chrome 94, above the floor)', () => {
    const bad = [];
    for (const file of BROWSER_JS) {
      const ast = acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: ECMA_VERSION, sourceType: 'module' });
      eachNode(ast, (n) => {
        if (n.type === 'StaticBlock') bad.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${n.loc.start.line}`);
      });
    }
    assert.deepEqual(bad, [], `class static { } blocks (use a static field or an initializer call):\n  ${bad.join('\n  ')}`);
  });

  test('no regex flag later than the floor (d / v)', () => {
    const bad = [];
    for (const file of BROWSER_JS) {
      const ast = acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: ECMA_VERSION, sourceType: 'module' });
      eachNode(ast, (n) => {
        if (!n.regex || typeof n.regex.flags !== 'string') return;
        for (const [flag, needs] of Object.entries(LATE_REGEX_FLAGS)) {
          if (n.regex.flags.includes(flag)) {
            const where = `${path.relative(ROOT, file).replace(/\\/g, '/')}:${n.loc.start.line}`;
            bad.push(`${where} uses /${n.regex.pattern}/${n.regex.flags} — ${flag} needs ${needs}`);
          }
        }
      });
    }
    assert.deepEqual(bad, [], `regex flags above the floor:\n  ${bad.join('\n  ')}`);
  });

  test('the gate fails on each thing it claims to catch (the check itself is exercised)', () => {
    const rejects = (src) => {
      try { acorn.parse(src, { ecmaVersion: ECMA_VERSION, sourceType: 'module' }); return false; }
      catch { return true; }
    };
    assert.equal(rejects('const r = /a/v;'), true, 'regex v is above the floor');
    assert.equal(rejects('#!/usr/bin/env node\nconst a = 1;'), true, 'hashbang is ES2023');
    assert.equal(rejects('const a = 1;'), false, 'plain ES is accepted');
    // and the syntax the repo legitimately relies on stays accepted
    assert.equal(rejects('const a = await Promise.resolve(1);'), false, 'top-level await is the floor itself');
    assert.equal(rejects('class A { static x = 1; }'), false, 'static fields are ES2022 and inside the floor');
    assert.equal(rejects('const n = 60_000;'), false, 'numeric separators are far below the floor');
    assert.equal(rejects('a ||= 1; b ??= 2;'), false, 'logical assignment is below the floor');
  });
});
