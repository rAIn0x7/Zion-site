#!/usr/bin/env node
/**
 * IndexNow 批量提交 — 零依赖(Node 18+ 内置 fetch)
 *
 * 用法:
 *   node scripts/indexnow.js              # 默认 dry-run,只打印将要提交的 URL,不发请求
 *   node scripts/indexnow.js --go         # 真正提交
 *   node scripts/indexnow.js --go --endpoint=bing
 *   node scripts/indexnow.js --limit=20   # 只取前 20 条(调试用)
 *
 * 前置条件:
 *   1. 根目录存在 <key>.txt,内容与文件名(不含 .txt)完全一致
 *   2. 该文件已 push 到线上,https://qizh.space/<key>.txt 可访问
 *      —— IndexNow 会去拉这个文件校验所有权,拉不到就整批 403
 *
 * 注意:IndexNow 只被 Bing / Yandex / Seznam / Naver 一类引擎消费。
 *       百度和 Google 都不吃 IndexNow,别指望这个脚本能让百度收录。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'qizh.space';
const SITEMAP = path.join(ROOT, 'sitemap.xml');

// IndexNow 单次提交上限 10000 条,这里按 1000 分批,足够保守
const BATCH_SIZE = 1000;

const ENDPOINTS = {
  indexnow: 'https://api.indexnow.org/indexnow',
  bing: 'https://www.bing.com/indexnow',
  yandex: 'https://yandex.com/indexnow',
};

// ---------- 参数 ----------

function parseArgs(argv) {
  const opts = { go: false, endpoint: 'indexnow', limit: 0 };
  for (const arg of argv) {
    if (arg === '--go') opts.go = true;
    else if (arg === '--dry-run') opts.go = false;
    else if (arg.startsWith('--endpoint=')) opts.endpoint = arg.slice('--endpoint='.length);
    else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.slice('--limit='.length), 10) || 0;
    else if (arg === '-h' || arg === '--help') {
      console.log('用法: node scripts/indexnow.js [--go] [--endpoint=indexnow|bing|yandex] [--limit=N]');
      process.exit(0);
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  if (!ENDPOINTS[opts.endpoint]) {
    console.error(`--endpoint 只能是: ${Object.keys(ENDPOINTS).join(' / ')}`);
    process.exit(2);
  }
  return opts;
}

// ---------- 找 key ----------

/**
 * 在根目录找 IndexNow key 文件:文件名形如 <32位十六进制>.txt,
 * 且内容必须与文件名(去掉 .txt)严格相等。
 * 这条内容校验用来排掉微信/Google 一类同样放根目录的校验文件。
 */
function findKey() {
  const candidates = fs
    .readdirSync(ROOT)
    .filter((f) => /^[0-9a-f]{8,128}\.txt$/i.test(f));

  const matched = [];
  const rejected = [];

  for (const file of candidates) {
    const base = file.replace(/\.txt$/i, '');
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8').trim();
    if (content === base) matched.push(base);
    else rejected.push({ file, content });
  }

  if (rejected.length) {
    for (const r of rejected) {
      console.log(`  (跳过 ${r.file}:内容 "${r.content.slice(0, 24)}…" 与文件名不一致,不是 IndexNow key)`);
    }
  }

  if (matched.length === 0) {
    console.error('找不到有效的 IndexNow key 文件(根目录需有 <key>.txt,内容 == 文件名)。');
    process.exit(1);
  }
  if (matched.length > 1) {
    console.error(`根目录存在多个候选 key:${matched.join(', ')} —— 请只留一个。`);
    process.exit(1);
  }
  return matched[0];
}

// ---------- 读 sitemap ----------

function readSitemapUrls() {
  if (!fs.existsSync(SITEMAP)) {
    console.error(`读不到 ${SITEMAP}`);
    process.exit(1);
  }
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1]);

  const seen = new Set();
  const out = [];
  for (const u of urls) {
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      console.warn(`  跳过非法 URL: ${u}`);
      continue;
    }
    // IndexNow 要求同一批 URL 必须同 host,否则整批被拒
    if (parsed.host !== HOST) {
      console.warn(`  跳过非 ${HOST} 的 URL: ${u}`);
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// ---------- 提交 ----------

async function submitBatch(endpointUrl, key, urlList) {
  const body = {
    host: HOST,
    key,
    keyLocation: `https://${HOST}/${key}.txt`,
    urlList,
  };
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, text };
}

function explain(status) {
  switch (status) {
    case 200: return '已接收';
    case 202: return '已接收,但 key 还在验证中(确认 <key>.txt 已 push 到线上)';
    case 400: return '请求格式错误';
    case 403: return 'key 校验失败 —— 线上取不到 https://' + HOST + '/<key>.txt,或内容与文件名不一致';
    case 422: return 'URL 与 host 不匹配,或 URL 不合法';
    case 429: return '提交过于频繁,等一会儿再来';
    default: return '未知响应';
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const endpointUrl = ENDPOINTS[opts.endpoint];

  console.log('IndexNow 提交器');
  console.log(`  host      : ${HOST}`);
  const key = findKey();
  console.log(`  key       : ${key}`);
  console.log(`  keyLocation: https://${HOST}/${key}.txt`);
  console.log(`  endpoint  : ${endpointUrl}`);

  let urls = readSitemapUrls();
  if (opts.limit > 0) urls = urls.slice(0, opts.limit);
  console.log(`  URL 数量  : ${urls.length}`);
  console.log(`  模式      : ${opts.go ? '真实提交 (--go)' : 'DRY-RUN(不发请求,加 --go 才真提交)'}`);
  console.log('');

  urls.forEach((u, i) => console.log(`  ${String(i + 1).padStart(3)}. ${u}`));
  console.log('');

  if (!opts.go) {
    console.log('DRY-RUN 结束,什么都没提交。确认无误后跑:');
    console.log('  node scripts/indexnow.js --go');
    return;
  }

  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) batches.push(urls.slice(i, i + BATCH_SIZE));

  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`提交第 ${i + 1}/${batches.length} 批(${batch.length} 条)… `);
    try {
      const { status, text } = await submitBatch(endpointUrl, key, batch);
      const ok = status === 200 || status === 202;
      if (!ok) failed++;
      console.log(`HTTP ${status} — ${explain(status)}${text ? ` | ${text.slice(0, 200)}` : ''}`);
    } catch (err) {
      failed++;
      console.log(`请求失败: ${err.message}`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log('全部批次已被接收。收录仍需引擎自己排队,不是立刻可搜。');
  } else {
    console.log(`有 ${failed} 批未成功,按上面的状态码提示排查。`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
