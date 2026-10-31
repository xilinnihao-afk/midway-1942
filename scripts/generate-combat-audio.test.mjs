/** 生命周期/声部预算契约测试；波形与真实解码另外在浏览器验证。 */
import {AudioManager,warningSamples} from '../js/AudioManager.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
class Param {value=0;setTargetAtTime(v){this.value=v;}}
class Node {constructor(){for(const k of ['gain','frequency','pan','playbackRate','threshold','knee','ratio','attack','release'])this[k]=new Param();}connect(n){return n;}disconnect(){}start(t){this.startTime=t;}stop(){this.onended?.();}}
class Context {state='running';currentTime=1;sampleRate=22050;destination=new Node();createGain(){return new Node()}createDynamicsCompressor(){return new Node()}createBiquadFilter(){return new Node()}createStereoPanner(){return new Node()}createBufferSource(){return new Node()}createBuffer(ch,n){const data=new Float32Array(n);return{getChannelData:()=>data}}decodeAudioData(a){return Promise.resolve({bytes:a.byteLength})}resume(){return Promise.resolve()}}
globalThis.window={AudioContext:Context,location:{search:''}};globalThis.location={protocol:'http:'};globalThis.fetch=async(url)=>({ok:true,arrayBuffer:async()=>fs.readFileSync(path.join(root,url)).buffer});
const a=new AudioManager();await a.unlock();assert.equal(a.diagnostics.loaded,9);
const player={hp:100,throttle:0,speed:57,mesh:{position:{x:0,y:0,z:0}}},camera={matrixWorld:{elements:[1,0,0]}};
a.update(.016,player,camera,'playing');assert.equal(a.diagnostics.loopCount,2);const rate=a.diagnostics.engineRate;
player.throttle=1;player.speed=152;a.update(.016,player,camera,'playing');assert(a.diagnostics.engineRate>rate);assert(a.diagnostics.windGain>.1);
a.play('aa',{x:220,y:0,z:0});assert.equal(a.diagnostics.lastPan,1);assert.equal(a.diagnostics.lastDistance,220);assert(a.voices.values().next().value.source.startTime>1);
for(let i=0;i<80;i++)a.play('flak',{x:0,y:0,z:20},{id:i});assert.equal(a.diagnostics.voices+a.diagnostics.loops,32);assert(a.diagnostics.dropped>0);
a.enabled=false;assert.equal(a.diagnostics.voices,0);assert.equal(a.diagnostics.loops,0);assert.equal(a.diagnostics.masterGain,0);
a.enabled=true;a.update(.016,player,camera,'playing');a.setPaused(true);assert.equal(a.diagnostics.loops,0);assert.equal(a.diagnostics.masterGain,0);
a.update(.016,player,camera,'playing');assert.equal(a.diagnostics.loops,2);for(let i=0;i<5;i++){a.reset();a.update(.016,player,camera,'playing')}assert.equal(a.diagnostics.loops,2);
a.play('explosion',{x:0,y:0,z:2});a.update(.016,player,camera,'lost');assert.equal(a.diagnostics.loops,0);assert.equal(a.diagnostics.voices,1);assert.equal(a.diagnostics.masterGain,.8);a.setPaused(true);assert.equal(a.diagnostics.voices,0);
a.release(undefined);a.reset();const first=a.random();a.reset();assert.equal(a.random(),first);
console.log('PASS: 9 assets loaded; throttle/boost pitch; wind-speed mix; spatial pan/delay; total voice budget; mute; pause/resume; restart no stack; final explosion tail; deterministic pitch seed; release guard.');

for(const level of [1,2]){
 const samples=warningSamples(level,22050);assert(samples.every(Number.isFinite));assert.equal(samples[0],0);assert.equal(samples.at(-1),0);
 const peak=Math.max(...samples.map(Math.abs)),rms=Math.sqrt(samples.reduce((n,v)=>n+v*v,0)/samples.length);assert(peak<.7&&rms>.18,'silent or clipped warning waveform');
}
a.update(.016,player,camera,'playing',1);assert.equal(a.warningLevel,1);assert(a.diagnostics.warningActive);
const firstWarning=a.warningVoice,plays=a.metrics.warningPlays;
for(let i=0;i<60;i++)a.update(.016,player,camera,'playing',1);assert.equal(a.metrics.warningPlays,plays,'per-frame alarm spam');
firstWarning.source.onended();a.context.currentTime+=1.9;a.update(.016,player,camera,'playing',1);assert.equal(a.metrics.warningPlays,plays,'warning cooldown ignored');
a.context.currentTime+=.2;a.update(.016,player,camera,'playing',1);assert.equal(a.metrics.warningPlays,plays+1);
const slow=a.warningVoice;a.update(.016,player,camera,'playing',2);assert(slow.ended&&a.warningVoice!==slow,'escalation did not replace slower tone');
assert.equal(a.warningLevel,2);a.update(.016,player,camera,'playing',0);assert(!a.diagnostics.warningActive&&a.warningLevel===0,'recovery leaves warning playing');
for(let i=0;i<80;i++)a.play('flak',{x:0,y:0,z:20},{id:'warning-budget-'+i});
a.update(.016,player,camera,'playing',3);assert(a.diagnostics.warningActive&&a.voices.size+a.loops.size<=32,'combat saturated warning voice');
for(const finish of [()=>a.setPaused(true),()=>{a.enabled=false;},()=>a.reset(),()=>a.update(.016,player,camera,'lost',3)]){
 a.enabled=true;a.update(.016,player,camera,'playing',2);assert(a.diagnostics.warningActive);finish();assert(!a.diagnostics.warningActive&&a.warningLevel===0,'stale warning after pause/mute/reset/end');
}
console.log('PASS: local warning PCM; no overlap; cooldown; immediate escalation; combat priority; recovery, mute, pause, reset and game-over stop warning.');
