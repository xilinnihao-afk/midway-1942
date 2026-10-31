import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { MODEL_PATHS, MODEL_IMPORTS } from './config.js';

/** URL级缓存保证4艘航母只加载/解析一次。高低模克隆共享几何与材质。 */
export class AssetLoader {
  constructor(notify = () => {}) {
    this.loader = new GLTFLoader(); this.cache = new Map(); this.embeddedCache = new Map();
    this.notify = notify; this.failures = []; this.lowTemplates = {};
  }
  async loadGLB(key, url = MODEL_PATHS[key]) {
    if (!this.cache.has(url)) this.cache.set(url, this.fetchModel(key, url));
    return this.cache.get(url);
  }
  fallbackKey(key) { return MODEL_IMPORTS[key]?.fallback || (key === 'spitfire' ? 'f4f' : key); }
  async fetchModel(key, url) {
    const source = MODEL_IMPORTS[key]?.source || key;
    try {
      if (location.protocol === 'file:') return await this.parseEmbedded(source);
      const buffer = await this.fetchBuffer(url, (loaded, total) => {
        if (this.downloads?.has(url)) {
          this.downloads.set(url, total ? Math.min(1, loaded / total) : 0);
          this.reportProgress?.();
        }
      });
      this.downloads?.set(url, 1); this.reportProgress?.();
      const base = new URL('.', new URL(url, document.baseURI)).href;
      const gltf = await this.loader.parseAsync(buffer, base);
      return this.prepare(gltf.scene);
    } catch (error) {
      this.failures.push({ key, url, reason: error.message });
      this.notify(`模型 ${key} 加载失败，使用随包内置模型`);
      try { await window.MIDWAY_BOOT?.embedded(); return await this.parseEmbedded(source); }
      catch { const fallback = (await this.parseEmbedded(this.fallbackKey(key))).clone(true); fallback.userData.originalFallback = true; return fallback; }
    }
  }
  async fetchBuffer(url, progress = () => {}) {
    const controller = new AbortController();
    let timer;
    // 只在持续 30 秒没有数据时中断，正常的慢速下载不会被总时限误杀。
    const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 30000); };
    heartbeat();
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      heartbeat();
      if (!response.body) return await response.arrayBuffer();
      const total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body.getReader(), chunks = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.byteLength; heartbeat(); progress(loaded, total);
      }
      const buffer = new Uint8Array(loaded); let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      return buffer.buffer;
    } finally { clearTimeout(timer); }
  }
  async parseEmbedded(key) {
    if (!this.embeddedCache.has(key)) this.embeddedCache.set(key, (async () => {
      // 在线仅请求所需低模，避免首屏下载整包 43 MB 离线镜像。
      if (location.protocol !== 'file:' && !window.MIDWAY_ASSETS) {
        try {
          const url = `assets/models/${key}.glb`;
          return this.prepare((await this.loader.parseAsync(await this.fetchBuffer(url), new URL('assets/models/', document.baseURI).href)).scene);
        } catch (error) {
          if (!window.MIDWAY_BOOT) throw error;
          await window.MIDWAY_BOOT.embedded();
        }
      }
      const encoded = window.MIDWAY_ASSETS?.[key];
      if (!encoded) throw new Error(`缺少内置 GLB：${key}。请运行 scripts/pack.py。`);
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      return this.prepare((await this.loader.parseAsync(bytes.buffer, '')).scene);
    })());
    return this.embeddedCache.get(key);
  }
  prepare(scene) {
    scene.updateMatrixWorld(true);
    const group = new THREE.Group(), buckets = new Map(), solids = new Map();
    scene.traverse(node => {
      if (!node.isMesh) return;
      let parent = node, isPropeller = false, excluded = false;
      while (parent) {
        isPropeller ||= /propellor|propeller|rotor/i.test(parent.name);
        excluded ||= /ground_plane|^lights$|^lamp/i.test(parent.name);
        parent = parent.parent;
      }
      if (excluded) return;
      // KHR_mesh_quantization 属性先解码到浮点，矩阵烘焙不能写回整数数组。
      let geometry = node.geometry.clone();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (attribute.array instanceof Float32Array && !attribute.normalized) continue;
        const values = new Float32Array(attribute.count * attribute.itemSize);
        const getters = ['getX', 'getY', 'getZ', 'getW'];
        for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++)
          values[i * attribute.itemSize + c] = attribute[getters[c]](i);
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
      }
      geometry.applyMatrix4(node.matrixWorld);
      let material = node.material;
      // 外接 GLB 允许一个网格含多个材质组；保持 groups，避免将数组当成单个 PBR 材质。
      if (Array.isArray(material)) {
        group.add(new THREE.Mesh(geometry, material));
        return;
      }
      // 航母的几十种纯色材质写入顶点色，共用一个PBR材质；贴图材质保持原貌。
      if (!material.map && !material.normalMap && !material.emissiveMap && !material.transparent) {
        const signature = `${material.roughness}:${material.metalness}:${material.side}`;
        if (!solids.has(signature)) {
          const solid = material.clone(); solid.color.set(0xffffff); solid.vertexColors = true;
          solids.set(signature, solid);
        }
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) material.color.toArray(colors, i);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        material = solids.get(signature);
      }
      if (isPropeller) {
        geometry.computeBoundingBox();
        const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        const prop = new THREE.Mesh(geometry, material); prop.position.copy(center); prop.name = 'propeller';
        prop.userData.spinAxis = size.x < size.z ? 'x' : 'z'; group.add(prop); return;
      }
      const key = material.uuid + Object.keys(geometry.attributes).sort().join(',');
      if (!buckets.has(key)) buckets.set(key, { material, geometries: [] });
      buckets.get(key).geometries.push(geometry);
    });
    for (const { material, geometries } of buckets.values()) {
      const geometry = geometries.length > 1 ? mergeGeometries(geometries) : geometries[0];
      if (!geometry) throw new Error('模型属性不兼容，无法合批');
      if (geometries.length > 1) geometries.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(geometry, material); group.add(mesh);
    }
    group.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = true; } });
    return group;
  }
  normalize(raw, key) {
    const importSpec = raw.userData.originalFallback ? null : MODEL_IMPORTS[key];
    if (!importSpec) return raw;
    const inner = raw.clone(true); inner.rotation.y = importSpec.yaw;
    inner.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(inner), size = bounds.getSize(new THREE.Vector3());
    inner.scale.setScalar(importSpec.length ? importSpec.length / size.z : importSpec.span / size.x);
    inner.updateMatrixWorld(true); bounds.setFromObject(inner); bounds.getSize(size);
    const center = bounds.getCenter(new THREE.Vector3());
    inner.position.x -= center.x; inner.position.z -= center.z;
    // 航母以实际吃水位置归零；飞机剥离展示台后居中，避免抬高/横着飞。
    inner.position.y -= importSpec.length ? bounds.min.y + size.y * importSpec.waterline : center.y;
    const root = new THREE.Group(); root.add(inner);
    root.userData.importedSource = importSpec.source;
    root.userData.deckHeight = importSpec.deckHeight;
    return root;
  }
  async preload(progress = () => {}) {
    const keys = Object.keys(MODEL_PATHS), lowKeys = Object.keys(MODEL_IMPORTS);
    const total = keys.length + lowKeys.length;
    let done = 0;
    this.downloads = new Map([...new Set(Object.values(MODEL_PATHS))].map(url => [url, location.protocol === 'file:' ? 1 : 0]));
    this.reportProgress = () => progress(done, total, [...this.downloads.values()].reduce((sum, value) => sum + value, 0) / this.downloads.size);
    const complete = () => { done++; this.reportProgress(); };
    this.templates = Object.fromEntries(await Promise.all(keys.map(async key => {
      const model = this.normalize(await this.loadGLB(key), key); complete(); return [key, model];
    })));
    await Promise.all(lowKeys.map(async key => {
      this.lowTemplates[key] = await this.parseEmbedded(this.fallbackKey(key)); complete();
    }));
  }
  clone(key) { return this.templates[key].clone(true); }
  cloneLow(key) { return (this.lowTemplates[key] || this.templates[key]).clone(true); }
}
