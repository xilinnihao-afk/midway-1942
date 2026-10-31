import * as THREE from 'three';
import { SHIP_TYPES, PLAYER_AIRCRAFT } from './config.js';
import { TouchAim } from './TouchAim.js';
import { GyroAim, gyroSettings } from './GyroAim.js';
import { AIM, aimSettings } from './AimAssist.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** 飞行界面只读取模拟状态；所有按钮通过 Game 的指令接口发出操作。 */
export class UIManager {
  constructor(game) {
    this.game = game;
    this.messages = [];
    this.previousState = '';
    this.elapsed = 0;
    this.dom = {};
    for (const element of document.querySelectorAll('[id]')) this.dom[element.id] = element;
    this.mapContext = this.dom.minimap.getContext('2d');
    this.markerContext = this.dom['flight-markers'].getContext('2d');
    this.projected = new THREE.Vector3();
    this.scratch = new THREE.Vector3();
    const bind = (id, fn) => this.dom[id].addEventListener('click', fn);
    bind('hangar-button', () => game.returnToHangar());
    bind('pause-button', () => game.togglePause());
    bind('bomb-button', () => game.dropBomb());
    bind('camera-button', () => game.setCamera());
    bind('sound-button', () => { game.toggleSound(); this.update(0); });
    bind('audio-test',()=>{game.testSound().then(()=>this.update(0));this.update(0);});
    bind('overlay-action', () => {
      if (game.state === 'ready') game.start();
      else if (game.state === 'paused') game.togglePause();
      else if (game.state === 'won' || game.state === 'lost') { this.messages.length = 0; game.restart(); }
      this.updateState();
    });
    for (const button of document.querySelectorAll('[data-aircraft]')) {
      button.addEventListener('click', () => {
        if(game.state !== 'ready') return;
        game.selectAircraft(button.dataset.aircraft);
        game.start();
        this.refreshAircraftSelection();
      });
    }
    this.bindTouchControls();
    this.bindGyroControls();
    this.bindAimControls();
    this.update(0);
  }

