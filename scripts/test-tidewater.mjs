import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
for(const name of ['TidewaterOcean','TidewaterFFT','TidewaterSpectrum']){
 const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:readFileSync(new URL(`js/${name}.js`,root)),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
}
const code=readFileSync(new URL('js/TidewaterSpectrum.js',root),'utf8');
const {createSpectrum,spectralBuoyancy}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
assert.throws(()=>createSpectrum(63));
const s=createSpectrum(128), repeat=createSpectrum(128), mobile=createSpectrum(64);
assert.deepEqual(s.packed,repeat.packed);
assert(s.packed.every(Number.isFinite));assert(mobile.packed.every(Number.isFinite));
for(let c=1;c<s.bands.length;c++)assert(s.bands[c].low>=s.bands[c-1].high-1e-10);
for(let c=0;c<3;c++)for(let z=0;z<128;z++)for(let x=0;x<128;x++){
 const i=(c*128*128+z*128+x)*4,j=(c*128*128+((128-z)%128)*128+(128-x)%128)*4;
 assert.equal(s.packed[i+2],s.packed[j]);assert.equal(s.packed[i+3],-s.packed[j+1]);
}
// 与 GLSL 相同的未归一化 radix-2 IFFT，检查 DC 和单频的相位/振幅。
function ifft(values){const n=values.length/2,stages=Math.log2(n),out=new Float64Array(values.length);
 for(let i=0;i<n;i++){let v=i,r=0;for(let b=0;b<stages;b++){r=(r<<1)|(v&1);v>>=1;}out[r*2]=values[i*2];out[r*2+1]=values[i*2+1];}
 for(let s=0;s<stages;s++){const span=1<<(s+1),half=span/2;for(let base=0;base<n;base+=span)for(let j=0;j<half;j++){
 const a=(base+j)*2,b=(base+j+half)*2,phase=2*Math.PI*j/span,c=Math.cos(phase),d=Math.sin(phase);
 const br=out[b]*c-out[b+1]*d,bi=out[b]*d+out[b+1]*c,ar=out[a],ai=out[a+1];out[a]=ar+br;out[a+1]=ai+bi;out[b]=ar-br;out[b+1]=ai-bi;}}
 return out;
}
let error=0;for(const frequency of [0,1,3]){const source=new Float64Array(32);source[frequency*2]=1;const actual=ifft(source);for(let x=0;x<16;x++)error=Math.max(error,Math.abs(actual[x*2]-Math.cos(2*Math.PI*frequency*x/16)),Math.abs(actual[x*2+1]-Math.sin(2*Math.PI*frequency*x/16)));}
assert(error<1e-12);
let rms=0,max=0;for(let i=0;i<1000;i++){const h=spectralBuoyancy(s.modes,i*3.717,i*1.71,19);assert(Number.isFinite(h));rms+=h*h;max=Math.max(max,Math.abs(h));}
rms=Math.sqrt(rms/1000);assert(rms>.03&&rms<3);assert(max<8);

// Parseval 检查：原项目采用未归一化逆 FFT；物理 h0 已带 dk²，不应再除 N²。
const cascadeRMS=[];const n=128,time=19;
for(let c=0;c<3;c++){
 let variance=0;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const i=(c*n*n+z*n+x)*4,k=Math.hypot(x-n/2,z-n/2)*Math.PI*2/[733,157,33.3][c];
  const omega=Math.sqrt(9.81*k*Math.tanh(Math.min(k*500,20))),cs=Math.cos(omega*time),sn=Math.sin(omega*time),v=s.packed;
  const re=v[i]*cs-v[i+1]*sn+v[i+2]*cs+v[i+3]*sn,im=v[i]*sn+v[i+1]*cs-v[i+2]*sn+v[i+3]*cs;
  variance+=re*re+im*im;
 }
 cascadeRMS.push(Math.sqrt(variance));
}
assert(cascadeRMS[0]>.1&&cascadeRMS[0]<3);
assert(cascadeRMS[1]<cascadeRMS[0]);assert(cascadeRMS[2]<cascadeRMS[1]);
// 对相同连续谱做空间有限差分，确认法线所用 i*k*h 相位和符号。
function field(x,z){let h=0,dx=0,dz=0;for(const m of s.modes){const a=m.kx*x+m.kz*z+m.omega*19,c=Math.cos(a),t=Math.sin(a);h+=2*(m.re*c-m.im*t);dx+=-2*m.kx*(m.re*t+m.im*c);dz+=-2*m.kz*(m.re*t+m.im*c);}return {h,dx,dz};}
const p=field(24.7,-39.1),eps=.0001;
const derivativeError=Math.max(Math.abs((field(24.7+eps,-39.1).h-field(24.7-eps,-39.1).h)/(2*eps)-p.dx),Math.abs((field(24.7,-39.1+eps).h-field(24.7,-39.1-eps).h)/(2*eps)-p.dz));
assert(derivativeError<1e-8);
console.log(JSON.stringify({pass:true,syntaxModules:3,deterministicSeed:1337,disjointBands:s.bands,hermitianPairs:3*128*128,cpuIFFTMaxError:error,cascadeSpatialRMS:cascadeRMS,spectralDerivativeError:derivativeError,buoyancyRMS:rms,buoyancyMax:max,note:'Actual GPU validation: ocean.validateFFT() in browser; CPU buoyancy uses 24 strongest long-wave modes.'},null,2));
