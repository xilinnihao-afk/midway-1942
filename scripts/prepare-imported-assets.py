#!/usr/bin/env python3
"""准备用户提供 GLB：保留来源元数据；移除展示场景引用；合并重复平色材质。
运行需要 Pillow（仅制作阶段），游戏无 Python/Pillow 依赖。
"""
import io,json,struct,pathlib,hashlib
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCES={'a6m_zero_low_poly':'a6m_zero_low_poly.glb','imported_f4f':'f4f.glb','f4u-4':'f4u-4.glb','essex_aircraft_carrier':'essex_aircraft_carrier.glb'}
records=[]
for key,filename in SOURCES.items():
 original=pathlib.Path.home()/'Downloads'/filename
 blob=original.read_bytes(); length=struct.unpack_from('<I',blob,12)[0]
 g=json.loads(blob[20:20+length]); binary=blob[28+length:]
 removed=[]
 for scene in g['scenes']:
  def clean(ids):
   keep=[]
   for i in ids:
    n=g['nodes'][i]
    if any(token in n.get('name','').lower() for token in ['ground_plane','lights','lamp']):removed.append(n.get('name'));continue
    if 'children'in n:n['children']=clean(n['children'])
    keep.append(i)
   return keep
  scene['nodes']=clean(scene['nodes'])
 aliases={};seen={};flat=0
 for i,mat in enumerate(g.get('materials',[])):
  pbr=mat.get('pbrMetallicRoughness',{})
  for role,parent in [('baseColorTexture',pbr),('normalTexture',mat)]:
   if role not in parent:continue
   texture=g['textures'][parent[role]['index']];image=g['images'][texture['source']]
   if 'bufferView' not in image:continue
   view=g['bufferViews'][image['bufferView']];offset=view.get('byteOffset',0)
   pixels=Image.open(io.BytesIO(binary[offset:offset+view['byteLength']])).convert('RGB')
   if max(pixels.size)>64:continue
   colors=pixels.getcolors(2)
   if not colors or len(colors)!=1:continue
   rgb=colors[0][1]
   if role=='baseColorTexture':
    def linear(x):
     x=x/255;return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
    factor=pbr.get('baseColorFactor',[1,1,1,1]);pbr['baseColorFactor']=[linear(rgb[k])*factor[k] for k in range(3)]+[factor[3]]
    del pbr[role];flat+=1
   elif abs(rgb[0]-128)<=1 and abs(rgb[1]-128)<=1 and rgb[2]==255:del mat[role]
  signature=json.dumps({k:v for k,v in mat.items() if k!='name'},sort_keys=True)
  aliases[i]=seen.setdefault(signature,i)
 for mesh in g.get('meshes',[]):
  for primitive in mesh['primitives']:
   if 'material'in primitive:primitive['material']=aliases[primitive['material']]
 g.setdefault('asset',{}).setdefault('extras',{})['midwayAdaptation']='展示地面/灯光移除；常色纹理转线性因子；同材质网格运行时合批；原模型作者/许可保留。'
 encoded=json.dumps(g,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\0'*((-len(binary))%4)
 result=struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
 (ROOT/'assets/models'/f'{key}.glb').write_bytes(result)
 record={'file':f'{key}.glb','originalSHA256':hashlib.sha256(blob).hexdigest(),'removed':removed,'flatTexturesRemoved':flat,'uniqueMaterials':len(set(aliases.values())),'source':g['asset'].get('extras',{})}
 records.append(record)
 print(key,'flat',flat,'materials',len(set(aliases.values())),'removed',removed)
(ROOT/'artifacts/imported-assets.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
