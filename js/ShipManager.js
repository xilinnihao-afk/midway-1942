import * as THREE from 'three';
import { CONFIG, FLEET, SHIP_TYPES, MODEL_IMPORTS } from './config.js';
import { waveHeight } from './SceneManager.js';

/** 舰队状态唯一所有者：输入→运动→避碰→伤害/沉没。视觉模型不参与精确碰撞。 */
export class ShipManager {
  constructor(scene, assets, particles, notify, getWaveHeight = waveHeight) {
    this.getWaveHeight = getWaveHeight;
    Object.assign(this, { scene, assets, particles, notify });
    this.ships = [];
    this.selectedId = 'yorktown'; this.targetId = 'akagi';
    this.wakePoint = new THREE.Vector3();
    this.selection = this.createRing(0x7ff5e2);
    this.targetRing = this.createRing(0xff9767);
    this.reset();
  }
  createRing(color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(23, 24, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; this.scene.add(ring); return ring;
  }
  get selected() { return this.ships.find(s => s.id === this.selectedId); }
  get target() { return this.ships.find(s => s.id === this.targetId && s.alive); }
  reset() {
    for (const s of this.ships) this.scene.remove(s.mesh);
    this.selectedId = 'yorktown'; this.targetId = 'akagi';
    this.ships = FLEET.map((entry, index) => {
      const stats = SHIP_TYPES[entry.type];
      const model = this.assets.clone(entry.type);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(stats.length / size.z);
      const mesh = new THREE.Group();
      const visual = new THREE.LOD();
      visual.addLevel(model, 0);
      if (model.userData.importedSource) {
        const low = this.assets.cloneLow(entry.type);
        const lowSize = new THREE.Box3().setFromObject(low).getSize(new THREE.Vector3());
        low.scale.setScalar(stats.length / lowSize.z);
        visual.addLevel(low, innerWidth < 700 ? 450 : 650, .12);
      }
      mesh.add(visual); mesh.position.set(entry.x, 0, entry.z); mesh.rotation.y = entry.heading;
      mesh.userData.shipId = entry.id;
      this.scene.add(mesh);
      return { ...stats, ...entry, name: entry.name || stats.name, mesh, hp: stats.hp, maxHp: stats.hp, maxSpeed: stats.speed,
        deckHeight: model.userData.deckHeight ? model.userData.deckHeight * stats.length / (MODEL_IMPORTS[entry.type]?.length || 100) : 10,
        speed: 0, throttle: 0, radius: stats.width * .6, cooldown: 0, alive: true, sinking: 0,
        nextLaunch: CONFIG.ai.firstLaunchDelay + index * 1.5, salvo: 0, wakeClock: 0, smokeClock: 0, aaClock: 0 };
    });
  }
  select(id) { const ship = this.ships.find(s => s.id === id && s.team === 'us' && s.alive); if (ship) this.selectedId = id; }
  setTarget(id) { if (this.ships.some(s => s.id === id && s.team === 'jp' && s.alive)) this.targetId = id; }
  nearestEnemy(position, team, carriersFirst = false) {
    let choices = this.ships.filter(s => s.alive && s.team !== team);
    if (carriersFirst && choices.some(s => s.carrier)) choices = choices.filter(s => s.carrier);
    return choices.sort((a, b) => a.mesh.position.distanceToSquared(position) - b.mesh.position.distanceToSquared(position))[0];
  }
  damage(ship, amount, source = '炸弹') {
    if (!ship?.alive) return;
    ship.hp = Math.max(0, ship.hp - amount);
    this.particles.emit(ship.mesh.position.clone().add(new THREE.Vector3(0, ship.deckHeight + 1, 0)), 'explosion', 32);
    this.notify(`${ship.name} 遭${source}命中 −${Math.round(amount)}`);
    if (!ship.hp) {
      ship.alive = false; ship.throttle = 0; ship.speed = 0;
      this.notify(`${ship.name} 被击沉`);
      if (this.selectedId === ship.id) this.selectedId = this.ships.find(s => s.team === 'us' && s.alive)?.id;
      if (this.targetId === ship.id) this.targetId = this.nearestEnemy(ship.mesh.position, 'us', true)?.id;
    }
  }
  update(dt, time, keys) {
    for (const ship of this.ships) {
      if (!ship.alive) {
        ship.sinking += dt;
        ship.mesh.position.y = -ship.sinking * 1.4;
        ship.mesh.rotation.z = Math.min(.65, ship.sinking * .018);
        ship.mesh.rotation.x = Math.min(.2, ship.sinking * .006);
        ship.mesh.visible = ship.sinking < 32;
        continue;
      }
      if (ship === this.selected) {
        if (keys.has('KeyW')) ship.throttle = Math.min(1, ship.throttle + dt * .6);
        if (keys.has('KeyS')) ship.throttle = Math.max(-.35, ship.throttle - dt * .9);
        const turn = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
        ship.heading += turn * dt * .35 * (.3 + Math.abs(ship.speed) / ship.maxSpeed);
      }
      if (ship.team === 'jp') {
        const patrolX = ship.x + Math.sin(time * .025) * 85;
        const patrolZ = ship.z + Math.cos(time * .025) * 70;
        const angle = Math.atan2(patrolX - ship.mesh.position.x, patrolZ - ship.mesh.position.z);
        const delta = Math.atan2(Math.sin(angle - ship.heading), Math.cos(angle - ship.heading));
        ship.heading += THREE.MathUtils.clamp(delta, -dt * .16, dt * .16);
        ship.throttle = CONFIG.ai.patrolSpeed / ship.maxSpeed;
      }
      ship.speed = THREE.MathUtils.damp(ship.speed, ship.throttle * ship.maxSpeed, .5, dt);
      const p = ship.mesh.position;
      p.x += Math.sin(ship.heading) * ship.speed * dt;
      p.z += Math.cos(ship.heading) * ship.speed * dt;
      // 岛礁和战场边界为可预测的软约束，不允许舰船驶上跑道。
      const islandDistance = Math.hypot(p.x + 420, p.z - 140);
      if (islandDistance < 175 + ship.length * .35) {
        const ratio = (175 + ship.length * .35) / Math.max(islandDistance, .01);
        p.x = -420 + (p.x + 420) * ratio; p.z = 140 + (p.z - 140) * ratio;
        ship.speed *= .95;
      }
      p.x = THREE.MathUtils.clamp(p.x, -CONFIG.worldLimit, CONFIG.worldLimit);
      p.z = THREE.MathUtils.clamp(p.z, -CONFIG.worldLimit, CONFIG.worldLimit);
      const h = this.getWaveHeight(p.x, p.z, time);
      p.y = THREE.MathUtils.damp(p.y, h, 3, dt);
      ship.mesh.rotation.set(Math.sin(time * .85 + ship.x) * .009, ship.heading, Math.sin(time * .65 + ship.z) * .014);
      ship.cooldown = Math.max(0, ship.cooldown - dt);
      ship.wakeClock += dt;
      if (Math.abs(ship.speed) > 1 && ship.wakeClock > .12) {
        ship.wakeClock = 0;
        this.wakePoint.set(p.x - Math.sin(ship.heading) * ship.length * .46, .8, p.z - Math.cos(ship.heading) * ship.length * .46);
        this.particles.emit(this.wakePoint, 'wake', 3);
      }
      ship.smokeClock += dt;
      if (ship.hp < ship.maxHp * .55 && ship.smokeClock > .2) { ship.smokeClock = 0; this.particles.emit(p.clone().add(new THREE.Vector3(0, 10, 0)), 'smoke', 2); }
    }
    // 保守圆形避让，仅用于舰船相互推离；炸弹使用下方独立 OBB 扫掠测试。
    for (let i = 0; i < this.ships.length; i++) for (let j = i + 1; j < this.ships.length; j++) {
      const a = this.ships[i], b = this.ships[j]; if (!a.alive || !b.alive) continue;
      const dx = a.mesh.position.x - b.mesh.position.x, dz = a.mesh.position.z - b.mesh.position.z;
      const d = Math.hypot(dx, dz), min = (a.length + b.length) * .29;
      if (d < min && d > .001) {
        const push = (min - d) * .5;
        a.mesh.position.x += dx / d * push; a.mesh.position.z += dz / d * push;
        b.mesh.position.x -= dx / d * push; b.mesh.position.z -= dz / d * push;
      }
    }
    this.updateRing(this.selection, this.selected);
    this.updateRing(this.targetRing, this.target);
  }
  updateRing(ring, ship) {
    ring.visible = !!ship?.alive;
    if (ship?.alive) { ring.position.copy(ship.mesh.position); ring.position.y = 2; ring.scale.set(ship.width / 35 + .5, ship.length / 43, 1); ring.rotation.set(-Math.PI / 2, 0, ship.heading); }
  }
  /** 线段变到舰船局部坐标再 slab 检测，避免高速炸弹穿透甲板。返回最近命中。 */
  intersectBomb(start, end, attackingTeam) {
    let closest = null, nearestT = Infinity;
    for (const ship of this.ships) {
      if (!ship.alive || ship.team === attackingTeam) continue;
      const p = ship.mesh.position, c = Math.cos(ship.heading), s = Math.sin(ship.heading);
      const local = v => [(v.x-p.x)*c-(v.z-p.z)*s, v.y-p.y, (v.x-p.x)*s+(v.z-p.z)*c];
      const a = local(start), b = local(end);
      const lo = [-ship.width*.55, -4, -ship.length*.5], hi = [ship.width*.55, ship.deckHeight + 1, ship.length*.5];
      let enter = 0, leave = 1, hit = true;
      for (let axis = 0; axis < 3; axis++) {
        const direction = b[axis]-a[axis];
        if (Math.abs(direction) < 1e-8) { if (a[axis]<lo[axis] || a[axis]>hi[axis]) hit=false; }
        else { const t1=(lo[axis]-a[axis])/direction, t2=(hi[axis]-a[axis])/direction; enter=Math.max(enter,Math.min(t1,t2)); leave=Math.min(leave,Math.max(t1,t2)); }
      }
      if (hit && enter<=leave && enter<nearestT) { closest=ship; nearestT=enter; }
    }
    return closest;
  }
}
