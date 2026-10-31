/**
 * Tidewater OceanFFT.js 的 JONSWAP/Horvath 频谱移植（WebGPU → 原生 WebGL2）。
 * Copyright (c) 2026 DRG Software Solutions LLC, MIT License.
 * 完整授权文本保留于 TidewaterOcean.js。频谱长度/风速/种子与原游戏一致。
 */
export const CASCADE_LENGTHS = [733, 157, 33.3];
export const SEA_SEED = 1337;
const TAU = Math.PI * 2, G = 9.81;
const systems = [
  { scale: 1, wind: 7, direction: 25, fetch: 120000, spread: .85, swell: .05, fade: .01 },
  { scale: .48, wind: 6, direction: 5, fetch: 1200000, spread: 1, swell: .9, fade: .1 },
].map(s => ({ ...s, angle:s.direction*Math.PI/180,
  alpha:.076*Math.pow(G*s.fetch/(s.wind*s.wind),-.22), peak:22*Math.pow(s.wind*s.fetch/(G*G),-.33) }));
export function pcg(v) {
  const state = (Math.imul(v,747796405)+2891336453)>>>0;
  const word = Math.imul(((state>>>((state>>>28)+4))^state)>>>0,277803737)>>>0;
  return ((word>>>22)^word)>>>0;
}
function energy(k,theta,s) {
  const omega=Math.sqrt(G*k*Math.tanh(Math.min(k*500,20)));
  const sigma=omega<=s.peak?.07:.09;
  const r=Math.exp(-Math.pow((omega-s.peak)/(sigma*s.peak),2)*.5);
  const j=s.scale*s.alpha*G*G*Math.pow(omega,-5)*Math.exp(-1.25*Math.pow(s.peak/omega,4))*Math.pow(3.3,r);
  const ratio=omega/s.peak;
  const p=(ratio>1?9.77*Math.pow(ratio,-2.5):6.97*Math.pow(ratio,5))+Math.tanh(Math.min(ratio,20))*16*s.swell*s.swell;
  const p2=p*p,p3=p2*p,p4=p3*p;
  const norm=p<5?-.000564*p4+.00776*p3-.044*p2+.192*p+.163:-4.8e-8*p4+1.07e-5*p3-9.53e-4*p2+.059*p+.393;
  const ct=Math.cos(theta-s.angle);
  const base=ct>0?ct*ct*2/Math.PI:0;
  const directed=norm*Math.pow(Math.abs(Math.cos((theta-s.angle)*.5)),p*2);
  return j*(base*(1-s.spread)+directed*s.spread)*Math.exp(-s.fade*s.fade*k*k);
}
export function createSpectrum(n, lengths=CASCADE_LENGTHS, seed=SEA_SEED) {
  if(n<4 || (n & (n-1))) throw new Error('FFT 网格必须是 2 的幂');
  const raw=new Float32Array(n*n*lengths.length*2), packed=new Float32Array(n*n*lengths.length*4);
  const bands=[],modes=[];
  for(let c=0;c<lengths.length;c++) {
    const dk=TAU/lengths[c],low=c?dk*6:.0001;
    // 方形网格边缘的 Nyquist 模式置零；各级严格不重复计算频率能量。
    const high=Math.min(c+1<lengths.length?TAU/lengths[c+1]*6:9999,dk*(n/2-1));
    bands.push({low,high});
    for(let z=0;z<n;z++)for(let x=0;x<n;x++) {
      const i=c*n*n+z*n+x,kx=(x-n/2)*dk,kz=(z-n/2)*dk,k=Math.hypot(kx,kz);
      if(k<low||k>=high||x===0||z===0)continue;
      const omega=Math.sqrt(G*k*Math.tanh(Math.min(k*500,20)));
      const kd=Math.min(k*500,20),ch=Math.cosh(kd);
      const dw=G*(500*k/(ch*ch)+Math.tanh(kd))/omega*.5;
      const e=systems.reduce((a,s)=>a+energy(k,Math.atan2(kz,kx),s),0);
      const amp=Math.sqrt(Math.max(0,e)*Math.abs(dw)/k*dk*dk)*.5;
      const s=(i*4+seed*7919)>>>0;
      const u1=(pcg(s)>>>8)/16777216+.5/16777216,u2=(pcg(s+1)>>>8)/16777216+.5/16777216;
      const radius=Math.sqrt(-2*Math.log(u1));
      raw[i*2]=radius*Math.cos(u2*TAU)*amp;
      raw[i*2+1]=radius*Math.sin(u2*TAU)*amp;
      if(c===0) modes.push({kx,kz,omega,re:raw[i*2],im:raw[i*2+1],power:amp*amp});
    }
  }
  for(let c=0;c<lengths.length;c++)for(let z=0;z<n;z++)for(let x=0;x<n;x++) {
    const i=c*n*n+z*n+x,mirror=c*n*n+((n-z)%n)*n+(n-x)%n;
    packed.set([raw[i*2],raw[i*2+1],raw[mirror*2],-raw[mirror*2+1]],i*4);
  }
  // 浮力只取相同频谱的 24 个强长波模式；不对 GPU 纹理进行同步回读。
  modes.sort((a,b)=>b.power-a.power);
  return {packed,bands,modes:modes.slice(0,24)};
}
export function spectralBuoyancy(modes,x,z,time) {
  let h=0;
  for(const m of modes){const phase=m.kx*x+m.kz*z+m.omega*time;h+=2*(m.re*Math.cos(phase)-m.im*Math.sin(phase));}
  return h;
}
