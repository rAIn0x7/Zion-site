/* FingerMOBA — 单手幸存者(Survivor 风)。Phaser + SVG 贴图,秒开。
   摇杆/WASD 走位 + 自动开火 + 怪潮 + 升级三选一 + 打击感 + 最高分 + 引流 CTA。 */
const W = 540;
// 画布高度跟随设备比例(W 固定),让 FIT 刚好铺满、消除上下黑边;布局全按 H 相对定位,自动适配。
const H = Math.round(Math.max(900, Math.min(1280, 540 * ((window.innerHeight || 960) / (window.innerWidth || 540)))));
const DPR = Math.min(window.devicePixelRatio || 1, 3); // 跟随设备像素比(封顶 3,覆盖主流 3x 手机屏)
const RASTER = 384;                                    // SVG 栅格化分辨率(够大标题大图也不糊)
const SPRITES = ['hero', 'enemy_basic', 'enemy_fast', 'enemy_tank', 'gem', 'projectile'];

// 全局文字工厂:resolution 提清晰度(高分屏不糊),padding 防顶部裁剪
function mkText(scene, x, y, str, style) {
  return scene.add.text(x, y, str, Object.assign({ resolution: Math.min(DPR, 2), padding: { y: 5 } }, style || {}));
}
const BEST_KEY = 'fm_best_secs';
const HUB_URL = 'https://qizh.space';

/* ── 极简合成音效(无音频文件,首次点击后启用,可静音) ── */
const SFX = {
  ctx: null, muted: localStorage.getItem('fm_muted') === '1',
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  blip(freq, dur, type, gain) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  kill() { this.blip(200, 0.07, 'square', 0.03); },
  hurt() { this.blip(90, 0.12, 'sawtooth', 0.05); },
  level() { this.blip(523, 0.1, 'triangle', 0.06); setTimeout(() => this.blip(784, 0.13, 'triangle', 0.06), 90); },
  over() { this.blip(160, 0.3, 'sawtooth', 0.07); setTimeout(() => this.blip(80, 0.5, 'sawtooth', 0.07), 130); },
  beatI: 0,
  beat() { // 循环背景乐:低音 bass loop + 隔拍 arp
    if (this.muted || !this.ctx) return;
    const bass = [98.0, 110.0, 130.81, 110.0, 98.0, 87.31, 130.81, 123.47];
    const f = bass[this.beatI % bass.length];
    this.blip(f, 0.26, 'triangle', 0.045);
    if (this.beatI % 2 === 0) this.blip(f * 3.01, 0.10, 'square', 0.015);
    this.beatI++;
  },
  toggle() { this.muted = !this.muted; localStorage.setItem('fm_muted', this.muted ? '1' : '0'); return this.muted; },
};

/* ── 局外永久成长(金币 + 商店,localStorage 持久化) ── */
const COINS_KEY = 'fm_coins', UPG_KEY = 'fm_upg';
const META = {
  upgrades: [
    { key: 'hp',   name: '❤ 初始生命', per: '+20',  max: 8, cost: l => 30 + l*40 },
    { key: 'dmg',  name: '⚔ 初始伤害', per: '+10%', max: 8, cost: l => 40 + l*55 },
    { key: 'fire', name: '🔥 初始攻速', per: '+6%',  max: 6, cost: l => 50 + l*65 },
    { key: 'spd',  name: '🏃 初始移速', per: '+6%',  max: 6, cost: l => 40 + l*45 },
    { key: 'mag',  name: '🧲 初始拾取', per: '+15%', max: 6, cost: l => 30 + l*35 },
    { key: 'gold', name: '💰 金币加成', per: '+20%', max: 5, cost: l => 60 + l*90 },
  ],
  coins() { return parseInt(localStorage.getItem(COINS_KEY) || '0', 10); },
  setCoins(v) { localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(v)))); },
  levels() { try { return JSON.parse(localStorage.getItem(UPG_KEY) || '{}'); } catch (e) { return {}; } },
  lvl(k) { return this.levels()[k] || 0; },
  setLvl(k, v) { const o = this.levels(); o[k] = v; localStorage.setItem(UPG_KEY, JSON.stringify(o)); },
  buy(u) { const l = this.lvl(u.key); if (l >= u.max) return false; const c = u.cost(l); if (this.coins() < c) return false; this.setCoins(this.coins() - c); this.setLvl(u.key, l + 1); return true; },
  applyTo(stats, player) {
    stats.dmg *= (1 + 0.10 * this.lvl('dmg'));
    stats.fireCd *= Math.pow(0.94, this.lvl('fire'));
    stats.moveSpeed *= (1 + 0.06 * this.lvl('spd'));
    stats.pickup *= (1 + 0.15 * this.lvl('mag'));
    player.maxHp += 20 * this.lvl('hp'); player.hp = player.maxHp;
  },
  award(secs, kills) { const c = Math.floor((secs * 1.5 + kills) * (1 + 0.20 * this.lvl('gold'))); this.setCoins(this.coins() + c); return c; },
};

/* ── 分享成绩图(离屏 canvas 画战绩卡 → 微信分享 / 下载) ── */
function makeScoreCard(secs, level, kills, best) {
  const c = document.createElement('canvas'); c.width = 720; c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1020'; x.fillRect(0, 0, 720, 900);
  x.strokeStyle = 'rgba(40,60,100,0.4)'; x.lineWidth = 1;
  for (let i = 60; i < 900; i += 60) { x.beginPath(); x.moveTo(0, i); x.lineTo(720, i); x.stroke(); }
  for (let i = 60; i < 720; i += 60) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 900); x.stroke(); }
  x.textAlign = 'center';
  x.fillStyle = '#9fe07a'; x.font = 'bold 66px sans-serif'; x.fillText('FINGER MOBA', 360, 130);
  x.fillStyle = '#cde'; x.font = '28px sans-serif'; x.fillText('单手幸存 · 我的战绩', 360, 184);
  x.fillStyle = '#f5c84c'; x.font = 'bold 150px sans-serif'; x.fillText(secs + '″', 360, 400);
  x.fillStyle = '#9fbed8'; x.font = '30px sans-serif'; x.fillText('存活时间', 360, 452);
  x.fillStyle = '#fff'; x.font = 'bold 46px sans-serif'; x.fillText('Lv.' + level + '        💀 ' + kills, 360, 552);
  x.fillStyle = '#8aa'; x.font = '26px sans-serif'; x.fillText('🏆 历史最佳 ' + best + ' 秒', 360, 614);
  x.fillStyle = '#1c2b4a'; x.fillRect(110, 700, 500, 92); x.strokeStyle = '#6fd0ff'; x.lineWidth = 3; x.strokeRect(110, 700, 500, 92);
  x.fillStyle = '#6fd0ff'; x.font = 'bold 34px sans-serif'; x.fillText('来 qizh.space/play 挑战我', 360, 758);
  x.fillStyle = '#7a9'; x.font = '23px sans-serif'; x.fillText('微信搜「Zion降噪」· by Zion', 360, 846);
  return c;
}
function shareScore(secs, level, kills, best) {
  const card = makeScoreCard(secs, level, kills, best);
  card.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'fingermoba.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'FingerMOBA 战绩', text: `我在 FingerMOBA 活了 ${secs} 秒,来挑战:qizh.space/play` });
        return;
      }
    } catch (e) { /* 用户取消或不支持 → 落到下载 */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fingermoba-${secs}s.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }, 'image/png');
}
window._makeCard = makeScoreCard; // 便于测试

