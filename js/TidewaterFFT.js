import * as THREE from '../vendor/three.module.js';
// WebGL2 MRT 兼容后端。每阶段独立 render 是显式同步边界，禁止读写同一纹理。
const VERTEX=`void main(){gl_Position=vec4(position.xy,0.,1.);}`;
export function target(n,layers,count=2,type=THREE.HalfFloatType) {
  return new THREE.WebGLRenderTarget(n,n*layers,{count,type,format:THREE.RGBAFormat,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});
}
export function computeMaterial(fragmentShader,uniforms={}) {
  return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERTEX,fragmentShader,uniforms,
    depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending});
}
export class TidewaterFFT {
  constructor(renderer,n,layers=3,type=THREE.HalfFloatType) {
    if(n<4 || (n&(n-1)))throw new Error('FFT resolution must be a power of two');
    Object.assign(this,{renderer,n,layers});this.log=Math.log2(n);
    this.scene=new THREE.Scene();this.camera=new THREE.Camera();
    this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));this.quad.frustumCulled=false;this.scene.add(this.quad);
    this.ping=target(n,layers,2,type);this.pong=target(n,layers,2,type);this.output=target(n,layers,2,type);
    this.material=computeMaterial(`
      precision highp float;precision highp int;
      uniform sampler2D uA;uniform sampler2D uB;
      uniform int uOperation;uniform int uAxis;uniform int uStage;
      layout(location=0) out vec4 resultA;layout(location=1) out vec4 resultB;
      int reverseBits(int v){int r=0;for(int j=0;j<${this.log};j++){r=(r<<1)|(v&1);v>>=1;}return r;}
      vec4 weighted(vec4 b,float angle){vec2 w=vec2(cos(angle),sin(angle));return vec4(b.x*w.x-b.y*w.y,b.x*w.y+b.y*w.x,b.z*w.x-b.w*w.y,b.z*w.y+b.w*w.x);}
      void main(){
        ivec2 cell=ivec2(gl_FragCoord.xy);int layer=cell.y/${n};int y=cell.y%${n};
        if(uOperation==0){ivec2 source=cell;if(uAxis==0)source.x=reverseBits(cell.x);else source.y=layer*${n}+reverseBits(y);
          resultA=texelFetch(uA,source,0);resultB=texelFetch(uB,source,0);return;}
        if(uOperation==2){float sign=((cell.x+y)&1)==0?1.:-1.;resultA=texelFetch(uA,cell,0)*sign;resultB=texelFetch(uB,cell,0)*sign;return;}
        int coordinate=uAxis==0?cell.x:y;int span=1<<(uStage+1);int halfSpan=span>>1;
        int local=coordinate&(span-1);int offset=local&(halfSpan-1);int start=coordinate-local;
        ivec2 a=cell,b=cell;if(uAxis==0){a.x=start+offset;b.x=a.x+halfSpan;}else{a.y=layer*${n}+start+offset;b.y=a.y+halfSpan;}
        float angle=6.28318530718*float(offset)/float(span);float sign=local>=halfSpan?-1.:1.;
        resultA=texelFetch(uA,a,0)+weighted(texelFetch(uA,b,0),angle)*sign;
        resultB=texelFetch(uB,a,0)+weighted(texelFetch(uB,b,0),angle)*sign;
      }`,{uA:{value:null},uB:{value:null},uOperation:{value:0},uAxis:{value:0},uStage:{value:0}});
  }
  draw(material,destination){this.quad.material=material;this.renderer.setRenderTarget(destination);this.renderer.render(this.scene,this.camera);}
  transform(textures){
    let input=textures,destination=this.ping;
    const run=(operation,axis=0,stage=0,final=false)=>{
      const u=this.material.uniforms;u.uA.value=input[0];u.uB.value=input[1];u.uOperation.value=operation;u.uAxis.value=axis;u.uStage.value=stage;
      const out=final?this.output:destination;this.draw(this.material,out);input=out.textures;destination=destination===this.ping?this.pong:this.ping;
    };
    for(let axis=0;axis<2;axis++){run(0,axis);for(let stage=0;stage<this.log;stage++)run(1,axis,stage);}
    run(2,0,0,true);return this.output.textures;
  }
  dispose(){this.ping.dispose();this.pong.dispose();this.output.dispose();this.material.dispose();this.quad.geometry.dispose();}
}
// 实际 GPU 的 DC 与单频测试：在浏览器控制台调用 game.scene.ocean.validateFFT()。
export function validateTidewaterFFT(renderer){
  const saved=renderer.getRenderTarget(),n=16,fft=new TidewaterFFT(renderer,n,1,THREE.FloatType),pixels=new Float32Array(n*n*4);
  const data=new Float32Array(n*n*4),tex=new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.FloatType);tex.needsUpdate=true;
  let impulseError=0,frequencyError=0;
  try{
    data[((n/2)*n+n/2)*4]=1;tex.needsUpdate=true;fft.transform([tex,tex]);renderer.readRenderTargetPixels(fft.output,0,0,n,n,pixels);
    for(let i=0;i<n*n;i++)impulseError=Math.max(impulseError,Math.abs(pixels[i*4]-1),Math.abs(pixels[i*4+1]));
    data.fill(0);data[((n/2)*n+n/2+1)*4]=1;tex.needsUpdate=true;fft.transform([tex,tex]);renderer.readRenderTargetPixels(fft.output,0,0,n,n,pixels);
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=(z*n+x)*4,a=Math.PI*2*x/n;frequencyError=Math.max(frequencyError,Math.abs(pixels[i]-Math.cos(a)),Math.abs(pixels[i+1]-Math.sin(a)));}
    return {pass:impulseError<.001&&frequencyError<.001,impulseError,frequencyError};
  }finally{renderer.setRenderTarget(saved);tex.dispose();fft.dispose();}
}
