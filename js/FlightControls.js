import { HANDLING } from './config.js';

/** 连续死区与非线性摇杆曲线：中央微调精细、外圈保留完整转向能力。 */
export function shapeAxis(value, curve = HANDLING.curve, deadzone = HANDLING.deadzone) {
  const x=Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
  const magnitude=Math.max(0,(Math.abs(x)-deadzone)/(1-deadzone));
  return Math.sign(x)*Math.pow(magnitude,curve);
}

export function shapeControl(value, axis, input, shooting=false) {
  const profile=input.joystickActive?HANDLING.joystick:HANDLING;
  // Fine movement is gentler while firing; full stick/mouse travel retains evasive authority.
  const outer=Math.min(1,Math.abs(value)/.75);
  const sensitivity=input.joystickActive?1:(input.mouseSensitivity??1);
  const center=sensitivity*(shooting?.6:1),precision=center+(1-center)*outer*outer;
  const travel=Math.min(1,Math.max(0,(Math.abs(value)-.12)/.36));
  const fine=input.joystickActive?.55+.45*travel*travel*(3-2*travel):1;
  return shapeAxis(value,axis==='turn'?profile.curve:profile.pitchCurve,profile.deadzone??HANDLING.deadzone)*(axis==='turn'?(profile.turnScale??1):1)*precision*fine;
}

/** 摇杆独立柔和曲线；键盘覆盖对应轴，指数响应不依赖帧率。 */
export function updateControls(player,keys,input,dt) {
  const keyTurn=keys.has('KeyA')||keys.has('KeyD');
  const keyPitch=keys.has('ArrowUp')||keys.has('ArrowDown');
  const profile=input.joystickActive?HANDLING.joystick:HANDLING;
  const shooting=input.fire||keys.has('KeyF');
  const turn=keyTurn?Number(keys.has('KeyA'))-Number(keys.has('KeyD')):-shapeControl(input.x,'turn',input,shooting);
  const pitch=keyPitch?Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')):-shapeControl(input.y,'pitch',input,shooting);
  const blend=(old,target,keyboard)=>target+(old-target)*Math.exp(-dt*(target===0?(shooting?36:HANDLING.releaseResponse):keyboard?HANDLING.response:profile.response));
  player.turnInput=blend(player.turnInput||0,turn,keyTurn);
  player.pitchInput=blend(player.pitchInput||0,pitch,keyPitch);
  return {turn:player.turnInput,pitch:player.pitchInput,neutralPitch:pitch===0};
}
