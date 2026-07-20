/* 微信内引导:检测到微信内置浏览器时,提示去外部浏览器打开 + 一键复制网址。
   微信 webview 常掐 navigator.share/下载/部分外部 API,甚至整页打不开;这条帮"能开但受限"的用户自救。
   放在站点根:各页 <script src="/wxtip.js" defer></script> 引入即可。 */
(function () {
  if (!/MicroMessenger/i.test(navigator.userAgent || '')) return;      // 只在微信内显示
  function init() {
    if (sessionStorage.getItem('wxtip_x')) return;                      // 本次会话关过就不再弹
    var bar = document.createElement('div');
    bar.setAttribute('style',
      'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#15130f;' +
      'border-top:1px solid rgba(201,168,76,.45);color:#f5f1ea;' +
      'font-family:-apple-system,sans-serif;font-size:13px;line-height:1.55;' +
      'padding:12px 14px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
      'display:flex;align-items:center;gap:10px;box-shadow:0 -6px 24px rgba(0,0,0,.55)');
    bar.innerHTML =
      '<div style="flex:1">🔗 微信里可能打不开或功能受限。点右上角 <b style="color:#f0d488">···</b> →「在浏览器打开」体验完整,' +
      '或 <span id="wxcopy" style="color:#f0d488;text-decoration:underline;white-space:nowrap">复制网址</span></div>' +
      '<button id="wxx" aria-label="关闭" style="background:none;border:0;color:#8a8378;font-size:20px;line-height:1;padding:0 4px;cursor:pointer">×</button>';
    document.body.appendChild(bar);
    document.getElementById('wxcopy').onclick = function () {
      var u = location.href, self = this;
      function ok() { self.textContent = '已复制 ✓'; }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(u).then(ok, function () { window.prompt('复制这个网址,粘到浏览器打开:', u); });
        } else { window.prompt('复制这个网址,粘到浏览器打开:', u); }
      } catch (e) { window.prompt('复制这个网址,粘到浏览器打开:', u); }
    };
    document.getElementById('wxx').onclick = function () { bar.remove(); sessionStorage.setItem('wxtip_x', '1'); };
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
