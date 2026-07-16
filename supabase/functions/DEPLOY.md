# 变现/闭环 · 接线清单(你 10 分钟能接完)

这几件是资产盘点里"管子铺好、没水流过"的出水口。代码都写好了,只差你的账号/密钥。

## 1. 藏 LLM key + 防蹭爆(llm-proxy) — 放量前必做
现在 `/prompt`、`/palm` 的智谱 key 明文在网页里,放量当天会被爬虫蹭爆变砖。

```bash
npm i -g supabase        # 若没装
supabase login
supabase functions deploy llm-proxy --project-ref uzvguynixndzusrlqryo --no-verify-jwt
supabase secrets set GLM_KEY=你的智谱key --project-ref uzvguynixndzusrlqryo
```
拿到 URL:`https://uzvguynixndzusrlqryo.supabase.co/functions/v1/llm-proxy`
**启用(二选一,告诉我 URL 我来改也行):**
- `prompt/index.html`:把 `const PROXY=''` 改成 `const PROXY='<上面的URL>'`(已预留,见文件里 PROXY 常量与 callLLM)。
- `palm/index.html`:把 `const PROXY=''` 改成同一个 URL(已预留)。
改完前端就不再带 key,key 只在服务端。

## 2. 邮件池进池即触达(send-welcome) — 让死池活起来
```bash
supabase functions deploy send-welcome --project-ref uzvguynixndzusrlqryo
supabase secrets set RESEND_API_KEY=你的resendkey FROM_EMAIL="Zion <hi@qizh.space>" --project-ref uzvguynixndzusrlqryo
```
然后 Supabase 后台 → Database → Webhooks → 新建:表 `subscribers`、事件 `INSERT` → 调用 `send-welcome`。
（Resend 免费额度 3000 封/月;`hi@qizh.space` 需在 Resend 验证域名,或先用默认 onboarding@resend.dev 测。）

## 3. 打开收钱阀门(Lemon Squeezy) — 需要你注册
Lens 里 Pro ¥15/月 的 UI 已建但禁用,变量还是 `YOUR_STORE_SLUG` 占位。
1. 去 lemonsqueezy.com 注册(Merchant of Record,大陆个人可开,支持收款到 HK 卡)。
2. 建 Store + 一个 $x/月订阅产品,拿到 store slug 与 variant id。
3. 把占位符替换掉(在 CryptoLens 仓库里 grep `YOUR_STORE_SLUG`)。告诉我这两个值,我来替换 + 打开 "Coming Soon"。

> 顺序建议:先 1(不做不能放量)→ 再 3(先有一个能收钱的口)→ 再 2(触达)。
