import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Control extends EventTarget {
  captures=new Set(); classes=new Set(); style={}; dataset={};
  classList={add:n=>this.classes.add(n),remove:n=>this.classes.delete(n)};
  setPointerCapture(id){this.captures.add(id)}
  hasPointerCapture(id){return this.captures.has(id)}
  releasePointerCapture(id){this.captures.delete(id)}
  getBoundingClientRect(){return {left:0,top:0,width:120,height:120}}
  closest(){return null}
  send(type,id,x=60,y=60){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0});this.dispatchEvent(e)}
}
const dom=Object.fromEntries(['touch-look','touch-fire','touch-bomb','touch-evade','touch-target','flight-joystick','joystick-knob'].map(id=>[id,new Control()]));
const throttle=new Control();throttle.dataset.key='KeyW';
const win=new EventTarget(), doc=new EventTarget();doc.querySelectorAll=()=>[throttle];win.innerWidth=390;
const context=vm.createContext({window:win,document:doc,console,Map,Set,Math});
const source=new vm.SourceTextModule(fs.readFileSync(new URL('../js/UIManager.js',import.meta.url),'utf8'),{context});
const aimModule=new vm.SourceTextModule(fs.readFileSync(new URL('../js/TouchAim.js',import.meta.url),'utf8'),{context});
await aimModule.link(()=>{});
const gyroModule=new vm.SourceTextModule(fs.readFileSync(new URL('../js/GyroAim.js',import.meta.url),'utf8'),{context});
const sensorModule=new vm.SourceTextModule(fs.readFileSync(new URL('../js/GyroSensor.js',import.meta.url),'utf8'),{context});await sensorModule.link(()=>{});
await gyroModule.link(()=>sensorModule);
const assistModule=new vm.SourceTextModule(fs.readFileSync(new URL('../js/AimAssist.js',import.meta.url),'utf8'),{context});
await assistModule.link(()=>new vm.SyntheticModule([],function(){},{context}));
await source.link(spec=>spec==='./AimAssist.js'?assistModule:spec==='./GyroAim.js'?gyroModule:spec==='./TouchAim.js'?aimModule:new vm.SyntheticModule(spec==='three'?[]:['SHIP_TYPES','PLAYER_AIRCRAFT'],function(){if(spec!=='three'){this.setExport('SHIP_TYPES',{});this.setExport('PLAYER_AIRCRAFT',{})}},{context}));await source.evaluate();
let shots=0,bombs=0;
const game={state:'playing',input:{x:0,y:0,fire:false},keys:new Set(),flight:{fire(){shots++}},dropBomb(){bombs++},evade(){},cycleTarget(){}};
const ui={game,dom};source.namespace.UIManager.prototype.bindTouchControls.call(ui);
const joy=dom['flight-joystick'], fire=dom['touch-fire'];
joy.send('pointerdown',1,100,60);fire.send('pointerdown',2);throttle.send('pointerdown',3);
assert.equal(game.input.x,0,'off-center press must start neutral');assert.equal(game.input.y,0);
joy.send('pointermove',1,110,60);assert(Math.abs(game.input.x-10/(120*.42))<1e-9,'travel is relative to initial contact');
joy.send('pointerdown',99,0,0);joy.send('pointermove',99,200,0);assert(Math.abs(game.input.x-10/(120*.42))<1e-9,'second finger cannot steal stick');
joy.send('pointermove',1,151,60);
assert(game.input.x>.9&&game.input.fire&&game.keys.has('KeyW'),'three independent controls must coexist');
assert.equal(game.input.joystickActive,true,'joystick gesture selects gentle flight handling');
fire.send('pointerdown',4);fire.send('pointerup',4);assert(game.input.fire,'second finger cannot steal/release held fire');
joy.send('pointermove',1,200,200);assert(Math.hypot(game.input.x,game.input.y)<=1.000001,'radial input stays bounded');
fire.send('pointercancel',2);assert(!game.input.fire&&game.input.x!==0,'cancelling fire preserves steering');
joy.send('lostpointercapture',1);assert.equal(game.input.x,0);assert.equal(game.input.y,0);
assert.equal(game.input.joystickActive,false,'lost capture clears the joystick profile');
throttle.send('pointerup',3);assert.equal(game.keys.size,0);
joy.send('pointerdown',7,100,60);fire.send('pointerdown',8);throttle.send('pointerdown',9);ui.clearTouch();
assert(!game.input.fire&&game.input.x===0&&game.keys.size===0&&ui.heldButtons.size===0);
assert.equal(game.input.joystickActive,false,'pause clears the joystick profile');
assert.equal(joy.captures.size+fire.captures.size+throttle.captures.size,0,'pause releases every captured pointer');
game.state='paused';fire.send('pointerdown',10);assert(!game.input.fire);assert.equal(shots,2);
game.state='playing';joy.send('pointerdown',11,100,60);fire.send('pointerdown',12);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert(!game.input.fire&&game.input.x===0);
console.log('PASS: simultaneous steering/fire/throttle, secondary finger isolation, bounded stick, cancel/lost capture, pause cleanup, background cleanup');

