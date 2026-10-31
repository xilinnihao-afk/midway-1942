// 只校验离线源码/模块链接与 GLB 格式，不模拟浏览器、不绕过 file:// 访问策略。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname,'..');
const modules = new Map();
for (const folder of ['js','vendor']) for(const name of fs.readdirSync(path.join(root,folder))) {
  if(!name.endsWith('.js')) continue;
  const id=`${folder}/${name}`;
  modules.set(id,new vm.SourceTextModule(fs.readFileSync(path.join(root,id),'utf8'),{identifier:id}));
}
const resolve=(spec,parent)=>spec==='three'?'vendor/three.module.js':path.posix.normalize(path.posix.join(path.posix.dirname(parent),spec));
await modules.get('js/main.js').link((spec, referencing) => {
  const id=resolve(spec,referencing.identifier);
  if(!modules.has(id))throw new Error(`Missing module ${id}`);
  return modules.get(id);
});
const embeddedText=fs.readFileSync(path.join(root,'assets/embedded.js'),'utf8');
const embedded=JSON.parse(embeddedText.split('window.MIDWAY_ASSETS=')[1].trim().replace(/;$/,''));
for(const [key,base64] of Object.entries(embedded)) {
 const binary=Buffer.from(base64,'base64');
 if(binary.readUInt32LE(0)!==0x46546c67 || binary.readUInt32LE(4)!==2 || binary.readUInt32LE(8)!==binary.length)throw new Error(`Invalid GLB ${key}`);
 const gltf=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString());
 if(!gltf.meshes.length || !gltf.materials.length)throw new Error(`Empty GLB ${key}`);
 if(!binary.equals(fs.readFileSync(path.join(root,'assets/models',`${key}.glb`))))throw new Error(`Stale embedded model ${key}`);
}
const audioText=fs.readFileSync(path.join(root,'assets/audio/embedded.js'),'utf8');
const audio=JSON.parse(audioText.split('window.MIDWAY_AUDIO=')[1].trim().replace(/;$/,''));
for(const [key,base64] of Object.entries(audio)){
 const binary=Buffer.from(base64,'base64');
 const file=fs.readdirSync(path.join(root,'assets/audio')).find(name=>name.startsWith(key+'.')&&/\.(wav|mp3|ogg)$/.test(name));
 if(!file||!binary.equals(fs.readFileSync(path.join(root,'assets/audio',file))))throw new Error(`Stale embedded audio ${key}`);
 if(file.endsWith('.wav')&&(binary.toString('ascii',0,4)!=='RIFF'||binary.toString('ascii',8,12)!=='WAVE'))throw new Error(`Invalid WAV ${key}`);
}
// 同样的离线 import 重写规则必须只引用已打包的模块。
const pattern=/(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g;
for(const id of modules.keys()) {
 const source=fs.readFileSync(path.join(root,id),'utf8');
 for(const match of source.matchAll(pattern)) {
  const spec=match[3];
  if(spec==='three'||spec.startsWith('./')||spec.startsWith('../'))if(!modules.has(resolve(spec,id)))throw new Error(`Offline unresolved ${id}: ${spec}`);
 }
}
console.log(JSON.stringify({passed:true,linkedModules:modules.size,embeddedGLBs:Object.keys(embedded).length,embeddedAudio:Object.keys(audio).length,scope:'Static ES6 linkage + GLB integrity; not a file:// browser execution'},null,2));
