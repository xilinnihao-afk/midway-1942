import * as THREE from '../vendor/three.module.js';

// Tidewater 天空的轻量 WebGL2 改写：天气覆盖 + 高度塑形 + 侵蚀 + 短太阳光线积分。
// 不是完整的 WebGPU LUT/TAA 管线；远景云写入共享立方体，天空和海面看到同一片云。
const SKY_FRAGMENT = /* glsl */`
precision highp sampler3D;
uniform sampler3D uShape;
uniform vec3 uSun;
uniform float uTime;
varying vec3 vDirection;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float weather(vec2 p){return .60*noise2(p)+.28*noise2(p*2.03+17.)+.12*noise2(p*4.07+9.);}
float hg(float mu,float g){float q=max(.01,1.+g*g-2.*g*mu);return (1.-g*g)/(12.56637*q*sqrt(q));}
vec3 atmosphere(vec3 rd){
  float h=max(rd.y,0.);
  float mu=dot(rd,uSun);
  // 海洋边界层的长光程淡化地平线，天顶保留瑞利蓝；太阳使用同一方向。
  float horizon=exp(-h*5.5);
  vec3 rayleigh=mix(vec3(.075,.255,.53),vec3(.66,.82,.90),horizon);
  float phase=.75*(1.+mu*mu);
  rayleigh*=mix(.91,1.10,phase*.65);
  float mie=hg(mu,.80)*.16;
  return rayleigh+vec3(1.,.88,.69)*mie;
}
float density(vec3 p,bool detail){
  float h=(p.y-1100.)/3200.;
  if(h<0.||h>1.)return 0.;
  vec2 wind=vec2(10.,4.)*uTime;
  p.xz-=wind+vec2(h*280.,h*60.);
  float w=weather(p.xz/6700.+vec2(2.1,5.4));
  // 按天气控制云底区域，云顶由三维形状膨胀成菜花状，而非一整层噪声雾。
  float floorMask=smoothstep(.34,.56,w);
  if(floorMask<.01)return 0.;
  vec3 shape=texture(uShape,p/4200.).rgb;
  float top=w+.61-1.+dot(shape,vec3(.70,.41,.23))*.66*.61;
  float erosion=0.;
  if(detail){vec3 fine=texture(uShape,p/710.).rgb;erosion=dot(fine,vec3(.113,.04,.02))*mix(.24,1.6,clamp(h/max(top,.01),0.,1.))*.61;}
  float edge=.055*exp2(-h);
  return smoothstep(-edge,edge,top-erosion-h)*smoothstep(0.,.045,h-erosion*.2)*floorMask;
}
void main(){
  vec3 rd=normalize(vDirection);
  vec3 sky=atmosphere(rd);
  float mu=dot(rd,uSun);
  float sunDisk=smoothstep(cos(.0065),cos(.0045),mu);
  sky+=vec3(5.,4.5,3.5)*sunDisk;
  // 高空薄卷云：独立高度、风向与密度，不与积云共享轮廓。
  if(rd.y>.025){
    vec2 uv=rd.xz/max(rd.y,.035)*1.8+vec2(uTime*.0008,-uTime*.0012);
    float cirrus=smoothstep(.62,.86,weather(uv*vec2(.4,2.8)+15.));
    cirrus*=smoothstep(.02,.3,rd.y)*.18;
    sky=mix(sky,vec3(1.15,1.22,1.27),cirrus);
  }
  if(rd.y>.018){
    // 仅在占据高度区间内积分，最多 30 km；所有可玩飞机均在云底以下。
    vec3 origin=vec3(0.,350.,0.);
    float nearT=(1100.-origin.y)/rd.y;
    float farT=min((4300.-origin.y)/rd.y,30000.);
    if(farT>nearT){
      float stepT=(farT-nearT)/float(CLOUD_STEPS);
      float trans=1.;vec3 lightSum=vec3(0.);
      float phase=hg(mu,.7)*.8+hg(mu,-.2)*.2;
      for(int i=0;i<CLOUD_STEPS;i++){
        float t=nearT+(float(i)+.5)*stepT;
        vec3 p=origin+rd*t;
        float d=density(p,true);
        if(d>.008){
          float h=clamp((p.y-1100.)/1450.,0.,1.);
          float optical=density(p+uSun*160.,false)*220.+density(p+uSun*460.,false)*480.+density(p+uSun*1100.,false)*650.;
          float tau=optical*.006;
          // 短光程阴影、前向银边和多次散射近似，使亮云顶与蓝灰云底有体积感。
          float direct=exp(-tau)*(.9+phase*2.5)+.34*exp(-tau*.20);
          float baseShadow=mix(.42,1.,smoothstep(0.,.48,h));
          vec3 ambient=mix(vec3(.27,.37,.50),vec3(.71,.80,.90),sqrt(h));
          vec3 light=ambient+vec3(1.14,1.08,.96)*direct*baseShadow;
          float stepTrans=exp(-d*.006*stepT);
          float haze=exp(-t/34000.);
          light=mix(atmosphere(rd),light,haze);
          lightSum+=trans*(1.-stepTrans)*light;
          trans*=stepTrans;
          if(trans<.015)break;
        }
      }
      sky=sky*trans+lightSum;
    }
  }
  // 输出线性 HDR；只由主渲染器执行一次 ACES/色彩编码。
  gl_FragColor=vec4(sky,1.);
}
`;

