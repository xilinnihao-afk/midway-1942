import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..'), context = vm.createContext({ console });
fs.mkdirSync(path.join(root,'artifacts/auto-aim-20261020'),{recursive:true});
const modules = new Map();
for (const folder of ['js', 'vendor']) for (const file of fs.readdirSync(path.join(root, folder))) {
  if (file.endsWith('.js')) { const id = `${folder}/${file}`; modules.set(id, new vm.SourceTextModule(fs.readFileSync(path.join(root, id), 'utf8'), { context, identifier: id })); }
}
await modules.get('js/FlightManager.js').link((spec, parent) => modules.get(spec === 'three' ? 'vendor/three.module.js' : path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier), spec))));
await modules.get('js/FlightManager.js').evaluate();
const THREE = modules.get('vendor/three.module.js').namespace;
const { AimAssist, AIM, intercept, aimSettings } = modules.get('js/AimAssist.js').namespace;
const { updateControls } = modules.get('js/FlightControls.js').namespace;
const { FlightManager } = modules.get('js/FlightManager.js').namespace;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function target(x = 0, y = 150, z = 400) { const mesh = new THREE.Group(); mesh.position.set(x, y, z); return { mesh, hp: 72, maxHp: 72, velocity: v(), previous: mesh.position.clone() }; }
function shooter() { const mesh = new THREE.Group(); mesh.position.set(0, 150, 0); return { mesh, velocity: v(0, 0, 88), forward: v(0, 0, 1) }; }
function fixture(assisted = true) {
  const game = { aimSettings: aimSettings({ assisted }), input: {}, ui: { notify() {} }, particles: { emit() {} }, effects: { clear() {}, burst() {}, muzzle() {} }, sceneManager: { scene: new THREE.Scene(), getWaveHeight: () => 0 }, assets: { clone: () => new THREE.Group(), cloneLow: () => new THREE.Group() }, shipManager: { ships: [], intersectBomb: () => null } };
  const flight = new FlightManager(game); game.flight = flight;
  for (const e of flight.enemies) flight.scene.remove(e.mesh);
  flight.enemies = []; flight.airWing.clear();
  return { game, flight, player: flight.player };
}

