import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioManager} from '../js/AudioManager.js';

class Param{value=0;setTargetAtTime(v){this.value=v;}}
class Node{
  constructor(ctx){this.ctx=ctx;for(const key of ['gain','frequency','pan','playbackRate','threshold','knee','ratio','attack','release'])this[key]=new Param();}
  connect(n){this.output=n;return n;}disconnect(){this.disconnected=true;}start(){this.ctx.started++;}stop(){this.stopped=true;this.onended?.();}
}
let initialState='suspended',contexts=[],fetches=0;
class Context{
  state=initialState;currentTime=1;sampleRate=22050;started=0;resumes=0;mode='allow';destination=new Node(this);
  constructor(){contexts.push(this);}
  createGain(){return new Node(this)}createDynamicsCompressor(){return new Node(this)}createBiquadFilter(){return new Node(this)}createStereoPanner(){return new Node(this)}createBufferSource(){return new Node(this)}
  createBuffer(ch,n){const data=new Float32Array(n);return {getChannelData:()=>data};}
  decodeAudioData(){return Promise.resolve({decoded:true});}
  resume(){this.resumes++;if(this.mode==='block')return Promise.reject(new Error('gesture required'));if(this.mode==='pending')return new Promise(r=>this.finishResume=()=>{this.change('running');r();});this.change('running');return Promise.resolve();}
  change(state){this.state=state;this.onstatechange?.();}
}
function setup(state='suspended'){
  initialState=state;contexts=[];fetches=0;
  globalThis.window={AudioContext:Context,location:{search:''}};globalThis.location={protocol:'https:'};globalThis.document={hidden:false};
  Object.defineProperty(globalThis,'navigator',{value:{audioSession:{type:'auto'}},configurable:true});
  globalThis.fetch=async()=>{fetches++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};return new AudioManager();
}
const player={hp:100,throttle:.55,speed:88,mesh:{position:{x:0,y:100,z:0}}};

test('initial gesture resumes synchronously and starts a silent primer before waiting on downloads',async()=>{
  const a=setup(),ready=a.unlock();assert.equal(a.context.resumes,1);assert.equal(a.context.started,1);assert.equal(navigator.audioSession.type,'playback');
  assert(await ready);assert.equal(a.loaded,9);assert.equal(a.buttonLabel,'音效 开');a.update(.016,player,null,'playing');assert.equal(a.loops.size,2);
});
test('Safari interrupted context resumes and rebuilds loops; recovery click does not mute',async()=>{
  const a=setup();await a.unlock();a.update(.016,player,null,'playing',2);assert(a.warningVoice);
  a.context.change('interrupted');assert.equal(a.loops.size,0);assert.equal(a.warningLevel,0);assert.equal(a.buttonLabel,'恢复声音');
  const before=a.context.resumes;assert.equal(a.toggleFromGesture(),true);assert.equal(a.context.resumes,before+1);assert.equal(a.enabled,true);
  a.update(.016,player,null,'playing',2);assert.equal(a.loops.size,2);assert.equal(a.warningLevel,2);
  assert.equal(a.toggleFromGesture(),false);assert.equal(a.voices.size+a.loops.size,0);assert.equal(navigator.audioSession.type,'auto');
});
test('blocked resume is visible, retry succeeds, and closed contexts are recreated once',async()=>{
  const a=setup();await a.unlock();const old=a.context;old.change('suspended');old.mode='block';
  assert.equal(await a.unlock(),false);assert.match(a.unlockError,/gesture required/);assert.match(a.statusText,/重试/);assert.equal(a.needsUnlock,true);
  old.mode='allow';assert(await a.unlock());assert.equal(a.unlockError,'');old.change('closed');assert(await a.unlock());assert.notEqual(a.context,old);assert.equal(contexts.length,2);assert.equal(a.loaded,9);
});
test('gesture recovery covers touch end and pointer up; avoids mute/test buttons and untrusted events',async()=>{
  const a=setup(),listeners=new Map();let active=true;
  const root={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const clean=a.bindGestureUnlock(root,()=>active);assert.equal(a.bindGestureUnlock(root),clean);
  const event=(button=false,trusted=true)=>({isTrusted:trusted,target:{closest:s=>s==='#hud, #scene'?true:button}});
  listeners.get('touchend')(event());assert.equal(a.context.resumes,1);
  a.context.change('interrupted');listeners.get('pointerup')(event());assert.equal(a.context.resumes,2);
  a.context.change('interrupted');listeners.get('pointerdown')(event(true));listeners.get('pointerup')(event(false,false));assert.equal(a.context.resumes,2);
  active=false;listeners.get('keydown')(event());assert.equal(a.context.resumes,2);active=true;a.enabled=false;listeners.get('touchend')(event());assert.equal(a.context.resumes,2);
  clean();assert.equal(listeners.size,0);
});
test('explicit preview works while paused without waiting for slow audio files',async()=>{
  const a=setup();globalThis.fetch=()=>new Promise(()=>{});a.setPaused(true);
  assert(await a.testSound());assert(a.diagnostics.previewActive);assert.equal(a.loaded,0);assert.equal(a.master.gain.value,0);
  const preview=a.previewVoice;assert.equal(preview.gain.output,a.context.destination);
  a.enabled=false;assert(preview.ended);assert.equal(a.diagnostics.previewActive,false);assert.equal(navigator.audioSession.type,'auto');
});
test('repeated paused previews keep playback session until the latest preview ends',async()=>{
  const a=setup();a.setPaused(true);assert(await a.testSound());const first=a.previewVoice;
  // Web Audio dispatches ended asynchronously, possibly after the replacement starts.
  first.source.stop=()=>{first.source.stopped=true;};
  assert(await a.testSound());const second=a.previewVoice;assert(first.ended);assert.notEqual(first,second);
  first.source.onended();assert.equal(navigator.audioSession.type,'playback');assert.equal(a.previewVoice,second);
  second.source.onended();assert.equal(navigator.audioSession.type,'auto');assert.equal(a.previewVoice,null);
  assert(await a.testSound());a.stopPreview();assert.equal(navigator.audioSession.type,'auto');
});
test('pause, hide and reset discard preview; late resume cannot restart a cancelled test',async()=>{
  const a=setup();await a.unlock();a.context.change('suspended');a.context.mode='pending';const pending=a.testSound();a.enabled=false;a.context.finishResume();assert.equal(await pending,false);assert.equal(a.previewVoice,null);
  a.context.mode='allow';a.enabled=true;await a.testSound();a.reset();assert.equal(a.previewVoice,null);
  const listeners=new Map(),root={hidden:false,addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener:t=>listeners.delete(t)};a.bindGestureUnlock(root);await a.testSound();root.hidden=true;listeners.get('visibilitychange')();assert.equal(a.previewVoice,null);assert.equal(navigator.audioSession.type,'auto');
});
test('no audio session API or a read-only implementation does not block playback',async()=>{
  for(const readonly of [false,true]){const a=setup();if(readonly)Object.defineProperty(navigator.audioSession,'type',{get:()=> 'auto',set(){throw new Error('read-only');}});else delete navigator.audioSession;assert(await a.unlock());assert.equal(a.context.state,'running');a.enabled=false;}
});
test('muted controls never create or resume audio; unsupported browser gives a useful status',async()=>{
  const a=setup();a.enabled=false;assert.equal(await a.unlock(),false);assert.equal(contexts.length,0);a.enabled=true;window.AudioContext=null;assert.equal(await a.unlock(),false);assert.match(a.statusText,/Safari/);
});
