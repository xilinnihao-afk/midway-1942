import * as THREE from 'three';
import { HANDLING } from './config.js';
import { shapeControl } from './FlightControls.js';
// Invert the current public input curve, including user sensitivity and firing precision.
// The bot still sends ordinary stick/trigger input through the same flight simulation.
const stickForRate=(value,axis,input,shooting)=>{const wanted=Math.min(1,Math.abs(value));if(wanted<1e-5)return 0;let lo=0,hi=1;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(shapeControl(mid,axis,input,shooting)<wanted)lo=mid;else hi=mid;}return Math.sign(value)*(lo+hi)/2;};
/** 调参用驾驶机器人：只输出与真人相同的转向/油门/投弹意图，不改血量、不传送。 */
export function pilotPlaytest(game,mode='strike'){
  game.shipManager.reset();game.flight.reset('sbd');game.particles.clear();game.time=0;game.state='playing';
  const f=game.flight,p=f.player,dt=1/60;let firstHit=null,closestBomb=9999,strikeTarget=null;
  for(let frame=0;frame<60*180&&game.state==='playing';frame++){
    game.keys.clear();game.input.x=0;game.input.y=0;game.input.fire=false;
    if(mode==='dogfight'){
      const enemy=f.enemies.filter(e=>e.hp>0).sort((a,b)=>a.mesh.position.distanceToSquared(p.mesh.position)-b.mesh.position.distanceToSquared(p.mesh.position))[0];
      if(enemy){
        const range=enemy.mesh.position.distanceTo(p.mesh.position);
        const lead=enemy.mesh.position.clone().addScaledVector(enemy.velocity.clone().sub(p.velocity),range/f.bulletSpeed);
        const direction=lead.sub(p.mesh.position).normalize();
        const heading=Math.atan2(direction.x,direction.z),diff=Math.atan2(Math.sin(heading-p.heading),Math.cos(heading-p.heading));
        const pitch=Math.asin(direction.y);
        const firing=p.forward.dot(direction)>.985&&range<600;
        game.input.x=-stickForRate(diff*3/HANDLING.turnRate,'turn',game.input,firing);
        game.input.y=-stickForRate((pitch-p.pitch)*3/HANDLING.pitchRate,'pitch',game.input,firing);
        if(Math.abs(diff)>.5)game.keys.add('KeyS');else game.keys.add('KeyW');
        game.input.fire=firing;
      }
      if(f.stats.kills>=2)break;
    }
    if(mode==='strike'){
      const ships=game.shipManager.ships.filter(s=>s.team==='jp'&&s.carrier&&s.alive);
      if(!strikeTarget?.alive)strikeTarget=ships.sort((a,b)=>a.mesh.position.distanceToSquared(p.mesh.position)-b.mesh.position.distanceToSquared(p.mesh.position))[0];
      const target=strikeTarget;
      if(target){
        game.shipManager.setTarget(target.id);
        const t=(p.velocity.y+Math.sqrt(p.velocity.y*p.velocity.y+2*25*Math.max(0,p.mesh.position.y-target.deckHeight)))/25;
        const aim=target.mesh.position.clone().add(new THREE.Vector3(Math.sin(target.heading)*target.speed*t,0,Math.cos(target.heading)*target.speed*t));
        const dx=aim.x-p.mesh.position.x,dz=aim.z-p.mesh.position.z;
        const desired=Math.atan2(dx,dz),diff=Math.atan2(Math.sin(desired-p.heading),Math.cos(desired-p.heading));
        game.input.x=-stickForRate(diff*2.5/HANDLING.turnRate,'turn',game.input,true);
        const altitude=65;
        const pitch=THREE.MathUtils.clamp((altitude-p.mesh.position.y)*.013,-.5,.5);
        game.input.y=-stickForRate((pitch-p.pitch)*3/HANDLING.pitchRate,'pitch',game.input,true);
        if(Math.abs(diff)>.45)game.keys.add('KeyS');else game.keys.add('KeyW');
        f.predictBomb();
        closestBomb=Math.min(closestBomb,Math.hypot(f.bombImpact.x-aim.x,f.bombImpact.z-aim.z));
        // 在途炸弹也计入预计火力，避免连续把全部挂弹浪费在同一艘航母。
        if(f.bombOnTarget&&Math.hypot(f.bombImpact.x-aim.x,f.bombImpact.z-aim.z)<38&&f.bombs.length<Math.ceil(target.hp/600))game.dropBomb();
        if(p.rollCooldown===0&&!f.bombOnTarget&&Math.abs(diff)>.7&&f.projectiles.some(b=>b.team==='jp'&&b.position.distanceTo(p.mesh.position)<100))game.evade();
      }
      game.input.fire=true;
    }
    game.step(dt);if(f.stats.bombHits&&!firstHit)firstHit=game.time;
  }
  return {mode,state:game.state,seconds:+game.time.toFixed(2),hp:p.hp,score:p.score,stats:{...f.stats},remainingCarriers:game.shipManager.ships.filter(s=>s.team==='jp'&&s.carrier&&s.alive).length,firstHit,closestBomb};
}
