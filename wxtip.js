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
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.55;' +
      'padding:12px 14px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
      'display:flex;align-items:center;gap:10px;box-shadow:0 -6px 24px rgba(0,0,0,.55)');
    bar.innerHTML =
      '<div style="flex:1">微信里可能打不开或功能受限。点右上角 <b style="color:#f0d488">···</b> 选「在浏览器打开」,' +
      '或复制链接后到浏览器粘贴。</div>' +
      '<button id="wxcopy" style="flex:none;background:rgba(201,168,76,.14);border:1px solid rgba(201,168,76,.5);' +
      'color:#f0d488;font:inherit;font-size:12.5px;white-space:nowrap;padding:7px 12px;border-radius:8px;cursor:pointer">复制本页链接</button>' +
      '<button id="wxx" aria-label="关闭" style="flex:none;background:none;border:0;color:#8a8378;font-size:20px;line-height:1;padding:0 4px;cursor:pointer">×</button>';
    document.body.appendChild(bar);

    function toast(msg) {
      var t = document.createElement('div');
      t.textContent = msg;
      t.setAttribute('style',
        'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:100000;' +
        'background:rgba(10,9,8,.95);color:#f5f1ea;border:1px solid rgba(201,168,76,.5);' +
        'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;' +
        'padding:9px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:80vw;text-align:center');
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 2200);
    }

    function fallbackCopy(u) {
      try {
        var ta = document.createElement('textarea');
        ta.value = u;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, u.length);
        var ok = document.execCommand('copy');
        ta.remove();
        if (ok) { toast('已复制,去浏览器粘贴打开'); return; }
      } catch (e) {}
      window.prompt('复制这个链接,到浏览器粘贴打开:', u);       // 最后兜底
    }

    document.getElementById('wxcopy').onclick = function () {
      var u = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(u).then(
          function () { toast('已复制,去浏览器粘贴打开'); },
          function () { fallbackCopy(u); }
        );
      } else {
        fallbackCopy(u);
      }
    };
    document.getElementById('wxx').onclick = function () { bar.remove(); sessionStorage.setItem('wxtip_x', '1'); };
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
