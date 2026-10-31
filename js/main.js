import { SceneManager } from './SceneManager.js';
import { AssetLoader } from './AssetLoader.js';
import { ShipManager } from './ShipManager.js';
import { FlightManager } from './FlightManager.js';
import { ParticleManager } from './ParticleManager.js';
import { UIManager } from './UIManager.js';
import { CombatEffects } from './CombatEffects.js';
import { AudioManager } from './AudioManager.js';
import { CONFIG, PLAYER_AIRCRAFT } from './config.js';
import { runFlightTests } from './FlightTests.js';
import { installMobileBrowserGuards } from './MobileBrowser.js';

/** 固定步长模拟。界面只发出驾驶意图，飞行/武器/胜负状态由游戏管理。 */
export class Game {
  constructor(){
    this.state='loading';this.time=0;this.keys=new Set();this.input={x:0,y:0,fire:false,joystickActive:false,mouseSteerTime:0};this.cameraMode='flight';this.soundEnabled=true;
    this.sceneManager=new SceneManager(document.getElementById('scene'));
    this.particles=new ParticleManager(this.sceneManager.scene);this.effects=new CombatEffects(this.sceneManager.scene,this.particles);this.audio=new AudioManager();
    this.assets=new AssetLoader(message=>this.ui?.notify(message));this.shipManager={ships:[]};this.flight=null;
    this.ui=new UIManager(this);this.last=performance.now();this.accumulator=0;this.uiClock=0;this.fps=60;
    this.bindInput();this.ready=this.init();
  }
  async init(){
    try{
      window.MIDWAY_BOOT?.report(20,'正在加载飞机与舰船');
      await window.MIDWAY_BOOT?.paint();
      await this.assets.preload((done,total,download)=>window.MIDWAY_BOOT?.report(20+download*48+done/total*14,download<1?'正在下载飞机与舰船':`准备飞机与舰船 · ${done} / ${total}`));
      window.MIDWAY_BOOT?.report(85,'正在部署敌我编队');
      await window.MIDWAY_BOOT?.paint();
      this.shipManager=new ShipManager(this.sceneManager.scene,this.assets,this.particles,m=>this.ui.notify(m),(x,z,t)=>this.sceneManager.getWaveHeight(x,z,t));
      this.flight=new FlightManager(this);this.sceneManager.flight=this.flight;
      window.MIDWAY_BOOT?.report(92,'正在准备海面与首帧画面');
      await window.MIDWAY_BOOT?.paint();
      this.sceneManager.update(0,1,this.flight.player.mesh,this.shipManager.ships);
      this.sceneManager.renderer.render(this.sceneManager.scene,this.sceneManager.camera);
      window.MIDWAY_BOOT?.report(100,'准备完成 · 随时出击');
      this.state='ready';this.ui.update(0);
      if(new URLSearchParams(location.search).has('qa')&&new URLSearchParams(location.search).has('debug'))await runFlightTests(this);
      const capture=new URLSearchParams(location.search).get('capture');
      if(new URLSearchParams(location.search).has('debug')&&['dive-carrier','dive-destroyer','dive-caution','dive-warning'].includes(capture)){const {setupDiveCapture}=await import('./MobileDiveQA.js');setupDiveCapture(this,capture);}
      this.last=performance.now();requestAnimationFrame(now=>this.frame(now));
    }catch(error){this.state='error';window.MIDWAY_BOOT?.fail(error);}
  }
  clearInput(){this.flight?.aimAssist.clear();this.gyro?.setActive(false);this.gyro?.reset();this.ui?.clearTouch?.();this.keys.clear();this.debugBurstUntil=0;if(this.flight?.player){this.flight.player.turnInput=0;this.flight.player.pitchInput=0;}Object.assign(this.input,{x:0,y:0,fire:false,joystickActive:false,mouseSteerTime:0});}
  start(){if(this.state!=='ready')return;this.audio.unlock();this.clearInput();this.state='playing';this.ui.notify('拦截机迎面来袭 · 按住开火自动跟随，再突防投弹');this.ui.update(0);}
  restart(){if(!this.flight)return;this.audio.reset();this.audio.unlock();this.clearInput();this.shipManager.reset();this.flight.reset();this.particles.clear();this.time=0;this.accumulator=0;this.state='playing';this.sceneManager.snapFlightCamera=true;this.ui.update(0);}
  selectAircraft(type){if(this.state!=='ready'||!Object.hasOwn(PLAYER_AIRCRAFT,type))return;this.flight.reset(type);this.sceneManager.snapFlightCamera=true;this.ui.update(0);}
  returnToHangar(){if(!['paused','won','lost'].includes(this.state))return;this.clearInput();this.audio.reset();this.shipManager.reset();this.flight.reset();this.particles.clear();this.time=0;this.accumulator=0;this.state='ready';this.sceneManager.snapFlightCamera=true;this.ui.messages.length=0;this.ui.update(0);}
  togglePause(){if(!['playing','paused'].includes(this.state))return;this.state=this.state==='playing'?'paused':'playing';this.clearInput();this.accumulator=0;this.audio.setPaused(this.state==='paused');if(this.state==='playing')this.audio.unlock();this.ui.update(0);}
  dropBomb(){if(this.state==='playing')return this.flight.dropBomb();return false;}
  evade(direction=1){if(this.state==='playing')return this.flight.evade(direction);return false;}
  cycleTarget(){if(this.state==='playing')this.flight.cycleTarget();}
  setCamera(){this.sceneManager.closeCamera=!this.sceneManager.closeCamera;}
  toggleSound(){this.soundEnabled=this.audio.toggleFromGesture();this.ui.update(0);}
  testSound(){this.soundEnabled=true;this.audio.setPaused(this.state!=='playing');return this.audio.testSound();}
  bindInput(){
    installMobileBrowserGuards();
    this.audio.bindGestureUnlock(document,()=>this.state==='playing');
    const handled=['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE'];
    window.addEventListener('keydown',e=>{
      if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
      if(this.state==='playing'&&handled.includes(e.code))e.preventDefault();
      if(this.state==='playing')this.keys.add(e.code);
      if(e.repeat)return;
      if(e.code==='KeyF'&&this.state==='playing')this.flight.fire();
      if(e.code==='Space'||e.code==='KeyB')this.dropBomb();if(e.code==='KeyR')this.evade(this.input.x>0?-1:1);if(e.code==='Tab')this.cycleTarget();
      if(e.code==='KeyP'||e.code==='Escape')this.togglePause();if(e.code==='KeyC')this.setCamera();
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>{this.audio.stopPreview();this.clearInput();if(this.state==='playing')this.togglePause();});
    window.addEventListener('orientationchange',()=>{this.clearInput();if(this.state==='playing')this.togglePause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.clearInput();if(this.state==='playing')this.togglePause();}});
    const canvas=this.sceneManager.canvas;
    canvas.addEventListener('pointermove',e=>{if(e.pointerType==='touch'||this.state!=='playing')return;const rect=canvas.getBoundingClientRect();const axis=(v,size)=>Math.max(-1,Math.min(1,(v/size-.5)*2.4));const x=axis(e.clientX-rect.left,rect.width),y=axis(e.clientY-rect.top,rect.height);if(Math.abs(x-this.input.x)+Math.abs(y-this.input.y)>.003)this.input.mouseSteerTime=.12;this.input.x=x;this.input.y=y;});
    canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;if(this.state==='playing'){this.audio.unlock();this.input.fire=e.button===0;if(this.input.fire){this.input.mouseSteerTime=0;this.flight.fire();}canvas.setPointerCapture(e.pointerId);}});
    const release=()=>{this.input.fire=false;};
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',()=>this.clearInput());canvas.addEventListener('lostpointercapture',release);
    canvas.addEventListener('pointerleave',()=>{this.input.x=0;this.input.y=0;});canvas.addEventListener('contextmenu',e=>e.preventDefault());
  }
  step(dt){
    this.time+=dt;this.shipManager.update(dt,this.time,new Set());this.shipManager.selection.visible=false;
    this.flight.update(dt,this.time,this.keys,this.debugBurstUntil>this.time?{...this.input,fire:true}:this.input);this.effects.update(dt,this.sceneManager.camera,this.flight.projectiles);this.particles.update(dt);
    if(this.flight.player.hp<=0)this.state='lost';
    else if(!this.shipManager.ships.some(s=>s.team==='jp'&&s.carrier&&s.alive))this.state='won';
    if(this.state!=='playing'){this.clearInput();this.ui.update(0);}
  }
  frame(now){
    const raw=(now-this.last)/1000,dt=Math.min(raw,.1);this.last=now;if(raw>0)this.fps+=(1/raw-this.fps)*.04;
    if(this.state==='playing'&&!this.captureFrozen){this.accumulator+=dt;while(this.accumulator>=CONFIG.fixedStep&&this.state==='playing'){this.step(CONFIG.fixedStep);this.accumulator-=CONFIG.fixedStep;}}else this.accumulator=0;
    if(this.state==='won'||this.state==='lost'){this.effects.update(dt,this.sceneManager.camera,[]);this.particles.update(dt);for(const s of this.shipManager.ships)if(!s.alive&&s.sinking<32){s.sinking+=dt;s.mesh.position.y=-s.sinking*1.4;s.mesh.rotation.z=Math.min(.65,s.sinking*.018);s.mesh.visible=s.sinking<32;}}
    this.sceneManager.renderer.info.reset();this.sceneManager.update(this.time,dt,this.flight.player.mesh,this.shipManager.ships);
    this.effects.update(0,this.sceneManager.camera,['ready','playing','paused'].includes(this.state)?this.flight.projectiles:[]);
    this.audio.update(dt,this.flight.player,this.sceneManager.camera,this.state,this.flight.diveSafety?.level||0);
    this.updateCaptureMetrics?.();
    this.sceneManager.renderer.render(this.sceneManager.scene,this.sceneManager.camera);this.ui.render?.();
    this.uiClock+=dt;if(this.uiClock>.08){this.ui.update(this.uiClock);this.uiClock=0;}
    if(this.debugNode)this.debugNode.textContent=JSON.stringify({state:this.state,time:+this.time.toFixed(2),fps:Math.round(this.fps),mobile:this.sceneManager.mobile,pixelRatio:this.sceneManager.renderer.getPixelRatio(),assetFailures:this.assets.failures,hp:this.flight.player.hp,position:this.flight.player.mesh.position.toArray(),speed:this.flight.player.speed,autoTracking:this.flight.aimAssist.tracking,gyro:this.gyro?.diagnostics(),aimSettings:this.aimSettings,aimTarget:this.flight.aimAssist.solution?{id:this.flight.aimAssist.target.id,angle:this.flight.aimAssist.solution.angle,range:this.flight.aimAssist.solution.range}:null,handling:{heading:this.flight.player.heading,pitch:this.flight.player.pitch,turnInput:this.flight.player.turnInput,pitchInput:this.flight.player.pitchInput},aircraftHealth:this.flight.enemies.map(e=>({hp:e.hp,maxHp:e.maxHp})),bombs:this.flight.player.bombs,enemies:this.flight.enemies.length,allies:this.flight.allies.length,bombsInFlight:this.flight.bombs.length,mountedBombs:this.flight.player.racks.filter(r=>r.visible).length,sky:this.sceneManager.sky.diagnostics,projectiles:this.flight.projectiles.length,stats:this.flight.stats,drawCalls:this.sceneManager.renderer.info.render.calls,triangles:this.sceneManager.renderer.info.render.triangles,audio:this.audio.diagnostics,effects:this.effects.diagnostics,ocean:this.sceneManager.ocean.diagnostics});
    requestAnimationFrame(t=>this.frame(t));
  }
}
window.MIDWAY_BOOT?.report(15,'正在构建太平洋海域');
await window.MIDWAY_BOOT?.paint();
const game=new Game();
if(new URLSearchParams(location.search).has('debug')&&!new URLSearchParams(location.search).has('capture')){
  window.midway=game;game.debugNode=document.createElement('pre');game.debugNode.id='diagnostics';game.debugNode.style.cssText='position:fixed;bottom:5px;right:6px;max-width:220px;max-height:64px;overflow:hidden;z-index:50;font:8px monospace;white-space:pre-wrap;background:#102936cc;color:#bcd;padding:6px;pointer-events:none';document.body.append(game.debugNode);
  // 仅调试入口显示独立特效预览按钮；不改变命中/任务进度。
  const effectTools=document.createElement('div');effectTools.id='effect-tools';effectTools.style.cssText='position:fixed;left:12px;top:175px;display:flex;gap:5px;z-index:80';
  for(const [kind,label] of [['gun','试射'],['flak','防空爆炸'],['ship','火球烟雾'],['splash','水柱']]){
    const button=document.createElement('button');button.textContent=label;button.style.cssText='padding:9px;background:#15323ddd;border:1px solid #cbd8ba;color:#eaf1d2;font-size:11px';
    button.addEventListener('click',()=>{
      if(game.state==='ready')game.start();if(game.state!=='playing')return;game.audio.unlock();
      if(kind==='gun'){game.debugBurstUntil=game.time+.8;game.flight.fire();return;}
      const p=game.flight.player,point=p.mesh.position.clone().addScaledVector(p.forward,95);point.y-=kind==='splash'?p.mesh.position.y:12;
      game.effects.burst(point,kind,kind==='ship'?1.7:1.2);game.audio.play(kind==='ship'?'explosion':kind,point,{heavy:kind==='ship'});
      game.ui.notify('调试特效预览 · 不计战斗伤害');
    });effectTools.append(button);
  }
  document.body.append(effectTools);
  const audioSuspend=document.createElement('button');audioSuspend.textContent='模拟声音挂起';audioSuspend.style.cssText='padding:9px;background:#15323ddd;border:1px solid #cbd8ba;color:#eaf1d2;font-size:11px';
  audioSuspend.addEventListener('click',()=>{game.audio.context?.suspend().then(()=>game.ui.update(0));});effectTools.append(audioSuspend);
  window.__THREE_GAME_DIAGNOSTICS__={renderer:game.sceneManager.renderer.info,get state(){return{state:game.state,time:game.time,fps:game.fps,stats:game.flight?.stats};}};
}
