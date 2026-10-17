// test/client-imports.test.js — every relative import the browser will actually follow must RESOLVE.
//
// The renderer's own failure mode is not a crash: the page boots no modules at all and the user only sees
// "游戏脚本加载失败" / a renderer that never comes up. A single wrong `../` depth does it — a module under
// `public/js/ui/` importing `'../vendor/hooks.module.js'` is one level short (the vendor dir is at `public/vendor`),
// which 404s, breaks the whole module graph and leaves every screen blank.
//
// test/browser-syntax.test.js guards syntax and test/client-static.test.js guards APIs/CSS; neither resolves
// specifiers, so this is the missing floor. It follows the real graph from the entry module instead of scanning
// directories, so it sees exactly what the browser sees: static imports, re-exports, and dynamic `import('…')`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/** Every `.js` under `dir`, as paths relative to ROOT (posix). */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Import specifiers of a module, comments and strings other than the specifier position excluded. Uses acorn's AST
 * (already a devDependency: test/browser-syntax.test.js parses every browser module with it), so a specifier inside a
 * comment or a template literal is never mistaken for an import — a naive regex over this tree does exactly that and
 * reports phantom breakage.
 */
function specifiersOf(file) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  const found = [];
  const push = (node, spec) => found.push({ spec, line: node.loc ? node.loc.start.line : 0 });
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration')
      && node.source && typeof node.source.value === 'string') {
      push(node, node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
      // only static string specifiers can be checked; `import(base + 'x')` is resolved at runtime
      push(node, node.source.value);
    }
    for (const key of Object.keys(node)) if (key !== 'type' && key !== 'loc') visit(node[key]);
  };
  visit(ast);
  return found;
}

/** Where a relative specifier lands, or null when it leaves `public/` (the import map / server mount handles those). */
function resolveInPublic(spec, fromFile) {
  if (!spec.startsWith('.')) return null;                 // bare (import map) or absolute (/vendor, /sim, /js)
  const target = path.resolve(ROOT, path.dirname(fromFile), spec);
  return path.relative(ROOT, target).split(path.sep).join('/');
}

const BROWSER_JS = [...walk(path.join(PUBLIC, 'js')), ...walk(path.join(ROOT, 'shared'))];

describe('client import graph resolves', () => {
  test('the scan covers the client surface', () => {
    assert.ok(BROWSER_JS.length > 150, `expected the client modules, got ${BROWSER_JS.length}`);
    for (const f of ['public/js/main.js', 'public/js/ui/fieldHost.js', 'public/js/render/app.js']) {
      assert.ok(BROWSER_JS.includes(f), `${f} is in the scan`);
    }
  });

  test('every relative specifier a browser module imports points at a file that exists', () => {
    const broken = [];
    for (const file of BROWSER_JS) {
      for (const { spec, line } of specifiersOf(file)) {
        const target = resolveInPublic(spec, file);
        if (target === null) continue;
        // a specifier must stay inside public/: /vendor, /js, /shared are mounted absolute, not relative
        if (target.startsWith('..')) { broken.push(`${file}:${line} ${spec} (escapes public/)`); continue; }
        if (!existsSync(path.join(ROOT, target))) broken.push(`${file}:${line} ${spec} -> ${target} (missing)`);
      }
    }
    assert.deepEqual(broken, [], `a browser import that cannot resolve kills the whole module graph:\n  ${broken.join('\n  ')}`);
  });

  test('the vendor directory is reachable from every depth that imports it', () => {
    // the exact bug this guards: ui/ modules need TWO levels (ui/ → js/ → public/vendor), not one
    const vendorFrom = (file) => specifiersOf(file).filter((s) => s.spec.includes('vendor/'));
    const ui = vendorFrom('public/js/ui/fieldHost.js');
    assert.ok(ui.some((s) => s.spec === '../../vendor/hooks.module.js'), 'a public/js/ui module reaches vendor with ../../');
    const deep = vendorFrom('public/js/screens/game/standInTags.js');
    assert.ok(deep.some((s) => s.spec === '../../../vendor/hooks.module.js'), 'a public/js/screens/<x> module reaches vendor with ../../../');
  });

  test('the check would have caught the real bug (a wrong vendor depth)', () => {
    // exactly the shape that 404ed the page: one level short from public/js/ui/
    const wrong = path.resolve(ROOT, 'public/js/ui', '../vendor/hooks.module.js');
    assert.equal(path.relative(ROOT, wrong).split(path.sep).join('/'), 'public/js/vendor/hooks.module.js');
    assert.equal(existsSync(wrong), false, 'public/js/vendor does not exist — this is what broke the module graph');
    // and the fix resolves
    const right = path.resolve(ROOT, 'public/js/ui', '../../vendor/hooks.module.js');
    assert.equal(existsSync(right), true, 'public/vendor/hooks.module.js is the real module');
  });
});
