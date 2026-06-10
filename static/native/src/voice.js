/**
 * Voice Panel — 按住 Space 講嘢，放手出字
 * 神經節點網提供視覺回饋
 */

function lerp(a,b,t){return a+(b-a)*t}
function createNodes(n,cx,cy,R){
  const nodes=[];
  for(let i=0;i<n;i++){
    const a=(i/n)*Math.PI*2,r=R*(0.3+Math.random()*0.7);
    nodes.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,bx:cx+Math.cos(a)*r,by:cy+Math.sin(a)*r,r:1.5+Math.random()*2.5,vx:0,vy:0,p:Math.random()*9});
  }
  return nodes;
}

export function initVoicePanel({canvasId,voiceBtnId,getMsgInput}={}){
  const canvas=document.getElementById(canvasId||'voice-canvas');
  const btn=document.getElementById(voiceBtnId||'voice-btn');
  if(!canvas) return null;

  const ctx=canvas.getContext('2d');
  canvas.width=200;canvas.height=200;
  const W=200,H=200,cx=100,cy=100,R=75;
  const nodes=createNodes(24,cx,cy,R),N=nodes.length;

  // 連線
  const links=[];
  for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
    const d=Math.hypot(nodes[i].bx-nodes[j].bx,nodes[i].by-nodes[j].by);
    if(d<R*0.75)links.push({i,j});
  }

  let state='idle',prev='idle',trans=0,tick=0,anim=null;
  let audioCtx=null,mic=null,proc=null;
  let ws=null,recording=false,lastText='';
  let onText=null;

  // ── WebSocket ──
  function wsConnect(){
    if(ws&&ws.readyState===WebSocket.OPEN) return;
    ws=new WebSocket('ws://127.0.0.1:8792');
    ws.binaryType='arraybuffer';
    ws.onmessage=(e)=>{
      try{
        const m=JSON.parse(e.data);
        if(m.type==='final'&&m.text){
          const txt=m.text.trim();
          if(txt){
            const inp=getMsgInput?.();
            if(inp){
              // ★ 喺光標位置插入文字，唔係永遠加喺最後
              const pos=inp.selectionStart??inp.value.length;
              const before=inp.value.slice(0,pos);
              const after=inp.value.slice(pos);
              const sep=before&&!before.endsWith(' ')?' ':'';
              inp.value=before+sep+txt+after;
              // 光標移到新插入文字之後
              const newPos=before.length+sep.length+txt.length;
              inp.setSelectionRange(newPos,newPos);
              inp.focus();
            }
            onText?.(txt,true);
          }
        }
      }catch(_){}
    };
    ws.onclose=()=>{ws=null};
  }

  function wsSend(audio){
    if(!ws||ws.readyState!==WebSocket.OPEN||!recording) return;
    try{const i16=new Int16Array(audio.length);for(let i=0;i<audio.length;i++)i16[i]=Math.round(Math.max(-1,Math.min(1,audio[i]))*32767);ws.send(i16.buffer)}catch(_){}
  }

  // ── 麥克風 ──
  async function micOn(){
    if(mic) return true;
    try{
      mic=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:false,noiseSuppression:true,autoGainControl:false},video:false});
      audioCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
      const src=audioCtx.createMediaStreamSource(mic);
      const g=audioCtx.createGain();g.gain.value=0;
      proc=audioCtx.createScriptProcessor(4096,1,1);
      proc.onaudioprocess=(e)=>{if(recording)wsSend(e.inputBuffer.getChannelData(0))};
      src.connect(proc);proc.connect(g);g.connect(audioCtx.destination);
      wsConnect();
      return true;
    }catch(e){console.warn('[voice]',e.message);return false}
  }

  function micOff(){
    if(proc){proc.disconnect();proc=null}
    if(mic){mic.getTracks().forEach(t=>t.stop());mic=null}
    if(audioCtx){audioCtx.close().catch(()=>{});audioCtx=null}
    if(ws){ws.close();ws=null}
  }

  // ── 錄音控制 ──
  async function start(){recording=true;lastText='';setState('recording')}
  function stop(){
    recording=false;setState(mic?'listening':'idle');
    if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({action:'finalize'}));
  }

  function setState(s){if(state===s)return;console.log('[voice]',state,'→',s);prev=state;state=s;trans=0}

  // ── Push-to-Talk ──
  let spaceDown=false;
  const msgInput = getMsgInput?.();

  function onKeyDown(e){
    if(e.code!=='Space'||e.repeat) return;
    if(document.activeElement!==msgInput) return;
    e.preventDefault();spaceDown=true;
    if(msgInput) msgInput.placeholder='🎤 正在聆聽…';
    if(!mic){micOn().then(ok=>{if(!ok)spaceDown=false;else if(spaceDown&&!recording)start()})}
    else if(!recording) start();
  }
  function onKeyUp(e){
    if(e.code!=='Space'||!spaceDown) return;
    e.preventDefault();spaceDown=false;stop();
    if(msgInput) msgInput.placeholder='向 Hermes 發消息…';
  }
  // ★ 只監聽輸入框，唔影響 paste/Ctrl+C 等全域快捷鍵
  if(msgInput){
    msgInput.addEventListener('keydown',onKeyDown);
    msgInput.addEventListener('keyup',onKeyUp);
  }

  // ── 點擊球 ──
  async function click(){if(!mic)await micOn();setState(mic?'listening':'idle')}
  if(btn) btn.addEventListener('click',click);
  canvas.addEventListener('click',click);

  // ── 繪製 ──
  const CFG={
  //        alpha  speed  linkα  hue    glow
  idle:      {a:0.18, s:0.2,  la:0.05, h:210, g:0.15},
  listening: {a:0.4,  s:0.6,  la:0.15, h:200, g:0.25},
  recording: {a:0.9,  s:3.5,  la:0.5,  h:0,   g:0.5},
  thinking:  {a:0.7,  s:2.8,  la:0.4,  h:35,  g:0.45},
  speaking:  {a:0.8,  s:1.2,  la:0.35, h:275, g:0.4},
};
  // ★ 淺色主題 (Arctic/Sand) 用草綠色系 + 降低光暈
  const LIGHT_CFG={
  idle:      {a:0.15, s:0.2,  la:0.04, h:140, g:0.10},
  listening: {a:0.35, s:0.5,  la:0.12, h:135, g:0.18},
  recording: {a:0.85, s:3.0,  la:0.45, h:0,   g:0.45},
  thinking:  {a:0.6,  s:2.5,  la:0.35, h:115, g:0.30},
  speaking:  {a:0.7,  s:1.0,  la:0.28, h:145, g:0.28},
};
  function getCFG(){
    try{const t=document.body?.dataset?.theme||localStorage.getItem('hermes-ui-theme')||'';return(t==='arctic'||t==='sand')?LIGHT_CFG:CFG}catch(e){return CFG}
  }
  // ★ 軌道符號（thinking 時圍住球轉）
  const orbitSymbols=['?','?','?','💡','🔍','⚙'];

  function draw(){
    tick+=0.016;trans=Math.min(1,trans+0.04);
    const cfg=getCFG(),c=cfg[state]||cfg.idle,p=cfg[prev]||cfg.idle,lf=trans;
    const speed=lerp(p.s,c.s,lf),alpha=lerp(p.a,c.a,lf);
    const linkAlpha=lerp(p.la,c.la,lf),hue=lerp(p.h,c.h,lf),glow=lerp(p.g,c.g,lf);

    // ★ 節點旋轉：thinking 時成個球快速轉
    const rotation=(state==='thinking')?tick*3:(state==='speaking')?tick*0.8:tick*0.15;
    nodes.forEach(n=>{
      const a=Math.atan2(n.by-cy,n.bx-cx)+rotation*0.01;
      const d=Math.hypot(n.bx-cx,n.by-cy);
      const drift=speed>2?14:speed>1?7:2.5;
      n.x=cx+Math.cos(a)*d+Math.cos(tick*0.5+n.p)*drift;
      n.y=cy+Math.sin(a)*d+Math.sin(tick*0.7+n.p)*drift;
      n.x+=n.vx;n.y+=n.vy;
      const dx=n.x-cx,dy=n.y-cy,dist=Math.hypot(dx,dy);
      if(dist>R){n.x=cx+(dx/dist)*R;n.y=cy+(dy/dist)*R;n.vx*=-0.5;n.vy*=-0.5}
    });

    ctx.clearRect(0,0,W,H);

    // ★ 背景光暈
    const gg=ctx.createRadialGradient(cx,cy,R*0.1,cx,cy,R*1.4);
    gg.addColorStop(0,`hsla(${hue},70%,60%,${glow.toFixed(2)})`);
    gg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gg;ctx.fillRect(0,0,W,H);

    // 連線
    links.forEach(l=>{
      const ni=nodes[l.i],nj=nodes[l.j],d=Math.hypot(ni.x-nj.x,ni.y-nj.y),act=d<R*0.3;
      ctx.strokeStyle=`hsla(${hue},60%,70%,${(act?Math.min(1,linkAlpha*3):linkAlpha).toFixed(3)})`;
      ctx.lineWidth=act?2.5:0.5;
      ctx.beginPath();ctx.moveTo(ni.x,ni.y);ctx.lineTo(nj.x,nj.y);ctx.stroke();
    });

    // 節點
    nodes.forEach(n=>{
      const hr=n.r*(2.5+speed*0.8);
      const hg=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,hr);
      hg.addColorStop(0,`hsla(${hue},60%,75%,${(alpha*0.6).toFixed(3)})`);
      hg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=hg;ctx.beginPath();ctx.arc(n.x,n.y,hr,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=`hsla(${hue},70%,88%,${alpha.toFixed(2)})`;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=`rgba(255,255,255,${(alpha*0.6).toFixed(2)})`;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r*0.35,0,Math.PI*2);ctx.fill();
    });

    // ★★★ THINKING：軌道符號圍住球轉 ★★★
    if(state==='thinking'){
      ctx.font='14px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      for(let i=0;i<5;i++){
        const angle=(tick*1.5+i*1.256)%(Math.PI*2);
        const sx=cx+Math.cos(angle)*(R+16);
        const sy=cy+Math.sin(angle)*(R+16);
        ctx.fillStyle=`hsla(35,90%,65%,${(0.7+Math.sin(tick*3+i)*0.3).toFixed(2)})`;
        ctx.fillText(orbitSymbols[i],sx,sy);
      }
    }

    // ★★★ SPEAKING：外圈脈衝波紋 ★★★
    if(state==='speaking'){
      for(let i=0;i<3;i++){
        const phase=(tick*2.5+i*2.1)%5;
        if(phase>4.5)continue;
        const a=Math.max(0,1-phase/4.5);
        ctx.strokeStyle=`hsla(280,60%,65%,${(a*0.45).toFixed(2)})`;
        ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(cx,cy,R+10+phase*10,0,Math.PI*2);ctx.stroke();
      }
    }

    // ★★★ RECORDING：紅圈 + REC ★★★
    if(state==='recording'){
      ctx.strokeStyle=`hsla(0,85%,60%,${(0.6+Math.sin(tick*6)*0.4).toFixed(2)})`;
      ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R+8,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=`hsla(0,85%,60%,0.9)`;ctx.font='bold 11px Inter';ctx.textAlign='center';
      ctx.fillText('🎤 REC',cx,cy+R+22);
    }

    // ★ 效能：idle 時降幀到 20fps，活躍時 60fps
    const fps = (state==='idle') ? 50 : 16;
    setTimeout(()=>{anim=requestAnimationFrame(draw)}, fps);
  }
  draw();

  return{
    setState,isRecording:()=>recording,stopRecording:stop,startRecording:start,
    onTranscript:(cb)=>{onText=cb},
    destroy(){micOff();if(anim)cancelAnimationFrame(anim);document.removeEventListener('keydown',onKeyDown,{capture:true});document.removeEventListener('keyup',onKeyUp,{capture:true})},
  };
}
