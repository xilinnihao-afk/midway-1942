#!/usr/bin/env python3
"""适配用户下载的 Sketchfab GLB；保留几何/贴图/原署名，修正漫反射材质的金属度。"""
import argparse,json,pathlib,struct
parser=argparse.ArgumentParser();parser.add_argument('source',type=pathlib.Path);args=parser.parse_args()
blob=args.source.read_bytes();assert blob[:4]==b'glTF' and struct.unpack_from('<I',blob,4)[0]==2
length=struct.unpack_from('<I',blob,12)[0];g=json.loads(blob[20:20+length]);chunks=blob[20+length:]
for material in g['materials']:
 pbr=material.setdefault('pbrMetallicRoughness',{})
 pbr['metallicFactor']=0.08;pbr['roughnessFactor']=0.62
 material.setdefault('extras',{})['midwayAdaptation']='Painted ship and timber deck: diffuse texture, metalness 0.08, roughness 0.62.'
encoded=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*(-len(encoded)%4)
result=struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(chunks))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+chunks
out=pathlib.Path(__file__).resolve().parents[1]/'assets/models/graf_spee_low_poly.glb';out.write_bytes(result)
print(f'{out.name}: {len(result)} bytes; geometry and textures unchanged')