doc.hidden=false;ui.clearTouch();
const look=dom['touch-look'];
joy.send('pointerdown',20,100,60);joy.send('pointermove',20,151,60);look.send('pointerdown',21,240,350);
look.send('pointermove',21,270,330);fire.send('pointerdown',22,310,650);
const firstAim=game.input.aim.consume(1/60);
assert(firstAim.x<0&&firstAim.y>0&&game.input.x>.9&&game.input.fire,'right/up drag aims right/up while joystick and fire work');
const pendingBefore=game.input.aim.x;fire.send('pointermove',22,340,690);
assert.equal(game.input.aim.x,pendingBefore,'fire finger must not steal an existing aim gesture');
fire.send('pointerup',22);assert(game.input.aim.active&&!game.input.fire,'releasing fire preserves separate look');
look.send('pointerup',21);game.input.aim.consume(1/60);assert.deepEqual({...game.input.aim.consume(1/60)},{x:0,y:0},'release leaves no trailing aim');
ui.clearTouch();
fire.send('pointerdown',23,300,650);fire.send('pointermove',23,320,620);
assert(game.input.aim.x<0&&game.input.aim.y>0&&game.input.fire,'fire dragging must aim and shoot');
fire.send('pointercancel',23);assert(!game.input.aim.active&&!game.input.fire&&game.input.aim.x===0,'cancel discards stale aim');
look.send('pointerdown',24,250,350);look.send('pointermove',24,280,350);win.dispatchEvent(new Event('blur'));
assert(!game.input.aim.active&&game.input.aim.x===0&&look.captures.size===0,'blur cleans up aim capture and pending motion');
const beforeTap=shots;fire.send('pointerdown',25);fire.send('pointerup',25);assert.equal(shots,beforeTap+1,'quick tap fires exactly once');
look.send('pointerdown',26,389,350);assert(!game.input.aim.active,'new gestures at screen edge are ignored');
const TouchAim=aimModule.namespace.TouchAim;
for(const hz of [30,60,120]){const a=new TouchAim();a.begin();a.move(.5,-.25,390);let x=0,y=0;for(let i=0;i<hz;i++){const d=a.consume(1/hz);x+=d.x;y+=d.y;}assert(Math.abs(x+.5*Math.PI*.5/640)<1e-10&&Math.abs(y-.25*Math.PI*.5/640)<1e-10,'subpixel movement must survive smoothing at every frame rate');}
console.log('PASS: aim + stick + fire ownership, fire dragging, quick tap, release/cancel/blur, edge guard, 30/60/120 Hz subpixel aim');
const browserModule=new vm.SourceTextModule(fs.readFileSync(new URL('../js/MobileBrowser.js',import.meta.url),'utf8'),{context});await browserModule.link(()=>{});await browserModule.evaluate();
const events={};browserModule.namespace.installMobileBrowserGuards({addEventListener:(type,fn,options)=>{assert.equal(options.passive,false);events[type]=fn;}});
for(const type of ['dblclick','gesturestart','gesturechange'])for(const [gameArea,form,prevented] of [[true,false,true],[true,true,false],[false,false,false]]){let result=false;events[type]({target:{closest:selector=>selector==='#hud, #scene'?gameArea:form},preventDefault(){result=true}});assert.equal(result,prevented);}
assert(!events.click&&!events.touchend,'zoom guard must preserve native taps and scrolling');
console.log('PASS: scoped double-tap/Safari gesture prevention, form and outside-page exclusions, native click preserved');

// Menus from a held pointer must be cancelled without releasing the game's input.
const gameArea='#hud, #scene', controlArea='#scene, .touch-controls';
const heldArea='#touch-fire, #flight-joystick, #touch-look, .touch-controls [data-key]';
const editable='input, select, textarea, [contenteditable]:not([contenteditable="false"])';
function browserEvent(type, areas, cancelable=true) {
  const event=new Event(type,{cancelable});
  Object.defineProperty(event,'target',{value:{closest:selector=>areas.includes(selector)}});
  events[type](event);return event;
}
fire.send('pointerdown',28);
for(const type of ['contextmenu','selectstart','dragstart']) {
  assert(browserEvent(type,[gameArea,controlArea,heldArea]).defaultPrevented,`${type} on a fire icon/label must be suppressed`);
  assert(game.input.fire,'browser-menu suppression must not stop a held shot');
  for(const areas of [[],[gameArea],[gameArea,editable],[controlArea,editable]])
    assert(!browserEvent(type,areas).defaultPrevented,'menus, editable fields and feedback stay native');
  assert(!browserEvent(type,[controlArea],false).defaultPrevented,'non-cancelable events are ignored');
}
for(const type of ['touchstart','touchmove']) {
  assert(browserEvent(type,[gameArea,controlArea,heldArea]).defaultPrevented,'continuous gestures suppress browser defaults');
  for(const areas of [[gameArea,controlArea],[gameArea],[gameArea,editable],[heldArea,editable],[]])
    assert(!browserEvent(type,areas).defaultPrevented,'tap controls, settings scrolling and editable fields remain native');
}
fire.send('pointerup',28);assert(!game.input.fire&&!game.input.aim.active,'release still ends firing and aiming');
dom['touch-bomb'].dispatchEvent(new Event('click'));assert.equal(bombs,1,'bomb button still receives a native click');
console.log('PASS: long-press menu/selection/drag guards, held firing continuity, tap controls and editable/menu exclusions');

fire.setPointerCapture=()=>{throw new Error('capture unavailable')};
fire.send('pointerdown',30);const outsideRelease=new Event('pointerup');Object.assign(outsideRelease,{pointerId:30});win.dispatchEvent(outsideRelease);
assert(!game.input.fire&&!game.input.aim.active,'window release must clean up when capture fails');
console.log('PASS: capture-failure fallback release outside controls');
