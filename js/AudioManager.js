/** 离线拟音资源清单；打包器将相同键名写入 window.MIDWAY_AUDIO。 */
export const AUDIO_ASSETS=Object.freeze(Object.fromEntries(['engine','wind','gun','cannon','flak','explosion','hit','whiz','splash'].map(key=>[key,`assets/audio/${key}.wav`])));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/** Cockpit warning tones generated once locally, with click-free pulse edges. */
export function warningSamples(level,sampleRate){
  const urgent=level>=2,duration=urgent?.76:.48,data=new Float32Array(Math.ceil(duration*sampleRate));
  const starts=urgent?[0,.17,.34,.51]:[0,.23],pulse=urgent?.13:.15;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate;
    for(let n=0;n<starts.length;n++){
      const age=t-starts[n];if(age<0||age>=pulse)continue;
      const envelope=Math.min(1,age/.012,(pulse-age)/.025);
      const base=urgent?(n%2?1175:880):660;
      data[i]=envelope*(Math.sin(2*Math.PI*base*age)*.52+Math.sin(2*Math.PI*base*1.25*age)*.16);
    }
  }
  return data;
}
const EVENTS={
  gun:{sample:'gun',gain:.58,gap:.06,local:true},enemyGun:{sample:'gun',gain:.48,gap:.07},
  aa:{sample:'cannon',gain:.8,gap:.065},flak:{sample:'flak',gain:.85,gap:.055},
  explosion:{sample:'explosion',gain:1,gap:.045},hit:{sample:'hit',gain:.6,gap:.07,local:true},
  confirm:{sample:'hit',gain:.10,gap:.1,local:true,pitch:1.8},bomb:{sample:'hit',gain:.22,gap:.1,local:true,pitch:.5},
  boost:{sample:'whiz',gain:.15,gap:.2,local:true,pitch:.65},supply:{sample:'hit',gain:.14,gap:.2,local:true,pitch:1.3},
  whiz:{sample:'whiz',gain:.55,gap:.1},splash:{sample:'splash',gain:.6,gap:.1}
};

