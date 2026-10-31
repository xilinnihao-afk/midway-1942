#!/usr/bin/env node
/** Build-time only. npm install --prefix /tmp/midway-model-tools @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions sharp */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.env.MIDWAY_MODEL_TOOLS || '/tmp/midway-model-tools', 'package.json'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { dedup, prune, weld, quantize, textureCompress } = require('@gltf-transform/functions');
const sharp = require('sharp');
const root = path.resolve(import.meta.dirname, '..');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['a6m_zero_low_poly','imported_f4f','f4u-4','essex_aircraft_carrier','british_v-class_destroyer_ww1','supermarine_spitfire'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const records=[];
for(const name of names){
 const file = path.join(root,'assets/models',`${name}.glb`);
 const backup = path.join(root,'artifacts/model-menu-20261015/original-models',`${name}.glb`);
 await fs.mkdir(path.dirname(backup),{recursive:true});
 try{await fs.copyFile(file,backup,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
 const original=await fs.readFile(backup);
 const doc=await io.read(backup);
 const asset=JSON.parse(original.subarray(20,20+original.readUInt32LE(12))).asset;
 const counts=()=>({triangles:doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((v,p)=>v+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0),vertices:doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((v,p)=>v+p.getAttribute('POSITION').getCount(),0),0)});
 const before=counts();
 await doc.transform(weld(),dedup(),prune({propertyTypes:['Texture','Material','Accessor'],keepLeaves:true,keepAttributes:true,keepExtras:true,keepSolidTextures:true}));
 // Standard PNG/JPEG only: no runtime decoding dependencies, preserve alpha and linear maps.
 await doc.transform(textureCompress({encoder:sharp,resize:[1024,1024],quality:86}));
 if(/carrier|destroyer/.test(name))await doc.transform(quantize({quantizePosition:16,quantizeNormal:8,quantizeTexcoord:14,cleanup:false}),weld(),dedup(),prune({propertyTypes:['Accessor'],keepAttributes:true,keepExtras:true}));
 const after=counts();
 if(before.triangles!==after.triangles)throw new Error(`${name}: triangle count changed`);
 Object.assign(doc.getRoot().getAsset(),asset);
 const out=await io.writeBinary(doc);
 if(out.byteLength>=original.byteLength){console.log(`${name}: original smaller, unchanged`);continue;}
 await fs.writeFile(file,out);
 const record={file:`${name}.glb`,beforeBytes:original.byteLength,afterBytes:out.byteLength,before,after,source:asset.extras}; records.push(record);console.log(JSON.stringify(record));
}
await fs.writeFile(path.join(root,'artifacts/model-menu-20261015/model-optimization.json'),JSON.stringify(records,null,2));
