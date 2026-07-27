/* ═══════════════════════════════════════════════════════════════
   病毒工具工厂 · 共享引擎(从 palm 提炼泛化)
   一份工具 = 一份 config,调 CE.run(config) 即可。逻辑与渲染分离,便于日后搬小程序。
   机制:输入 → 确定性种子 →(内容库组合 ‖ LLM生成)→ 渲染 → 分享卡(带QR) → 分享即解锁 + 引流
   ═══════════════════════════════════════════════════════════════ */
window.CE = (function () {
  const API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const GLM_KEY = 'a3627c50241e4ba89fc4f56193b9c724.ADj57yFSiiLajwRC'; // 复用;仅"生成型"工具(起名)用
  const JOIN_URL = 'https://t.zsxq.com/hGab6';                          // 知识星球(微信内多半打不开→靠扫码/复制到浏览器)

  /* ── 分享卡字体族(拉丁走自托管 woff2;中文不再远程加载 Noto Serif SC → 显式回退到系统衬线,
        保证任何设备上中文都有骨力、无豆腐块;拉丁数字/大标题用 Bebas,标签用 DM Mono)── */
  const F_MONO = '"DM Mono",ui-monospace,"SFMono-Regular",monospace';
  const F_NUM  = '"Bebas Neue",Impact,sans-serif';
  const F_CJK  = '"Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif';
  function _ls(x,v){try{x.letterSpacing=v;}catch(e){}}                  // 字距(现代浏览器支持,旧版静默忽略,无副作用)

  /* ── 工具矩阵清单(唯一真源;结果页"再测下一个"导流条 & 首页都可复用)──
     每项:id 与各工具页 cfg.id 一致(用于结果页自动排除当前工具)/ name / icon / url / hook 一句钩子 */
  const TOOLS = [
    {id:'palm',    name:'AI 手相',    icon:'🖐', url:'/palm/',       hook:'拍张手掌,AI 看你天生什么命'},
    {id:'hehun',   name:'AI 合婚',    icon:'💞', url:'/ce/hehun/',   hook:'输俩名字,测你俩到底配不配'},
    {id:'xingzuo', name:'今日运势',   icon:'⭐', url:'/ce/xingzuo/', hook:'你的星座今天多少分?'},
    {id:'tarot',   name:'塔罗抽牌',   icon:'🃏', url:'/ce/tarot/',   hook:'三张牌拆穿你的现在与未来'},
    {id:'qianshi', name:'前世今生',   icon:'🪷', url:'/ce/qianshi/', hook:'你上辈子到底是谁?'},
    {id:'keyword', name:'本命关键词', icon:'🔮', url:'/ce/keyword/', hook:'测出你的年度本命词'},
    {id:'qiming',  name:'AI 起名',    icon:'✍️', url:'/ce/qiming/',  hook:'AI 给你起个带寓意的好名字'},
    {id:'mbti',    name:'MBTI 锐评',  icon:'🧭', url:'/ce/mbti/',    hook:'8 题测你是哪型人格'},
    {id:'yiji',    name:'今日宜忌',   icon:'📜', url:'/ce/yiji/',    hook:'赛博老黄历,今天宜摸鱼忌收到'},
    {id:'nongdu',  name:'牛马浓度',   icon:'🐂', url:'/ce/nongdu/',  hook:'测你被工作腌入味了几成'},
    {id:'decide',  name:'帮你做决定', icon:'🎲', url:'/ce/decide/',  hook:'选 A 还是选 B?让 AI 替你拍板'},
    {id:'fuye',    name:'副业测评',   icon:'💼', url:'/ce/fuye/',    hook:'6 题测你适合搞什么副业'},
    {id:'heihua',  name:'黑话翻译',   icon:'💬', url:'/ce/heihua/',  hook:'粘句工作发言,测黑话浓度+翻人话'},
    {id:'lifebar', name:'人生进度条', icon:'⏳', url:'/ce/lifebar/', hook:'输生日,看你人生已用百分之几'},
    {id:'sekapian',name:'本命色卡',   icon:'🎨', url:'/ce/sekapian/',hook:'输名字,测你的专属本命色'},
    {id:'chongkai',name:'人生重开',   icon:'🎮', url:'/ce/chongkai/',hook:'抽个天赋,随机重开一次人生'}
  ];

  /* ── 结果页底部"再测下一个"导流条(排除当前工具,按 toolId 稳定挑 3 个)── */
  function buildMore(curId){
    const others = TOOLS.filter(t=>t.id!==curId);
    if(!others.length) return '';
    const rng = rngFrom((curId||'x')+'|more');                 // 同工具稳定、跨工具各异
    for(let i=others.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=others[i];others[i]=others[j];others[j]=t;}
    const cards = others.slice(0,3).map(t=>
      `<a class="ce-more-c" href="${t.url}"><span class="ce-more-i">${t.icon}</span><span class="ce-more-tx"><b>${t.name}</b><i>${t.hook}</i></span><span class="ce-more-go">→</span></a>`
    ).join('');
    return `<div class="ce-more"><div class="ce-more-hd">🔥 测完这个,顺手再测 →</div><div class="ce-more-row">${cards}</div><a class="ce-more-all" href="/ce/">查看全部 ${TOOLS.length} 个测试 →</a></div>`;
  }

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
  /* 预热分享卡要用到的自托管拉丁字体(Bebas/Outfit/DM Mono),避免首张分享卡数字/标签回退成默认字体 */
  let _warmed;
  function _warmFonts(){
    if(_warmed)return _warmed;
    const fd=document.fonts;
    const jobs=[];
    if(fd&&fd.load){
      try{jobs.push(fd.load('700 76px "Bebas Neue"'));}catch(e){}
      try{jobs.push(fd.load('400 13px "DM Mono"'));}catch(e){}
      try{jobs.push(fd.load('600 14px "Outfit"'));}catch(e){}
    }
    _warmed=Promise.all(jobs).catch(()=>{}).then(()=>{return fd&&fd.ready?fd.ready.catch(()=>{}):null;});
    return _warmed;
  }
  function _rr(x,px,py,w,h,r){x.beginPath();x.moveTo(px+r,py);x.arcTo(px+w,py,px+w,py+h,r);x.arcTo(px+w,py+h,px,py+h,r);x.arcTo(px,py+h,px,py,r);x.arcTo(px,py,px+w,py,r);x.closePath();}
  function _wrap(x,t,max){const o=[];let l='';for(const ch of String(t)){if(x.measureText(l+ch).width>max&&l){o.push(l);l=ch;}else l+=ch;}if(l)o.push(l);return o;}
  /* ── 分享卡装饰基元(纯 canvas,无外链;每个都 save/restore 自洽,不污染后续文字样式)── */
  function _oDot(x,cx,cy,r,col,a){x.save();x.globalAlpha=a;x.fillStyle=col;x.beginPath();x.arc(cx,cy,r,0,6.2832);x.fill();x.restore();}
  function _oSpark(x,cx,cy,r,col,a){x.save();x.globalAlpha=a;x.fillStyle=col;x.beginPath();x.moveTo(cx,cy-r);x.quadraticCurveTo(cx+r*.16,cy-r*.16,cx+r,cy);x.quadraticCurveTo(cx+r*.16,cy+r*.16,cx,cy+r);x.quadraticCurveTo(cx-r*.16,cy+r*.16,cx-r,cy);x.quadraticCurveTo(cx-r*.16,cy-r*.16,cx,cy-r);x.closePath();x.fill();x.restore();}
  function _oHeart(x,cx,cy,s,col,a){x.save();x.globalAlpha=a;x.strokeStyle=col;x.lineWidth=2;x.beginPath();x.moveTo(cx,cy+s*.62);x.bezierCurveTo(cx-s*1.1,cy-s*.25,cx-s*.5,cy-s,cx,cy-s*.35);x.bezierCurveTo(cx+s*.5,cy-s,cx+s*1.1,cy-s*.25,cx,cy+s*.62);x.closePath();x.stroke();x.restore();}
  function _oMoon(x,cx,cy,r,col,bg,a){x.save();x.globalAlpha=a;x.fillStyle=col;x.beginPath();x.arc(cx,cy,r,0,6.2832);x.fill();x.restore();x.save();x.fillStyle=bg;x.beginPath();x.arc(cx+r*.42,cy-r*.3,r*.92,0,6.2832);x.fill();x.restore();}
  function _oCloud(x,cx,cy,s,col,a){x.save();x.globalAlpha=a;x.strokeStyle=col;x.lineWidth=2;x.beginPath();x.arc(cx,cy,s,Math.PI*.2,Math.PI*1.6);x.stroke();x.beginPath();x.arc(cx+s*1.05,cy+s*.2,s*.6,Math.PI*.1,Math.PI*1.5);x.stroke();x.restore();}

  /* ── 按工具 id 的视觉主题表(_default = 现状金黑,逐字段等价,保证零回归)──
     每个主题:bg 背景纯色 / glow 光晕RGB三元(配 .15 alpha) / border 描边 / accent 主强调(kicker·牌框·二维码文案)
              / hl 高亮(标题·大数字·四维值·牌名) / muted 次要(副标题·标签·四维名) / rev 逆位 / cardBg 无图牌面底
              / divider 分割线 / hook 钩子文案 / accentDim 页脚灰 / ornament? 角落纹样(可选) */
  const THEMES = {
    _default:{ bg:'#0a0908', glow:'201,168,76', border:'rgba(201,168,76,.5)', accent:'#c9a84c', hl:'#f0d488', muted:'#8a8378', rev:'#d69a78', cardBg:'#15130f', divider:'rgba(201,168,76,.16)', hook:'#d9c48a', accentDim:'#6b655c' },
    // 塔罗:紫金氛围,金牌框保留 + 弦月/星芒点缀
    tarot:{ bg:'#0d0a14', glow:'138,99,210', border:'rgba(160,120,210,.5)', accent:'#c9a84c', hl:'#f0d488', muted:'#9a8fb0', rev:'#d69a78', cardBg:'#15130f', divider:'rgba(160,120,210,.2)', hook:'#d9c48a', accentDim:'#6b6580',
      ornament(x,W,H,t){ _oMoon(x,W-56,64,15,t.accent,t.bg,.55); _oSpark(x,46,70,9,t.accent,.5); _oSpark(x,74,44,5,'#c9a0e8',.55); _oSpark(x,W-92,98,5,'#c9a0e8',.5); _oSpark(x,42,H-72,7,t.accent,.4); _oSpark(x,W-46,H-92,6,'#c9a0e8',.45); _oDot(x,92,H-124,2,t.accent,.4); _oDot(x,W-102,H-142,2,'#c9a0e8',.4); } },
    // 牛马浓度:工业冷灰,危险斜纹 + 侧边刻度(进度/仪表感)
    nongdu:{ bg:'#0e1012', glow:'120,140,155', border:'rgba(150,165,175,.45)', accent:'#9fb2bd', hl:'#e6ebee', muted:'#7b8a92', rev:'#d69a78', cardBg:'#141618', divider:'rgba(150,165,175,.18)', hook:'#b9c7cf', accentDim:'#5a666d',
      ornament(x,W,H,t){ const hz=(ox,oy)=>{x.save();x.globalAlpha=.16;x.fillStyle=t.accent;for(let i=0;i<5;i++){x.beginPath();x.moveTo(ox+i*10,oy);x.lineTo(ox+i*10+6,oy);x.lineTo(ox+i*10-8,oy+16);x.lineTo(ox+i*10-14,oy+16);x.closePath();x.fill();}x.restore();}; hz(42,34); hz(W-84,34); x.save();x.globalAlpha=.25;x.strokeStyle=t.accent;x.lineWidth=1;for(let i=0;i<8;i++){const yy=H-210-i*22;x.beginPath();x.moveTo(30,yy);x.lineTo(38+(i%2?6:0),yy);x.stroke();x.beginPath();x.moveTo(W-30,yy);x.lineTo(W-38-(i%2?6:0),yy);x.stroke();}x.restore(); } },
    // 合婚:暖粉,双心 + 小点缀
    hehun:{ bg:'#140a0e', glow:'230,120,150', border:'rgba(230,140,165,.5)', accent:'#e88fb0', hl:'#ffc2d4', muted:'#b38a95', rev:'#d69a78', cardBg:'#1a0f13', divider:'rgba(230,140,165,.2)', hook:'#f0b8c8', accentDim:'#7a5a63',
      ornament(x,W,H,t){ _oHeart(x,52,64,15,t.accent,.5); _oHeart(x,W-54,64,15,t.accent,.5); _oHeart(x,52,H-92,11,t.accent,.4); _oHeart(x,W-50,H-90,11,t.accent,.4); _oDot(x,88,50,2,t.hook,.5); _oDot(x,W-88,82,2,t.hook,.5); } },
    // 今日宜忌:朱砂红黄历风,内框 + 宜/吉印章
    yiji:{ bg:'#140a08', glow:'200,70,50', border:'rgba(210,90,65,.55)', accent:'#e0503c', hl:'#f0d488', muted:'#b08a72', rev:'#d69a78', cardBg:'#1a0d0a', divider:'rgba(210,90,65,.22)', hook:'#e8b878', accentDim:'#7a5a4a',
      ornament(x,W,H,t){ x.save();x.globalAlpha=.35;x.strokeStyle=t.accent;x.lineWidth=1;_rr(x,24,24,W-48,H-48,14);x.stroke();x.restore(); const seal=(sx,ch)=>{x.save();x.globalAlpha=.5;x.strokeStyle=t.accent;x.lineWidth=1.6;_rr(x,sx,40,34,34,4);x.stroke();x.globalAlpha=.6;x.fillStyle=t.accent;x.font='700 16px '+F_CJK;x.textAlign='center';x.textBaseline='middle';x.fillText(ch,sx+17,58);x.restore();}; seal(40,'宜'); seal(W-74,'吉'); } },
    // 星座运势:深蓝星空,星点 + 一小段星座连线 + 亮星芒
    xingzuo:{ bg:'#080b16', glow:'90,130,220', border:'rgba(120,150,230,.5)', accent:'#8aa8e8', hl:'#dfe8ff', muted:'#7c88a8', rev:'#d69a78', cardBg:'#0d1120', divider:'rgba(120,150,230,.2)', hook:'#c0cdf0', accentDim:'#5a6480',
      ornament(x,W,H,t){ const pts=[[44,50],[80,72],[120,44],[W-60,54],[W-98,86],[W-40,112],[60,H-82],[W-70,H-72],[W-120,H-112],[100,H-124]]; pts.forEach((p,i)=>_oDot(x,p[0],p[1],i%3===0?2.2:1.3,t.hl,.5)); x.save();x.globalAlpha=.3;x.strokeStyle=t.accent;x.lineWidth=1;x.beginPath();x.moveTo(44,50);x.lineTo(80,72);x.lineTo(120,44);x.stroke();x.restore(); _oSpark(x,W-58,60,7,t.hl,.6); } },
    // 前世今生:青绿古卷,祥云卷草点缀
    qianshi:{ bg:'#08120f', glow:'70,160,130', border:'rgba(100,180,150,.5)', accent:'#5fbf9a', hl:'#dfeccb', muted:'#7fa094', rev:'#d69a78', cardBg:'#0c1712', divider:'rgba(100,180,150,.2)', hook:'#b8d8c0', accentDim:'#5a7068',
      ornament(x,W,H,t){ _oCloud(x,48,66,12,t.accent,.45); _oCloud(x,W-72,60,12,t.accent,.45); _oCloud(x,52,H-98,10,t.accent,.35); _oCloud(x,W-66,H-94,10,t.accent,.35); _oDot(x,W-40,112,2,t.hook,.4); _oDot(x,50,120,2,t.hook,.4); } }
  };

  function drawCard(model, qr){
    const t=(model&&model.themeId&&THEMES[model.themeId])||THEMES._default; // 无主题 → 金黑(与现状逐字段等价)
    const cards=(Array.isArray(model.cards)&&model.cards.length)?model.cards:null; // 可选:牌面小图(塔罗用)
    const cardsH=cards?228:0;
    const S=2,W=540,H=(qr?740:650)+cardsH,c=document.createElement('canvas');c.width=W*S;c.height=H*S;
    const x=c.getContext('2d');x.scale(S,S);x.textAlign='center';x.textBaseline='alphabetic';

    /* ── 底 + 顶部光晕(略上移,把光托在标题/大数字后面)── */
    x.fillStyle=t.bg;x.fillRect(0,0,W,H);
    const g=x.createRadialGradient(W/2,196,30,W/2,196,450);g.addColorStop(0,'rgba('+t.glow+',.17)');g.addColorStop(1,'rgba('+t.glow+',0)');x.fillStyle=g;x.fillRect(0,0,W,H);
    if(t.ornament){try{t.ornament(x,W,H,t);}catch(e){}x.textAlign='center';x.textBaseline='alphabetic';x.globalAlpha=1;x.shadowBlur=0;_ls(x,'0px');} // 纹样后彻底复位,防污染文字

    /* ── 双描边外框(外实内虚,更精致)── */
    x.strokeStyle=t.border;x.lineWidth=1.5;_rr(x,16,16,W-32,H-32,18);x.stroke();
    x.save();x.globalAlpha=.55;x.strokeStyle=t.divider;x.lineWidth=1;_rr(x,23,23,W-46,H-46,13);x.stroke();x.restore();

    /* ── kicker + 短金线(把眉题与标题分层)── */
    x.fillStyle=t.accent;x.font='12px '+F_MONO;_ls(x,'1.5px');x.fillText(model.kicker||'',W/2,57);_ls(x,'0px');
    x.save();x.globalAlpha=.75;x.strokeStyle=t.accent;x.lineWidth=1.4;x.beginPath();x.moveTo(W/2-15,71);x.lineTo(W/2+15,71);x.stroke();x.restore();

    /* ── 标题(中文衬线;按长度自适应字号;最多 2 行,超长优雅省略)── */
    const title=String(model.title||'');
    let ts = title.length<=8?36 : title.length<=13?31 : 27;
    x.fillStyle=t.hl;x.font='700 '+ts+'px '+F_CJK;
    let lines=_wrap(x,title,W-92);
    if(lines.length>2){let last=lines[1];while(last&&x.measureText(last+'…').width>W-92)last=last.slice(0,-1);lines=[lines[0],last+'…'];}
    let Y=(lines.length>=2?106:114);const lh=ts+9;
    lines.forEach(l=>{x.fillText(l,W/2,Y);Y+=lh;});
    if(model.sub){Y+=4;x.fillStyle=t.muted;x.font='12px '+F_MONO;_ls(x,'.5px');x.fillText(model.sub,W/2,Y);_ls(x,'0px');Y+=8;}
    Y+=40;

    if(cards){
      const n=cards.length,cw=92,ch=158,gap=16,totW=n*cw+(n-1)*gap,sx=(W-totW)/2,ly=Y,iy=Y+18;
      cards.forEach((cd,i)=>{
        const ix=sx+i*(cw+gap),mx=ix+cw/2;
        x.fillStyle=t.muted;x.font='11px '+F_CJK;x.fillText(cd.pos||'',mx,ly+8);
        x.save();x.shadowColor='rgba(0,0,0,.45)';x.shadowBlur=10;x.shadowOffsetY=4;         // 牌面投影,增立体
        x.fillStyle=t.accent;_rr(x,ix-2,iy-2,cw+4,ch+4,8);x.fill();x.restore();             // 牌框(主强调色)
        x.save();_rr(x,ix,iy,cw,ch,6);x.clip();x.translate(mx,iy+ch/2);if(cd.rev)x.rotate(Math.PI);
        if(cd.el)x.drawImage(cd.el,-cw/2,-ch/2,cw,ch);else{x.fillStyle=t.cardBg;x.fillRect(-cw/2,-ch/2,cw,ch);}
        x.restore();
        x.fillStyle=t.hl;x.font='700 12.5px '+F_CJK;x.fillText(cd.name||'',mx,iy+ch+19);
        x.fillStyle=cd.rev?t.rev:t.muted;x.font='10px '+F_MONO;x.fillText(cd.rev?'逆位':'正位',mx,iy+ch+33);
      });
      Y=iy+ch+33+22;
    }

    /* ── 大数字(全卡主角:光晕 + Bebas,跳出来)── */
    if(model.big!=null){
      x.fillStyle=t.muted;x.font='12px '+F_MONO;_ls(x,'1px');x.fillText(model.bigLabel||'',W/2,Y);_ls(x,'0px');Y+=58;
      x.save();x.shadowColor='rgba('+t.glow+',.55)';x.shadowBlur=24;x.fillStyle=t.hl;x.font='700 76px '+F_NUM;x.fillText(String(model.big),W/2,Y);x.restore();
      Y+=44;
    }

    /* ── 四维(收进一块淡底面板,配竖分隔,成组更清楚)── */
    const dims=model.dims||[];
    if(dims.length){
      const pt=Y-8,ph=54;
      x.save();x.globalAlpha=.4;x.fillStyle='rgba('+t.glow+',.06)';_rr(x,44,pt,W-88,ph,12);x.fill();x.globalAlpha=.6;x.strokeStyle=t.divider;x.lineWidth=1;_rr(x,44,pt,W-88,ph,12);x.stroke();x.restore();
      dims.forEach((d,i,a)=>{const cx=W*(i+0.5)/a.length;
        if(i){x.save();x.globalAlpha=.5;x.strokeStyle=t.divider;x.lineWidth=1;const lx=W*i/a.length;x.beginPath();x.moveTo(lx,pt+12);x.lineTo(lx,pt+ph-12);x.stroke();x.restore();}
        x.fillStyle=t.hl;x.font='700 24px '+F_NUM;x.fillText(String(d[1]),cx,pt+29);
        x.fillStyle=t.muted;x.font='10.5px '+F_CJK;x.fillText(d[0],cx,pt+45);
      });
      Y=pt+ph+26;
    }

    /* ── 分隔:细线 + 中点菱形 ── */
    x.strokeStyle=t.divider;x.lineWidth=1;x.beginPath();x.moveTo(66,Y);x.lineTo(W/2-14,Y);x.moveTo(W/2+14,Y);x.lineTo(W-66,Y);x.stroke();
    x.save();x.fillStyle=t.accent;x.globalAlpha=.8;x.translate(W/2,Y);x.rotate(Math.PI/4);x.fillRect(-3,-3,6,6);x.restore();
    Y+=30;

    /* ── 钩子(衬线金句,最多 3 行)── */
    if(model.hook){x.fillStyle=t.hook;x.font='15px '+F_CJK;let hk=String(model.hook);if(hk.length>60)hk=hk.slice(0,60)+'…';_wrap(x,hk,W-100).slice(0,3).forEach(l=>{x.fillText(l,W/2,Y);Y+=26;});}

    /* ── 底部:二维码 / 引导 ── */
    if(qr){const q=104,qx=(W-q)/2,qy=H-198;
      x.save();x.shadowColor='rgba(0,0,0,.4)';x.shadowBlur=14;x.fillStyle='#fff';_rr(x,qx-11,qy-11,q+22,q+22,14);x.fill();x.restore(); // 白底圆角托,扫码更稳更干净
      x.drawImage(qr,qx,qy,q,q);
      x.fillStyle=t.accent;x.font='12.5px '+F_MONO;_ls(x,'.3px');x.fillText('扫码关注「Zion降噪」· 每天一条信号帮你降噪',W/2,H-58);_ls(x,'0px');
      x.fillStyle=t.accentDim;x.font='11px '+F_MONO;x.fillText('qizh.space · 仅供娱乐',W/2,H-34);}
    else{x.fillStyle=t.accent;x.font='13px '+F_MONO;_ls(x,'.3px');x.fillText('微信搜「Zion降噪」测你的',W/2,H-60);_ls(x,'0px');
      x.fillStyle=t.accentDim;x.font='11px '+F_MONO;x.fillText('qizh.space · 仅供娱乐',W/2,H-36);}
    return c;
  }

  /* ── 结果状态 & 分享即解锁 ── */
  let _last=null;
  function applyLock(){const u=localStorage.getItem('ce_unlocked_'+(_last&&_last.toolId))==='1';const z=document.getElementById('ce-lockZone'),ct=document.getElementById('ce-lockCta');if(z)z.classList.toggle('ce-blur',!u);if(ct)ct.style.display=u?'none':'block';}
  async function shareCard(){
    if(!_last)return;
    try{await _warmFonts();}catch(e){}   // 画之前确保自托管拉丁字体已就绪,首图不掉字
    // 可选:预加载分享卡上的牌面小图(同源本地图,不污染 canvas → toDataURL 正常)
    if(_last.card&&Array.isArray(_last.card.cards)&&_last.card.cards.length){
      await Promise.all(_last.card.cards.map(c=>new Promise(r=>{
        if(!c||!c.img||c.el)return r();
        const im=new Image();im.onload=()=>{c.el=im;r();};im.onerror=()=>r();im.src=c.img;
      })));
    }
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
    if(result.card&&cfg&&cfg.id!=null&&result.card.themeId==null)result.card.themeId=cfg.id; // 按工具 id 选主题(工具页零改动;未列入 THEMES 者自动回落金黑)
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
        ${rest.length?`<div class="ce-lockcta" id="ce-lockCta">🔒 下面还有你的<b>完整深度版</b>(藏了后半段)<div style="margin:6px 0 12px;color:#c7c2b8;font-size:12.5px">分享给一个朋友,立刻解锁全部 👇</div><button class="ce-btn g" id="ce-lockShare">📤 分享一下 · 解锁完整版</button><div style="color:#8a8378;font-size:11px;margin-top:8px">分享/保存后自动解锁,只需一次 · 也可微信搜「Zion降噪」</div></div>
        <div class="ce-lockZone ce-blur" id="ce-lockZone">${rest.map(sec).join('')}</div>`:''}
      </div>
      <div class="ce-cta"><div class="ct">🔓 解锁更深 · 每天一条「降噪信号」帮你少焦虑</div>
        <div class="ce-qrs">
          <div class="ce-qr"><img src="/wechat-qr.png" alt="公众号 Zion降噪" loading="lazy"><b>扫码关注公众号</b><span>「Zion降噪」· 每天降噪信号 + 新测试抢先玩</span></div>
          <div class="ce-qr"><img src="/planet-qr.png" alt="知识星球" loading="lazy"><b>扫码进知识星球</b><span>和同频的人一起搞事、拿工具</span></div>
        </div>
        <a class="ce-btn g" href="/join/" style="display:inline-block;margin:6px 0 4px;text-decoration:none">加入「降噪·静音舱」→</a>
        <div class="cb">微信里打不开链接?复制到浏览器:<b>${JOIN_URL}</b></div></div>
      <div class="ce-row"><button class="ce-btn g" id="ce-share">📤 甩给最该看的人</button><button class="ce-btn" id="ce-again">再测一次</button></div>
      <div class="ce-retention">🌙 明天再来测,运势/心情每天都在变 · 把结果甩给最该看的那个人,反应最真实 👀</div>
      ${buildMore(cfg.id)}
      <div class="ce-wm">qizh.space · 微信搜「Zion降噪」· 仅供娱乐</div>`;
    document.getElementById('ce-share').onclick=shareCard;
    const ls=document.getElementById('ce-lockShare');if(ls)ls.onclick=shareCard;
    document.getElementById('ce-again').onclick=()=>{document.getElementById('ce-report').style.display='none';document.getElementById('ce-stage').style.display='block';window.scrollTo({top:0,behavior:'smooth'});};
    applyLock();
    document.getElementById('ce-stage').style.display='none';
    box.style.display='block';box.scrollIntoView({behavior:'smooth',block:'start'});
  }

  return { rngFrom, pick, wpick, imgHash, buildParts, llm, render, drawCard,
           TOOLS, JOIN_URL, buildMore,
           util:{xmur3,mulberry32} };
})();