test('sensible defaults, user overrides and invalid preference recovery', () => {
  assert.deepEqual({ ...aimSettings() }, { assisted: true, touchSensitivity: .8, mouseSensitivity: .85 });
  assert.deepEqual({ ...aimSettings({ assisted: false, touchSensitivity: 99, mouseSensitivity: NaN }) }, { assisted: false, touchSensitivity: 1.5, mouseSensitivity: .85 });
});
test('intercept accounts for target movement, inherited velocity and gravity', () => {
  const p = shooter(), e = target(30, 180, 400); e.velocity.set(45, -3, -25);
  const shot = intercept(p.mesh.position, p.velocity, e);
  assert.ok(shot && shot.time < 2.2);
  const bullet = p.mesh.position.clone().addScaledVector(shot.direction, 440 * shot.time).addScaledVector(p.velocity, shot.time);
  bullet.y -= .5 * AIM.gravity * shot.time * shot.time;
  const future = e.mesh.position.clone().addScaledVector(e.velocity, shot.time);
  assert.ok(bullet.distanceTo(future) < .001, 'projectile misses the displayed intercept');
  e.velocity.set(0, 0, 700); assert.equal(intercept(p.mesh.position, p.velocity, e), null);
});
test('selection rejects allies, dead/hidden/occluded/behind/distant aircraft', () => {
  const p = shooter(), assist = new AimAssist();
  for (const invalid of [Object.assign(target(), { hp: 0 }), Object.assign(target(), { team: 'us' }), target(0, 150, -200), target(0, 150, 900)]) assert.equal(assist.select(p, [invalid], 440), null);
  const hidden = target(); hidden.mesh.visible = false; assert.equal(assist.select(p, [hidden], 440), null);
  assert.equal(assist.select(p, [target()], 440, () => true), null);
});
test('target retention avoids flicker while deliberate retargeting and death release work', () => {
  const p = shooter(), assist = new AimAssist(), a = target(15), b = target(18);
  assert.equal(assist.select(p, [a, b], 440).target, a);
  b.mesh.position.x = 14; assert.equal(assist.select(p, [a, b], 440).target, a);
  a.mesh.position.x = 70; b.mesh.position.x = 0; assert.equal(assist.select(p, [a, b], 440).target, b);
  b.hp = 0; assert.equal(assist.select(p, [a, b], 440).target, a);
  assist.clear(); assert.equal(assist.target, null);
});
test('assistance is capped at 2.5 degrees and can be fully disabled', () => {
  const p = shooter(), e = target(8), assist = new AimAssist(); assist.select(p, [e], 440);
  const corrected = assist.shotDirection(p, p.mesh.position, 440, true);
  assert.ok(corrected.angleTo(p.forward) > .001 && corrected.angleTo(p.forward) <= AIM.assistCone);
  assert.ok(assist.shotDirection(p, p.mesh.position, 440, false).equals(p.forward));
  e.mesh.position.x = 50; assist.select(p, [e], 440); assert.ok(assist.shotDirection(p, p.mesh.position, 440, true).equals(p.forward));
});
test('firing steadies mouse/joystick center while full input and keyboard retain authority', () => {
  const run = (input, keys = new Set()) => { const p = {}; for (let i = 0; i < 60; i++) updateControls(p, keys, input, 1 / 60); return p; };
  for (const joystickActive of [false, true]) {
    const normal = run({ x: .2, y: .2, joystickActive }), firing = run({ x: .2, y: .2, fire: true, joystickActive });
    assert.ok(Math.abs(firing.turnInput) < Math.abs(normal.turnInput) * .7 && Math.abs(firing.pitchInput) < Math.abs(normal.pitchInput) * .7);
    const full = run({ x: 1, y: -1, joystickActive }), fullFire = run({ x: 1, y: -1, fire: true, joystickActive });
    near(full.turnInput, fullFire.turnInput); near(full.pitchInput, fullFire.pitchInput);
  }
  const keys = new Set(['KeyA', 'ArrowUp']);
  const a = run({ x: .2, y: .2, mouseSensitivity: .5, fire: true }, keys), b = run({ x: .2, y: .2 }, keys);
  near(a.turnInput, b.turnInput); near(a.pitchInput, b.pitchInput);
});
test('touch fire gain is gentler, firing holds pitch, and release restores leveling', () => {
  const normal = fixture(), firing = fixture();
  for (const [entry, fire] of [[normal, false], [firing, true]]) entry.flight.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire, aim: { active: true, consume: () => ({ x: .02, y: .02 }) } });
  near(firing.player.heading / normal.player.heading, .65); near(firing.player.pitch / normal.player.pitch, .65);
  const held = firing.player.pitch;
  for (let i = 0; i < 20; i++) firing.flight.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true });
  near(firing.player.pitch, held);
  for (let i = 0; i < 20; i++) firing.flight.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: false });
  assert.ok(firing.player.pitch < held);
});

