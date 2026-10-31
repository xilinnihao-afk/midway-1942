import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..'),context=vm.createContext({console}),modules=new Map();
fs.mkdirSync(path.join(root,'artifacts/dive-warning-20261024'),{recursive:true});
for(const folder of ['js','vendor'])for(const file of fs.readdirSync(path.join(root,folder)))if(file.endsWith('.js')){const id=`${folder}/${file}`;modules.set(id,new vm.SourceTextModule(fs.readFileSync(path.join(root,id),'utf8'),{context,identifier:id}));}
const link=(spec,parent)=>modules.get(spec==='three'?'vendor/three.module.js':path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier),spec)));
await modules.get('js/FlightManager.js').link(link);await modules.get('js/FlightManager.js').evaluate();
const THREE=modules.get('vendor/three.module.js').namespace;
const {FlightManager}=modules.get('js/FlightManager.js').namespace;
const {estimatePullUp,diveSafety,recoverySurface}=modules.get('js/DiveSafety.js').namespace;
const game={input:{},ui:{notify(){}},particles:{emit(){}},effects:{clear(){},burst(){},muzzle(){}},sceneManager:{scene:new THREE.Scene(),getWaveHeight:()=>0},assets:{clone:()=>new THREE.Group(),cloneLow:()=>new THREE.Group()},shipManager:{ships:[],intersectBomb:()=>null}};
const flight=game.flight=new FlightManager(game),metrics=[];
function setup(type='sbd',speed=130,angle=37,elevator=0,boosting=false){
  flight.reset(type);const p=flight.player;p.mesh.position.set(800,400,-1200);p.previous.copy(p.mesh.position);p.pitch=-angle*Math.PI/180;p.pitchInput=elevator;p.speed=speed;p.throttle=1;p.boosting=boosting;return p;
}
test('full-stick recovery estimate follows actual flight at different speeds, dives, aircraft and frame rates',()=>{
  for(const type of ['sbd','spitfire','d3a','zero'])for(const speed of [90,130,160])for(const angle of [20,37,60,75])for(const elevator of [0,-1])for(const hz of [30,60,120]){
    const p=setup(type,speed,angle,elevator),estimated=estimatePullUp(p,type);let minY=400,frames=0,steps=0,accumulator=0;
    // Render cadence varies; Game.frame always advances physics at 60 Hz.
    while(p.pitch<0&&frames<3*hz){accumulator+=1/hz;frames++;while(accumulator>=1/60&&p.pitch<0){flight.updatePlayer(1/60,steps/60,new Set(),{x:0,y:-1,joystickActive:true});minY=Math.min(minY,p.mesh.position.y);steps++;accumulator-=1/60;}}
    const actual=400-minY;
    assert(p.hp>0&&p.pitch>=0,`${type} failed recovery`);
    assert(Math.abs(estimated.loss-actual)<.02,`${type} ${speed} ${angle} ${hz} Hz: estimated ${estimated.loss}, actual ${actual}`);
    if(hz===60&&elevator===0)metrics.push({type,speed,angle,fullStickLoss:actual,seconds:steps/60,estimatedLimit:Math.ceil(estimated.loss+3)});
  }
  fs.writeFileSync(path.join(root,'artifacts/dive-warning-20261024/pull-up-metrics.json'),JSON.stringify(metrics,null,2));
});
test('warning leads danger; worsens for steeper/faster descents; works after the last bomb',()=>{
  const p=setup(),base=diveSafety(p,'sbd');assert(base.diving&&base.level===0);
  p.mesh.position.y=base.caution-1;assert.equal(diveSafety(p,'sbd').level,1);
  p.mesh.position.y=base.pullUp-1;assert.equal(diveSafety(p,'sbd').level,2);
  p.mesh.position.y=base.limit-1;p.bombs=0;assert.equal(diveSafety(p,'sbd').level,3);
  const steep=setup('sbd',160,60);assert(diveSafety(steep,'sbd').pullUp>base.pullUp+30);
  const fast=estimatePullUp(steep,'sbd').loss;steep.speed=90;assert(estimatePullUp(steep,'sbd').loss<fast);
});
test('actual full-stick recovery survives above the estimate and hits the sea below it',()=>{
  for(const offset of [-4,8]){
    const p=setup('sbd',130,60),safety=diveSafety(p,'sbd');p.mesh.position.y=safety.limit+offset;p.previous.copy(p.mesh.position);
    for(let i=0;i<120&&p.pitch<0&&p.hp>0;i++)flight.updatePlayer(1/60,i/60,new Set(),{x:0,y:-1,joystickActive:true});
    assert.equal(p.hp>0,offset>0);
  }
});
test('boost and initially held-down elevator are included; dead or climbing aircraft silence the alarm',()=>{
  const p=setup('sbd',160,60,0,true),boosted=estimatePullUp(p,'sbd');p.boosting=false;assert(estimatePullUp(p,'sbd').loss<boosted.loss);
  p.pitchInput=-1;assert(estimatePullUp(p,'sbd').loss>boosted.loss);
  p.mesh.position.y=10;p.pitch=.1;assert.equal(diveSafety(p,'sbd').level,0);
  p.pitch=-1;p.hp=0;assert.equal(diveSafety(p,'sbd').level,0);
});
test('hysteresis prevents threshold chatter without holding the alarm after recovery',()=>{
  const p=setup(),s=diveSafety(p,'sbd');p.mesh.position.y=s.pullUp+3;
  assert.equal(diveSafety(p,'sbd',[],0,2).level,2);
  p.mesh.position.y=s.pullUp+10;assert.equal(diveSafety(p,'sbd',[],0,2).level,1);
  p.pitch=0;assert.equal(diveSafety(p,'sbd',[],0,3).level,0);
});
test('recovery corridor accounts for island and allied/enemy decks, but ignores distant/dead ships',()=>{
  const p=setup();p.mesh.position.set(0,100,0);p.heading=0;
  const ship={alive:true,mesh:{position:new THREE.Vector3(0,0,60)},heading:0,width:40,length:100,deckHeight:12};
  assert.equal(recoverySurface(p,140,[ship]),13);
  ship.mesh.position.x=100;assert.equal(recoverySurface(p,140,[ship]),3);
  ship.mesh.position.x=0;ship.alive=false;assert.equal(recoverySurface(p,140,[ship]),3);
  p.mesh.position.set(-420,100,0);assert.equal(recoverySurface(p,200,[]),8);
});
