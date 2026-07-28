#!/usr/bin/env node
/**
 * Zion 站事件度量 · 看数窗口 — 零依赖(Node 18+ 内置 fetch)
 *
 * 用法:
 *   node scripts/stats.js                 # 最近 7 天
 *   node scripts/stats.js --days=1        # 最近 1 天
 *   node scripts/stats.js --days=30
 *   node scripts/stats.js --tool=moyu     # 只看某个工具
 *   node scripts/stats.js --raw           # 附最近 20 条原始事件(确认埋点是否真的在进库)
 *   node scripts/stats.js --json          # 输出 JSON,方便管道
 *
 * 维护:
 *   node scripts/stats.js --purge-local   # 删掉 host='local' 的本地联调数据
 *   node scripts/stats.js --prune=180     # 删掉 180 天前的事件(隐私声明里承诺了会定期清理)
 *
 * 前置:Supabase PAT 放在 ~/.supabase_pat(或环境变量 SUPABASE_PAT)。
 *       anon key 只有 INSERT 权限、读不了任何数据 —— 看数必须走 PAT + Management API,
 *       这也是"数据读不走"这条安全性质的另一面。
 *
 * 关键维度:host = main(主站 qizh.space) / mirror(镜像 rain0x7.github.io,微信里能打开的那个)。
 *          mirror 的占比 ≈ 微信渠道贡献了多少真实游玩量。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_REF = 'uzvguynixndzusrlqryo';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const EVENT_ORDER = ['result_shown', 'share_click', 'qr_shown', 'copy_report', 'unlock', 'cross_click'];
const EVENT_CN = {
  result_shown: '出结果(真的玩了)',
  share_click: '点分享/生成卡',
  qr_shown: '看到镜像二维码',
  copy_report: '复制文字战报',
  unlock: '锁区解锁',
  cross_click: '点导流条',
};
const HOST_CN = { main: '主站 qizh.space', mirror: '镜像 (微信)', local: '本地/开发', other: '其他' };
const REF_CN = {
  wechat: '微信', search: '搜索引擎', social: '社交平台',
  internal: '站内跳转', direct: '直接访问', other: '其他',
};

// ---------- 参数 ----------

function parseArgs(argv) {
  const o = { days: 7, tool: null, raw: false, json: false, purgeLocal: false, prune: null };
  for (const a of argv.slice(2)) {
    let m;
    if ((m = a.match(/^--days=(\d+)$/))) o.days = Math.max(1, Math.min(365, +m[1]));
    else if ((m = a.match(/^--tool=([a-z0-9_-]+)$/))) o.tool = m[1];
    else if ((m = a.match(/^--prune=(\d+)$/))) o.prune = Math.max(1, +m[1]);
    else if (a === '--purge-local') o.purgeLocal = true;
    else if (a === '--raw') o.raw = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') { o.help = true; }
    else { console.error(`未知参数:${a}(用 --help 看用法)`); process.exit(2); }
  }
  return o;
}

function readPat() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT.trim();
  const p = path.join(os.homedir(), '.supabase_pat');
  if (!fs.existsSync(p)) {
    console.error(`找不到 PAT:既没有环境变量 SUPABASE_PAT,也没有 ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').trim();
}

// ---------- 查询 ----------

async function q(pat, sql) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      // Management API 前面挂了 Cloudflare,不带 UA 会被 1010 拦掉
      'User-Agent': 'zion-stats/1.0',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { throw new Error(`返回不是 JSON: ${text.slice(0, 200)}`); }
}

// ---------- 输出小工具 ----------

const C = process.stdout.isTTY
  ? { d: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', r: '\x1b[0m' }
  : { d: '', b: '', g: '', y: '', c: '', r: '' };

// 中文字符占两列 → 手写宽度,不然表格全歪
function w(s) {
  let n = 0;
  for (const ch of String(s)) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return n;
}
const padR = (s, n) => String(s) + ' '.repeat(Math.max(0, n - w(s)));
const padL = (s, n) => ' '.repeat(Math.max(0, n - w(s))) + String(s);

function bar(frac, width = 22) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const full = Math.round(f * width);
  return '█'.repeat(full) + '·'.repeat(width - full);
}

function head(t) { console.log(`\n${C.b}${t}${C.r}\n${'─'.repeat(Math.min(64, w(t) + 26))}`); }

function shareTable(rows, labelOf, total, labelWidth = 20) {
  if (!rows.length) { console.log(`${C.d}(无数据)${C.r}`); return; }
  for (const row of rows) {
    const n = Number(row.n);
    const pct = total ? (n / total) : 0;
    console.log(`  ${padR(labelOf(row), labelWidth)} ${padL(n, 6)}  ${C.c}${bar(pct)}${C.r} ${padL((pct * 100).toFixed(1) + '%', 6)}`);
  }
}

// ---------- 主流程 ----------

async function main() {
  const opt = parseArgs(process.argv);
  if (opt.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }
  const pat = readPat();

  // ── 维护动作:跑完就退出,不再打报表 ──
  if (opt.purgeLocal) {
    const r = await q(pat, `with d as (delete from public.events where host='local' returning 1) select count(*) n from d;`);
    console.log(`已删除 host='local' 的本地联调数据:${r[0].n} 条`);
    return;
  }
  if (opt.prune) {
    const r = await q(pat, `with d as (delete from public.events where ts < now() - interval '${opt.prune} days' returning 1) select count(*) n from d;`);
    console.log(`已删除 ${opt.prune} 天前的事件:${r[0].n} 条`);
    return;
  }

  const days = opt.days;
  const toolFilter = opt.tool ? `and tool = '${opt.tool}'` : '';
  const W = `where ts > now() - interval '${days} days' ${toolFilter}`;

  const [total, byEvent, byTool, byHost, byRef, byDay, hostXEvent, funnel, raw] = await Promise.all([
    q(pat, `select count(*) n from public.events ${W};`),
    q(pat, `select name, count(*) n from public.events ${W} group by 1 order by 2 desc;`),
    q(pat, `select coalesce(tool,'(无)') tool,
                    count(*) filter (where name='result_shown') plays,
                    count(*) filter (where name='share_click')  shares,
                    count(*) filter (where name='unlock')       unlocks,
                    count(*) n
             from public.events ${W} group by 1 order by plays desc, n desc;`),
    q(pat, `select host, count(*) n from public.events ${W} group by 1 order by 2 desc;`),
    q(pat, `select ref, count(*) n from public.events ${W} group by 1 order by 2 desc;`),
    q(pat, `select to_char(date_trunc('day', ts),'MM-DD') d,
                    count(*) filter (where name='result_shown') plays,
                    count(*) n
             from public.events ${W}
             group by date_trunc('day', ts) order by date_trunc('day', ts);`),
    q(pat, `select host,
                    count(*) filter (where name='result_shown') plays,
                    count(*) filter (where name='share_click')  shares
             from public.events ${W} group by 1 order by plays desc;`),
    q(pat, `select count(*) filter (where name='result_shown') plays,
                    count(*) filter (where name='share_click')  shares,
                    count(*) filter (where name='qr_shown')     qrs,
                    count(*) filter (where name='unlock')       unlocks,
                    count(*) filter (where name='cross_click')  crosses
             from public.events ${W};`),
    opt.raw
      ? q(pat, `select to_char(ts,'MM-DD HH24:MI') t, name, coalesce(tool,'-') tool, host, ref,
                       coalesce(meta::text,'-') meta
                from public.events ${W} order by ts desc limit 20;`)
      : Promise.resolve([]),
  ]);

  const N = Number(total[0].n);

  if (opt.json) {
    console.log(JSON.stringify({ days, tool: opt.tool, total: N, byEvent, byTool, byHost, byRef, byDay, hostXEvent, funnel: funnel[0], raw }, null, 2));
    return;
  }

  console.log(`\n${C.b}📊 Zion 站事件度量 · 最近 ${days} 天${opt.tool ? ` · 工具=${opt.tool}` : ''}${C.r}`);
  console.log(`${C.d}事件总数 ${N} 条${C.r}`);

  if (!N) {
    console.log(`\n${C.y}最近 ${days} 天没有任何事件。${C.r}`);
    console.log(`${C.d}排查:① 站上是否已 push 带埋点的 ce/engine.js + assets/track.js`);
    console.log(`      ② 浏览器 DevTools → Network 里过滤 "events",看有没有 201`);
    console.log(`      ③ 用 --days=30 看看更早有没有数据${C.r}`);
    return;
  }

  head('① 各事件计数');
  const evRows = EVENT_ORDER.map(n => byEvent.find(r => r.name === n)).filter(Boolean)
    .concat(byEvent.filter(r => !EVENT_ORDER.includes(r.name)));
  const evMax = Math.max(...evRows.map(r => Number(r.n)));
  for (const r of evRows) {
    console.log(`  ${padR(EVENT_CN[r.name] || r.name, 22)} ${padL(r.n, 6)}  ${C.g}${bar(Number(r.n) / evMax)}${C.r}`);
  }

  head('② 主站 vs 镜像(本次最关键:镜像=微信渠道)');
  shareTable(byHost, r => HOST_CN[r.host] || r.host, N, 20);
  const hx = hostXEvent.filter(r => Number(r.plays) > 0);
  if (hx.length) {
    console.log(`\n  ${C.d}分 host 的"真的玩了 / 点分享":${C.r}`);
    for (const r of hx) {
      const p = Number(r.plays), s = Number(r.shares);
      console.log(`    ${padR(HOST_CN[r.host] || r.host, 20)} 出结果 ${padL(p, 5)} · 分享 ${padL(s, 5)} · 分享率 ${p ? (s / p * 100).toFixed(1) : '0.0'}%`);
    }
  }

  head('③ 来源归类(从 referrer 归类,不存完整 URL)');
  shareTable(byRef, r => REF_CN[r.ref] || r.ref, N, 20);

  head('④ 工具排名(按"出结果"= 真的玩了)');
  console.log(`  ${padR('工具', 12)} ${padL('出结果', 8)} ${padL('分享', 6)} ${padL('解锁', 6)} ${padL('分享率', 8)}`);
  for (const r of byTool.slice(0, 25)) {
    const p = Number(r.plays), s = Number(r.shares);
    console.log(`  ${padR(r.tool, 12)} ${padL(p, 8)} ${padL(s, 6)} ${padL(r.unlocks, 6)} ${padL(p ? (s / p * 100).toFixed(1) + '%' : '-', 8)}`);
  }

  head('⑤ 漏斗');
  const f = funnel[0], plays = Number(f.plays) || 0;
  const step = (label, v) => console.log(`  ${padR(label, 22)} ${padL(v, 6)}  ${plays ? padL((Number(v) / plays * 100).toFixed(1) + '%', 7) : ''}`);
  step('出结果', f.plays);
  step('└ 看到镜像二维码', f.qrs);
  step('└ 点分享', f.shares);
  step('└ 解锁完整版', f.unlocks);
  step('└ 点导流条去下一个', f.crosses);

  if (byDay.length > 1) {
    head('⑥ 按天');
    const dMax = Math.max(...byDay.map(r => Number(r.n)));
    for (const r of byDay) {
      console.log(`  ${padR(r.d, 8)} ${padL(r.n, 6)} 条 ${C.c}${bar(Number(r.n) / dMax, 18)}${C.r} ${C.d}出结果 ${r.plays}${C.r}`);
    }
  }

  if (opt.raw && raw.length) {
    head('⑦ 最近 20 条原始事件');
    for (const r of raw) {
      console.log(`  ${C.d}${r.t}${C.r}  ${padR(r.name, 14)} ${padR(r.tool, 10)} ${padR(r.host, 8)} ${padR(r.ref, 9)} ${C.d}${r.meta}${C.r}`);
    }
  }
  console.log('');
}

main().catch(e => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
