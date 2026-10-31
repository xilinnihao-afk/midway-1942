/** 浏览器中的确定性物理测试，仅 ?debug&qa 显式启用。 */
export async function runFlightTests(game){
  const results=[],pullUpMetrics=[],automaticAimMetrics=[];const test=(name,fn)=>{try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}};
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const {Vector3,Box3}=await import('three');
  const {PILOT,PLAYER_AIRCRAFT,HANDLING}=await import('./config.js');
  const {sweptDistance}=await import('./FlightManager.js');
  const {GyroAim}=await import('./GyroAim.js');
  const f=game.flight,step=()=>f.update(1/60,game.time+=1/60,new Set(),{x:0,y:0,fire:false});
  const reset=()=>{game.shipManager.reset();f.reset();game.time=0;f.enemies.forEach(e=>game.sceneManager.scene.remove(e.mesh));f.enemies=[];f.airWing.clear();f.airWing.nextReinforcement=999;f.nextWave=999;game.shipManager.ships.forEach(s=>{s.aaClock=999;s.flakClock=999;});};
  test('高速相对运动扫掠与擦弹',()=>{assert(sweptDistance(new Vector3(-20,0,0),new Vector3(20,0,0),new Vector3(0,-10,0),new Vector3(0,10,0))<.001,'高速交叉漏判');assert(sweptDistance(new Vector3(-20,8,0),new Vector3(20,8,0),new Vector3(),new Vector3())===8,'安全擦弹被误判');});
  test('飞行输入改变航向高度与速度',()=>{reset();const p=f.player;for(let i=0;i<60;i++)f.updatePlayer(1/60,i/60,new Set(['KeyW']),{x:.5,y:-.3,fire:false});assert(p.mesh.position.y>155&&p.mesh.position.x<0&&p.speed>88,'驾驶输入无效');});
  test('陀螺仪与触屏微调叠加，停止转动不被自动回平拉走',()=>{
    reset();const p=f.player,heading=p.heading;let pending={x:.04,y:.03};
    const gyro={controlling:true,consume(){const result=pending;pending={x:0,y:0};return result;}};
    const aim={active:false,consume:()=>({x:.01,y:.02})};
    f.updatePlayer(1/60,0,new Set(),{x:0,y:0,aim,gyro});
    const gain=game.aimSettings.touchSensitivity;assert(Math.abs(p.heading-heading-(.04+.01*gain))<1e-9&&Math.abs(p.pitch-(.03+.02*gain))<1e-9,'传感器与触屏没有同时影响机头');
    const pitch=p.pitch;for(let i=0;i<60;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,gyro});
    assert(Math.abs(p.pitch-pitch)<1e-9,'陀螺仪瞄准被自动回平覆盖');
    gyro.controlling=false;for(let i=0;i<60;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,gyro});
    assert(p.pitch<pitch*.3,'关闭或失去传感器后未恢复原操控');
  });
  test('合成姿态样本通过传感器管线驱动机头，归零后不跳转',()=>{
    reset();const sensor=new GyroAim();
    try{
      // Desktop test browsers may expose neither sensor API. This fixture checks
      // event -> delta -> flight integration; permission/lifecycle tests run separately.
      Object.assign(sensor,{enabled:true,listening:true,active:true,canAim:()=>true});
      sensor.onOrientation({alpha:35,beta:30,gamma:0,timeStamp:0});
      sensor.onOrientation({alpha:35,beta:32,gamma:2,timeStamp:20});
      const p=f.player,before=p.forward.clone();f.updatePlayer(1/60,0,new Set(),{x:0,y:0,gyro:sensor});
      assert(p.forward.angleTo(before)>.01,'姿态数据未到机头');
      sensor.calibrate();sensor.onOrientation({alpha:120,beta:-30,gamma:20,timeStamp:40});
      const heading=p.heading,pitch=p.pitch;f.updatePlayer(1/60,0,new Set(),{x:0,y:0,gyro:sensor});
      assert(p.heading===heading&&p.pitch===pitch,'归零后跳转');
    }finally{sensor.dispose();}
  });
  test('陀螺仪保留摇杆转向和俯仰限制，暂停清空残留输入',()=>{
    reset();const p=f.player,heading=p.heading,gyro={controlling:true,consume:()=>({x:.001,y:.001})};
    for(let i=0;i<30;i++)f.updatePlayer(1/60,0,new Set(),{x:-1,y:-1,joystickActive:true,gyro});
    assert(p.heading-heading>.1&&p.pitch>.1,'陀螺仪覆盖了摇杆');
    f.updatePlayer(1/60,0,new Set(),{x:0,y:0,gyro:{controlling:true,consume:()=>({x:0,y:3})}});
    assert(p.pitch<=1.32,'陀螺仪越过俯仰限制');
    game.gyro.setActive(true);game.clearInput();assert(!game.gyro.active&&game.gyro.consume().x===0,'清理没有关闭陀螺仪输入');
  });
  test('机炮真实弹道命中敌机',()=>{reset();const p=f.player;f.spawnEnemy(p.mesh.position.clone().add(new Vector3(0,0,110)),Math.PI);const e=f.enemies[0];e.previous.copy(e.mesh.position);e.velocity.set(0,0,0);for(let i=0;i<90;i++){p.gunClock=0;f.fire();f.updateProjectiles(1/60);}assert(f.stats.kills>0,'机炮没有击落前方敌机');});
  test('机炮持续开火60秒无过热停顿，弹丸预算有界',()=>{
    reset();let last=0,minimum=Infinity,peak=0;
    for(let i=0;i<3600;i++){
      f.updatePlayer(1/60,i/60,new Set(['KeyA']),{x:0,y:0,fire:true});f.updateProjectiles(1/60);
      peak=Math.max(peak,f.projectiles.length);
      if((i+1)%60===0){minimum=Math.min(minimum,f.stats.shots-last);last=f.stats.shots;}
    }
    assert(f.player.hp>0&&minimum>=18,'连续开火中途停顿');assert(peak<=PILOT.maxProjectiles,'持续射击弹丸泄漏');
    automaticAimMetrics.push({scenario:'continuousFire',seconds:60,shots:f.stats.shots,minShotsPerSecond:minimum,peakProjectiles:peak});
    const shots=f.stats.shots;for(let i=0;i<30;i++)f.updatePlayer(1/60,60,new Set(),{x:0,y:0,fire:false});assert(f.stats.shots===shots,'松开仍在射击');
  });
  test('只按住开火自动追踪提前量、真实击落并切换目标',()=>{
    reset();const saved=game.aimSettings.assisted;game.aimSettings.assisted=true;
    try{
      for(const offset of [new Vector3(110,15,400),new Vector3(-110,30,500)])f.spawnEnemy(f.player.mesh.position.clone().add(offset),0);
      for(const e of f.enemies)e.velocity.set(0,0,20);
      const acquired=new Set();let elapsed=0;
      for(let i=0;i<300;i++){
        f.updatePlayer(1/60,i/60,new Set(),{x:0,y:0,fire:true});
        if(f.aimAssist.tracking)acquired.add(f.aimAssist.target.id);
        for(const e of f.enemies){e.previous.copy(e.mesh.position);e.mesh.position.addScaledVector(e.velocity,1/60);}f.updateProjectiles(1/60);
        elapsed=(i+1)/60;if(f.stats.kills===2)break;
      }
      assert(f.stats.kills===2&&acquired.size===2,'不能自动击落和换目标');
      automaticAimMetrics.push({scenario:'twoMovingTargets',seconds:elapsed,kills:f.stats.kills,hits:f.stats.hits});
    }finally{game.aimSettings.assisted=saved;}
  });
  test('自动瞄准手动接管、暂停和重开清空跟随',()=>{
    reset();const saved=game.aimSettings.assisted;game.aimSettings.assisted=true;
    try{
      f.spawnEnemy(f.player.mesh.position.clone().add(new Vector3(100,10,400)),0);
      f.updatePlayer(1/60,0,new Set(),{x:0,y:0,fire:true});assert(f.aimAssist.tracking,'没有自动跟随');
      const heading=f.player.heading;f.updatePlayer(1/60,0,new Set(['KeyD']),{x:0,y:0,fire:true});
      assert(!f.aimAssist.tracking&&f.player.heading<heading,'辅助争抢手动转向');
      game.state='playing';game.togglePause();assert(!f.aimAssist.tracking&&!f.aimAssist.target&&!f.aimAssist.manualRemaining&&!game.input.fire,'暂停残留跟随或射击');
      game.restart();assert(!f.aimAssist.tracking&&!f.aimAssist.target&&f.stats.shots===0,'重开残留跟随或射击');
    }finally{game.aimSettings.assisted=saved;}
  });
  test('实战开场只按开火可击落敌机',()=>{
    reset();f.reset();game.time=0;game.state='playing';game.clearInput();const saved=game.aimSettings.assisted;game.aimSettings.assisted=true;
    try{
      game.input.fire=true;for(let i=0;i<360&&game.state==='playing';i++)game.step(1/60);
      automaticAimMetrics.push({scenario:'openingBattleHoldFireOnly',seconds:game.time,kills:f.stats.kills,hits:f.stats.hits,shots:f.stats.shots,hp:f.player.hp});
      assert(f.stats.kills>0,'开场仍需精细手动瞄准');assert(f.player.hp>0,'辅助导致开场坠毁');
    }finally{game.clearInput();game.aimSettings.assisted=saved;}
  });
  test('桶滚改变位置且不免疫弹丸',()=>{reset();const p=f.player;assert(f.evade(),'桶滚无法启动');for(let i=0;i<20;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,fire:false});assert(Math.abs(p.mesh.position.x-15)>8,'桶滚仅为装饰');p.previous.copy(p.mesh.position);f.addProjectile(p.mesh.position.clone().add(new Vector3(-10,0,0)),new Vector3(1200,0,0),'jp',7);f.updateProjectiles(1/60);assert(p.hp===p.maxHp-7,'桶滚存在无敌');assert(!f.evade(),'桶滚无冷却');});
  test('变向后可躲开已发射子弹',()=>{reset();const p=f.player;const origin=p.mesh.position.clone().add(new Vector3(0,0,180));f.addProjectile(origin,new Vector3(0,0,-340),'jp',7);for(let i=0;i<60;i++)f.update(1/60,i/60,new Set(),{x:1,y:-.6,fire:false});assert(p.hp===p.maxHp,'偏离射线仍受伤');});
  test('炸弹继承速度，不追踪目标',()=>{reset();const p=f.player;p.mesh.position.set(0,180,0);p.velocity.set(90,-20,10);f.dropBomb();const b=f.bombs[0];assert(b.velocity.equals(p.velocity),'炸弹初速度被目标改写');const vx=b.velocity.x,initialX=b.mesh.position.x;f.updateProjectiles(.1);assert(b.velocity.x===vx&&b.velocity.y<-20&&Math.abs(b.mesh.position.x-initialX-9)<.001,'重力/惯性失效');});
  test('重力炸弹命中航母并造成伤害',()=>{reset();const target=f.target,p=f.player;p.mesh.position.copy(target.mesh.position).add(new Vector3(0,85,0));p.velocity.set(0,0,0);f.dropBomb();for(let i=0;i<180;i++)f.updateProjectiles(1/60);assert(f.stats.bombHits===1&&target.hp===target.maxHp-600,'甲板未接住炸弹');});
  test('放大舰船近远模型与甲板、命中范围同步',()=>{
    reset();
    for(const ship of game.shipManager.ships){
      assert(ship.carrier?ship.length>=224:ship.length>=116,'舰船仍为原来的微缩尺寸');
      for(const level of ship.mesh.children[0].levels){
        const box=new Box3().setFromObject(level.object),size=box.getSize(new Vector3());
        assert(Math.abs(size.z-ship.length)<.01,'近远模型尺寸不一致');
      }
      for(const angle of [0,.7,Math.PI]){
        ship.heading=angle;
        const world=(x,y,z)=>new Vector3(x*Math.cos(angle)+z*Math.sin(angle),y,-x*Math.sin(angle)+z*Math.cos(angle)).add(ship.mesh.position);
        assert(game.shipManager.intersectBomb(world(ship.width*.45,60,0),world(ship.width*.45,-2,0),ship.team==='us'?'jp':'us')===ship,'放大后的甲板边缘漏判');
        assert(game.shipManager.intersectBomb(world(ship.width*.7,60,0),world(ship.width*.7,-2,0),ship.team==='us'?'jp':'us')!==ship,'舰外海面误判命中');
      }
    }
  });
  test('航母与驱逐舰投弹窗口对应真实重力命中和脱靶',()=>{
    for(const id of ['akagi','ijn-dd'])for(const factor of [.4,.8]){
      reset();game.shipManager.setTarget(id);const target=f.target,p=f.player;
      p.mesh.position.copy(target.mesh.position).add(new Vector3(0,190,-245));p.pitch=-.58;p.forward.set(0,Math.sin(p.pitch),Math.cos(p.pitch));p.velocity.copy(p.forward).multiplyScalar(88);p.mesh.quaternion.setFromUnitVectors(new Vector3(0,0,1),p.forward);
      f.predictBomb();p.mesh.position.x+=target.mesh.position.x+target.width*factor-f.bombImpact.x;p.mesh.position.z+=target.mesh.position.z-f.bombImpact.z;f.predictBomb();
      const expected=factor<.55;assert(f.bombOnTarget===expected,'投弹窗口与舰宽不一致');f.dropBomb();
      for(let i=0;i<240;i++)f.updateProjectiles(1/60);
      assert((target.hp<target.maxHp)===expected&&f.stats.bombHits===Number(expected),'落点提示与真实炸弹结果不一致');
    }
  });
  test('防空射击与延时破片实际造成伤害',()=>{reset();const s=f.target,p=f.player;p.mesh.position.copy(s.mesh.position).add(new Vector3(0,140,-120));s.aaClock=0;s.flakClock=0;f.updateAA(1/60,0);assert(f.projectiles.some(b=>b.flak)&&f.flak.length>0,'防空未启动');const cloud=f.flak[0];p.mesh.position.copy(cloud.mesh.position);p.previous.copy(p.mesh.position);for(let i=0;i<90;i++)f.updateAA(1/60,i/60);assert(p.hp<p.maxHp,'破片无伤害');});
  test('补给区恢复炸弹并遵守高度',()=>{reset();const p=f.player,home=game.shipManager.selected;p.mesh.position.copy(home.mesh.position);p.mesh.position.y=100;p.bombs=0;p.hp=40;for(let i=0;i<125;i++)f.updateSupply(1/60);assert(p.bombs===p.maxBombs&&p.hp===85,'补给失败');p.bombs=0;p.mesh.position.y=250;f.supplyCooldown=0;for(let i=0;i<150;i++)f.updateSupply(1/60);assert(p.bombs===0,'高度外错误补给');});
  test('坠海失败与重新开始清理状态',()=>{reset();f.player.mesh.position.set(800,-5,0);f.updatePlayer(1/60,0,new Set(),{x:0,y:0,fire:false});assert(f.player.hp===0,'坠海不判失败');game.restart();assert(game.state==='playing'&&f.player.hp===120&&f.projectiles.length===0&&f.player.bombs===6,'重试未清理');});
  test('击沉双航母胜利、死亡优先判负',()=>{reset();for(const s of game.shipManager.ships)if(s.team==='jp'&&s.carrier)s.alive=false;game.state='playing';game.step(1/60);assert(game.state==='won','胜利条件错误');f.player.hp=0;game.state='playing';game.step(1/60);assert(game.state==='lost','死亡胜负优先级错误');});
  test('实体预算有界',()=>{reset();for(let i=0;i<400;i++)f.addProjectile(new Vector3(0,100,0),new Vector3(1,0,0),'us',1);for(let i=0;i<20;i++)f.spawnEnemy(new Vector3(0,200,300),0);assert(f.projectiles.length===PILOT.maxProjectiles&&f.enemies.length===PILOT.maxEnemies,'预算溢出');});
  test('炮弹抛物线与引信到点一致',()=>{
    reset();const origin=new Vector3(0,20,0),destination=new Vector3(60,150,200),duration=1.2;
    const velocity=destination.clone().sub(origin).divideScalar(duration);velocity.y+=.5*13*duration;
    f.addProjectile(origin,velocity,'jp',0,duration,true,{visualOnly:true});const shell=f.projectiles[0];
    for(let i=0;i<72;i++)f.updateProjectiles(1/60);
    assert(shell.position.distanceTo(destination)<.01,'高射炮未按重力到达引信爆点');
    assert(f.player.hp===f.player.maxHp,'引信弹造成了重复碰撞伤害');
  });
  test('机炮弹下坠与无隐形激光',()=>{
    reset();const origin=new Vector3(0,150,0);f.addProjectile(origin,new Vector3(0,0,440),'us',18,3);
    const bullet=f.projectiles[0];for(let i=0;i<60;i++)f.updateProjectiles(1/60);
    assert(Math.abs(bullet.position.y-(150-4.905))<.01&&Math.abs(bullet.position.z-440)<.01,'弹道不符合重力');
    assert(f.lines.visible===false,'旧1像素线仍叠加在曳光带上');
  });
  test('特效池有界、暂停不推进、清理完全',()=>{
    reset();const effects=game.effects,point=new Vector3(0,100,0),camera=game.sceneManager.camera;
    for(let i=0;i<140;i++)effects.burst(point,i%2?'ship':'flak',1);
    effects.update(1/60,camera,[]);game.particles.update(1/60);
    const a=effects.diagnostics;
    assert(effects.muzzleLayer.material.side===2&&effects.tracers.material.side===2,'枪口或弹道面片被背面剔除');
    assert(a.glows<=96&&a.sparks<=384&&a.lights<=2&&game.particles.activeCount<=650,'特效池超预算');
    const lives=effects.glows.map(p=>p.life).join(',');for(let i=0;i<20;i++)effects.update(0,camera,[]);
    assert(lives===effects.glows.map(p=>p.life).join(','),'暂停时特效仍老化');
    effects.clear();assert(effects.diagnostics.glows===0&&effects.diagnostics.sparks===0&&effects.diagnostics.tracers===0,'特效清理不完整');
  });
  test('开场编队与有限围攻',()=>{reset();f.reset();assert(f.enemies.length===8&&f.allies.length===4,'开场飞机数量错误');f.updateEnemies(1/60,0);assert(f.enemies.filter(e=>e.targetIsPlayer).length<=3,'围攻人数超限');});
  test('僚机击落不计玩家得分',()=>{reset();f.spawnEnemy(new Vector3(0,150,100),0);const e=f.enemies[0];e.hp=1;e.previous.copy(e.mesh.position);f.addProjectile(new Vector3(0,150,90),new Vector3(0,0,600),'us',8,2,false,{owner:'ally'});f.updateProjectiles(1/60);assert(f.stats.alliedKills===1&&f.stats.kills===0&&f.player.score===0,'击落归属错误');});
  test('四种飞机挂弹脱离、冷却和补给',()=>{for(const type of Object.keys(PLAYER_AIRCRAFT)){reset();f.reset(type);const p=f.player,n=p.maxBombs;assert(p.racks.filter(r=>r.visible).length===n,'缺少挂弹');assert(f.dropBomb()&&p.bombs===n-1&&!p.racks[0].visible&&f.bombs.length===1,'挂架未释放');assert(!f.dropBomb(),'投弹无冷却');p.bombs=0;p.bombClock=0;assert(!f.dropBomb(),'空弹仍释放');p.bombs=n;f.syncBombRacks();assert(p.racks.every(r=>r.visible),'装填未恢复模型');}f.reset('sbd');});
  test('四种图片选机、返回机库与重试保持机型',()=>{
    for(const type of Object.keys(PLAYER_AIRCRAFT)){
      game.state='ready';game.selectAircraft(type);game.start();
      assert(game.state==='playing'&&f.selectedType===type,'选机未进入正确机型');
      game.togglePause();game.returnToHangar();
      assert(game.state==='ready'&&game.time===0&&f.selectedType===type,'返回机库残留战斗状态');
      game.start();game.state='lost';game.restart();
      assert(game.state==='playing'&&f.selectedType===type&&f.player.hp===PLAYER_AIRCRAFT[type].hp,'重试丢失机型');
    }
    game.state='paused';game.returnToHangar();game.selectAircraft('sbd');
  });
  const {shapeAxis,shapeControl,updateControls}=await import('./FlightControls.js');
  const {flightCameraFov}=await import('./SceneManager.js');
  test('摇杆中心抗抖、渐进微调和满杆升降',()=>{
    const input={joystickActive:true};
    for(const axis of ['turn','pitch']){
      assert(shapeControl(.08,axis,input)===0,'轻触抖动仍然转向');
      const old=shapeAxis(.2,axis==='turn'?1.65:1.25)*(axis==='turn'?.72:1);
      assert(shapeControl(.2,axis,input)<old*.65,'中心灵敏度没有明显降低');
      let previous=0;for(let i=0;i<=100;i++){const value=shapeControl(i/100,axis,input);assert(value>=previous&&Math.abs(value+shapeControl(-i/100,axis,input))<1e-9,'曲线不连续递增或不对称');previous=value;}
    }
    assert(shapeControl(1,'pitch',input)===1,'满杆拉起受限');
  });
  test('俯冲接近舰船时视野渐变，拉起或无炸弹恢复',()=>{
    reset();const p=f.player,s=f.target;p.mesh.position.copy(s.mesh.position).add(new Vector3(0,190,-245));p.speed=88;p.pitch=-.58;p.forward.copy(s.mesh.position).sub(p.mesh.position).normalize();
    const focused=flightCameraFov(p,s);assert(focused>=49&&focused<51,'近距俯冲未聚焦');
    p.pitch=0;assert(flightCameraFov(p,s)===60,'拉起未恢复视野');p.pitch=-.58;p.bombs=0;assert(flightCameraFov(p,s)===60,'无炸弹仍强制聚焦');p.bombs=1;p.forward.negate();assert(flightCameraFov(p,s)===60,'后方目标触发聚焦');p.forward.negate();p.mesh.position.z-=1000;assert(flightCameraFov(p,s)===60,'远处舰船触发聚焦');
  });
  test('俯冲高度动态预警、甲板抬高极限与最后一弹后拉升',()=>{
    reset();const p=f.player,s=f.target;p.mesh.position.copy(s.mesh.position).add(new Vector3(0,190,-100));p.pitch=-.8;p.speed=130;p.throttle=1;
    f.updateDiveSafety();const safety=f.diveSafety;assert(safety.diving&&safety.surface>=s.deckHeight+1,'没有考虑前方甲板高度');
    p.mesh.position.y=safety.pullUp+15;f.updateDiveSafety();assert(f.diveSafety.level===1&&f.warning.includes('准备拉升'),'提前预警缺失');
    p.mesh.position.y=safety.pullUp-5;p.bombs=0;f.updateDiveSafety();assert(f.diveSafety.level===2&&f.warning.includes('立即拉升'),'空弹后停止保护');
    game.ui.update(0);assert(game.ui.dom['flight-warning'].dataset.level==='2','警报等级未同步到界面');
    p.pitch=.1;f.updateDiveSafety();assert(f.diveSafety.level===0&&f.warning==='','拉起后警报不消失');
    p.mesh.position.copy(game.shipManager.selected.mesh.position).add(new Vector3(0,60,-40));p.pitch=-.8;f.updateDiveSafety();f.updateSupply(1/60);game.ui.update(0);
    assert(f.diveSafety.level>=2&&f.warning.includes('拉升')&&game.ui.dom['resupply-status'].textContent==='','补给提示覆盖了危险警报');
    reset();assert(!f.diveSafety.level,'重开残留警报');
  });
  test('鼠标中心微调与外圈完整舵量',()=>{assert(shapeAxis(.02)===0&&shapeAxis(1)===1&&shapeAxis(-1)===-1,'死区/端点错误');assert(shapeAxis(.25)<.2&&shapeAxis(.8)>.65,'中心与外圈响应不合理');assert(Math.abs(shapeAxis(.3)+shapeAxis(-.3))<1e-9,'左右不对称');});
  test('键盘优先、100ms响应、松开快速停止',()=>{const p={};for(let i=0;i<6;i++)updateControls(p,new Set(['KeyA']),{x:1,y:0},1/60);assert(p.turnInput>.75,'鼠标抵消键盘或响应过慢');for(let i=0;i<12;i++)updateControls(p,new Set(),{x:0,y:0},1/60);assert(Math.abs(p.turnInput)<.01,'松开后残余转向');});
  test('控制平滑与帧率无关',()=>{for(const joystickActive of [false,true]){const run=hz=>{const p={};for(let i=0;i<hz;i++)updateControls(p,new Set(),{x:.7,y:-.6,joystickActive},1/hz);return p;};const a=run(30),b=run(120);assert(Math.abs(a.turnInput-b.turnInput)<1e-8&&Math.abs(a.pitchInput-b.pitchInput)<1e-8,'控制依赖帧率');}});
  test('摇杆柔和转向、满杆拉升与键盘接管',()=>{
    const run=(joystickActive,x,y,keys=new Set())=>{const p={};for(let i=0;i<60;i++)updateControls(p,keys,{x,y,joystickActive},1/60);return p;};
    const old=run(false,.5,-.5),gentle=run(true,.5,-.5),full=run(true,1,-1);
    assert(Math.abs(gentle.turnInput)<Math.abs(old.turnInput)*.8&&gentle.pitchInput<old.pitchInput,'摇杆微调没有变缓');
    assert(full.pitchInput>.999,'满杆拉升能力下降');
    const keys=new Set(['KeyA','ArrowUp']),keyboard=run(false,1,1,keys),override=run(true,1,1,keys);
    assert(Math.abs(keyboard.turnInput-override.turnInput)<1e-9&&Math.abs(keyboard.pitchInput-override.pitchInput)<1e-9,'摇杆配置影响键盘接管');
    for(let i=0;i<12;i++)updateControls(full,new Set(),{x:0,y:0,joystickActive:false},1/60);
    assert(Math.abs(full.turnInput)<.01&&Math.abs(full.pitchInput)<.01,'松杆后残留转向');
  });
  test('回中辅助水平、急转能力与暂停清理',()=>{reset();const p=f.player;p.mesh.position.y=400;p.pitch=.5;for(let i=0;i<60;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0});assert(p.pitch<.12,'回中后持续仰头');p.pitch=0;const heading=p.heading;for(let i=0;i<60;i++)f.updatePlayer(1/60,0,new Set(['KeyA']),{x:0,y:0});assert(p.heading-heading>1.35,'急转增益不足');game.clearInput();assert(p.turnInput===0&&p.pitchInput===0,'暂停残留操控');});
  test('敌我飞机血量数据和命中高亮',()=>{reset();f.spawnEnemy(new Vector3(0,150,100),0);const e=f.enemies[0];f.addProjectile(new Vector3(0,150,90),new Vector3(0,0,600),'us',18);f.updateProjectiles(1/60);assert(e.hp===54&&e.maxHp===72&&e.hitFlash>0,'敌机血条数据错误');f.airWing.spawn(new Vector3(0,200,100));const a=f.allies[0];f.addProjectile(new Vector3(0,200,90),new Vector3(0,0,600),'jp',6);f.updateProjectiles(1/60);assert(a.hp===99&&a.maxHp===105&&a.hitFlash>0,'僚机血条数据错误');});
  test('四种飞机高速俯冲半杆可及时拉起',()=>{
    const settings={pitchRate:HANDLING.pitchRate,pitchCurve:HANDLING.pitchCurve,pitchMinAgility:HANDLING.pitchMinAgility};
    const run=(type,baseline,joystickActive=false,stick=.5)=>{
      Object.assign(HANDLING,baseline?{pitchRate:1.12,pitchCurve:1.45,pitchMinAgility:.65}:settings);
      reset();f.reset(type);const p=f.player;p.mesh.position.set(800,150,-1200);p.pitch=-.65;p.speed=130;p.throttle=1;
      let frames=0,minY=150;
      while(p.pitch<0&&frames<240){f.updatePlayer(1/60,frames/60,new Set(),{x:0,y:-stick,fire:false,joystickActive});minY=Math.min(minY,p.mesh.position.y);frames++;}
      return {seconds:frames/60,altitudeLoss:150-minY,hp:p.hp};
    };
    try{for(const type of Object.keys(PLAYER_AIRCRAFT)){
      const before=run(type,true),after=run(type,false),joystick=run(type,false,true),fullJoystick=run(type,false,true,1);pullUpMetrics.push({type,before,after,joystick,fullJoystick});
      assert(after.seconds<1.5&&after.seconds<before.seconds*.75,'半杆拉升仍迟缓');
      assert(after.altitudeLoss<60&&after.hp>0,'拉起高度损失过大');
      assert(joystick.seconds<1.5&&joystick.altitudeLoss<60&&joystick.hp>0,'柔和摇杆半杆拉升过慢');
      assert(fullJoystick.seconds<.7&&fullJoystick.altitudeLoss<30,'柔和摇杆满杆拉升过慢');
    }}finally{Object.assign(HANDLING,settings);reset();f.reset('sbd');}
  });
  test('Graf Spee巡洋舰加载、水线与炸弹命中',()=>{
    reset();const cruisers=game.shipManager.ships.filter(s=>s.type==='cruiser');
    assert(cruisers.length===2&&game.assets.templates.cruiser.userData.importedSource==='graf_spee_low_poly','巡洋舰未使用下载模型');
    for(const ship of cruisers){const visual=ship.mesh.children[0].levels[0].object;assert(visual.userData.importedSource==='graf_spee_low_poly','近景仍是旧模型');assert(ship.deckHeight===9.6,'放大后的甲板高度未同步');}
    const target=cruisers.find(s=>s.team==='jp'),p=f.player;p.mesh.position.copy(target.mesh.position).add(new Vector3(0,85,0));p.velocity.set(0,0,0);f.dropBomb();
    for(let i=0;i<180;i++)f.updateProjectiles(1/60);
    assert(target.hp===target.maxHp-600&&f.stats.bombHits===1,'新巡洋舰无法被炸弹命中');
  });
  const {TouchAim}=await import('./TouchAim.js');
  test('右手微调改变机头、保留摇杆与拉升',()=>{
    reset();const aim=new TouchAim();aim.begin();aim.move(30,-30,390);
    const p=f.player;f.updatePlayer(1/60,0,new Set(),{x:0,y:0,aim,fire:false});
    assert(p.heading<0&&p.pitch>0&&p.mesh.position.y>150,'右划/上划方向错误');
    assert(p.forward.x<0&&p.forward.y>0,'瞄准没有改变真实机头');
    const pitch=p.pitch;for(let i=0;i<60;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,aim,fire:false});
    assert(p.pitch>=pitch,'瞄准时自动回平抵消了手指输入');
    aim.end();aim.consume(1/60);const heldPitch=p.pitch;
    for(let i=0;i<30;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,aim,fire:false});
    assert(p.pitch<heldPitch,'松手没有恢复水平辅助');
    aim.begin();aim.move(0,1e6,390);f.updatePlayer(1/60,0,new Set(),{x:0,y:-1,aim,fire:false});
    assert(Math.abs(p.pitch)<=1.32,'触屏微调越过俯仰限制');
  });
  test('命中反馈只来自玩家真实弹道碰撞',()=>{
    reset();const p=f.player;f.fire();assert(!p.hitConfirm,'空射显示命中');
    f.spawnEnemy(p.mesh.position.clone().add(new Vector3(0,0,110)),Math.PI);
    const e=f.enemies[0];e.previous.copy(e.mesh.position);e.velocity.set(0,0,0);
    for(let i=0;i<20;i++)f.updateProjectiles(1/60);
    assert(p.hitConfirm>0&&f.stats.hits>0,'真实命中没有反馈');
    for(let i=0;i<20;i++)f.updatePlayer(1/60,0,new Set(),{x:0,y:0,fire:false});
    assert(p.hitConfirm===0,'命中反馈不消退');
    reset();f.spawnEnemy(new Vector3(0,150,100),0);const allyTarget=f.enemies[0];allyTarget.previous.copy(allyTarget.mesh.position);
    f.addProjectile(new Vector3(0,150,90),new Vector3(0,0,600),'us',8,2,false,{owner:'ally'});f.updateProjectiles(1/60);
    assert(!f.player.hitConfirm,'僚机射击触发玩家命中反馈');
  });
  const {pilotPlaytest}=await import('./PilotBot.js');
  const playtests=[pilotPlaytest(game,'passive'),pilotPlaytest(game,'strike'),pilotPlaytest(game,'dogfight')];
  reset();f.reset();game.time=0;game.state='ready';game.clearInput();game.particles.clear();game.ui.update(0);
  const report={passed:results.every(r=>r.passed),tests:results,pullUpMetrics,automaticAimMetrics,playtests};const node=document.createElement('pre');node.id='qa-report';node.style.cssText='position:fixed;top:60px;left:10px;max-height:35vh;max-width:500px;overflow:auto;z-index:90;background:#071b24ed;color:#aff;padding:12px;font:11px monospace;white-space:pre-wrap';node.textContent=JSON.stringify(report,null,2);document.body.append(node);return report;
}