/** 原生 Web Audio：发动机/风噪分层、空间衰减、传播延迟与有上限的复音池。 */
export class AudioManager {
  constructor(){
    this._enabled=true;this.paused=false;this.context=null;this.last={};this.buffers=new Map();
    this.voices=new Set();this.loops=new Map();this.loads=null;this.loadErrors=[];this.loaded=0;
    this.seed=19420604;this.listener={x:0,y:0,z:0};this.right={x:1,y:0,z:0};this.playing=false;
    this.warningBuffers=new Map();this.warningVoice=null;this.warningLevel=0;this.warningNextAt=0;
    this.unlockError='';this.unlockAttempts=0;this.primer=null;this.previewVoice=null;this.previewSerial=0;this.sessionOwned=false;
    this.metrics={played:0,dropped:0,peakVoices:0,engineRate:0,windGain:0,lastPan:0,lastDistance:0};
  }
  get enabled(){return this._enabled;}
  set enabled(value){this._enabled=Boolean(value);if(!this._enabled){this.stopAll();this.setPlaybackSession(false);}this.syncMaster();}
  get needsUnlock(){return !this.context||this.context.state!=='running';}
  get buttonLabel(){return !this.enabled?'音效 关':this.needsUnlock?(this.context?'恢复声音':'开启声音'):'音效 开';}
  get sessionType(){try{return globalThis.navigator?.audioSession?.type||'unsupported';}catch{return 'unavailable';}}
  get statusText(){
    if(!this.enabled)return '游戏声音已关闭，点击“播放测试音”可开启。';
    if(!(window.AudioContext||window.webkitAudioContext))return '当前浏览器不支持游戏音效，请换用 Safari 或 Chrome 打开。';
    if(this.needsUnlock)return this.unlockError?'浏览器尚未允许播放，请点“播放测试音”重试。':'点击“播放测试音”开启或恢复声音。';
    return '声音播放已启动。若听不到，请检查媒体音量、静音模式和蓝牙输出。';
  }
  setPlaybackSession(active){
    try{
      const session=globalThis.navigator?.audioSession;if(!session)return;
      if(active&&!this.sessionOwned){this.previousSessionType=session.type;session.type='playback';this.sessionOwned=true;}
      else if(!active&&this.sessionOwned){if(session.type==='playback')session.type=this.previousSessionType||'auto';this.sessionOwned=false;}
    }catch{/* Older WebViews may expose a read-only session; Web Audio still works. */}
  }
  get diagnostics(){
    let rms=0,peak=0;if(this.analyser){this.analyser.getFloatTimeDomainData(this.meter);for(const value of this.meter){rms+=value*value;peak=Math.max(peak,Math.abs(value));}rms=Math.sqrt(rms/this.meter.length);}
    return {...this.metrics,unlockAttempts:this.unlockAttempts,unlockError:this.unlockError,session:this.sessionType,previewActive:!!this.previewVoice&&!this.previewVoice.ended,warningLevel:this.warningLevel,warningActive:!!this.warningVoice&&!this.warningVoice.ended,enabled:this.enabled,paused:this.paused,context:this.context?.state||'locked',voices:this.voices.size,loops:this.loops.size,loopCount:this.loops.size,loaded:this.loaded,failed:this.loadErrors.length,expected:Object.keys(AUDIO_ASSETS).length,masterGain:this.master?.gain.value??0,rms,peak,loadErrors:[...this.loadErrors],source:'procedural offline WAV + local warning tones'};
  }
  unlock({waitForAssets=true}={}){
    if(!this.enabled)return Promise.resolve(false);
    this.unlockAttempts++;
    this.setPlaybackSession(true);
    try{
    if(!this.context||this.context.state==='closed'){
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context){this.unlockError='Web Audio unavailable';this.setPlaybackSession(false);return Promise.resolve(false);}
      this.stopAll();this.buffers.clear();this.warningBuffers.clear();this.loaded=0;this.loadErrors=[];
      this.context=new Context();this.primed=false;const ctx=this.context;
      ctx.onstatechange=()=>{
        if(this.context!==ctx)return;
        if(ctx.state==='running')this.unlockError='';
        else if(ctx.state==='interrupted'||ctx.state==='closed'){this.stopAll();this.setPlaybackSession(false);}
      };
      this.master=ctx.createGain();this.master.gain.value=.8;
      this.compressor=ctx.createDynamicsCompressor();this.compressor.threshold.value=-18;this.compressor.knee.value=18;
      this.compressor.ratio.value=4;this.compressor.attack.value=.003;this.compressor.release.value=.2;
      this.compressor.connect(this.master).connect(ctx.destination);
      // 调试页可检查实际混音波形，正常游戏不分配分析器。
      if(new URLSearchParams(window.location.search).has('debug')){this.analyser=ctx.createAnalyser();this.analyser.fftSize=1024;this.meter=new Float32Array(1024);this.master.connect(this.analyser);}
      for(const key of Object.keys(AUDIO_ASSETS))this.buffers.set(key,this.fallback(key));
      for(const level of [1,2]){const samples=warningSamples(level,ctx.sampleRate),buffer=ctx.createBuffer(1,samples.length,ctx.sampleRate);buffer.getChannelData(0).set(samples);this.warningBuffers.set(level,buffer);}
      this.loads=Promise.all(Object.entries(AUDIO_ASSETS).map(async([key,path])=>{
        try{
          const embedded=window.MIDWAY_AUDIO?.[key];let bytes;
          if(embedded){const binary=atob(embedded.includes(',')?embedded.split(',')[1]:embedded);bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)).buffer;}
          else{if(location.protocol==='file:')throw new Error('离线音频未嵌入');const response=await fetch(path);if(!response.ok)throw new Error(`HTTP ${response.status}`);bytes=await response.arrayBuffer();}
          const buffer=await ctx.decodeAudioData(bytes);if(ctx!==this.context)return;
          this.buffers.set(key,buffer);this.loaded++;
        }catch(error){if(ctx===this.context)this.loadErrors.push(`${key}: ${error.message}`);}
      }));
    }
    this.syncMaster();
    const ctx=this.context,needsResume=ctx.state!=='running';
    // Both resume and a silent one-frame source start inside the real gesture.
    // Safari also reports "interrupted" after calls, app switches or route changes.
    const resumed=needsResume?ctx.resume():Promise.resolve();
    const ready=Promise.resolve(resumed).then(()=>{if(ctx===this.context&&ctx.state==='running')this.unlockError='';return ctx===this.context&&ctx.state==='running';},error=>{if(ctx===this.context)this.unlockError=error?.message||String(error);return false;});
    if(needsResume||!this.primed){
      this.release(this.primer,true);
      const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,ctx.sampleRate);source.connect(ctx.destination);
      const voice={source,nodes:[source],ended:false};this.primer=voice;source.onended=()=>this.release(voice);source.start(0);this.primed=true;
    }
    return waitForAssets?Promise.all([ready,this.loads]).then(([running])=>running):ready;
    }catch(error){this.unlockError=error?.message||String(error);this.setPlaybackSession(false);return Promise.resolve(false);}
  }
  toggleFromGesture(){
    if(this.enabled&&this.needsUnlock){this.unlock();return true;}
    this.enabled=!this.enabled;if(this.enabled)this.unlock();return this.enabled;
  }
  bindGestureUnlock(root,isActive=()=>true){
    if(this.gestureCleanup)return this.gestureCleanup;
    const gesture=event=>{
      if(event.isTrusted===false||!this.enabled||!isActive()||!this.needsUnlock)return;
      const target=event.target;
      if(!target?.closest?.('#hud, #scene')||target.closest('#sound-button, #audio-test'))return;
      this.unlock();
    };
    const hide=()=>{if(root.hidden){this.stopAll();this.setPlaybackSession(false);}};
    // Touch pointerdown is not an activation event on every mobile browser.
    const events=['pointerdown','pointerup','touchend','keydown'];
    for(const type of events)root.addEventListener(type,gesture,{capture:true,passive:true});
    root.addEventListener('visibilitychange',hide);
    this.gestureCleanup=()=>{for(const type of events)root.removeEventListener(type,gesture,true);root.removeEventListener('visibilitychange',hide);this.gestureCleanup=null;};
    return this.gestureCleanup;
  }
  stopPreview(){
    this.previewSerial++;const voice=this.previewVoice;this.previewVoice=null;this.release(voice,true);
    if(voice&&this.paused)this.setPlaybackSession(false);
  }
  testSound(){
    this.stopPreview();this.enabled=true;const ready=this.unlock({waitForAssets:false});
    const serial=this.previewSerial,ctx=this.context;
    return ready.then(running=>{
      if(!running||serial!==this.previewSerial||!this.enabled||globalThis.document?.hidden||ctx!==this.context)return false;
      if(this.voices.size+this.loops.size>=32)this.release(this.voices.values().next().value,true);
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=this.warningBuffers.get(1);gain.gain.value=.35;
      // A deliberate preview can play in the paused menu; mute/blur still stop it.
      source.connect(gain).connect(ctx.destination);
      const voice={source,gain,nodes:[source,gain],ended:false};this.previewVoice=voice;this.voices.add(voice);source.onended=()=>{this.release(voice);if(this.previewVoice===voice){this.previewVoice=null;if(this.paused)this.setPlaybackSession(false);}};source.start();
      this.metrics.previews=(this.metrics.previews||0)+1;return true;
    }).catch(error=>{this.unlockError=error?.message||String(error);return false;});
  }
  syncMaster(){if(this.master)this.master.gain.setTargetAtTime((this.enabled&&!this.paused)? .8:0,this.context.currentTime,.012);}
  setPaused(value){const changed=this.paused!==Boolean(value);this.paused=Boolean(value);if(changed){if(this.paused){this.stopAll();this.setPlaybackSession(false);}else if(this.enabled&&this.context)this.setPlaybackSession(true);}this.syncMaster();}
  reset(){this.stopAll();this.last={};this.seed=19420604;this.playing=false;this.metrics.engineRate=0;this.metrics.windGain=0;}
  stopAll(){
    this.stopPreview();this.release(this.primer,true);this.primer=null;
    this.stopWarning();
    for(const voice of [...this.voices])this.release(voice,true);
    this.stopLoops();
  }
  stopLoops(){for(const voice of this.loops.values())this.release(voice,true);this.loops.clear();}
  stopWarning(){this.release(this.warningVoice,true);this.warningVoice=null;this.warningLevel=0;this.warningNextAt=0;}
  updateWarning(level){
    level=clamp(Math.round(level||0),0,3);
    if(!level||!this.enabled||this.paused||!this.playing){this.stopWarning();return;}
    const ctx=this.context,now=ctx.currentTime;
    if(level!==this.warningLevel){this.stopWarning();this.warningLevel=level;}
    if(now<this.warningNextAt||this.warningVoice&&!this.warningVoice.ended)return;
    // A cockpit warning has priority over expendable distant combat voices.
    if(this.voices.size+this.loops.size>=32)this.release(this.voices.values().next().value,true);
    const source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=this.warningBuffers.get(level>=2?2:1);gain.gain.value=level>=2?.55:.38;
    source.connect(gain).connect(this.compressor);
    const voice={source,gain,nodes:[source,gain],ended:false};this.warningVoice=voice;this.voices.add(voice);source.onended=()=>this.release(voice);source.start();
    this.warningNextAt=now+(level===1?2:1);
    this.metrics.warningPlays=(this.metrics.warningPlays||0)+1;
    this.metrics.peakVoices=Math.max(this.metrics.peakVoices,this.voices.size+this.loops.size);
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  release(voice,stop=false){
    if(!voice||voice.ended)return;voice.ended=true;
    if(stop){try{voice.source.stop();}catch{}}
    for(const node of voice.nodes)node.disconnect();this.voices.delete(voice);
  }
  fallback(key){
    const ctx=this.context,loop=key==='engine'||key==='wind',duration=loop?2:.7;
    const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);let seed=1942,low=0;
    for(let i=0;i<data.length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed/2147483648-1,t=i/ctx.sampleRate;low=low*.86+n*.14;
      data[i]=key==='engine'?.25*Math.sin(t*2*Math.PI*70)+low*.4:key==='wind'?low*.55:(n*.55*Math.exp(-t*50)+low*.7*Math.exp(-t*8))*Math.min(1,t*1000);
    }
    return buffer;
  }
  startLoop(key){
    if(this.voices.size+this.loops.size>=32)this.release(this.voices.values().next().value,true);
    const ctx=this.context,source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    source.buffer=this.buffers.get(key);source.loop=true;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=key==='engine'?2700:3800;
    source.connect(filter).connect(gain).connect(this.compressor);
    const voice={source,gain,filter,nodes:[source,filter,gain],ended:false};source.onended=()=>this.release(voice);source.start();this.loops.set(key,voice);return voice;
  }
  update(dt,player,camera,state,warningLevel=0){
    const status=typeof state==='string'?state:state?.state;
    this.playing=status==='playing'&&Boolean(player)&&player.hp>0;
    // 胜负结算仅停引擎，保留最后一次爆炸的尾音；真正暂停才切断全部音源。
    const ending=status==='won'||status==='lost';
    this.setPaused(!this.playing&&!ending);
    if(ending){this.stopLoops();this.stopWarning();}
    if(!this.enabled||!this.context||this.context.state!=='running'||!this.playing)return;
    const pos=player.mesh?.position||player.position;if(pos)Object.assign(this.listener,{x:pos.x,y:pos.y,z:pos.z});
    const matrix=camera?.matrixWorld?.elements;if(matrix)Object.assign(this.right,{x:matrix[0],y:matrix[1],z:matrix[2]});
    const throttle=clamp(player.throttle??.55,0,1),speed=clamp(player.speed??88,0,200);
    const boost=player.boosting?1:clamp((speed-(57+throttle*55))/36,0,1),ctx=this.context;
    for(const [key,voice] of this.loops)if(voice.source.buffer!==this.buffers.get(key)){this.release(voice,true);this.loops.delete(key);}
    const engine=this.loops.get('engine')||this.startLoop('engine'),wind=this.loops.get('wind')||this.startLoop('wind');
    this.updateWarning(warningLevel);
    const duck=this.warningLevel>=2?.55:this.warningLevel===1?.78:1;
    const rate=.72+throttle*.4+boost*.14,windVolume=.025+Math.pow(speed/150,2)*.12;
    engine.source.playbackRate.setTargetAtTime(rate,ctx.currentTime,.2);engine.gain.gain.setTargetAtTime((.21+throttle*.11+boost*.04)*duck,ctx.currentTime,.16);
    engine.filter.frequency.setTargetAtTime(1400+throttle*1900+boost*650,ctx.currentTime,.2);
    wind.gain.gain.setTargetAtTime(windVolume*duck,ctx.currentTime,.22);wind.source.playbackRate.setTargetAtTime(.75+speed/220,ctx.currentTime,.22);
    this.metrics.engineRate=rate;this.metrics.windGain=windVolume;
  }
  play(type,position=null,options={}){
    if(!this.enabled||this.paused||!this.context||this.context.state!=='running')return;
    const cfg=EVENTS[type]||EVENTS.hit,ctx=this.context,now=ctx.currentTime;
    // 多个炮位分开限流；不带炮位的调用也保留每事件的全局预算。
    const key=type+':'+(options.id??'');if(now-(this.last[key]??-10)<cfg.gap)return;this.last[key]=now;
    if(this.voices.size+this.loops.size>=32){this.metrics.dropped++;return;}
    const local=options.local??cfg.local;
    let distance=0,pan=0;
    if(position&&!local){const dx=position.x-this.listener.x,dy=position.y-this.listener.y,dz=position.z-this.listener.z;distance=Math.hypot(dx,dy,dz);pan=clamp((dx*this.right.x+dy*this.right.y+dz*this.right.z)/Math.max(1,distance),-1,1);}
    if(distance>3500){this.metrics.dropped++;return;}
    const attenuation=1/(1+distance/220),source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter(),panner=ctx.createStereoPanner();
    source.buffer=this.buffers.get(cfg.sample);source.playbackRate.value=(cfg.pitch||1)*(options.pitch||(options.heavy?.78:1))*(.96+this.random()*.08);
    filter.type='lowpass';filter.frequency.value=Math.max(750,16000/(1+distance/120));panner.pan.value=pan;
    gain.gain.value=cfg.gain*attenuation*clamp(options.gain??1,0,2);
    source.connect(filter).connect(panner).connect(gain).connect(this.compressor);
    const voice={source,gain,nodes:[source,filter,panner,gain],ended:false};this.voices.add(voice);source.onended=()=>this.release(voice);
    // 远处炮口先闪后响；玩家自身武器、命中反馈保持同步。
    const delay=local||type==='whiz'?0:Math.min(.9,distance/343);source.start(now+delay);
    this.metrics.played++;this.metrics.peakVoices=Math.max(this.metrics.peakVoices,this.voices.size+this.loops.size);this.metrics.lastPan=pan;this.metrics.lastDistance=distance;
  }
}
