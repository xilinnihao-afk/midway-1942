import * as THREE from 'three';
import { AirWingManager } from './AirWingManager.js';
import { updateControls } from './FlightControls.js';
import { CONFIG, PILOT, HANDLING, PLAYER_AIRCRAFT } from './config.js';
import { AimAssist } from './AimAssist.js';
import { diveSafety } from './DiveSafety.js';

const UP = new THREE.Vector3(0,1,0), FRONT = new THREE.Vector3(0,0,1);
const clamp = THREE.MathUtils.clamp;
/** 相对运动扫掠：高速子弹与移动飞机不会在两帧之间穿透。 */
export function sweptDistance(a,b,c,d) {
  const start=a.clone().sub(c), delta=b.clone().sub(d).sub(start);
  const t=clamp(-start.dot(delta)/Math.max(1e-8,delta.lengthSq()),0,1);
  return start.addScaledVector(delta,t).length();
}

/** 单机战斗唯一状态源。AI与玩家都使用有飞行时间的武器，无范围扣血。 */
export class FlightManager {
  constructor(game) {
    this.game=game; this.scene=game.sceneManager.scene; this.assets=game.assets;
    this.ships=game.shipManager; this.particles=game.particles;
    this.bulletSpeed=PILOT.bulletSpeed; this.selectedType='sbd'; this.aimAssist=new AimAssist();
    this.bombGeometry=new THREE.CapsuleGeometry(.32,1.35,3,8);this.bombGeometry.rotateX(Math.PI/2);
    this.bombFinGeometry=new THREE.BoxGeometry(1.15,.06,.6);this.bombBandGeometry=new THREE.CylinderGeometry(.326,.326,.15,8);this.bombBandGeometry.rotateX(Math.PI/2);
    this.bombBandMaterial=new THREE.MeshStandardMaterial({color:0xd7b866,roughness:.72});
    this.airWing=new AirWingManager(this);
    this.bombMaterial=new THREE.MeshStandardMaterial({color:0x343638,metalness:.6,roughness:.45});
    this.linesGeometry=new THREE.BufferGeometry();
    this.linePositions=new Float32Array(PILOT.maxProjectiles*6);
    this.lineColors=new Float32Array(PILOT.maxProjectiles*6);
    this.linesGeometry.setAttribute('position',new THREE.BufferAttribute(this.linePositions,3));
    this.linesGeometry.setAttribute('color',new THREE.BufferAttribute(this.lineColors,3));
    this.lines=new THREE.LineSegments(this.linesGeometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.95}));
    this.lines.frustumCulled=false; this.lines.visible=false; // CombatEffects 使用有宽度的曳光带替代1像素线
    this.flakGeometry=new THREE.RingGeometry(.985,1,64);
    this.flakMaterial=new THREE.MeshBasicMaterial({color:0xffb76a,side:THREE.DoubleSide,transparent:true,opacity:.42,depthWrite:false});
    this.supplyRing=new THREE.Mesh(new THREE.RingGeometry(177,180,80),new THREE.MeshBasicMaterial({color:0x69e6da,side:THREE.DoubleSide,transparent:true,opacity:.4,depthWrite:false}));
    this.supplyRing.rotation.x=-Math.PI/2; this.scene.add(this.supplyRing);
    this.reset();
  }
  notify(text) { this.game.ui.notify(text); }
  sound(type,position=null,options={}) { this.game.audio?.play(type,position,options); }
  effect(position,kind,scale=1,velocity=null){this.game.effects?.burst(position,kind,scale,velocity);}
  createPlane(type,low=false) {
    const mesh=new THREE.Group(), visual=new THREE.LOD(), high=this.assets.clone(type);
    visual.addLevel(high,0);
    if(low) visual.addLevel(this.assets.cloneLow(type),320,.15);
    mesh.add(visual); this.scene.add(mesh);
    const propellers=[]; high.traverse(n=>{if(n.userData.spinAxis)propellers.push(n);});
    return {mesh,propellers};
  }
  clear() {
    if(this.player)this.scene.remove(this.player.mesh);
    for(const item of [...(this.enemies||[]),...(this.bombs||[]),...(this.flak||[])])this.scene.remove(item.mesh);
    this.enemies=[];this.bombs=[];this.projectiles=[];this.flak=[];this.airWing?.clear();
    this.game.effects?.clear();
    this.linesGeometry.setDrawRange(0,0);
  }
  reset(type=this.selectedType) {
    this.aimAssist.clear();
    this.clear();this.selectedType=type;this.seed=19420604;this.serial=0;this.nextWave=20;
    this.stats={shots:0,hits:0,bombsDropped:0,bombHits:0,dodges:0,kills:0,alliedKills:0};
    const plane=this.createPlane(type), spec=PLAYER_AIRCRAFT[type] || PLAYER_AIRCRAFT.sbd;
    this.player={...plane,hp:spec.hp,maxHp:spec.hp,speed:88,throttle:.55,boost:1,bombs:spec.bombs,maxBombs:spec.bombs,rollCooldown:0,rollRemaining:0,rollDirection:1,rollOffset:new THREE.Vector3(),score:0,kills:0,damageFlash:0,heading:0,pitch:0,bank:0,gunClock:0,bombClock:0,velocity:new THREE.Vector3(0,0,88),forward:new THREE.Vector3(0,0,1),previous:new THREE.Vector3(),smokeClock:0,gunKick:0,bombFlash:0,turnInput:0,pitchInput:0};
    this.player.mesh.position.set(15,150,-920);this.player.previous.copy(this.player.mesh.position);
    this.warning='';this.diveSafety={level:0,diving:false};this.reason='';this.resupplyProgress=0;this.supplyCooldown=0;this.boundaryClock=0;
    this.bombImpact=new THREE.Vector3();this.bombOnTarget=false;
    for(const ship of this.ships.ships){ship.aaClock=1+(this.serial++%4)*.4;ship.flakClock=3+(this.serial%4);}
    this.mountBombs();
    this.spawnEnemy(new THREE.Vector3(-65,158,-300),Math.PI,'zero');
    this.spawnEnemy(new THREE.Vector3(95,180,-190),Math.PI,'d3a');
    for(let i=2;i<PILOT.initialEnemies;i++)this.spawnEnemy(new THREE.Vector3((i%2?1:-1)*(90+Math.floor(i/2)*65),150+(i%3)*50,-200+Math.floor(i/2)*105),Math.PI,i%3?'zero':'d3a');
    this.airWing.reset();
    this.predictBomb();
  }
  get allies(){return this.airWing.allies;}
  random() {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  get target(){return this.ships.target;}
  cycleTarget(){const list=this.ships.ships.filter(s=>s.team==='jp'&&s.alive);if(!list.length)return;const i=list.indexOf(this.target);this.ships.setTarget(list[(i+1)%list.length].id);this.notify(`目标：${this.target.name}`);}
  spawnEnemy(position,heading,type='zero') {
    if(this.enemies.length>=PILOT.maxEnemies)return;
    const model=this.createPlane(type,true),forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    model.mesh.position.copy(position);model.mesh.quaternion.setFromUnitVectors(FRONT,forward);
    this.enemies.push({...model,id:++this.serial,hp:72,maxHp:72,hitFlash:0,forward,velocity:forward.clone().multiplyScalar(77),previous:position.clone(),clock:1.2+this.random(),age:0,phase:0,escape:0});
  }
  evade(direction=1){const p=this.player;if(p.rollCooldown>0||p.hp<=0)return false;p.rollRemaining=1.15;p.rollCooldown=5;p.rollDirection=direction;p.rollOffset.set(0,0,0);this.sound('boost');return true;}
  damagePlayer(amount,reason){const p=this.player;if(p.hp<=0)return;p.hp=Math.max(0,p.hp-amount);p.damageFlash=Math.min(1,p.damageFlash+.6);this.reason=reason;this.sound('hit');this.effect(p.mesh.position,'impact',.7,p.velocity);if(p.hp===0){this.effect(p.mesh.position,'explosion',1.5,p.velocity);this.sound('explosion',p.mesh.position);this.notify(reason);}}
  addProjectile(position,velocity,team,damage,life=2.2,flak=false,options={}){
    if(this.projectiles.length>=PILOT.maxProjectiles)return;
    this.projectiles.push({position:position.clone(),previous:position.clone(),velocity:velocity.clone(),team,damage,life,maxLife:life,age:0,flak,gravity:flak?13:9.81,visualOnly:!!options.visualOnly,owner:options.owner||'player',near:false});
    this.game.effects?.muzzle(position,velocity.clone().normalize(),{heavy:flak,velocity:options.inheritVelocity||(team==='us'?this.player.velocity:null),anchor:options.anchor,localOffset:options.localOffset});
  }
  fire(){
    const p=this.player;if(p.hp<=0||p.gunClock>0)return;
    this.updateAimTarget();
    p.gunClock=.085;
    p.gunKick=1;
    for(const sign of [-1,1]){
      const localOffset=new THREE.Vector3(sign*2.7,-.03,1.35);
      const pos=localOffset.clone().applyQuaternion(p.mesh.quaternion).add(p.mesh.position);
      const direction=this.aimAssist.shotDirection(p,pos,this.bulletSpeed,this.game.aimSettings?.assisted??true);
      this.addProjectile(pos,direction.multiplyScalar(this.bulletSpeed).add(p.velocity),'us',18,2.2,false,{anchor:p.mesh,localOffset});
    }
    this.stats.shots+=2;this.sound('gun');
  }
  updateAimTarget(){
    this.aimAssist.select(this.player,this.enemies,this.bulletSpeed,(start,end)=>{
      if(this.ships.intersectBomb(start,end,null))return true;
      // The same low island silhouette used by aircraft collisions.
      for(let i=0;i<=12;i++){const t=i/12,y=start.y+(end.y-start.y)*t;if(y>8)continue;const x=start.x+(end.x-start.x)*t,z=start.z+(end.z-start.z)*t;if(y<0||((x+420)/130)**2+((z-140)/92)**2<1)return true;}
      return false;
    },this.game.aimSettings?.assisted??true);
  }
  makeBomb(){
    const root=new THREE.Group(),body=new THREE.Mesh(this.bombGeometry,this.bombMaterial);root.add(body);
    for(let i=0;i<2;i++){const fin=new THREE.Mesh(this.bombFinGeometry,this.bombMaterial);fin.position.z=-.9;fin.rotation.z=i*Math.PI/2;root.add(fin);}
    const band=new THREE.Mesh(this.bombBandGeometry,this.bombBandMaterial);band.position.z=.35;root.add(band);return root;
  }
  mountBombs(){
    const p=this.player;p.racks=[];
    for(let i=0;i<p.maxBombs;i++){const mesh=this.makeBomb();mesh.position.set(i%2?2.25:-2.25,-1.1,.65-Math.floor(i/2)*.95);p.mesh.add(mesh);p.racks.push(mesh);}
  }
  syncBombRacks(){const p=this.player;for(let i=0;i<p.racks.length;i++)p.racks[i].visible=i>=p.maxBombs-p.bombs;}
  releasePoint(){
    const p=this.player,index=Math.min(p.maxBombs-1,p.maxBombs-p.bombs),local=p.racks[index].position.clone();local.y-=.45;
    return local.applyQuaternion(p.mesh.quaternion).add(p.mesh.position);
  }
  dropBomb(){
    const p=this.player;if(p.bombs<=0){this.notify('炸弹耗尽 · 飞越友舰青色补给圈装填');return false;}
    if(p.bombClock>0||p.hp<=0||this.bombs.length>=CONFIG.maxBombs)return false;
    const position=this.releasePoint();p.bombs--;p.bombClock=.45;p.bombFlash=.65;this.syncBombRacks();
    const mesh=this.makeBomb();mesh.position.copy(position);mesh.quaternion.copy(p.mesh.quaternion);this.scene.add(mesh);
    this.bombs.push({mesh,previous:mesh.position.clone(),velocity:p.velocity.clone(),life:18,age:0});
    this.stats.bombsDropped++;this.sound('bomb');this.notify(`炸弹已释放 · 剩余 ${p.bombs} 枚`);return true;
  }
  predictBomb(){
    const p=this.player,ground=this.target?this.target.mesh.position.y+this.target.deckHeight:0;
    const origin=this.releasePoint();const h=Math.max(0,origin.y-ground),vy=p.velocity.y;
    const t=(vy+Math.sqrt(vy*vy+2*CONFIG.gravity*h))/CONFIG.gravity;
    this.bombImpact.copy(origin).addScaledVector(p.velocity,t);this.bombImpact.y=ground+.8;
    const s=this.target;this.bombOnTarget=false;
    if(s){const future=s.mesh.position.clone().add(new THREE.Vector3(Math.sin(s.heading)*s.speed*t,0,Math.cos(s.heading)*s.speed*t));const dx=this.bombImpact.x-future.x,dz=this.bombImpact.z-future.z;this.bombOnTarget=Math.abs(dx*Math.cos(s.heading)-dz*Math.sin(s.heading))<s.width*.55&&Math.abs(dx*Math.sin(s.heading)+dz*Math.cos(s.heading))<s.length*.5;}
  }
  updatePlayer(dt,time,keys,input){
    const p=this.player,pos=p.mesh.position;p.previous.copy(pos);
    p.rollCooldown=Math.max(0,p.rollCooldown-dt);p.bombClock=Math.max(0,p.bombClock-dt);p.gunClock=Math.max(0,p.gunClock-dt);p.damageFlash=Math.max(0,p.damageFlash-dt*1.7);p.gunKick=Math.max(0,p.gunKick-dt*11);p.bombFlash=Math.max(0,p.bombFlash-dt);
    p.throttle=clamp(p.throttle+((keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0))*dt*.45,0,1);
    const boosting=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&p.boost>.02;
    p.boosting=boosting;
    p.boost=clamp(p.boost+(boosting?-.25:.12)*dt,0,1);
    const speedTarget=57+p.throttle*55+(boosting?40:0)-Math.sin(p.pitch)*15;
    p.speed=THREE.MathUtils.damp(p.speed,speedTarget,1.6,dt);
    const {turn,pitch,neutralPitch}=updateControls(p,keys,input,dt);
    // 低速转弯半径小；高速突防更快，但转弯能力下降。
    const agility=clamp(94/p.speed,.65,1.35)*(PLAYER_AIRCRAFT[this.selectedType]?.agility || 1);
    const shooting=input.fire||keys.has('KeyF');
    const aim = input.aim?.consume(dt) || { x: 0, y: 0 };
    const aimGain=(this.game.aimSettings?.touchSensitivity??.8)*(shooting?.65:1);
    aim.x*=aimGain;aim.y*=aimGain;
    const gyro = input.gyro?.consume() || { x: 0, y: 0 };
    // 高速俯冲保留足够的升降舵响应，避免拉杆后仍长时间扎向海面。
    const pitchAgility=clamp(94/p.speed,HANDLING.pitchMinAgility,1.35)*(PLAYER_AIRCRAFT[this.selectedType]?.agility || 1);
    const axis=Math.max(Math.abs(input.x||0),Math.abs(input.y||0));
    // Mouse position is a flight stick. While firing, a stationary cursor can hand over
    // to tracking; moving it or holding the outer edge keeps full manual steering.
    const mouseSteering=Number.isFinite(input.mouseSteerTime);
    const steering=input.joystickActive||!mouseSteering?axis>.06:axis>.85||input.mouseSteerTime>0;
    if(mouseSteering)input.mouseSteerTime=Math.max(0,input.mouseSteerTime-dt);
    const manual=steering||['KeyA','KeyD','ArrowUp','ArrowDown','KeyQ','KeyE'].some(key=>keys.has(key))||Math.hypot(aim.x,aim.y)>.00001||Math.hypot(gyro.x,gyro.y)>.0001||p.rollRemaining>0;
    this.updateAimTarget();
    const tracking=this.aimAssist.steer(p,dt,{enabled:this.game.aimSettings?.assisted??true,shooting,manual,agility,pitchAgility});
    if(tracking){p.turnInput=0;p.pitchInput=0;}
    p.heading+=tracking?tracking.heading:turn*HANDLING.turnRate*agility*dt+aim.x+gyro.x;
    p.pitch=clamp(p.pitch+(tracking?tracking.pitch:pitch*HANDLING.pitchRate*pitchAgility*dt+aim.y+gyro.y),-1.32,1.32);
    if(neutralPitch && !shooting && !input.aim?.active && !input.gyro?.controlling && Math.abs(aim.y)<.000001)p.pitch=THREE.MathUtils.damp(p.pitch,0,HANDLING.levelAssist,dt);
    p.hitConfirm=Math.max(0,(p.hitConfirm || 0)-dt);
    const manualRoll=(keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0);
    const bankTurn=tracking?tracking.heading/Math.max(.0001,HANDLING.turnRate*agility*dt):turn;
    if(manualRoll)p.bank+=manualRoll*2.9*dt;else p.bank=THREE.MathUtils.damp(p.bank,-bankTurn*.9,HANDLING.bankResponse,dt);
    p.bank=Math.atan2(Math.sin(p.bank),Math.cos(p.bank));
    p.heading-=Math.sin(p.bank)*Math.abs(manualRoll)*.45*dt;
    p.forward.set(Math.sin(p.heading)*Math.cos(p.pitch),Math.sin(p.pitch),Math.cos(p.heading)*Math.cos(p.pitch));
    p.velocity.copy(p.forward).multiplyScalar(p.speed);pos.addScaledVector(p.velocity,dt);
    let roll=p.bank;
    if(p.rollRemaining>0){
      p.rollRemaining=Math.max(0,p.rollRemaining-dt);const phase=(1-p.rollRemaining/1.15)*Math.PI*2;
      const side=new THREE.Vector3(Math.cos(p.heading),0,-Math.sin(p.heading));
      const offset=side.multiplyScalar(Math.sin(phase)*13*p.rollDirection);offset.y=(1-Math.cos(phase))*10;
      const change=offset.clone().sub(p.rollOffset);pos.add(change);p.velocity.addScaledVector(change,1/dt);p.rollOffset.copy(offset);roll+=phase*p.rollDirection;
      if(p.rollRemaining===0)p.rollOffset.set(0,0,0);
    }
    p.mesh.quaternion.setFromUnitVectors(FRONT,p.forward);p.mesh.rotateZ(roll);
    for(const prop of p.propellers)prop.rotation[prop.userData.spinAxis]+=dt*(65+p.speed*.5);
    if(shooting)this.fire();
    p.smokeClock+=dt;if(p.hp<40&&p.smokeClock>.09){p.smokeClock=0;this.particles.emit(pos,'smoke',2);}
    const ocean=this.game.sceneManager.getWaveHeight(pos.x,pos.z,time);
    const island=Math.pow((pos.x+420)/130,2)+Math.pow((pos.z-140)/92,2)<1;
    if(pos.y<(island?8:ocean+2))this.damagePlayer(PILOT.hp,island?'撞上中途岛地面 · 提前拉起':'坠海 · 注意高度并提前拉起');
    // 自机也检测所有舰体，不能穿过甲板或舰桥。
    const collided=this.ships.intersectBomb(p.previous,pos,null);
    if(collided)this.damagePlayer(PILOT.hp,`撞上${collided.name} · 投弹后立即拉起`);
    const out=Math.hypot(pos.x,pos.z)>PILOT.worldRadius;
    this.boundaryClock=out?this.boundaryClock+dt:0;
    if(this.boundaryClock>9)this.damagePlayer(PILOT.hp,'飞离战区 · 按边界警告及时返航');
    this.updateDiveSafety(ocean);
    if(!this.diveSafety.level)this.warning=out?`飞离战区 · ${Math.max(0,Math.ceil(9-this.boundaryClock))} 秒内掉头`:pos.y<35?'高度危险 · 拉起！':'';
    if(pos.y>750){p.pitch=Math.min(p.pitch,-.12);this.warning='接近升限 · 降低高度';}
  }
  updateDiveSafety(ocean=0){
    const safety=this.diveSafety=diveSafety(this.player,this.selectedType,this.ships.ships,ocean,this.diveSafety?.level||0);
    const rounded=n=>Math.ceil(n/5)*5;
    this.warning=safety.level===3?`高度不足 · 全力拉升！\n满杆极限约 ${rounded(safety.limit)} m`
      :safety.level===2?`WARNING · 立即拉升！\n满杆极限约 ${rounded(safety.limit)} m`
      :safety.level===1?`注意高度 · 准备拉升\n建议 ${rounded(safety.pullUp)} m 前拉升`:'';
  }
  updateEnemies(dt,time){
    const p=this.player;
    if(time>=this.nextWave){this.nextWave=time+PILOT.waveInterval;const home=this.ships.ships.find(s=>s.team==='jp'&&s.carrier&&s.alive);if(home){for(let i=0;i<4;i++)this.spawnEnemy(home.mesh.position.clone().add(new THREE.Vector3((i-1.5)*65,150+i*25,-80)),Math.PI,i?'d3a':'zero');this.notify('敌舰放出拦截机 · 注意后方');}}
    let playerHunters=0;
    for(const enemy of this.enemies){
      const allies=this.allies.filter(a=>a.hp>0);
      const huntPlayer=(enemy.id%3===0||!allies.length)&&playerHunters<3;
      if(huntPlayer)playerHunters++;
      const victim=huntPlayer?p:allies.sort((a,b)=>a.mesh.position.distanceToSquared(enemy.mesh.position)-b.mesh.position.distanceToSquared(enemy.mesh.position))[0]||p;
      enemy.targetIsPlayer=victim===p;
      enemy.hitFlash=Math.max(0,enemy.hitFlash-dt);enemy.previous.copy(enemy.mesh.position);enemy.age+=dt;enemy.clock-=dt;enemy.escape=Math.max(0,enemy.escape-dt);
      const distance=enemy.mesh.position.distanceTo(victim.mesh.position);
      if(distance<65&&enemy.escape===0)enemy.escape=3.5;
      const aim=victim.mesh.position.clone().addScaledVector(victim.velocity,clamp(distance/380,0,.9));
      if(enemy.escape>0){aim.copy(enemy.mesh.position).addScaledVector(enemy.forward,160);aim.y=210+Math.sin(enemy.id)*60;}
      const desired=aim.sub(enemy.mesh.position).normalize();
      const angle=enemy.forward.angleTo(desired);const blend=Math.min(1,.83*dt/Math.max(.001,angle));
      const q=new THREE.Quaternion().setFromUnitVectors(enemy.forward,desired);q.slerp(new THREE.Quaternion(),1-blend);enemy.forward.applyQuaternion(q).normalize();
      enemy.velocity.copy(enemy.forward).multiplyScalar(76+Math.sin(enemy.id)*8);enemy.mesh.position.addScaledVector(enemy.velocity,dt);
      enemy.mesh.quaternion.setFromUnitVectors(FRONT,enemy.forward);enemy.mesh.rotateZ(clamp((desired.x*enemy.forward.z-desired.z*enemy.forward.x)*-2,-1,1));
      for(const prop of enemy.propellers)prop.rotation[prop.userData.spinAxis]+=dt*90;
      const toPlayer=victim.mesh.position.clone().sub(enemy.mesh.position).normalize();
      if(distance<480&&enemy.forward.dot(toPlayer)>.93&&enemy.clock<=0&&enemy.age>2&&(victim!==p||huntPlayer)){
        enemy.clock=.55+this.random()*.22;
        const lead=victim.mesh.position.clone().addScaledVector(victim.velocity,distance/340*.65);
        lead.add(new THREE.Vector3((this.random()-.5)*14,(this.random()-.5)*12+4.905*(distance/340)**2,(this.random()-.5)*14));
        const velocity=lead.sub(enemy.mesh.position).normalize().multiplyScalar(340);
        this.addProjectile(enemy.mesh.position.clone().addScaledVector(enemy.forward,8),velocity,'jp',PILOT.enemyDamage,2.5,false,{inheritVelocity:enemy.velocity});
        this.sound('enemyGun',enemy.mesh.position,{id:enemy.id});
      }
      if(victim===p&&distance<230&&enemy.forward.dot(toPlayer)>.85&&p.forward.dot(toPlayer)>.2&&!this.warning)this.warning='敌机咬尾 · 转弯 / 桶滚 / 加力脱离';
      if(sweptDistance(p.previous,p.mesh.position,enemy.previous,enemy.mesh.position)<7){this.damagePlayer(55,'与敌机相撞');enemy.hp=0;}
      if(enemy.mesh.position.y<5||enemy.mesh.position.length()>5200)enemy.hp=0;
    }
  }
  updateAA(dt,time){
    const p=this.player;
    for(const ship of this.ships.ships){
      if(ship.team!=='jp'||!ship.alive)continue;
      ship.aaClock-=dt;ship.flakClock-=dt;
      const origin=ship.mesh.position.clone().add(new THREE.Vector3(0,ship.deckHeight+4,0));
      const distance=origin.distanceTo(p.mesh.position);
      if(distance<PILOT.aaRange&&ship.aaClock<=0){
        ship.aaClock=ship.type==='destroyer'?.48:.92;
        // 舰炮开火时只预测一次，之后不再追踪玩家；变向会脱离弹道。
        const aim=p.mesh.position.clone().addScaledVector(p.velocity,distance/240*.85);
        aim.add(new THREE.Vector3((this.random()-.5)*20,(this.random()-.5)*16+6.5*(distance/240)**2,(this.random()-.5)*20));
        this.addProjectile(origin,aim.sub(origin).normalize().multiplyScalar(240),'jp',PILOT.aaDamage,3.5,true);
        this.sound('aa',origin);
        if(!this.warning)this.warning='进入舰队防空区 · 变向突防';
      }
      if(distance<650&&p.mesh.position.y>80&&ship.flakClock<=0){
        ship.flakClock=4.8+this.random()*2;
        if(this.flak.length>=12)continue;
        const point=p.mesh.position.clone().addScaledVector(p.velocity,.95);point.y=Math.max(45,point.y);
        const mesh=new THREE.Mesh(this.flakGeometry,this.flakMaterial);mesh.position.copy(point);mesh.scale.setScalar(PILOT.flakRadius);this.scene.add(mesh);
        this.flak.push({mesh,delay:1.2,life:.32,exploded:false});
        // 延时引信弹沿实际抛物线升空，到预警位置时才爆炸。
        const shellVelocity=point.clone().sub(origin).divideScalar(1.2);shellVelocity.y+=.5*13*1.2;
        this.addProjectile(origin,shellVelocity,'jp',0,1.2,true,{visualOnly:true});
        this.sound('aa',origin);
      }
    }
    for(let i=this.flak.length-1;i>=0;i--){const f=this.flak[i];f.delay-=dt;
      if(f.delay>0){f.mesh.quaternion.copy(this.game.sceneManager.camera.quaternion);f.mesh.scale.setScalar(PILOT.flakRadius*(.85+Math.sin(time*18)*.08));if(f.mesh.position.distanceTo(p.mesh.position)<160&&!this.warning)this.warning='高射炮预警 · 离开橙色破片圈';}
      else{
        if(!f.exploded){f.exploded=true;f.mesh.visible=false;this.effect(f.mesh.position,'flak',1.3);this.sound('flak',f.mesh.position);const d=f.mesh.position.distanceTo(p.mesh.position);if(d<95)p.damageFlash=Math.max(p.damageFlash,.14*(1-d/95));}
        if(!f.hit&&sweptDistance(p.previous,p.mesh.position,f.mesh.position,f.mesh.position)<PILOT.flakRadius){f.hit=true;this.damagePlayer(22,'被高射炮破片击落 · 预警后改变航向');}
        f.life-=dt;if(f.life<=0){this.scene.remove(f.mesh);this.flak.splice(i,1);}
      }
    }
  }
  updateProjectiles(dt){
    const p=this.player;
    for(let i=this.projectiles.length-1;i>=0;i--){
      const b=this.projectiles[i];b.previous.copy(b.position);b.position.addScaledVector(b.velocity,dt);b.position.y-=.5*b.gravity*dt*dt;b.velocity.y-=b.gravity*dt;b.life-=dt;b.age+=dt;
      if(b.visualOnly){ /* 引信弹伤害由对应破片云统一处理，不能重复命中。 */ }else if(b.team==='us'){
        for(const enemy of this.enemies){if(enemy.hp<=0)continue;if(sweptDistance(b.previous,b.position,enemy.previous,enemy.mesh.position)<6){enemy.hp=Math.max(0,enemy.hp-b.damage);enemy.hitFlash=.3;enemy.lastHitBy=b.owner;b.life=0;if(b.owner==='player'){this.stats.hits++;p.hitConfirm=.18;}this.effect(b.position,'impact',.55,enemy.velocity);if(b.owner==='player')this.sound('confirm',b.position);break;}}
      }else{
        for(const ally of this.allies){if(ally.hp>0&&sweptDistance(b.previous,b.position,ally.previous,ally.mesh.position)<4.5){ally.hp=Math.max(0,ally.hp-b.damage);ally.hitFlash=.3;b.life=0;this.effect(b.position,'impact',.4,ally.velocity);break;}}
        const distance=b.life>0?sweptDistance(b.previous,b.position,p.previous,p.mesh.position):Infinity;
        if(distance<3.4){this.damagePlayer(b.damage,b.flak?'被舰队防空击落 · 切勿保持直线':'被敌机击落 · 尝试变向和加力');b.life=0;}
        else if(distance<22&&!b.near){b.near=true;this.stats.dodges++;p.score+=5;this.sound('whiz',b.position,{speed:b.velocity.length()});}
      }
      if(b.position.y<0&&b.flak){this.effect(b.position,'splash',.45);this.sound('splash',b.position);}
      if(b.life<=0||b.position.y<0)this.projectiles.splice(i,1);
    }
    for(let i=this.enemies.length-1;i>=0;i--){const e=this.enemies[i];if(e.hp<=0){this.effect(e.mesh.position,'explosion',1.35,e.velocity);this.scene.remove(e.mesh);this.enemies.splice(i,1);if(e.lastHitBy==='player'){p.kills++;p.score+=250;this.stats.kills++;this.notify('敌机击落 +250');}else if(e.lastHitBy==='ally')this.stats.alliedKills++;this.sound('explosion',e.mesh.position);}}
    this.airWing.removeDestroyed();
    for(let i=this.bombs.length-1;i>=0;i--){
      const b=this.bombs[i];b.previous.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.velocity,dt);b.mesh.position.y-=.5*CONFIG.gravity*dt*dt;b.velocity.y-=CONFIG.gravity*dt;b.life-=dt;b.age+=dt;
      b.mesh.quaternion.setFromUnitVectors(FRONT,b.velocity.clone().normalize());
      const hit=this.ships.intersectBomb(b.previous,b.mesh.position,'us');
      const island=Math.pow((b.mesh.position.x+420)/130,2)+Math.pow((b.mesh.position.z-140)/92,2)<1;
      if(hit||b.mesh.position.y<(island?5:0)||b.life<=0){
        if(hit){this.ships.damage(hit,PILOT.bombDamage,'航空炸弹');this.stats.bombHits++;p.score+=hit.alive?400:1000;const impact=hit.mesh.position.clone();impact.y+=hit.deckHeight+1;this.effect(impact,'ship',hit.alive?1.5:2.1);this.sound('explosion',impact,{heavy:true});hit.fireClock=0;}
        else{this.effect(b.mesh.position,island?'explosion':'splash',1.2);this.sound(island?'explosion':'splash',b.mesh.position);}
        this.scene.remove(b.mesh);this.bombs.splice(i,1);
      }
    }
    // 弹道光带由 CombatEffects 直接读取弹体，避免重复构建旧线段。
  }
  updateSupply(dt){
    const p=this.player,home=this.ships.ships.find(s=>s.id==='yorktown'&&s.alive);
    this.supplyCooldown=Math.max(0,this.supplyCooldown-dt);
    if(!home){this.supplyRing.visible=false;return;}
    this.supplyRing.position.copy(home.mesh.position);this.supplyRing.position.y=3;
    const pos=p.mesh.position,inside=Math.hypot(pos.x-home.mesh.position.x,pos.z-home.mesh.position.z)<180&&pos.y>40&&pos.y<180;
    const need=p.bombs<p.maxBombs||p.hp<p.maxHp;
    this.resupplyProgress=inside&&need&&this.supplyCooldown===0?this.resupplyProgress+dt:0;
    if(this.resupplyProgress>=2){p.bombs=p.maxBombs;p.hp=Math.min(p.maxHp,p.hp+45);p.boost=1;this.resupplyProgress=0;this.supplyCooldown=18;this.syncBombRacks();this.notify('补给完成 · 炸弹装满 / 修复45 / 加力恢复');this.sound('supply');}
    if(inside&&need&&this.supplyCooldown===0&&!this.diveSafety.level)this.warning=`友舰补给中 · 保持高度 40–180 m`;
  }
  update(dt,time,keys,input){
    this.updatePlayer(dt,time,keys,input);if(this.player.hp<=0)return;
    this.airWing.update(dt,time);this.updateEnemies(dt,time);this.updateAA(dt,time);this.updateProjectiles(dt);this.updateSupply(dt);this.predictBomb();this.updateAimTarget();
    for(const s of this.ships.ships){if(s.hp<s.maxHp*.6&&(s.alive||s.sinking<12)){s.fireClock=(s.fireClock||0)-dt;if(s.fireClock<=0){s.fireClock=.38;const fire=s.mesh.position.clone();fire.y+=s.deckHeight+1;this.effect(fire,'fire',s.carrier?1.2:.7);}}}
  }
}
