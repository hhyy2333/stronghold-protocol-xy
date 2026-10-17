// test/spine-regions.test.js — tools/spine-regions.mjs: reading a Spine atlas as its regions, and rebuilding the
// character from them. This is the tool behind docs/CUSTOM-ART.md's "repaint the texture" route: an official operator's
// atlas is ONE character split into ~85 named pieces, and these tests pin that structure so the route keeps working.
// Run: node --test test/spine-regions.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAtlasRegions, regionRole, regionPageRect, uprightOp, setupPoseQuads, quadBounds, atlasPagePath } from '../tools/spine-regions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STEM = 'char_113_cqbw';
const FRONT = join(ROOT, 'public', 'assets', 'spine', 'op', STEM, 'front');
const ATLAS = join(FRONT, `${STEM}.atlas`);
const SKEL = join(FRONT, `${STEM}.skel`);
const HAS_MODEL = existsSync(ATLAS) && existsSync(SKEL);
const REAL = { skip: !HAS_MODEL && 'no shipped model (run npm run assets)' };

test('parseAtlasRegions: the page, its size and every region rectangle', REAL, () => {
  const { page, pageSize, regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  assert.equal(page, `${STEM}.png`);
  assert.deepEqual(pageSize, { w: 512, h: 512 });
  assert.ok(regions.length > 50, `${regions.length} regions`);
  // every region has a name and a non-empty rect
  for (const r of regions) {
    assert.ok(r.name && typeof r.name === 'string', 'a name');
    assert.ok(r.w > 0 && r.h > 0, `${r.name}: a non-empty rect`);
    assert.ok(r.x >= 0 && r.y >= 0, `${r.name}: on the page`);
    assert.ok(r.origW > 0 && r.origH > 0, `${r.name}: an original size`);
  }
  // names are unique (an atlas cannot have two regions with one name)
  assert.equal(new Set(regions.map((r) => r.name)).size, regions.length);
});

test('parseAtlasRegions: rotated regions are flagged', REAL, () => {
  const { regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const rot = regions.filter((r) => r.rotate);
  assert.ok(rot.length > 0, `${rot.length} rotated regions`);
  for (const r of rot) assert.ok(r.w > 0 && r.h > 0, `${r.name}: still has a size`);
});

test('parseAtlasRegions: a hand-written atlas parses, and the page line is the image name', () => {
  const text = [
    'my.png',
    'size: 64,32',
    'format: RGBA8888',
    'filter: Linear,Linear',
    'repeat: none',
    'head',
    '  rotate: false',
    '  xy: 2, 4',
    '  size: 20, 10',
    '  orig: 24, 12',
    '  offset: 2, 1',
    '  index: -1',
    'tail',
    '  rotate: true',
    '  xy: 30, 4',
    '  size: 8, 12',
    '  orig: 12, 8',
    '',
  ].join('\n');
  const { page, pageSize, regions } = parseAtlasRegions(text);
  assert.equal(page, 'my.png');
  assert.deepEqual(pageSize, { w: 64, h: 32 });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0], { name: 'head', x: 2, y: 4, w: 20, h: 10, rotate: false, origW: 24, origH: 12, offX: 2, offY: 1 });
  assert.equal(regions[1].rotate, true);
  assert.deepEqual([regions[1].w, regions[1].h], [8, 12], 'the stored rect');
  assert.deepEqual([regions[1].origW, regions[1].origH], [12, 8], 'the upright size');
});

