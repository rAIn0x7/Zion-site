/* ═══════════════════════════════════════════════════════════════
   Zion 站 · 极简事件度量(唯一真源,ce/engine.js 与非 ce 页共用)
   ───────────────────────────────────────────────────────────────
   只回答一件事:"发生了什么类型的事" —— 哪个工具被真的玩了、有没有人分享、
   微信(镜像)来的人 vs 浏览器(主站)来的人各占多少。

   隐私(硬约束,改代码前先读这段):
     · 不写 cookie、不生成任何用户 ID / 设备指纹、不做跨站跟踪。
     · 不存用户输入的任何内容(名字/生日/月薪/纠结什么……一个字都不进库)。
     · referrer 只归类成 6 个大类之一,绝不存完整 URL。
     · meta 走 key 白名单 + 值格式白名单(^[a-z0-9_:.-]{1,16}$)→ 中文/长文本天然进不去。

   性能 / 健壮:
     · 异步、失败静默,任何异常都被吞掉,绝不影响工具本身。
     · 传输用 fetch(keepalive:true) —— 见下面 send() 里关于 sendBeacon 的实测说明。

   防刷(anon key 是公开的,客户端这层只是自保,真闸门在库里):
     · 事件名白名单(库里有同样一份 CHECK 约束兜底)
     · 同一事件 15s 内不重复发
     · 每会话最多 30 条
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (window.ZT && window.ZT.track) return;                 // 幂等:engine.js 和页面都引了也只跑一次

  var EP  = 'https://uzvguynixndzusrlqryo.supabase.co/rest/v1/events';
  var KEY = 'sb_publishable_tHr8G_hSTCG9kDYpC48_bg_CWjXpeLN';   // publishable/anon key:只有 INSERT 权限,读不走任何数据
  var URL_ = EP + '?apikey=' + KEY;                             // key 走 query:sendBeacon 设不了 header

  var NAMES = { result_shown:1, share_click:1, copy_report:1, unlock:1, cross_click:1, qr_shown:1 };
  var META_KEYS = { tier:1, to:1, ratio:1, ok:1 };               // 允许进 meta 的 key,别的一律丢
  var DEDUPE_MS = 15000, SESSION_CAP = 30;

  /* ── host:本次最关键的维度。主站被微信封 → 镜像流量 = 微信渠道的量 ── */
  function hostLabel() {
    var h = String(location.hostname || '').toLowerCase();
    if (h === 'qizh.space' || h === 'www.qizh.space')       return 'main';
    if (h.indexOf('rain0x7.github.io') >= 0)                return 'mirror';
    if (h === 'localhost' || h === '127.0.0.1' || h === '' ||
        /^192\.168\./.test(h) || /^10\./.test(h))            return 'local';
    return 'other';
  }

  /* ── ref:来源大类。只留归类结果,原始 referrer 用完就扔 ──
     微信内 referrer 通常是空的 → 用 MicroMessenger UA 兜住"直接进来的微信用户"。 */
  function refLabel() {
    var rh = '';
    try { rh = document.referrer ? new window.URL(document.referrer).hostname.toLowerCase() : ''; } catch (e) {}
    if (rh) {
      if (rh === location.hostname || rh === 'qizh.space' || rh === 'www.qizh.space' ||
          rh.indexOf('rain0x7.github.io') >= 0)                                       return 'internal';
      if (/(^|\.)qq\.com$|weixin/.test(rh))                                           return 'wechat';
      if (/baidu\.|google\.|bing\.|sogou\.|so\.com|360\.cn|sm\.cn|yandex\.|duckduckgo\.|ecosia\./.test(rh)) return 'search';
      if (/zhihu\.|weibo\.|xiaohongshu\.|xhslink|douyin\.|bilibili\.|juejin\.|csdn\.|twitter\.|^x\.com$|t\.co|facebook\.|linkedin\.|reddit\.|youtube\./.test(rh)) return 'social';
      return 'other';
    }
    try { if (/MicroMessenger/i.test(navigator.userAgent || '')) return 'wechat'; } catch (e) {}
    return 'direct';
  }

  /* ── meta 消毒:双白名单。这里是"用户输入绝对进不了库"的最后一道闸 ── */
  function cleanMeta(m) {
    if (!m || typeof m !== 'object') return null;
    var o = {}, n = 0;
    for (var k in m) {
      if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
      if (!META_KEYS[k]) continue;                              // key 不在白名单 → 丢
      var v = m[k];
      if (typeof v === 'boolean')                     v = v ? 1 : 0;
      else if (typeof v === 'number')                 { if (!isFinite(v)) continue; v = Math.round(v); }
      else {
        v = String(v == null ? '' : v).toLowerCase();
        if (!/^[a-z0-9_:.\-]{1,16}$/.test(v)) continue;          // 值格式不合 → 丢(中文/长句在此被拦)
      }
      o[k] = v;
      if (++n >= 4) break;                                      // meta 最多 4 个字段
    }
    return n ? o : null;
  }

  /* ── 会话计数(sessionStorage:关标签就清,不是跟踪标识)── */
  var _memN = 0;
  function bumpSession() {
    try {
      var n = (parseInt(sessionStorage.getItem('zt_n') || '0', 10) || 0) + 1;
      sessionStorage.setItem('zt_n', String(n));
      return n;
    } catch (e) { return ++_memN; }                              // 隐私模式下 sessionStorage 会抛 → 退回内存计数
  }

  var _last = {};                                                // 事件key → 上次发送时间(本页内存)

  /* ── 发送 ──
     实测(Chromium):navigator.sendBeacon 打不通 Supabase。
     PostgREST 只收 Content-Type: application/json,而 json 不是 CORS 安全列表类型 → 触发预检;
     beacon 的 credentials mode 固定是 include,Supabase 返回的是 ACAO: *,
     "带凭据 + 通配符" 组合被浏览器判定预检失败 → 请求根本不发出,还会往 console 打一条 CORS 报错。
     所以主通道用 fetch(keepalive:true, credentials:'omit'):同样不阻塞、同样能活过页面跳转
     (cross_click 点完就跳走,靠的就是 keepalive),而且 console 干净。
     sendBeacon 只留作"连 fetch 都没有"的老浏览器兜底,能不能通不强求。 */
  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (window.fetch) {
        fetch(URL_, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          mode: 'cors',
          credentials: 'omit'                                    // 不带 cookie
        })['catch'](function () {});                             // 失败静默
        return;
      }
    } catch (e) {}
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(URL_, new Blob([body], { type: 'application/json' }));
    } catch (e) {}
  }

  /* ── 对外唯一入口:ZT.track(name, tool, meta) ── */
  function track(name, tool, meta) {
    try {
      if (!NAMES[name]) return false;                            // 白名单外的事件名:直接不发
      var t = tool == null ? null : String(tool).toLowerCase();
      if (t !== null && !/^[a-z0-9_\-]{1,24}$/.test(t)) t = null;

      var key = name + '|' + (t || '-'), now = Date.now();
      if (_last[key] && now - _last[key] < DEDUPE_MS) return false;   // 节流:连点不重复发
      if (bumpSession() > SESSION_CAP) return false;                  // 每会话上限
      _last[key] = now;

      send({ name: name, tool: t, host: hostLabel(), ref: refLabel(), meta: cleanMeta(meta) });
      return true;
    } catch (e) { return false; }                                // 度量出任何问题都不许影响页面
  }

  window.ZT = { track: track, hostLabel: hostLabel, refLabel: refLabel };

  /* ── 引擎在 track.js 到位前打的事件先进队列,这里补发 ── */
  try {
    var q = window.ZT_Q;
    if (q && q.length) { for (var i = 0; i < q.length && i < 10; i++) track.apply(null, q[i]); }
    window.ZT_Q = { push: function (a) { try { track.apply(null, a); } catch (e) {} } };
  } catch (e) {}
})();
