// Cloudflare Worker · palm-proxy
// 作用:藏智谱 key + 跨域(CORS)+ 帮前端调 GLM-4V-Flash 做手相特征提取。
// 部署后在 Worker 的 Settings → Variables and Secrets 里加一个 Secret:
//   名称 GLM_KEY  值=你的智谱 API Key(open.bigmodel.cn 拿的,不要写进代码)
// 全免费:Cloudflare Workers 免费版 + 智谱 GLM-4V-Flash 免费额度。

const ALLOW = ['https://qizh.space', 'http://localhost:8777']; // 只允许你的站调用,防别人盗刷你的 key
const EXTRACT_PROMPT = `你是一个手相特征识别器。请仔细观察这张手掌照片,只输出一个 JSON 对象描述你观察到的掌纹与手型特征,不要写任何解读或多余文字。若某项看不清,填 "不清"。字段与可选值如下:
{"is_hand": true/false,"life": {"vitality":"旺|弱|不清","travel": true/false,"multiple": true/false},"head": {"length":"长|短|不清","curve":"直|弯|很弯|不清","joined":"连|不连|不清"},"heart": {"length":"长|短|不清","angle":"上扬|平缓|不清","end":"下弯|分叉|普通|不清"},"fate": "清晰|下半|上半|断续|无|不清","special": []}
special 只从这些里选你确实看到的:["神秘十字线","断掌","霸王线","佛之眼","所罗门之星"]。生命线弧度越过食指中指间垂线=旺;智慧/感情线越过该垂线=长。只返回 JSON。`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOW.includes(origin) ? origin : ALLOW[0];
    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return j({ error: 'POST only' }, 405, cors);
    try {
      const body = await request.json();
      const image = body && body.image;
      if (!image || image.length > 3_000_000) return j({ error: '图片缺失或过大' }, 400, cors);
      const r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GLM_KEY },
        body: JSON.stringify({
          model: 'glm-4v-flash', temperature: 0.6,
          messages: [{ role: 'user', content: [
            { type: 'text', text: EXTRACT_PROMPT },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } },
          ] }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return j({ error: (data.error && data.error.message) || '智谱接口错误' }, 502, cors);
      const text = data.choices && data.choices[0] && data.choices[0].message.content;
      return j({ text: text || '' }, 200, cors);
    } catch (e) { return j({ error: String(e) }, 500, cors); }
  },
};
function j(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
