import { HANDLING, PLAYER_AIRCRAFT } from './config.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/** Predict an immediate full-stick recovery with the actual speed/elevator law.
 * Uses the slower touch response for a conservative, common cockpit indication.
 * This is an estimate, not a guarantee against manoeuvres or obstacles ahead.
 */
export function estimatePullUp(player,type='sbd'){
  let pitch=player.pitch,speed=player.speed,elevator=player.pitchInput||0,loss=0,travel=0,seconds=0;
  const dt=1/60,agility=PLAYER_AIRCRAFT[type]?.agility||1;
  const throttle=clamp(player.throttle??.55,0,1),boost=player.boosting?40:0;
  while(pitch<0&&seconds<3){
    const target=57+throttle*55+boost-Math.sin(pitch)*15;
    speed=target+(speed-target)*Math.exp(-1.6*dt);
    elevator=1+(elevator-1)*Math.exp(-HANDLING.joystick.response*dt);
    pitch=clamp(pitch+elevator*HANDLING.pitchRate*clamp(94/speed,HANDLING.pitchMinAgility,1.35)*agility*dt,-1.32,0);
    loss-=Math.sin(pitch)*speed*dt;travel+=Math.cos(pitch)*speed*dt;seconds+=dt;
  }
  return {loss,travel,seconds};
}

/** Height above the collision surfaces along the upcoming recovery corridor. */
export function recoverySurface(player,travel,ships=[],ocean=0){
  const origin=player.mesh.position,sn=Math.sin(player.heading),cs=Math.cos(player.heading);
  // Keep the game's 2 m ocean collision clearance with a small wave allowance.
  let surface=Math.max(3,ocean+2);
  const endX=origin.x+sn*travel,endZ=origin.z+cs*travel;
  // Closest point of the recovery segment to the island's collision ellipse.
  const ax=(origin.x+420)/130,az=(origin.z-140)/92;
  const dx=(endX-origin.x)/130,dz=(endZ-origin.z)/92;
  const t=clamp(-(ax*dx+az*dz)/Math.max(1e-9,dx*dx+dz*dz),0,1);
  if(Math.hypot(ax+dx*t,az+dz*t)<1.08)surface=Math.max(surface,8);
  for(const ship of ships){
    if(!ship.alive)continue;
    const c=Math.cos(ship.heading),s=Math.sin(ship.heading),p=ship.mesh.position;
    const x=(origin.x-p.x)*c-(origin.z-p.z)*s,z=(origin.x-p.x)*s+(origin.z-p.z)*c;
    const vx=(endX-origin.x)*c-(endZ-origin.z)*s,vz=(endX-origin.x)*s+(endZ-origin.z)*c;
    let enter=0,leave=1;
    for(const [value,delta,extent] of [[x,vx,ship.width*.55+5],[z,vz,ship.length*.5+5]]){
      if(Math.abs(delta)<1e-8){if(Math.abs(value)>extent){enter=2;break;}}
      else{const a=(-extent-value)/delta,b=(extent-value)/delta;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));}
    }
    if(enter<=leave)surface=Math.max(surface,p.y+ship.deckHeight+1);
  }
  return surface;
}

export function diveSafety(player,type,ships=[],ocean=0,previousLevel=0){
  const sink=Math.max(0,-Math.sin(player.pitch)*player.speed);
  if(player.hp<=0||player.pitch>-.055||sink<3)return {level:0,diving:false};
  const recovery=estimatePullUp(player,type);
  const surface=recoverySurface(player,recovery.travel+Math.cos(player.pitch)*player.speed*.8+35,ships,ocean);
  const limit=surface+recovery.loss;
  // Room for recognition and moving a thumb to full elevator, not just physics.
  const pullUp=limit+Math.max(15,sink*.8),caution=pullUp+Math.max(25,sink*.9);
  const altitude=player.mesh.position.y;
  let level=altitude<=limit?3:altitude<=pullUp?2:altitude<=caution?1:0;
  // Keep the current tier for 8 m beyond its boundary to avoid alarm chatter.
  const release=[0,caution,pullUp,limit][previousLevel];
  if(previousLevel>level&&altitude<release+8)level=previousLevel;
  return {level,diving:true,altitude,sink,limit,pullUp,caution,surface,...recovery};
}
