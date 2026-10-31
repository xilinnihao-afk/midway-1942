#!/usr/bin/env python3
"""导入空战版模型，原始 Downloads 文件不改动。制作阶段依赖 Pillow，游戏无此依赖。
喷火原模型带展示姿态：删除物体姿态和 FBX 补偿，保留根节点 Z-up→Y-up。
驱逐舰将不重复的 UV 贴图合入图集；跨格重复 UV 保留原材质，避免拉伸。
"""
import copy, hashlib, io, json, pathlib, struct
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[1]
NAMES = ['british_v-class_destroyer_ww1', 'supermarine_spitfire']


def read_glb(path):
    blob = path.read_bytes()
    size = struct.unpack_from('<I', blob, 12)[0]
    return blob, json.loads(blob[20:20+size]), bytearray(blob[28+size:])


def append_view(g, binary, data):
    binary.extend(b'\0' * (-len(binary) % 4))
    view = len(g['bufferViews'])
    g['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
    binary.extend(data)
    return view


def atlas_destroyer(g, binary):
    eligible = []
    for mesh in g['meshes']:
        for primitive in mesh['primitives']:
            a = g['accessors'][primitive['attributes']['TEXCOORD_0']]
            if a['min'][0] >= 0 and a['max'][0] <= 1 and a['min'][1] >= -1 and a['max'][1] <= 0:
                eligible.append(primitive)
    texture_ids = sorted({g['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index'] for p in eligible})
    images = {}
    for tid in texture_ids:
        entry = g['images'][g['textures'][tid]['source']]
        v = g['bufferViews'][entry['bufferView']]; start = v.get('byteOffset', 0)
        im = Image.open(io.BytesIO(binary[start:start+v['byteLength']])).convert('RGB')
        if max(im.size) > 1024:
            im.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        images[tid] = im
    # 排架布局，四像素延边，减少缩小采样时的贴图边缘串色。
    size, pad = 2048, 4
    atlas = Image.new('RGB', (size, size), (92, 99, 98))
    slots = {}; x = y = row_height = 0
    for tid, im in sorted(images.items(), key=lambda item: -item[1].height):
        w, h = im.size
        if x + w + pad*2 > size:
            x = 0; y += row_height; row_height = 0
        if y + h + pad*2 > size:
            raise ValueError('驱逐舰图集超过预算')
        bx, by = x+pad, y+pad
        atlas.paste(im, (bx, by))
        atlas.paste(im.crop((0, 0, 1, h)).resize((pad, h)), (x, by))
        atlas.paste(im.crop((w-1, 0, w, h)).resize((pad, h)), (bx+w, by))
        atlas.paste(atlas.crop((x, by, bx+w+pad, by+1)).resize((w+pad*2, pad)), (x, y))
        atlas.paste(atlas.crop((x, by+h-1, bx+w+pad, by+h)).resize((w+pad*2, pad)), (x, by+h))
        slots[tid] = (bx, by, w, h)
        x += w+pad*2; row_height = max(row_height, h+pad*2)
    encoded = io.BytesIO(); atlas.save(encoded, format='JPEG', quality=92, subsampling=0)
    image_id = len(g['images']); g['images'].append({'name': 'V-class atlas', 'mimeType': 'image/jpeg', 'bufferView': append_view(g, binary, encoded.getvalue())})
    texture_id = len(g['textures']); g['textures'].append({'source': image_id})
    material = copy.deepcopy(g['materials'][0]); material['name'] = 'V-class shared atlas'
    material['pbrMetallicRoughness']['baseColorTexture'] = {'index': texture_id}
    material_id = len(g['materials']); g['materials'].append(material)
    for p in eligible:
        tid = g['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index']
        bx, by, w, h = slots[tid]
        a = g['accessors'][p['attributes']['TEXCOORD_0']]
        v = g['bufferViews'][a['bufferView']]
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        uv = bytearray(); values = []
        for k in range(a['count']):
            u, t = struct.unpack_from('<ff', binary, start + k*v.get('byteStride', 8))
            out = ((bx+u*w)/size, (by+(t+1)*h)/size)
            uv.extend(struct.pack('<ff', *out)); values.append(out)
        uv_id = len(g['accessors']); g['accessors'].append({'bufferView': append_view(g, binary, uv), 'componentType': 5126, 'count': a['count'], 'type': 'VEC2', 'min': [min(p[i] for p in values) for i in range(2)], 'max': [max(p[i] for p in values) for i in range(2)]})
        p['attributes']['TEXCOORD_0'] = uv_id; p['material'] = material_id
    return len(eligible)


def compact(g, binary):
    """移除未使用的纹理、材质及 bufferView，图集化后不把旧贴图重复打包。"""
    primitives = [p for mesh in g['meshes'] for p in mesh['primitives']]
    material_ids = sorted({p['material'] for p in primitives})
    materials = [g['materials'][i] for i in material_ids]
    texture_refs = []
    for mat in materials:
        texture_refs.extend(v for k, v in mat.items() if k.endswith('Texture'))
        texture_refs.extend(v for k, v in mat.get('pbrMetallicRoughness', {}).items() if k.endswith('Texture'))
    tids = sorted({v['index'] for v in texture_refs})
    textures = [g['textures'][i] for i in tids]
    image_ids = sorted({t['source'] for t in textures})
    images = [g['images'][i] for i in image_ids]
    aids = sorted({a for p in primitives for a in [*p['attributes'].values(), p['indices']]})
    accessors = [g['accessors'][i] for i in aids]
    # 按 accessor 重打包，避免旧 UV 所在的大共享 bufferView 随图集一起重复保留。
    result = bytearray(); views = []
    for item in accessors + images:
        original_view = g['bufferViews'][item['bufferView']]
        start = original_view.get('byteOffset', 0) + item.get('byteOffset', 0)
        if 'componentType' in item:
            components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[item['type']]
            component_bytes = {5126: 4, 5125: 4, 5123: 2, 5121: 1}[item['componentType']]
            stride = components * component_bytes
            source_stride = original_view.get('byteStride', stride)
            data = b''.join(binary[start+k*source_stride:start+k*source_stride+stride] for k in range(item['count']))
            if item['type'] == 'SCALAR' and item['componentType'] == 5125:
                indices = struct.unpack('<'+'I'*item['count'], data)
                if max(indices, default=0) < 65536:
                    data = struct.pack('<'+'H'*len(indices), *indices); item['componentType'] = 5123
            item.pop('byteOffset', None)
        else:
            data = binary[start:start+original_view['byteLength']]
        result.extend(b'\0' * (-len(result) % 4))
        item['bufferView'] = len(views)
        view = {'buffer': 0, 'byteOffset': len(result), 'byteLength': len(data)}
        if 'target' in original_view: view['target'] = original_view['target']
        views.append(view); result.extend(data)
    for p in primitives:
        p['material'] = material_ids.index(p['material']); p['indices'] = aids.index(p['indices'])
        p['attributes'] = {k: aids.index(v) for k,v in p['attributes'].items()}
    for ref in texture_refs: ref['index'] = tids.index(ref['index'])
    for t in textures: t['source'] = image_ids.index(t['source'])
    g.update(materials=materials, textures=textures, images=images, accessors=accessors, bufferViews=views)
    return result


records = []
for key in NAMES:
    original, g, binary = read_glb(pathlib.Path.home()/'Downloads'/f'{key}.glb')
    changes = []
    if key == 'supermarine_spitfire':
        for node in g['nodes']:
            if node['name'] in ['spitfire.FBX', 'Object001', 'Object002']:
                node.pop('matrix', None)
        changes.append('删除展示俯仰/侧倾姿态；保留根节点 -90° X 变换，使机头朝 +Z、机背朝 +Y')
    else:
        batched = atlas_destroyer(g, binary)
        changes.append(f'{batched} 个子网格共享 2048² 图集；跨格重复 UV 保留原贴图；舰艏 +Z、原始水线 Y=0')
    binary = compact(g, binary)
    g['asset']['extras']['midwayAdaptation'] = '；'.join(changes)
    g['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(g, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    result = struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(binary), 0x004e4942) + binary
    (ROOT/'assets/models'/f'{key}.glb').write_bytes(result)
    triangles = sum(g['accessors'][p['indices']]['count']//3 for m in g['meshes'] for p in m['primitives'])
    record = {'file': key+'.glb', 'originalSHA256': hashlib.sha256(original).hexdigest(), 'bytes': len(result), 'triangles': triangles, 'materials': len(g['materials']), 'images': len(g['images']), 'changes': changes, 'source': g['asset']['extras']}
    records.append(record)
    print(json.dumps(record, ensure_ascii=False))
(ROOT/'artifacts/flight-imported-assets.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
