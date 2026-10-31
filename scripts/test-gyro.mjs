import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, fn, options) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); super.addEventListener(type, fn, options); }
  removeEventListener(type, fn, options) { this.listeners.get(type)?.delete(fn); super.removeEventListener(type, fn, options); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}
async function environment(permission) {
  let now = 0, id = 0;
  const timers = new Map(), orientation = Object.assign(new Target(), { angle: 90 });
  const win = Object.assign(new Target(), { isSecureContext: true, screen: { orientation }, DeviceMotionEvent: { requestPermission: permission }, setTimeout(fn, ms) { const key = ++id; timers.set(key, { at: now + ms, fn }); return key; }, clearTimeout(key) { timers.delete(key); } });
  const doc = Object.assign(new Target(), { hidden: false });
  const context = vm.createContext({ window: win, document: doc, performance: { now: () => now }, console });
  const module = new vm.SourceTextModule(fs.readFileSync(new URL('../js/GyroAim.js', import.meta.url), 'utf8'), { context });
  const sensor = new vm.SourceTextModule(fs.readFileSync(new URL('../js/GyroSensor.js', import.meta.url), 'utf8'), { context }); await sensor.link(() => {});
  await module.link(() => sensor); await module.evaluate();
  const advance = ms => { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } };
  const sample = (beta = 20, gamma = 0, ms = 10, stamp) => { advance(ms); const event = new Event('devicemotion'); Object.defineProperties(event, { rotationRate: { value: { beta, gamma } }, timeStamp: { value: stamp ?? now } }); win.dispatchEvent(event); };
  return { ...module.namespace, win, doc, orientation, timers, advance, sample, context, module };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const empty = gyro => { const delta = gyro.consume(); near(delta.x, 0); near(delta.y, 0); };