  refreshAircraftSelection() {
    const type = this.game.flight?.selectedType || this.game.selectedAircraft || 'sbd';
    for (const button of document.querySelectorAll('[data-aircraft]')) {
      const selected = type === button.dataset.aircraft;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.dom['aircraft-name'].textContent = PLAYER_AIRCRAFT[type]?.name || 'F4U-4 海盗';
  }

  // 摇杆与键盘走同一个输入通道；丢失捕获、暂停、切后台都必须松开所有触屏输入。
  bindTouchControls() {
    const game = this.game;
    const aim = game.input.aim = new TouchAim();
    let look = null;
    const beginLook = (event, element) => {
      if (look || game.state !== 'playing') return;
      look = { pointer: event.pointerId, x: event.clientX, y: event.clientY, element };
      aim.begin();
      try { element.setPointerCapture(event.pointerId); } catch {}
    };
    const endLook = event => {
      if (!look || (event && event.pointerId !== look.pointer)) return;
      const old = look; look = null;
      if (!event || event.type !== 'pointerup') aim.clear(); else aim.end();
      if (old.element.hasPointerCapture(old.pointer)) old.element.releasePointerCapture(old.pointer);
    };
    const lookZone = this.dom['touch-look'];
    lookZone.addEventListener('pointerdown', event => {
      if (game.state !== 'playing' || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.clientX < 8 || event.clientX > window.innerWidth - 8) return;
      event.preventDefault(); beginLook(event, lookZone);
    });
    for (const element of [lookZone, this.dom['touch-fire']]) {
      element.addEventListener('pointermove', event => {
        if (!look || look.pointer !== event.pointerId) return;
        event.preventDefault();
        aim.move(event.clientX - look.x, event.clientY - look.y, window.innerWidth);
        look.x = event.clientX; look.y = event.clientY;
      });
      // Register before hold's release listener, which itself releases capture.
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, endLook);
    }
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, endLook);
    this.heldButtons = new Map();
    const hold = (button, begin, end) => {
      button.addEventListener('pointerdown', event => {
        if (game.state !== 'playing' || this.heldButtons.has(button) || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        try { button.setPointerCapture(event.pointerId); } catch {}
        this.heldButtons.set(button, { pointer: event.pointerId, end });
        button.classList.add('held');
        begin(event);
      });
      const release = event => {
        const held = this.heldButtons.get(button);
        if (!held || (event && held.pointer !== event.pointerId)) return;
        held.end(); this.heldButtons.delete(button); button.classList.remove('held');
        if(button.hasPointerCapture(held.pointer)) button.releasePointerCapture(held.pointer);
      };
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
      for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, release);
    };
    for (const button of document.querySelectorAll('[data-key]')) hold(button, () => game.keys.add(button.dataset.key), () => game.keys.delete(button.dataset.key));
    hold(this.dom['touch-fire'], event => { beginLook(event, this.dom['touch-fire']); game.input.fire = true; game.flight?.fire(); }, () => { game.input.fire = false; });
    this.dom['touch-bomb'].addEventListener('click', () => game.dropBomb());
    this.dom['touch-evade'].addEventListener('click', () => game.evade(1));
    this.dom['touch-target'].addEventListener('click', () => game.cycleTarget());
    const joystick = this.dom['flight-joystick'];
    this.joystickPointer = null;
    const steer = event => {
      const rect = joystick.getBoundingClientRect();
      const radius = rect.width * .42;
      let x = (event.clientX - this.joystickOrigin.x) / radius;
      let y = (event.clientY - this.joystickOrigin.y) / radius;
      const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
      game.input.x = x; game.input.y = y;
      this.dom['joystick-knob'].style.transform = `translate(${x * radius}px,${y * radius}px)`;
    };
    joystick.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      if (game.state !== 'playing' || this.joystickPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); this.joystickPointer = event.pointerId; this.joystickOrigin={x:event.clientX,y:event.clientY}; game.input.joystickActive = true;
      try { joystick.setPointerCapture(event.pointerId); } catch {} steer(event);
    });
    joystick.addEventListener('pointermove', event => { if (event.pointerId === this.joystickPointer) steer(event); });
    const resetJoystick = event => {
      if (event && event.pointerId !== this.joystickPointer) return;
      const pointer=this.joystickPointer;
      game.input.x = 0; game.input.y = 0; game.input.joystickActive = false; this.joystickPointer = null;
      if(pointer !== null && joystick.hasPointerCapture(pointer)) joystick.releasePointerCapture(pointer);
      this.dom['joystick-knob'].style.transform = '';
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(name, resetJoystick);
    for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, resetJoystick);
    this.clearTouch = () => {
      endLook(); aim.clear();
      const heldControls=[...this.heldButtons];this.heldButtons.clear();
      for (const [button, held] of heldControls) { held.end(); button.classList.remove('held'); if(button.hasPointerCapture(held.pointer))button.releasePointerCapture(held.pointer); }
      resetJoystick();
    };
    window.addEventListener('blur', this.clearTouch);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clearTouch(); });
  }

  bindGyroControls() {
    const dom = this.dom, game = this.game;
    let settings = gyroSettings();
    try { settings = gyroSettings(JSON.parse(localStorage.getItem('midway-gyro-v1'))); } catch {}
    const save = () => { try { localStorage.setItem('midway-gyro-v1', JSON.stringify(settings)); } catch {} };
    const gyro = game.input.gyro = game.gyro = new GyroAim(status => {
      dom['gyro-settings'].dataset.status = status.code;
      dom['gyro-summary'].textContent = `陀螺仪操控 · ${status.code === 'off' ? '已关闭' : status.label}`;
      dom['gyro-status'].textContent = status.label;
      dom['gyro-detail'].textContent = status.detail;
      dom['gyro-enable'].textContent = ['denied', 'error', 'no-data', 'ready'].includes(status.code) ? '重试陀螺仪' : '启用陀螺仪';
      dom['gyro-enable'].disabled = status.code === 'requesting';
      dom['gyro-disable'].disabled = status.code === 'off';
      dom['gyro-calibrate'].disabled = status.code !== 'ready';
    });
    dom['gyro-sensitivity'].value = String(settings.sensitivity);
    dom['gyro-sensitivity-value'].textContent = `${settings.sensitivity.toFixed(1)}×`;
    gyro.configure(settings.enabled, settings.sensitivity);
    dom['gyro-enable'].addEventListener('click', () => {
      settings.enabled = true;
      gyro.configure(true, settings.sensitivity);
      void gyro.requestAccess();
      save();
    });
    dom['gyro-disable'].addEventListener('click', () => { settings.enabled = false; gyro.configure(false, settings.sensitivity); save(); });
    dom['gyro-calibrate'].addEventListener('click', () => gyro.calibrate());
    dom['gyro-sensitivity'].addEventListener('input', event => {
      settings = gyroSettings({ ...settings, sensitivity: Number(event.target.value) });
      dom['gyro-sensitivity-value'].textContent = `${settings.sensitivity.toFixed(1)}×`;
      gyro.configure(settings.enabled, settings.sensitivity); save();
    });
  }

  bindAimControls() {
    const game=this.game,dom=this.dom;
    let saved;try{saved=JSON.parse(localStorage.getItem('midway-aim-v1'));}catch{}
    game.aimSettings=aimSettings(saved);
    const sync=()=>{
      const settings=game.aimSettings;
      game.input.mouseSensitivity=settings.mouseSensitivity;
      dom['aim-assisted'].checked=settings.assisted;
      dom['aim-summary'].textContent=`瞄准与射击 · ${settings.assisted?'自动辅助开启':'手动射击'}`;
      for(const [id,key] of [['touch','touchSensitivity'],['mouse','mouseSensitivity']]){
        dom[`aim-${id}-sensitivity`].value=String(settings[key]);
        dom[`aim-${id}-value`].textContent=`${settings[key].toFixed(2)}×`;
      }
    };
    const update=patch=>{game.flight?.aimAssist.clear();game.aimSettings=aimSettings({...game.aimSettings,...patch});sync();try{localStorage.setItem('midway-aim-v1',JSON.stringify(game.aimSettings));}catch{}};
    dom['aim-assisted'].addEventListener('change',event=>update({assisted:event.target.checked}));
    dom['aim-touch-sensitivity'].addEventListener('input',event=>update({touchSensitivity:Number(event.target.value)}));
    dom['aim-mouse-sensitivity'].addEventListener('input',event=>update({mouseSensitivity:Number(event.target.value)}));
    sync();
  }

  notify(message) {
    this.messages.push({ message: String(message), time: this.game.time || 0, expires: performance.now() + 6500 });
    this.messages = this.messages.slice(-3);
    this.drawLog();
  }

  clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  drawLog() {
    this.messages = this.messages.filter(item => item.expires > performance.now());
    this.dom['combat-log'].replaceChildren(...this.messages.map(item => {
      const line = document.createElement('div'); line.className = 'log-line';
      const time = document.createElement('time'); time.textContent = this.clock(item.time);
      line.append(time, document.createTextNode(item.message)); return line;
    }));
  }

  updateState() {
    const state = this.game.state;
    this.game.gyro?.setActive(state === 'playing');
    if (this.previousState === state) return;
    this.previousState = state;
    this.dom.hud.dataset.state = state;
    this.dom['state-overlay'].hidden = state === 'playing';
    this.dom['pause-button'].disabled = !['playing', 'paused'].includes(state);
    this.dom['pause-button'].textContent = state === 'paused' ? '▷ 继续' : 'Ⅱ 暂停';
    this.dom['camera-button'].disabled = state === 'loading';
    this.dom['briefing-details'].hidden = !['loading', 'ready'].includes(state);
    this.dom['loading-panel'].hidden = state !== 'loading';
    this.dom['overlay-action'].hidden = state === 'ready';
    this.dom['hangar-button'].hidden = !['paused','won','lost'].includes(state);
    for (const button of document.querySelectorAll('[data-aircraft]')) button.disabled = state !== 'ready';
    if (state !== 'playing') this.clearTouch?.();
    const data = {
      loading: ['中途岛海战', '正在准备舰载机、敌军编队与太平洋海域。', '载入中…', 'PACIFIC THEATER · 1942'],
      ready: ['中途岛海战', '选择一架战机，点击图片即刻出击。突破防空，击沉敌军双航母。', '立即出击 →', 'OPERATION MIDWAY · 空中突击'],
      paused: ['作战暂停', '鼠标引导机头 · 左键机炮 · 空格投弹。Q/E 滚转改变姿态，R 桶滚摆脱瞄准；Shift 加力脱离。', '继续飞行 →', 'FLIGHT HOLD · 暂停'],
      won: ['任务完成', '两艘敌军航母已被击沉。你夺回了这片海域的制空权。', '再次出击 →', 'MISSION COMPLETE · 作战成功'],
      lost: ['这次出击结束了', this.game.flight?.reason || '飞机失去作战能力。利用滚转、加力与高度变化躲避来袭火力。', '立即重试 →', 'MISSION LOST · 重新出击'],
    }[state];
    if (data) {
      this.dom['overlay-title'].textContent = data[0]; this.dom['overlay-description'].textContent = data[1];
      this.dom['overlay-action'].textContent = data[2]; this.dom['overlay-eyebrow'].textContent = data[3];
      this.dom['overlay-action'].disabled = state === 'loading';
    }
    const result = state === 'won' || state === 'lost';
    this.dom['result-stats'].hidden = !result;
    if (result) {
      const stats = this.game.flight?.stats || {};
      const entries = [['得分', Math.round(this.game.flight?.player?.score || 0)], ['击落', stats.kills || 0], ['投弹命中', `${stats.bombHits || 0}/${stats.bombsDropped || 0}`], ['用时', this.clock(this.game.time)]];
      this.dom['result-stats'].replaceChildren(...entries.map(([label, value]) => {
        const div = document.createElement('div'), b = document.createElement('b'); b.textContent = value;
        div.append(b, document.createTextNode(label)); return div;
      }));
    }
    const touch = matchMedia('(pointer:coarse), (max-width:700px), (max-height:570px) and (max-width:950px) and (orientation:landscape)').matches;
    if(state==='paused') this.dom['overlay-description'].textContent=touch?'按住开火可持续射击，松开转向会自动跟随前方敌机。摇杆、滑动或转动手机可随时手动接管；白色叉号表示命中。':'按住左键或 F 可持续射击，停止移动鼠标会自动跟随前方敌机。移动鼠标、外圈急转或键盘可手动接管；白色叉号表示命中。';
    this.dom['overlay-footnote'].textContent = state === 'paused' && touch ? '横屏视野更宽 · 松开摇杆自动回稳 · 旋转屏幕后点击继续' : state === 'paused' ? 'W/S 调速 · A/D 转向 · ↑↓ 俯仰 · TAB 切换目标 · C 视角' : '友方航母附近：40–180 m 高度、低速平飞 2 秒补给';
    this.refreshAircraftSelection();
  }

  update(dt = 0) {
    this.updateState();
    this.elapsed += dt;
    if (dt !== 0 && this.elapsed < .08) return;
    this.elapsed = 0;
    const flight = this.game.flight, p = flight?.player;
    const ships = this.game.shipManager?.ships || [];
    if(this.game.gyro&&this.dom['gyro-diagnostics'])this.dom['gyro-diagnostics'].textContent=this.game.gyro.diagnosticText();
    this.dom['mission-time'].textContent = this.clock(this.game.time);
    this.dom['objective-count'].textContent = `航母 ${ships.filter(s => s.team === 'jp' && SHIP_TYPES[s.type]?.carrier && !s.alive).length} / 2`;
    this.dom['sound-button'].textContent=this.game.audio.buttonLabel;
    this.dom['sound-button'].title=this.game.audio.needsUnlock?'点击开启或恢复声音':'点击切换全部音效';
    this.dom['audio-status'].textContent=this.game.audio.statusText;
    if(this.dom['audio-details'].open){
      const audio=this.game.audio.diagnostics;
      this.dom['audio-diagnostics'].textContent=`播放状态：${audio.context}\n系统通道：${audio.session}\n资源：${audio.loaded}/${audio.expected} · 失败 ${audio.failed}\n解锁尝试：${audio.unlockAttempts}\n测试音：${audio.previews||0} 次\n${audio.unlockError?'原因：'+audio.unlockError:'无播放错误'}\n${audio.loadErrors.join('\n')}`;
    }
    if (p) {
      const hp = clamp(p.hp / p.maxHp, 0, 1);
      this.dom['plane-health'].textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
      this.dom['health-fill'].style.width = `${hp * 100}%`;
      this.dom['health-fill'].style.background = hp < .3 ? 'var(--red)' : 'var(--cyan)';
      this.dom['plane-speed'].textContent = String(Math.round((p.speed || 0) * 3.6)).padStart(3, '0');
      this.dom['plane-altitude'].textContent = String(Math.max(0, Math.round(p.mesh.position.y))).padStart(3, '0');
      this.dom['plane-throttle'].textContent = Math.round((p.throttle || 0) * 100);
      this.dom['bomb-count'].textContent = `${p.bombs} / ${p.maxBombs}`;
      this.dom['touch-bomb'].classList.toggle('on-target',flight.bombOnTarget);
      this.dom['touch-bomb'].textContent=`投弹 ${p.bombs}`;
      this.dom['touch-bomb'].disabled = this.game.state !== 'playing' || p.bombs <= 0 || p.bombClock > 0;
      this.dom['bomb-button'].disabled = this.dom['touch-bomb'].disabled;
      this.dom['bomb-button'].classList.toggle('on-target', flight.bombOnTarget);
      this.dom['bomb-status'].textContent = p.bombFlash > 0 ? '炸弹已脱离挂架 ↓' : p.bombs <= 0 ? '返回友舰青色补给圈装填' : flight.bombOnTarget ? '进入投弹窗口 · 立即释放' : '圆环变绿时投弹';
      if(flight.diveSafety?.diving){
        const safety=flight.diveSafety,altitude=Math.ceil(safety.pullUp/5)*5;
        this.dom['bomb-status'].textContent=`${flight.bombOnTarget&&p.bombs>0?'可投弹 · ':''}${altitude} m 前拉升`;
      }
      this.dom['air-count'].textContent = `僚机 ${flight.allies.length} · 敌机 ${flight.enemies.length}`;
      this.dom['touch-evade'].disabled = p.rollCooldown > 0;
      const assist=flight.aimAssist;
      this.dom['gun-status'].textContent = this.game.aimSettings.assisted ? assist.tracking ? '自动跟随' : assist.manualRemaining>0 ? '手动接管' : '按住自动瞄准' : '手动瞄准';
      this.dom['boost-fill'].style.width = `${clamp(p.boost || 0, 0, 1) * 100}%`;
      this.dom['evade-status'].textContent = p.rollRemaining > 0 ? '机动中' : p.rollCooldown > 0 ? `${p.rollCooldown.toFixed(1)} s` : '就绪';
      this.dom['score'].textContent = String(Math.round(p.score || 0)).padStart(5, '0');
      this.dom['kill-count'].textContent = `击落 ${p.kills || 0}`;
      this.dom['flight-warning'].textContent = this.game.state === 'playing' ? flight.warning || '' : '';
      this.dom['flight-warning'].dataset.level=String(flight.diveSafety?.level||0);
      this.dom['resupply-status'].textContent = !flight.diveSafety?.level && flight.resupplyProgress > 0 ? `友舰补给中 ${Math.round(clamp(flight.resupplyProgress / 2, 0, 1) * 100)}% · 保持低速平飞` : '';
      this.dom['damage-flash'].style.opacity = this.game.state === 'playing' ? clamp(p.damageFlash || 0, 0, .8) : 0;
      this.refreshAircraftSelection();
    }
    this.drawMap(ships, flight?.enemies || [], p, flight?.target, flight?.allies || []);
    this.drawLog();
  }

  drawMap(ships, enemies, player, target, allies = []) {
    const ctx = this.mapContext;
    ctx.clearRect(0, 0, 280, 280);
    ctx.save(); ctx.translate(140, 140);
    ctx.strokeStyle = '#a3dace35'; ctx.lineWidth = 1;
    for (const radius of [45, 90, 134]) { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-135, 0); ctx.lineTo(135, 0); ctx.moveTo(0, -135); ctx.lineTo(0, 135); ctx.stroke();
    ctx.font = '10px monospace'; ctx.fillStyle = '#d4e9d6'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -120);
    const position = player?.mesh.position || { x: 0, z: 0 };
    const point = object => ({ x: (object.x - position.x) / 1400 * 130, y: (object.z - position.z) / 1400 * 130 });
    for (const ship of ships) {
      if (!ship.alive) continue;
      const p = point(ship.mesh.position);
      if (Math.hypot(p.x, p.y) > 128) continue;
      ctx.fillStyle = ship.team === 'us' ? '#9ce8df' : '#ffc181';
      ctx.fillRect(p.x - 3, p.y - 5, 6, 10);
      if (ship === target) { ctx.strokeStyle = '#ffc181'; ctx.strokeRect(p.x - 8, p.y - 10, 16, 20); }
    }
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || !enemy.mesh) continue;
      const p = point(enemy.mesh.position);
      if (Math.hypot(p.x, p.y) > 130) continue;
      ctx.fillStyle = '#ff8472'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const ally of allies) {
      const p = point(ally.mesh.position); if (Math.hypot(p.x,p.y)>130) continue;
      ctx.fillStyle='#86eadf'; ctx.beginPath();ctx.moveTo(p.x,p.y-4);ctx.lineTo(p.x+3,p.y+3);ctx.lineTo(p.x-3,p.y+3);ctx.closePath();ctx.fill();
    }
    ctx.save();
    if (player?.forward) ctx.rotate(Math.atan2(player.forward.x, -player.forward.z));
    ctx.fillStyle = '#f3f5d8'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.restore();
  }

  // 世界更新和相机跟随后再投影，避免准星落后一帧；不在渲染循环创建 DOM。
  render() {
    const canvas = this.dom['flight-markers'], ctx = this.markerContext;
    const width = window.innerWidth, height = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const flight = this.game.flight, player = flight?.player, camera = this.game.sceneManager?.camera;
    if (!player?.mesh || !camera || this.game.state !== 'playing') return;
    camera.updateMatrixWorld();
    const mobile=matchMedia('(pointer:coarse), (max-width:700px), (max-height:570px) and (max-width:950px)').matches;
    const portrait=height>width;
    ctx.lineWidth = 1.3; ctx.font = '10px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#092331'; ctx.shadowBlur = 4;
    const project = point => {
      this.projected.copy(point).project(camera);
      return { x: (this.projected.x * .5 + .5) * width, y: (-this.projected.y * .5 + .5) * height, behind: this.projected.z > 1 || this.projected.z < -1 };
    };
    const label = (text, x, y, color = '#e9f0d9') => { ctx.fillStyle = color; ctx.fillText(text, x, y); };
    const diamond = (x, y, size) => { ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath(); ctx.stroke(); };
    // 血条与实体耐久共用同一数据源；远机保持细条，近机显示百分比。
    const healthBar = (unit, point, friendly, range=0, own=false) => {
      if(point.behind||point.x<25||point.x>width-25||point.y<45||point.y>height-45)return;
      const ratio=clamp(unit.hp/unit.maxHp,0,1),w=own?64:range<600?42:30,y=point.y+(own?33:17);
      const color=ratio<.3?'#ff6b61':friendly?'#83eee0':'#ffab7d';
      ctx.fillStyle='#061a25de';ctx.fillRect(point.x-w/2-2,y-2,w+4,8);
      ctx.fillStyle=unit.hitFlash>0?'#ffffff':color;ctx.fillRect(point.x-w/2,y,w*ratio,4);
      ctx.strokeStyle=unit.hitFlash>0?'#ffffff':'#dbe6df80';ctx.lineWidth=.7;ctx.strokeRect(point.x-w/2-2,y-2,w+4,8);ctx.lineWidth=1.3;
      if(!mobile&&(own||range<550)||ratio<1)label(own?`机体 ${Math.ceil(unit.hp)} / ${unit.maxHp}`:`${Math.ceil(ratio*100)}%`,point.x,y+17,color);
    };
    if(!mobile)healthBar(player,project(player.mesh.position),true,0,true);
    const forward = player.forward || this.scratch.set(0, 0, -1);
    const aim = project(this.scratch.copy(player.mesh.position).addScaledVector(forward, 400));
    for (const ally of flight.allies) {
      const p=project(ally.mesh.position);if(p.behind || ally.mesh.position.distanceTo(player.mesh.position)>1300)continue;
      ctx.strokeStyle='#8eddd4';ctx.beginPath();ctx.moveTo(p.x-5,p.y+9);ctx.lineTo(p.x,p.y+12);ctx.lineTo(p.x+5,p.y+9);ctx.stroke();
      if(!mobile||ally.hp<ally.maxHp)healthBar(ally,p,true,ally.mesh.position.distanceTo(player.mesh.position));
    }
    for (const bomb of flight.bombs) {
      const p=project(bomb.mesh.position);if(p.behind||bomb.age>2)continue;
      ctx.strokeStyle='#eed39b';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.stroke();label('炸弹 ↓',p.x,p.y+20,'#eed39b');
    }
    const solution=flight.aimAssist.solution;
    const assisted=this.game.aimSettings?.assisted??true;
    const shotReady=!!solution&&solution.angle<=(assisted?AIM.assistCone*.85:Math.atan2(5,solution.range));
    for (const enemy of flight.enemies || []) {
      if (!enemy.mesh || enemy.hp <= 0) continue;
      const range = enemy.mesh.position.distanceTo(player.mesh.position);
      if (range > 1700) continue;
      const p = project(enemy.mesh.position);
      if (p.behind || p.x < 12 || p.x > width - 12 || p.y < 12 || p.y > height - 12) continue;
      const important=!mobile||solution?.target===enemy||enemy.hp<enemy.maxHp||range<260;
      ctx.strokeStyle = '#ff9d84'; diamond(p.x,p.y,important?9:5);
      if(important){label(`${Math.round(range)} m`,p.x,p.y-17,'#ffbd9b');healthBar(enemy,p,false,range);}
    }
    // HUD and shot assistance share the same retained target and ballistic intercept.
    if (solution && !aim.behind) {
      const lead=project(this.scratch.copy(player.mesh.position).addScaledVector(solution.direction,400));
      const target=project(solution.target.mesh.position);
      if(!lead.behind&&lead.x>24&&lead.x<width-24&&lead.y>40&&lead.y<height-40){
        const color=shotReady?'#b6f4bc':'#ffcea0',radius=assisted?clamp(height*.038,12,24):10;
        ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(target.x,target.y);ctx.lineTo(lead.x,lead.y);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(lead.x,lead.y,radius,0,Math.PI*2);ctx.stroke();ctx.fillStyle=color;ctx.fillRect(lead.x-2,lead.y-2,4,4);
        ctx.strokeStyle=color;diamond(target.x,target.y,14);
        label(flight.aimAssist.tracking?(shotReady?'已瞄准 · 射击中':'自动跟随'):shotReady?'可开火':assisted?'按住开火跟随':'瞄准圆环',clamp(lead.x,45,width-45),lead.y+radius+16,color);
        ctx.lineWidth=1.3;
      }
    }
    if (flight.bombImpact && player.bombs > 0) {
      const p = project(flight.bombImpact);
      if (!p.behind && p.x > 0 && p.x < width && p.y > 0 && p.y < height) {
        const color = flight.bombOnTarget ? '#b6f4bc' : '#d7e4c4';
        ctx.strokeStyle = color; ctx.beginPath(); ctx.ellipse(p.x, p.y, 25, 10, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
        label(flight.bombOnTarget ? '投弹窗口' : '预计落点', p.x, p.y + 25, color);
      }
    }
    const target = flight.target;
    if (target?.alive && target.mesh) {
      const position = this.scratch.copy(target.mesh.position); position.y += 14;
      const point = project(position), range = target.mesh.position.distanceTo(player.mesh.position);
      let x = point.x, y = point.y;
      const margin=mobile?28:60,top=mobile?(portrait?215:130):110,bottom=height-(mobile?(portrait?190:95):150);
      const outside = point.behind || x < margin || x > width - margin || y < top || y > Math.max(top + 60, bottom);
      ctx.strokeStyle = '#ffd39d';
      if (outside) {
        let dx = x - width / 2, dy = y - height / 2;
        if (point.behind) { dx = -dx; dy = -dy; }
        const upper=top;
        const lower=Math.max(top+55,bottom);
        const limitY = Math.max(45, dy < 0 ? height / 2 - upper : lower - height / 2);
        const scale = Math.min((width / 2 - margin) / Math.max(Math.abs(dx), 1), limitY / Math.max(Math.abs(dy), 1));
        x = width / 2 + dx * scale; y = height / 2 + dy * scale;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx)); ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.stroke(); ctx.restore();
        label(`${target.name} ${Math.round(range)} m`, clamp(x, 73, width - 73), y + 23, '#ffcf9f');
      } else {
        ctx.strokeRect(x - 21, y - 15, 42, 30);
        label(`${target.name} · ${Math.round(range)} m`, x, y - 25, '#ffcf9f');
        ctx.fillStyle = '#22160f8c'; ctx.fillRect(x - 23, y + 23, 46, 3);
        ctx.fillStyle = '#ffc488'; ctx.fillRect(x - 23, y + 23, 46 * clamp(target.hp / target.maxHp, 0, 1), 3);
      }
    }
    if (!aim.behind) {
      const gap = 6 + (player.gunKick || 0);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = shotReady ? '#b6f4bc' : '#edf3d8';
      ctx.beginPath();
      for (const [x,y] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        ctx.moveTo(aim.x+x*gap,aim.y+y*gap);ctx.lineTo(aim.x+x*(gap+8),aim.y+y*(gap+8));
      }
      ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(aim.x-1,aim.y-1,2,2);
      if (player.hitConfirm > 0) {
        ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.beginPath();
        for (const [x,y] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          ctx.moveTo(aim.x+x*10,aim.y+y*10);ctx.lineTo(aim.x+x*16,aim.y+y*16);
        }
        ctx.stroke();
      }
    }
  }
}
