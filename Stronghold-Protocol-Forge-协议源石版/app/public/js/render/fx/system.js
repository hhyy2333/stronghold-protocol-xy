// public/js/render/fx/system.js — FxSystem: the pools are built here; the effect methods are installed from the containers.
// The containers are installed in source order. A name defined twice is an error.

import { fxAtlas } from '../textures.js';

/**
 * 丰川祥子的「音符」贴图：本机《明日方舟》客户端里她那张音符贴图（battle/prefabs/effects/oblvns.ab 的
 * oblvns_skin_04 / _05，一个贴图里 4 个字形）由 tools/local-extract 解到 public/assets/local/fx/note_1..8.png。
 * public/assets 是 git-ignored 的本机素材，所以这些文件**可以缺席**：缺席时用 FX 图集里画出来的那颗音符兜底。
 */
const NOTE_TEXTURE_URLS = Object.freeze([
  '/assets/local/fx/note_1.png', '/assets/local/fx/note_2.png', '/assets/local/fx/note_3.png', '/assets/local/fx/note_4.png',
  '/assets/local/fx/note_5.png', '/assets/local/fx/note_6.png', '/assets/local/fx/note_7.png', '/assets/local/fx/note_8.png',
]);

/**
 * 「不死的黑蛇」不息恶火的火球贴图：本机客户端 pkgrps/btl_pfb_fx_enemy_1.ab 里的 bsnake_04 / 05 / 07 / 10 / 12 / 16，
 * 由 tools/local-extract/op-fx.py --prefix bsnake --no-split 解到 public/assets/local/fx/。每张本身就是一整片字形，
 * 不能再切象限：
 *   bsnake_10 —— 火球本体（一朵带火星的火焰），fx 'fireball' 的弹头；
 *   bsnake_05 / 07 —— 一段火焰条（冷 / 热两张），火球身后那截燃烧尾迹；
 *   bsnake_12 —— 带火舌的圆环，火球进场时铺在地面上的那圈预热；
 *   bsnake_16 —— 首领轮廓的白光，重生那一瞬的剪影。
 * public/assets 是 git-ignored 的本机素材，所以这些文件**可以缺席**：缺席时全部退回 FX 图集里画的那几样。
 */
const SNAKE_FIRE_TEXTURES = Object.freeze({
  head: '/assets/local/fx/bsnake_10.png',
  trailHot: '/assets/local/fx/bsnake_05.png',
  trailCold: '/assets/local/fx/bsnake_07.png',
  ring: '/assets/local/fx/bsnake_12.png',
  silhouette: '/assets/local/fx/bsnake_16.png',
});
import { ensureDamageFonts } from './fonts.js';
import { MAX_PARTICLES } from './limits.js';
import { FxParticles } from './particles.js';
import { FxProjectiles } from './projectiles.js';
import { FxBeams } from './beams.js';
import { FxLocks } from './locks.js';
import { FxNumbers } from './numbers.js';
import { FxRings } from './rings.js';
import { FxArrivals } from './arrivals.js';
import { FxSim } from './simfx.js';
import { FxZones } from './zones.js';

