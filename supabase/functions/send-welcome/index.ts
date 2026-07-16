// Supabase Edge Function: send-welcome
// 作用:新订阅者进池即发一封欢迎邮件(经 Resend),把"只进不出"的死邮件池变成能触达的资产。
//
// ⚠️ 防滥用:本函数会用你已验证的域名发真信,若裸奔=开放邮件轰炸口(任何人 POST 任意邮箱→用你的域名发信→
//   烧额度 + 域名进黑名单)。因此**必须带共享密钥**:请求头 `x-webhook-secret` 要等于 secret WEBHOOK_SECRET,否则 401。
//   **只走 Supabase DB Webhook,不要从前端直接调用**(前端一调 URL 就暴露)。
//
// 部署:
//   supabase functions deploy send-welcome --project-ref uzvguynixndzusrlqryo
//   supabase secrets set RESEND_API_KEY=你的resendkey FROM_EMAIL="Zion <hi@qizh.space>" WEBHOOK_SECRET=一串随机长密钥 --project-ref uzvguynixndzusrlqryo
// 接法(全自动):Supabase 后台 → Database → Webhooks → 表 subscribers、事件 INSERT → HTTP 调用本函数,
//   并在 webhook 的 HTTP Headers 里加一条 `x-webhook-secret: <同一串密钥>`。
// (Resend 免费 3000 封/月;hi@qizh.space 需在 Resend 验证域名,或先用默认 onboarding@resend.dev 测。)

const RESEND = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") || "Zion <onboarding@resend.dev>";
  if (!apiKey) return new Response("no resend key", { status: 500 });

  let email = "";
  try {
    const p = await req.json();
    email = (p?.record?.email || p?.email || "").trim().toLowerCase(); // 兼容 DB webhook 的 {record:{email}} 与 {email}
  } catch { /* ignore */ }
  if (!EMAIL_RE.test(email)) return new Response("invalid email", { status: 400 });

  const r = await fetch(RESEND, {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: email,
      subject: "欢迎进入「降噪」🔇",
      html: `<div style="font-family:sans-serif;line-height:1.7;color:#222;max-width:520px">
        <h2 style="color:#111">你已进入降噪频道。</h2>
        <p>这里只发值得你 10 分钟的东西:AI 趋势、创业逻辑、财富思维 —— 不发噪音。</p>
        <p>想要每天一页纸的精选,微信搜公众号 <b>「Zion降噪」</b>,回复 <b>「星球」</b>。</p>
        <p>顺手逛逛我造的小工具:
          <a href="https://qizh.space/tool/">工具箱</a> ·
          <a href="https://qizh.space/prompt/">Prompt 工坊</a> ·
          <a href="https://qizh.space/palm/">AI 手相</a></p>
        <p style="color:#888;font-size:13px">— Zion · qizh.space · 随时可退订</p>
      </div>`,
    }),
  });
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
});