test('preferences default off, clamp sensitivity and never store permission', async () => {
  const { gyroSettings } = await environment();
  assert.deepEqual({ ...gyroSettings({ enabled: 'true', sensitivity: Infinity, granted: true }) }, { enabled: false, sensitivity: 1 });
  assert.deepEqual({ ...gyroSettings({ enabled: true, sensitivity: 9 }) }, { enabled: true, sensitivity: 3 });
  assert.equal(gyroSettings({ sensitivity: -1 }).sensitivity, .3);
});
test('iOS permission starts synchronously from explicit enable, not configure', async () => {
  let calls = 0; const env = await environment(async () => { calls++; return 'denied'; }); const gyro = new env.GyroAim();
  gyro.configure(true); assert.equal(calls, 0); assert.equal(gyro.status.code, 'permission');
  const pending = gyro.requestAccess(); assert.equal(calls, 1); await pending;
  assert.equal(gyro.status.code, 'denied'); assert.equal(env.win.count('devicemotion'), 0); gyro.dispose();
});
test('late permission cannot re-enable a disabled or disposed controller; listener remains single', async () => {
  let resolve; const env = await environment(() => new Promise(r => { resolve = r; })); const gyro = new env.GyroAim();
  gyro.configure(true); const first = gyro.requestAccess(); gyro.configure(false); resolve('granted'); await first;
  assert.equal(env.win.count('devicemotion'), 0);
  gyro.configure(true); const second = gyro.requestAccess(); resolve('granted'); await second; await gyro.requestAccess();
  assert.equal(env.win.count('devicemotion'), 1); gyro.dispose(); assert.equal(env.win.count('devicemotion'), 0);
  const other = new env.GyroAim(); other.configure(true); const third = other.requestAccess(); other.dispose(); resolve('granted'); await third;
  assert.equal(env.win.count('devicemotion'), 0); assert.equal(env.win.count('resize'), 0); assert.equal(env.orientation.count('change'), 0); assert.equal(env.doc.count('visibilitychange'), 0); assert.equal(env.timers.size, 0);
});
test('permission errors, insecure origins and unsupported browsers have actionable states', async () => {
  const env = await environment(async () => { throw Error('blocked'); }); const gyro = new env.GyroAim();
  gyro.configure(true); await gyro.requestAccess(); assert.equal(gyro.status.code, 'error');
  env.win.isSecureContext = false; await gyro.requestAccess(); assert.equal(gyro.status.code, 'insecure');
  env.win.isSecureContext = true; env.win.DeviceMotionEvent = undefined; await gyro.requestAccess(); assert.equal(gyro.status.code, 'unavailable'); gyro.dispose();
});
test('Android starts without prompt, null samples timeout and valid samples recover', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true); gyro.setActive(true);
  assert.equal(gyro.status.code, 'waiting'); env.sample(null, null); env.advance(2500); assert.equal(gyro.status.code, 'no-data'); assert.equal(gyro.controlling, false);
  await gyro.requestAccess(); env.sample(); assert.equal(gyro.status.code, 'ready'); assert.equal(gyro.controlling, true);
  env.advance(1501); assert.equal(gyro.status.code, 'no-data'); assert.equal(gyro.controlling, false); gyro.dispose();
});
test('portrait and both landscape orientations map screen-relative heading and pitch', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true); gyro.setActive(true);
  for (const [angle, x, y] of [[90, 30, -20], [-90, -30, 20], [0, 20, 30], [180, -20, -30]]) {
    env.orientation.angle = angle; env.orientation.dispatchEvent(new Event('change')); empty(gyro);
    env.sample(30, 20); env.sample(30, 20); const delta = gyro.consume(); near(delta.x, x * Math.PI / 180 * .01); near(delta.y, y * Math.PI / 180 * .01);
  } gyro.dispose();
});
test('30/60/120 Hz samples integrate once independently of simulation consumption', async () => {
  for (const hz of [30, 60, 120]) {
    const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true, 1.5); gyro.setActive(true); env.sample(30, 0, 0);
    let yaw = 0; for (let i = 0; i < hz * 2; i++) { env.sample(30, 0, 1000 / hz); yaw += gyro.consume().x; empty(gyro); }
    near(yaw, 60 * Math.PI / 180 * 1.5); gyro.dispose();
  }
});
test('pause, background, blur, rotation, calibration and off discard pending movement', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true); gyro.setActive(true);
  const move = () => { env.sample(); env.sample(); };
  move(); gyro.setActive(false); move(); empty(gyro); gyro.setActive(true); empty(gyro);
  move(); gyro.calibrate(); empty(gyro); move(); assert.ok(gyro.consume().x > 0);
  move(); env.doc.hidden = true; env.doc.dispatchEvent(new Event('visibilitychange')); move(); empty(gyro);
  env.doc.hidden = false; env.doc.dispatchEvent(new Event('visibilitychange')); gyro.setActive(true); empty(gyro);
  move(); env.win.dispatchEvent(new Event('blur')); empty(gyro); assert.equal(gyro.active, false);
  gyro.setActive(true); move(); env.win.dispatchEvent(new Event('resize')); empty(gyro);
  move(); gyro.configure(false); empty(gyro); assert.equal(env.win.count('devicemotion'), 0); gyro.dispose();
});
test('bad values, spikes, stale or non-monotonic timestamps never produce delayed turns', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true); gyro.setActive(true);
  for (const bad of [NaN, Infinity, null, 2000]) { env.sample(); env.sample(); env.sample(bad); empty(gyro); }
  env.sample(); env.sample(20, 0, 500); empty(gyro);
  env.sample(); env.sample(); env.advance(251); empty(gyro);
  env.sample(20, 0, 0, 1); env.sample(20, 0, 0, 1); empty(gyro);
  env.sample(20, 0, 0, 0); empty(gyro); gyro.dispose();
});
test('stationary noise is zero and rapid rotation remains bounded', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true, 3); gyro.setActive(true);
  for (let i = 0; i < 100; i++) env.sample(.1, .1); empty(gyro);
  for (let i = 0; i < 10; i++) env.sample(500, 500);
  const delta = gyro.consume(); assert.ok(Math.abs(delta.x) <= .35 && Math.abs(delta.y) <= .35); gyro.dispose();
});
test('actual UI buttons request access immediately, save preferences, disable and adjust sensitivity', async () => {
  let calls = 0; const env = await environment(async () => { calls++; return 'granted'; });
  const dom = Object.fromEntries(['gyro-settings', 'gyro-summary', 'gyro-status', 'gyro-detail', 'gyro-enable', 'gyro-disable', 'gyro-calibrate', 'gyro-sensitivity', 'gyro-sensitivity-value'].map(id => [id, Object.assign(new Target(), { dataset: {}, textContent: '', disabled: false, value: '' })]));
  let saved; env.context.localStorage = { getItem: () => null, setItem: (key, value) => { saved = JSON.parse(value); } };
  const aim = new vm.SourceTextModule(fs.readFileSync(new URL('../js/TouchAim.js', import.meta.url), 'utf8'), { context: env.context }); await aim.link(() => {});
  const assist = new vm.SourceTextModule(fs.readFileSync(new URL('../js/AimAssist.js', import.meta.url), 'utf8'), { context: env.context }); await assist.link(() => new vm.SyntheticModule([], function () {}, { context: env.context }));
  const ui = new vm.SourceTextModule(fs.readFileSync(new URL('../js/UIManager.js', import.meta.url), 'utf8'), { context: env.context });
  await ui.link(spec => spec === './AimAssist.js' ? assist : spec === './GyroAim.js' ? env.module : spec === './TouchAim.js' ? aim : new vm.SyntheticModule(spec === 'three' ? [] : ['SHIP_TYPES', 'PLAYER_AIRCRAFT'], function () { if (spec !== 'three') { this.setExport('SHIP_TYPES', {}); this.setExport('PLAYER_AIRCRAFT', {}); } }, { context: env.context })); await ui.evaluate();
  const game = { input: {} }; ui.namespace.UIManager.prototype.bindGyroControls.call({ game, dom });
  assert.equal(calls, 0); dom['gyro-enable'].dispatchEvent(new Event('click')); assert.equal(calls, 1); await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.enabled, true); assert.equal(game.input.gyro, game.gyro); env.sample(); assert.equal(dom['gyro-settings'].dataset.status, 'ready');
  dom['gyro-sensitivity'].value = '1.7'; dom['gyro-sensitivity'].dispatchEvent(new Event('input')); assert.equal(saved.sensitivity, 1.7); assert.equal(game.gyro.sensitivity, 1.7);
  dom['gyro-disable'].dispatchEvent(new Event('click')); assert.equal(saved.enabled, false); assert.equal(dom['gyro-settings'].dataset.status, 'off'); assert.equal(env.win.count('devicemotion'), 0);
  game.gyro.dispose();
});

