import * as THREE from 'three';
/** Deterministic visible capture, enabled only by ?debug&capture=dive-*. */
export function setupDiveCapture(game,kind){
 const ship=game.shipManager.ships.find(s=>s.id===(kind==='dive-destroyer'?'ijn-dd':'akagi'));
 if(!ship)return;
 game.shipManager.setTarget(ship.id);const f=game.flight,p=f.player;
 game.clearInput();game.state='playing';game.captureFrozen=true;
 for(const e of f.enemies)f.scene.remove(e.mesh);f.enemies=[];f.airWing.clear();
 p.mesh.position.copy(ship.mesh.position).add(new THREE.Vector3(0,190,-245));p.heading=0;p.pitch=-.58;p.bank=0;p.speed=88;p.throttle=.55;
 p.forward.set(0,Math.sin(p.pitch),Math.cos(p.pitch));p.velocity.copy(p.forward).multiplyScalar(p.speed);p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),p.forward);p.previous.copy(p.mesh.position);
 if(['dive-caution','dive-warning'].includes(kind)){
   p.mesh.position.copy(ship.mesh.position).add(new THREE.Vector3(0,190,-130));p.pitch=-.8;p.speed=130;p.throttle=1;
   p.forward.set(0,Math.sin(p.pitch),Math.cos(p.pitch));p.velocity.copy(p.forward).multiplyScalar(p.speed);p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),p.forward);
   f.updateDiveSafety();p.mesh.position.y=kind==='dive-caution'?f.diveSafety.pullUp+25:f.diveSafety.pullUp-10;p.previous.copy(p.mesh.position);
 }
 f.updateDiveSafety();
 f.predictBomb();game.sceneManager.snapFlightCamera=true;game.sceneManager.update(0,1,p.mesh,game.shipManager.ships);game.ui.update(0);
 const node=document.createElement('pre');node.id='capture-metrics';node.hidden=true;document.body.append(node);
 const camera=game.sceneManager.camera;camera.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(ship.mesh.children[0].levels[0].object),size=box.getSize(new THREE.Vector3()),projected=[];
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const v=new THREE.Vector3(x,y,z).project(camera);projected.push([(v.x*.5+.5)*innerWidth,(-v.y*.5+.5)*innerHeight]);}
 const metrics={kind,ship:ship.id,collision:{length:ship.length,width:ship.width,deckHeight:ship.deckHeight},modelSize:size.toArray(),pixels:{width:Math.max(...projected.map(p=>p[0]))-Math.min(...projected.map(p=>p[0])),height:Math.max(...projected.map(p=>p[1]))-Math.min(...projected.map(p=>p[1]))},fov:camera.fov,bombOnTarget:f.bombOnTarget};
 game.updateCaptureMetrics=()=>{node.textContent=JSON.stringify({...metrics,safety:f.diveSafety,warning:f.warning,audio:game.audio.diagnostics});};game.updateCaptureMetrics();
}
