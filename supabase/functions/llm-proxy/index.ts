// Supabase Edge Function: llm-proxy
// 作用:把智谱 GLM 的 key 藏到服务端,给 /prompt 和 /palm 前端调用,避免 key 明文暴露在网页里。
// 为什么用 Supabase(而不是 Cloudflare Worker):*.workers.dev 在中国大陆被墙;
//   *.supabase.co 与站点订阅走同一后端、国内可达,是可行的藏 key + CN 可达方案。
//
// 部署(装好 supabase CLI、supabase login 后):
//   supabase functions deploy llm-proxy --project-ref uzvguynixndzusrlqryo --no-verify-jwt
//   supabase secrets set GLM_KEY=你的智谱key --project-ref uzvguynixndzusrlqryo
// 部署后拿到 URL: https://uzvguynixndzusrlqryo.supabase.co/functions/v1/llm-proxy
// 然后把 palm/index.html 和 prompt/index.html 里的 PROXY 常量设成这个 URL 即启用(见 DEPLOY.md)。

const ALLOW = ["https://qizh.space", "http://localhost:8799"];
const UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const ALLOW_MODELS = ["glm-4.5-flash", "glm-4-flash", "glm-4v-flash"];

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
  // 只允许自己站点来源,降低被盗刷免费额度的风险
  if (origin && !ALLOW.includes(origin)) return j({ error: "forbidden origin" }, 403, cors);
  const key = Deno.env.get("GLM_KEY");
  if (!key) return j({ error: "server key missing" }, 500, cors);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return j({ error: "bad json" }, 400, cors); }

  const model = typeof b.model === "string" && ALLOW_MODELS.includes(b.model) ? b.model : "glm-4-flash";
  const payload = { model, temperature: typeof b.temperature === "number" ? b.temperature : 0.7, messages: b.messages };

  const r = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
});

function j(o: unknown, s: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