test('both iOS permission requests start before awaiting; orientation survives motion denial', async () => {
  let motion = 0, orientation = 0, resolve;
  const env = await environment(() => { motion++; return new Promise(r => { resolve = r; }); });
  env.win.DeviceOrientationEvent = { requestPermission: () => { orientation++; return Promise.resolve('granted'); } };
  const gyro = new env.GyroAim(); gyro.configure(true); const pending = gyro.requestAccess();
  assert.equal(motion, 1); assert.equal(orientation, 1); resolve('denied'); await pending;
  assert.equal(env.win.count('devicemotion'), 0); assert.equal(env.win.count('deviceorientation'), 1);
  gyro.setActive(true);
  gyro.onOrientation({ alpha: 100, beta: 30, gamma: 0, timeStamp: 0 });
  gyro.onOrientation({ alpha: 100, beta: 32, gamma: 0, timeStamp: 20 });
  assert.ok(gyro.consume().x > 0); assert.equal(gyro.diagnostics().source, 'orientation');
  gyro.dispose(); assert.equal(env.win.count('deviceorientation'), 0);
});
test('orientation fallback preserves baseline through wraps, calibration and landscape changes', async () => {
  const env = await environment(); env.win.DeviceMotionEvent = undefined; env.win.DeviceOrientationEvent = {};
  const gyro = new env.GyroAim(); gyro.configure(true); gyro.setActive(true); env.orientation.angle = 0;
  const pose = (alpha, beta, gamma, timeStamp) => gyro.onOrientation({ alpha, beta, gamma, timeStamp });
  pose(359, 90, 0, 0); empty(gyro); pose(1, 90, 0, 20);
  const wrapped = gyro.consume(); assert.ok(wrapped.x > 0 && wrapped.x < .04);
  gyro.calibrate(); pose(120, -40, 0, 40); empty(gyro);
  for (const angle of [90, -90]) {
    env.orientation.angle = angle; env.orientation.dispatchEvent(new Event('change'));
    pose(0, 30, 0, 60); empty(gyro); pose(0, 32, 0, 80); assert.ok(angle * gyro.consume().x > 0);
  }
  gyro.setActive(false); pose(0, 60, 0, 100); empty(gyro); gyro.setActive(true); pose(0, 80, 0, 120); empty(gyro);
  gyro.dispose();
});
test('diagnostics count empty events and distinguish inactive control from a working sensor', async () => {
  const env = await environment(); const gyro = new env.GyroAim(); gyro.configure(true);
  env.sample(null, null); assert.equal(gyro.diagnostics().events.motion, 1); assert.equal(gyro.samples, 0);
  env.sample(0, 0); assert.equal(gyro.status.code, 'ready'); assert.equal(gyro.controlling, false);
  assert.match(gyro.diagnosticText(), /菜单 \/ 暂停/);
  gyro.setActive(true); env.sample(20, 0, 125); env.sample(20, 0, 125); assert.ok(gyro.consume().x > 0);
  assert.ok(gyro.diagnostics().applied > 0); gyro.dispose();
});
