// Supabase Edge Function: send-daily
// 把当天筛出来的信号渲染成一页纸，发给付费会员（subscribers.is_pro = true）。
//
// 为什么推邮件而不是让人来星球看：付了钱的人不该被要求每天想起来打开一个 App。
// 同一份内容也要贴进星球，两个理由：①《星主规则》2.2.3 的更新义务判的是「星球内容」，
// 只发邮件不发帖有歧义 ②星球里的帖子是归档，新会员能往回翻。
//
// ⚠️ 部署必须带 --no-verify-jwt，否则退订链接在网关层就 401：
//   cd /home/test/Zion-site   ← 在仓库根跑，不是在函数目录里跑
//   supabase functions deploy send-daily --project-ref uzvguynixndzusrlqryo --no-verify-jwt
//
// 定时：Supabase → Database → Cron，每天 UTC 00:30 = 北京 08:30
//   select net.http_post(
//     url:='https://uzvguynixndzusrlqryo.supabase.co/functions/v1/send-daily',
//     headers:='{"x-webhook-secret":"<密钥>"}'::jsonb);
//
// 参数：?dry=1 只看不发 · ?to=a@x,b@y 指定收件人
//      ?unsub=<email>&t=<sig> 退订，邮件里的链接，不需要密钥
//
// 额度：Resend 免费 3000 封/月，日更 = 30 × 会员数，撑到约 100 个付费会员。

const RESEND = "https://api.resend.com/emails";
const PICK = 6;
const MIN_SCORE = 8;   // 库里只存 7 分以上，这里再抬一档

// 作者本人的判断从这里取（可选）。仓库 gen/zion-note.txt，第一行 YYYY-MM-DD，后面正文。
// 日期不是今天就当没写，那一块不渲染，邮件照发。一页纸本身是全自动的，不依赖这个。
// ⚠️ 这个 URL 是公开的（Zion-site 是 public 仓库）。如果哪天真的天天写、且不想白送，
//    把它挪进 Supabase 表，别放 git。现在是可选块，先不为它建基建。
const NOTE_URL = "https://qizh.space/gen/zion-note.txt";

const GLM = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const GLM_MODELS = ["glm-4.5-flash", "glm-4-flash"];
const MAX_NOTE = 60;

// 四个盘子。原来只取 articles 一张表，导致"今天进来 18 条"这种小得难看的分母，
// 而实际上 Lens 每天在四条线上一起抓。合起来取，分母是真的，候选也够。
const FEEDS = [
  { table: "articles",         vert: "加密·AI" },
  { table: "startup_articles", vert: "创投" },
  { table: "stock_articles",   vert: "股市" },
  { table: "metal_articles",   vert: "大宗" },
];

// 把内部分类归成大众看得懂的主题。近 30 天实测占比：
// 加密 29.8% / 经济财报 18.9% / AI 14.5% / 监管 12.6% / 能源金属 12.2% / 科技公司 7.9% / 创业融资 4.1%
// 加密量最大，但 8 分以上只占 45%，AI 是 68%。所以给 AI 和科技留保底席、给加密抬门槛封顶，
// 结果偏科技又没牺牲覆盖，文案也就不用骗人。
const THEME: Record<string, string> = {
  ai: "AI", tools: "AI",
  tech: "科技", elon: "科技",
  crypto: "加密", onchain: "加密", cross: "加密",
  regulation: "监管",
  macro: "宏观", earnings: "财报",
  oil: "能源", gold: "金属", silver: "金属",
  startup: "创业", funding: "融资", overseas: "出海", indie: "创业",
};
const themeOf = (c: string | null) => THEME[c ?? ""] ?? "其他";

// 2026-07-31 改回：加密不再压制，和其它主题同等对待。
// 原因：加密+经济财报占语料 48.7%，而中文里对「筛好的信息」付费意愿最强、最习惯订阅制、
// 对时效最敏感的恰恰是这批人；AI 资讯免费替代最多、付费意愿最低。压加密等于把产品
// 从有市场的一侧推向没市场的一侧。验证办法见存档页品类点击分布，跑两周再定。
// 保底席。加了加密，原因是四张表打分没有共同校准：stock/metal 天天出 10 分，
// articles(加密那张)天花板是 9 分，合池按分数排的话加密永远进不来，跟内容重要性无关。
// 治本要做跨表分数归一化，这里先用保底席顶住。
const RESERVE = ["AI", "科技", "加密"];
const CAP: Record<string, number> = {};          // 不给任何主题开小灶，也不压任何主题
const CAP_DEFAULT = 2;