/* ── 可选英雄(各有起手特性) ── */
const CHARS = [
  { key: 'mage',    name: '🧙 法师', desc: '均衡\n标准弹幕', tint: 0xffffff, apply: (s, p) => {} },
  { key: 'warrior', name: '🛡 战士', desc: '高血近战\n起手带光球', tint: 0xff9a9a, apply: (s, p) => { p.maxHp += 50; p.hp = p.maxHp; s.moveSpeed *= 1.05; s.fireCd *= 1.15; s.orbit = 1; } },
  { key: 'ranger',  name: '🏹 游侠', desc: '快但脆\n起手双发', tint: 0x9affc0, apply: (s, p) => { p.maxHp -= 20; p.hp = p.maxHp; s.moveSpeed *= 1.18; s.projCount = 2; s.fireCd *= 0.9; } },
  { key: 'assassin', name: '🥷 刺客', desc: '极快极脆\n高伤起手', tint: 0xc090ff, apply: (s, p) => { p.maxHp -= 35; p.hp = p.maxHp; s.moveSpeed *= 1.25; s.dmg *= 1.35; s.fireCd *= 0.85; } },
  { key: 'cryo', name: '❄ 冰法', desc: '起手冰霜\n控场流', tint: 0xa0e0ff, apply: (s, p) => { s.frost = 1; s.pickup *= 1.2; p.maxHp += 10; p.hp = p.maxHp; } },
];

/* ── 成就系统(localStorage) ── */
const ACH_KEY = 'fm_ach';
const ACH = {
  defs: [
    { key: 'kill100', name: '初战告捷' }, { key: 'survive120', name: '生存专家' },
    { key: 'survive300', name: '不死之身' }, { key: 'boss1', name: '屠龙者' },
    { key: 'evolve', name: '武器大师' }, { key: 'lv15', name: '登峰造极' },
    { key: 'kill2000', name: '百战之王' }, { key: 'rich1000', name: '小富翁' },
  ],
  got() { try { return JSON.parse(localStorage.getItem(ACH_KEY) || '{}'); } catch (e) { return {}; } },
  has(k) { return !!this.got()[k]; },
  unlock(k) { if (this.has(k)) return false; const o = this.got(); o[k] = 1; localStorage.setItem(ACH_KEY, JSON.stringify(o)); return true; },
  count() { return Object.keys(this.got()).length; },
};

/* ── 浮动虚拟摇杆 ── */
class VirtualJoystick {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.radius = opts.radius ?? 70; this.deadZone = opts.deadZone ?? 0.12; this.depth = opts.depth ?? 12;
    this.followBase = !opts.staticBase;
    this.active = false; this.pointerId = -1;
    this.baseX = 0; this.baseY = 0; this.curX = 0; this.curY = 0; this._vec = { x: 0, y: 0 };
    this.base = scene.add.circle(0, 0, this.radius, 0xffffff, 0.10).setStrokeStyle(3, 0xffffff, 0.35).setDepth(this.depth).setVisible(false).setScrollFactor(0);
    this.thumb = scene.add.circle(0, 0, this.radius * 0.42, 0xffffff, 0.28).setStrokeStyle(2, 0xffffff, 0.7).setDepth(this.depth + 1).setVisible(false).setScrollFactor(0);
    if (scene.input.addPointer) scene.input.addPointer(2);
    scene.input.on('pointerdown', (p) => this._down(p));
    scene.input.on('pointermove', (p) => this._move(p));
    scene.input.on('pointerup', (p) => this._up(p));
    scene.input.on('pointerupoutside', (p) => this._up(p));
    scene.input.on('pointercancel', (p) => this._up(p));
    scene.input.on('gameout', () => this._release());
  }
  canStart() { return !(this.scene.paused || this.scene.over); }
  _down(p) {
    if (!this.canStart()) return;   // last-touch-wins:总是抢占,避免丢失 pointerup 卡死("划不到")
    this.active = true; this.pointerId = p.id;
    this.baseX = this.curX = p.worldX; this.baseY = this.curY = p.worldY;
    this.base.setPosition(this.baseX, this.baseY).setVisible(true);
    this.thumb.setPosition(this.baseX, this.baseY).setVisible(true);
    this._recompute();
  }
  _move(p) { if (this.active && p.id === this.pointerId) { this.curX = p.worldX; this.curY = p.worldY; this._recompute(); } }
  _up(p) { if (this.active && p.id === this.pointerId) this._release(); }
  _release() { this.active = false; this.pointerId = -1; this._vec.x = 0; this._vec.y = 0; this.base.setVisible(false); this.thumb.setVisible(false); }
  _recompute() {
    let dx = this.curX - this.baseX, dy = this.curY - this.baseY, dist = Math.hypot(dx, dy);
    const R = this.radius;
    if (dist > R) {
      if (this.followBase) { const over = dist - R; this.baseX += (dx / dist) * over; this.baseY += (dy / dist) * over; this.base.setPosition(this.baseX, this.baseY); dx = this.curX - this.baseX; dy = this.curY - this.baseY; dist = R; }
      else { dx = (dx / dist) * R; dy = (dy / dist) * R; dist = R; }
    }
    this.thumb.setPosition(this.baseX + dx, this.baseY + dy);
    let mag = dist / R;
    if (mag < this.deadZone || dist === 0) { this._vec.x = 0; this._vec.y = 0; return; }
    mag = (mag - this.deadZone) / (1 - this.deadZone);
    this._vec.x = (dx / dist) * mag; this._vec.y = (dy / dist) * mag;
  }
  get vector() { return this._vec; }
}

/* ── 资源预载 ── */
class Boot extends Phaser.Scene {
  constructor() { super('boot'); }
  preload() { for (const k of SPRITES) this.load.svg(k, `sprites/${k}.svg`, { width: RASTER, height: RASTER }); }
  create() { const b = document.getElementById('boot'); if (b) b.remove(); this.scene.start('title'); }
}