const tolerances = [];
test('real twin muzzle projectiles improve near-miss tolerance without changing hitboxes', () => {
  for (const errorDegrees of [0, .75, 1.5, 2, 3, 4]) {
    const row = { errorDegrees };
    for (const assisted of [false, true]) {
      const { flight: f, player: p } = fixture(assisted);
      f.spawnEnemy(p.mesh.position.clone().add(v(0, 10, 400)), Math.PI);
      const e = f.enemies[0]; e.velocity.set(30, 0, -20);
      const shot = intercept(p.mesh.position, p.velocity, e, f.bulletSpeed);
      p.forward.copy(shot.direction).applyAxisAngle(v(0, 1, 0), errorDegrees * Math.PI / 180);
      p.mesh.quaternion.setFromUnitVectors(v(0, 0, 1), p.forward);
      f.fire(); assert.equal(f.stats.shots, 2);
      const launch = f.projectiles.map(b => ({ x: b.velocity.x, z: b.velocity.z }));
      for (let i = 0; i < 120; i++) { e.previous.copy(e.mesh.position); e.mesh.position.addScaledVector(e.velocity, 1 / 60); f.updateProjectiles(1 / 60); if (i === 0) f.projectiles.forEach((b, j) => { near(b.velocity.x, launch[j].x); near(b.velocity.z, launch[j].z); }); }
      row[assisted ? 'assistedHits' : 'manualHits'] = f.stats.hits;
    }
    tolerances.push(row);
  }
  fs.writeFileSync(path.join(root, 'artifacts/auto-aim-20261020/shot-tolerance.json'), JSON.stringify({ scenario: '400m crossing target, fixed angular aiming error, real two-muzzle projectile simulation; not a human playtest', hitRadiusMetres: 6, trials: tolerances }, null, 2));
  assert.ok(tolerances.find(r => r.errorDegrees === 1.5).manualHits < 2);
  assert.equal(tolerances.find(r => r.errorDegrees === 1.5).assistedHits, 2);
  for (const row of tolerances.filter(r => r.errorDegrees >= 3)) assert.equal(row.assistedHits, row.manualHits);
});
test('full disable fires exactly along the aircraft direction and never alters gyro deltas', () => {
  const { game, flight, player } = fixture(false); game.aimSettings.touchSensitivity = 1;
  flight.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, gyro: { controlling: true, consume: () => ({ x: .015, y: .02 }) } });
  near(player.heading, .015); near(player.pitch, .02);
  flight.fire(); for (const bullet of flight.projectiles) assert.ok(bullet.velocity.clone().sub(player.velocity).normalize().distanceTo(player.forward) < 1e-9);
});

const autoMetrics = { scenario: 'Deterministic simulations using real flight, muzzle, projectile and collision code; no manual aim or direct damage.' };
test('60 seconds of held fire has no thermal pauses and stays within the projectile budget', () => {
  const { flight: f, player: p } = fixture();
  const seconds = []; let previous = 0, lastShot = 0, maxGap = 0, peak = 0;
  // A safe level circle keeps the real aircraft in bounds for a full minute.
  for (let frame = 0; frame < 3600; frame++) {
    const before = f.stats.shots;
    f.updatePlayer(1 / 60, frame / 60, new Set(['KeyA']), { x: 0, y: 0, fire: true });
    f.updateProjectiles(1 / 60); peak = Math.max(peak, f.projectiles.length);
    if (f.stats.shots > before) { maxGap = Math.max(maxGap, (frame - lastShot) / 60); lastShot = frame; }
    if ((frame + 1) % 60 === 0) { seconds.push(f.stats.shots - previous); previous = f.stats.shots; }
  }
  assert.ok(p.hp > 0); assert.ok(seconds.every(n => n >= 18)); assert.ok(maxGap <= .101); assert.ok(peak < 320);
  assert.equal('heat' in p, false); assert.equal('overheated' in p, false);
  autoMetrics.continuousFire = { seconds: 60, shots: f.stats.shots, minShotsPerSecond: Math.min(...seconds), maxGapSeconds: maxGap, peakProjectiles: peak };
  const stopped = f.stats.shots;
  for (let i = 0; i < 60; i++) f.updatePlayer(1 / 60, 60, new Set(), { x: 0, y: 0, fire: false });
  assert.equal(f.stats.shots, stopped);
  p.hp = 0; p.gunClock = 0; f.fire(); assert.equal(f.stats.shots, stopped);
});

