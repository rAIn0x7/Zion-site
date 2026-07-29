// Supabase Edge Function: llm-proxy
// 作用:把智谱 GLM 的 key 藏到服务端,给 /prompt 和 /palm 前端调用,避免 key 明文暴露在网页里。
//
// 为什么用 Supabase(而不是 Cloudflare Worker):*.workers.dev 在中国大陆被 DNS/SNI 封,连不通;
//   *.supabase.co 走 Cloudflare 前置、且与站点订阅同后端。实测本机(CN)访问该域 ~0.6s 可达。
//   ⚠️ 但它仍受 GFW 影响、是移动目标:**放量前务必用真实大陆网络多省×三网(电信/联通/移动)复测成功率与延迟**,
//   达标再全量启用;不达标则改用国内 Serverless(腾讯云 SCF / 阿里云 FC)承载本代理。
//
// ⚠️ 安全现状:下面只做了"必须同源 + 限模型 + 限体积 + 超时"。**Origin 头可被非浏览器伪造,这不是强防护。**
//   真正防"被人裸调刷爆免费额度"需要:①按 IP/日 限流 ②全站每日总量预算封顶(建议用一张 Postgres 表计数,
//   超限返回 429)。放量前必须补上 —— 见 DEPLOY.md 的 TODO。当前版本适合小流量/内测。
//
// 部署:
//   supabase functions deploy llm-proxy --project-ref uzvguynixndzusrlqryo --no-verify-jwt
//   supabase secrets set GLM_KEY=你的智谱key --project-ref uzvguynixndzusrlqryo
// 启用:把 palm/index.html 和 prompt/index.html 的 PROXY 常量设成函数 URL(见 DEPLOY.md)。

// rain0x7.github.io 是微信内可达的镜像站(qizh.space 被微信封域名),不加进白名单
// 微信里打开工具的人会全部拿到 403。
const ALLOW = ["https://qizh.space", "https://rain0x7.github.io", "http://localhost:8799"];
const UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const ALLOW_MODELS = ["glm-4.5-flash", "glm-4-flash", "glm-4v-flash"];
const MAX_BODY = 5_000_000;     // 5MB(容纳 palm 的 base64 图)
const MAX_MESSAGES = 12;
const UPSTREAM_TIMEOUT = 60_000;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOW.includes(origin) ? origin : ALLOW[0];
  const cors = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return j({ error: "POST only" }, 405, cors);
  // 必须是白名单来源(含"无 Origin"一律拒绝——挡掉裸奔的脚本/爬虫这道低门槛;强防护仍需限流,见顶部)
  if (!ALLOW.includes(origin)) return j({ error: "forbidden origin" }, 403, cors);

  const key = Deno.env.get("GLM_KEY");
  if (!key) return j({ error: "server key missing" }, 500, cors);

  const len = Number(req.headers.get("content-length") || "0");
  if (len > MAX_BODY) return j({ error: "payload too large" }, 413, cors);

  let b: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return j({ error: "payload too large" }, 413, cors);
    b = JSON.parse(raw);
  } catch { return j({ error: "bad json" }, 400, cors); }

  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > MAX_MESSAGES) {
    return j({ error: "invalid messages" }, 400, cors);
  }
  const model = typeof b.model === "string" && ALLOW_MODELS.includes(b.model) ? b.model : "glm-4-flash";
  const payload = { model, temperature: typeof b.temperature === "number" ? b.temperature : 0.7, messages: b.messages };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT);
  try {
    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch {
    return j({ error: "upstream timeout or error" }, 504, cors);
  } finally {
    clearTimeout(t);
  }
});

function j(o: unknown, s: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
