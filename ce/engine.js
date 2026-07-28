/* ═══════════════════════════════════════════════════════════════
   病毒工具工厂 · 共享引擎(从 palm 提炼泛化)
   一份工具 = 一份 config,调 CE.run(config) 即可。逻辑与渲染分离,便于日后搬小程序。
   机制:输入 → 确定性种子 →(内容库组合 ‖ LLM生成)→ 渲染 → 分享卡(带QR) → 分享即解锁 + 引流
   ═══════════════════════════════════════════════════════════════ */
window.CE = (function () {
  const API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const GLM_KEY = 'a3627c50241e4ba89fc4f56193b9c724.ADj57yFSiiLajwRC'; // 复用;仅"生成型"工具(起名)用
  const JOIN_URL = 'https://t.zsxq.com/hGab6';                          // 知识星球(微信内多半打不开→靠扫码/复制到浏览器)
  /* 微信内可达的镜像:主站 qizh.space 被微信拦了(链接和指向它的码都打不开),
     镜像由 Actions 每 2 小时从主站同步,路径与主站逐字一致 → 分享卡上的码/文本战报里的链接都走它。 */
  const WX_HOST  = 'https://rain0x7.github.io';

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
    {id:'chongkai',name:'人生重开',   icon:'🎮', url:'/ce/chongkai/',hook:'抽个天赋,随机重开一次人生'},
    {id:'moyu',    name:'摸鱼时薪',   icon:'🐟', url:'/ce/moyu/',    hook:'算算你真实时薪,摸鱼才是回本'}
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

  /* ── 分享卡(canvas 竖版海报,底部画"工具码 + 公众号码 + 星球码")── */
  function _loadImg(src,cache,key){return new Promise(r=>{if(cache[key]!==undefined)return r(cache[key]);
    const im=new Image();im.onload=()=>{cache[key]=im;r(im);};im.onerror=()=>{cache[key]=null;r(null);};im.src=src;});}
  const _imgCache={};
  function loadWxQR(){return _loadImg('/wechat-qr.png',_imgCache,'wx');}
  function loadPlanetQR(){return _loadImg('/planet-qr.png',_imgCache,'planet');}

  /* ── 工具在镜像上的地址(微信里可点开、二维码能识别)。未知 id → 回落到测测矩阵首页,永远不返回死链。 */
  function wxUrl(toolId){
    const t=TOOLS.filter(function(x){return x.id===toolId;})[0];
    return WX_HOST+(t?t.url:'/ce/');
  }

  /* ═══ 精简 QR 编码器(byte 模式 · 纠错级 M · 版本 1~6,≤106 字节;纯 JS,零依赖零外链)═══
     只为一件事服务:把"当前工具的镜像地址"画到分享卡上,让收到卡的人长按识别就能直接进来玩。
     标准流程:UTF-8 → 位流(模式+字数+数据+填充) → RS 纠错 → 分块交织 → 矩阵(定位/校正/定时/暗模块)
              → 8 种掩码全试取罚分最低 → 写格式信息(BCH(15,5) ^ 0x5412)。 */
  const _QRT ={1:[26,10,1],2:[44,16,1],3:[70,26,1],4:[100,18,2],5:[134,24,2],6:[172,16,4]}; // 版本:[总码字, 每块纠错码字, 块数]
  const _QRAL={1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34]};                          // 校正图案中心坐标
  let _GE,_GL;
  function _gfInit(){ if(_GE)return; _GE=new Array(512);_GL=new Array(256);
    let x=1; for(let i=0;i<255;i++){_GE[i]=x;_GL[x]=i;x<<=1;if(x&256)x^=0x11d;}   // GF(256),本原多项式 0x11d
    for(let i=255;i<512;i++)_GE[i]=_GE[i-255]; }
  function _gmul(a,b){ if(!a||!b)return 0; return _GE[_GL[a]+_GL[b]]; }
  function _rsGen(n){ _gfInit(); let p=[1];                                        // 生成多项式 ∏(x-α^i),高次在前
    for(let i=0;i<n;i++){const q=new Array(p.length+1).fill(0);
      for(let j=0;j<p.length;j++){q[j]^=p[j];q[j+1]^=_gmul(p[j],_GE[i]);}p=q;}
    return p; }
  function _rsEnc(data,n){ const g=_rsGen(n),r=new Array(n).fill(0);
    for(let k=0;k<data.length;k++){const f=data[k]^r[0];r.shift();r.push(0);
      if(f)for(let i=0;i<n;i++)r[i]^=_gmul(g[i+1],f);}
    return r; }
  function _utf8(s){ const o=[];
    for(const ch of String(s)){const c=ch.codePointAt(0);
      if(c<0x80)o.push(c);
      else if(c<0x800)o.push(0xc0|c>>6,0x80|c&63);
      else if(c<0x10000)o.push(0xe0|c>>12,0x80|c>>6&63,0x80|c&63);
      else o.push(0xf0|c>>18,0x80|c>>12&63,0x80|c>>6&63,0x80|c&63);}
    return o; }
  function _maskBit(k,r,c){switch(k){                                              // r=行(y) c=列(x)
    case 0: return (r+c)%2===0;
    case 1: return r%2===0;
    case 2: return c%3===0;
    case 3: return (r+c)%3===0;
    case 4: return (Math.floor(r/2)+Math.floor(c/3))%2===0;
    case 5: return (r*c)%2+(r*c)%3===0;
    case 6: return ((r*c)%2+(r*c)%3)%2===0;
    default:return ((r+c)%2+(r*c)%3)%2===0;}}
  function _qrFmt(m,n,mask){                                                       // 格式信息(M 级 formatBits=0),两份互备
    const d=mask; let rem=d; for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
    const bits=((d<<10|rem)^0x5412)&0x7fff, gb=i=>(bits>>i)&1;
    for(let i=0;i<=5;i++)m[i*n+8]=gb(i);
    m[7*n+8]=gb(6); m[8*n+8]=gb(7); m[8*n+7]=gb(8);
    for(let i=9;i<15;i++)m[8*n+(14-i)]=gb(i);
    for(let i=0;i<8;i++)m[8*n+(n-1-i)]=gb(i);
    for(let i=8;i<15;i++)m[(n-15+i)*n+8]=gb(i);
    m[(n-8)*n+8]=1;                                                               // 固定暗模块
  }
  function _qrPenalty(m,n){                                                        // 标准四条罚分规则,用于挑掩码
    const g=(r,c)=>m[r*n+c]; let p=0;
    for(let r=0;r<n;r++){let run=1;for(let c=1;c<n;c++){if(g(r,c)===g(r,c-1))run++;else{if(run>=5)p+=3+run-5;run=1;}}if(run>=5)p+=3+run-5;}
    for(let c=0;c<n;c++){let run=1;for(let r=1;r<n;r++){if(g(r,c)===g(r-1,c))run++;else{if(run>=5)p+=3+run-5;run=1;}}if(run>=5)p+=3+run-5;}
    for(let r=0;r<n-1;r++)for(let c=0;c<n-1;c++){const v=g(r,c);if(v===g(r,c+1)&&v===g(r+1,c)&&v===g(r+1,c+1))p+=3;}
    const P1=[1,0,1,1,1,0,1,0,0,0,0],P2=[0,0,0,0,1,0,1,1,1,0,1];
    const scan=get=>{let s=0;for(let i=0;i+11<=n;i++){let a=true,b=true;
      for(let j=0;j<11;j++){const v=get(i+j);if(v!==P1[j])a=false;if(v!==P2[j])b=false;}
      if(a)s+=40;if(b)s+=40;}return s;};
    for(let r=0;r<n;r++)p+=scan(i=>g(r,i));
    for(let c=0;c<n;c++)p+=scan(i=>g(i,c));
    let dark=0;for(let i=0;i<n*n;i++)dark+=m[i];
    p+=Math.floor(Math.abs(dark*100/(n*n)-50)/5)*10;
    return p;
  }
  /* 返回 {n:边长, m:Uint8Array(n*n) 0/1, v:版本, mask:掩码};放不下或异常 → null(调用方降级为不画这个码)*/
  const _qrMemo={};
  function qrEncode(str,forceMask){
    const ck=forceMask==null?String(str):null;
    if(ck!==null&&_qrMemo[ck]!==undefined)return _qrMemo[ck];          // 一张卡画两个比例 → 别重复编码
    const out=_qrEncode1(str,forceMask);
    if(ck!==null)_qrMemo[ck]=out;
    return out;
  }
  function _qrEncode1(str,forceMask){
    try{
      const by=_utf8(str); let v=0,T=null;
      for(let i=1;i<=6;i++){const t=_QRT[i];if(by.length+2<=t[0]-t[1]*t[2]){v=i;T=t;break;}}
      if(!v)return null;                                                           // >106 字节:本编码器不支持,宁可不画也不画个扫不出的
      const total=T[0],ecc=T[1],nb=T[2],dataCw=total-ecc*nb;
      /* ① 位流 */
      const bits=[],push=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push(val>>i&1);};
      push(4,4);push(by.length,8);by.forEach(b=>push(b,8));                        // 模式 0100 + 字数(v1~9 byte 模式 8 bit)
      for(let i=0;i<4&&bits.length<dataCw*8;i++)bits.push(0);                      // 终止符
      while(bits.length%8)bits.push(0);
      const cw=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=b<<1|bits[i+j];cw.push(b);}
      for(let i=0;cw.length<dataCw;i++)cw.push(i%2?0x11:0xEC);                     // 填充码字 EC 11 交替
      /* ② 分块 + RS + 交织 */
      const per=dataCw/nb,ds=[],es=[];
      for(let i=0;i<nb;i++){const d=cw.slice(i*per,(i+1)*per);ds.push(d);es.push(_rsEnc(d,ecc));}
      const seq=[];
      for(let i=0;i<per;i++)for(let b=0;b<nb;b++)seq.push(ds[b][i]);
      for(let i=0;i<ecc;i++)for(let b=0;b<nb;b++)seq.push(es[b][i]);
      /* ③ 矩阵骨架(功能模块 fnm 标记,数据填充时跳过)*/
      const n=17+4*v,m=new Uint8Array(n*n),fnm=new Uint8Array(n*n);
      const put=(r,c,val)=>{if(r>=0&&c>=0&&r<n&&c<n){m[r*n+c]=val;fnm[r*n+c]=1;}};
      const fin=(r0,c0)=>{for(let i=-1;i<=7;i++)for(let j=-1;j<=7;j++){
        const on=(i>=0&&i<=6&&(j===0||j===6))||(j>=0&&j<=6&&(i===0||i===6))||(i>=2&&i<=4&&j>=2&&j<=4);
        put(r0+i,c0+j,on?1:0);}};                                                  // 定位图案 + 分隔符
      fin(0,0);fin(0,n-7);fin(n-7,0);
      for(let i=8;i<n-8;i++){const b=i%2?0:1;put(6,i,b);put(i,6,b);}               // 定时图案
      const al=_QRAL[v],aLast=al[al.length-1];
      for(const r of al)for(const c of al){
        if((r===6&&c===6)||(r===6&&c===aLast)||(r===aLast&&c===6))continue;         // 与定位图案重叠的三处不画
        for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)put(r+i,c+j,Math.max(Math.abs(i),Math.abs(j))===1?0:1);}
      for(let i=0;i<=8;i++){if(i!==6){put(i,8,0);put(8,i,0);}}                     // 格式信息区先占位(跳过定时模块)
      for(let i=0;i<8;i++){put(8,n-1-i,0);put(n-1-i,8,0);}
      /* ④ 数据位:两列一组、上下折返的锯齿序 */
      let bi=0;const nbits=seq.length*8;
      for(let right=n-1;right>=1;right-=2){
        if(right===6)right=5;                                                      // 第 6 列是定时图案,整列跳过
        for(let vert=0;vert<n;vert++)for(let j=0;j<2;j++){
          const c=right-j,up=((right+1)&2)===0,r=up?n-1-vert:vert;
          if(!fnm[r*n+c]&&bi<nbits){m[r*n+c]=(seq[bi>>3]>>(7-(bi&7)))&1;bi++;}
        }
      }
      /* ⑤ 掩码:8 种全试(含格式信息),取罚分最低 */
      let bestS=Infinity,bestK=0,bestM=null;
      const ks=(forceMask!=null)?[forceMask&7]:[0,1,2,3,4,5,6,7];
      for(const k of ks){
        const t=Uint8Array.from(m);
        for(let r=0;r<n;r++)for(let c=0;c<n;c++){if(!fnm[r*n+c]&&_maskBit(k,r,c))t[r*n+c]^=1;}
        _qrFmt(t,n,k);
        const s=(ks.length===1)?0:_qrPenalty(t,n);
        if(s<bestS||bestM===null){bestS=s;bestK=k;bestM=t;}
      }
      return {n:n,m:bestM,v:v,mask:bestK};
    }catch(e){return null;}
  }
  /* 把 URL 画成二维码:切到设备像素 + 模块尺寸取整 → 边缘绝不发虚(截图后照样扫得出)。含 4 模块静区。
     px/py/size 是逻辑坐标,S 是画布缩放倍数。返回是否画成功。 */
  function drawQRCode(x,str,px,py,size,S){
    return _qrPaint(x,qrEncode(str),px,py,size,S);
  }
  function _qrPaint(x,q,px,py,size,S){
    if(!q)return false;
    const tot=q.n+8,mod=Math.max(1,Math.floor(size*S/tot)),side=mod*tot;
    x.save();
    try{
      x.setTransform(1,0,0,1,0,0);                                                 // 设备像素坐标系:整数对齐
      const ox=Math.round(px*S+(size*S-side)/2),oy=Math.round(py*S+(size*S-side)/2);
      x.fillStyle='#fff';x.fillRect(ox,oy,side,side);
      x.fillStyle='#000';
      for(let r=0;r<q.n;r++)for(let c=0;c<q.n;c++)if(q.m[r*q.n+c])x.fillRect(ox+(c+4)*mod,oy+(r+4)*mod,mod,mod);
    }catch(e){x.restore();return false;}
    x.restore();return true;
  }
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
  /* 色块上文字亮/暗自适应(按感知明度;colorcard 用)*/
  function _lum(hex){hex=String(hex||'').replace('#','');if(hex.length<6)return 1;const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);if(isNaN(r+g+b))return 1;return (0.299*r+0.587*g+0.114*b)/255;}
  function _txtOn(hex){return _lum(hex)>0.62?'#2b2721':'#fdfbf6';}
  /* ── 颜色工具(给"按分档做主题变体"用;纯函数,解析失败一律原样返回,永不炸卡)── */
  function _hex2rgb(h){h=String(h||'').trim().replace('#','');if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];if(!/^[0-9a-fA-F]{6}$/.test(h))return null;const n=parseInt(h,16);return [n>>16&255,n>>8&255,n&255];}
  function _rgb2hex(r,g,b){const f=v=>('0'+Math.max(0,Math.min(255,Math.round(v))).toString(16)).slice(-2);return '#'+f(r)+f(g)+f(b);}
  function _rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;let h=0,s=0;if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);h*=60;}return [h,s,l];}
  function _hsl2rgb(h,s,l){h=((h%360)+360)%360/360;if(s<=0){const v=l*255;return [v,v,v];}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return [f(h+1/3)*255,f(h)*255,f(h-1/3)*255];}
  function _hlerp(h,to,w){const d=((to-h+540)%360)-180;return (h+d*w+360)%360;}
  /* k∈[-.5,+.5]:负=低档(更冷更暗更灰) / 正=高档(更亮更饱和) */
  function _tune(hex,k){const rgb=_hex2rgb(hex);if(!rgb)return hex;let[h,s,l]=_rgb2hsl(rgb[0],rgb[1],rgb[2]);
    if(k<0)h=_hlerp(h,214,Math.min(.42,-k*.8));                   // 低档:色相往冷蓝挪
    s=Math.max(.02,Math.min(1,s*(1+k*1.5)+Math.max(0,k)*.16));    // 高档更饱和(并给一点绝对提升,冷灰主题也拉得开)
    l=Math.max(.09,Math.min(.95,l+k*.26));                        // 高档更亮、低档更暗
    const o=_hsl2rgb(h,s,l);return _rgb2hex(o[0],o[1],o[2]);}
  function _tuneTriple(tri,k){const p=String(tri||'').split(',').map(Number);if(p.length!==3||p.some(v=>!isFinite(v)))return tri;
    const hx=_tune(_rgb2hex(p[0],p[1],p[2]),k),o=_hex2rgb(hx);return o?o.join(','):tri;}
  function _tuneAlpha(col,k){return String(col||'').replace(/rgba\(([^)]+)\)/i,(m,inner)=>{const p=inner.split(',');if(p.length!==4)return m;
    const a=parseFloat(p[3]);if(!isFinite(a))return m;return 'rgba('+p[0]+','+p[1]+','+p[2]+','+Math.max(.08,Math.min(.95,a*(1+k*.5))).toFixed(3)+')';});}
  /* tier:0~1 数值(>1 视为百分制)或 'low'|'mid'|'high'|'max';不认识 → null(视觉完全不变)*/
  const TIER_MAP={low:.16,lo:.16,l:.16,mid:.45,middle:.45,m:.45,high:.72,hi:.72,h:.72,max:1,peak:1,top:1};
  function _tierVal(v){
    if(v==null||v==='')return null;
    if(typeof v==='number'){if(!isFinite(v))return null;const n=v>1?v/100:v;return Math.max(0,Math.min(1,n));}
    const k=String(v).trim().toLowerCase();
    if(TIER_MAP[k]!=null)return TIER_MAP[k];
    if(/^[\d.]+%?$/.test(k)){const n=parseFloat(k);if(isFinite(n))return Math.max(0,Math.min(1,n>1?n/100:n));}
    return null;
  }
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
      ornament(x,W,H,t){ _oCloud(x,48,66,12,t.accent,.45); _oCloud(x,W-72,60,12,t.accent,.45); _oCloud(x,52,H-98,10,t.accent,.35); _oCloud(x,W-66,H-94,10,t.accent,.35); _oDot(x,W-40,112,2,t.hook,.4); _oDot(x,50,120,2,t.hook,.4); } },
    // 摸鱼时薪:钞票冷绿,角落 ¥/$ 货币符 + 散落"铜钱"点
    moyu:{ bg:'#08120c', glow:'80,180,120', border:'rgba(110,200,150,.5)', accent:'#6fce9a', hl:'#d6f5e2', muted:'#7ea08c', rev:'#d69a78', cardBg:'#0c1712', divider:'rgba(110,200,150,.2)', hook:'#b8e6cc', accentDim:'#5a7a68',
      ornament(x,W,H,t){ x.save();x.globalAlpha=.42;x.fillStyle=t.accent;x.font='700 20px '+F_MONO;x.textAlign='center';x.textBaseline='middle';x.fillText('¥',52,60);x.fillText('$',W-52,62);x.restore(); _oDot(x,W-52,H-104,2.5,t.accent,.4); _oDot(x,54,H-122,2.5,t.accent,.4); _oDot(x,90,48,1.6,t.hook,.5); _oDot(x,W-92,H-142,1.6,t.hook,.4); } },
    // 人生进度条:时间冷蓝紫,角落沙漏 + 星点
    lifebar:{ bg:'#0b0a16', glow:'120,110,220', border:'rgba(150,140,230,.5)', accent:'#9a8fe8', hl:'#e2ddff', muted:'#8c86a8', rev:'#d69a78', cardBg:'#100e1c', divider:'rgba(150,140,230,.2)', hook:'#c8c0f0', accentDim:'#5f5a80',
      ornament(x,W,H,t){ /* 沙漏:腔体(交叉双三角)+ 上下横盖 + 中间沙点 —— 有盖才读得出是沙漏,没盖只会读成 ✕ */
        const hg=(cx,cy,s)=>{x.save();x.globalAlpha=.5;x.strokeStyle=t.accent;x.lineWidth=1.4;x.lineCap='round';
          x.beginPath();x.moveTo(cx-s,cy-s);x.lineTo(cx+s,cy-s);x.lineTo(cx-s,cy+s);x.lineTo(cx+s,cy+s);x.closePath();x.stroke();
          const cap=s*1.3;x.lineWidth=1.9;x.beginPath();x.moveTo(cx-cap,cy-s);x.lineTo(cx+cap,cy-s);x.moveTo(cx-cap,cy+s);x.lineTo(cx+cap,cy+s);x.stroke();
          x.globalAlpha=.75;x.fillStyle=t.accent;x.beginPath();x.arc(cx,cy,1.2,0,6.2832);x.fill();x.restore();}; hg(52,62,10); hg(W-52,62,10); _oDot(x,52,H-106,2,t.accent,.4); _oDot(x,W-52,H-106,2,t.accent,.4); _oSpark(x,90,50,4,t.hook,.5); _oSpark(x,W-90,H-132,4,t.hook,.45); } },
    // 黑话翻译:黑绿终端感,角落 >_ 提示符 + 侧边扫描线刻度
    heihua:{ bg:'#060a07', glow:'80,200,120', border:'rgba(90,210,130,.45)', accent:'#5fd67a', hl:'#c8f5d4', muted:'#6f9a7e', rev:'#d69a78', cardBg:'#0a120c', divider:'rgba(90,210,130,.18)', hook:'#a8e6b8', accentDim:'#4a6a54',
      ornament(x,W,H,t){ x.save();x.globalAlpha=.5;x.fillStyle=t.accent;x.font='700 15px '+F_MONO;x.textAlign='left';x.textBaseline='middle';x.fillText('>_',40,62);x.restore();
        /* 扫描线刻度:左右对称 + 压到底部区两侧(x≤44,永远不贴钩子文案)*/
        x.save();x.globalAlpha=.28;x.strokeStyle=t.accent;x.lineWidth=1;for(let i=0;i<6;i++){const yy=H-100-i*16,len=i%2?16:10;x.beginPath();x.moveTo(28,yy);x.lineTo(28+len,yy);x.stroke();x.beginPath();x.moveTo(W-28,yy);x.lineTo(W-28-len,yy);x.stroke();}x.restore(); _oDot(x,W-46,60,2,t.hook,.5); } },
    // 人生重开:游戏像素暖橙,角落像素方块群 + 像素心(生命)
    chongkai:{ bg:'#140c06', glow:'240,150,60', border:'rgba(240,160,80,.5)', accent:'#f0994a', hl:'#ffd9a8', muted:'#b0917a', rev:'#d69a78', cardBg:'#1a0f08', divider:'rgba(240,160,80,.2)', hook:'#f5c890', accentDim:'#7a5a3a',
      ornament(x,W,H,t){ const px=(ox,oy,s,col,a)=>{x.save();x.globalAlpha=a;x.fillStyle=col;x.fillRect(ox,oy,s,s);x.restore();}; px(40,50,7,t.accent,.5);px(49,50,7,t.hook,.4);px(40,59,7,t.hook,.35); px(W-47,52,7,t.accent,.5);px(W-56,52,7,t.hook,.4);px(W-47,61,7,t.hook,.35); const ph=(ox,oy)=>{const s=4;[[1,0],[3,0],[0,1],[1,1],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[2,3]].forEach(p=>px(ox+p[0]*s,oy+p[1]*s,s,t.accent,.4));}; ph(44,H-118); ph(W-72,H-118); } }
  };

  /* ── 主题解析:工具主题 → 再按结果强度(model.tier)做"档位变体" ──
     同一工具的不同称号(如牛马浓度 low/mid/high/max)出的卡不再是同一张:高档更亮更饱和、低档更冷更暗。
     没传 tier 的工具 → 原封不动返回工具主题对象本身,视觉与升级前逐字段等价(零回归)。 */
  function themeFor(model){
    const base=(model&&model.themeId&&THEMES[model.themeId])||THEMES._default;
    const tv=_tierVal(model&&model.tier);
    if(tv==null)return base;
    const k=tv-0.5;                                   // -0.5 最低档 → +0.5 最高档
    const t=Object.assign({},base);                   // 浅拷贝:ornament 等原样带过来
    t.accent   =_tune(base.accent,k);
    t.hl       =_tune(base.hl,k*0.8);
    t.hook     =_tune(base.hook,k*0.8);
    t.muted    =_tune(base.muted,k*0.45);
    t.accentDim=_tune(base.accentDim,k*0.5);
    t.glow     =_tuneTriple(base.glow,k);
    t.border   =_tuneAlpha(base.border,k);
    t.divider  =_tuneAlpha(base.divider,k);
    t.tierV=tv;                                       // 供光晕强度用
    return t;
  }

  /* 底部区(二维码/引导)占位高度:从"白底托的顶边 / 首行文案的顶边"到卡片底边 —— 卡片总高 = 内容高 + 留白 + 它
     BOT_ROW=多码一行(工具码+公众号+星球) / BOT_QR=只有一个码(退化) / BOT_TXT=一个码都没有(纯文案) */
  const BOT_ROW=236, BOT_QR=209, BOT_TXT=75;
  /* 导出比例:phone=现有手机竖版(540×动态高) / 34=小红书 1080×1440(逻辑 540×720,重新排版而非拉伸)*/
  const RATIO_34_H=720;

  function drawCard(model, qr, opts){
    const t=themeFor(model);                                               // 无主题 → 金黑;有 tier → 档位变体
    const wide=!!(opts&&/^3[:x_-]?4$/.test(String(opts.ratio||'')));       // '3:4' / '34' → 小红书比例
    const cards=(Array.isArray(model.cards)&&model.cards.length)?model.cards:null; // 可选:牌面小图(塔罗用)
    const cc=(model.colorcard&&model.colorcard.main)?model.colorcard:null;         // 可选:本命色卡(主色+辅助色,sekapian 用)
    const ccAux=cc&&Array.isArray(cc.aux)?cc.aux.slice(0,4):[];
    const S=2,W=540;

    /* ── 底部码位:①工具码(前端现算,指向微信可达镜像)②公众号码 ③星球码 ──
       ① 才是闭环那一步:收到卡的人长按识别就能直接进来玩,不必再去搜公众号;②③ 仍是转化目标,原样保留。
       编码失败/图没加载到 → 该码自动缺席,布局按实际码数收缩,永不留空洞。 */
    const toolUrl=(opts&&opts.wxUrl)||wxUrl(model&&(model.toolId||model.themeId));
    const toolQ=(opts&&opts.noToolQR)?null:qrEncode(toolUrl);
    const planet=(opts&&opts.planet)||null;
    const codes=[];
    if(qr)     codes.push({img:qr,     lab:'关注公众号', hero:false});
    if(toolQ)  codes.push({q:toolQ,    lab:'长按识别·直接玩', hero:true});
    if(planet) codes.push({img:planet, lab:'进星球',     hero:false});

    /* ── 内容流(kicker → 标题 → 牌面 → 色卡 → 大数字 → 四维 → 分隔 → 钩子)──
       同一段代码跑两遍:第一遍在 8×8 离屏画布上"空跑"(只借它的 measureText 做折行,像素丢弃)拿到内容真实高度,
       第二遍在按内容定好高的真画布上绘制。dy = 触发最小高时补给顶部的偏移。返回内容结束的 Y。 */
    function flow(x,dy){
      /* ── kicker + 短金线(把眉题与标题分层)── */
      x.fillStyle=t.accent;x.font='12px '+F_MONO;_ls(x,'1.5px');x.fillText(model.kicker||'',W/2,57+dy);_ls(x,'0px');
      x.save();x.globalAlpha=.75;x.strokeStyle=t.accent;x.lineWidth=1.4;x.beginPath();x.moveTo(W/2-15,71+dy);x.lineTo(W/2+15,71+dy);x.stroke();x.restore();

      /* ── 标题(中文衬线;按长度自适应字号;最多 2 行,超长优雅省略)── */
      const title=String(model.title||'');
      let ts = title.length<=8?36 : title.length<=13?31 : 27;
      x.fillStyle=t.hl;x.font='700 '+ts+'px '+F_CJK;
      let lines=_wrap(x,title,W-92);
      if(lines.length>2){let last=lines[1];while(last&&x.measureText(last+'…').width>W-92)last=last.slice(0,-1);lines=[lines[0],last+'…'];}
      let Y=(lines.length>=2?106:114)+dy;const lh=ts+9;
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

      /* ── 本命色卡(colorcard 工具用:主色 hero 大色块 + 一排辅助色小块;无 colorcard 时整段跳过,向后兼容)── */
      if(cc){
        const mx0=44,mw=W-88,mh=150;
        x.save();x.shadowColor='rgba(0,0,0,.42)';x.shadowBlur=18;x.shadowOffsetY=6;x.fillStyle=cc.main.hex||'#888';_rr(x,mx0,Y,mw,mh,16);x.fill();x.restore();
        x.save();x.globalAlpha=.12;x.strokeStyle='#000';x.lineWidth=1;_rr(x,mx0,Y,mw,mh,16);x.stroke();x.restore();
        const tc=_txtOn(cc.main.hex);x.fillStyle=tc;x.textAlign='left';
        x.save();x.globalAlpha=.72;x.font='11px '+F_MONO;_ls(x,'2px');x.fillText('本命主色',mx0+22,Y+34);_ls(x,'0px');x.restore();
        x.font='700 40px '+F_CJK;x.fillText(String(cc.main.name||''),mx0+20,Y+mh-42);
        x.save();x.globalAlpha=.85;x.font='13px '+F_MONO;_ls(x,'1.5px');x.fillText(String(cc.main.hex||'').toUpperCase(),mx0+22,Y+mh-16);_ls(x,'0px');x.restore();
        x.textAlign='center';Y+=mh+20;
        if(ccAux.length){
          const n=ccAux.length,gap=12,aw=(mw-(n-1)*gap)/n,ah=52;
          ccAux.forEach((a,i)=>{const ax=mx0+i*(aw+gap),acx=ax+aw/2;
            x.save();x.shadowColor='rgba(0,0,0,.3)';x.shadowBlur=8;x.shadowOffsetY=3;x.fillStyle=a.hex||'#888';_rr(x,ax,Y,aw,ah,10);x.fill();x.restore();
            x.save();x.globalAlpha=.1;x.strokeStyle='#000';x.lineWidth=1;_rr(x,ax,Y,aw,ah,10);x.stroke();x.restore();
            x.fillStyle=t.hl;x.font='700 12px '+F_CJK;x.fillText(String(a.name||''),acx,Y+ah+18);
            x.fillStyle=t.muted;x.font='9px '+F_MONO;x.fillText(String(a.hex||'').toUpperCase(),acx,Y+ah+31);
          });
          Y+=ah+31+22;
        }
      }

      /* ── 大数字(全卡主角:光晕 + Bebas,跳出来)── */
      if(model.big!=null){
        x.fillStyle=t.muted;x.font='12px '+F_MONO;_ls(x,'1px');x.fillText(model.bigLabel||'',W/2,Y);_ls(x,'0px');Y+=58;
        const bA=t.tierV==null?.55:(.34+.42*t.tierV), bB=t.tierV==null?24:Math.round(16+18*t.tierV); // 有分档:高档大数字光更炸
        x.save();x.shadowColor='rgba('+t.glow+','+bA.toFixed(2)+')';x.shadowBlur=bB;x.fillStyle=t.hl;x.font='700 76px '+F_NUM;x.fillText(String(model.big),W/2,Y);x.restore();
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
      return Y;
    }

    /* ── ① 量:离屏空跑一遍,拿到内容真实高度(与真绘制同一份代码,不会量错)── */
    let contentH;
    try{const mc=document.createElement('canvas');mc.width=mc.height=8;contentH=flow(mc.getContext('2d'),0);}
    catch(e){contentH=(qr?740:650)-(qr?BOT_QR:BOT_TXT)-26;}   // 极端兜底:退回原固定高度的等效值

    /* ── ② 定高:手机版高度跟着内容走;3:4 版高度写死 720(=1080×1440),靠留白/等比缩放重新排版 ── */
    const nc=codes.length;
    const BOT=nc>=2?BOT_ROW:(nc===1?BOT_QR:BOT_TXT), GAP=nc?26:24, MINH=nc>=2?590:(nc===1?560:430);   // GAP=内容与底部区之间的呼吸;MINH=兜底,只对最短的卡(如起名:标题+副标+钩子)生效
    const need=Math.round(contentH+GAP+BOT);
    let H, dy, cs=1;                                              // cs=内容等比缩放(仅 3:4 且内容超高时 <1,等比不变形)
    if(wide){
      H=RATIO_34_H;
      const avail=H-BOT-GAP;                                      // 内容可用高度
      if(contentH<=avail){dy=Math.max(0,Math.round((avail-contentH)/2));} // 内容居中,上下留白对称
      else{dy=0;cs=avail/contentH;}                               // 内容超高 → 整块等比缩到刚好放下(宽度同步收,居中,绝不拉伸)
    }else{
      H=Math.max(MINH,need);
      dy=Math.min(56,Math.max(0,Math.round((H-need)*0.7)));        // 触发最小高时富余主要补到顶部(至多 56),别全堆在二维码上方变死区
    }

    /* ── ③ 画 ── */
    const c=document.createElement('canvas');c.width=W*S;c.height=H*S;
    const x=c.getContext('2d');x.scale(S,S);x.textAlign='center';x.textBaseline='alphabetic';

    /* ── 底 + 顶部光晕(略上移,把光托在标题/大数字后面;有 tier 时光晕强度随档位走)── */
    const gA=(t.tierV==null?.17:(.09+.17*t.tierV)).toFixed(3);
    const gy=wide?Math.round(196+dy*0.55):196;
    x.fillStyle=t.bg;x.fillRect(0,0,W,H);
    const g=x.createRadialGradient(W/2,gy,30,W/2,gy,450);g.addColorStop(0,'rgba('+t.glow+','+gA+')');g.addColorStop(1,'rgba('+t.glow+',0)');x.fillStyle=g;x.fillRect(0,0,W,H);
    if(t.ornament){try{t.ornament(x,W,H,t);}catch(e){}x.textAlign='center';x.textBaseline='alphabetic';x.globalAlpha=1;x.shadowBlur=0;_ls(x,'0px');} // 纹样后彻底复位,防污染文字

    /* ── 双描边外框(外实内虚,更精致)── */
    x.strokeStyle=t.border;x.lineWidth=1.5;_rr(x,16,16,W-32,H-32,18);x.stroke();
    x.save();x.globalAlpha=.55;x.strokeStyle=t.divider;x.lineWidth=1;_rr(x,23,23,W-46,H-46,13);x.stroke();x.restore();

    if(cs!==1){x.save();x.translate(W*(1-cs)/2,0);x.scale(cs,cs);flow(x,dy);x.restore();x.textAlign='center';x.textBaseline='alphabetic';}
    else flow(x,dy);

    /* ── 底部:多码一行 / 单码 / 纯文案(微信封了主站域名 → 文案只教"长按识别"这个真能走通的动作)── */
    if(nc>=2){
      /* 一行排开:工具码当主角(更大 + 描金环 + 强调色文案),公众号/星球码略小陪衬。
         尺寸按"截图后仍扫得出"来定:主码 120 逻辑px = 240 设备px / 37 模块 → 每模块 6 设备px。 */
      const HQ=120,SQ=104,PAD=9;                                    // 主码 / 陪衬码 / 白底托内边距
      const ws=codes.map(k=>(k.hero?HQ:SQ)+PAD*2);
      const gap=nc>=3?42:52, totW=ws.reduce((a,b)=>a+b,0)+gap*(nc-1);
      let px0=Math.round((W-totW)/2);
      const heroTop=H-BOT;                                          // 主码白底托的顶边 = 底部区顶边
      codes.forEach(k=>{
        const q=k.hero?HQ:SQ, pw=q+PAD*2, py=heroTop+(k.hero?0:Math.round((HQ-SQ)/2));
        x.save();x.shadowColor='rgba(0,0,0,.42)';x.shadowBlur=k.hero?15:11;x.fillStyle='#fff';_rr(x,px0,py,pw,pw,12);x.fill();x.restore();
        if(k.hero){x.save();x.globalAlpha=.9;x.strokeStyle=t.accent;x.lineWidth=1.8;_rr(x,px0-3,py-3,pw+6,pw+6,15);x.stroke();x.restore();} // 描金环:一眼看出该长按哪个
        if(k.q)_qrPaint(x,k.q,px0+PAD,py+PAD,q,S);                  // 现算的工具码(设备像素整数对齐,不发虚)
        else   x.drawImage(k.img,px0+PAD,py+PAD,q,q);
        const cx=px0+pw/2, ly=py+pw+(k.hero?18:16);
        if(k.hero){x.fillStyle=t.hl;x.font='700 11.5px '+F_CJK;}
        else      {x.fillStyle=t.muted;x.font='10.5px '+F_CJK;}
        x.fillText(k.lab,cx,ly,pw+gap-8);
        px0+=pw+gap;
      });
      x.fillStyle=t.accent;x.font='12px '+F_MONO;_ls(x,'.3px');x.fillText('长按这张图 · 识别二维码 → 直接进来玩',W/2,H-50);_ls(x,'0px');
      x.fillStyle=t.accentDim;x.font='10.5px '+F_MONO;x.fillText('识别不出?微信搜「Zion降噪」· 仅供娱乐',W/2,H-27);
    }
    else if(nc===1){const k=codes[0],q=104,qx=(W-q)/2,qy=H-198;
      x.save();x.shadowColor='rgba(0,0,0,.4)';x.shadowBlur=14;x.fillStyle='#fff';_rr(x,qx-11,qy-11,q+22,q+22,14);x.fill();x.restore(); // 白底圆角托,扫码更稳更干净
      if(k.q)_qrPaint(x,k.q,qx,qy,q,S);else x.drawImage(k.img,qx,qy,q,q);
      x.fillStyle=t.accent;x.font='12.5px '+F_MONO;_ls(x,'.3px');x.fillText(k.hero?'长按这张图 · 识别二维码 → 直接进来玩':'长按这张图 · 识别二维码 → 关注「Zion降噪」',W/2,H-58);_ls(x,'0px');
      x.fillStyle=t.accentDim;x.font='11px '+F_MONO;x.fillText('识别不出?微信搜「Zion降噪」· 仅供娱乐',W/2,H-34);}
    else{x.fillStyle=t.accent;x.font='13px '+F_MONO;_ls(x,'.3px');x.fillText('微信搜「Zion降噪」测你的',W/2,H-60);_ls(x,'0px');
      x.fillStyle=t.accentDim;x.font='11px '+F_MONO;x.fillText('仅供娱乐 · 每天一条降噪信号',W/2,H-36);}
    return c;
  }

  /* ── 结果状态 & 分享即解锁 ── */
  let _last=null;

  /* ── 锁区"保留词形的乱码"(替代整片高斯模糊)──
     把锁区里的汉字/字母/数字逐字换成同类随机字符,标点、空格、换行、字数一律不动 →
     行数/长度/段落形状与真文案完全一致,用户一眼看出"下面压着一大段具体内容",但读不出内容。
     原文存在 _lockSnap(内存,不写 DOM),解锁时按节点逐个写回,100% 还原。 */
  const SCRAM_CJK='的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞';
  let _lockSnap=null;               // [[textNode, 原文], …];null=没有做过乱码
  function _scrChar(ch,rnd){
    if(/[㐀-鿿]/.test(ch))           return SCRAM_CJK[Math.floor(rnd()*SCRAM_CJK.length)];
    if(/[a-z]/.test(ch))                    return 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd()*26)];
    if(/[A-Z]/.test(ch))                    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(rnd()*26)];
    if(/[0-9]/.test(ch))                    return String(Math.floor(rnd()*10));
    return ch;                               // 标点/空格/换行/emoji 一律保留 → 段落形状不变
  }
  function _walkText(root,fn){
    try{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);let n;while((n=w.nextNode()))fn(n);}
    catch(e){}                               // 极端环境退化:不做乱码(仍有 CSS 兜底遮罩)
  }
  function scrambleLock(z){
    if(!z||_lockSnap)return;
    const rnd=Math.random, snap=[];
    _walkText(z,n=>{
      const s=n.nodeValue; if(!s||!/\S/.test(s))return;
      snap.push([n,s]);
      let o=''; for(const ch of s)o+=_scrChar(ch,rnd);
      n.nodeValue=o;
    });
    _lockSnap=snap;
  }
  function unscrambleLock(){
    if(!_lockSnap)return;
    _lockSnap.forEach(p=>{try{p[0].nodeValue=p[1];}catch(e){}});   // 逐节点写回真文本,100% 还原
    _lockSnap=null;
  }
  function applyLock(){
    const u=localStorage.getItem('ce_unlocked_'+(_last&&_last.toolId))==='1';
    const z=document.getElementById('ce-lockZone'),ct=document.getElementById('ce-lockCta');
    if(z){z.classList.toggle('ce-blur',!u);if(u)unscrambleLock();else scrambleLock(z);}
    if(ct)ct.style.display=u?'none':'block';
  }
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
    const both=await Promise.all([loadWxQR(),loadPlanetQR()]);       // 公众号码 + 星球码(工具码在 drawCard 里现算,不用等网络)
    const qr=both[0];_shareQR=qr;_sharePlanet=both[1];
    const canvas=drawCard(_last.card,qr,{planet:_sharePlanet}),dataUrl=canvas.toDataURL('image/png');
    localStorage.setItem('ce_unlocked_'+_last.toolId,'1');applyLock();
    const txt=_last.shareText||('我测了「'+_last.toolName+'」,微信搜「Zion降噪」测你的');
    try{const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(blob&&navigator.canShare){const f=new File([blob],'card.png',{type:'image/png'});if(navigator.canShare({files:[f]})){await navigator.share({files:[f],text:txt});return;}}}catch(e){}
    _shareCache={phone:dataUrl};                                // 3:4 版按需再画,不白花时间
    showShare('phone');
  }

  /* ── 分享浮层里的比例切换(手机竖版 / 小红书 3:4)── */
  let _shareQR=null,_sharePlanet=null,_shareCache={},_shareRatio='phone';
  function showShare(ratio){
    if(!_last)return;
    const ov=document.getElementById('ce-shareov'),im=document.getElementById('ce-shareimg');
    if(!ov||!im)return;
    _shareRatio=ratio==='34'?'34':'phone';
    let url=_shareCache[_shareRatio];
    if(!url){try{url=drawCard(_last.card,_shareQR,{ratio:_shareRatio==='34'?'3:4':'phone',planet:_sharePlanet}).toDataURL('image/png');_shareCache[_shareRatio]=url;}catch(e){return;}}
    im.src=url;im.classList.toggle('r34',_shareRatio==='34');
    ov.classList.add('on');
    const wx=/MicroMessenger/i.test(navigator.userAgent);
    const tip=document.getElementById('ce-svtip');
    if(tip)tip.textContent=_shareRatio==='34'
      ? (wx?'1080×1440 · 长按保存,发小红书 📕':'1080×1440 小红书尺寸 · 点下方下载')
      : (wx?'长按图片保存,发朋友圈 📲(朋友长按图就能识别码)':'长按图片保存,或点下方下载');
    const rw=document.getElementById('ce-ratio');
    if(rw)rw.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.r===_shareRatio));
    const dl=document.getElementById('ce-svdl');
    if(dl){dl.style.display=wx?'none':'';dl.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=_shareRatio==='34'?'card-1080x1440.png':'card.png';a.click();};}
  }

  /* ── 分享浮层(引擎自动注入,工具页无需重复)── */
  function ensureOverlay(){
    if(document.getElementById('ce-shareov'))return;
    const ov=document.createElement('div');ov.className='ce-shareov';ov.id='ce-shareov';
    ov.innerHTML='<img id="ce-shareimg" alt="分享卡">'
      +'<div class="ce-ratio" id="ce-ratio"><button type="button" class="on" data-r="phone">📱 手机竖版</button><button type="button" data-r="34">📕 小红书 3:4</button></div>'
      +'<div class="svtip" id="ce-svtip">长按图片保存,发朋友圈 📲</div>'
      +'<div class="svbtns"><button class="ce-btn g" id="ce-svdl">下载图片</button><button class="ce-btn" id="ce-svclose">关闭</button></div>';
    document.body.appendChild(ov);
    document.getElementById('ce-svclose').onclick=()=>ov.classList.remove('on');
    document.getElementById('ce-ratio').querySelectorAll('button').forEach(b=>{b.onclick=()=>showShare(b.dataset.r);});
    ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('on');});
  }

  /* ── 纯文本战报(粘到微信群最省事的形态)──
     链接走镜像 WX_HOST:主站域名在微信里点不开,镜像点得开 —— 这是文本战报比截图强的地方。
     数据全从 card model 里取 → 所有工具白嫖,工具页零改动。 */
  function _bar(v){let n=Math.floor(v/10);if(v>0&&n<1)n=1;n=Math.max(0,Math.min(10,n));return '█'.repeat(n)+'░'.repeat(10-n);}
  function buildReportText(){
    if(!_last)return '';
    const m=_last.card||{},L=[];
    L.push(String(m.kicker||('🧪 '+(_last.toolName||'测测'))).trim());
    if(m.title)L.push(String(m.title));
    if(m.sub)L.push(String(m.sub));
    if(m.big!=null){
      const lb=String(m.bigLabel||'').trim();
      L.push(/%$/.test(lb)?(lb.replace(/\s*%$/,'')+' '+m.big+'%'):((lb?lb+' ':'')+m.big));
    }
    if(Array.isArray(m.cards)&&m.cards.length)
      L.push(m.cards.map(c=>(c&&c.pos?c.pos+':':'')+((c&&c.name)||'')+(c&&c.rev?'(逆)':'')).join(' / '));
    if(m.colorcard&&m.colorcard.main)
      L.push('本命主色 '+(m.colorcard.main.name||'')+' '+String(m.colorcard.main.hex||'').toUpperCase());
    (m.dims||[]).forEach(d=>{
      const raw=String(d[1]),v=parseFloat(raw.replace(/[^\d.\-]/g,''));
      L.push(/^\s*[\d.]+\s*%?\s*$/.test(raw)&&isFinite(v)&&v<=100&&v>=0 ? String(d[0])+' '+_bar(v)+' '+raw : String(d[0])+' '+raw);
    });
    if(m.hook)L.push('「'+String(m.hook).replace(/\s+/g,' ').trim()+'」');
    L.push('——————————');
    L.push('👉 测你的:'+wxUrl(_last.toolId));                       // 镜像地址,微信里可点可进
    L.push('全部 '+TOOLS.length+' 个测试:'+WX_HOST+'/ce/');
    return L.filter(s=>s&&String(s).trim()).join('\n');
  }
  function toast(msg){
    let el=document.getElementById('ce-toast');
    if(!el){el=document.createElement('div');el.id='ce-toast';el.className='ce-toast';document.body.appendChild(el);}
    el.textContent=msg;el.classList.remove('on');void el.offsetWidth;el.classList.add('on');
    clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('on'),2000);
  }
  async function copyReport(){
    const txt=buildReportText();
    if(!txt){toast('还没有结果可复制');return false;}
    let ok=false;
    try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(txt);ok=true;}}catch(e){}
    if(!ok){                                        // 降级:老浏览器 / 非安全上下文 / 微信内核
      try{
        const ta=document.createElement('textarea');ta.value=txt;
        ta.setAttribute('readonly','');ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,txt.length);
        ok=document.execCommand('copy');document.body.removeChild(ta);
      }catch(e){ok=false;}
    }
    toast(ok?'✅ 战报已复制 · 直接粘到微信群':'复制失败,长按下方文字手动复制');
    if(!ok){const p=document.getElementById('ce-copyfall');if(p){p.textContent=txt;p.style.display='block';}}
    return ok;
  }

  /* ── 渲染报告(标签/分数/四维/分段 + 锁区)── */
  function render(cfg, result){
    ensureOverlay();
    _lockSnap=null;_shareCache={};                                    // 换一次结果 → 旧原文快照/旧分享图一律作废
    _last={toolId:cfg.id,toolName:cfg.名字||cfg.name,card:result.card,shareText:result.shareText};
    if(result.card&&cfg&&cfg.id!=null&&result.card.themeId==null)result.card.themeId=cfg.id; // 按工具 id 选主题(工具页零改动;未列入 THEMES 者自动回落金黑)
    if(result.card&&cfg&&cfg.id!=null&&result.card.toolId==null)result.card.toolId=cfg.id;    // 分享卡上的"工具码"要知道自己是哪个工具(→ 镜像地址)
    if(result.card&&result.card.tier==null&&result.tier!=null)result.card.tier=result.tier;  // 工具若给了分档 → 卡片走"档位变体"配色;没给则视觉不变
    const box=document.getElementById('ce-report');
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // 四维/大数字一律走 esc:现在传的都是常量或数字,但下一个工具往里塞用户输入时就是 XSS,这里先堵死
    const dimsHtml=(result.dims||[]).map(d=>`<div class="ce-dim"><span class="n">${esc(d[1])}</span>${esc(d[0])}</div>`).join('');
    const nl=s=>esc(s).replace(/\n/g,'<br>');
    const sec=x=>`<div class="ce-sec"><h4>${esc(x.h)}</h4><p>${nl(x.p)}</p></div>`;
    const parts=result.parts||[];const first=parts[0],rest=parts.slice(1);
    box.innerHTML=`<div class="ce-rt">${cfg.图标||''} ${esc(result.heading||cfg.名字||'')}</div>
      <div class="ce-tag">${esc(result.tag||'')}</div>${result.sub?`<div class="ce-sub">${esc(result.sub)}</div>`:''}
      ${result.big!=null?`<div class="ce-score"><div class="big">${esc(result.bigLabel||'')} <b>${esc(result.big)}</b></div><div class="ce-dims">${dimsHtml}</div></div>`:''}
      <div id="ce-body">${first?sec(first):''}
        ${rest.length?`<div class="ce-lockcta" id="ce-lockCta">🔒 下面还有你的<b>完整深度版</b>(藏了后半段)<div style="margin:6px 0 12px;color:#c7c2b8;font-size:12.5px">分享给一个朋友,立刻解锁全部 👇</div><button class="ce-btn g" id="ce-lockShare">📤 分享一下 · 解锁完整版</button><div style="color:#8a8378;font-size:11px;margin-top:8px">分享/保存后自动解锁,只需一次 · 也可微信搜「Zion降噪」</div></div>
        <div class="ce-lockZone ce-blur" id="ce-lockZone">${rest.map(sec).join('')}</div>`:''}
      </div>
      <div class="ce-cta"><div class="ct">🔓 解锁更深 · 每天一条「降噪信号」帮你少焦虑</div>
        <div class="ce-qrs">
          <div class="ce-qr"><img src="/wechat-qr.png" alt="公众号 Zion降噪"><b>长按识别 · 关注公众号</b><span>「Zion降噪」· 手指按住上面这张码 → 识别 → 关注</span></div>
          <div class="ce-qr"><img src="/planet-qr.png" alt="知识星球" loading="lazy"><b>长按识别 · 进知识星球</b><span>同上,长按这张码 → 和同频的人搞事、拿工具</span></div>
        </div>
        <a class="ce-btn g" href="/join/" style="display:inline-block;margin:6px 0 4px;text-decoration:none">加入「降噪·静音舱」→</a>
        <div class="cb">微信里打不开链接?复制到浏览器:<b>${JOIN_URL}</b></div></div>
      <div class="ce-row"><button class="ce-btn g" id="ce-share">📤 甩给最该看的人</button><button class="ce-btn" id="ce-copy">📋 复制文字战报</button><button class="ce-btn" id="ce-again">再测一次</button></div>
      <div class="ce-copyfall" id="ce-copyfall"></div>
      <div class="ce-retention">🌙 明天再来测,运势/心情每天都在变 · 把结果甩给最该看的那个人,反应最真实 👀</div>
      ${buildMore(cfg.id)}
      <div class="ce-wm">qizh.space · 微信搜「Zion降噪」· 仅供娱乐</div>`;
    document.getElementById('ce-share').onclick=shareCard;
    const cp=document.getElementById('ce-copy');if(cp)cp.onclick=copyReport;
    const ls=document.getElementById('ce-lockShare');if(ls)ls.onclick=shareCard;
    document.getElementById('ce-again').onclick=()=>{document.getElementById('ce-report').style.display='none';document.getElementById('ce-stage').style.display='block';window.scrollTo({top:0,behavior:'smooth'});};
    applyLock();
    document.getElementById('ce-stage').style.display='none';
    box.style.display='block';box.scrollIntoView({behavior:'smooth',block:'start'});
  }

  return { rngFrom, pick, wpick, imgHash, buildParts, llm, render, drawCard,
           TOOLS, JOIN_URL, buildMore,
           buildReportText, copyReport, toast, showShare, themeFor,
           WX_HOST, wxUrl, qrEncode, drawQRCode,
           util:{xmur3,mulberry32,tierVal:_tierVal} };
})();
