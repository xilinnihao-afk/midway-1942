import * as THREE from 'three';
import { CONFIG } from './config.js';

/** 仅 ?debug=1&qa=1 自动执行；真实管理器/固定步长，不替换游戏实现。 */
export async function runQATests(game) {
  const report = { tests: [], version: 1 };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, fn) => {
    try { const data = await fn(); report.tests.push({ name, passed: true, data }); }
    catch (e) { report.tests.push({ name, passed: false, error: e.message }); }
  };
  const advance = (seconds, bot) => { for (let i=0;i<seconds*60 && game.state==='playing';i++) { if(bot) bot(); game.step(1/60); } };
  await test('Tidewater GPU FFT DC 与单频验证', () => { const r=game.sceneManager.ocean.validateFFT(); assert(r.pass,JSON.stringify(r)); return r; });
  await test('10 种角色模型、导入模型与法线材质加载', () => {
    assert(Object.keys(game.assets.templates).length===10,'型号不足');
    let meshes=0,normals=0;
    for(const model of Object.values(game.assets.templates)) model.traverse(o=>{if(o.isMesh){meshes++;if(o.material.normalMap)normals++;}});
    assert(meshes>10&&normals>0,'缺少模型或法线贴图'); assert(game.assets.templates.yorktown.userData.importedSource==='essex_aircraft_carrier','未使用用户航母'); assert(game.assets.templates.zero.userData.importedSource==='a6m_zero_low_poly','未使用零式'); return {models:10,meshes,normalMappedMeshes:normals};
  });
  await test('损坏 GLB 的异常捕获及内置后备', async () => {
    const model = await game.assets.loadGLB('f4f','data:application/octet-stream;base64,AAAA');
    assert(model.children.length>0,'未回退');
    // file:// 直接加载内置 GLB，无网络失败阶段。
    if(location.protocol!=='file:') assert(game.assets.failures.length>0,'未记录加载失败');
  });
  await test('WASD、全速/停止与岛屿边界', () => {
    game.restart(); const s=game.shipManager.selected, initial=s.mesh.position.clone();
    game.keys.add('KeyW');game.keys.add('KeyA');advance(4);game.keys.clear();
    assert(s.mesh.position.distanceTo(initial)>4&&s.heading>.1,'移动转向失败');
    game.fullSpeed();advance(8); assert(s.speed>10,'全速失败');
    game.stopAll();advance(12);assert(Math.abs(s.speed)<.1,'停止失败');
    s.mesh.position.set(-419,0,140);game.shipManager.update(1/60,game.time,new Set());
    assert(Math.hypot(s.mesh.position.x+420,s.mesh.position.z-140)>175,'驶入岛屿');
  });
  await test('暂停/恢复、出击限额与重开清理', () => {
    game.restart();game.togglePause();assert(game.state==='paused'&&!game.launch(),'暂停时仍能起飞');
    game.togglePause();assert(game.state==='playing','恢复失败');
    const carrier=game.shipManager.selected;
    for(let i=0;i<30;i++){carrier.cooldown=0;game.launch();}
    assert(game.planeManager.planes.length<=CONFIG.maxPlanes/2,'单方预算溢出');
    game.restart();assert(game.planeManager.planes.length===0&&game.planeManager.bombs.length===0&&game.time===0,'残留实体');
  });
  await test('高速扫掠碰撞与友伤排除', () => {
    game.restart();const s=game.shipManager.target,p=s.mesh.position;
    const start=new THREE.Vector3(p.x,150,p.z),end=new THREE.Vector3(p.x,-30,p.z);
    assert(game.shipManager.intersectBomb(start,end,'us')===s,'贯穿目标未命中');
    assert(!game.shipManager.intersectBomb(start,end,'jp'),'发生友伤');
    start.x+=100;end.x+=100;assert(!game.shipManager.intersectBomb(start,end,'us'),'落空误判');
  });
  await test('完整投弹、AI 出击与自然伤害', () => {
    game.restart();game.launch();advance(44);
    const stats={...game.planeManager.stats};
    assert(stats.bombsDropped>=3&&stats.hits>=3,'首轮轰炸未命中');
    assert(stats.launchedJP>0,'AI 未出击');
    assert(game.shipManager.ships.some(s=>s.team==='us'&&s.hp<s.maxHp),'AI 未造成伤害');
    return stats;
  });
  await test('战斗机接敌伤害', () => {
    game.restart();game.launch('f4f');
    const enemy=game.shipManager.target;game.planeManager.launch(enemy,'zero');
    for(const p of game.planeManager.planes){p.age=3;p.state='attack';p.mesh.position.set(p.team==='us'?0:35,120,-30);}
    game.planeManager.update(.1,3);
    assert(game.planeManager.planes.some(p=>p.hp<115),'战斗机没有攻击');
  });
  await test('正常出击机器人可获胜（不修改伤害/血量）', () => {
    game.restart();
    advance(180,()=>{
      for(const s of game.shipManager.ships.filter(s=>s.team==='us'&&s.carrier&&s.alive)) if(s.cooldown<=0) game.planeManager.launch(s,'sbd');
    });
    assert(game.state==='won',`未获胜：${game.state}`);
    return {seconds:game.time,stats:{...game.planeManager.stats},remaining:game.shipManager.ships.filter(s=>s.team==='us').map(s=>({id:s.id,hp:s.hp}))};
  });
  await test('不操作会失败与舰船下沉', () => {
    game.restart();advance(300);
    assert(game.state==='lost','AI 未能击沉玩家航母');
    const sunk=game.shipManager.ships.find(s=>s.team==='us'&&!s.alive&&s.sinking>0);
    assert(sunk&&sunk.mesh.position.y<0,'沉没动画没有推进');
    return {seconds:game.time,stats:{...game.planeManager.stats}};
  });
  await test('粒子硬上限和回收', () => {
    game.particles.emit(new THREE.Vector3(0,10,0),'explosion',CONFIG.maxParticles*3);
    game.particles.update(.01);assert(game.particles.activeCount<=CONFIG.maxParticles,'粒子上限溢出');
    game.particles.update(10);assert(game.particles.activeCount===0,'粒子未回收');
  });
  game.restart();game.state='ready';game.ui.update(0);
  report.passed=report.tests.every(t=>t.passed);
  const output=document.createElement('pre');output.id='qa-results';output.style.cssText='position:fixed;inset:12px;z-index:100;overflow:auto;background:#102936;color:#eff;padding:20px;font:12px monospace;white-space:pre-wrap';output.textContent=JSON.stringify(report,null,2);document.body.append(output);
  return report;
}
