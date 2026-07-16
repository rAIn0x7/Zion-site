# 变现/闭环 · 接线清单(你的出水口)

资产盘点里"管子铺好、没水流过"的几个出水口。代码就绪,差你的账号/密钥。**建议顺序:先验可达性 → 再接一个收钱口 → 再补触达。**

## 0. 先验:llm-proxy 的载体在大陆到底通不通(决定方案生死)
`*.supabase.co` 实测本机(CN)~0.6s 可达(Cloudflare 前置,好过被墙的 workers.dev)。但它受 GFW 影响、是移动目标。
**放量前用真实大陆网络多省×三网复测**(itdog.cn / 站长工具多地 ping `uzvguynixndzusrlqryo.supabase.co`,看成功率+P95)。达标再全量;不达标→改用国内 Serverless(腾讯云 SCF / 阿里云 FC)承载同一段代理代码。

## 1. 藏 LLM key + 防蹭爆(llm-proxy) — 放量前必做
现在 `/prompt`、`/palm` 的智谱 key 明文在网页里,放量当天会被爬虫蹭爆变砖。
```bash
npm i -g supabase && supabase login
supabase functions deploy llm-proxy --project-ref uzvguynixndzusrlqryo --no-verify-jwt
supabase secrets set GLM_KEY=你的智谱key --project-ref uzvguynixndzusrlqryo
```
拿到 URL:`https://uzvguynixndzusrlqryo.supabase.co/functions/v1/llm-proxy` → 把 palm/prompt 的 `PROXY` 设成它(给我 URL 我来接前端)。
> ⚠️ **代码里只做了"同源+限模型+限体积+超时",没做限流/预算封顶。** Origin 可被非浏览器伪造,不是强防护。
> **真放量前必须补:按 IP/日 限流 + 全站每日总量封顶(用一张 Postgres 表计数,超限 429)。** 现版本只适合小流量/内测。要我加这层告诉我。

## 2. 打开一个能收钱的口(优先于触达)
从"造币机器"看,先验证"有人愿意付"比发欢迎信重要。两条路按受众选:

**2a. 微信内闭环(面向你的国内公众号受众 · 摩擦最低 · 绕开可达性风险)——推荐先做**
你的主受众在微信。相比注册海外 SaaS 支付,**公众号付费文章 / 知识星球 / 微信小商店**到账快、摩擦低、完全不依赖 supabase 可达性。把「降噪」每日精选的加深版做成星球/付费内容即可,内容你已在产。

**2b. Lens Pro(面向海外/信用卡用户)—— Lemon Squeezy**
Lens 里 Pro ¥15/月 UI 已建但禁用,变量还是 `YOUR_STORE_SLUG` 占位。
1. lemonsqueezy.com 注册(Merchant of Record,大陆个人可开,收 HK 卡)。
2. 建 Store + 订阅产品,拿 store slug 与 variant id。
3. grep `YOUR_STORE_SLUG`(CryptoLens 仓库)替换 + 打开 "Coming Soon"。给我这俩值我来改。

## 3. 邮件池进池即触达(send-welcome) — 收口后再上
让"只进不出"的邮件池活起来。**务必带共享密钥,别裸奔(否则=开放邮件轰炸口)。**
```bash
supabase functions deploy send-welcome --project-ref uzvguynixndzusrlqryo
supabase secrets set RESEND_API_KEY=你的resendkey FROM_EMAIL="Zion <hi@qizh.space>" WEBHOOK_SECRET=一串随机长密钥 --project-ref uzvguynixndzusrlqryo
```
接法:Supabase 后台 → Database → Webhooks → 表 `subscribers`、事件 `INSERT` → 调用 `send-welcome`,并在 webhook 的 HTTP Headers 加 `x-webhook-secret: <同一串密钥>`。**只走 webhook,不要从前端调**(前端一调 URL 就暴露)。
