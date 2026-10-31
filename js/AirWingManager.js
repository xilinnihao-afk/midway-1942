import * as THREE from 'three';
import { PILOT } from './config.js';
const FRONT=new THREE.Vector3(0,0,1);
/** 友方僚机真正追击/开火/受击，和玩家共享弹道系统；不自动代投炸弹。 */
export class AirWingManager {
  constructor(flight){this.flight=flight;this.allies=[];}
  clear(){for(const p of this.allies)this.flight.scene.remove(p.mesh);this.allies=[];}
  reset(){
    this.clear();this.nextReinforcement=38;
    for(let i=0;i<PILOT.maxAllies;i++)this.spawn(new THREE.Vector3((i%2?1:-1)*(38+Math.floor(i/2)*42),150+Math.floor(i/2)*22,-860+Math.floor(i/2)*110),i);
  }
  spawn(position,index=0){
    if(this.allies.length>=PILOT.maxAllies)return;
    const model=this.flight.createPlane(index%2?'spitfire':'f4f',true);model.mesh.position.copy(position);
    this.allies.push({...model,id:++this.flight.serial,hp:105,maxHp:105,hitFlash:0,forward:FRONT.clone(),velocity:new THREE.Vector3(0,0,90),previous:position.clone(),clock:.4+index*.3,escape:0});
  }
  update(dt,time){
    const f=this.flight;
    if(time>this.nextReinforcement){this.nextReinforcement=time+38;if(this.allies.length<PILOT.maxAllies){const home=f.ships.ships.find(s=>s.team==='us'&&s.carrier&&s.alive);if(home){this.spawn(home.mesh.position.clone().add(new THREE.Vector3(-25,100,30)),this.allies.length);f.notify('友方僚机抵达 · 支援空战');}}}
    for(const ally of this.allies){
      ally.hitFlash=Math.max(0,ally.hitFlash-dt);ally.previous.copy(ally.mesh.position);ally.clock-=dt;ally.escape=Math.max(0,ally.escape-dt);
      const target=f.enemies.filter(e=>e.hp>0).sort((a,b)=>a.mesh.position.distanceToSquared(ally.mesh.position)-b.mesh.position.distanceToSquared(ally.mesh.position))[0];
      let aim;
      if(target){const range=ally.mesh.position.distanceTo(target.mesh.position);aim=target.mesh.position.clone().addScaledVector(target.velocity,Math.min(.7,range/440));if(range<65&&ally.escape===0)ally.escape=2.6;}
      else{const p=f.player.mesh.position;aim=new THREE.Vector3(p.x+Math.sin(time*.25+ally.id)*190,p.y+30,p.z+Math.cos(time*.25+ally.id)*190);}
      if(ally.escape>0){aim.copy(ally.mesh.position).addScaledVector(ally.forward,200);aim.y=180+(ally.id%3)*35;}
      const desired=aim.sub(ally.mesh.position).normalize(),angle=ally.forward.angleTo(desired);
      const q=new THREE.Quaternion().setFromUnitVectors(ally.forward,desired);q.slerp(new THREE.Quaternion(),1-Math.min(1,.94*dt/Math.max(angle,.001)));ally.forward.applyQuaternion(q).normalize();
      ally.velocity.copy(ally.forward).multiplyScalar(86+(ally.id%3)*4);ally.mesh.position.addScaledVector(ally.velocity,dt);ally.mesh.quaternion.setFromUnitVectors(FRONT,ally.forward);ally.mesh.rotateZ(THREE.MathUtils.clamp((desired.x*ally.forward.z-desired.z*ally.forward.x)*-2,-.9,.9));
      for(const prop of ally.propellers)prop.rotation[prop.userData.spinAxis]+=90*dt;
      if(target&&ally.clock<=0){const range=ally.mesh.position.distanceTo(target.mesh.position),direction=target.mesh.position.clone().sub(ally.mesh.position).normalize();if(range<520&&ally.forward.dot(direction)>.976){
        ally.clock=.31+f.random()*.12;const aim=target.mesh.position.clone().addScaledVector(target.velocity,range/450);aim.y+=4.905*(range/450)**2;
        const offset=new THREE.Vector3(1.8,0,1.6),origin=offset.clone().applyQuaternion(ally.mesh.quaternion).add(ally.mesh.position);
        f.addProjectile(origin,aim.sub(origin).normalize().multiplyScalar(450),'us',8,2.2,false,{owner:'ally',inheritVelocity:ally.velocity,anchor:ally.mesh,localOffset:offset});f.sound('enemyGun',origin,{id:ally.id});
      }}
      if(ally.mesh.position.y<8||ally.mesh.position.length()>4800)ally.hp=0;
    }
  }
  removeDestroyed(){
    const f=this.flight;for(let i=this.allies.length-1;i>=0;i--){const a=this.allies[i];if(a.hp>0)continue;f.effect(a.mesh.position,'explosion',1,a.velocity);f.sound('explosion',a.mesh.position);f.scene.remove(a.mesh);this.allies.splice(i,1);}
  }
}
