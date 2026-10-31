/**
 * Tidewater 海面移植：JONSWAP 频谱、三层 FFT、解析导数、Jacobian 泡沫历史、
 * 阵风粗糙度、Fresnel 天空反射、海水吸收与波峰散射。
 * 原项目：/tidewater/src/ocean/{OceanFFT,WaterSurface,WaterMaterial,SeaDetail,SurfFoam}.js
 * 原版 WebGPU 工作组 FFT 改为 WebGL2 MRT 片元 FFT；不依赖框架/打包/外部资源。
 * 兼容层限制：不包含原项目的水下视角、SSR、动态海底折射、岸浪流体求解。
 * MIT License — Copyright (c) 2026 DRG Software Solutions LLC
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import * as THREE from '../vendor/three.module.js';
import {CASCADE_LENGTHS,createSpectrum,spectralBuoyancy} from './TidewaterSpectrum.js';
import {TidewaterFFT,target,computeMaterial,validateTidewaterFFT} from './TidewaterFFT.js';
const LENGTHS=CASCADE_LENGTHS.map(n=>n.toFixed(3)).join(',');
const COMMON=`
  uniform sampler2D uA;uniform sampler2D uB;uniform sampler2D uFoam;
  uniform float uTime;uniform float uN;uniform float uPixelAngle;
  const float lengths[3]=float[3](${LENGTHS});
  const float chop=.9;
  float coastDistance(vec2 p){vec2 q=(p-vec2(-420.,140.))/vec2(125.,86.);float a=atan(q.y,q.x);return (length(q)-(1.+.045*sin(a*5.)+.025*cos(a*9.)))*100.;}
  float seaDepth(vec2 p){float d=max(coastDistance(p),0.);return .7+d*.28+d*d*.003;}
  float footprint(vec3 p){vec3 d=cameraPosition-p;return dot(d,d)*uPixelAngle/max(abs(cameraPosition.y-p.y),.5);}
  float keepBand(int c,float fp){float smallest=c==0?26.167:c==1?5.55:1.1;return 1.-smoothstep(smallest*.22,smallest*.8,fp);}
  float depthKeep(int c,float depth){float d=c==0?40.:c==1?12.56:2.664;return mix(c==0?0.:c==1?.05:.25,1.,smoothstep(0.,d,depth));}
  // Atlas 的每一层独立周期双线性采样，避免层边缘串色与 FFT 接缝。
  vec4 sampleBand(sampler2D source,vec2 p,int c){
    vec2 q=fract(p/lengths[c])*uN;ivec2 i=ivec2(floor(q));vec2 f=fract(q);int n=int(uN);
    int x0=i.x%n,x1=(i.x+1)%n,z0=i.y%n+c*n,z1=(i.y+1)%n+c*n;
    return mix(mix(texelFetch(source,ivec2(x0,z0),0),texelFetch(source,ivec2(x1,z0),0),f.x),mix(texelFetch(source,ivec2(x0,z1),0),texelFetch(source,ivec2(x1,z1),0),f.x),f.y);
  }
  float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
`;
export class TidewaterOcean {
  constructor(scene,renderer,skyCube,{mobile=false}={}){
    this.renderer=renderer;this.scene=scene;this.mobile=mobile;
    this.resolution=this.mobile?64:128;this.lengths=CASCADE_LENGTHS;this.lastTime=-1;
    const n=this.resolution;this.spectrumData=createSpectrum(n);
    this.spectrum=new THREE.DataTexture(this.spectrumData.packed,n,n*3,THREE.RGBAFormat,THREE.FloatType);this.spectrum.needsUpdate=true;
    this.fft=new TidewaterFFT(renderer,n,3);this.frequency=target(n,3);
    this.foamTargets=[target(n,3,1),target(n,3,1)];this.foamIndex=0;
    this.evolve=computeMaterial(`
      precision highp float;precision highp int;
      uniform sampler2D uInitial;uniform float uTime;
      layout(location=0)out vec4 outA;layout(location=1)out vec4 outB;
      const float lengths[3]=float[3](${LENGTHS});
      vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
      void main(){ivec2 cell=ivec2(gl_FragCoord.xy);int c=cell.y/${n};vec2 k=vec2(float(cell.x-${n/2}),float(cell.y%${n}-${n/2}))*(6.28318530718/lengths[c]);
        float len=max(length(k),.00001),ik=1./len,omega=sqrt(9.81*len*tanh(min(len*500.,20.)));
        vec4 initial=texelFetch(uInitial,cell,0);vec2 phase=vec2(cos(omega*uTime),sin(omega*uTime));
        vec2 h=cmul(initial.xy,phase)+cmul(initial.zw,vec2(phase.x,-phase.y));
        float fx=k.x*ik,fz=k.y*ik,q=-k.x*k.y*ik,a=-k.x*k.x*ik,b=-k.y*k.y*ik;
        // 四个复数 IFFT 各装两个实值场，完整保留水平交叉导数。
        outA=vec4(-(fx*h.y+fz*h.x),fx*h.x-fz*h.y,h.x-q*h.y,h.y+q*h.x);
        outB=vec4(-(k.x*h.y+k.y*h.x),k.x*h.x-k.y*h.y,a*h.x-b*h.y,a*h.y+b*h.x);
      }`,{uInitial:{value:this.spectrum},uTime:{value:0}});
    this.foamMaterial=computeMaterial(`
      precision highp float;uniform sampler2D uA;uniform sampler2D uB;uniform sampler2D uPrevious;uniform float uDt;
      out vec4 outColor;
      void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 a=texelFetch(uA,p,0),b=texelFetch(uB,p,0);
        float J=(1.+.9*b.z)*(1.+.9*b.w)-pow(.9*a.w,2.);
        float gen=clamp((.82-J)*3.,0.,1.);float prev=texelFetch(uPrevious,p,0).r;
        float foam=clamp(max(prev*exp(-.35*uDt)+gen*2.5*uDt,gen*.5),0.,1.5);
        outColor=vec4(foam,J,0.,1.);
      }`,{uA:{value:null},uB:{value:null},uPrevious:{value:null},uDt:{value:0}});
    const uniforms={uA:{value:null},uB:{value:null},uFoam:{value:null},uN:{value:n},uTime:{value:0},uPixelAngle:{value:.001},uSky:{value:skyCube},uSun:{value:new THREE.Vector3(-700,1100,-900).normalize()},uDebug:{value:0}};
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,
      vertexShader:COMMON+`
        out vec3 vWorld;out vec2 vBase;out float vHeight;
        void main(){vec3 p=(modelMatrix*vec4(position,1.)).xyz;vBase=p.xz;
          float fp=footprint(p),depth=seaDepth(p.xz);vec3 displacement=vec3(0.);
          for(int c=0;c<3;c++){vec4 a=sampleBand(uA,p.xz,c);float w=keepBand(c,fp)*depthKeep(c,depth);displacement+=vec3(a.x*chop,a.z,a.y*chop)*w;}
          p+=displacement;vHeight=displacement.y;vWorld=p;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
        }`,
      fragmentShader:COMMON+`
        uniform samplerCube uSky;uniform vec3 uSun;uniform int uDebug;
        in vec3 vWorld;in vec2 vBase;in float vHeight;out vec4 outColor;
        #define gl_FragColor outColor
        void main(){
          float fp=max(footprint(vWorld),length(fwidth(vBase)));float depth=seaDepth(vBase);
          vec4 A=vec4(0.),B=vec4(0.);float foam=0.;
          for(int c=0;c<3;c++){float w=keepBand(c,fp)*depthKeep(c,depth);A+=sampleBand(uA,vBase,c)*w;B+=sampleBand(uB,vBase,c)*w;foam+=sampleBand(uFoam,vBase,c).r*w*(c==0?.35:c==1?.45:.5);}
          // 切向量来自同一 FFT 位移的一阶导数，包含 choppy 交叉项。
          vec3 dx=vec3(1.+chop*B.z,B.x,chop*A.w),dz=vec3(chop*A.w,B.y,1.+chop*B.w);
          vec3 N=normalize(cross(dz,dx));vec3 V=normalize(cameraPosition-vWorld);
          N=normalize(N+V*max(-dot(N,V)+.03,0.));
          vec2 wind=vec2(.9063,.4226),p=vBase-wind*uTime*4.9;
          float gust=clamp((noise(p/150.)*.62+noise(p/58.+vec2(uTime*.0009,.37))*.38-.5)*2.4+.5,0.,1.);
          float across=dot(vBase,vec2(-wind.y,wind.x))+(noise(p/58.)-.5)*26.;
          float slick=smoothstep(.64,.76,noise(vec2(dot(vBase,wind)/275.,across/17.5)))*(1.-gust*.8)*.67;
          float rough=mix(.5,1.5,gust)*(1.-slick*.8);
          float unresolved=clamp(log2(max(110.*fp/3.14159,.0001))/9.,0.,1.);
          float mss=.003+7.*.00512,alpha2=.0064+mss*2.*unresolved*rough*rough+foam*.12;
          vec3 R=reflect(-V,N);R.y=max(R.y,.004)+sqrt(mss*unresolved)*rough*1.3*(1.-max(R.y,0.));
          vec3 reflected=texture(uSky,normalize(R)).rgb;
          float ndv=max(dot(N,V),.001),F=.02037+(1.-.02037)*pow(1.-ndv,5.);
          // Beer–Lambert 浅滩吸收；海底是岛屿岸线一致的解析沙床，不是屏幕贴图。
          vec3 absorption=vec3(.14,.052,.028),deep=vec3(.008,.073,.102);
          vec3 transmittance=exp(-absorption*depth/max(ndv,.35));
          vec3 sand=vec3(.39,.36,.22)*( .92+.08*noise(vBase*.09));
          vec3 water=mix(deep,sand,transmittance);
          float back=pow(clamp(dot(normalize(V.xz+vec2(.0001)),-normalize(uSun.xz))*.6+.4,0.,1.),2.5);
          float crest=clamp(vHeight*.9+.1,0.,1.)*(clamp((1.-N.y)*4.,0.,1.)+.25);
          water+=vec3(.12,.55,.45)*.18*back*crest;
          vec3 H=normalize(V+uSun);float ndh=max(dot(N,H),0.),ndl=max(dot(N,uSun),0.);
          float denominator=ndh*ndh*(alpha2-1.)+1.;float D=alpha2/(3.14159265*denominator*denominator);
          float Gv=2.*ndv/(ndv+sqrt(alpha2+(1.-alpha2)*ndv*ndv));
          float Gl=2.*ndl/(ndl+sqrt(alpha2+(1.-alpha2)*ndl*ndl));
          float sunF=.02037+.97963*pow(1.-max(dot(V,H),0.),5.);
          vec3 color=mix(water,reflected,F)+vec3(1.,.94,.82)*(D*Gv*Gl*sunF/max(4.*ndv,.02))*2.6;
          float shore=coastDistance(vBase);float foamPatch=noise(vBase*.07+uTime*.035)*.65+noise(vBase*.19-uTime*.04)*.35;
          float surge=2.2+2.*noise(vBase*.025+uTime*.1)+vHeight;
          float shoreFoam=(1.-smoothstep(1.,6.,abs(shore-surge)))*smoothstep(.27,.65,foamPatch)*.48;
          foam=clamp(max(foam,shoreFoam),0.,.94);
          // 近处泡沫的孔洞随覆盖率阈值形成；低于像素分辨率时回归平均覆盖率。
          float lace=mix(smoothstep(.25,.7,noise(vBase*.8)),.62,smoothstep(.12,1.,fp));
          color=mix(color,vec3(.71,.79,.77)*(.75+.25*ndl),foam*(.6+.4*lace));
          float distanceToEye=length(cameraPosition-vWorld);float haze=1.-exp(-distanceToEye*.00019);
          color=mix(color,vec3(.48,.69,.77),haze);
          if(uDebug==1)color=vec3(vHeight*.18+.5);if(uDebug==2)color=N*.5+.5;if(uDebug==3)color=vec3(foam);
          if(uDebug==4)color=vec3(clamp((1.+chop*B.z)*(1.+chop*B.w)-pow(chop*A.w,2.),0.,1.));
          outColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const segments=this.mobile?128:192,geo=new THREE.PlaneGeometry(2,2,segments,segments);geo.rotateX(-Math.PI/2);
    const positions=geo.attributes.position;for(let i=0;i<positions.count;i++){const x=positions.getX(i),z=positions.getZ(i);positions.setXYZ(i,Math.sign(x)*Math.pow(Math.abs(x),3)*6000,0,Math.sign(z)*Math.pow(Math.abs(z),3)*6000);}positions.needsUpdate=true;
    this.root=new THREE.Group();this.root.name='Tidewater spectral Pacific';this.water=new THREE.Mesh(geo,this.material);this.water.frustumCulled=false;this.root.add(this.water);scene.add(this.root);this.meshes=[this.water];
    this._size=new THREE.Vector2();
    this.diagnostics={backend:'WebGL2 MRT fragment FFT',resolution:n,cascades:3,seed:1337,passes:2*Math.log2(n)+5,triangles:segments*segments*2,bands:this.spectrumData.bands,buoyancy:'same-spectrum strongest 24 long modes (CPU approximation)'};
    // 构造阶段即完成初始 FFT，避免首帧读取未初始化的位移/泡沫。
    const saved=renderer.getRenderTarget();const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
    try{renderer.setClearColor(0,0);for(const t of this.foamTargets){renderer.setRenderTarget(t);renderer.clear();}this.simulate(0,0);}finally{renderer.setRenderTarget(saved);renderer.setClearColor(clear,alpha);}
  }
  simulate(time,dt){
    const renderer=this.renderer,saved=renderer.getRenderTarget(),savedAuto=renderer.autoClear;
    try{
      renderer.autoClear=true;this.evolve.uniforms.uTime.value=time;this.fft.draw(this.evolve,this.frequency);
      const maps=this.fft.transform(this.frequency.textures),f=this.foamMaterial.uniforms;
      f.uA.value=maps[0];f.uB.value=maps[1];f.uPrevious.value=this.foamTargets[this.foamIndex].texture;f.uDt.value=Math.min(Math.max(dt,0),.1);
      this.foamIndex=1-this.foamIndex;this.fft.draw(this.foamMaterial,this.foamTargets[this.foamIndex]);
      Object.assign(this.material.uniforms.uA,{value:maps[0]});this.material.uniforms.uB.value=maps[1];this.material.uniforms.uFoam.value=this.foamTargets[this.foamIndex].texture;
      this.material.uniforms.uTime.value=time;this.lastTime=time;
    }finally{renderer.setRenderTarget(saved);renderer.autoClear=savedAuto;}
  }
  update(time,dt,camera,ships=[]){
    if(time!==this.lastTime)this.simulate(time,dt);
    if(camera){this.renderer.getDrawingBufferSize(this._size);this.material.uniforms.uPixelAngle.value=2*Math.tan(camera.fov*Math.PI/360)/Math.max(this._size.y,1);
      this.root.position.set(Math.round(camera.position.x/32)*32,0,Math.round(camera.position.z/32)*32);}
  }
  getHeight(x,z,time){return spectralBuoyancy(this.spectrumData.modes,x,z,time);}
  validateFFT(){return validateTidewaterFFT(this.renderer);}
  dispose(){this.scene.remove(this.root);this.water.geometry.dispose();this.material.dispose();this.spectrum.dispose();this.frequency.dispose();this.foamTargets.forEach(t=>t.dispose());this.evolve.dispose();this.foamMaterial.dispose();this.fft.dispose();}
}
