import * as THREE from 'three';
import { CONFIG } from './config.js';

/** 固定容量粒子池。烟云使用程序噪声软边；火焰按年龄变为烟，不依赖后期泛光。 */
export class ParticleManager {
  constructor(scene) {
    this.count = CONFIG.maxParticles;this.cursor=0;this.activeCount=0;this.seed=421942;
    this.pool=Array.from({length:this.count},()=>({life:0,maxLife:1,x:0,y:-999,z:0,vx:0,vy:0,vz:0,size:1,type:'smoke',seed:0}));
    this.positions=new Float32Array(this.count*3);this.colors=new Float32Array(this.count*3);
    this.sizes=new Float32Array(this.count);this.alphas=new Float32Array(this.count);this.details=new Float32Array(this.count*3);
    this.geometry=new THREE.BufferGeometry();
    for(const [name,array,size] of [['position',this.positions,3],['color',this.colors,3],['size',this.sizes,1],['alpha',this.alphas,1],['detail',this.details,3]])this.geometry.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,vertexColors:true,toneMapped:false,
      uniforms:{scale:{value:420}},
      vertexShader:`attribute float size;attribute float alpha;attribute vec3 detail;varying vec3 vColor;varying float vAlpha;varying vec3 vDetail;uniform float scale;
      void main(){vColor=color;vAlpha=alpha;vDetail=detail;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size*scale/max(5.,-mv.z),0.,140.);}`,
      fragmentShader:`varying vec3 vColor;varying float vAlpha;varying vec3 vDetail;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){vec2 uv=(gl_PointCoord-.5)*2.;float d=length(uv);if(d>1.)discard;
      float angle=vDetail.z+vDetail.x*.4;mat2 rotation=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));vec2 p=rotation*uv;
      float cloud=noise(p*3.+vDetail.z)*.65+noise(p*7.+vDetail.z+vDetail.x)*.35;
      float edge=1.-smoothstep(.18,.98,d+(cloud-.5)*.3);float body=mix(.65,1.,cloud);
      float water=step(.5,vDetail.y);float opacity=mix(edge*body,pow(max(0.,1.-d*d),1.7),water);
      vec3 shaded=vColor*mix(.72,1.12,cloud+.15*p.y);gl_FragColor=vec4(shaded,vAlpha*opacity);if(gl_FragColor.a<.006)discard;
      #include <colorspace_fragment>
      }`});
    this.points=new THREE.Points(this.geometry,this.material);this.points.frustumCulled=false;this.points.renderOrder=3;scene.add(this.points);this.clear();
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  // 第四个可选参数供战斗特效使用；原来的三参数接口仍兼容。
  emit(position,type='explosion',count=25,{scale=1,velocity=null}={}){
    count=Math.min(this.count,Math.max(0,Math.floor(count)));scale=Math.max(.1,Math.min(6,scale));
    const wake=type==='wake',smoke=type==='smoke',flak=type==='flakSmoke',muzzle=type==='muzzle',shell=type==='shellSmoke',fire=type==='fire',splash=type==='splash';
    for(let i=0;i<count;i++){
      const p=this.pool[this.cursor];this.cursor=(this.cursor+1)%this.count;
      const angle=this.random()*Math.PI*2,strength=this.random()*(flak?13:muzzle?2:shell?1:fire?5:type==='explosion'?20:7)*scale;
      p.x=position.x;p.y=position.y;p.z=position.z;p.vx=Math.cos(angle)*strength;p.vz=Math.sin(angle)*strength;
      p.vy=wake?.1:splash?(10+this.random()*27)*scale:muzzle?1:flak?2+this.random()*4:3+this.random()*9*scale;
      if(velocity){const inherit=muzzle?.9:.14;p.vx+=velocity.x*inherit;p.vy+=velocity.y*inherit;p.vz+=velocity.z*inherit;}
      p.life=wake?2.2:muzzle?.28+this.random()*.3:shell?.75:flak?3.3+this.random()*1.4:smoke?4.5+this.random()*1.5:fire?3.5+this.random()*2:splash?1.5+this.random():2.5+this.random()*1.5;
      p.size=(wake?6:muzzle?1.8:shell?1.7:smoke?13:flak?9:splash?3:fire?9:6+this.random()*9)*scale;
      p.maxLife=p.life;p.type=type;p.seed=this.random()*100;
    }
  }
  update(dt){
    this.activeCount=0;
    for(let i=0;i<this.count;i++){
      const p=this.pool[i];p.life-=dt;if(p.life<=0){this.sizes[i]=0;this.alphas[i]=0;continue;}this.activeCount++;
      const wake=p.type==='wake',splash=p.type==='splash',muzzle=p.type==='muzzle',shell=p.type==='shellSmoke',flak=p.type==='flakSmoke',fire=p.type==='fire',explosion=p.type==='explosion';
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      if(splash)p.vy-=18*dt;else if(!wake){const drag=Math.exp(-dt*(muzzle?3:.9));p.vx*=drag;p.vz*=drag;if(fire||flak||explosion)p.vy+=dt*.65;}
      const fade=p.life/p.maxLife,age=1-fade,offset=i*3;
      this.positions[offset]=p.x;this.positions[offset+1]=p.y;this.positions[offset+2]=p.z;
      this.sizes[i]=p.size*(wake?1+age:1+age*(muzzle?2:flak?2.5:1.7));
      this.alphas[i]=fade*(wake?.23:muzzle?.22:shell?.22:flak?.83:.7)*Math.min(1,age*18+.2);
      let r=.12,g=.14,b=.16;
      if(wake||splash){r=.64;g=.84;b=.92;}
      else if(muzzle||shell){r=.24;g=.26;b=.27;}
      else if(flak){r=.055+age*.08;g=.057+age*.08;b=.059+age*.08;}
      else if(fire||explosion){
        // 白热火芯迅速衰减，随后留下不透明度较低的焦黑烟团。
        const heat=Math.max(0,1-age/(fire?.46:.3));r=.08+heat*1.55;g=.085+heat*heat*.87;b=.09+heat*heat*heat*.2;
      }
      this.colors[offset]=r;this.colors[offset+1]=g;this.colors[offset+2]=b;
      this.details[offset]=age;this.details[offset+1]=wake||splash?1:0;this.details[offset+2]=p.seed;
      if(splash&&p.y<-.3){p.life=0;this.alphas[i]=0;}
    }
    for(const attr of Object.values(this.geometry.attributes))attr.needsUpdate=true;
  }
  clear(){this.pool.forEach(p=>p.life=0);this.update(0);}
}