/* ── 标题/开始页(也是第一印象 + 品牌引流) ── */
class Title extends Phaser.Scene {
  constructor() { super('title'); }
  create() {
    this.add.rectangle(W/2, H/2, W, H, 0x0b1020);
    for (let gy = 60; gy < H; gy += 60) this.add.rectangle(W/2, gy, W, 1, 0x16203a);
    this.add.image(W/2, H*0.20, 'hero').setDisplaySize(100, 100);
    mkText(this, W/2, H*0.31, 'FINGER MOBA', { fontSize: '50px', color: '#9fe07a', fontStyle: 'bold' }).setOrigin(0.5);
    mkText(this, W/2, H*0.355, '单手幸存 · 怪潮中活到最后', { fontSize: '16px', color: '#cde' }).setOrigin(0.5);
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    mkText(this, W/2, H*0.405, `💰 ${META.coins()}      🏅 成就 ${ACH.count()}/${ACH.defs.length}`, { fontSize: '15px', color: '#f5c84c' }).setOrigin(0.5);
    if (best > 0) mkText(this, W/2, H*0.44, `🏆 最佳存活 ${best} 秒`, { fontSize: '13px', color: '#9fbed8' }).setOrigin(0.5);

    const playBtn = this.add.rectangle(W/2, H*0.585, 264, 76, 0x2f7fd0).setStrokeStyle(3, 0xffffff).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H*0.585, '▶  选择英雄开始', { fontSize: '26px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
    playBtn.on('pointerover', () => playBtn.setScale(1.05)); playBtn.on('pointerout', () => playBtn.setScale(1));
    const toSelect = () => { SFX.init(); this.scene.start('select'); };
    playBtn.on('pointerup', toSelect);
    this.input.keyboard.once('keydown', toSelect);

    const shop = this.add.rectangle(W/2, H*0.69, 240, 50, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H*0.69, '🛒 永久升级商店', { fontSize: '19px', color: '#cfe' }).setOrigin(0.5);
    shop.on('pointerover', () => shop.setScale(1.04)); shop.on('pointerout', () => shop.setScale(1));
    shop.on('pointerup', () => { SFX.init(); this.scene.start('shop'); });

    mkText(this, W/2, H*0.84, '拖动屏幕任意处移动 · 桌面 WASD · 自动开火', { fontSize: '12px', color: '#7a9' }).setOrigin(0.5);
    const link = mkText(this, W/2, H-40, 'by Zion · qizh.space ↗', { fontSize: '13px', color: '#6fd0ff' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    link.on('pointerup', () => window.open(HUB_URL, '_blank'));
  }
}

/* ── 英雄选择(独立页,支持扩充阵容) ── */
class CharSelect extends Phaser.Scene {
  constructor() { super('select'); }
  create() {
    this.add.rectangle(W/2, H/2, W, H, 0x0b1020);
    for (let gy = 60; gy < H; gy += 60) this.add.rectangle(W/2, gy, W, 1, 0x16203a);
    mkText(this, W/2, 70, '选择英雄', { fontSize: '34px', color: '#9fe07a', fontStyle: 'bold' }).setOrigin(0.5);
    CHARS.forEach((c, i) => {
      const cx = W/2 + ((i % 2) ? 92 : -92), cy = 180 + Math.floor(i/2)*152;
      const card = this.add.rectangle(cx, cy, 172, 130, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
      this.add.image(cx, cy-32, 'hero').setDisplaySize(46, 46).setTint(c.tint);
      mkText(this, cx, cy+18, c.name, { fontSize: '19px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      mkText(this, cx, cy+46, c.desc, { fontSize: '11px', color: '#9fbed8', align: 'center' }).setOrigin(0.5);
      card.on('pointerover', () => card.setScale(1.04)); card.on('pointerout', () => card.setScale(1));
      card.on('pointerup', () => { SFX.init(); this.scene.start('game', { char: c.key }); });
    });
    const back = this.add.rectangle(W/2, H-60, 200, 54, 0x244).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H-60, '← 返回', { fontSize: '22px', color: '#fff' }).setOrigin(0.5);
    back.on('pointerup', () => this.scene.start('title'));
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('title'));
  }
}

/* ── 商店:用金币买永久强化 ── */
class Shop extends Phaser.Scene {
  constructor() { super('shop'); }
  create() {
    this.add.rectangle(W/2, H/2, W, H, 0x0b1020);
    for (let gy = 60; gy < H; gy += 60) this.add.rectangle(W/2, gy, W, 1, 0x16203a);
    mkText(this, W/2, 54, '🛒 永久升级', { fontSize: '32px', color: '#9fe07a', fontStyle: 'bold' }).setOrigin(0.5);
    this.coinText = mkText(this, W/2, 100, '', { fontSize: '22px', color: '#f5c84c' }).setOrigin(0.5);
    mkText(this, W/2, 132, '金币来自每局战绩(存活时间 + 击杀),死了也算', { fontSize: '12px', color: '#7a9' }).setOrigin(0.5);
    this.rows = [];
    META.upgrades.forEach((u, i) => {
      const y = 192 + i * 96;
      this.add.rectangle(W/2, y, W-44, 84, 0x141d33).setStrokeStyle(1, 0x2a3a55);
      mkText(this, 38, y-17, u.name, { fontSize: '19px', color: '#fff' }).setOrigin(0, 0.5);
      const lvT = mkText(this, 38, y+15, '', { fontSize: '13px', color: '#9fbed8' }).setOrigin(0, 0.5);
      const btn = this.add.rectangle(W-98, y, 126, 54, 0x2f7fd0).setInteractive({ useHandCursor: true });
      const btnT = mkText(this, W-98, y, '', { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      btn.on('pointerover', () => btn.setScale(1.04)); btn.on('pointerout', () => btn.setScale(1));
      btn.on('pointerup', () => { if (META.buy(u)) SFX.level(); else this.cameras.main.shake(120, 0.004); this.refresh(); });
      this.rows.push({ u, lvT, btn, btnT });
    });
    const back = this.add.rectangle(W/2, H-64, 200, 58, 0x244).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H-64, '← 返回', { fontSize: '22px', color: '#fff' }).setOrigin(0.5);
    back.on('pointerover', () => back.setScale(1.04)); back.on('pointerout', () => back.setScale(1));
    back.on('pointerup', () => this.scene.start('title'));
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('title'));
    this.refresh();
  }
  refresh() {
    this.coinText.setText('💰 ' + META.coins());
    for (const r of this.rows) {
      const lv = META.lvl(r.u.key), maxed = lv >= r.u.max;
      r.lvT.setText(`Lv.${lv}/${r.u.max}   每级 ${r.u.per}`);
      if (maxed) { r.btnT.setText('已满级'); r.btn.setFillStyle(0x3a3a3a); }
      else { const c = r.u.cost(lv); r.btnT.setText('💰 ' + c); r.btn.setFillStyle(META.coins() >= c ? 0x2f7fd0 : 0x55304a); }
    }
  }
}

class Game extends Phaser.Scene {
  constructor() { super('game'); }

  create() {
    this.over = false; this.paused = false;
    this.enemies = []; this.projs = []; this.gems = []; this.orbiters = []; this.ebullets = [];
    this.elapsed = 0; this.kills = 0; this.level = 1; this.xp = 0; this.xpNeed = 5;
    this.fireT = 0; this.spawnT = 0.5; this.hurtCd = 0;
    this.bossT = 50; this.boss = null; this.auraObj = null; this.auraT = 0;
    this.boltEvolved = false; this.orbEvolved = false; this.auraEvolved = false; this.leveling = false;
    this.chainT = 0; this.chainEvolved = false; this.frostT = 0; this.frostEvolved = false;
    this.booms = []; this.boomT = 0; this.boomEvolved = false;
    this.stats = { dmg: 16, fireCd: 0.55, projSpeed: 540, projCount: 1, pierce: 0, moveSpeed: 235, pickup: 78, orbit: 0, aura: 0, chain: 0, frost: 0, boom: 0, crit: 0.05, critMul: 2.0 };

    this.add.rectangle(W/2, H/2, W, H, 0x0b1020).setDepth(-2);
    this.stars = []; // 动态星空背景(替代扁平网格)
    for (let i = 0; i < 56; i++) { const s = this.add.circle(Math.random()*W, Math.random()*H, Math.random() < 0.3 ? 1.7 : 1, 0x4a5a8a, 0.55).setDepth(-1); s.vy = 8 + Math.random()*24; this.stars.push(s); }
    this.floatN = 0; this.musicT = 0; this._toastN = 0; this.chests = []; this.chestT = 30; this.biome = 0; this.biomeT = 60; this.combo = 0; this.comboT = 0;

    this.player = { x: W/2, y: H/2, r: 17, hp: 100, maxHp: 100 };
    this.player.obj = this.add.image(this.player.x, this.player.y, 'hero').setDepth(5).setDisplaySize(48, 48);
    const ch = CHARS.find(c => c.key === ((this.scene.settings.data && this.scene.settings.data.char) || 'mage')) || CHARS[0];
    ch.apply(this.stats, this.player); this.player.obj.setTint(ch.tint); // 英雄起手特性
    META.applyTo(this.stats, this.player); // 局外永久强化
    this.syncOrbiters();                   // 战士起手光球

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());
    this.stick = new VirtualJoystick(this, { radius: 70, deadZone: 0.12, depth: 12 });

    this.makeHUD();
  }

  update(_t, dms) {
    if (this.over || this.paused) return;
    const dt = Math.min(dms, 50) / 1000;
    this.elapsed += dt; this.hurtCd -= dt;
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    this.musicT -= dt; if (this.musicT <= 0) { this.musicT = 0.28; SFX.beat(); }
    this.updateStars(dt);
    this.moverPlayer(dt); this.spawn(dt); this.moveEnemies(dt); this.updateOrbiters(dt); this.updateAura(dt); this.updateChain(dt); this.updateFrost(dt); this.updateBooms(dt); this.updateBiome(dt);
    this.fire(dt); this.moveProjs(dt); this.moveGems(dt); this.updateEbullets(dt); this.updateChests(); this.updateHUD();
  }

  // ---------- 打击感小工具 ----------
  burst(x, y, color, n) {
    for (let i = 0; i < (n || 6); i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
      const d = this.add.circle(x, y, 2 + Math.random() * 2, color).setDepth(6);
      this.tweens.add({ targets: d, x: x + Math.cos(a) * sp, y: y + Math.sin(a) * sp, alpha: 0, scale: 0.2, duration: 280 + Math.random() * 160, onComplete: () => d.destroy() });
    }
  }
  ring(x, y, color, r) {
    const c = this.add.circle(x, y, 8, color, 0).setStrokeStyle(3, color, 0.9).setDepth(6);
    this.tweens.add({ targets: c, scale: (r || 80) / 8, alpha: 0, duration: 340, onComplete: () => c.destroy() });
  }
  updateStars(dt) {
    for (const s of this.stars) { s.y += s.vy * dt; if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; } }
  }
  floatText(x, y, txt, color, big) { // 漂浮伤害数字(并发上限,防刷屏;暴击更大)
    if (this.floatN >= 22) return;
    this.floatN++;
    const t = mkText(this, x, y, txt, { fontSize: big ? '22px' : '15px', color: color || '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: big ? 600 : 480, onComplete: () => { t.destroy(); this.floatN--; } });
  }
  banner(text, color) { // 居中横幅(进化/宝箱)
    this.cameras.main.shake(180, 0.005);
    const t = mkText(this, W/2, H*0.34, text, { fontSize: '24px', color: color || '#f5c84c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(16);
    this.tweens.add({ targets: t, scale: 1.15, alpha: 0, y: H*0.29, duration: 1600, onComplete: () => t.destroy() });
  }
  upgradePool() {
    return [
      { t: '⚔ 伤害 +25%', f: () => this.stats.dmg *= 1.25 },
      { t: '🔥 攻速 +20%', f: () => this.stats.fireCd *= 0.82 },
      { t: '➕ 多一发子弹', f: () => this.stats.projCount += 1 },
      { t: '🏃 移速 +12%', f: () => this.stats.moveSpeed *= 1.12 },
      { t: '❤ 上限+25 并回满', f: () => { this.player.maxHp += 25; this.player.hp = this.player.maxHp; } },
      { t: '🧲 拾取范围 +40%', f: () => this.stats.pickup *= 1.4 },
      { t: '🎯 子弹穿透 +1', f: () => this.stats.pierce += 1 },
      { t: '💥 暴击率 +8%', f: () => this.stats.crit += 0.08 },
      { t: '🛡 环绕光球 +1', f: () => { this.stats.orbit += 1; this.syncOrbiters(); } },
      { t: '🌀 伤害光环 +1', f: () => { this.stats.aura += 1; } },
      { t: '⚡ 闪电链 +1', f: () => { this.stats.chain += 1; } },
      { t: '❄ 冰霜新星 +1', f: () => { this.stats.frost += 1; } },
      { t: '🪃 回旋镖 +1', f: () => { this.stats.boom += 1; } },
    ];
  }
  spawnChest(px, py) {
    const x = (px === undefined) ? 60 + Math.random()*(W-120) : px;
    const y = (py === undefined) ? 130 + Math.random()*(H-280) : py;
    const obj = this.add.image(x, y, 'gem').setTint(0xffd23a).setDisplaySize(32, 32).setDepth(2);
    this.tweens.add({ targets: obj, scale: obj.scale*1.18, duration: 500, yoyo: true, repeat: -1 });
    this.chests.push({ x, y, obj });
  }
  updateChests() {
    for (const c of this.chests) {
      if (Phaser.Math.Distance.Between(c.x, c.y, this.player.x, this.player.y) < this.player.r + 20) {
        c.got = true;
        const u = Phaser.Utils.Array.GetRandom(this.upgradePool());
        u.f(); this.checkEvolutions(); SFX.level();
        this.banner('🎁 宝箱:' + u.t, '#ffd23a');
      }
    }
    this.chests = this.chests.filter(c => { if (c.got) c.obj.destroy(); return !c.got; });
  }
  tryAch(key) { if (ACH.unlock(key)) { const d = ACH.defs.find(a => a.key === key); this.achToast(d ? d.name : key); SFX.level(); } }
  achToast(name) { // 成就解锁横幅
    const y = 118 + this._toastN * 42; this._toastN++;
    const bg = this.add.rectangle(W/2, y, 300, 36, 0x1c2b4a, 0.96).setStrokeStyle(2, 0xf5c84c).setDepth(28).setAlpha(0);
    const t = mkText(this, W/2, y, '🏅 成就解锁:' + name, { fontSize: '15px', color: '#f5c84c' }).setOrigin(0.5).setDepth(29).setAlpha(0);
    this.tweens.add({ targets: [bg, t], alpha: 1, duration: 200 });
    this.time.delayedCall(2200, () => { this.tweens.add({ targets: [bg, t], alpha: 0, duration: 400, onComplete: () => { bg.destroy(); t.destroy(); this._toastN = Math.max(0, this._toastN - 1); } }); });
  }

  // ---------- 玩家 ----------
  moverPlayer(dt) {
    const p = this.player; let vx = 0, vy = 0, k = this.keys;
    if (k.A.isDown || k.LEFT.isDown) vx -= 1;
    if (k.D.isDown || k.RIGHT.isDown) vx += 1;
    if (k.W.isDown || k.UP.isDown) vy -= 1;
    if (k.S.isDown || k.DOWN.isDown) vy += 1;
    if (!vx && !vy) { const jv = this.stick.vector; vx = jv.x; vy = jv.y; }
    if (vx || vy) {
      const l = Math.hypot(vx, vy), speed = Math.min(l, 1) * this.stats.moveSpeed;
      p.x += (vx/l)*speed*dt; p.y += (vy/l)*speed*dt; p.obj.setFlipX(vx < 0);
    }
    p.x = Phaser.Math.Clamp(p.x, 16, W-16); p.y = Phaser.Math.Clamp(p.y, 44, H-14);
    p.obj.x = p.x; p.obj.y = p.y;
  }

  // ---------- 敌人 ----------
  spawn(dt) {
    this.bossT -= dt;
    if (this.bossT <= 0 && !this.boss) { this.spawnEnemy('boss'); this.bossT = 50; }
    this.chestT -= dt;
    if (this.chestT <= 0) { this.spawnChest(); this.chestT = 34; }
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.enemies.length > 140) return;
    this.spawnT = Math.max(0.34, 1.55 - this.elapsed * 0.011);
    const n = Math.min(6, 1 + Math.floor(this.elapsed / 34)); // 封顶波数:后期可玩 + 保帧率
    for (let i = 0; i < n; i++) {
      const r = Math.random(); let type = 'basic';
      if (this.elapsed > 30 && r < 0.10) type = 'tank';
      else if (this.elapsed > 35 && r < 0.22) type = 'splitter';
      else if (this.elapsed > 25 && r < 0.36) type = 'shooter';
      else if (this.elapsed > 15 && r < 0.52) type = 'fast';
      this.spawnEnemy(type);
    }
  }
  spawnEnemy(type) {
    const edge = Math.floor(Math.random()*4); let x, y;
    if (edge === 0) { x = Math.random()*W; y = -20; }
    else if (edge === 1) { x = Math.random()*W; y = H+20; }
    else if (edge === 2) { x = -20; y = Math.random()*H; }
    else { x = W+20; y = Math.random()*H; }
    this.addEnemy(type, x, y);
  }
  addEnemy(type, x, y) {
    const hp0 = 14 + this.elapsed * 1.1 + this.elapsed * this.elapsed * 0.010; // 后期二次增长,保持挑战
    let e;
    if (type === 'boss') e = { type, r: 46, hp: hp0*36, maxHp: hp0*36, speed: 34 + this.elapsed*0.12, dmg: 30, xp: 30, sprite: 'enemy_tank', col: 0xc060ff };
    else if (type === 'tank') e = { type, r: 24, hp: hp0*6, maxHp: hp0*6, speed: 42 + this.elapsed*0.25, dmg: 22, xp: 5, sprite: 'enemy_tank', col: 0x8fb0c0 };
    else if (type === 'shooter') e = { type, r: 13, hp: hp0*1.4, maxHp: hp0*1.4, speed: 48 + this.elapsed*0.3, dmg: 8, xp: 2, sprite: 'enemy_fast', col: 0xffb060, fireT: 1.5 };
    else if (type === 'splitter') e = { type, r: 16, hp: hp0*1.2, maxHp: hp0*1.2, speed: 50 + this.elapsed*0.4, dmg: 12, xp: 2, sprite: 'enemy_basic', col: 0xe0e060, splits: true };
    else if (type === 'mini') e = { type, r: 8, hp: hp0*0.4, maxHp: hp0*0.4, speed: 80 + this.elapsed*0.4, dmg: 7, xp: 1, sprite: 'enemy_basic', col: 0x7be86a };
    else if (type === 'fast') e = { type, r: 11, hp: hp0*0.55, maxHp: hp0*0.55, speed: 95 + this.elapsed*0.5, dmg: 9, xp: 1, sprite: 'enemy_fast', col: 0xff7a9c };
    else e = { type, r: 14, hp: hp0, maxHp: hp0, speed: 56 + this.elapsed*0.5, dmg: 12, xp: 1, sprite: 'enemy_basic', col: 0x7be86a };
    e.x = x; e.y = y; e.orbCd = 0; e.slowT = 0; e.speed = Math.min(e.speed, type === 'fast' ? 185 : 150);
    e.obj = this.add.image(x, y, e.sprite).setDepth(3).setDisplaySize(e.r*2.8, e.r*2.8);
    if (type === 'shooter') e.obj.setTint(0xffb060);
    if (type === 'splitter') e.obj.setTint(0xe0e060);
    if (type === 'boss') {
      this.boss = e; e.abilityT = 5; e.obj.setTint(0xc060ff); this.cameras.main.shake(220, 0.008);
      const t = mkText(this, W/2, H/2, '👹 BOSS 来袭!', { fontSize: '30px', color: '#e0a0ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets: t, alpha: 0, y: H/2-50, duration: 1300, onComplete: () => t.destroy() });
    } else if (type !== 'mini' && this.elapsed > 25 && Math.random() < 0.025) { // 精英怪:金色强化,必爆宝箱
      e.elite = true; e.hp *= 3; e.maxHp *= 3; e.xp *= 4; e.r *= 1.4;
      e.obj.setDisplaySize(e.r*2.8, e.r*2.8).setTint(0xffd700);
    }
    this.enemies.push(e);
    return e;
  }
  enemyShoot(e, angle) {
    const obj = this.add.image(e.x, e.y, 'projectile').setDepth(4).setDisplaySize(17, 17).setTint(0xff6060);
    obj.rotation = angle;
    this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*250, vy: Math.sin(angle)*250, life: 3, dmg: 8, obj });
  }
  updateEbullets(dt) {
    const p = this.player;
    for (const b of this.ebullets) {
      b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt; b.obj.x = b.x; b.obj.y = b.y;
      if (b.life <= 0 || b.x < -30 || b.x > W+30 || b.y < -30 || b.y > H+30) { b.dead = true; continue; }
      if (Phaser.Math.Distance.Between(b.x, b.y, p.x, p.y) < p.r + 6) {
        b.dead = true; p.hp -= b.dmg;
        if (this.hurtCd <= 0) { this.cameras.main.shake(120, 0.006); SFX.hurt(); p.obj.setTint(0xff6666); this.time.delayedCall(110, () => { if (p.obj.active) p.obj.clearTint(); }); this.hurtCd = 0.45; }
        if (p.hp <= 0) { this.end(); break; }
      }
    }
    this.ebullets = this.ebullets.filter(b => { if (b.dead) b.obj.destroy(); return !b.dead; });
  }
  moveEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.orbCd > 0) e.orbCd -= dt;
      let sp = e.speed; if (e.slowT > 0) { e.slowT -= dt; sp *= 0.5; } // 奥能风暴减速
      const d = Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y);
      const a = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
      if (e.type === 'shooter') {                 // 远程射手:拉开距离 + 射击
        if (d > 220) { e.x += Math.cos(a)*sp*dt; e.y += Math.sin(a)*sp*dt; }
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 430) { this.enemyShoot(e, a); e.fireT = 1.8; }
      } else {
        e.x += Math.cos(a)*sp*dt; e.y += Math.sin(a)*sp*dt;
      }
      if (e === this.boss) {                       // Boss 技能:周期召唤
        e.abilityT -= dt;
        if (e.abilityT <= 0) { e.abilityT = 6; this.ring(e.x, e.y, 0xc060ff, 80); for (let k = 0; k < 2; k++) this.addEnemy('basic', e.x + (Math.random()-0.5)*60, e.y + (Math.random()-0.5)*60); }
      }
      e.obj.x = e.x; e.obj.y = e.y;
      if (d < e.r + p.r) {
        this.player.hp -= e.dmg * (1 + this.elapsed / 200) * dt;
        if (this.hurtCd <= 0) { this.cameras.main.shake(120, 0.006); SFX.hurt(); this.player.obj.setTint(0xff6666); this.time.delayedCall(110, () => { if (this.player.obj.active) this.player.obj.clearTint(); }); this.hurtCd = 0.45; }
        if (this.player.hp <= 0) return this.end();
      }
    }
  }

