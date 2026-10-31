import fs from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import * as THREE from '../vendor/three.module.js';
const sources=['a6m_zero_low_poly.glb','f4f.glb','f4u-4.glb','essex_aircraft_carrier.glb'];
for(const name of sources){
const b=fs.readFileSync(join(process.argv[2]||join(homedir(),'Downloads'),name)); const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
const total=new THREE.Box3();const records=[];
function visit(i,parent){const n=g.nodes[i],m=new THREE.Matrix4();if(n.matrix)m.fromArray(n.matrix);else m.compose(new THREE.Vector3(...(n.translation||[0,0,0])),new THREE.Quaternion(...(n.rotation||[0,0,0,1])),new THREE.Vector3(...(n.scale||[1,1,1])));m.premultiply(parent);
if(n.mesh!==undefined){const box=new THREE.Box3();for(const p of g.meshes[n.mesh].primitives){const a=g.accessors[p.attributes.POSITION];box.union(new THREE.Box3(new THREE.Vector3(...a.min),new THREE.Vector3(...a.max)).applyMatrix4(m));}total.union(box);records.push({name:n.name,mesh:n.mesh,center:box.getCenter(new THREE.Vector3()).toArray().map(x=>+x.toFixed(3)),size:box.getSize(new THREE.Vector3()).toArray().map(x=>+x.toFixed(3)),material:g.meshes[n.mesh].primitives.map(p=>g.materials[p.material]?.name)});}
for(const child of n.children||[])visit(child,m);}
for(const n of g.scenes[g.scene||0].nodes)visit(n,new THREE.Matrix4());
console.log(JSON.stringify({file:name,bounds:{min:total.min.toArray(),max:total.max.toArray()},nodes:records},null,2));
}