function holdFireScenario(assisted, degrees, input = { x: 0, y: 0, fire: true }, hz = 60) {
  const { flight: f, player: p } = fixture(assisted);
  const angle = degrees * Math.PI / 180;
  f.spawnEnemy(p.mesh.position.clone().add(v(Math.sin(angle) * 400, 20, Math.cos(angle) * 400)), Math.PI);
  const enemy = f.enemies[0]; enemy.velocity.set(22, 2, -45);
  let elapsed = 0;
  for (let i = 0; i < 4 * hz; i++) {
    f.updatePlayer(1 / hz, i / hz, new Set(), input);
    enemy.previous.copy(enemy.mesh.position); enemy.mesh.position.addScaledVector(enemy.velocity, 1 / hz);
    f.updateProjectiles(1 / hz); elapsed = (i + 1) / hz;
    if (f.stats.kills) break;
  }
  return { kills: f.stats.kills, hits: f.stats.hits, shots: f.stats.shots, seconds: elapsed, heading: p.heading };
}
test('holding fire alone tracks and kills moving targets well outside the old correction cone', () => {
  autoMetrics.tracking = [];
  for (const degrees of [-25, 15, 30]) {
    const manual = holdFireScenario(false, degrees), assisted = holdFireScenario(true, degrees);
    assert.equal(manual.kills, 0); assert.equal(assisted.kills, 1); assert.ok(assisted.seconds < 2.5);
    autoMetrics.tracking.push({ degrees, manual, assisted });
  }
});
test('stationary touch fire and off-center mouse both acquire; moving mouse and full edge take over', () => {
  const touch = holdFireScenario(true, 25, { x: 0, y: 0, fire: true, aim: { active: true, consume: () => ({ x: 0, y: 0 }) } });
  const mouse = holdFireScenario(true, 25, { x: .5, y: -.2, fire: true, mouseSteerTime: 0 });
  assert.equal(touch.kills, 1); assert.equal(mouse.kills, 1);
  for (const input of [{ x: .4, y: 0, fire: true, mouseSteerTime: .12 }, { x: 1, y: 0, fire: true, mouseSteerTime: 0 }]) {
    const { flight: f, player: p } = fixture();
    f.spawnEnemy(p.mesh.position.clone().add(v(100, 10, 400)), 0);
    f.updatePlayer(1 / 60, 0, new Set(), input);
    assert.equal(f.aimAssist.tracking, false); assert.ok(p.heading < 0);
  }
});
test('manual stick, touch, gyro, keyboard and evade immediately suppress tracking then release cleanly', () => {
  const inputs = [
    { input: { x: 1, y: 0, fire: true, joystickActive: true } },
    { input: { x: 0, y: 0, fire: true, aim: { consume: () => ({ x: -.02, y: 0 }) } } },
    { input: { x: 0, y: 0, fire: true, gyro: { controlling: true, consume: () => ({ x: -.02, y: 0 }) } } },
    { input: { x: 0, y: 0, fire: true }, keys: new Set(['KeyD']) },
    { input: { x: 0, y: 0, fire: true }, evade: true }
  ];
  for (const scenario of inputs) {
    const { flight: f, player: p } = fixture();
    f.spawnEnemy(p.mesh.position.clone().add(v(100, 10, 400)), 0);
    f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true }); assert.ok(f.aimAssist.tracking);
    const before = p.heading; if (scenario.evade) f.evade();
    f.updatePlayer(1 / 60, 0, scenario.keys || new Set(), scenario.input);
    assert.equal(f.aimAssist.tracking, false);
    if (!scenario.evade) assert.ok(p.heading < before, 'tracking opposed a manual left turn');
    assert.ok(f.aimAssist.manualRemaining > 0);
    // Releasing the trigger resets override state; next press may acquire afresh.
    f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: false });
    assert.equal(f.aimAssist.tracking, false); assert.equal(f.aimAssist.manualRemaining, 0);
  }
  const { game, flight: f, player: p } = fixture();
  f.spawnEnemy(p.mesh.position.clone().add(v(100, 10, 400)), 0);
  f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true });
  f.updatePlayer(1 / 60, 0, new Set(), { x: .2, y: 0, fire: true });
  for (let i = 0; i < 10; i++) f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true });
  assert.equal(f.aimAssist.tracking, false, 'reacquired during manual grace');
  for (let i = 0; i < 20; i++) f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true });
  assert.equal(f.aimAssist.tracking, true);
  game.aimSettings.assisted = false;
  const heading = p.heading;
  f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true });
  assert.equal(f.aimAssist.tracking, false); near(p.heading, heading);
});
test('acquisition and retention cones are bounded; destroyed and blocked targets are released', () => {
  const p = shooter(), assist = new AimAssist();
  const atAngle = degrees => target(Math.sin(degrees * Math.PI / 180) * 400, 150, Math.cos(degrees * Math.PI / 180) * 400);
  const a = atAngle(30), b = atAngle(-32);
  assert.equal(assist.select(p, [atAngle(50), target(0, 150, -200)], 440), null);
  assert.equal(assist.select(p, [a, b], 440).target, a);
  assist.tracking = true; a.mesh.position.copy(atAngle(43).mesh.position);
  assert.equal(assist.select(p, [a], 440).target, a);
  a.hp = 0; assert.equal(assist.select(p, [a, b], 440).target, b);
  assert.equal(assist.select(p, [b], 440, () => true), null); assert.equal(assist.tracking, false);
  assert.equal(assist.select(p, [b], 440, () => false, false), null);
});
test('real kills automatically switch to the next forward target without releasing fire', () => {
  const { flight: f, player: p } = fixture();
  for (const offset of [v(110, 15, 400), v(-110, 30, 500)]) f.spawnEnemy(p.mesh.position.clone().add(offset), 0);
  for (const enemy of f.enemies) enemy.velocity.set(0, 0, 20);
  const seen = new Set(); let elapsed = 0;
  for (let frame = 0; frame < 300; frame++) {
    f.updatePlayer(1 / 60, frame / 60, new Set(), { x: 0, y: 0, fire: true });
    if (f.aimAssist.tracking) seen.add(f.aimAssist.target.id);
    for (const e of f.enemies) { e.previous.copy(e.mesh.position); e.mesh.position.addScaledVector(e.velocity, 1 / 60); }
    f.updateProjectiles(1 / 60); elapsed = (frame + 1) / 60;
    if (f.stats.kills === 2) break;
  }
  assert.equal(f.stats.kills, 2); assert.equal(seen.size, 2);
  autoMetrics.switching = { kills: f.stats.kills, acquiredTargets: seen.size, seconds: elapsed };
});
test('tracking response is stable across frame rates and respects low altitude and short passes', () => {
  const outcomes = [30, 60, 120].map(hz => ({ hz, ...holdFireScenario(true, 25, { x: 0, y: 0, fire: true }, hz) }));
  assert.ok(outcomes.every(o => o.kills === 1));
  assert.ok(Math.max(...outcomes.map(o => o.seconds)) - Math.min(...outcomes.map(o => o.seconds)) < .25);
  const settle = hz => {
    const p = shooter(); Object.assign(p, { heading: 0, pitch: 0, hp: 100 }); const assist = new AimAssist();
    assist.select(p, [target(100, 180, 400)], 440);
    for (let i = 0; i < hz / 2; i++) { const d = assist.steer(p, 1 / hz, { enabled: true, shooting: true, manual: false }); p.heading += d.heading; p.pitch += d.pitch; }
    return p;
  };
  const a = settle(30), b = settle(120); near(a.heading, b.heading, .003); near(a.pitch, b.pitch, .003);
  for (const [altitude, distance] of [[30, 200], [150, 40]]) {
    const { flight: f, player: p } = fixture(); p.mesh.position.y = altitude;
    f.spawnEnemy(p.mesh.position.clone().add(v(10, 0, distance)), 0);
    f.updatePlayer(1 / 60, 0, new Set(), { x: 0, y: 0, fire: true }); assert.equal(f.aimAssist.tracking, false);
  }
  autoMetrics.frameRates = outcomes;
  fs.writeFileSync(path.join(root, 'artifacts/auto-aim-20261020/automatic-fire-metrics.json'), JSON.stringify(autoMetrics, null, 2));
});
