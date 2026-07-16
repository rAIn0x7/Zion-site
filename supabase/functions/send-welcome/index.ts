// Supabase Edge Function: send-welcome
// 作用:新订阅者进池即发一封欢迎邮件(经 Resend),把"只进不出"的死邮件池变成能触达的资产。
//
// 部署:
//   supabase functions deploy send-welcome --project-ref uzvguynixndzusrlqryo
//   supabase secrets set RESEND_API_KEY=你的resendkey FROM_EMAIL="Zion <hi@qizh.space>" --project-ref uzvguynixndzusrlqryo
// 推荐接法(全自动、无需改前端):
//   Supabase Dashboard → Database → Webhooks → 新建,表 subscribers、事件 INSERT → 调用本函数(HTTP POST)。
//   新增一行订阅 → 自动触发 → 发欢迎信。
// 备用接法:前端订阅成功后 POST {"email":"..."} 到本函数(会暴露 URL,酌情)。

const RESEND = "https://api.resend.com/emails";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") || "Zion <onboarding@resend.dev>";
  if (!apiKey) return new Response("no resend key", { status: 500 });

  let email = "";
  try {
    const p = await req.json();
    email = p?.record?.email || p?.email || ""; // 兼容 DB webhook 的 {record:{email}} 与直接 {email}
  } catch { /* ignore */ }
  if (!email) return new Response("no email", { status: 400 });

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
