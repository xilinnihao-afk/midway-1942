import { HANDLING } from './config.js';
import * as THREE from '../vendor/three.module.js';
import { TidewaterOcean } from './TidewaterOcean.js';
import { TidewaterSky } from './TidewaterSky.js';

// 舰船浮力与着色器使用同一组大尺度波浪，避免船体悬空。
export function waveHeight(x, z, time) {
  return Math.sin(x * 0.024 + z * 0.011 + time * 0.8) * 0.52
    + Math.sin(z * 0.041 - x * 0.014 + time * 1.1) * 0.23;
}

/** Gradual optical focus on a nearby bombing run; pull-out restores wide view. */
export function flightCameraFov(player,target){
  const base=60+Math.max(0,player.speed-95)*.14;
  if(!target?.alive||player.bombs<=0||player.mesh.position.y<35)return base;
  const offset=target.mesh.position.clone().sub(player.mesh.position),range=offset.length();
  const ahead=offset.normalize().dot(player.forward);
  const focus=THREE.MathUtils.smoothstep(-player.pitch,.18,.6)
    *(1-THREE.MathUtils.smoothstep(range,350,850))*THREE.MathUtils.smoothstep(ahead,.7,.94);
  return base+(49-base)*focus;
}

export class SceneManager {
  constructor(container) {
    this.container = container;
    // 设备预算在创建时固定，手机横屏或地址栏收起都不会重建海面/天空资源。
    const coarsePointer = window.matchMedia?.('(any-pointer: coarse)').matches ?? false;
    const screenShortSide = Math.min(window.screen.width || innerWidth, window.screen.height || innerHeight);
    this.mobile = coarsePointer || (navigator.maxTouchPoints > 0 && screenShortSide <= 1024) || innerWidth < 700;
    this.pixelRatioCap = this.mobile ? 1.25 : 1.75;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x96c6d7, 0.00025);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 15000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '中途岛空战场景，鼠标控制机头，左键射击');
    container.appendChild(this.canvas);
    this.mode = 'ship';
    this.target = new THREE.Vector3(-100, 2, -360);
    this.azimuth = 2.51;
    this.elevation = 0.53;
    this.distance = 290;
    this.scratch = new THREE.Vector3();
    this.makeSky();
    this.makeOcean();
    this.makeIsland();
    this.scene.add(new THREE.HemisphereLight(0xd6edff, 0x27444a, 2.3));
    const sun = new THREE.DirectionalLight(0xffeed1, 3.0);
    sun.position.copy(this.sky.sunDirection).multiplyScalar(1500);
    this.scene.add(sun);
    // 单机模式由 FlightManager 输入控制，禁用旧舰队拖动相机。
    this.closeCamera = false; this.snapFlightCamera = true;
    this.resize();
    this.update(0, 1, null);
    window.addEventListener('resize', () => this.resize());
  }

  makeSky() {
    this.sky = new TidewaterSky(this.scene, this.renderer, { mobile: this.mobile });
    const cube = this.sky.texture;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromCubemap(cube);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
  }

  makeOcean() {
    this.ocean = new TidewaterOcean(this.scene, this.renderer, this.scene.background, { mobile: this.mobile });
    this.waterMaterial = this.ocean.material;
  }

  getWaveHeight(x,z,time) { return this.ocean.getHeight(x,z,time); }

  makeIsland() {
    const root=new THREE.Group(); root.position.set(-420,0,140);root.name='Midway island';
    const positions=[],colors=[],indices=[];
    const sand=new THREE.Color(0xd8c49a),grass=new THREE.Color(0x798951),coast=new THREE.Color(0xb6b894);
    const rings=10,segments=64;
    for(let r=0;r<=rings;r++) for(let s=0;s<=segments;s++) {
      const a=s/segments*Math.PI*2, radius=Math.max(.001,r/rings);
      const edge=1+.045*Math.sin(a*5)+.025*Math.cos(a*9);
      const x=Math.cos(a)*125*radius*edge,z=Math.sin(a)*86*radius*edge;
      const h=r===rings ? -.65 : 1.8+Math.max(0,1-radius)*3.4+Math.sin(x*.04)*Math.cos(z*.065)*.4;
      positions.push(x,h,z);
      const c=(radius>.8 ? sand : radius>.65 ? coast : grass).clone();
      c.multiplyScalar(.94+.06*Math.sin(s*7+r*9)); colors.push(c.r,c.g,c.b);
      if(r<rings&&s<segments){const i=r*(segments+1)+s; indices.push(i,i+1,i+segments+1,i+1,i+segments+2,i+segments+1);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
    const land=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));root.add(land);
    const runway=new THREE.Mesh(new THREE.BoxGeometry(18,.35,127),new THREE.MeshStandardMaterial({color:0x696d65,roughness:.95}));
    runway.position.set(1,5.4,0);runway.rotation.y=.50;root.add(runway);
    const markings=new THREE.InstancedMesh(new THREE.BoxGeometry(.8,.03,5),new THREE.MeshBasicMaterial({color:0xdbd4b6}),10);
    const temp=new THREE.Object3D();
    for(let i=0;i<10;i++){const z=(i-4.5)*11;temp.position.set(1+Math.sin(.5)*z,5.6,Math.cos(.5)*z);temp.rotation.y=.5;temp.updateMatrix();markings.setMatrixAt(i,temp.matrix);}root.add(markings);
    const buildings=new THREE.InstancedMesh(new THREE.BoxGeometry(10,4,15),new THREE.MeshStandardMaterial({color:0xa5a595,roughness:.9}),5);
    for(let i=0;i<5;i++){temp.position.set(-28+i*10,5.7,27+i*3);temp.rotation.y=.5;temp.updateMatrix();buildings.setMatrixAt(i,temp.matrix);}root.add(buildings);
    // 少量实例化棕榈剪影提供岛屿尺度；整片植被仅两次绘制。
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.6,7,5),new THREE.MeshStandardMaterial({color:0x746c45,roughness:1}),32);
    const crowns=new THREE.InstancedMesh(new THREE.ConeGeometry(4,2.8,5),new THREE.MeshStandardMaterial({color:0x415a37,roughness:1}),32);
    for(let i=0;i<32;i++){
      const a=i*2.399, r=55+(i%5)*6;const x=Math.cos(a)*r,z=Math.sin(a)*r*.63;
      if(Math.abs(x-Math.tan(.5)*z)<18){temp.position.set(x+29,6,z);}else temp.position.set(x,6,z);
      temp.rotation.set(0,a,Math.sin(i)*.08);temp.scale.setScalar(.75+(i%4)*.1);temp.updateMatrix();trunks.setMatrixAt(i,temp.matrix);
      temp.position.y+=3.4;temp.updateMatrix();crowns.setMatrixAt(i,temp.matrix);
    }
    root.add(trunks,crowns);this.scene.add(root);
  }

  bindCamera() {
    let down=false,lastX=0,lastY=0;
    this.canvas.addEventListener('pointerdown',event=>{down=true;lastX=event.clientX;lastY=event.clientY;this.canvas.setPointerCapture(event.pointerId);});
    this.canvas.addEventListener('pointermove',event=>{
      if(!down)return;
      this.azimuth-=(event.clientX-lastX)*.006;
      this.elevation=THREE.MathUtils.clamp(this.elevation+(event.clientY-lastY)*.004,.10,1.42);
      lastX=event.clientX;lastY=event.clientY;
    });
    this.canvas.addEventListener('pointerup',()=>{down=false;});
    this.canvas.addEventListener('pointercancel',()=>{down=false;});
    this.canvas.addEventListener('wheel',event=>{event.preventDefault();this.distance=THREE.MathUtils.clamp(this.distance*Math.exp(event.deltaY*.001),this.mode==='plane'?25:70,2100);},{passive:false});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault());
  }

  setMode(mode) {
    this.mode=mode;
    this.distance=mode==='plane'?80:mode==='tactical'?1450:290;
    this.elevation=mode==='tactical'?1.30:mode==='plane'?.25:.53;
  }

  resetCamera() { this.mode='ship';this.azimuth=2.51;this.elevation=.53;this.distance=290; }

  update(time,dt,followObject,ships=[]) {
    if (this.flight?.player) {
      const p=this.flight.player, pos=p.mesh.position, forward=p.forward;
      const distance=this.closeCamera?(innerWidth<700?38:27):(innerWidth<700?57:43);
      const wanted=pos.clone().addScaledVector(forward,-distance).add(new THREE.Vector3(0,this.closeCamera?8:12,0));
      const blend=this.snapFlightCamera?1:1-Math.exp(-dt*HANDLING.cameraResponse);
      this.camera.position.lerp(wanted,blend);this.snapFlightCamera=false;
      this.camera.position.y=Math.max(this.camera.position.y,4);
      this.target.copy(pos).addScaledVector(forward,125).add(new THREE.Vector3(0,innerWidth<700?-20:8,0));
      this.camera.up.set(-Math.sin(p.bank)*.12,1,0).normalize();
      this.camera.lookAt(this.target);
      if(p.damageFlash>0){this.camera.rotateZ(Math.sin(time*65)*p.damageFlash*.014);}
      if(p.gunKick>0){this.camera.rotateX(Math.sin(time*145)*p.gunKick*.00045);this.camera.rotateZ(Math.sin(time*103)*p.gunKick*.00027);}
      const fov=flightCameraFov(p,this.flight.target);
      if(Math.abs(this.camera.fov-fov)>.05){this.camera.fov=THREE.MathUtils.damp(this.camera.fov,fov,5,dt);this.camera.updateProjectionMatrix();}
      this.sky.update(time);
    this.ocean.update(time,dt,this.camera,ships);return;
    }
    if(followObject){followObject.getWorldPosition(this.scratch);this.scratch.y+=this.mode==='plane'?1:7;this.target.lerp(this.scratch,1-Math.exp(-dt*4));}
    this.scratch.set(Math.sin(this.azimuth)*Math.cos(this.elevation),Math.sin(this.elevation),Math.cos(this.azimuth)*Math.cos(this.elevation)).multiplyScalar(this.distance).add(this.target);
    this.camera.position.lerp(this.scratch,1-Math.exp(-dt*9));
    this.camera.position.y=Math.max(this.camera.position.y,5);
    this.camera.lookAt(this.target);
    this.sky.update(time);
    this.ocean.update(time,dt,this.camera,ships);
  }

  resize() {
    const width=this.container.clientWidth||innerWidth,height=this.container.clientHeight||innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);
  }
}
