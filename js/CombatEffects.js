import * as THREE from 'three';
import { PILOT } from './config.js';

// 所有弹道来自实际弹体；特效只负责表现，不生成命中、不改变碰撞判定。
const GLOW_LIMIT=96, SPARK_LIMIT=384, MUZZLE_LIMIT=48;
const quad=()=>{
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
  g.setIndex([0,1,2,0,2,3]);g.instanceCount=0;return g;
};
const noiseGLSL=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
`;

/** 固定容量：辉光、碎片、弹道各一次绘制，最多两盏无阴影瞬时灯。 */
export class CombatEffects {
  constructor(scene,particles){
    this.scene=scene;this.particles=particles;this.seed=19420604;this.time=0;
    this.glowCursor=0;this.sparkCursor=0;this.muzzleCursor=0;
    this.muzzles=Array.from({length:MUZZLE_LIMIT},()=>({life:0,total:1,p:new THREE.Vector3(),v:new THREE.Vector3(),d:new THREE.Vector3(),local:new THREE.Vector3(),anchor:null,size:1,seed:0,heavy:false}));
    this.glows=Array.from({length:GLOW_LIMIT},()=>({life:0,total:1,p:new THREE.Vector3(),v:new THREE.Vector3(),d:new THREE.Vector3(),size:1,kind:0,seed:0}));
    this.sparks=Array.from({length:SPARK_LIMIT},()=>({life:0,total:1,p:new THREE.Vector3(),v:new THREE.Vector3(),width:.1,seed:0}));
    this.glowGeometry=quad();this.glowData={};
    for(const [name,size] of [['origin',3],['direction',3],['effect',4],['elapsed',1]]){
      const a=new THREE.InstancedBufferAttribute(new Float32Array(GLOW_LIMIT*size),size).setUsage(THREE.DynamicDrawUsage);
      this.glowGeometry.setAttribute(name,a);this.glowData[name]=a;
    }
    // 正常混合保留烟炱与橙色层次，叠加多个火球也不会在明亮海面上变为白色剪影。
    this.glowMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,depthTest:true,blending:THREE.NormalBlending,toneMapped:false,
      vertexShader:`attribute vec3 origin;attribute vec3 direction;attribute vec4 effect;attribute float elapsed;varying vec2 vUv;varying vec4 vFx;varying float vSeconds;
      void main(){vUv=position.xy;vFx=effect;vSeconds=elapsed;vec4 center=viewMatrix*vec4(origin,1.);vec2 axis=(viewMatrix*vec4(direction,0.)).xy;
      axis=length(axis)>.001?normalize(axis):vec2(0.,1.);vec2 side=vec2(-axis.y,axis.x);
      float muzzle=1.-step(.5,effect.z);vec2 offset=mix(position.xy,side*position.x*.26+axis*(position.y+1.)*.75,muzzle);
      center.xy+=offset*effect.x;gl_Position=projectionMatrix*center;}`,
      fragmentShader:`varying vec2 vUv;varying vec4 vFx;varying float vSeconds;${noiseGLSL}
      void main(){float age=vFx.y;float radial=length(vUv);vec2 flow=vUv*4.+vec2(vFx.w,-age*3.);
      float n=noise(flow)*.64+noise(flow*2.3+noise(flow+4.))*.36;float edge=radial+(n-.5)*.38;
      float mask=1.-smoothstep(.52,1.,edge);float hot=pow(max(0.,1.-radial),2.5);
      float flameField=smoothstep(.25,.7,n)*(1.-smoothstep(.45,1.,radial))*(1.-age*.6);
      vec3 soot=vec3(.032,.023,.018);vec3 flame=mix(soot,vec3(.86,.075,.003),smoothstep(.05,.42,flameField));
      flame=mix(flame,vec3(1.,.40,.025),smoothstep(.4,.86,flameField));
      // 白热只存在于最初 75 毫秒、中心的狭小区域，随后只保留橙红火舌。
      float ignition=(1.-smoothstep(.02,.075,vSeconds))*pow(max(0.,1.-radial*2.8),2.);
      flame=mix(flame,vec3(1.,.95,.7),ignition);
      if(vFx.z<.5){float y=(vUv.y+1.)*.5;float taper=max(.02,(1.-y)*.72);mask=(1.-smoothstep(taper*.2,taper,abs(vUv.x)))*pow(1.-y,.55);hot=pow(max(0.,1.-abs(vUv.x)*4.),4.);flame=mix(vec3(1.,.21,.008),vec3(1.,.97,.73),hot);}
      float fade=pow(max(0.,1.-age),.8);gl_FragColor=vec4(flame,mask*fade*.95);if(gl_FragColor.a<.008)discard;
      #include <colorspace_fragment>
      }`});
    this.glowMesh=new THREE.Mesh(this.glowGeometry,this.glowMaterial);this.glowMesh.frustumCulled=false;this.glowMesh.renderOrder=5;scene.add(this.glowMesh);
    this.muzzleLayer=this.makeMuzzles();
    this.tracers=this.makeRibbons(PILOT.maxProjectiles);this.debris=this.makeRibbons(SPARK_LIMIT);
    this.lights=Array.from({length:2},()=>{const light=new THREE.PointLight(0xffb551,0,100,2);light.castShadow=false;scene.add(light);return {light,life:0,total:1,peak:0};});
    this.scratch=new THREE.Vector3();this.tempVelocity=new THREE.Vector3();this.counts={glows:0,sparks:0,tracers:0,lights:0};
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  makeMuzzles(){
    const geometry=quad(),data={};
    for(const [name,size] of [['origin',3],['direction',3],['effect',4]]){const a=new THREE.InstancedBufferAttribute(new Float32Array(MUZZLE_LIMIT*size),size).setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,a);data[name]=a;}
    // 枪口独立于爆炸火球：迎面看呈短促星芒，侧面看呈收束火舌，保留橙边与白热内芯。
    // NormalBlending 使正午白云前仍有橙色轮廓，不依赖后处理泛光维持可读性。
    const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,depthTest:true,blending:THREE.NormalBlending,toneMapped:false,
      vertexShader:`attribute vec3 origin;attribute vec3 direction;attribute vec4 effect;varying vec2 vUv;varying vec4 vFx;varying float vAxial;
      void main(){vUv=position.xy;vFx=effect;vec4 center=viewMatrix*vec4(origin,1.);vec3 facing=normalize((viewMatrix*vec4(direction,0.)).xyz);
      vAxial=smoothstep(.68,.97,abs(facing.z));vec2 axis=length(facing.xy)>.001?normalize(facing.xy):vec2(0.,1.);vec2 side=vec2(-axis.y,axis.x);
      vec2 shape=side*position.x*mix(.28,.45,vAxial)+axis*mix((position.y+.75)*.78,position.y*.45,vAxial);
      center.xy+=shape*effect.x;gl_Position=projectionMatrix*center;}`,
      fragmentShader:`varying vec2 vUv;varying vec4 vFx;varying float vAxial;${noiseGLSL}
      void main(){float age=vFx.y;float phase=vFx.z;float r=length(vUv),a=atan(vUv.y,vUv.x);
      float spike=.43+.24*pow(abs(cos(a*3.+phase)),10.)+.13*pow(abs(sin(a*5.-phase)),14.);
      float star=1.-smoothstep(spike-.12,spike+.10,r);
      float along=(vUv.y+1.)*.5;float taper=(1.-along)*.80+.02;
      float tongue=(1.-smoothstep(taper*.12,taper,abs(vUv.x)))*(1.-smoothstep(.65,1.,along));
      float mask=mix(tongue,star,vAxial);float core=mix(pow(max(0.,1.-abs(vUv.x)*4.),3.)*(1.-along*.75),1.-smoothstep(.06,.28,r),vAxial);
      float grain=noise(vUv*9.+phase+age*11.);float edge=clamp(mask*(.8+grain*.2),0.,1.);
      vec3 color=mix(vec3(.98,.22,.008),vec3(1.,.65,.09),smoothstep(.10,.65,mask));color=mix(color,vec3(1.,.99,.86),core);
      float pulse=(.84+.16*sin(age*31.+phase))*(1.-smoothstep(.56,1.,age));
      gl_FragColor=vec4(color,edge*pulse);if(gl_FragColor.a<.01)discard;
      #include <colorspace_fragment>
      }`});
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=6;this.scene.add(mesh);return {mesh,geometry,material,data};
  }
  makeRibbons(limit){
    const geometry=quad(),data={};
    for(const [name,size] of [['head',3],['tail',3],['style',4]]){const a=new THREE.InstancedBufferAttribute(new Float32Array(limit*size),size).setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,a);data[name]=a;}
    const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,depthTest:true,blending:THREE.NormalBlending,toneMapped:false,
      vertexShader:`attribute vec3 head;attribute vec3 tail;attribute vec4 style;varying vec2 vUv;varying vec4 vStyle;
      void main(){vUv=position.xy;vStyle=style;vec4 a=viewMatrix*vec4(tail,1.),b=viewMatrix*vec4(head,1.);vec2 delta=b.xy/max(.01,-b.z)-a.xy/max(.01,-a.z);vec2 axis=length(delta)>.000001?normalize(delta):vec2(0.,1.);
      // 沿枪轴观察时，真实弹道会投影成一个点；保留约两倍弹宽的短尾，避免曳光完全消失。
      float minLength=style.x*2.6/max(1.,-b.z);float extra=max(0.,minLength-length(delta));a.xy-=axis*extra*max(.01,-a.z);
      vec4 p=mix(a,b,(position.y+1.)*.5);p.xy+=vec2(-axis.y,axis.x)*position.x*style.x;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`varying vec2 vUv;varying vec4 vStyle;void main(){float x=abs(vUv.x),y=(vUv.y+1.)*.5;float edge=1.-smoothstep(.60,1.,x);float core=1.-smoothstep(.08,.36,x);float tail=smoothstep(0.,.24,y);vec3 shell=mix(vec3(.42,.08,.012),vec3(.58,.18,.025),vStyle.z);vec3 fire=mix(vec3(1.,.47,.045),vec3(1.,.70,.19),vStyle.y);vec3 color=mix(shell,fire,1.-smoothstep(.32,.76,x));color=mix(color,vec3(1.,.99,.88),core);gl_FragColor=vec4(color,edge*tail*vStyle.w);if(gl_FragColor.a<.01)discard;
      #include <colorspace_fragment>
      }`});
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=4;this.scene.add(mesh);return {mesh,geometry,material,data,limit};
  }
  glow(position,velocity,direction,size,life,kind=1){
    const p=this.glows[this.glowCursor++%GLOW_LIMIT];p.p.copy(position);p.v.copy(velocity||this.tempVelocity.set(0,0,0));p.d.copy(direction||this.tempVelocity.set(0,1,0));p.size=size;p.life=p.total=life;p.kind=kind;p.seed=this.random()*100;
  }
  spark(position,scale,velocity=null){
    const p=this.sparks[this.sparkCursor++%SPARK_LIMIT],angle=this.random()*Math.PI*2,speed=(8+this.random()*38)*scale;
    p.p.copy(position);p.v.set(Math.cos(angle)*speed,(this.random()*.9+.15)*speed,Math.sin(angle)*speed);if(velocity)p.v.addScaledVector(velocity,.2);
    p.life=p.total=.45+this.random()*1.35;p.width=(.075+this.random()*.1)*Math.min(scale,2);p.seed=this.random();
  }
  flashLight(position,scale){
    let lamp=this.lights[0];if(this.lights[1].life<lamp.life)lamp=this.lights[1];lamp.light.position.copy(position);lamp.life=lamp.total=.19;lamp.peak=900*Math.min(8,scale*scale);lamp.light.distance=70+scale*35;
  }
  muzzle(position,direction,{heavy=false,velocity=null,anchor=null,localOffset=null}={}){
    const p=this.muzzles[this.muzzleCursor++%MUZZLE_LIMIT];p.p.copy(position);p.d.copy(direction);p.v.copy(velocity||this.tempVelocity.set(0,0,0));
    p.life=p.total=heavy?.12:.095;p.size=heavy?5:2.5;p.seed=this.random()*40;p.heavy=heavy;p.anchor=anchor;
    if(anchor){p.local.copy(localOffset||position);if(!localOffset)anchor.worldToLocal(p.local);}
    this.particles.emit(position,'muzzle',heavy?3:1,{velocity,scale:heavy?1.3:.8});
    if(heavy)this.flashLight(position,.75);
  }
  burst(position,kind='explosion',scale=1,velocity=null){
    scale=Math.max(.1,Math.min(scale,6));
    if(kind==='fire'){this.glow(position,velocity,null,5*scale,.55);this.particles.emit(position,'fire',3,{scale,velocity});return;}
    if(kind==='splash'){this.particles.emit(position,'splash',Math.min(36,Math.ceil(22*scale)),{scale,velocity});return;}
    if(kind==='impact'){
      this.glow(position,velocity,null,1.6*scale,.12);for(let i=0;i<7;i++)this.spark(position,scale,velocity);this.particles.emit(position,'smoke',2,{scale:.22*scale,velocity});return;
    }
    const ship=kind==='ship',flak=kind==='flak',size=(ship?12:flak?7:9)*scale;
    this.glow(position,velocity,null,size,flak?.22:.44);
    for(let i=0;i<(ship?5:3);i++){
      this.scratch.copy(position);this.scratch.x+=(this.random()-.5)*size;this.scratch.y+=this.random()*size*.5;this.scratch.z+=(this.random()-.5)*size;
      this.glow(this.scratch,velocity,null,size*(.45+this.random()*.4),ship?1.1+this.random():flak?.2+this.random()*.15:.35+this.random()*.35);
    }
    for(let i=0;i<(ship?34:flak?16:26);i++)this.spark(position,scale*(flak?.7:1.2),velocity);
    this.particles.emit(position,flak?'flakSmoke':ship?'fire':'explosion',ship?22:flak?12:18,{scale,velocity});
    if(ship)this.particles.emit(position,'smoke',14,{scale:1.4*scale});this.flashLight(position,scale*(ship?2:1));
  }
  writeRibbon(target,index,head,tail,width,white,heavy,alpha){
    target.data.head.setXYZ(index,head.x,head.y,head.z);target.data.tail.setXYZ(index,tail.x,tail.y,tail.z);target.data.style.setXYZW(index,width,white,heavy,alpha);
  }
  update(dt,camera,projectiles=[]){
    dt=Math.max(0,Math.min(dt,.1));this.time+=dt;let n=0;
    for(const p of this.muzzles){if(p.life<=0)continue;p.life-=dt;if(p.life<=0){p.anchor=null;continue;}
      if(p.anchor){p.p.copy(p.local);p.anchor.localToWorld(p.p);p.d.set(0,0,1).transformDirection(p.anchor.matrixWorld);}else p.p.addScaledVector(p.v,dt);
      const age=1-p.life/p.total;this.muzzleLayer.data.origin.setXYZ(n,p.p.x,p.p.y,p.p.z);this.muzzleLayer.data.direction.setXYZ(n,p.d.x,p.d.y,p.d.z);this.muzzleLayer.data.effect.setXYZW(n,p.size,age,p.seed,p.heavy?1:0);n++;}
    this.muzzleLayer.geometry.instanceCount=n;this.counts.muzzles=n;for(const a of Object.values(this.muzzleLayer.data))a.needsUpdate=true;
    n=0;
    for(const p of this.glows){if(p.life<=0)continue;p.life-=dt;if(p.life<=0)continue;p.p.addScaledVector(p.v,dt);const age=1-p.life/p.total;
      this.glowData.origin.setXYZ(n,p.p.x,p.p.y,p.p.z);this.glowData.direction.setXYZ(n,p.d.x,p.d.y,p.d.z);this.glowData.effect.setXYZW(n,p.size*(p.kind===0?1:1+age*.65),age,p.kind,p.seed);this.glowData.elapsed.setX(n,p.total-p.life);n++;}
    this.glowGeometry.instanceCount=n;this.counts.glows=n;for(const a of Object.values(this.glowData))a.needsUpdate=true;
    n=0;for(const p of this.sparks){if(p.life<=0)continue;p.life-=dt;if(p.life<=0)continue;p.v.y-=14*dt;p.v.multiplyScalar(Math.exp(-dt*.6));p.p.addScaledVector(p.v,dt);if(p.p.y<0){p.life=0;continue;}
      this.scratch.copy(p.p).addScaledVector(p.v,-.045);this.writeRibbon(this.debris,n++,p.p,this.scratch,p.width,0,1,Math.min(1,p.life/.3));}
    this.debris.geometry.instanceCount=n;this.counts.sparks=n;for(const a of Object.values(this.debris.data))a.needsUpdate=true;
    n=0;for(const p of projectiles){if(n>=this.tracers.limit)break;if(p.life<=0)continue;
      const elapsed=Number.isFinite(p.age)?p.age:.08,tailTime=Math.min(elapsed,p.flak?.055:.027);
      this.scratch.copy(p.position).addScaledVector(p.velocity,-tailTime);
      // 光带宽度有世界单位上限，不能成为穿过整片天空的激光。
      const distance=camera?camera.position.distanceTo(p.position):100,width=Math.min(p.flak?1.1:.52,(p.flak?.3:.18)+distance*.00065);
      this.writeRibbon(this.tracers,n++,p.position,this.scratch,width,p.team==='us'?1:0,p.flak?1:0,.98);
      if(p.flak&&dt>0){p.vfxSmokeClock=(p.vfxSmokeClock||0)+dt;if(p.vfxSmokeClock>.12){p.vfxSmokeClock%=.12;this.particles.emit(p.position,'shellSmoke',1,{scale:.45});}}
    }
    this.tracers.geometry.instanceCount=n;this.counts.tracers=n;for(const a of Object.values(this.tracers.data))a.needsUpdate=true;
    this.counts.lights=0;for(const lamp of this.lights){lamp.life=Math.max(0,lamp.life-dt);lamp.light.intensity=lamp.peak*Math.pow(lamp.life/lamp.total,2);if(lamp.life>0)this.counts.lights++;}
  }
  clear(){for(const p of this.glows)p.life=0;for(const p of this.sparks)p.life=0;for(const p of this.muzzles){p.life=0;p.anchor=null;}for(const l of this.lights){l.life=0;l.light.intensity=0;}this.glowCursor=0;this.sparkCursor=0;this.muzzleCursor=0;this.update(0,null,[]);}
  get diagnostics(){return {...this.counts,capacities:{glows:GLOW_LIMIT,sparks:SPARK_LIMIT,muzzles:MUZZLE_LIMIT,tracers:this.tracers.limit,lights:2},drawCalls:4,depthTest:true,pooled:true,muzzleLifetime:.095,tracerMaxWidth:.52};}
}
