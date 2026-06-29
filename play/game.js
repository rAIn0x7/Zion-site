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
    { key: 'power', name: '✨ 全能强化', per: '+3%全伤', max: 15, cost: l => 80 + l*l*14 }, // 封顶+45%,根除"无限叠→后期报表无敌"
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
    stats.dmg *= (1 + 0.03 * this.lvl('power')); // 无上限金币池:全伤加成
  },
  award(secs, kills) { const c = Math.floor((secs * 1.5 + kills) * (1 + 0.20 * this.lvl('gold'))); this.setCoins(this.coins() + c); return c; },
  reset() { // 重置所有永久升级,返还全部已花金币(respec / 重练)
    let refund = 0;
    for (const u of this.upgrades) { const l = this.lvl(u.key); for (let i = 0; i < l; i++) refund += u.cost(i); }
    for (const u of this.upgrades) this.setLvl(u.key, 0);
    this.setCoins(this.coins() + refund);
    return refund;
  },
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
  { key: 'mage',    name: '🧙 法师', role: '均衡', desc: '标准弹幕\n💠经验 +20%', tint: 0xffe066, bg: 0x3a3416, apply: (s, p) => {} },
  { key: 'warrior', name: '🛡 战士', role: '坦克', desc: '高血光球\n💠接触伤 -25%', tint: 0xff6a6a, bg: 0x3a1616, apply: (s, p) => { p.maxHp += 50; p.hp = p.maxHp; s.moveSpeed *= 1.05; s.fireCd *= 1.15; s.orbit = 1; } },
  { key: 'ranger',  name: '🏹 游侠', role: '敏捷', desc: '起手双发\n💠每4级 +1弹', tint: 0x5aff8a, bg: 0x16331f, apply: (s, p) => { p.maxHp -= 20; p.hp = p.maxHp; s.moveSpeed *= 1.18; s.projCount = 2; s.fireCd *= 0.9; } },
  { key: 'assassin', name: '🥷 刺客', role: '爆发', desc: '高伤极脆\n💠暴击/级 +1.2%', tint: 0xb060ff, bg: 0x2a1640, apply: (s, p) => { p.maxHp -= 35; p.hp = p.maxHp; s.moveSpeed *= 1.25; s.dmg *= 1.35; s.fireCd *= 0.85; } },
  { key: 'cryo', name: '❄ 冰法', role: '控场', desc: '起手冰霜\n💠命中即减速', tint: 0x60d0ff, bg: 0x16303a, apply: (s, p) => { s.frost = 1; s.pickup *= 1.2; p.maxHp += 10; p.hp = p.maxHp; } },
];

/* ── 成就系统(localStorage) ── */
const ACH_KEY = 'fm_ach';
const ACH = {
  defs: [
    { key: 'kill100', name: '初战告捷' }, { key: 'survive120', name: '生存专家' },
    { key: 'survive300', name: '不死之身' }, { key: 'boss1', name: '屠龙者' },
    { key: 'evolve', name: '武器大师' }, { key: 'lv15', name: '登峰造极' },
    { key: 'kill2000', name: '百战之王' }, { key: 'rich1000', name: '小富翁' },
    { key: 'win5', name: '🏆 通关·存活5分钟' },
  ],
  got() { try { return JSON.parse(localStorage.getItem(ACH_KEY) || '{}'); } catch (e) { return {}; } },
  has(k) { return !!this.got()[k]; },
  unlock(k) { if (this.has(k)) return false; const o = this.got(); o[k] = 1; localStorage.setItem(ACH_KEY, JSON.stringify(o)); return true; },
  count() { return Object.keys(this.got()).length; },
};

/* ── 每日修正(按日期固定,每天换花样 → 给"今天再来一把"的理由) ── */
function dayStr() { const d = new Date(); return '' + d.getFullYear() + (d.getMonth() + 1) + d.getDate(); }
function daySeed() { const d = new Date(); return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate(); }
const MODIFIERS = [
  { name: '标准日 · 无修正', apply: () => {} },
  { name: '狂暴 · 伤害+40% 生命-30%', apply: (g) => { g.stats.dmg *= 1.4; g.player.maxHp = Math.round(g.player.maxHp * 0.7); g.player.hp = g.player.maxHp; } },
  { name: '神射手 · 暴击率+25%', apply: (g) => { g.stats.crit += 0.25; } },
  { name: '钢铁 · 生命+60% 伤害-15%', apply: (g) => { g.player.maxHp = Math.round(g.player.maxHp * 1.6); g.player.hp = g.player.maxHp; g.stats.dmg *= 0.85; } },
  { name: '疾风 · 移速+30% 攻速+15%', apply: (g) => { g.stats.moveSpeed *= 1.3; g.stats.fireCd *= 0.85; } },
  { name: '专精 · 起手随机一把副武器', apply: (g) => { const ks = ['orbit', 'aura', 'chain', 'frost', 'boom']; g.stats[ks[daySeed() % ks.length]] = 2; g.syncOrbiters(); } },
];
function todayMod() { return MODIFIERS[daySeed() % MODIFIERS.length]; }
function dailyBest() { return parseInt(localStorage.getItem('fm_daily_' + dayStr()) || '0', 10); }

