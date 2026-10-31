import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../boot.js',import.meta.url),'utf8');
function setup(){
 const elements=new Map(),frames=[],scripts=[];let reloads=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{style:{},dataset:{},attrs:{},listeners:{},disabled:true,setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.listeners[k]=fn}});return elements.get(id)};
 const context={URL,Map,Promise,console:{error(){}},window:{},requestAnimationFrame:fn=>frames.push(fn),location:{protocol:'file:',reload(){reloads++}},document:{currentScript:{src:'file:///game/boot.js?v=abc'},getElementById:element,createElement:()=>({}),head:{append:s=>scripts.push(s)}}};
 vm.runInNewContext(source,context);
 return {api:context.window.MIDWAY_BOOT,element,frames,scripts,get reloads(){return reloads}};
}
const t=setup();
t.api.report(32,'模型');t.api.report(20,'稍后完成的并发请求');assert.equal(t.element('loading-percent').textContent,'32%');assert.equal(t.element('loading-progress').attrs['aria-valuenow'],32);
t.api.report(100,'准备完成');assert.equal(t.element('loading-caption-state').textContent,'READY');
t.api.fail(new Error('连接失败'));assert.equal(t.element('hud').dataset.state,'error');assert.equal(t.element('overlay-action').disabled,false);assert.match(t.element('overlay-description').textContent,/连接失败/);
t.api.report(100,'错误后不应恢复');assert.equal(t.element('loading-stage').textContent,'准备中断 · 请重试');t.element('overlay-action').listeners.click();assert.equal(t.reloads,1);
const offline=setup();assert.equal(offline.scripts.length,0,'绘制首屏之前不能阻塞加载');offline.frames.shift()();offline.frames.shift()();await new Promise(resolve=>setImmediate(resolve));assert.match(offline.scripts[0].src,/assets\/embedded.js\?v=abc/);offline.scripts[0].onload();await new Promise(resolve=>setImmediate(resolve));assert.match(offline.scripts[1].src,/audio\/embedded.js/);offline.scripts[1].onload();await new Promise(resolve=>setImmediate(resolve));assert.match(offline.scripts[2].src,/standalone.js/);offline.scripts[2].onload();
const broken=setup();broken.frames.shift()();broken.frames.shift()();await new Promise(resolve=>setImmediate(resolve));broken.scripts[0].onerror();await new Promise(resolve=>setImmediate(resolve));assert.equal(broken.element('hud').dataset.state,'error');assert.equal(broken.element('overlay-action').disabled,false);
console.log('PASS: monotonic progress, accessible percentage, completion, retry, first paint, offline dependency order, failed script recovery');
