/** 可调游戏参数。世界单位近似米，时间单位秒；战场距离为街机玩法缩短。 */
export const CONFIG = {
  fixedStep: 1 / 60,
  worldLimit: 880,
  gravity: 25,
  maxPlanes: 40,
  maxBombs: 64,
  maxParticles: 650,
  ai: { detectionRange: 1900, firstLaunchDelay: 22, launchInterval: 32, patrolSpeed: 5, aaRange: 115, aaDamage: 8 },
  flight: { speed: 100, fighterSpeed: 122, altitude: 100, squadSize: 3, cooldown: 12, bombDamage: 125, fighterDamage: 24 },
};

// 外部 GLB 接入点；模型前方必须为 +Z，上方为 +Y，舰船水线在 Y=0。
export const MODEL_PATHS = Object.fromEntries(
  ['yorktown','enterprise','akagi','kaga','destroyer','cruiser','f4f','sbd','zero','d3a']
    .map(key => [key, `assets/models/${key}.glb`])
);
// 模型外观与战斗角色解耦：按用户提供的阵营使用，不代表历史型号复原。
export const MODEL_IMPORTS = {
  yorktown: { source: 'essex_aircraft_carrier', yaw: -Math.PI / 2, length: 100, waterline: 0.20, deckHeight: 3.0 },
  enterprise: { source: 'essex_aircraft_carrier', yaw: -Math.PI / 2, length: 100, waterline: 0.20, deckHeight: 3.0 },
  akagi: { source: 'essex_aircraft_carrier', yaw: -Math.PI / 2, length: 100, waterline: 0.20, deckHeight: 3.0 },
  kaga: { source: 'essex_aircraft_carrier', yaw: -Math.PI / 2, length: 100, waterline: 0.20, deckHeight: 3.0 },
  destroyer: { source: 'british_v-class_destroyer_ww1', yaw: 0, length: 58, waterline: 0.18324119, deckHeight: 1.65 },
  cruiser: { source: 'graf_spee_low_poly', yaw: Math.PI / 2, length: 83, waterline: .17, deckHeight: 4.8 },
  spitfire: { source: 'supermarine_spitfire', yaw: 0, span: 11.2 },
  zero: { source: 'a6m_zero_low_poly', yaw: 0, span: 10.5 },
  d3a: { source: 'imported_f4f', yaw: -Math.PI / 2, span: 10.5 },
  f4f: { source: 'f4u-4', yaw: -Math.PI / 2, span: 11 },
  sbd: { source: 'f4u-4', yaw: -Math.PI / 2, span: 11 },
};
for (const [key, model] of Object.entries(MODEL_IMPORTS)) MODEL_PATHS[key] = `assets/models/${model.source}.glb`;
export const AIRCRAFT_LABELS = { sbd: 'F4U-4 对舰', f4f: 'F4U-4 护航', zero: 'A6M 零式', d3a: 'F4F 攻击机' };

export const SHIP_TYPES = {
  yorktown: { name: '约克城号', hp: 1100, length: 112, width: 22, speed: 12, carrier: true },
  enterprise: { name: '企业号', hp: 1200, length: 114, width: 22, speed: 12, carrier: true },
  akagi: { name: '赤城号', hp: 1050, length: 122, width: 23, speed: 10, carrier: true },
  kaga: { name: '加贺号', hp: 1150, length: 118, width: 25, speed: 9, carrier: true },
  destroyer: { name: '驱逐舰', hp: 450, length: 58, width: 9, speed: 17, carrier: false },
  cruiser: { name: '巡洋舰', hp: 700, length: 83, width: 13, speed: 14, carrier: false },
};
// One stable world scale for model, hit volume, wake and target prediction.
// Aircraft-scale ships make the deck legible during a real dive approach.
for(const ship of Object.values(SHIP_TYPES)){ship.length*=2;ship.width*=2;}
export const FLEET = [
  { id: 'yorktown', type: 'yorktown', team: 'us', x: -100, z: -350, heading: 0 },
  { id: 'enterprise', type: 'enterprise', team: 'us', x: 100, z: -300, heading: 0 },
  { id: 'uss-dd', name: '哈曼号 · 驱逐舰', type: 'destroyer', team: 'us', x: -210, z: -225, heading: 0 },
  { id: 'uss-ca', name: '阿斯托里亚号 · 巡洋舰', type: 'cruiser', team: 'us', x: 220, z: -175, heading: 0 },
  { id: 'akagi', type: 'akagi', team: 'jp', x: 20, z: 470, heading: Math.PI },
  { id: 'kaga', type: 'kaga', team: 'jp', x: 220, z: 520, heading: Math.PI },
  { id: 'ijn-ca', name: '利根号 · 巡洋舰', type: 'cruiser', team: 'jp', x: 365, z: 380, heading: Math.PI },
  { id: 'ijn-dd', name: '岚号 · 驱逐舰', type: 'destroyer', team: 'jp', x: -100, z: 330, heading: Math.PI },
];

/** 单机街机模式参数：命中需要实际弹道相交；不使用旧版范围伤害。 */
export const PILOT = {
  hp:120,bombs:6,bombDamage:600,bulletSpeed:440,maxProjectiles:320,maxEnemies:12,maxAllies:4,initialEnemies:8,
  enemyDamage:6,aaDamage:10,aaRange:520,flakRadius:23,waveInterval:22,worldRadius:2400,
};

/** 街机驾驶：速率单位 rad/s；response 越大，转向响应越快。 */
export const HANDLING = {
  turnRate: 1.48, pitchRate: 1.55, pitchMinAgility: .85, response: 16, releaseResponse: 24,
  levelAssist: 1.5, bankResponse: 7, cameraResponse: 12,
  deadzone: .035, curve: 1.45, pitchCurve: 1.05,
  // 触屏摇杆：减缓转向和起步响应，满杆仍保留完整拉升舵量。
  joystick: { deadzone: .09, turnScale: .60, curve: 1.85, pitchCurve: 1.25, response: 10 },
};

/** 选机页与驾驶参数共用配置；模型外观属于街机自定义阵容。 */
export const PLAYER_AIRCRAFT = {
  sbd: { name: 'F4U-4 海盗', hp: 120, bombs: 6, agility: 1 },
  spitfire: { name: '喷火战斗机', hp: 100, bombs: 4, agility: 1.22 },
  d3a: { name: 'F4F 野猫', hp: 120, bombs: 6, agility: 1 },
  zero: { name: 'A6M 零式', hp: 100, bombs: 4, agility: 1.22 },
};
