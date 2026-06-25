/* FingerMOBA — 单手幸存者(Survivor 风)。Phaser + SVG 贴图,秒开。
   摇杆/WASD 走位 + 自动开火 + 怪潮 + 升级三选一 + 打击感 + 最高分 + 引流 CTA。 */
const W = 540, H = 960;
const DPR = Math.min(window.devicePixelRatio || 1, 3); // 跟随设备像素比(封顶 3,覆盖主流 3x 手机屏)
const RASTER = 384;                                    // SVG 栅格化分辨率(够大标题大图也不糊)
const SPRITES = ['hero', 'enemy_basic', 'enemy_fast', 'enemy_tank', 'gem', 'projectile'];
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
    scene.input.on('gameout', () => this._release());
  }
  canStart() { return !(this.scene.paused || this.scene.over); }
  _down(p) {
    if (this.active || !this.canStart()) return;
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
    this.add.image(W/2, H*0.27, 'hero').setDisplaySize(116, 116);
    this.add.text(W/2, H*0.40, 'FINGER MOBA', { fontSize: '52px', color: '#9fe07a', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5);
    this.add.text(W/2, H*0.455, '单手幸存 · 怪潮中活到最后', { fontSize: '17px', color: '#cde', resolution: DPR }).setOrigin(0.5);
    this.add.text(W/2, H*0.50, `💰 ${META.coins()}`, { fontSize: '17px', color: '#f5c84c', resolution: DPR }).setOrigin(0.5);
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    if (best > 0) this.add.text(W/2, H*0.535, `🏆 最佳存活 ${best} 秒`, { fontSize: '14px', color: '#9fbed8', resolution: DPR }).setOrigin(0.5);

    const btn = this.add.rectangle(W/2, H*0.63, 240, 70, 0x2f7fd0).setStrokeStyle(3, 0xffffff).setInteractive({ useHandCursor: true });
    this.add.text(W/2, H*0.63, '▶  开始', { fontSize: '28px', color: '#fff', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setScale(1.05));
    btn.on('pointerout', () => btn.setScale(1));
    const start = () => { SFX.init(); this.scene.start('game'); };
    btn.on('pointerup', start);
    this.input.keyboard.once('keydown', start);

    const shop = this.add.rectangle(W/2, H*0.71, 240, 54, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    this.add.text(W/2, H*0.71, '🛒 永久升级商店', { fontSize: '19px', color: '#cfe', resolution: DPR }).setOrigin(0.5);
    shop.on('pointerover', () => shop.setScale(1.04)); shop.on('pointerout', () => shop.setScale(1));
    shop.on('pointerup', () => { SFX.init(); this.scene.start('shop'); });

    this.add.text(W/2, H*0.78, '拖动屏幕任意处移动 · 桌面用 WASD · 自动开火', { fontSize: '12px', color: '#7a9', resolution: DPR }).setOrigin(0.5);
    const link = this.add.text(W/2, H-40, 'by Zion · qizh.space ↗', { fontSize: '13px', color: '#6fd0ff', resolution: DPR }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    link.on('pointerup', () => window.open(HUB_URL, '_blank'));
  }
}

/* ── 商店:用金币买永久强化 ── */
class Shop extends Phaser.Scene {
  constructor() { super('shop'); }
  create() {
    this.add.rectangle(W/2, H/2, W, H, 0x0b1020);
    for (let gy = 60; gy < H; gy += 60) this.add.rectangle(W/2, gy, W, 1, 0x16203a);
    this.add.text(W/2, 54, '🛒 永久升级', { fontSize: '32px', color: '#9fe07a', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5);
    this.coinText = this.add.text(W/2, 100, '', { fontSize: '22px', color: '#f5c84c', resolution: DPR }).setOrigin(0.5);
    this.add.text(W/2, 132, '金币来自每局战绩(存活时间 + 击杀),死了也算', { fontSize: '12px', color: '#7a9', resolution: DPR }).setOrigin(0.5);
    this.rows = [];
    META.upgrades.forEach((u, i) => {
      const y = 192 + i * 96;
      this.add.rectangle(W/2, y, W-44, 84, 0x141d33).setStrokeStyle(1, 0x2a3a55);
      this.add.text(38, y-17, u.name, { fontSize: '19px', color: '#fff', resolution: DPR }).setOrigin(0, 0.5);
      const lvT = this.add.text(38, y+15, '', { fontSize: '13px', color: '#9fbed8', resolution: DPR }).setOrigin(0, 0.5);
      const btn = this.add.rectangle(W-98, y, 126, 54, 0x2f7fd0).setInteractive({ useHandCursor: true });
      const btnT = this.add.text(W-98, y, '', { fontSize: '15px', color: '#fff', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5);
      btn.on('pointerover', () => btn.setScale(1.04)); btn.on('pointerout', () => btn.setScale(1));
      btn.on('pointerup', () => { if (META.buy(u)) SFX.level(); else this.cameras.main.shake(120, 0.004); this.refresh(); });
      this.rows.push({ u, lvT, btn, btnT });
    });
    const back = this.add.rectangle(W/2, H-64, 200, 58, 0x244).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    this.add.text(W/2, H-64, '← 返回', { fontSize: '22px', color: '#fff', resolution: DPR }).setOrigin(0.5);
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
    this.enemies = []; this.projs = []; this.gems = []; this.orbiters = [];
    this.elapsed = 0; this.kills = 0; this.level = 1; this.xp = 0; this.xpNeed = 5;
    this.fireT = 0; this.spawnT = 0.5; this.hurtCd = 0;
    this.bossT = 50; this.boss = null; this.auraObj = null; this.auraT = 0;
    this.boltEvolved = false; this.orbEvolved = false; this.auraEvolved = false;
    this.stats = { dmg: 16, fireCd: 0.55, projSpeed: 540, projCount: 1, pierce: 0, moveSpeed: 235, pickup: 78, orbit: 0, aura: 0 };

    this.add.rectangle(W/2, H/2, W, H, 0x0b1020).setDepth(-2);
    for (let gx = 60; gx < W; gx += 60) this.add.rectangle(gx, H/2, 1, H, 0x16203a).setDepth(-1);
    for (let gy = 60; gy < H; gy += 60) this.add.rectangle(W/2, gy, W, 1, 0x16203a).setDepth(-1);

    this.player = { x: W/2, y: H/2, r: 17, hp: 100, maxHp: 100 };
    this.player.obj = this.add.image(this.player.x, this.player.y, 'hero').setDepth(5).setDisplaySize(48, 48);
    META.applyTo(this.stats, this.player); // 应用局外永久强化

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.stick = new VirtualJoystick(this, { radius: 70, deadZone: 0.12, depth: 12 });

    this.makeHUD();
  }

  update(_t, dms) {
    if (this.over || this.paused) return;
    const dt = Math.min(dms, 50) / 1000;
    this.elapsed += dt; this.hurtCd -= dt;
    this.moverPlayer(dt); this.spawn(dt); this.moveEnemies(dt); this.updateOrbiters(dt); this.updateAura(dt);
    this.fire(dt); this.moveProjs(dt); this.moveGems(dt); this.updateHUD();
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
    p.x = Phaser.Math.Clamp(p.x, 16, W-16); p.y = Phaser.Math.Clamp(p.y, 60, H-90);
    p.obj.x = p.x; p.obj.y = p.y;
  }

  // ---------- 敌人 ----------
  spawn(dt) {
    this.bossT -= dt;
    if (this.bossT <= 0 && !this.boss) { this.spawnEnemy('boss'); this.bossT = 50; }
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.enemies.length > 140) return;
    this.spawnT = Math.max(0.28, 1.3 - this.elapsed * 0.012);
    const n = 1 + Math.floor(this.elapsed / 25);
    for (let i = 0; i < n; i++) {
      const r = Math.random(); let type = 'basic';
      if (this.elapsed > 30 && r < 0.12) type = 'tank';
      else if (this.elapsed > 15 && r < 0.34) type = 'fast';
      this.spawnEnemy(type);
    }
  }
  spawnEnemy(type) {
    const edge = Math.floor(Math.random()*4); let x, y;
    if (edge === 0) { x = Math.random()*W; y = -20; }
    else if (edge === 1) { x = Math.random()*W; y = H+20; }
    else if (edge === 2) { x = -20; y = Math.random()*H; }
    else { x = W+20; y = Math.random()*H; }
    const hp0 = 18 + this.elapsed * 1.4;
    let e;
    if (type === 'boss') e = { type, r: 46, hp: hp0*36, maxHp: hp0*36, speed: 34 + this.elapsed*0.12, dmg: 30, xp: 30, sprite: 'enemy_tank', col: 0xc060ff };
    else if (type === 'tank') e = { type, r: 24, hp: hp0*6, maxHp: hp0*6, speed: 42 + this.elapsed*0.25, dmg: 22, xp: 5, sprite: 'enemy_tank', col: 0x8fb0c0 };
    else if (type === 'fast') e = { type, r: 11, hp: hp0*0.55, maxHp: hp0*0.55, speed: 95 + this.elapsed*0.5, dmg: 9, xp: 1, sprite: 'enemy_fast', col: 0xff7a9c };
    else e = { type, r: 14, hp: hp0, maxHp: hp0, speed: 56 + this.elapsed*0.5, dmg: 12, xp: 1, sprite: 'enemy_basic', col: 0x7be86a };
    e.x = x; e.y = y; e.orbCd = 0; e.slowT = 0; e.speed = Math.min(e.speed, type === 'fast' ? 185 : 150);
    e.obj = this.add.image(x, y, e.sprite).setDepth(3).setDisplaySize(e.r*2.8, e.r*2.8);
    if (type === 'boss') {
      this.boss = e; e.obj.setTint(0xc060ff); this.cameras.main.shake(220, 0.008);
      const t = this.add.text(W/2, H/2, '👹 BOSS 来袭!', { fontSize: '30px', color: '#e0a0ff', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets: t, alpha: 0, y: H/2-50, duration: 1300, onComplete: () => t.destroy() });
    }
    this.enemies.push(e);
  }
  moveEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.orbCd > 0) e.orbCd -= dt;
      let sp = e.speed; if (e.slowT > 0) { e.slowT -= dt; sp *= 0.5; } // 奥能风暴减速
      const a = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
      e.x += Math.cos(a)*sp*dt; e.y += Math.sin(a)*sp*dt;
      e.obj.x = e.x; e.obj.y = e.y;
      if (Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y) < e.r + p.r) {
        this.player.hp -= e.dmg * dt;
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
      this.projs.push({ x: this.player.x, y: this.player.y, vx: Math.cos(a)*this.stats.projSpeed, vy: Math.sin(a)*this.stats.projSpeed, life: 1.2, pierce: this.stats.pierce, dmg: pdmg, obj });
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
  // ---------- 武器进化 ----------
  checkEvolutions() {
    if (!this.boltEvolved && this.stats.projCount >= 5 && this.stats.pierce >= 2) { this.boltEvolved = true; this.evolveBanner('多重散射弹'); }
    if (!this.orbEvolved && this.stats.orbit >= 4) { this.orbEvolved = true; this.orbiters.forEach(o => o.setDisplaySize(34, 34).setTint(0xfff0a0)); this.evolveBanner('光刃环'); }
    if (!this.auraEvolved && this.stats.aura >= 4) { this.auraEvolved = true; if (this.auraObj) this.auraObj.setFillStyle(0xc0a0ff, 0.16); this.evolveBanner('奥能风暴'); }
  }
  evolveBanner(name) {
    this.cameras.main.shake(220, 0.007); SFX.level();
    const t = this.add.text(W/2, H*0.32, `⚡ 武器进化:${name}!`, { fontSize: '25px', color: '#f5c84c', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5).setDepth(16);
    this.tweens.add({ targets: t, scale: 1.18, alpha: 0, y: H*0.27, duration: 1700, onComplete: () => t.destroy() });
  }
  moveProjs(dt) {
    for (const pr of this.projs) {
      pr.x += pr.vx*dt; pr.y += pr.vy*dt; pr.life -= dt; pr.obj.x = pr.x; pr.obj.y = pr.y;
      if (pr.life <= 0 || pr.x < -30 || pr.x > W+30 || pr.y < -30 || pr.y > H+30) { pr.dead = true; continue; }
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Phaser.Math.Distance.Between(pr.x, pr.y, e.x, e.y) < e.r + 6) {
          e.hp -= pr.dmg;
          e.obj.setTintFill(0xffffff);
          this.time.delayedCall(60, () => { if (e.obj && e.obj.active && !e.dead) e.obj.clearTint(); });
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
    this.burst(e.x, e.y, e.col, (e.type === 'tank' || e.type === 'boss') ? 12 : 6); SFX.kill();
    if (e === this.boss) {
      this.boss = null; this.cameras.main.shake(300, 0.013); this.ring(e.x, e.y, 0xc060ff, 190); SFX.level();
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
    this.xp -= this.xpNeed; this.level++; this.xpNeed = Math.floor(this.xpNeed * 1.45 + 3);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
    this.ring(this.player.x, this.player.y, 0x8affc0, 110); SFX.level();
    this.paused = true;
    const pool = [
      { t: '⚔ 伤害 +25%', f: () => this.stats.dmg *= 1.25 },
      { t: '🔥 攻速 +20%', f: () => this.stats.fireCd *= 0.82 },
      { t: '➕ 多一发子弹', f: () => this.stats.projCount += 1 },
      { t: '🏃 移速 +12%', f: () => this.stats.moveSpeed *= 1.12 },
      { t: '❤ 上限+25 并回满', f: () => { this.player.maxHp += 25; this.player.hp = this.player.maxHp; } },
      { t: '🧲 拾取范围 +40%', f: () => this.stats.pickup *= 1.4 },
      { t: '🎯 子弹穿透 +1', f: () => this.stats.pierce += 1 },
      { t: '🛡 环绕光球 +1', f: () => { this.stats.orbit += 1; this.syncOrbiters(); } },
      { t: '🌀 伤害光环 +1', f: () => { this.stats.aura += 1; } },
    ];
    Phaser.Utils.Array.Shuffle(pool);
    const pick = pool.slice(0, 3), layer = [];
    layer.push(this.add.rectangle(W/2, H/2, W, H, 0x000, 0.72).setDepth(20));
    layer.push(this.add.text(W/2, H/2-200, `Lv.${this.level} 升级！三选一`, { fontSize: '24px', color: '#9fe07a', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5).setDepth(21));
    pick.forEach((u, i) => {
      const cy = H/2 - 90 + i*110;
      const card = this.add.rectangle(W/2, cy, 380, 90, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setDepth(21).setInteractive();
      const txt = this.add.text(W/2, cy, u.t, { fontSize: '22px', color: '#fff', resolution: DPR }).setOrigin(0.5).setDepth(22);
      card.on('pointerover', () => card.setFillStyle(0x274066));
      card.on('pointerout', () => card.setFillStyle(0x1c2b4a));
      card.on('pointerup', () => { u.f(); layer.forEach(o => o.destroy()); card.destroy(); txt.destroy(); this.paused = false; this.checkEvolutions(); });
      layer.push(card, txt);
    });
  }

  // ---------- HUD / 结算 ----------
  makeHUD() {
    this.add.rectangle(W/2, 18, W-30, 16, 0x222).setDepth(10);
    this.hpFill = this.add.rectangle(16, 18, W-30, 16, 0xff5a5a).setOrigin(0,0.5).setDepth(11);
    this.add.rectangle(W/2, 40, W-30, 10, 0x222).setDepth(10);
    this.xpFill = this.add.rectangle(16, 40, 0, 10, 0x8affc0).setOrigin(0,0.5).setDepth(11);
    this.info = this.add.text(W/2, 58, '', { fontSize: '15px', color: '#cde', resolution: DPR }).setOrigin(0.5,0).setDepth(11);
    this.add.text(W/2, H-24, '拖动摇杆 / WASD 移动 · 自动开火 · 活得越久越强', { fontSize: '11px', color: '#7a9', resolution: DPR }).setOrigin(0.5,0).setDepth(10);
    // 静音开关
    this.muteBtn = this.add.text(W-14, 76, SFX.muted ? '🔇' : '🔊', { fontSize: '20px', resolution: DPR }).setOrigin(1, 0).setDepth(12).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerup', () => this.muteBtn.setText(SFX.toggle() ? '🔇' : '🔊'));
    // Boss 血条(默认隐藏,Boss 出现时显示)
    this.bossLabel = this.add.text(W/2, H-66, '👹 BOSS', { fontSize: '12px', color: '#e0a0ff', resolution: DPR }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.bossBarBg = this.add.rectangle(W/2, H-50, W-40, 12, 0x331033).setDepth(10).setVisible(false);
    this.bossBarFill = this.add.rectangle(16, H-50, W-40, 12, 0xc060ff).setOrigin(0, 0.5).setDepth(11).setVisible(false);
  }
  updateHUD() {
    this.hpFill.width = (W-30) * Math.max(0, this.player.hp / this.player.maxHp);
    this.xpFill.width = (W-30) * Math.max(0, this.xp / this.xpNeed);
    this.info.setText(`Lv.${this.level}   ⏱ ${Math.floor(this.elapsed)}s   💀 ${this.kills}`);
    const bossAlive = this.boss && !this.boss.dead;
    this.bossLabel.setVisible(bossAlive); this.bossBarBg.setVisible(bossAlive); this.bossBarFill.setVisible(bossAlive);
    if (bossAlive) this.bossBarFill.width = (W-40) * Math.max(0, this.boss.hp / this.boss.maxHp);
  }
  end() {
    this.over = true;
    this.cameras.main.shake(260, 0.012); SFX.over();
    const secs = Math.floor(this.elapsed);
    const best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    const isRecord = secs > best;
    if (isRecord) localStorage.setItem(BEST_KEY, String(secs));

    this.add.rectangle(W/2, H/2, W, H, 0x000, 0.80).setDepth(30);
    this.add.text(W/2, H/2-150, isRecord ? '🏆 新纪录！' : '你倒下了', { fontSize: '40px', color: isRecord ? '#f5c84c' : '#ff7a7a', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5).setDepth(31);
    this.add.text(W/2, H/2-90, `存活 ${secs} 秒 · Lv.${this.level} · 击杀 ${this.kills}`, { fontSize: '18px', color: '#cde', resolution: DPR }).setOrigin(0.5).setDepth(31);
    this.add.text(W/2, H/2-58, isRecord ? '之前最佳 ' + best + ' 秒' : '最佳 ' + best + ' 秒', { fontSize: '13px', color: '#8aa', resolution: DPR }).setOrigin(0.5).setDepth(31);
    const earned = META.award(secs, this.kills);
    this.add.text(W/2, H/2-28, `💰 +${earned}   (共 ${META.coins()})`, { fontSize: '16px', color: '#f5c84c', resolution: DPR }).setOrigin(0.5).setDepth(31);

    const curBest = Math.max(secs, best);
    const again = this.add.rectangle(W/2, H/2+6, 220, 60, 0x2f7fd0).setStrokeStyle(2, 0xfff).setDepth(31).setInteractive({ useHandCursor: true });
    this.add.text(W/2, H/2+6, '再来一局', { fontSize: '24px', color: '#fff', fontStyle: 'bold', resolution: DPR }).setOrigin(0.5).setDepth(32);
    again.on('pointerover', () => again.setScale(1.05)); again.on('pointerout', () => again.setScale(1));
    again.on('pointerup', () => this.scene.restart());

    const share = this.add.rectangle(W/2, H/2+74, 220, 54, 0x1c2b4a).setStrokeStyle(2, 0x6fd0ff).setDepth(31).setInteractive({ useHandCursor: true });
    this.add.text(W/2, H/2+74, '📤 分享成绩', { fontSize: '20px', color: '#cfe', resolution: DPR }).setOrigin(0.5).setDepth(32);
    share.on('pointerover', () => share.setScale(1.04)); share.on('pointerout', () => share.setScale(1));
    share.on('pointerup', () => shareScore(secs, this.level, this.kills, curBest));

    // 引流 CTA:回标题 + 去作者主页
    const home = this.add.text(W/2-60, H/2+140, '← 标题', { fontSize: '16px', color: '#9fbed8', resolution: DPR }).setOrigin(0.5).setDepth(32).setInteractive({ useHandCursor: true });
    home.on('pointerup', () => this.scene.start('title'));
    const hub = this.add.text(W/2+70, H/2+140, '更多作品 qizh.space ↗', { fontSize: '16px', color: '#6fd0ff', resolution: DPR }).setOrigin(0.5).setDepth(32).setInteractive({ useHandCursor: true });
    hub.on('pointerup', () => window.open(HUB_URL, '_blank'));
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#0b1020',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W * DPR, height: H * DPR, zoom: 1 / DPR, autoRound: true },
  render: { antialias: true, antialiasGL: true, roundPixels: false, pixelArt: false, mipmapFilter: 'LINEAR_MIPMAP_LINEAR', powerPreference: 'high-performance' },
  scene: [Boot, Title, Shop, Game],
});