export class FxSystem {
  /**
   * @param {{ P, layers: { groundFx, fxAdd, fxNormal, text, screen }, cam: () => any, view: (id) => any,
   *           heightAt: (r,c)=>number, settings: object, assets: any, timeScale: () => number,
   *           subProfOf: (defId) => string|null, screenSize: () => {width,height}, fieldTop: () => number }} ctx
   */
  constructor(ctx) {
    const P = ctx.P;
    this.ctx = ctx;
    this.P = P;
    this.atlas = fxAtlas();
    this.tex = this.atlas.tex;
    // 官方音符 / 火球贴图（异步就绪；没加载到就继续用图集里画的那几样）
    this.noteTex = [];
    this.fireTex = {};
    if (typeof Image === 'function') {
      for (const url of NOTE_TEXTURE_URLS) {
        const img = new Image();
        img.onload = () => { try { this.noteTex.push(new P.Texture(P.BaseTexture.from(img))); } catch { /* keep the drawn glyph */ } };
        img.src = url;
      }
      for (const [key, url] of Object.entries(SNAKE_FIRE_TEXTURES)) {
        const img = new Image();
        img.onload = () => { try { this.fireTex[key] = new P.Texture(P.BaseTexture.from(img)); } catch { /* keep the drawn one */ } };
        img.src = url;
      }
    }
    ensureDamageFonts();
    const props = { vertices: true, position: true, rotation: true, uvs: true, tint: true };
    this.addPc = new P.ParticleContainer(MAX_PARTICLES.high, props, 512, true);
    this.addPc.blendMode = P.BLEND_MODES.ADD;
    this.normPc = new P.ParticleContainer(MAX_PARTICLES.high, props, 512, true);
    // ground shadows of flying shells / boomerangs: normal blend, under the units and the smoke
    this.shadowLayer = new P.Container();
    ctx.layers.fxNormal.addChild(this.shadowLayer, this.normPc);
    ctx.layers.fxAdd.addChild(this.addPc);
    this.parts = [];          // active particle records { sp, add, x, y, vx, … }
    this.freeAdd = []; this.freeNorm = [];   // pooled particle records (their sprites stay in the containers)
    this.projs = [];
    this.projFree = [];
    this.projLayer = new P.Container();
    ctx.layers.fxAdd.addChild(this.projLayer);
    this.locks = [];          // lock-on reticles { view, id, src, x, y, z, t, idle, max, out, ring, core, shell }
    this.lockFree = [];
    this._po = {};            // options of the per-frame emitters (see _o)
    this.beams = new P.Graphics();
    this.beams.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.fxAdd.addChild(this.beams);
    this.beamList = [];
    this.flames = [];         // fire jets (炎佑 祛恶之焰) { src, tgt, x, y, z, r, col, t, end, disc, edge, … }
    this.nums = [];
    this._numPools = new Map();   // bitmap font → free number records
    this.auras = new Map();   // unit id → { sprite, ring, t }
    this.rings = [];          // ground rings { sprite, x, y, z, t, dur, r0, r1, tint }
    this.ringFree = [];
    this.pops = [];           // screen-space pops (bond glyphs, coins)
    this.zones = [];          // persistent ground areas (zone / telegraph fx)
    this.labels = [];         // floating '!' / '+n' labels
    this.tileFlashes = [];    // flashing tile sets (telegraphed boxes)
    this.tileFields = [];     // persistent tile highlights (a skill's range, fx 'field')
    this.musicEl = null;      // the skill's own piece of music (fx 'music' / 'musicStop', zones.js)
    this.musicT = 0;
    this.musicDur = 0;
    this.tileGfx = new P.Graphics();
    this.tileGfx.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.groundFx.addChild(this.tileGfx);
    this.tintSprite = new P.Sprite(P.Texture.WHITE);
    this.tintSprite.alpha = 0;
    this.tintSprite.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.screen.addChild(this.tintSprite);
    this.tintT = 0; this.tintDur = 1; this.tintA = 0;
    this.vignette = new P.Sprite(ctx.redVignette || P.Texture.EMPTY);
    this.vignette.alpha = 0;
    ctx.layers.screen.addChild(this.vignette);
    this.vigT = 0;
    this.time = 0;
    this._p = { x: 0, y: 0, s: 0, depth: 0 };
    this._q = { x: 0, y: 0, s: 0, depth: 0 };
    this._g = { x: 0, y: 0, s: 0, depth: 0 };
  }

  /** Remove everything (battle reset). */
  clear() {
    for (const p of this.parts) this._freeParticle(p);
    this.parts.length = 0;
    for (const pr of this.projs) this._releaseProj(pr);
    this.projs.length = 0;
    for (const L of this.locks) this._freeLock(L);
    this.locks.length = 0;
    this._slashAt = null;
    for (const t of this.nums) this._releaseNum(t);
    this.nums.length = 0;
    for (const r of this.rings) { r.sp.visible = false; this.ringFree.push(r); }
    this.rings.length = 0;
    for (const a of this.auras.values()) a.sp.destroy({ children: true });
    this.auras.clear();
    for (const p of this.pops) p.c.destroy({ children: true });
    this.pops.length = 0;
    this.beamList.length = 0;
    this.beams.clear();
    for (const F of this.flames) this._freeFlame(F);
    this.flames.length = 0;
    this.vigT = 0;
    this.vignette.alpha = 0;
    for (const zn of this.zones) this._freeZone(zn);
    this.zones.length = 0;
    for (const l of this.labels) l.t.destroy();
    this.labels.length = 0;
    this.tileFlashes.length = 0;
    this.tileFields.length = 0;
    this.tileGfx.clear();
    try { this.stopMusic(); } catch { /* ignore */ }
    this.tintT = 0; this.tintSprite.alpha = 0;
  }