/* ── 段位 + 本地排行榜(按最佳存活秒数,给身份感与"刷新纪录/晋级"的长期追逐目标) ── */
const RANKS = [
  { min: 0,   name: '🌱 新兵',     col: '#9fbed8' },
  { min: 60,  name: '🥉 青铜',     col: '#cd9a5a' },
  { min: 120, name: '🥈 白银',     col: '#c8d0d8' },
  { min: 180, name: '🥇 黄金',     col: '#f5c84c' },
  { min: 240, name: '💎 铂金',     col: '#5fe0d0' },
  { min: 300, name: '👑 钻石·通关', col: '#6fd0ff' },
  { min: 420, name: '🔥 大师',     col: '#ff9a40' }, // 通关 + 无尽 ~3 阶
  { min: 570, name: '⚡ 宗师',     col: '#ff7ad0' }, // 无尽 ~6 阶
  { min: 750, name: '🏆 传奇',     col: '#ff5a5a' }, // 无尽 ~10 阶
];
function rankOf(secs) { let r = RANKS[0]; for (const x of RANKS) if (secs >= x.min) r = x; return r; }
function nextRank(secs) { for (const x of RANKS) if (x.min > secs) return x; return null; }
const BOARD_KEY = 'fm_board';
function getBoard() { try { return JSON.parse(localStorage.getItem(BOARD_KEY) || '[]'); } catch (e) { return []; } }
function pushBoard(run) { const b = getBoard(); b.push(run); b.sort((a, c) => c.secs - a.secs); localStorage.setItem(BOARD_KEY, JSON.stringify(b.slice(0, 5))); }

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
    mkText(this, W/2, H*0.395, `💰 ${META.coins()}    🏅 ${ACH.count()}/${ACH.defs.length}    🏆 最佳 ${best}s`, { fontSize: '14px', color: '#f5c84c' }).setOrigin(0.5);
    // 段位徽章 + 下一段进度条(身份与晋级追逐)
    const rk = rankOf(best), nx = nextRank(best);
    mkText(this, W/2, H*0.435, `段位  ${rk.name}`, { fontSize: '22px', color: rk.col, fontStyle: 'bold' }).setOrigin(0.5);
    if (nx) {
      const span = nx.min - rk.min, prog = Phaser.Math.Clamp((best - rk.min) / span, 0, 1);
      this.add.rectangle(W/2, H*0.462, 230, 9, 0x223).setStrokeStyle(1, 0x2a3a55);
      this.add.rectangle(W/2-115, H*0.462, 230*prog, 9, Phaser.Display.Color.HexStringToColor(rk.col).color).setOrigin(0, 0.5);
      mkText(this, W/2, H*0.483, `距 ${nx.name} 还需 ${nx.min - best}s`, { fontSize: '11px', color: '#7a9' }).setOrigin(0.5);
    } else {
      mkText(this, W/2, H*0.483, '已达最高段位 · 冲无尽刷新纪录', { fontSize: '11px', color: '#ff9a40' }).setOrigin(0.5);
    }
    mkText(this, W/2, H*0.51, `🎲 今日:${todayMod().name} · 今日最佳 ${dailyBest()}s`, { fontSize: '12px', color: '#f5c84c' }).setOrigin(0.5);

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

    const board = getBoard();
    if (board.length) {
      mkText(this, W/2, H*0.755, '🏆 本地排行榜', { fontSize: '13px', color: '#9fbed8' }).setOrigin(0.5);
      const medal = ['🥇', '🥈', '🥉'];
      board.slice(0, 3).forEach((r, i) => {
        mkText(this, W/2, H*(0.785 + i*0.027), `${medal[i]}  ${r.secs}s · Lv${r.lvl} · ${r.kills}杀`, { fontSize: '13px', color: i === 0 ? '#f5c84c' : '#cde' }).setOrigin(0.5);
      });
    }
    mkText(this, W/2, H*0.885, '拖动屏幕任意处移动 · 桌面 WASD · 自动开火', { fontSize: '12px', color: '#7a9' }).setOrigin(0.5);
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
      const cx = W/2 + ((i % 2) ? 92 : -92), cy = 178 + Math.floor(i/2)*158;
      const card = this.add.rectangle(cx, cy, 172, 144, c.bg).setStrokeStyle(2, c.tint).setInteractive({ useHandCursor: true });
      this.add.circle(cx, cy-36, 28, c.tint, 0.16);                                  // 职业色光盘,5 个英雄一眼可辨
      this.add.image(cx, cy-36, 'hero').setDisplaySize(48, 48).setTint(c.tint);
      mkText(this, cx, cy+8, c.name, { fontSize: '18px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      this.add.rectangle(cx, cy+30, 48, 18, c.tint, 0.92);                            // 职业标签胶囊(先画底,再叠字)
      mkText(this, cx, cy+30, c.role, { fontSize: '11px', color: '#0b1020', fontStyle: 'bold' }).setOrigin(0.5);
      mkText(this, cx, cy+54, c.desc, { fontSize: '10px', color: '#cfe', align: 'center', lineSpacing: 2 }).setOrigin(0.5);
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
      const y = 168 + i * 80;
      this.add.rectangle(W/2, y, W-44, 70, 0x141d33).setStrokeStyle(1, 0x2a3a55);
      mkText(this, 38, y-15, u.name, { fontSize: '18px', color: '#fff' }).setOrigin(0, 0.5);
      const lvT = mkText(this, 38, y+15, '', { fontSize: '12px', color: '#9fbed8' }).setOrigin(0, 0.5);
      const btn = this.add.rectangle(W-98, y, 126, 50, 0x2f7fd0).setInteractive({ useHandCursor: true });
      const btnT = mkText(this, W-98, y, '', { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      btn.on('pointerover', () => btn.setScale(1.04)); btn.on('pointerout', () => btn.setScale(1));
      btn.on('pointerup', () => { if (META.buy(u)) SFX.level(); else this.cameras.main.shake(120, 0.004); this.refresh(); });
      this.rows.push({ u, lvT, btn, btnT });
    });
    const reset = this.add.rectangle(W/2, H-132, 264, 48, 0x3a1a1a).setStrokeStyle(2, 0xff7a7a).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H-132, '🔄 重置升级(返还金币)', { fontSize: '16px', color: '#ffb0b0' }).setOrigin(0.5);
    reset.on('pointerover', () => reset.setScale(1.04)); reset.on('pointerout', () => reset.setScale(1));
    reset.on('pointerup', () => this.confirmReset());
    const back = this.add.rectangle(W/2, H-64, 200, 58, 0x244).setStrokeStyle(2, 0x6fd0ff).setInteractive({ useHandCursor: true });
    mkText(this, W/2, H-64, '← 返回', { fontSize: '22px', color: '#fff' }).setOrigin(0.5);
    back.on('pointerover', () => back.setScale(1.04)); back.on('pointerout', () => back.setScale(1));
    back.on('pointerup', () => this.scene.start('title'));
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('title'));
    this.refresh();
  }
  confirmReset() {
    const layer = [];
    layer.push(this.add.rectangle(W/2, H/2, W, H, 0x000, 0.72).setDepth(40).setInteractive());
    layer.push(mkText(this, W/2, H/2-70, '重置所有永久升级?', { fontSize: '24px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41));
    layer.push(mkText(this, W/2, H/2-32, '等级清零,已花金币全部返还', { fontSize: '14px', color: '#9fbed8' }).setOrigin(0.5).setDepth(41));
    const yes = this.add.rectangle(W/2-72, H/2+42, 132, 54, 0xff5a5a).setStrokeStyle(2, 0xfff).setDepth(41).setInteractive({ useHandCursor: true });
    layer.push(yes, mkText(this, W/2-72, H/2+42, '确认返还', { fontSize: '17px', color: '#fff' }).setOrigin(0.5).setDepth(42));
    const no = this.add.rectangle(W/2+72, H/2+42, 132, 54, 0x244).setStrokeStyle(2, 0x6fd0ff).setDepth(41).setInteractive({ useHandCursor: true });
    layer.push(no, mkText(this, W/2+72, H/2+42, '取消', { fontSize: '17px', color: '#cfe' }).setOrigin(0.5).setDepth(42));
    yes.on('pointerup', () => { META.reset(); SFX.level(); this.scene.restart(); });
    no.on('pointerup', () => layer.forEach(o => o.destroy()));
  }
  refresh() {
    this.coinText.setText('💰 ' + META.coins());
    for (const r of this.rows) {
      const lv = META.lvl(r.u.key), maxed = lv >= r.u.max;
      r.lvT.setText(`Lv.${lv}/${r.u.max}   每级 ${r.u.per}`);
      if (maxed) { r.btnT.setText('已满级'); r.btn.setFillStyle(0x3a3a3a); }
      else { const c = r.u.cost(lv); const can = META.coins() >= c; r.btnT.setText((can ? '💰 ' : '🔒 ') + c); r.btn.setFillStyle(can ? 0x2f7fd0 : 0x2a2a2a); r.btnT.setColor(can ? '#fff' : '#888'); }
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
    this.stats = { dmg: 20, fireCd: 0.48, projSpeed: 540, projCount: 1, pierce: 0, moveSpeed: 235, pickup: 110, orbit: 0, aura: 0, chain: 0, frost: 0, boom: 0, crit: 0.05, critMul: 2.0 }; // 起手伤害/攻速上调+拾取范围扩大:前 60s 不再裸奔送死、宝石不漏

    this.add.rectangle(W/2, H/2, W, H, 0x0b1020).setDepth(-2);
    this.stars = []; // 动态星空背景(替代扁平网格)
    for (let i = 0; i < 56; i++) { const s = this.add.circle(Math.random()*W, Math.random()*H, Math.random() < 0.3 ? 1.7 : 1, 0x4a5a8a, 0.55).setDepth(-1); s.vy = 8 + Math.random()*24; this.stars.push(s); }
    this.floatN = 0; this.musicT = 0; this._toastN = 0; this.chests = []; this.chestT = 22; this.biome = 0; this.biomeT = 60; this.combo = 0; this.comboT = 0; this.won = false; this.endlessTier = 0; this.endlessNextT = 345;
    this.endlessChoosing = false; this.endlessEnemySpd = 1; this.endlessSpawnBonus = 0; this.endlessGold = 1;

    this.player = { x: W/2, y: H/2, r: 17, hp: 100, maxHp: 100 };
    const ch = CHARS.find(c => c.key === ((this.scene.settings.data && this.scene.settings.data.char) || 'mage')) || CHARS[0];
    this.player.ring = this.add.circle(this.player.x, this.player.y, 26, ch.tint, 0.0).setStrokeStyle(2.5, ch.tint, 0.55).setDepth(4); // 脚下职业色光环:在场上一眼分得清开的哪个英雄
    this.player.obj = this.add.image(this.player.x, this.player.y, 'hero').setDepth(5).setDisplaySize(48, 48);
    ch.apply(this.stats, this.player); this.player.obj.setTint(ch.tint); // 英雄起手特性
    this.heroPassive = ch.key; // 整局生效的英雄专属被动(非仅起手) → 让"选谁"影响全程
    META.applyTo(this.stats, this.player); // 局外永久强化
    this.syncOrbiters();                   // 战士起手光球
    this.dailyMod = todayMod(); this.dailyMod.apply(this); this.syncOrbiters(); // 每日修正

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());
    this.stick = new VirtualJoystick(this, { radius: 70, deadZone: 0.12, depth: 12 });

    this.makeHUD();
    this.firstRunHint();
  }
  firstRunHint() { // 首次进游戏的新手引导(localStorage 记忆,只显示一次)
    if (localStorage.getItem('fm_seen')) return;
    localStorage.setItem('fm_seen', '1');
    this.paused = true;
    const objs = [
      this.add.rectangle(W/2, H/2, W, H, 0x000, 0.66).setDepth(35),
      mkText(this, W/2, H/2-46, '拖动屏幕任意处走位', { fontSize: '23px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(36),
      mkText(this, W/2, H/2, '自动开火 · 捡 💎 升级 · 活得越久越强', { fontSize: '15px', color: '#cde' }).setOrigin(0.5).setDepth(36),
      mkText(this, W/2, H/2+56, '👆 点击开始', { fontSize: '17px', color: '#9fe07a' }).setOrigin(0.5).setDepth(36),
    ];
    let done = false;
    const go = () => { if (done) return; done = true; objs.forEach(o => o.destroy()); this.paused = false; };
    objs[0].setInteractive().on('pointerup', go);
    this.time.delayedCall(4500, go);
  }

  update(_t, dms) {
    if (this.over || this.paused) return;
    const dt = Math.min(dms, 50) / 1000;
    this.elapsed += dt; this.hurtCd -= dt;
    if (!this.won && this.elapsed >= 300) { this.won = true; this.banner('🏆 通关!存活 5 分钟,奖励 300 金币\n进入无尽阶段', '#f5c84c'); META.setCoins(META.coins() + 300); this.tryAch('win5'); } // 软通关:给目标与payoff,之后转无尽冲分
    this.updateEndless(dt);
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
    const t = mkText(this, x, y, txt, { fontSize: big ? '26px' : '17px', color: color || '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: big ? 600 : 480, onComplete: () => { t.destroy(); this.floatN--; } });
  }
  banner(text, color) { // 居中横幅(进化/宝箱)
    this.cameras.main.shake(180, 0.005);
    const t = mkText(this, W/2, H*0.34, text, { fontSize: '24px', color: color || '#f5c84c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(16);
    this.tweens.add({ targets: t, scale: 1.15, alpha: 0, y: H*0.29, duration: 1600, onComplete: () => t.destroy() });
  }
  upgradePool() {
    return [
      { t: '⚔ 伤害 +25%', k: 'dmg', f: () => this.stats.dmg *= 1.25 },
      { t: "🔥 攻速 +20%", k: 'fire', f: () => this.stats.fireCd = Math.max(0.12, this.stats.fireCd * 0.82) },
      { t: '➕ 多一发子弹', k: 'proj', f: () => this.stats.projCount += 1 },
      { t: '🏃 移速 +12%', k: 'spd', f: () => this.stats.moveSpeed *= 1.12 },
      { t: '❤ 上限+25 并回满', k: 'hp', f: () => { this.player.maxHp += 25; this.player.hp = this.player.maxHp; } },
      { t: '🧲 拾取范围 +40%', k: 'pickup', f: () => this.stats.pickup *= 1.4 },
      { t: '🎯 子弹穿透 +1', k: 'pierce', f: () => this.stats.pierce += 1 },
      { t: '💥 暴击率 +8%', k: 'crit', f: () => this.stats.crit += 0.08 },
      { t: '🛡 环绕光球 +1', k: 'orbit', f: () => { this.stats.orbit += 1; this.syncOrbiters(); } },
      { t: '🌀 伤害光环 +1', k: 'aura', f: () => { this.stats.aura += 1; } },
      { t: '⚡ 闪电链 +1', k: 'chain', f: () => { this.stats.chain += 1; } },
      { t: '❄ 冰霜新星 +1', k: 'frost', f: () => { this.stats.frost += 1; } },
      { t: '🪃 回旋镖 +1', k: 'boom', f: () => { this.stats.boom += 1; } },
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
    if (p.ring) { p.ring.x = p.x; p.ring.y = p.y; }
  }

  // 接触/爆炸伤害系数:前 ~36s 衰减(0.6→1.0,首通不再裸死);后期照常随时间涨;战士被动再减 25%
  contactScale() {
    const early = Math.min(1, 0.6 + this.elapsed * 0.011);
    const hero = this.heroPassive === 'warrior' ? 0.75 : 1;
    return early * (1 + this.elapsed / 300) * hero;
  }
  // ---------- 敌人 ----------
  spawn(dt) {
    this.bossT -= dt;
    if (this.bossT <= 0 && !this.boss) { this.spawnEnemy('boss'); this.bossT = 50; }
    this.chestT -= dt;
    if (this.chestT <= 0) { this.spawnChest(); this.chestT = 26; }
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.enemies.length > 85) return; // 同屏上限 110→85,减拥挤
    this.spawnT = Math.max(0.4, 1.9 - this.elapsed * 0.010); // 前期更慢(1min≈1.3s/波,原 0.89)
    const n = Math.min(6, 1 + Math.floor(this.elapsed / 42)) + this.endlessSpawnBonus; // 波数升得更慢;+无尽"增殖"诅咒
    for (let i = 0; i < n; i++) {
      const r = Math.random(); let type = 'basic';
      if (this.elapsed > 30 && r < 0.10) type = 'tank';
      else if (this.elapsed > 50 && r < 0.18) type = 'splitter'; // 分裂怪推后+减量(它会翻倍,前期最吵)
      else if (this.elapsed > 25 && r < 0.34) type = 'shooter';
      else if (this.elapsed > 45 && r < 0.44) type = 'exploder';
      else if (this.elapsed > 15 && r < 0.50) type = 'fast';
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
    const hp0 = 12 + this.elapsed * 0.9 + Math.min(this.elapsed * this.elapsed * 0.004, 400) + Math.max(0, this.elapsed - 316) * 2; // 5分钟后线性继续涨,不再封顶(破"无敌平台期")
    let e;
    if (type === 'boss') e = { type, r: 46, hp: hp0*36, maxHp: hp0*36, speed: 34 + this.elapsed*0.12, dmg: 30, xp: 40, sprite: 'enemy_tank', col: 0xc060ff };
    else if (type === 'tank') e = { type, r: 24, hp: hp0*6, maxHp: hp0*6, speed: 42 + this.elapsed*0.25, dmg: 22, xp: 8, sprite: 'enemy_tank', col: 0x8fb0c0 };
    else if (type === 'shooter') e = { type, r: 13, hp: hp0*1.4, maxHp: hp0*1.4, speed: 48 + this.elapsed*0.3, dmg: 8, xp: 4, sprite: 'enemy_fast', col: 0xffb060, fireT: 1.5 };
    else if (type === 'splitter') e = { type, r: 16, hp: hp0*1.2, maxHp: hp0*1.2, speed: 50 + this.elapsed*0.4, dmg: 12, xp: 3, sprite: 'enemy_basic', col: 0xe0e060, splits: true };
    else if (type === 'mini') e = { type, r: 8, hp: hp0*0.4, maxHp: hp0*0.4, speed: 80 + this.elapsed*0.4, dmg: 7, xp: 2, sprite: 'enemy_basic', col: 0x7be86a };
    else if (type === 'exploder') e = { type, r: 16, hp: hp0*1.1, maxHp: hp0*1.1, speed: 52 + this.elapsed*0.35, dmg: 10, xp: 4, sprite: 'enemy_basic', col: 0xff8800, explodes: true };
    else if (type === 'fast') e = { type, r: 11, hp: hp0*0.55, maxHp: hp0*0.55, speed: 95 + this.elapsed*0.5, dmg: 9, xp: 2, sprite: 'enemy_fast', col: 0xff7a9c };
    else e = { type, r: 14, hp: hp0, maxHp: hp0, speed: 56 + this.elapsed*0.5, dmg: 12, xp: 3, sprite: 'enemy_basic', col: 0x7be86a }; // XP 普调 ~3x:让升级雪球真正转起来(原 60s 才 Lv5)
    e.x = x; e.y = y; e.orbCd = 0; e.slowT = 0; e.speed = Math.min(e.speed, type === 'fast' ? 185 : 150);
    e.obj = this.add.image(x, y, e.sprite).setDepth(3).setDisplaySize(e.r*2.8, e.r*2.8);
    if (type === 'shooter') e.obj.setTint(0xffb060);
    if (type === 'splitter') e.obj.setTint(0xe0e060);
    if (type === 'exploder') e.obj.setTint(0xff8800);
    if (type === 'boss') {
      this.boss = e; e.abilityT = 5; e.obj.setTint(0xc060ff); this.cameras.main.shake(220, 0.008);
      this.bossCount = (this.bossCount || 0) + 1; e.bossLevel = this.bossCount; // 第几只 Boss → 解锁更多技能形态
      const t = mkText(this, W/2, H/2, `👹 BOSS ${this.bossCount > 1 ? 'x' + this.bossCount + ' ' : ''}来袭!`, { fontSize: '30px', color: '#e0a0ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets: t, alpha: 0, y: H/2-50, duration: 1300, onComplete: () => t.destroy() });
    } else if (type !== 'mini' && this.elapsed > 22 && Math.random() < 0.04) { // 精英怪:金色强化,必爆宝箱
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
      let sp = e.speed * this.endlessEnemySpd; if (e.slowT > 0) { e.slowT -= dt; sp *= 0.5; } // 奥能风暴减速;endlessEnemySpd=无尽"狂化"诅咒
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
        if (e.abilityT <= 0) {
          e.abilityT = 6; e.abilityN = (e.abilityN || 0) + 1;
          const modes = 2 + (e.bossLevel >= 2 ? 1 : 0) + (e.bossLevel >= 3 ? 1 : 0); // Boss 越往后,技能形态越多
          const mode = e.abilityN % modes;
          const bx = e.x, by = e.y;
          if (mode === 0) { // 召唤小怪(后期 Boss 召更多)
            this.ring(e.x, e.y, 0xc060ff, 80);
            const cnt = 2 + Math.min(2, e.bossLevel - 1);
            for (let k = 0; k < cnt; k++) this.addEnemy(e.bossLevel >= 3 ? 'fast' : 'basic', e.x + (Math.random()-0.5)*60, e.y + (Math.random()-0.5)*60);
          } else if (mode === 1) { // 放射状弹幕(红圈预警 → 发射)
            this.ring(e.x, e.y, 0xff5a5a, 130);
            this.time.delayedCall(560, () => { if (this.over) return; for (let k = 0; k < 10; k++) this.enemyShoot({ x: bx, y: by }, k / 10 * Math.PI * 2); });
          } else if (mode === 2) { // 螺旋弹幕(随技能次数旋转,需走位绕)
            this.ring(e.x, e.y, 0xffa040, 120);
            this.time.delayedCall(500, () => { if (this.over) return; const off = e.abilityN * 0.5; for (let k = 0; k < 12; k++) this.enemyShoot({ x: bx, y: by }, off + k / 12 * Math.PI * 2); });
          } else { // 锁定散射(瞄准玩家的扇形齐射,逼你横向拉开)
            this.ring(e.x, e.y, 0xff5ad0, 110);
            const aim = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y);
            this.time.delayedCall(500, () => { if (this.over) return; for (let k = -2; k <= 2; k++) this.enemyShoot({ x: bx, y: by }, aim + k * 0.22); });
          }
        }
      }
      e.obj.x = e.x; e.obj.y = e.y;
      if (d < e.r + p.r && this.hurtCd <= 0) { // 离散接触伤害(每 0.45s 一下):站怪堆里会痛,逼你走位,根治"无敌"
        this.player.hp -= e.dmg * this.contactScale();
        this.cameras.main.shake(120, 0.006); SFX.hurt(); this.player.obj.setTint(0xff6666);
        this.time.delayedCall(110, () => { if (this.player.obj.active) this.player.obj.clearTint(); });
        this.hurtCd = 0.45;
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
          this.dealDamage(e, this.stats.dmg * (this.orbEvolved ? 1.0 : 0.6) * (1 + 0.12 * this.stats.orbit), true, false); e.orbCd = 0.35;
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
      this.auraT = this.auraEvolved ? 0.35 : 0.5; // 平衡:光环太强,降频
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < R + e.r) {
          this.dealDamage(e, this.stats.dmg * 0.22 * this.stats.aura * (1 + 0.12 * this.stats.aura) * (this.auraEvolved ? 1.6 : 1), true, true);
          if (this.auraEvolved && !e.dead) e.slowT = 0.25;
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
      this.zapLine(last.x, last.y, best.x, best.y);
      last = { x: best.x, y: best.y };
      this.dealDamage(best, this.stats.dmg * 0.8 * (1 + 0.12 * this.stats.chain) * (this.chainEvolved ? 1.5 : 1), true, false);
    }
  }
  // ---------- 回旋镖(飞出再飞回,来回切割) ----------
  throwBooms() {
    const n = this.stats.boom, tgt = this.nearest(this.player.x, this.player.y);
    const base = tgt ? Phaser.Math.Angle.Between(this.player.x, this.player.y, tgt.x, tgt.y) : 0;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n-1)/2) * 0.5;
      const obj = this.add.image(this.player.x, this.player.y, 'projectile').setDepth(4).setDisplaySize(this.boomEvolved ? 30 : 24, this.boomEvolved ? 30 : 24).setTint(0x80ffd0);
      this.booms.push({ x: this.player.x, y: this.player.y, a, t: 0, phase: 0, hit: new Set(), obj, dmg: this.stats.dmg * (this.boomEvolved ? 1.5 : 0.9) * (1 + 0.12 * this.stats.boom) });
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
          b.hit.add(e); this.dealDamage(e, b.dmg, true, false);
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
    this.frostT = this.frostEvolved ? 1.0 : 1.6; // 平衡:冰霜提频,成为真伤害选项
    const R = (90 + this.stats.frost * 30) * (this.frostEvolved ? 1.4 : 1);
    this.ring(this.player.x, this.player.y, this.frostEvolved ? 0xb0e0ff : 0x9fe0ff, R);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < R + e.r) {
        this.dealDamage(e, this.stats.dmg * 0.5 * this.stats.frost * (1 + 0.12 * this.stats.frost) * (this.frostEvolved ? 1.6 : 1), true, true);
        if (!e.dead) e.slowT = this.frostEvolved ? 0.8 : 0.45;
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
  // ---------- 无尽阶段(5 分钟通关后,每 45s 一阶:白送强化 + 金币,给硬核玩家"摸顶后还能爬"的天花板) ----------
  updateEndless(dt) {
    if (!this.won || this.endlessChoosing || this.elapsed < this.endlessNextT) return;
    this.endlessTier++; this.endlessNextT += 45;
    this.ring(this.player.x, this.player.y, 0xff9a40, 160);
    this.offerEndlessChoice(); // 从"白送强化"升级为"祝福/诅咒抉择":贪婪=更强但代价更大,给后期真正的取舍与 escalating stakes
  }
  endlessBoons() {
    const safe = this.weightedPick(this.upgradePool(), 1)[0];
    return [
      { t: '💪 强化(无代价)\n' + (safe ? safe.t : '随机强化'), safe: true, f: () => { if (safe) safe.f(); } },
      { t: '🔥 狂化\n全伤 +30% · 敌速 +12%', f: () => { this.stats.dmg *= 1.3; this.endlessEnemySpd *= 1.12; } },
      { t: '⚡ 超载\n攻速 +25% · 生命上限 -12%', f: () => { this.stats.fireCd = Math.max(0.12, this.stats.fireCd * 0.8); this.player.maxHp = Math.round(this.player.maxHp * 0.88); this.player.hp = Math.min(this.player.hp, this.player.maxHp); } },
      { t: '🌀 增殖\n金币 ×1.6 · 每波多刷 1 怪', f: () => { this.endlessSpawnBonus += 1; this.endlessGold *= 1.6; } },
      { t: '🩸 献祭\n全伤 +50% · 失去 25% 当前血', f: () => { this.stats.dmg *= 1.5; this.player.hp = Math.max(1, Math.floor(this.player.hp * 0.75)); } },
    ];
  }
  offerEndlessChoice() {
    const boons = this.endlessBoons();
    const pick = [boons[0], ...Phaser.Utils.Array.Shuffle(boons.slice(1)).slice(0, 2)]; // 1 安全 + 2 诅咒
    this.paused = true; this.endlessChoosing = true;
    const layer = [];
    layer.push(this.add.rectangle(W/2, H/2, W, H, 0x1a0e00, 0.80).setDepth(20));
    layer.push(mkText(this, W/2, H/2-200, `🔥 无尽 ${this.endlessTier} 阶 · 祝福与诅咒`, { fontSize: '23px', color: '#ff9a40', fontStyle: 'bold' }).setOrigin(0.5).setDepth(21));
    layer.push(mkText(this, W/2, H/2-166, '选一个 · 越贪越强,代价越大', { fontSize: '13px', color: '#cde' }).setOrigin(0.5).setDepth(21));
    pick.forEach((u, i) => {
      const cy = H/2 - 80 + i*112;
      const card = this.add.rectangle(W/2, cy, 400, 96, u.safe ? 0x16331f : 0x33180e).setStrokeStyle(2, u.safe ? 0x7be86a : 0xff9a40).setDepth(21).setInteractive();
      const txt = mkText(this, W/2, cy, u.t, { fontSize: '17px', color: '#fff', align: 'center' }).setOrigin(0.5).setDepth(22);
      card.on('pointerover', () => card.setFillStyle(u.safe ? 0x1f4a2c : 0x4a2414));
      card.on('pointerout', () => card.setFillStyle(u.safe ? 0x16331f : 0x33180e));
      card.on('pointerup', () => {
        u.f(); this.checkEvolutions();
        const gold = Math.round(60 * this.endlessGold); META.setCoins(META.coins() + gold);
        layer.forEach(o => o.destroy()); card.destroy(); txt.destroy();
        this.paused = false; this.endlessChoosing = false;
        this.banner(`🔥 无尽 ${this.endlessTier} 阶 · +${gold}💰`, '#ff9a40');
      });
      layer.push(card, txt);
    });
  }
  checkEvolutions() {
    // 进化门槛差异化(每把武器自己的节奏,不再一刀切);bolt 去掉 pierce 双条件补足可达性(原仅~8%进化率)
    if (!this.boltEvolved && this.stats.projCount >= 4) { this.boltEvolved = true; this.evolveBanner('多重散射弹'); }
    if (!this.orbEvolved && this.stats.orbit >= 3) { this.orbEvolved = true; this.orbiters.forEach(o => o.setDisplaySize(34, 34).setTint(0xfff0a0)); this.evolveBanner('光刃环'); }
    if (!this.auraEvolved && this.stats.aura >= 3) { this.auraEvolved = true; if (this.auraObj) this.auraObj.setFillStyle(0xc0a0ff, 0.16); this.evolveBanner('奥能风暴'); }
    if (!this.chainEvolved && this.stats.chain >= 2) { this.chainEvolved = true; this.evolveBanner('连锁风暴'); }   // 链最弱→最早进化,给"速成控场"身份
    if (!this.frostEvolved && this.stats.frost >= 3) { this.frostEvolved = true; this.evolveBanner('暴风雪'); }
    if (!this.boomEvolved && this.stats.boom >= 4) { this.boomEvolved = true; this.evolveBanner('环切飞轮'); }       // 镖最强→门槛最高,作为高投入回报
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
          const ka = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y); // 受击击退,打击更实
          e.x += Math.cos(ka) * 6; e.y += Math.sin(ka) * 6;
          this.dealDamage(e, pr.dmg, true, false);
          if (pr.pierce > 0) pr.pierce--; else { pr.dead = true; }
          break;
        }
      }
    }
    this.projs = this.projs.filter(pr => { if (pr.dead) pr.obj.destroy(); return !pr.dead; });
  }
  dealDamage(e, raw, canCrit, silent) { // 统一伤害:所有武器都能暴击(白闪+飘字+击杀);silent=AoE 不飘字防刷屏
    if (e.dead) return;
    let dmg = raw, crit = false;
    if (canCrit && Math.random() < this.stats.crit) { dmg *= this.stats.critMul; crit = true; }
    e.hp -= dmg;
    if (this.heroPassive === 'cryo' && e.hp > 0 && e !== this.boss) e.slowT = Math.max(e.slowT || 0, 0.3); // 冰法被动:任意命中即减速 → 整局控场
    e.obj.setTintFill(0xffffff);
    this.time.delayedCall(55, () => { if (e.obj && e.obj.active && !e.dead) e.obj.clearTint(); });
    if (!silent) this.floatText(e.x, e.y - e.r, '' + Math.round(dmg), crit ? '#ffd23a' : '#ffffff', crit);
    if (e.hp <= 0) this.killEnemy(e);
  }
  dropGem(x, y, xp, big) {
    const g = this.add.image(x, y, 'gem').setDepth(2).setDisplaySize(big ? 28 : 18, big ? 28 : 18);
    this.gems.push({ x, y, xp, obj: g });
  }
  killEnemy(e) {
    if (e.dead) return;
    e.dead = true; this.kills++;
    this.combo++; this.comboT = 2.0;
    if (this.combo === 25 || this.combo === 50 || this.combo === 100 || this.combo === 200) { this.banner('🔥 连杀 x' + this.combo + '!', '#ff9a40'); } // 去掉回血(原来连杀=不死=无敌源)
    this.burst(e.x, e.y, e.col, (e.type === 'tank' || e.type === 'boss') ? 12 : 6); SFX.kill();
    if (e.splits) { for (let k = 0; k < 2; k++) this.addEnemy('mini', e.x + (Math.random()-0.5)*30, e.y + (Math.random()-0.5)*30); } // 分裂怪
    if (e.explodes) { // 自爆怪:死后预警 → 0.45s 范围爆炸(逼你别贴脸,近战/光球流要注意)
      const ex = e.x, ey = e.y;
      this.ring(ex, ey, 0xffa000, 40);
      this.time.delayedCall(450, () => {
        if (this.over) return;
        this.ring(ex, ey, 0xff5a5a, 100); this.cameras.main.shake(160, 0.007);
        if (Phaser.Math.Distance.Between(ex, ey, this.player.x, this.player.y) < 100 + this.player.r && this.hurtCd <= 0) {
          this.player.hp -= 18 * this.contactScale(); this.hurtCd = 0.45;
          this.player.obj.setTint(0xff6666); this.time.delayedCall(110, () => { if (this.player.obj.active) this.player.obj.clearTint(); });
          if (this.player.hp <= 0) this.end();
        }
      });
    }
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
    if (this.gems.length > 42) for (const gm of this.gems) gm.magnet = true; // 硬保底:同屏>42 颗全吸,后期击杀爆炸不再漏一地
    const drift = this.elapsed > 140;                                    // 后期所有宝石被动慢速自吸,补"吸不过来"的尾巴
    for (const gm of this.gems) {
      const d = Phaser.Math.Distance.Between(gm.x, gm.y, p.x, p.y);
      if (gm.magnet || drift || d < this.stats.pickup) {                 // magnet=升级时全屏吸附,根治"宝石烂在地上"
        const a = Phaser.Math.Angle.Between(gm.x, gm.y, p.x, p.y);
        const sp = gm.magnet ? 700 : (d < this.stats.pickup ? 420 : 95);
        gm.x += Math.cos(a)*sp*dt; gm.y += Math.sin(a)*sp*dt; gm.obj.x = gm.x; gm.obj.y = gm.y;
        if (d < p.r + 8) { gm.got = true; this.xp += gm.xp * (this.heroPassive === 'mage' ? 1.2 : 1); gm.obj.destroy(); if (this.xp >= this.xpNeed) this.levelUp(); } // 法师被动:经验+20%
      }
    }
    this.gems = this.gems.filter(gm => !gm.got);
  }
  weightedPick(pool, n) { // 加权无放回抽样:让 build 可定向(已投资+接近进化的项更易出现)
    const s = this.stats;
    const inv = { proj: s.projCount - 1, pierce: s.pierce, orbit: s.orbit, aura: s.aura, chain: s.chain, frost: s.frost, boom: s.boom };
    const evoNeed = { proj: 4, orbit: 3, aura: 3, chain: 2, frost: 3, boom: 4 }; // 差一步进化的项重点推(与 checkEvolutions 门槛同步)
    const wt = (u) => {
      let w = 1;
      const subs = ['orbit', 'aura', 'chain', 'frost', 'boom'];
      if (subs.includes(u.k) && (s[u.k] || 0) === 0) w += 0.9;  // 未开的副武器给点起步权重,别让某条线永远沉底(够得到回旋镖)
      if (u.k in inv && inv[u.k] > 0) w += 2 + inv[u.k];        // 已开的武器线滚起来
      if (u.k in evoNeed && (s[u.k] || (u.k === 'proj' ? s.projCount : 0)) === evoNeed[u.k] - 1) w += 5; // 临门一脚
      return w;
    };
    const avail = pool.slice(), picks = [];
    while (picks.length < n && avail.length) {
      const ws = avail.map(wt), total = ws.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < avail.length - 1; idx++) { r -= ws[idx]; if (r <= 0) break; }
      picks.push(avail.splice(idx, 1)[0]);
    }
    return picks;
  }
  levelUp() {
    this.xp -= this.xpNeed; this.level++; this.xpNeed = Math.floor(this.xpNeed * 1.22 + 4); // 斜率 1.38→1.22:升级不再越来越遥不可及
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
    for (const gm of this.gems) gm.magnet = true;                       // 升级=全屏吸宝:把散落的成长一次性收回来
    if (this.heroPassive === 'assassin') this.stats.crit += 0.012;      // 刺客被动:暴击率随等级滚雪球
    if (this.heroPassive === 'ranger' && this.level % 4 === 0) this.stats.projCount += 1; // 游侠被动:每 4 级白嫖一发
    this.ring(this.player.x, this.player.y, 0x8affc0, 110); SFX.level();
    this.paused = true; this.leveling = true;
    if (this.level >= 15) this.tryAch('lv15');
    const pick = this.weightedPick(this.upgradePool(), 3); // 加权:已投资/接近进化的武器更易出现 → 玩家能定向 build
    if (this.level % 3 === 0) { // 每 3 级保底:至少给一个输出强化(避免歪到没伤害卡墙)
      const dk = ['⚔ 伤害 +25%', '🔥 攻速 +20%', '➕ 多一发子弹'];
      if (!pick.some(u => dk.includes(u.t))) { const d = this.upgradePool().find(u => dk.includes(u.t)); if (d) pick[2] = d; }
    }
    const layer = [];
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
    this.hpText = mkText(this, W/2, 18, '', { fontSize: '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    this.add.rectangle(W/2, 40, W-30, 10, 0x222).setDepth(10);
    this.xpFill = this.add.rectangle(16, 40, 0, 10, 0x8affc0).setOrigin(0,0.5).setDepth(11);
    this.info = mkText(this, W/2, 58, '', { fontSize: '15px', color: '#cde' }).setOrigin(0.5,0).setDepth(11);
    this.comboText = mkText(this, W/2, 80, '', { fontSize: '16px', color: '#ff9a40', fontStyle: 'bold' }).setOrigin(0.5,0).setDepth(11);
    mkText(this, W/2, H-24, '拖动摇杆 / WASD 移动 · 自动开火 · 活得越久越强', { fontSize: '11px', color: '#7a9' }).setOrigin(0.5,0).setDepth(10);
    this.buildText = mkText(this, 10, H-44, '', { fontSize: '13px', color: '#cde' }).setOrigin(0, 1).setDepth(11); // 当前武器/build
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
    this.hpText.setText('❤ ' + Math.max(0, Math.ceil(this.player.hp)) + ' / ' + this.player.maxHp);
    this.xpFill.width = (W-30) * Math.max(0, this.xp / this.xpNeed);
    this.info.setText(`Lv.${this.level}   ⏱ ${Math.floor(this.elapsed)}s   💀 ${this.kills}`);
    let b = '🔫' + this.stats.projCount + (this.boltEvolved ? '★' : '');
    const s = this.stats;
    if (s.orbit) b += ' 🛡' + s.orbit + (this.orbEvolved ? '★' : '');
    if (s.aura) b += ' 🌀' + s.aura + (this.auraEvolved ? '★' : '');
    if (s.chain) b += ' ⚡' + s.chain + (this.chainEvolved ? '★' : '');
    if (s.frost) b += ' ❄' + s.frost + (this.frostEvolved ? '★' : '');
    if (s.boom) b += ' 🪃' + s.boom + (this.boomEvolved ? '★' : '');
    this.buildText.setText(b);
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
    const rankedUp = rankOf(secs).name !== rankOf(best).name && secs > best; // 晋级判定(在写入 best 之前)
    if (isRecord) localStorage.setItem(BEST_KEY, String(secs));
    if (secs > dailyBest()) localStorage.setItem('fm_daily_' + dayStr(), String(secs)); // 今日最佳
    pushBoard({ secs, lvl: this.level, kills: this.kills, d: dayStr() });                // 进本地排行榜

    this.add.rectangle(W/2, H/2, W, H, 0x000, 0.80).setDepth(30);
    mkText(this, W/2, H/2-150, isRecord ? '🏆 新纪录！' : '你倒下了', { fontSize: '40px', color: isRecord ? '#f5c84c' : '#ff7a7a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(31);
    mkText(this, W/2, H/2-90, `存活 ${secs} 秒 · Lv.${this.level} · 击杀 ${this.kills}${this.endlessTier > 0 ? ' · 🔥无尽' + this.endlessTier + '阶' : ''}`, { fontSize: '18px', color: '#cde' }).setOrigin(0.5).setDepth(31);
    const rkNow = rankOf(secs);
    mkText(this, W/2, H/2-58, rankedUp ? `🎖 晋级 ${rkNow.name}！` : `段位 ${rkNow.name} · 最佳 ${Math.max(secs, best)}s`, { fontSize: rankedUp ? '17px' : '13px', color: rankedUp ? rkNow.col : '#8aa', fontStyle: rankedUp ? 'bold' : 'normal' }).setOrigin(0.5).setDepth(31);
    if (rankedUp) this.cameras.main.flash(400, 90, 60, 20);
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
