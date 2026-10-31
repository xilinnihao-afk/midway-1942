#!/usr/bin/env python3
"""无需 npm：将现成 ES6 模块嵌入本地 file:// 启动入口，源文件仍独立可维护。"""
import base64, json, pathlib, hashlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
models = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((ROOT/'assets/models').glob('*.glb'))}
(ROOT/'assets/embedded.js').write_text('/* 内置 GLB 离线资源；由 scripts/pack.py 生成。 */\nwindow.MIDWAY_ASSETS='+json.dumps(models)+';\n')
audio_dir=ROOT/'assets/audio'
audio_dir.mkdir(parents=True,exist_ok=True)
audio={p.stem:base64.b64encode(p.read_bytes()).decode() for p in sorted(audio_dir.glob('*')) if p.suffix in ['.wav','.mp3','.ogg']}
(audio_dir/'embedded.js').write_text('/* 本地音效离线镜像，由scripts/pack.py生成。 */\nwindow.MIDWAY_AUDIO='+json.dumps(audio)+';\n')
modules = {p.relative_to(ROOT).as_posix(): p.read_text() for directory in ['js','vendor'] for p in (ROOT/directory).glob('*.js')}
bootstrap = r'''
(async () => {
  try {
    if (location.protocol !== 'file:') { await import('./js/main.js'); return; }
    // file:// 不允许 fetch 本地模块；把已嵌入源码转成内存中的原生 ES6 模块图。
    const sources = __SOURCES__;
    const urls = new Map();
    function resolve(spec, parent) {
      if (spec === 'three') return 'vendor/three.module.js';
      const parts = parent.split('/'); parts.pop();
      for (const part of spec.split('/')) {
        if (part === '..') parts.pop(); else if (part !== '.') parts.push(part);
      }
      return parts.join('/');
    }
    function build(path) {
      if (urls.has(path)) return urls.get(path);
      if (!(path in sources)) throw new Error('缺少模块 '+path);
      const code = sources[path].replace(/(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g,
        (all, prefix, quote, spec) => (spec === 'three' || spec.startsWith('./') || spec.startsWith('../')) ? prefix + quote + build(resolve(spec,path)) + quote : all);
      const url = URL.createObjectURL(new Blob([code+'\n//# sourceURL='+path], {type:'text/javascript'}));
      urls.set(path, url); return url;
    }
    await import(build('js/main.js'));
  } catch(error) {
    console.error(error);
    window.MIDWAY_BOOT?.fail(error);
  }
})();
'''.replace('__SOURCES__',json.dumps(modules,ensure_ascii=False))
(ROOT/'standalone.js').write_text('/* 离线入口，由 scripts/pack.py 自动生成。 */\n'+bootstrap)
print(f'Packed {len(modules)} modules, {len(models)} GLB models, {len(audio)} audio assets; fully local/offline.')

# 版本化原生模块路径，避免浏览器动态 import 命中旧代码缓存。
fingerprint=hashlib.sha256((json.dumps(modules,sort_keys=True)+(ROOT/'styles.css').read_text()+(ROOT/'boot.js').read_text()+json.dumps(models,sort_keys=True)+json.dumps(audio,sort_keys=True)).encode()).hexdigest()[:12]
imports={'three':f'./vendor/three.module.js?v={fingerprint}'}
imports.update({f'./{path}':f'./{path}?v={fingerprint}' for path in modules})
html=(ROOT/'index.html').read_text()
html=re.sub(r'<script type="importmap">.*?</script>', '<script type="importmap">'+json.dumps({'imports':imports})+'</script>',html,flags=re.S)
for asset in ['boot.js','standalone.js','styles.css','assets/embedded.js','assets/audio/embedded.js']:
 html=re.sub(re.escape('./'+asset)+r'(?:\?v=[a-z0-9]+)?', './'+asset+'?v='+fingerprint,html)
(ROOT/'index.html').write_text(html)