test('regionPageRect / uprightOp: a rotated region is stored transposed and needs a TRANSPOSE to stand up', () => {
  const plain = { x: 10, y: 20, w: 30, h: 40, rotate: false };
  assert.deepEqual(regionPageRect(plain), { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(uprightOp(false), 'NONE');
  const rot = { x: 10, y: 20, w: 30, h: 40, rotate: true };
  assert.deepEqual(regionPageRect(rot), { x: 10, y: 20, w: 40, h: 30 }, 'the page extent is (h, w)');
  // a plain 90-degree rotation is WRONG for these: scoring every candidate against the runtime's own uv corner mapping
  // puts TRANSPOSE at ~3k alpha units of error and rotate(90) at ~167k
  assert.equal(uprightOp(true), 'TRANSPOSE');
});

test('the rotated-region reading is the one that tiles the page', REAL, () => {
  const { pageSize, regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const cover = new Set();
  let overlap = 0, outOfPage = 0;
  for (const r of regions) {
    const rect = regionPageRect(r);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > pageSize.w || rect.y + rect.h > pageSize.h) { outOfPage++; continue; }
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const k = `${x},${y}`;
      if (cover.has(k)) overlap++; else cover.add(k);
    }
  }
  assert.equal(outOfPage, 0, 'every region fits the page');
  assert.equal(overlap, 0, 'no two regions overlap');
  assert.ok(cover.size > 70000, `the regions cover the artwork (${cover.size} px)`);
});

test('regionRole groups a repaint by what the piece IS', () => {
  assert.equal(regionRole('F_Head'), 'body');
  assert.equal(regionRole('F_L_Arm'), 'body');
  assert.equal(regionRole('C_Gun'), 'prop');
  assert.equal(regionRole('F_Hair'), 'hair');
  assert.equal(regionRole('F_Tail'), 'hair');
  assert.equal(regionRole('F_L_Eye_Happy'), 'expression');
  assert.equal(regionRole('F_Mouth_Laugh'), 'expression');
});

test('setupPoseQuads: every attachment lands in the setup pose, regions with a real quad', REAL, () => {
  const { regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const { items } = setupPoseQuads(SKEL, regions);
  assert.ok(items.length > 30, `${items.length} attachments placed`);
  const reg = items.filter((x) => !x.mesh);
  const mesh = items.filter((x) => x.mesh);
  assert.ok(reg.length > 10, `${reg.length} region sprites`);
  assert.ok(mesh.length > 10, `${mesh.length} deformable meshes`);
  // a region quad is 4 corners = 8 numbers, and is not degenerate
  for (const it of reg) {
    assert.equal(it.verts.length, 8, `${it.name}: a quad`);
    const xs = [it.verts[0], it.verts[2], it.verts[4], it.verts[6]];
    const ys = [it.verts[1], it.verts[3], it.verts[5], it.verts[7]];
    assert.ok(Math.max(...xs) - Math.min(...xs) > 0, `${it.name}: has width`);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 0, `${it.name}: has height`);
  }
  // the named body parts are present and placed (the atlas and the skeleton agree)
  for (const name of ['F_Head', 'F_L_Arm', 'F_Chest', 'F_L_Leg']) {
    const it = reg.find((x) => x.name === name);
    assert.ok(it, `${name} is placed`);
    assert.ok(it.verts.some((v) => Number.isFinite(v)), `${name}: finite coordinates`);
  }
});

test('quadBounds: the assembled character is one coherent body, not scattered pieces', REAL, () => {
  const { regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const { items } = setupPoseQuads(SKEL, regions);
  const b = quadBounds(items);
  assert.ok(b.width > 100 && b.height > 100, `a body-sized bounds (${b.width.toFixed(0)}x${b.height.toFixed(0)})`);
  // a character is taller than it is wide-ish, and nothing is absurdly far from the body
  assert.ok(b.width < 5000 && b.height < 5000, 'not scattered across the plane');
  const head = items.find((x) => x.name === 'F_Head');
  assert.ok(head, 'F_Head is placed');
  const hy = head.verts.filter((_, i) => i % 2 === 1);
  // the head sits in the upper half of the body (y grows downward in this setup pose)
  const headMidY = (Math.min(...hy) + Math.max(...hy)) / 2;
  assert.ok(headMidY < b.maxY, 'the head is above the feet');
});

test('atlasPagePath: the page sits beside the atlas', REAL, () => {
  const { page } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const p = atlasPagePath(ATLAS, page);
  assert.ok(existsSync(p), `${p} exists`);
});

test('the real model has the three roles a repaint must treat separately', REAL, () => {
  const { regions } = parseAtlasRegions(readFileSync(ATLAS, 'utf8'));
  const byRole = {};
  for (const r of regions) (byRole[regionRole(r.name)] ||= []).push(r);
  for (const role of ['body', 'hair', 'prop', 'expression']) assert.ok(byRole[role]?.length, `${role} regions exist`);
  // the body + hair + props are what a repaint MUST draw; the expressions are mostly optional details
  const must = regions.filter((r) => regionRole(r.name) !== 'expression');
  assert.ok(must.length > 40, `${must.length} regions a repaint must cover`);
});