  // ---------- 开火 ----------
  fire(dt) {
    this.fireT -= dt;
    if (this.fireT > 0 || this.enemies.length === 0) return;
    this.fireT = this.stats.fireCd;
    const tgt = this.nearest(this.player.x, this.player.y);
    if (!tgt) return;
    const base = Phaser.Math.Angle.Between(this.player.x, this.player.y, tgt.x, tgt.y);
    const n = this.stats.projCount + (this.boltEvolved ? 2 : 0);     // 进化:多重散射
    const spread = this.boltEvolved ? 0.26 : 0.18;
    const pdmg = this.stats.dmg * (this.boltEvolved ? 1.4 : 1);
    const psz = this.boltEvolved ? 26 : 20;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n-1)/2) * spread;
      const obj = this.add.image(this.player.x, this.player.y, 'projectile').setDepth(4).setDisplaySize(psz, psz);
      if (this.boltEvolved) obj.setTint(0xfff0a0);
      obj.rotation = a;
      this.projs.push({ x: this.player.x, y: this.player.y, vx: Math.cos(a)*this.stats.projSpeed, vy: Math.sin(a)*this.stats.projSpeed, life: 2.6, pierce: this.stats.pierce, dmg: pdmg, obj });
    }
  }
  nearest(x, y) { let best = null, bd = 1e9; for (const e of this.enemies) { const d = Phaser.Math.Distance.Between(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } } return best; }

  // ---------- 环绕光球(近战武器) ----------
  syncOrbiters() {
    while (this.orbiters.length < this.stats.orbit) {
      const o = this.add.image(this.player.x, this.player.y, 'projectile').setDepth(4).setDisplaySize(26, 26).setTint(0x9fe0ff);
      if (this.orbEvolved) o.setDisplaySize(34, 34).setTint(0xfff0a0);
      this.orbiters.push(o);
    }
  }
  updateOrbiters(dt) {
    const n = this.orbiters.length; if (!n) return;
    const baseA = this.elapsed * (this.orbEvolved ? 3.4 : 2.6), R = this.orbEvolved ? 92 : 70;
    for (let i = 0; i < n; i++) {
      const a = baseA + i * (Math.PI * 2 / n);
      const ox = this.player.x + Math.cos(a)*R, oy = this.player.y + Math.sin(a)*R;
      const o = this.orbiters[i]; o.x = ox; o.y = oy; o.rotation += 0.25;
      for (const e of this.enemies) {
        if (e.dead || e.orbCd > 0) continue;
        if (Phaser.Math.Distance.Between(ox, oy, e.x, e.y) < e.r + 13) {
          e.hp -= this.stats.dmg * (this.orbEvolved ? 1.0 : 0.6); e.orbCd = 0.35;
          e.obj.setTintFill(0xffffff); this.time.delayedCall(50, () => { if (e.obj && e.obj.active && !e.dead) e.obj.clearTint(); });
          if (e.hp <= 0) this.killEnemy(e);
        }
      }
    }
  }
  // ---------- 伤害光环(范围武器) ----------
  updateAura(dt) {
    if (this.stats.aura <= 0) return;
    const R = (56 + this.stats.aura * 22) * (this.auraEvolved ? 1.4 : 1); // 进化:奥能风暴(更大+减速)
    if (!this.auraObj) this.auraObj = this.add.circle(this.player.x, this.player.y, R, 0x6fd0ff, 0.12).setStrokeStyle(2, 0x6fd0ff, 0.4).setDepth(1);
    this.auraObj.setRadius(R); this.auraObj.x = this.player.x; this.auraObj.y = this.player.y;
    this.auraT -= dt;
    if (this.auraT <= 0) {
      this.auraT = this.auraEvolved ? 0.2 : 0.3;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < R + e.r) {
          e.hp -= this.stats.dmg * 0.35 * this.stats.aura * (this.auraEvolved ? 1.6 : 1);
          if (this.auraEvolved) e.slowT = 0.25;
          if (e.hp <= 0) this.killEnemy(e);
        }
      }
    }
  }
  // ---------- 闪电链(自动跳跃武器) ----------
  zapLine(x1, y1, x2, y2) {
    const g = this.add.graphics().setDepth(4); g.lineStyle(3, 0x9fe0ff, 0.9);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 150, onComplete: () => g.destroy() });
  }
  updateChain(dt) {
    if (this.stats.chain <= 0) return;
    this.chainT -= dt;
    if (this.chainT > 0 || this.enemies.length === 0) return;
    this.chainT = this.chainEvolved ? 0.6 : 0.9;
    const jumps = this.stats.chain + 1 + (this.chainEvolved ? 2 : 0);
    const hit = new Set(); let last = { x: this.player.x, y: this.player.y };
    for (let j = 0; j < jumps; j++) {
      let best = null, bd = 230;
      for (const e of this.enemies) { if (e.dead || hit.has(e)) continue; const d = Phaser.Math.Distance.Between(last.x, last.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (!best) break;
      hit.add(best);
      best.hp -= this.stats.dmg * 0.8 * (this.chainEvolved ? 1.5 : 1);
      this.zapLine(last.x, last.y, best.x, best.y);
      best.obj.setTintFill(0xaaddff); this.time.delayedCall(70, () => { if (best.obj && best.obj.active && !best.dead) best.obj.clearTint(); });
      last = { x: best.x, y: best.y };
      if (best.hp <= 0) this.killEnemy(best);
    }
  }
  // ---------- 回旋镖(飞出再飞回,来回切割) ----------
  throwBooms() {
    const n = this.stats.boom, tgt = this.nearest(this.player.x, this.player.y);
    const base = tgt ? Phaser.Math.Angle.Between(this.player.x, this.player.y, tgt.x, tgt.y) : 0;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n-1)/2) * 0.5;
      const obj = this.add.image(this.player.x, this.player.y, 'projectile').setDepth(4).setDisplaySize(this.boomEvolved ? 30 : 24, this.boomEvolved ? 30 : 24).setTint(0x80ffd0);
      this.booms.push({ x: this.player.x, y: this.player.y, a, t: 0, phase: 0, hit: new Set(), obj, dmg: this.stats.dmg * (this.boomEvolved ? 1.5 : 0.9) });
    }
  }
  updateBooms(dt) {
    if (this.stats.boom > 0) { this.boomT -= dt; if (this.boomT <= 0) { this.boomT = this.boomEvolved ? 1.0 : 1.6; this.throwBooms(); } }
    const SP = 340, OUT = 0.5;
    for (const b of this.booms) {
      b.t += dt; b.obj.rotation += 0.5;
      if (b.t < OUT) { b.x += Math.cos(b.a)*SP*dt; b.y += Math.sin(b.a)*SP*dt; }
      else {
        if (b.phase === 0) { b.phase = 1; b.hit.clear(); }
        const ra = Phaser.Math.Angle.Between(b.x, b.y, this.player.x, this.player.y);
        b.x += Math.cos(ra)*SP*1.2*dt; b.y += Math.sin(ra)*SP*1.2*dt;
        if (Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) < 22 || b.t > 2.2) b.dead = true;
      }
      b.obj.x = b.x; b.obj.y = b.y;
      for (const e of this.enemies) {
        if (e.dead || b.hit.has(e)) continue;
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < e.r + 14) {
          b.hit.add(e); e.hp -= b.dmg;
          this.floatText(e.x, e.y - e.r, '' + Math.round(b.dmg), '#80ffd0');
          if (e.hp <= 0) this.killEnemy(e);
        }
      }
    }
    this.booms = this.booms.filter(b => { if (b.dead) b.obj.destroy(); return !b.dead; });
  }
  // ---------- 冰霜新星(周期 AoE + 减速) ----------
  updateFrost(dt) {
    if (this.stats.frost <= 0) return;
    this.frostT -= dt;
    if (this.frostT > 0) return;
    this.frostT = this.frostEvolved ? 1.5 : 2.4;
    const R = (90 + this.stats.frost * 30) * (this.frostEvolved ? 1.4 : 1);
    this.ring(this.player.x, this.player.y, this.frostEvolved ? 0xb0e0ff : 0x9fe0ff, R);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < R + e.r) {
        e.hp -= this.stats.dmg * 0.5 * this.stats.frost * (this.frostEvolved ? 1.6 : 1);
        e.slowT = this.frostEvolved ? 0.8 : 0.45;
        if (e.hp <= 0) this.killEnemy(e);
      }
    }
  }
  // ---------- 生物群系切换(视觉变化 + 进度感) ----------
  updateBiome(dt) {
    this.biomeT -= dt;
    if (this.biomeT > 0) return;
    this.biomeT = 60; this.biome++;
    const cols = [0x4a5a8a, 0x6a4a8a, 0x4a6a5a, 0x8a5a4a, 0x5a5aa0];
    const c = cols[this.biome % cols.length];
    for (const s of this.stars) s.setFillStyle(c, 0.55);
    this.banner('🌌 进入新区域', '#9fe0ff');
  }
  // ---------- 武器进化 ----------
  checkEvolutions() {
    if (!this.boltEvolved && this.stats.projCount >= 5 && this.stats.pierce >= 2) { this.boltEvolved = true; this.evolveBanner('多重散射弹'); }
    if (!this.orbEvolved && this.stats.orbit >= 4) { this.orbEvolved = true; this.orbiters.forEach(o => o.setDisplaySize(34, 34).setTint(0xfff0a0)); this.evolveBanner('光刃环'); }
    if (!this.auraEvolved && this.stats.aura >= 4) { this.auraEvolved = true; if (this.auraObj) this.auraObj.setFillStyle(0xc0a0ff, 0.16); this.evolveBanner('奥能风暴'); }
    if (!this.chainEvolved && this.stats.chain >= 4) { this.chainEvolved = true; this.evolveBanner('连锁风暴'); }
    if (!this.frostEvolved && this.stats.frost >= 4) { this.frostEvolved = true; this.evolveBanner('暴风雪'); }
    if (!this.boomEvolved && this.stats.boom >= 4) { this.boomEvolved = true; this.evolveBanner('环切飞轮'); }
  }
  evolveBanner(name) {
    this.tryAch('evolve'); SFX.level();
    this.banner(`⚡ 武器进化:${name}!`, '#f5c84c');
  }
  moveProjs(dt) {
    for (const pr of this.projs) {
      pr.x += pr.vx*dt; pr.y += pr.vy*dt; pr.life -= dt; pr.obj.x = pr.x; pr.obj.y = pr.y;
      if (pr.life <= 0 || pr.x < -30 || pr.x > W+30 || pr.y < -30 || pr.y > H+30) { pr.dead = true; continue; }
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Phaser.Math.Distance.Between(pr.x, pr.y, e.x, e.y) < e.r + 6) {
          const crit = Math.random() < this.stats.crit;
          const dmg = pr.dmg * (crit ? this.stats.critMul : 1);
          e.hp -= dmg;
          e.obj.setTintFill(0xffffff);
          this.time.delayedCall(60, () => { if (e.obj && e.obj.active && !e.dead) e.obj.clearTint(); });
          this.floatText(e.x, e.y - e.r, '' + Math.round(dmg), crit ? '#ffd23a' : (this.boltEvolved ? '#fff0a0' : '#ffffff'), crit);
          const ka = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y); // 受击击退,打击更实
          e.x += Math.cos(ka) * 6; e.y += Math.sin(ka) * 6;
          if (e.hp <= 0) this.killEnemy(e);
          if (pr.pierce > 0) pr.pierce--; else { pr.dead = true; }
          break;
        }
      }
    }
    this.projs = this.projs.filter(pr => { if (pr.dead) pr.obj.destroy(); return !pr.dead; });
  }
  dropGem(x, y, xp, big) {
    const g = this.add.image(x, y, 'gem').setDepth(2).setDisplaySize(big ? 28 : 18, big ? 28 : 18);
    this.gems.push({ x, y, xp, obj: g });
  }
  killEnemy(e) {
    if (e.dead) return;
    e.dead = true; this.kills++;
    this.combo++; this.comboT = 2.0;
    if (this.combo === 25 || this.combo === 50 || this.combo === 100 || this.combo === 200) { this.banner('🔥 连杀 x' + this.combo + '!', '#ff9a40'); this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10); }
    this.burst(e.x, e.y, e.col, (e.type === 'tank' || e.type === 'boss') ? 12 : 6); SFX.kill();
    if (e.splits) { for (let k = 0; k < 2; k++) this.addEnemy('mini', e.x + (Math.random()-0.5)*30, e.y + (Math.random()-0.5)*30); } // 分裂怪
    if (e.elite) { this.spawnChest(e.x, e.y); this.burst(e.x, e.y, 0xffd700, 14); } // 精英怪必爆宝箱
    if (this.kills === 100) this.tryAch('kill100');
    if (e === this.boss) {
      this.boss = null; this.cameras.main.shake(300, 0.013); this.ring(e.x, e.y, 0xc060ff, 190); SFX.level();
      this.tryAch('boss1');
      for (let k = 0; k < 6; k++) { const a = k/6*Math.PI*2; this.dropGem(e.x+Math.cos(a)*34, e.y+Math.sin(a)*34, 5, true); }
    } else {
      this.dropGem(e.x, e.y, e.xp, e.type === 'tank');
    }
    e.obj.destroy();
    this.enemies = this.enemies.filter(en => !en.dead);
  }

  // ---------- 经验 / 升级 ----------
  moveGems(dt) {
    const p = this.player;
    for (const gm of this.gems) {
      const d = Phaser.Math.Distance.Between(gm.x, gm.y, p.x, p.y);
      if (d < this.stats.pickup) {
        const a = Phaser.Math.Angle.Between(gm.x, gm.y, p.x, p.y);
        gm.x += Math.cos(a)*420*dt; gm.y += Math.sin(a)*420*dt; gm.obj.x = gm.x; gm.obj.y = gm.y;
        if (d < p.r + 6) { gm.got = true; this.xp += gm.xp; gm.obj.destroy(); if (this.xp >= this.xpNeed) this.levelUp(); }
      }
    }
    this.gems = this.gems.filter(gm => !gm.got);
  }
  levelUp() {
    this.xp -= this.xpNeed; this.level++; this.xpNeed = Math.floor(this.xpNeed * 1.38 + 3);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
    this.ring(this.player.x, this.player.y, 0x8affc0, 110); SFX.level();
    this.paused = true; this.leveling = true;
    if (this.level >= 15) this.tryAch('lv15');
    const pool = this.upgradePool();
    Phaser.Utils.Array.Shuffle(pool);
    const pick = pool.slice(0, 3), layer = [];
    layer.push(this.add.rectangle(W/2, H/2, W, H, 0x000, 0.72).setDepth(20));
    layer.push(mkText(this, W/2, H/2-200, `Lv.${this.level} 升级！三选一`, { fontSize: '24px', color: '#9fe07a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(21));
    pick.forEach((u, i) => {
      const cy = H/2 - 90 + i*110;
      const card = this.add.rectangle(W/2, cy, 380, 90, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setDepth(21).setInteractive();
      const txt = mkText(this, W/2, cy, u.t, { fontSize: '22px', color: '#fff' }).setOrigin(0.5).setDepth(22);
      card.on('pointerover', () => card.setFillStyle(0x274066));
      card.on('pointerout', () => card.setFillStyle(0x1c2b4a));
      card.on('pointerup', () => { u.f(); layer.forEach(o => o.destroy()); card.destroy(); txt.destroy(); this.paused = false; this.leveling = false; this.checkEvolutions(); });
      layer.push(card, txt);
    });
  }

  // ---------- HUD / 结算 ----------
  makeHUD() {
    this.add.rectangle(W/2, 18, W-30, 16, 0x222).setDepth(10);
    this.hpFill = this.add.rectangle(16, 18, W-30, 16, 0xff5a5a).setOrigin(0,0.5).setDepth(11);
    this.add.rectangle(W/2, 40, W-30, 10, 0x222).setDepth(10);
    this.xpFill = this.add.rectangle(16, 40, 0, 10, 0x8affc0).setOrigin(0,0.5).setDepth(11);
    this.info = mkText(this, W/2, 58, '', { fontSize: '15px', color: '#cde' }).setOrigin(0.5,0).setDepth(11);
    this.comboText = mkText(this, W/2, 80, '', { fontSize: '16px', color: '#ff9a40', fontStyle: 'bold' }).setOrigin(0.5,0).setDepth(11);
    mkText(this, W/2, H-24, '拖动摇杆 / WASD 移动 · 自动开火 · 活得越久越强', { fontSize: '11px', color: '#7a9' }).setOrigin(0.5,0).setDepth(10);
    // 静音开关
    this.muteBtn = mkText(this, W-14, 76, SFX.muted ? '🔇' : '🔊', { fontSize: '20px' }).setOrigin(1, 0).setDepth(12).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerup', () => this.muteBtn.setText(SFX.toggle() ? '🔇' : '🔊'));
    this.pauseBtn = mkText(this, 14, 76, '⏸', { fontSize: '20px' }).setOrigin(0, 0).setDepth(12).setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerup', () => this.togglePause());
    this.vignette = this.add.rectangle(W/2, H/2, W, H, 0xff2200, 0).setDepth(9); // 低血红光预警
    // Boss 血条(默认隐藏,Boss 出现时显示)
    this.bossLabel = mkText(this, W/2, H-66, '👹 BOSS', { fontSize: '12px', color: '#e0a0ff' }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.bossBarBg = this.add.rectangle(W/2, H-50, W-40, 12, 0x331033).setDepth(10).setVisible(false);
    this.bossBarFill = this.add.rectangle(16, H-50, W-40, 12, 0xc060ff).setOrigin(0, 0.5).setDepth(11).setVisible(false);
  }
  updateHUD() {
    this.hpFill.width = (W-30) * Math.max(0, this.player.hp / this.player.maxHp);
    this.xpFill.width = (W-30) * Math.max(0, this.xp / this.xpNeed);
    this.info.setText(`Lv.${this.level}   ⏱ ${Math.floor(this.elapsed)}s   💀 ${this.kills}`);
    this.comboText.setText(this.combo >= 5 ? `🔥 连杀 x${this.combo}` : '');
    const bossAlive = this.boss && !this.boss.dead;
    this.bossLabel.setVisible(bossAlive); this.bossBarBg.setVisible(bossAlive); this.bossBarFill.setVisible(bossAlive);
    if (bossAlive) this.bossBarFill.width = (W-40) * Math.max(0, this.boss.hp / this.boss.maxHp);
    const f = this.player.hp / this.player.maxHp; // 低血红光
    this.vignette.setAlpha(f < 0.35 ? (0.35 - f) / 0.35 * 0.22 : 0);
  }
  togglePause() {
    if (this.over || this.leveling) return;
    if (!this.paused) {
      this.paused = true;
      const dim = this.add.rectangle(W/2, H/2, W, H, 0x000, 0.62).setDepth(25);
      const t = mkText(this, W/2, H/2-50, '已暂停', { fontSize: '40px', color: '#cde', fontStyle: 'bold' }).setOrigin(0.5).setDepth(26);
      const btn = this.add.rectangle(W/2, H/2+30, 200, 58, 0x2f7fd0).setStrokeStyle(2, 0xfff).setDepth(26).setInteractive({ useHandCursor: true });
      const bt = mkText(this, W/2, H/2+30, '▶ 继续', { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setDepth(27);
      btn.on('pointerup', () => this.togglePause());
      const home = this.add.rectangle(W/2, H/2+102, 200, 52, 0x244).setStrokeStyle(2, 0x6fd0ff).setDepth(26).setInteractive({ useHandCursor: true });
      const ht = mkText(this, W/2, H/2+102, '← 返回标题', { fontSize: '20px', color: '#cfe' }).setOrigin(0.5).setDepth(27);
      home.on('pointerup', () => { this.paused = false; if (this.pauseLayer) { this.pauseLayer.forEach(o => o.destroy()); this.pauseLayer = null; } this.scene.start('title'); });
      this.pauseLayer = [dim, t, btn, bt, home, ht];
    } else {
      this.paused = false;
      if (this.pauseLayer) { this.pauseLayer.forEach(o => o.destroy()); this.pauseLayer = null; }
    }
  }
  end() {
    this.over = true;
    this.cameras.main.shake(260, 0.012); SFX.over();
    const secs = Math.floor(this.elapsed);
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    const isRecord = secs > best;
    if (isRecord) localStorage.setItem(BEST_KEY, String(secs));

    this.add.rectangle(W/2, H/2, W, H, 0x000, 0.80).setDepth(30);
    mkText(this, W/2, H/2-150, isRecord ? '🏆 新纪录！' : '你倒下了', { fontSize: '40px', color: isRecord ? '#f5c84c' : '#ff7a7a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(31);
    mkText(this, W/2, H/2-90, `存活 ${secs} 秒 · Lv.${this.level} · 击杀 ${this.kills}`, { fontSize: '18px', color: '#cde' }).setOrigin(0.5).setDepth(31);
    mkText(this, W/2, H/2-58, isRecord ? '之前最佳 ' + best + ' 秒' : '最佳 ' + best + ' 秒', { fontSize: '13px', color: '#8aa' }).setOrigin(0.5).setDepth(31);
    const earned = META.award(secs, this.kills);
    mkText(this, W/2, H/2-30, `💰 +${earned}   (共 ${META.coins()})`, { fontSize: '16px', color: '#f5c84c' }).setOrigin(0.5).setDepth(31);
    let newAch = 0; const tryEnd = (k) => { if (ACH.unlock(k)) newAch++; };
    if (secs >= 120) tryEnd('survive120');
    if (secs >= 300) tryEnd('survive300');
    if (this.level >= 15) tryEnd('lv15');
    const tk = parseInt(localStorage.getItem('fm_total_kills') || '0', 10) + this.kills;
    localStorage.setItem('fm_total_kills', String(tk));
    if (tk >= 2000) tryEnd('kill2000');
    if (META.coins() >= 1000) tryEnd('rich1000');
    if (newAch > 0) mkText(this, W/2, H/2-6, `🏅 解锁 ${newAch} 个新成就`, { fontSize: '14px', color: '#f5c84c' }).setOrigin(0.5).setDepth(31);

    const curBest = Math.max(secs, best);
    const again = this.add.rectangle(W/2, H/2+6, 220, 60, 0x2f7fd0).setStrokeStyle(2, 0xfff).setDepth(31).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H/2+6, '再来一局', { fontSize: '24px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(32);
    again.on('pointerover', () => again.setScale(1.05)); again.on('pointerout', () => again.setScale(1));
    again.on('pointerup', () => this.scene.restart());

    const share = this.add.rectangle(W/2, H/2+74, 220, 54, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setDepth(31).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H/2+74, '📤 分享成绩', { fontSize: '20px', color: '#cfe' }).setOrigin(0.5).setDepth(32);
    share.on('pointerover', () => share.setScale(1.04)); share.on('pointerout', () => share.setScale(1));
    share.on('pointerup', () => shareScore(secs, this.level, this.kills, curBest));

    // 引流 CTA:回标题 + 去作者主页
    const home = mkText(this, W/2-60, H/2+140, '← 标题', { fontSize: '16px', color: '#9fbed8' }).setOrigin(0.5).setDepth(32).setInteractive({ useHandCursor: true });
    home.on('pointerup', () => this.scene.start('title'));
    const hub = mkText(this, W/2+70, H/2+140, '更多作品 qizh.space ↗', { fontSize: '16px', color: '#6fd0ff' }).setOrigin(0.5).setDepth(32).setInteractive({ useHandCursor: true });
    hub.on('pointerup', () => window.open(HUB_URL, '_blank'));
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#0b1020',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  render: { antialias: true, antialiasGL: true, roundPixels: false, pixelArt: false, mipmapFilter: 'LINEAR_MIPMAP_LINEAR', powerPreference: 'high-performance' },
  scene: [Boot, Title, CharSelect, Shop, Game],
});
