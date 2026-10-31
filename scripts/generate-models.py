#!/usr/bin/env python3
"""原创低面数模型生成器；仅使用 Python 标准库，直接输出 GLB 2.0。

坐标契约：+Y 向上，+Z 为舰艏/机头；舰船水线 y=0、长 100。
船壳采用封闭截面放样，飞行甲板采用厚多边形，飞机采用机身放样。
各实体独立检验闭合与朝向，最后按材质合批；接触部件共享高度基准。
"""
import json, math, struct, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/models'
OUT.mkdir(parents=True, exist_ok=True)

def png(w,h,data):
    def chunk(k,v): return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+bytes(data[y*w*3:(y+1)*w*3]) for y in range(h))))+chunk(b'IEND',b'')

normal = png(32,32,[v for y in range(32) for x in range(32) for v in (128+int(7*math.sin(x*math.pi/4)),128+int(3*math.cos(y*math.pi/4)),254)])
(ROOT/'assets/textures').mkdir(exist_ok=True)
(ROOT/'assets/textures/steel-normal.png').write_bytes(normal)

class Model:
    def __init__(self,name,japanese=False):
        self.name=name; self.parts=[]; self.groups={}; self.jp=japanese
        colors=[[.27,.34,.38,1],[.58,.45,.27,1],[.77,.81,.79,1],[.09,.15,.19,1],[.63,.13,.10,1],[.16,.31,.43,1],[.83,.75,.49,1]]
        self.materials=[{'name':n,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':m,'roughnessFactor':r},'normalTexture':{'index':0,'scale':.24}} for n,c,m,r in zip(['naval steel','teak flight deck','markings','glass and gun barrels','red oxide','aircraft blue' if not japanese else 'aircraft olive','canvas'],colors,[.55,.05,.1,.6,.2,.35,.05],[.57,.87,.72,.3,.71,.56,.9])]
        if japanese: self.materials[5]['pbrMetallicRoughness']['baseColorFactor']=[.37,.42,.32,1]
    def part(self,name,verts,faces,mat):
        # 每个建模部件必须是独立封闭壳；修正整体三角绕序。
        tris=[]
        for f in faces:
            for i in range(1,len(f)-1): tris.append((f[0],f[i],f[i+1]))
        volume=sum(sum(verts[a][j]*(verts[b][(j+1)%3]*verts[c][(j+2)%3]-verts[b][(j+2)%3]*verts[c][(j+1)%3]) for j in range(3)) for a,b,c in tris)/6
        if volume<0: tris=[(a,c,b) for a,b,c in tris]
        edges={}
        for f in faces:
            for a,b in zip(f,f[1:]+f[:1]): edges[tuple(sorted((a,b)))]=edges.get(tuple(sorted((a,b))),0)+1
        assert all(v==2 for v in edges.values()),name+' open topology'
        data=self.groups.setdefault(mat,{'p':[],'n':[],'uv':[]})
        for a,b,c in tris:
            p,q,r=verts[a],verts[b],verts[c]; u=[q[i]-p[i] for i in range(3)]; v=[r[i]-p[i] for i in range(3)]
            n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; l=math.sqrt(sum(t*t for t in n))
            assert l>1e-9,name+' degenerate'
            n=[t/l for t in n]
            for p in (p,q,r): data['p']+=p; data['n']+=n; data['uv'] += [p[0]*.08,p[2]*.08+p[1]*.02]
        self.parts.append({'name':name,'triangles':len(tris),'volume':abs(volume)})
    def loft(self,name,rings,mat):
        n=len(rings[0]); v=[p for ring in rings for p in ring]; f=[]
        for j in range(len(rings)-1):
            for i in range(n): f.append([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i])
        f += [list(range(n-1,-1,-1)),list(range((len(rings)-1)*n,len(v)))]
        self.part(name,v,f,mat)
    def slab(self,name,poly,y,h,mat): self.loft(name,[[[x,y,z] for x,z in poly],[[x,y+h,z] for x,z in poly]],mat)
    def block(self,name,x,y,z,w,h,d,mat,bevel=.2):
        b=min(bevel,w*.2,d*.2)
        p=[(-w/2+b,-d/2),(w/2-b,-d/2),(w/2,-d/2+b),(w/2,d/2-b),(w/2-b,d/2),(-w/2+b,d/2),(-w/2,d/2-b),(-w/2,-d/2+b)]
        self.slab(name,[(a+x,c+z) for a,c in p],y,h,mat)
    def cylinder(self,name,x,y,z,r,h,mat,n=10): self.slab(name,[(x+math.cos(i*2*math.pi/n)*r,z+math.sin(i*2*math.pi/n)*r) for i in range(n)],y,h,mat)
    def write(self):
        binary=bytearray(); views=[]; acc=[]
        def add(buf):
            while len(binary)%4: binary.append(0)
            views.append({'buffer':0,'byteOffset':len(binary),'byteLength':len(buf) });binary.extend(buf); return len(views)-1
        def accessor(values,size,typ):
            vi=add(struct.pack('<'+'f'*len(values),*values)); a={'bufferView':vi,'componentType':5126,'count':len(values)//size,'type':typ}
            if typ=='VEC3': a.update(min=[min(values[i::size]) for i in range(size)],max=[max(values[i::size]) for i in range(size)])
            acc.append(a);return len(acc)-1
        prim=[]
        for mat,d in self.groups.items(): prim.append({'attributes':{'POSITION':accessor(d['p'],3,'VEC3'),'NORMAL':accessor(d['n'],3,'VEC3'),'TEXCOORD_0':accessor(d['uv'],2,'VEC2')},'material':mat})
        tex=add(normal)
        doc={'asset':{'version':'2.0','generator':'Midway original low-poly model authoring script'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':self.name}],'meshes':[{'name':self.name,'primitives':prim}],'materials':self.materials,'textures':[{'source':0,'sampler':0}],'images':[{'bufferView':tex,'mimeType':'image/png'}],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':acc,'extras':{'license':'CC0-1.0','originalAsset':True,'frame':'+Z forward, +Y up','parts':self.parts}}
        j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binary+=b'\0'*((-len(binary))%4)
        glb=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
        (OUT/(self.name+'.glb')).write_bytes(glb)
        print(self.name, sum(p['triangles'] for p in self.parts),'triangles',len(self.groups),'draws',len(glb),'bytes')

def aircraft(m,name,x=0,y=0,z=0,s=1,kind='f4f'):
    def pt(a,b,c):return [x+a*s,y+b*s,z+c*s]
    def body(part,sections,mat):
        m.loft(name+part,[[pt(math.cos(i*math.pi/4)*r,math.sin(i*math.pi/4)*r*.87,zz) for i in range(8)] for zz,r in sections],mat)
    body('fuselage',[(-3.9,.08),(-2.4,.28),(-.3,.60),(1.7,.67),(2.9,.55),(3.5,.3)],5)
    # 厚机翼，折线翼梢与渐缩后缘，避免无厚度单面片。
    wing=[(-5,-.7),(-4.7,1.0),(-.8,1.35),(.8,1.35),(4.7,1),(5,-.7),(1.2,-.5),(-1.2,-.5)]
    m.loft(name+'wing',[[pt(a,h,c) for a,c in wing] for h in [-.14,.08]],5)
    tail=[(-1.8,-3.55),(-1.6,-2.7),(0,-2.3),(1.6,-2.7),(1.8,-3.55)]
    m.loft(name+'tailplane',[[pt(a,h,c) for a,c in tail] for h in [.05,.18]],5)
    verts=[pt(a,b,c) for a in [-.07,.07] for b,c in [(.12,-3.7),(1.6,-3.5),(1.5,-2.8),(.12,-2.2)]]
    m.part(name+'tailfin',verts,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],5)
    # 机舱采用独立顶罩，主舱的底部藏于机身内。
    m.block(name+'cockpit',x,y+.42*s,z-.15*s,.65*s,.47*s,1.55*s,3,.15*s)
    m.block(name+'propeller',x,y-1.25*s,z+3.56*s,.10*s,2.5*s,.1*s,3,.015*s)
    for side in [-1,1]:
        m.cylinder(name+'roundel'+str(side),x+side*3.55*s,y+.085*s,z+.15*s,.43*s,.018*s,4 if m.jp else 2,12)
    if kind in ('sbd','d3a'):
        m.block(name+'divebrake',x,y-.18*s,z-1.15*s,5.4*s,.09*s,.38*s,4,.03*s)

def ship(name,jp=False,escort=False):
    m=Model(name,jp); width=8 if escort else 9
    stations=[(-50,.15),(-46,.7),(-35,.98),(-15,1),(18,1),(35,.88),(45,.46),(50,.035)]
    # V 型水下壳体，与外飘干舷同一连续封闭表面。
    rings=[]
    for z,k in stations:
        w=width*k;rings.append([[-w*.6,-4,z],[-w,-.4,z],[-w,3.8,z],[-w*.86,5,z],[w*.86,5,z],[w,3.8,z],[w,-.4,z],[w*.6,-4,z]])
    m.loft('continuous shaped hull',rings,0)
    if not escort:
        p=[(-7,-48),(7,-48),(10,-43),(10,36),(6,49),(-6,49),(-10,39),(-10,-42)]
        m.slab('flight deck rim',p,5,.75,0); m.slab('teak deck',[(a*.985,b*.996) for a,b in p],5.75,.12,1)
        for xx in [-7.2,7.2]:m.block('deck edge stripe',xx,5.885,0,.22,.018,82,2,.02)
        for zz in range(-39,43,8): m.block('center dashed line',-1.2,5.9,zz,.32,.025,4.0,2,.02)
        for zz in [-34,-31,-28]:m.block('arrestor cable',0,5.93,zz,14,.025,.11,3,.01)
        side=-1 if name=='akagi' else 1; ix=side*7.1
        m.block('island foundation',ix,5.87,9,4.4,3.4,15,0,.5)
        m.block('island bridge',ix,9.27,12,4.2,2.5,8,0,.45)
        m.block('bridge window band',ix,10.1,12,4.22,.7,8.02,3,.4)
        m.block('bridge roof',ix,11.77,12,4.6,.4,8.5,2,.4)
        m.block('funnel',ix,9.27,3,3.3,5,4.3,0,.6)
        m.block('funnel cap',ix,14.27,3,3.35,.4,4.35,3,.6)
        m.cylinder('mast',ix,12.17,12,.19,8,0)
        m.block('radar crossbar',ix,18.5,12,5,.18,.18,0,.03)
        if jp: m.cylinder('sun deck marking',0,5.91,31,4,.018,4,24)
        else:
            # 舰艉识别号的七段笔画，5 = Yorktown，6 = Enterprise。
            for xx,zz,ww,dd in [(0,-41,3,.35),(0,-38,3,.35),(0,-35,3,.35),(-1.4,-39.5,.35,3),(1.4,-36.5,.35,3)]+([(-1.4,-36.5,.35,3)] if name=='enterprise' else []):m.block('deck numeral',xx,5.93,zz,ww,.025,dd,2,.02)
        for i in range(5):aircraft(m,'parked '+str(i),-4.7,6.4,-19+i*8,.4,'zero' if jp else 'f4f')
        for zz in [-32,-12,29]:
            for sx in [-1,1]:
                m.block('AA sponson',sx*9.4,3.8,zz,3,1,4,0,.5)
                m.cylinder('AA mount',sx*9.4,4.8,zz,.6,.7,3)
    else:
        p=[(-5.6,-43),(5.6,-43),(7,25),(0,47),(-7,25)]
        m.slab('weather deck',p,5,.25,1)
        m.block('forward deck house',0,5.25,7,7,4,25,0,.75)
        m.block('bridge',0,9.25,13,6,2.7,9,0,.5)
        m.block('bridge glass',0,10.2,13,6.02,.65,9.02,3,.45)
        for z in [-8,-18]:m.cylinder('funnel',0,5.25,z,1.9,8,0,12);m.cylinder('funnel rim',0,13.25,z,1.92,.5,3,12)
        m.cylinder('mast',0,11.95,10,.22,9,0)
        for z in ([-34,-25,28,38] if name=='cruiser' else [-34,31]):
            m.cylinder('gun barbette',0,5.25,z,2.8,.9,0,12)
            m.block('gun turret',0,6.15,z,4.5,2.1,5,0,.5)
            for x in [-.8,.8]: m.block('gun barrel',x,7.4,z+4,.3,.3,6,3,.04)
    m.write()

for name in ['yorktown','enterprise','akagi','kaga','destroyer','cruiser']: ship(name,name in ['akagi','kaga'],name in ['destroyer','cruiser'])
for name in ['f4f','sbd','zero','d3a']:
    m=Model(name,name in ['zero','d3a']);aircraft(m,name,kind=name);m.write()
