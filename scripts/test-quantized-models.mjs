import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(spec,context,next){return next(spec==='three'?new URL('../vendor/three.module.js',import.meta.url).href:spec,context)}});
import * as THREE from '../vendor/three.module.js';
const original=fs.readFileSync(new URL('../js/AssetLoader.js',import.meta.url),'utf8');
const source=original.replaceAll("from 'three'",`from '${new URL('../vendor/three.module.js',import.meta.url)}'`).replaceAll("from '../vendor/",`from '${new URL('../vendor/',import.meta.url)}`).replaceAll("from './config.js'",`from '${new URL('../js/config.js',import.meta.url)}'`);
const {AssetLoader}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const loader=new AssetLoader(), scene=new THREE.Group(), parent=new THREE.Group();
parent.position.set(130,-4,80);parent.rotation.set(.2,-.7,.1);parent.scale.set(50,25,80);scene.add(parent);
const positions=[-32767,0,32767, 32767,0,32767, 0,32767,-32767];
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Int16BufferAttribute(positions,3,true));geometry.setAttribute('normal',new THREE.Int8BufferAttribute([0,127,0,0,127,0,0,127,0],3,true));geometry.setAttribute('uv',new THREE.Uint16BufferAttribute([0,0,65535,0,32768,65535],2,true));
const material=new THREE.MeshStandardMaterial({color:0x778899});parent.add(new THREE.Mesh(geometry,material));scene.updateMatrixWorld(true);
const expected=[];for(let i=0;i<3;i++)expected.push(new THREE.Vector3(...positions.slice(i*3,i*3+3).map(x=>x/32767)).applyMatrix4(parent.matrixWorld));
const prepared=loader.prepare(scene);let mesh;prepared.traverse(n=>{if(n.isMesh)mesh=n});
for(let i=0;i<3;i++){const actual=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i);assert(actual.distanceTo(expected[i])<.00002,'matrix baking corrupted quantized positions');}
for(const attr of Object.values(mesh.geometry.attributes)){assert(attr.array instanceof Float32Array);assert(!attr.normalized)}
assert.equal(mesh.geometry.attributes.uv.getX(1),1);assert.equal(mesh.geometry.attributes.uv.getY(2),1);
const carrier=loader.normalize(prepared,'yorktown'),bounds=new THREE.Box3().setFromObject(carrier),size=bounds.getSize(new THREE.Vector3());assert(Math.abs(size.z-100)<.001,'ship normalization lost length');
assert(Math.abs(bounds.min.y+size.y*.2)<.001,'waterline changed');
console.log('PASS: quantized positions/normals/UV decode, world matrix baking, carrier length and waterline');
