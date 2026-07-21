/* ═══════════════════════════════════════════════════════════════
   病毒工具工厂 · 共享引擎(从 palm 提炼泛化)
   一份工具 = 一份 config,调 CE.run(config) 即可。逻辑与渲染分离,便于日后搬小程序。
   机制:输入 → 确定性种子 →(内容库组合 ‖ LLM生成)→ 渲染 → 分享卡(带QR) → 分享即解锁 + 引流
   ═══════════════════════════════════════════════════════════════ */
window.CE = (function () {
  const API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const GLM_KEY = 'a3627c50241e4ba89fc4f56193b9c724.ADj57yFSiiLajwRC'; // 复用;仅"生成型"工具(起名)用

  /* ── 种子 & 随机(同输入同结果,跨输入不同)── */
  function xmur3(s){let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return (h^=h>>>16)>>>0;};}
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
  function rngFrom(str){return mulberry32(xmur3(String(str))());}          // 字符串 → 确定性 rng
  function pick(rng,arr){return Array.isArray(arr)&&arr.length?arr[Math.floor(rng()*arr.length)]:'';}
  function wpick(rng,pairs){let t=0;for(const p of pairs)t+=p[1];let x=rng()*t;for(const p of pairs){if((x-=p[1])<0)return p[0];}return pairs[pairs.length-1][0];}

  /* ── 图像哈希(图像型工具用;aHash+dHash,纯 canvas)── */
  function _gray(img,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(img,0,0,w,h);const d=x.getImageData(0,0,w,h).data,g=[];for(let i=0;i<w*h;i++)g.push(.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2]);return g;}
  function imgHash(uri){return new Promise(res=>{const im=new Image();im.onload=()=>{try{const a=_gray(im,8,8),avg=a.reduce((p,q)=>p+q,0)/a.length;let b='';for(const v of a)b+=v>avg?'1':'0';const d=_gray(im,9,8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)b+=d[y*9+x]<d[y*9+x+1]?'1':'0';res(b);}catch(e){res('0'.repeat(128));}};im.onerror=()=>res('0'.repeat(128));im.src=uri;});}

  /* ── 内容库选择器:按 rng 从 config.sections 组合出分段文案 ──
     section = { h:'标题', pools:[ 加权池 | 数组 ], join:' ' }  或  {h, gen:(rng,ctx)=>文本} */
  function buildParts(cfg, rng, ctx){
    return (cfg.sections||[]).map(sec=>{
      if(sec.gen) return {h:sec.h, p:sec.gen(rng,ctx)};
      let p=(sec.pools||[]).map(pool=>{
        if(Array.isArray(pool)&&pool.length&&Array.isArray(pool[0])) return wpick(rng,pool); // 加权 [[文,权]]
        return pick(rng,pool);
      }).filter(Boolean).join(sec.join!==undefined?sec.join:' ');
      return {h:sec.h, p:p||(sec.fallback||'')};
    });
  }

  /* ── LLM(仅生成型工具)── */
  function apiKey(){return GLM_KEY || (document.getElementById('key')?document.getElementById('key').value.trim():'');}
  function strip(c){return (c||'').replace(/<\|begin_of_box\|>/g,'').replace(/<\|end_of_box\|>/g,'').replace(/^```[a-z]*\n?|\n?```$/g,'').trim();}
  async function llm(prompt,{model='glm-4.5-flash',temp=0.85,json=false,timeout=13000}={}){
    const key=apiKey(); if(!key) return null;
    const ctl=new AbortController(); const tm=setTimeout(()=>ctl.abort(),timeout);  // 弱网/卡住必超时→走兜底,不无限转圈
    try{
      const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model,temperature:temp,messages:[{role:'user',content:prompt}]}),signal:ctl.signal});
      if(!r.ok) return null; const j=await r.json(); let c=strip(j.choices&&j.choices[0]&&j.choices[0].message.content);
      if(json){const m=c.match(/\{[\s\S]*\}|\[[\s\S]*\]/);return m?JSON.parse(m[0]):null;}
      return c||null;
    }catch(e){return null;}finally{clearTimeout(tm);}
  }

  /* ── 分享卡(canvas 竖版海报,底部画公众号/星球码)── */
  let _wxqr; function loadWxQR(){return new Promise(r=>{if(_wxqr!==undefined)return r(_wxqr);const im=new Image();im.onload=()=>{_wxqr=im;r(im);};im.onerror=()=>{_wxqr=null;r(null);};im.src='/wechat-qr.png';});}
  function _rr(x,px,py,w,h,r){x.beginPath();x.moveTo(px+r,py);x.arcTo(px+w,py,px+w,py+h,r);x.arcTo(px+w,py+h,px,py+h,r);x.arcTo(px,py+h,px,py,r);x.arcTo(px,py,px+w,py,r);x.closePath();}
  function _wrap(x,t,max){const o=[];let l='';for(const ch of String(t)){if(x.measureText(l+ch).width>max&&l){o.push(l);l=ch;}else l+=ch;}if(l)o.push(l);return o;}
  function drawCard(model, qr){
    const S=2,W=540,H=qr?740:650,c=document.createElement('canvas');c.width=W*S;c.height=H*S;
    const x=c.getContext('2d');x.scale(S,S);x.textAlign='center';
    x.fillStyle='#0a0908';x.fillRect(0,0,W,H);
    const g=x.createRadialGradient(W/2,210,40,W/2,210,430);g.addColorStop(0,'rgba(201,168,76,.15)');g.addColorStop(1,'rgba(201,168,76,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
    x.strokeStyle='rgba(201,168,76,.5)';x.lineWidth=1.5;_rr(x,16,16,W-32,H-32,18);x.stroke();
    x.fillStyle='#c9a84c';x.font='13px monospace';x.fillText(model.kicker||'',W/2,60);
    let Y=114;x.fillStyle='#f0d488';x.font='bold 33px "Noto Serif SC",sans-serif';
    _wrap(x,model.title,W-90).slice(0,2).forEach(l=>{x.fillText(l,W/2,Y);Y+=42;});
    if(model.sub){Y+=2;x.fillStyle='#8a8378';x.font='12px monospace';x.fillText(model.sub,W/2,Y);}Y+=46;
    if(model.big!=null){x.fillStyle='#8a8378';x.font='13px monospace';x.fillText(model.bigLabel||'',W/2,Y);Y+=54;
      x.fillStyle='#f0d488';x.font='700 70px "Bebas Neue",sans-serif';x.fillText(String(model.big),W/2,Y);Y+=44;}
    (model.dims||[]).forEach((d,i,a)=>{const cx=W*(i+0.5)/a.length;x.fillStyle='#f0d488';x.font='700 24px "Bebas Neue",sans-serif';x.fillText(String(d[1]),cx,Y);x.fillStyle='#8a8378';x.font='10.5px "Noto Serif SC",sans-serif';x.fillText(d[0],cx,Y+18);});
    if(model.dims&&model.dims.length)Y+=54;
    x.strokeStyle='rgba(201,168,76,.16)';x.lineWidth=1;x.beginPath();x.moveTo(60,Y);x.lineTo(W-60,Y);x.stroke();Y+=30;
    if(model.hook){x.fillStyle='#d9c48a';x.font='14px "Noto Serif SC",sans-serif';let hk=model.hook;if(hk.length>58)hk=hk.slice(0,58)+'…';_wrap(x,hk,W-96).slice(0,3).forEach(l=>{x.fillText(l,W/2,Y);Y+=25;});}
    if(qr){const q=112;x.drawImage(qr,(W-q)/2,H-188,q,q);x.fillStyle='#c9a84c';x.font='12px monospace';x.fillText('↑ 扫码关注「Zion降噪」· 回复解锁更多',W/2,H-52);x.fillStyle='#6b655c';x.font='11px monospace';x.fillText('qizh.space · 仅供娱乐',W/2,H-30);}
    else{x.fillStyle='#c9a84c';x.font='12.5px monospace';x.fillText('微信搜「Zion降噪」测你的',W/2,H-58);x.fillStyle='#6b655c';x.font='11px monospace';x.fillText('qizh.space · 仅供娱乐',W/2,H-36);}
    return c;
  }

  /* ── 结果状态 & 分享即解锁 ── */
  let _last=null;
  function applyLock(){const u=localStorage.getItem('ce_unlocked_'+(_last&&_last.toolId))==='1';const z=document.getElementById('ce-lockZone'),ct=document.getElementById('ce-lockCta');if(z)z.classList.toggle('ce-blur',!u);if(ct)ct.style.display=u?'none':'block';}
  async function shareCard(){
    if(!_last)return;
    try{await document.fonts.ready;}catch(e){}
    const qr=await loadWxQR(); const canvas=drawCard(_last.card,qr),dataUrl=canvas.toDataURL('image/png');
    localStorage.setItem('ce_unlocked_'+_last.toolId,'1');applyLock();
    const txt=_last.shareText||('我测了「'+_last.toolName+'」,来测测你的 👉 qizh.space');
    try{const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(blob&&navigator.canShare){const f=new File([blob],'card.png',{type:'image/png'});if(navigator.canShare({files:[f]})){await navigator.share({files:[f],text:txt});return;}}}catch(e){}
    const wx=/MicroMessenger/i.test(navigator.userAgent);
    const ov=document.getElementById('ce-shareov'),im=document.getElementById('ce-shareimg');
    im.src=dataUrl;ov.classList.add('on');
    document.getElementById('ce-svtip').textContent=wx?'长按图片保存,发朋友圈 📲':'长按图片保存,或点下方下载';
    const dl=document.getElementById('ce-svdl');dl.style.display=wx?'none':'';dl.onclick=()=>{const a=document.createElement('a');a.href=dataUrl;a.download='card.png';a.click();};
  }

  /* ── 分享浮层(引擎自动注入,工具页无需重复)── */
  function ensureOverlay(){
    if(document.getElementById('ce-shareov'))return;
    const ov=document.createElement('div');ov.className='ce-shareov';ov.id='ce-shareov';
    ov.innerHTML='<img id="ce-shareimg" alt="分享卡"><div class="svtip" id="ce-svtip">长按图片保存,发朋友圈 📲</div><div class="svbtns"><button class="ce-btn g" id="ce-svdl">下载图片</button><button class="ce-btn" id="ce-svclose">关闭</button></div>';
    document.body.appendChild(ov);
    document.getElementById('ce-svclose').onclick=()=>ov.classList.remove('on');
    ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('on');});
  }

  /* ── 渲染报告(标签/分数/四维/分段 + 锁区)── */
  function render(cfg, result){
    ensureOverlay();
    _last={toolId:cfg.id,toolName:cfg.名字||cfg.name,card:result.card,shareText:result.shareText};
    const box=document.getElementById('ce-report');
    const dimsHtml=(result.dims||[]).map(d=>`<div class="ce-dim"><span class="n">${d[1]}</span>${d[0]}</div>`).join('');
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const nl=s=>esc(s).replace(/\n/g,'<br>');
    const sec=x=>`<div class="ce-sec"><h4>${esc(x.h)}</h4><p>${nl(x.p)}</p></div>`;
    const parts=result.parts||[];const first=parts[0],rest=parts.slice(1);
    box.innerHTML=`<div class="ce-rt">${cfg.图标||''} ${esc(result.heading||cfg.名字||'')}</div>
      <div class="ce-tag">${esc(result.tag||'')}</div>${result.sub?`<div class="ce-sub">${esc(result.sub)}</div>`:''}
      ${result.big!=null?`<div class="ce-score"><div class="big">${result.bigLabel||''} <b>${result.big}</b></div><div class="ce-dims">${dimsHtml}</div></div>`:''}
      <div id="ce-body">${first?sec(first):''}
        ${rest.length?`<div class="ce-lockcta" id="ce-lockCta">🔒 完整解读还锁着 —— 📤 <b>分享卡片</b>即可解锁全部<div style="margin-top:10px"><button class="ce-btn g" id="ce-lockShare">📤 分享并解锁</button></div><div style="color:#8a8378;font-size:11px;margin-top:8px">分享/保存后自动解锁 · 也欢迎微信搜「Zion降噪」</div></div>
        <div class="ce-lockZone ce-blur" id="ce-lockZone">${rest.map(sec).join('')}</div>`:''}
      </div>
      <div class="ce-cta"><div class="ct">🔮 想要更深 / 每天一条降噪信号</div><a class="ce-btn g" href="/join/" style="display:inline-block;margin:8px 0 4px;text-decoration:none">加入「降噪·静音舱」→</a><div class="cb">或微信搜公众号 <b>「Zion降噪」</b></div></div>
      <div class="ce-row"><button class="ce-btn g" id="ce-share">📤 甩给最该看的人</button><button class="ce-btn" id="ce-again">再测一次</button></div>
      <div class="ce-wm">qizh.space · 微信搜「Zion降噪」· 仅供娱乐</div>`;
    document.getElementById('ce-share').onclick=shareCard;
    const ls=document.getElementById('ce-lockShare');if(ls)ls.onclick=shareCard;
    document.getElementById('ce-again').onclick=()=>{document.getElementById('ce-report').style.display='none';document.getElementById('ce-stage').style.display='block';window.scrollTo({top:0,behavior:'smooth'});};
    applyLock();
    document.getElementById('ce-stage').style.display='none';
    box.style.display='block';box.scrollIntoView({behavior:'smooth',block:'start'});
  }

  return { rngFrom, pick, wpick, imgHash, buildParts, llm, render, drawCard,
           util:{xmur3,mulberry32} };
})();
