import * as THREE from 'three';

export const AIM = { range: 750, markerCone: 24 * Math.PI / 180, acquireCone: 38 * Math.PI / 180, retainCone: 48 * Math.PI / 180, assistCone: 2.5 * Math.PI / 180, maxTime: 2.2, gravity: 9.81, response: 14, turnRate: 1.5, pitchRate: 1.2, manualGrace: .35 };
export function aimSettings(value) {
  const s = value && typeof value === 'object' ? value : {};
  const gain = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(.5, Math.min(1.5, value)) : fallback;
  return { assisted: s.assisted !== false, touchSensitivity: gain(s.touchSensitivity, .8), mouseSensitivity: gain(s.mouseSensitivity, .85) };
}

/** Same launch velocity, inherited aircraft velocity, gravity and lifetime as real bullets. */
export function intercept(origin, shooterVelocity, target, speed = 440) {
  const relative = target.mesh.position.clone().sub(origin), velocity = target.velocity.clone().sub(shooterVelocity);
  const a = velocity.lengthSq() - speed * speed, b = 2 * relative.dot(velocity), c = relative.lengthSq();
  if (!Number.isFinite(c) || c < .0001 || speed <= 0) return null;
  let time;
  if (Math.abs(a) < .0001) { if (b >= 0) return null; time = -c / b; }
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter(t => t > 0);
    if (!roots.length) return null;
    time = Math.min(...roots);
  }
  // Refine intercept time including gravity; Newton's method stays near the physical low arc.
  const travel = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    travel.copy(relative).addScaledVector(velocity, time); travel.y += .5 * AIM.gravity * time * time;
    const derivative = velocity.clone(); derivative.y += AIM.gravity * time;
    const denominator = 2 * travel.dot(derivative) - 2 * speed * speed * time;
    if (Math.abs(denominator) < .0001) break;
    time -= (travel.lengthSq() - speed * speed * time * time) / denominator;
  }
  if (!Number.isFinite(time) || time <= 0 || time > AIM.maxTime) return null;
  travel.copy(relative).addScaledVector(velocity, time); travel.y += .5 * AIM.gravity * time * time;
  if (Math.abs(travel.length() - speed * time) > .25) return null;
  return { direction: travel.normalize(), time, range: Math.sqrt(c) };
}

/** Hold fire to turn the aircraft toward a physical intercept. Manual input always wins. */
export class AimAssist {
  target = null;
  solution = null;
  tracking = false;
  manualRemaining = 0;
  stopTracking() { this.tracking = false; this.manualRemaining = 0; }
  clear() { this.target = null; this.solution = null; this.stopTracking(); }
  select(player, enemies, speed, blocked = () => false, assisted = true) {
    let best = null, retained = null;
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.team === 'us' || !enemy.mesh || enemy.mesh.visible === false) continue;
      if (enemy.mesh.position.distanceToSquared(player.mesh.position) > AIM.range * AIM.range) continue;
      const shot = intercept(player.mesh.position, player.velocity, enemy, speed);
      if (!shot) continue;
      shot.angle = player.forward.angleTo(shot.direction); shot.target = enemy;
      const cone = assisted ? (this.tracking && enemy === this.target ? AIM.retainCone : AIM.acquireCone) : AIM.markerCone;
      // Acquisition follows the visible aircraft bearing. A crossing target's lead
      // can lie beyond it because bullets also inherit our own forward velocity.
      const bearing = player.forward.angleTo(enemy.mesh.position.clone().sub(player.mesh.position));
      if ((assisted ? bearing : shot.angle) > cone || shot.angle > Math.PI / 2 || blocked(player.mesh.position, enemy.mesh.position)) continue;
      if (!best || shot.angle < best.angle) best = shot;
      if (enemy === this.target) retained = shot;
    }
    // Keep the current target through small crossings, but yield to a clearly better shot.
    if (retained && best && best.target !== retained.target && !(best.angle <= AIM.assistCone * .75 && retained.angle > AIM.assistCone) && best.angle + .025 >= retained.angle * .7) best = retained;
    this.solution = best; this.target = best?.target ?? null;
    if (!best) this.tracking = false;
    return best;
  }
  steer(player, dt, { enabled, shooting, manual, agility = 1, pitchAgility = 1 }) {
    this.tracking = false;
    if (!enabled || !shooting || player.hp <= 0) { this.stopTracking(); return null; }
    this.manualRemaining = manual ? AIM.manualGrace : Math.max(0, this.manualRemaining - dt);
    const shot = this.solution;
    // Leave close passes, low-altitude recovery and evasive rolls entirely to the pilot.
    if (this.manualRemaining > 0 || player.rollRemaining > 0 || !shot || shot.target.hp <= 0 || shot.range < 55 || player.mesh.position.y < 45 || shot.target.mesh.position.y < 25) return null;
    const yaw = Math.atan2(shot.direction.x, shot.direction.z) - player.heading;
    const pitch = Math.asin(THREE.MathUtils.clamp(shot.direction.y, -1, 1)) - player.pitch;
    const blend = 1 - Math.exp(-AIM.response * dt);
    this.tracking = true;
    return {
      heading: THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * blend, -AIM.turnRate * agility * dt, AIM.turnRate * agility * dt),
      pitch: THREE.MathUtils.clamp(pitch * blend, -AIM.pitchRate * pitchAgility * dt, AIM.pitchRate * pitchAgility * dt)
    };
  }
  shotDirection(player, origin, speed, assisted) {
    if (!assisted || !this.target || this.target.hp <= 0) return player.forward.clone();
    const shot = intercept(origin, player.velocity, this.target, speed);
    if (!shot || shot.range > AIM.range || player.forward.angleTo(shot.direction) > AIM.assistCone) return player.forward.clone();
    return shot.direction;
  }
}
