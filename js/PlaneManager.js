import * as THREE from 'three';
import { CONFIG, AIRCRAFT_LABELS } from './config.js';

export class PlaneManager {
  constructor(scene, assets, ships, particles, notify) {
    Object.assign(this, { scene, assets, ships, particles, notify });
    this.planes = []; this.bombs = []; this.serial = 0;
    this.bombGeometry = new THREE.SphereGeometry(1, 7, 5);
    this.bombMaterial = new THREE.MeshStandardMaterial({ color: 0x252d32, metalness: .7, roughness: .4 });
    this.forward = new THREE.Vector3(0, 0, 1);
    this.rotationMatrix = new THREE.Matrix4();
    this.aim = new THREE.Vector3();
    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerPositions = new Float32Array(CONFIG.maxPlanes * 6 + 8 * 6);
    this.tracerGeometry.setAttribute('position', new THREE.BufferAttribute(this.tracerPositions, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeometry, new THREE.LineBasicMaterial({ color: 0xffdb86, transparent: true, opacity: .7 }));
    this.tracers.frustumCulled = false; scene.add(this.tracers);
    this.stats = { launchedUS: 0, launchedJP: 0, bombsDropped: 0, hits: 0, planesLost: 0 };
  }
  clear() {
    for (const p of this.planes) this.scene.remove(p.mesh);
    for (const b of this.bombs) this.scene.remove(b.mesh);
    this.planes.length = 0; this.bombs.length = 0; this.serial = 0;
    this.tracerGeometry.setDrawRange(0, 0);
    this.stats = { launchedUS: 0, launchedJP: 0, bombsDropped: 0, hits: 0, planesLost: 0 };
  }
  launch(ship, type = 'sbd') {
    if (!ship?.alive || !ship.carrier) { this.notify('请选择一艘可用航母'); return false; }
    if (ship.cooldown > 0) { this.notify(`甲板准备中 · ${Math.ceil(ship.cooldown)} 秒`); return false; }
    const ownCount = this.planes.filter(p => p.team === ship.team).length;
    // 为敌我分别预留一半预算，防止玩家占满槽位导致 AI 无法反击。
    if (ownCount + CONFIG.flight.squadSize > CONFIG.maxPlanes / 2) { this.notify('在空编队已达上限，等待返航'); return false; }
    const fighter = type === 'f4f' || type === 'zero';
    for (let i = 0; i < CONFIG.flight.squadSize; i++) {
      const mesh = new THREE.Group();
      const visual = new THREE.LOD(); const high = this.assets.clone(type);
      visual.addLevel(high, 0); visual.addLevel(this.assets.cloneLow(type), innerWidth < 700 ? 300 : 550, .15);
      mesh.add(visual);
      const propellers = []; high.traverse(node => { if (node.userData.spinAxis) propellers.push(node); });
      mesh.position.copy(ship.mesh.position);
      mesh.position.y = ship.mesh.position.y + ship.deckHeight + 1.5;
      mesh.position.z -= i * 9 * Math.cos(ship.heading);
      mesh.position.x -= i * 9 * Math.sin(ship.heading);
      mesh.rotation.y = ship.heading;
      this.scene.add(mesh);
      this.planes.push({ propellers, id: ++this.serial, mesh, type, team: ship.team, homeId: ship.id, fighter, hp: fighter ? 115 : 90,
        state: 'takeoff', age: -i * .45, attackAge: 0, spent: false,
        velocity: new THREE.Vector3(Math.sin(ship.heading), .12, Math.cos(ship.heading)),
        targetId: ship.team === 'us' ? this.ships.targetId : null, formation: i - 1, smokeClock: 0 });
    }
    ship.cooldown = CONFIG.flight.cooldown;
    this.stats[ship.team === 'us' ? 'launchedUS' : 'launchedJP'] += CONFIG.flight.squadSize;
    this.notify(`${ship.name}：${AIRCRAFT_LABELS[type] || type}编队起飞`);
    return true;
  }
  update(dt, time) {
    let lineCount = 0;
    const trace = (a, b) => {
      if (lineCount * 6 + 6 > this.tracerPositions.length) return;
      this.tracerPositions.set([a.x,a.y,a.z,b.x,b.y,b.z], lineCount++ * 6);
    };
    // AI 先探测，再根据本轮次选择护航战斗机或舰爆，不依赖镜头距离。
    for (const ship of this.ships.ships) {
      if (!ship.alive || !ship.carrier || ship.team !== 'jp' || time < ship.nextLaunch) continue;
      const target = this.ships.nearestEnemy(ship.mesh.position, ship.team, true);
      if (target && target.mesh.position.distanceTo(ship.mesh.position) <= CONFIG.ai.detectionRange) {
        const type = ship.salvo % 3 === 2 ? 'zero' : 'd3a';
        if (this.launch(ship, type)) { ship.salvo++; ship.nextLaunch = time + CONFIG.ai.launchInterval; }
        else ship.nextLaunch = time + 3;
      }
    }
    for (const plane of this.planes) {
      plane.age += dt;
      if (plane.age < 0 || plane.hp <= 0) continue;
      const pos = plane.mesh.position;
      for (const prop of plane.propellers) prop.rotation[prop.userData.spinAxis] += dt * 75;
      const home = this.ships.ships.find(s => s.id === plane.homeId && s.alive) || this.ships.ships.find(s => s.team === plane.team && s.carrier && s.alive);
      let target = this.ships.ships.find(s => s.id === plane.targetId && s.alive) || this.ships.nearestEnemy(pos, plane.team, true);
      if (plane.state === 'takeoff' && plane.age > 2.2) plane.state = 'attack';
      let speed = plane.fighter ? CONFIG.flight.fighterSpeed : CONFIG.flight.speed;
      if (plane.state === 'takeoff') {
        this.aim.copy(pos).addScaledVector(plane.velocity, 100); this.aim.y = CONFIG.flight.altitude;
        speed *= .4 + Math.min(1, plane.age / 2.2) * .6;
      } else if (plane.state === 'return') {
        if (!home) { plane.hp = 0; continue; }
        this.aim.copy(home.mesh.position); this.aim.y = 18;
        if (pos.distanceTo(this.aim) < 28) { plane.recovered = true; plane.hp = 0; continue; }
      } else if (plane.fighter) {
        const enemyPlane = this.planes.filter(p => p.team !== plane.team && p.hp > 0 && p.age > 0).sort((a,b) => a.mesh.position.distanceToSquared(pos) - b.mesh.position.distanceToSquared(pos))[0];
        if (enemyPlane) {
          this.aim.copy(enemyPlane.mesh.position);
          if (pos.distanceTo(this.aim) < 140) {
            enemyPlane.hp -= CONFIG.flight.fighterDamage * dt;
            if (Math.floor(time * 12) % 3 === 0) trace(pos, this.aim);
          }
        } else if (home) {
          this.aim.set(home.mesh.position.x + Math.sin(time*.4 + plane.formation)*160, 110 + plane.formation*12, home.mesh.position.z + Math.cos(time*.4 + plane.formation)*160);
        } else { plane.hp = 0; continue; }
        if (plane.age > 70) plane.state = 'return';
      } else if (target) {
        const distance = Math.hypot(pos.x-target.mesh.position.x, pos.z-target.mesh.position.z);
        const altitude = distance < 260 ? 53 : CONFIG.flight.altitude + plane.formation * 8;
        this.aim.copy(target.mesh.position); this.aim.y = altitude;
        const fallTime = Math.sqrt(2*Math.max(1,pos.y-target.mesh.position.y-target.deckHeight-1)/CONFIG.gravity);
        // 预测移动目标位置；投下后炸弹只受惯性与重力影响，不再追踪舰船。
        this.aim.x += Math.sin(target.heading)*target.speed*fallTime;
        this.aim.z += Math.cos(target.heading)*target.speed*fallTime;
        if (!plane.spent && distance < speed*fallTime + 6 && pos.y > 24) {
          this.dropBomb(plane, target, fallTime);
          plane.spent = true; plane.state = 'return';
        }
      } else plane.state = 'return';
      const direction = this.aim.clone().sub(pos).normalize();
      const oldHeading = Math.atan2(plane.velocity.x, plane.velocity.z);
      plane.velocity.lerp(direction, Math.min(1, dt * (plane.state === 'takeoff' ? 1.7 : 3))).normalize();
      pos.addScaledVector(plane.velocity, speed * dt);
      // +Z 为模型前向；俯仰和转弯倾斜同时呈现，避免静态模型平移感。
      plane.mesh.quaternion.setFromUnitVectors(this.forward, plane.velocity);
      const newHeading = Math.atan2(plane.velocity.x, plane.velocity.z);
      const turn = Math.atan2(Math.sin(newHeading-oldHeading),Math.cos(newHeading-oldHeading));
      plane.mesh.rotateZ(THREE.MathUtils.clamp(-turn / Math.max(dt,.001)*.35,-.65,.65));
      if (plane.age > 105 || pos.length() > 4000) { plane.recovered = true; plane.hp = 0; }
    }
    // 有效半径内舰炮防空，每舰每时刻仅攻击最近一架飞机，伤害按 dt 计算。
    for (const ship of this.ships.ships) {
      if (!ship.alive) continue;
      let nearest = null, range = CONFIG.ai.aaRange;
      for (const p of this.planes) {
        if (p.team === ship.team || p.hp <= 0 || p.age < 2) continue;
        const distance = p.mesh.position.distanceTo(ship.mesh.position);
        if (distance < range) { range = distance; nearest = p; }
      }
      if (nearest) {
        nearest.hp -= CONFIG.ai.aaDamage * dt;
        if (Math.floor(time*10) % 4 === 0) trace(ship.mesh.position.clone().add(new THREE.Vector3(0,12,0)), nearest.mesh.position);
      }
    }
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      if (p.hp > 0) continue;
      if (!p.recovered) { this.particles.emit(p.mesh.position, 'explosion', 18); this.stats.planesLost++; }
      this.scene.remove(p.mesh); this.planes.splice(i,1);
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.previous.copy(bomb.mesh.position);
      bomb.velocity.y -= CONFIG.gravity * dt;
      bomb.mesh.position.addScaledVector(bomb.velocity, dt);
      const hit = this.ships.intersectBomb(bomb.previous, bomb.mesh.position, bomb.team);
      if (hit || bomb.mesh.position.y < 0) {
        if (hit) { this.ships.damage(hit, CONFIG.flight.bombDamage); this.stats.hits++; }
        else this.particles.emit(bomb.mesh.position, 'splash', 18);
        this.scene.remove(bomb.mesh); this.bombs.splice(i,1);
      }
    }
    this.tracerGeometry.setDrawRange(0, lineCount * 2);
    this.tracerGeometry.attributes.position.needsUpdate = true;
  }
  dropBomb(plane, target, fallTime) {
    if (this.bombs.length >= CONFIG.maxBombs) return;
    const mesh = new THREE.Mesh(this.bombGeometry, this.bombMaterial);
    mesh.scale.set(.9, 2, .9); mesh.position.copy(plane.mesh.position); this.scene.add(mesh);
    const targetPos = target.mesh.position.clone();
    targetPos.x += Math.sin(target.heading)*target.speed*fallTime;
    targetPos.z += Math.cos(target.heading)*target.speed*fallTime;
    const velocity = targetPos.sub(mesh.position).divideScalar(fallTime); velocity.y = 0;
    this.bombs.push({ mesh, velocity, previous: mesh.position.clone(), team: plane.team });
    this.stats.bombsDropped++;
  }
}