const CAT_ZH: Record<string, string> = {
  cross: "跨界", ai: "AI", regulation: "监管", crypto: "加密", onchain: "链上",
  macro: "宏观", tech: "科技", earnings: "财报", elon: "马斯克",
  overseas: "出海", startup: "创业", funding: "融资", tools: "工具",
  oil: "原油", gold: "黄金", silver: "白银", other: "其他",
};

// 光在 prompt 里求它不管用（实测 glm-4-flash 出过 73/96 字，照样写「投资者需关注」）。
// 这些词在代码层拦，命中就重试，重试还中就不显示。后半批是从实际输出里抓的漏网。
const BANNED = [
  "投资者", "对投资者而言", "值得关注", "需关注", "密切关注", "意义重大", "里程碑",
  "标志着", "预示着", "随着", "不仅", "综上", "总之", "赋能", "抓手", "——",
  "警钟", "敲响", "警示", "需谨慎", "成关键", "新格局", "风向", "更稳定", "可预测",
];

const NOTE_PROMPT = `把下面这段英文分析压成一句中文，给中文读者看。硬要求：
1. 只输出那一句话。不要引号，不要前后缀，不要解释
2. **不超过 40 个字**
3. 说"这件事之后什么变了"，不要复述新闻本身
4. 绝对不许出现：投资者、值得关注、需关注、密切关注、意义重大、里程碑、标志着、预示着、随着、不仅、警钟、警示、需谨慎、成关键、新格局
5. 不许破折号，不许"不是X而是Y"
6. 平实口语，像跟朋友说一句话，不是投研报告
7. 标题里说过的话一个字都不许重复。只写"谁的什么变了"，要有一个具体名词加一个具体动作。写不出来就只输出四个字：无增量`;

type Row = {
  title: string;
  original_url: string;
  summary_zh: string | null;
  editor_note: string | null;
  importance_score: number;
  category: string | null;
  is_featured: boolean | null;
  published_at: string | null;
  vert?: string;
  zh_note?: string | null;
  note_fail?: string | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function todayCN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

/** 二元组重合超过 th 判为重复。速读比标题用 0.45，条目之间用 0.30（同一新闻多源报道时措辞差异大） */
function dupish(a: string, b: string, th = 0.45): boolean {
  const g = (s: string) => {
    const t = s.replace(/[^一-龥A-Za-z0-9]/g, "");
    const o = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2));
    return o;
  };
  const A = g(a), B = g(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const x of B) if (A.has(x)) hit++;
  return hit / B.size > th;
}

/** 取标题开头的主体词，用来抓「同一家公司的两条新闻」 */
function subjectOf(s: string): string {
  const m = s.match(/^[一-龥A-Za-z]{2,6}/);
  return m ? m[0].slice(0, 3) : "";
}

function badNote(t: string): string | null {
  if (t === "无增量") return "模型自认无增量";
  if (t.length < 8) return `太短 ${t.length} 字`;
  if (t.length > MAX_NOTE) return `超长 ${t.length} 字`;
  const hit = BANNED.find((b) => t.includes(b));
  return hit ? `命中禁用词「${hit}」` : null;
}

