import { GyroSensor } from './GyroSensor.js';

export function gyroSettings(value) {
  const s = value && typeof value === 'object' ? value : {};
  return { enabled: s.enabled === true, sensitivity: typeof s.sensitivity === 'number' && Number.isFinite(s.sensitivity) ? Math.max(.3, Math.min(3, s.sensitivity)) : 1 };
}

/** Relative sensor travel feeds the existing nose-aim input, never the camera. */
export class GyroAim extends GyroSensor {
  configure(enabled, sensitivity = this.sensitivity) {
    const next = gyroSettings({ enabled, sensitivity });
    this.configureEnabled(next.enabled, next.sensitivity);
  }
}