// 一次性生成可平铺三维形状场：主形状和细节由不同频段组成，帧间只平移采样位置。
function makeShapeTexture(){
  const size=48,data=new Uint8Array(size*size*size*4);
  const fract=x=>x-Math.floor(x),smooth=x=>x*x*(3-2*x);
  const hash=(x,y,z,n)=>fract(Math.sin(((x%n+n)%n)*127.1+((y%n+n)%n)*311.7+((z%n+n)%n)*74.7)*43758.5453);
  const noise=(x,y,z,n)=>{
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=smooth(fract(x)),fy=smooth(fract(y)),fz=smooth(fract(z));
    let result=0;
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)result+=hash(ix+i,iy+j,iz+k,n)*(i?fx:1-fx)*(j?fy:1-fy)*(k?fz:1-fz);
    return result;
  };
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=((z*size+y)*size+x)*4;
    for(let c=0;c<3;c++){
      const n=4*2**c;
      data[i+c]=Math.round(255*noise(x/size*n,y/size*n,z/size*n,n));
    }
    data[i+3]=255;
  }
  const texture=new THREE.Data3DTexture(data,size,size,size);
  texture.format=THREE.RGBAFormat;texture.type=THREE.UnsignedByteType;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;
  texture.unpackAlignment=1;texture.needsUpdate=true;
  return texture;
}

export class TidewaterSky {
  constructor(scene,renderer,{mobile=false}={}){
    this.renderer=renderer;this.mobile=mobile;
    this.sunDirection=new THREE.Vector3(-700,1100,-900).normalize();
    const resolution=this.mobile?128:256,steps=this.mobile?32:56;
    this.target=new THREE.WebGLCubeRenderTarget(resolution,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false});
    this.texture=this.target.texture;
    this.texture.name='Tidewater sky: atmosphere + shaped cumulus';
    this.shape=makeShapeTexture();
    this.material=new THREE.ShaderMaterial({
      defines:{CLOUD_STEPS:steps},side:THREE.BackSide,depthWrite:false,depthTest:false,toneMapped:false,
      uniforms:{uShape:{value:this.shape},uSun:{value:this.sunDirection},uTime:{value:0}},
      vertexShader:'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:SKY_FRAGMENT,
    });
    this.scene=new THREE.Scene();
    this.mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
    this.camera=new THREE.CubeCamera(.1,10,this.target);
    this.camera.update(renderer,this.scene);
    scene.background=this.texture;
    this.nextUpdate=0;this.face=0;this.cycleTime=0;
    this.diagnostics={mode:'bounded-volume-cubemap',reference:'Tidewater SkyProClouds + Atmosphere',resolution,primarySteps:steps,lightSamples:3,cloudBase:1100,cloudTop:4300,viewOriginHeight:350,maxDistance:30000,wind:[10,4],cirrusWind:[.0008,-.0012],temporalHistory:false,cloudShadows:false,reflection:'shared cube; PMREM initial snapshot',updates:0};
  }
  update(time){
    if(time<this.cycleTime){this.nextUpdate=0;this.face=0;}
    if(time<this.nextUpdate)return;
    // 同一轮六面使用冻结时间，避免同帧更新六面造成尖峰；每轮间隔只有微小云位移。
    if(this.face===0)this.cycleTime=time;
    this.material.uniforms.uTime.value=this.cycleTime;
    const previous=this.renderer.getRenderTarget();
    const previousFace=this.renderer.getActiveCubeFace(),previousMip=this.renderer.getActiveMipmapLevel();
    const xr=this.renderer.xr.enabled;this.renderer.xr.enabled=false;
    this.renderer.setRenderTarget(this.target,this.face);
    this.renderer.render(this.scene,this.camera.children[this.face]);
    this.renderer.setRenderTarget(previous,previousFace,previousMip);this.renderer.xr.enabled=xr;
    this.face=(this.face+1)%6;
    this.nextUpdate=time+(this.mobile?.45:.25);
    this.diagnostics.updates++;
  }
  dispose(){this.target.dispose();this.shape.dispose();this.mesh.geometry.dispose();this.material.dispose();}
}