async function callGlm(text: string, key: string, model: string, extra = ""): Promise<string | null> {
  try {
    const r = await fetch(GLM, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.2,
        messages: [
          { role: "system", content: NOTE_PROMPT + extra },
          { role: "user", content: text.slice(0, 1800) },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content?.trim();
    return out ? out.replace(/^["“']|["”']$/g, "").replace(/^\s*[-·]\s*/, "") : null;
  } catch { return null; }
}

/** 返回 [速读, 失败原因]。宁可空着，也不把没过关的糊上去。 */
async function zhNote(text: string, key: string): Promise<[string | null, string | null]> {
  for (const model of GLM_MODELS) {
    let out = await callGlm(text, key, model);
    if (!out) continue;
    let why = badNote(out);
    if (!why) return [out, null];
    if (why === "模型自认无增量") return [null, why];
    out = await callGlm(text, key, model, `\n\n你上一次的输出被拒了，原因：${why}。这次务必 40 字内，一个禁用词都不许出现。`);
    if (out) {
      why = badNote(out);
      if (!why) return [out, null];
    }
    if (model === GLM_MODELS[GLM_MODELS.length - 1]) return [null, why ?? "重试仍不合规"];
  }
  return [null, "两个模型都没出合规结果"];
}

/** 取作者今天写的「Zion 按」。没写、或写的是别的日期，返回 null。 */
async function zionNote(): Promise<string | null> {
  try {
    const r = await fetch(`${NOTE_URL}?t=${Date.now()}`);
    if (!r.ok) return null;
    const [d, ...rest] = (await r.text()).trim().split("\n");
    const body = rest.join(" ").trim();
    return d.trim() === todayCN() && body ? body : null;
  } catch { return null; }
}

async function sig(email: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(email));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function pick(rows: Row[], n: number): Row[] {
  const byScore = (a: Row, b: Row) => {
    if (!!b.is_featured !== !!a.is_featured) return b.is_featured ? 1 : -1;
    if (b.importance_score !== a.importance_score) return b.importance_score - a.importance_score;
    return (b.published_at ? Date.parse(b.published_at) : 0) - (a.published_at ? Date.parse(a.published_at) : 0);
  };
  const sorted = [...rows].sort(byScore);

  const out: Row[] = [];
  const cnt = new Map<string, number>();
  const headOf = (r: Row) => r.summary_zh?.trim() || r.title;
  // 同一条新闻常被多个源报道（今天六条里微软占两条、亚马逊占两条）。
  // 已选中的标题和候选标题重合度高就跳过，只留分数最高那条。
  const seen = (r: Row) => out.some((o) => {
    const a = headOf(o), b = headOf(r);
    const sa = subjectOf(a), sb = subjectOf(b);
    if (sa && sa === sb) return true;                       // 同一主体，一天只留一条
    return dupish(a, b, 0.30) || dupish(b, a, 0.30);
  });
  const take = (r: Row) => {
    out.push(r);
    const t = themeOf(r.category);
    cnt.set(t, (cnt.get(t) ?? 0) + 1);
  };
  const room = (r: Row) => (cnt.get(themeOf(r.category)) ?? 0) < (CAP[themeOf(r.category)] ?? CAP_DEFAULT);

  for (const want of RESERVE) {              // 一轮：AI 和科技各占一席，没有就跳过
    if (out.length >= n) break;
    const hit = sorted.find((r) => !out.includes(r) && !seen(r) && themeOf(r.category) === want);
    if (hit) take(hit);
  }
  for (const r of sorted) {                  // 二轮：按分数补，每主题封顶
    if (out.length >= n) break;
    if (out.includes(r) || !room(r) || seen(r)) continue;
    take(r);
  }
  for (const r of sorted) {                  // 三轮：放开主题封顶，但去重不放开
    if (out.length >= n) break;
    if (!out.includes(r) && !seen(r)) take(r);
  }
  return out.sort(byScore);
}

function render(rows: Row[], dateLabel: string, cutLine: string, zn: string | null, preheader: string): string {
  const items = rows.map((r, i) => {
    const head = r.summary_zh?.trim() || r.title;
    const note = r.zh_note && !dupish(head, r.zh_note) ? r.zh_note : null;
    let host = "";
    try { host = new URL(r.original_url).hostname.replace(/^www\./, ""); } catch { /* 坏 URL 就不显示域名 */ }
    return `
    <tr><td style="padding:18px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:12px;color:#8250DF;letter-spacing:.04em;margin-bottom:6px">
        ${String(i + 1).padStart(2, "0")} · ${esc(themeOf(r.category))}
      </div>
      <div style="font-size:17px;line-height:1.5;font-weight:600;color:#1f2328;margin-bottom:8px">
        <a href="${esc(r.original_url)}" style="color:#1f2328;text-decoration:none">${esc(head)}</a>
      </div>
      ${note ? `<div style="font-size:14px;line-height:1.7;color:#1f2328;background:#f6f8fa;border-left:3px solid #8250DF;padding:10px 12px">
        <span style="font-size:11px;color:#8250DF;letter-spacing:.08em">速读</span><br>${esc(note)}
      </div>` : ""}
      <div style="margin-top:10px"><a href="${esc(r.original_url)}" style="font-size:13px;color:#8250DF">读原文 → ${esc(host)}（英文）</a></div>
    </td></tr>`;
  }).join("");

  const znBlock = zn ? `
  <tr><td style="padding:18px 0 0">
    <div style="background:#f3f0ff;border-left:3px solid #8250DF;padding:14px 16px;font-size:15px;line-height:1.8;color:#1f2328">
      <div style="font-size:11px;color:#8250DF;letter-spacing:.1em;margin-bottom:6px">ZION 按</div>${esc(zn)}
    </div>
  </td></tr>` : "";

  return `<!doctype html><html><body style="margin:0;background:#f6f8fa">
<div style="display:none;font-size:1px;line-height:1px;color:#f6f8fa;max-height:0;max-width:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;padding:32px;font-family:-apple-system,'Noto Sans CJK SC',sans-serif">
  <tr><td style="padding-bottom:6px">
    <div style="font-size:12px;color:#8250DF;letter-spacing:.12em;font-weight:600">降噪 · 静音舱</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:2px">${dateLabel}</div>
  </td></tr>
  <tr><td style="padding:10px 0 4px">
    <div style="font-size:26px;line-height:1.35;font-weight:700;color:#1f2328">今天值得知道的 ${rows.length} 件事</div>
  </td></tr>
  <tr><td style="padding-bottom:14px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#f3f0ff;border-radius:6px;padding:8px 12px;font-size:13px;color:#4b3f7a">
        ${esc(cutLine)}
      </td>
    </tr></table>
  </td></tr>
  ${znBlock}
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table></td></tr>
  <tr><td style="padding-top:22px;font-size:13px;line-height:1.7;color:#6b7280">
    每条下面那行灰底的「速读」是模型压的，只讲这条新闻本身。${zn ? "顶上紫色那块「Zion 按」是我自己写的。<br>" : "<br>"}
    想问我什么，直接回这封信，我这边收得到。<br>
    <a href="{{UNSUB}}" style="color:#6b7280">不想收了，点这里，一下就删掉</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const u = new URL(req.url);

  // ── 退订：走签名，不要密钥。GET 点击和 One-Click POST 都落这里 ──
  if (u.searchParams.has("unsub")) {
    const email = (u.searchParams.get("unsub") || "").trim().toLowerCase();
    if (!secret || !url || !key || u.searchParams.get("t") !== await sig(email, secret)) {
      return new Response("这个链接已经失效了", {
        status: 400, headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    await fetch(`${url}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
    return new Response(
      `<meta charset="utf-8"><div style="font-family:sans-serif;padding:48px;color:#1f2328">已经把 ${esc(email)} 划掉了。明天早上八点半，收件箱里不会有这封。</div>`,
      { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") || "Zion <onboarding@resend.dev>";
  const replyTo = Deno.env.get("REPLY_TO") || "";
  if (!url || !key) return new Response("no supabase creds", { status: 500 });
  if (!apiKey) return new Response("no resend key", { status: 500 });

  const dry = u.searchParams.get("dry") === "1";
  const to = u.searchParams.get("to");
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // 1+2. 四个盘子并发取。每张表两趟：全量(只要 category/score，算分母和砍掉分布) + 候选。
  const perFeed = await Promise.all(FEEDS.map(async (f) => {
    const [aR, cR] = await Promise.all([
      fetch(`${url}/rest/v1/${f.table}?select=category,importance_score&created_at=gte.${since}&limit=1000`, { headers: h }),
      fetch(`${url}/rest/v1/${f.table}?select=title,original_url,summary_zh,editor_note,importance_score,category,published_at` +
            `&created_at=gte.${since}&importance_score=gte.${MIN_SCORE}&order=importance_score.desc&limit=100`, { headers: h }),
    ]);
    const allRows: { category: string | null; importance_score: number }[] = aR.ok ? await aR.json() : [];
    const cand: Row[] = cR.ok ? await cR.json() : [];
    for (const c of cand) c.vert = f.vert;                     // articles 有 is_featured，其余三张没有
    return { all: allRows, cand };
  }));

  const all = perFeed.flatMap((p) => p.all);
  const rows: Row[] = perFeed.flatMap((p) => p.cand);
  if (rows.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: `今天四个盘子里没有 >=${MIN_SCORE} 分的条目，跳过不发` }),
      { headers: { "content-type": "application/json" } });
  }

  const chosen = pick(rows, PICK);

  // 3. Zion 按：可选。写了就显示，没写邮件照发，一页纸本身是全自动的。
  const zn = await zionNote();

  // 4. 速读
  const glmKey = Deno.env.get("GLM_KEY");
  if (glmKey) {
    await Promise.all(chosen.map(async (r) => {
      if (!r.editor_note) return;
      const [note, why] = await zhNote(r.editor_note, glmKey);
      r.zh_note = note; r.note_fail = why;
    }));
  }

  // 5. 收件人
  let subs: { email: string }[];
  if (to) {
    subs = to.split(",").map((e) => ({ email: e.trim() })).filter((s) => s.email.includes("@"));
    if (subs.length === 0) return new Response("?to= 里没有合法邮箱", { status: 400 });
  } else {
    const subRes = await fetch(`${url}/rest/v1/subscribers?select=email&is_pro=is.true&is_active=is.true`, { headers: h });
    if (!subRes.ok) return new Response(`subscribers query failed: ${await subRes.text()}`, { status: 502 });
    subs = await subRes.json();
    if (subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "没有 is_pro=true 且 is_active=true 的订阅者" }),
        { headers: { "content-type": "application/json" } });
    }
  }

  // 6. 文案
  const total = all.length || rows.length;
  const cut = new Map<string, number>();
  for (const a of all) {
    if (a.importance_score < MIN_SCORE) {
      const c = a.category ?? "other";
      cut.set(c, (cut.get(c) ?? 0) + 1);
    }
  }
  const top = [...cut.entries()].sort((x, y) => y[1] - x[1])[0];
  const cutN = Math.max(0, total - chosen.length);
  const cutLine = top
    ? `机器读了 ${total} 条，砍掉 ${cutN} 条。砍得最狠的是${CAT_ZH[top[0]] ?? top[0]}。`
    : `机器读了 ${total} 条，砍掉 ${cutN} 条。`;

  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long",
  }).format(new Date());
  const md = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
  }).format(new Date());

  // 主题行：中文在前。原来用英文 title 截 24 字，QQ 列表里只看得到日期
  const lead = (chosen[0].summary_zh?.trim() || chosen[0].title).replace(/[。.]$/, "");
  // 主题行：日期+条数在前(列表里一眼认出是哪封)，当天最重那条在后(决定点不点开)。
  // 砍掉数不进主题行，每天结构相同会被训练成噪音，它进 preheader。
  const mdc = md.replace(/[^0-9]/g, "").padStart(4, "0");
  const subject = `${mdc} 六条 · ${lead.slice(0, 22)}`;
  const preheader = `今天值得知道的 ${chosen.length} 件事。${cutLine}${zn ? " " + zn.slice(0, 30) : ""}`;
  const html = render(chosen, dateLabel, cutLine, zn, preheader);

  if (dry) {
    return new Response(JSON.stringify({
      dry: true, subject, preheader, cutLine, total, picked: chosen.length,
      zion_note: zn, zion_note_missing: !zn,
      would_send_to: subs.map((s) => s.email),
      items: chosen.map((r) => {
        const head = r.summary_zh?.trim() || r.title;
        return {
          theme: themeOf(r.category), cat: r.category,
          head,
          zh_note: r.zh_note ?? null,
          dropped_as_dup: !!(r.zh_note && dupish(head, r.zh_note)),
          note_fail: r.note_fail ?? null,
        };
      }),
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

  // 7. 存档。每次发信都写一份进 daily_issues，公开可读，给 /daily/ 存档页用。
  //    写失败不影响发信，存档是附加物不是前置条件。
  try {
    await fetch(`${url}/rest/v1/daily_issues?on_conflict=d`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        d: todayCN(),
        subject,
        cut_line: cutLine,
        total,
        picked: chosen.length,
        zion_note: zn,
        updated_at: new Date().toISOString(),
        items: chosen.map((r) => {
          const head = r.summary_zh?.trim() || r.title;
          let host = "";
          try { host = new URL(r.original_url).hostname.replace(/^www\./, ""); } catch { /* 坏 URL */ }
          return {
            theme: themeOf(r.category),
            head,
            note: r.zh_note && !dupish(head, r.zh_note) ? r.zh_note : null,
            url: r.original_url,
            host,
            score: r.importance_score,
          };
        }),
      }),
    });
  } catch { /* 存档失败就算了，信照发 */ }

  // 8. 发信。一人一封，退订签名每人不同
  let sent = 0;
  const failed: string[] = [];
  for (const s of subs) {
    const unsubUrl = `${url}/functions/v1/send-daily?unsub=${encodeURIComponent(s.email)}&t=${await sig(s.email, secret)}`;
    const perUser = html.replace(/\{\{UNSUB\}\}/g, unsubUrl);
    const body: Record<string, unknown> = {
      from, to: s.email, subject, html: perUser,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
    if (replyTo) body.reply_to = replyTo;
    const r = await fetch(RESEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) sent++;
    else failed.push(`${s.email}: ${r.status}`);
  }

  return new Response(JSON.stringify({ sent, failed, picked: chosen.length, total, had_zion_note: !!zn }),
    { headers: { "content-type": "application/json" } });
});