  update(dt) {
    this.time += dt;
    this._updateParticles(dt);
    this._updateProjs(dt);
    this._updateLocks(dt);
    this._updateBeams(dt);
    this._updateFlames(dt);
    this._updateNums(dt);
    this._updateRings(dt);
    this._updateAuras(dt);
    this._updatePops(dt);
    this._updateZones(dt);
    this._updateLabels(dt);
    this._updateTileFlashes(dt);
    this._updateMusic(dt);
    if (this.tintT > 0) {
      this.tintT = Math.max(0, this.tintT - dt);
      const size = this.ctx.screenSize();
      this.tintSprite.width = size.width; this.tintSprite.height = size.height;
      this.tintSprite.alpha = Math.sin((this.tintT / this.tintDur) * Math.PI) * this.tintA * 0.35;
    } else if (this.tintSprite.alpha) this.tintSprite.alpha = 0;
    if (this.vigT > 0) {
      this.vigT = Math.max(0, this.vigT - dt);
      const size = this.ctx.screenSize();
      this.vignette.width = size.width; this.vignette.height = size.height;
      this.vignette.alpha = Math.sin((this.vigT / 0.9) * Math.PI) * 0.55;
    } else if (this.vignette.alpha) this.vignette.alpha = 0;
  }

  get counts() {
    return { particles: this.parts.length, projectiles: this.projs.length, numbers: this.nums.length, rings: this.rings.length, auras: this.auras.size, locks: this.locks.length, flames: this.flames.length, promotions: this.promotions || 0 };
  }

  destroy() {
    this.clear();
    this.addPc.destroy({ children: true });
    this.normPc.destroy({ children: true });
    this.projLayer.destroy({ children: true });
    this.shadowLayer.destroy({ children: true });
    this.lockFree.length = 0;
    this.projFree.length = 0;
    this.freeAdd.length = 0; this.freeNorm.length = 0;
    this.beams.destroy();
    this.vignette.destroy();
    this.tileGfx.destroy();
    this.tintSprite.destroy();
    for (const list of this._numPools.values()) for (const t of list) t.text.destroy();
    this._numPools.clear();
  }
}

const FX_PARTS = [FxParticles, FxProjectiles, FxBeams, FxLocks, FxNumbers, FxRings, FxArrivals, FxSim, FxZones];
const FX_METHOD_ORDER = ["quality","load","maxParticles","rich","_room","_ts","_groundZ","particle","_o","_freeParticle","_updateParticles","_proj","_onGround","_chest","_bodyPt","burst","attack","_takeProj","_dressProj","_releaseProj","_updateProjs","_shotPoint","_stepShot","_stepBoomerang","_stepMortar","_stepComet","fireball","_mote","_puff","_muzzle","_impact","_catch","mortar","_landed","_beam","_updateBeams","_flame","_freeFlame","_updateFlames","_lock","_touchLocks","_nearestLock","_releaseLock","_freeLock","_updateLocks","damage","_slash","heal","officialNumber","number","_growFits","_numSlotPx","_layoutNums","_layoutNumsOnce","_sizeNum","_fadeNum","_takeNum","_releaseNum","_updateNums","ring","_updateRings","skill","_aura","_updateAuras","deploy","promote","death","crateBreak","_viewOf","_where","_point","simFx","explosion","smoke","streak","strike","numberAt","_updateLabels","zone","_freeZone","_updateZones","tileFlash","tileField","_updateTileFlashes","music","stopMusic","_updateMusic","_fadeOutMusic","flashScreen","snowfall","leak","pop","_updatePops"];

for (const key of FX_METHOD_ORDER) {
  let found = null;
  for (const part of FX_PARTS) {
    if (!Object.prototype.hasOwnProperty.call(part.prototype, key)) continue;
    if (found) throw new Error(`FxSystem.${key} is defined twice`);
    found = part;
  }
  if (!found) throw new Error(`FxSystem.${key} is missing`);
  if (Object.prototype.hasOwnProperty.call(FxSystem.prototype, key)) throw new Error(`FxSystem.${key} is defined twice`);
  Object.defineProperty(FxSystem.prototype, key, Object.getOwnPropertyDescriptor(found.prototype, key));
}