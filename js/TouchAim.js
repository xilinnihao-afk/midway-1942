/** Relative finger travel controls the nose; independent of the flight stick. */
export class TouchAim {
  constructor() { this.clear(); }
  begin() { this.active = true; }
  move(dx, dy, width) {
    const gain = Math.PI * .5 / Math.max(width, 640);
    this.x -= dx * gain;
    this.y -= dy * gain;
    // Discard jumps from interrupted gestures rather than banking up a long turn.
    this.x = Math.max(-.35, Math.min(.35, this.x));
    this.y = Math.max(-.35, Math.min(.35, this.y));
  }
  consume(dt) {
    const alpha = this.active ? 1 - Math.exp(-Math.max(0, dt) / .012) : 1;
    const x = this.x * alpha, y = this.y * alpha;
    this.x -= x; this.y -= y;
    return { x, y };
  }
  end() { this.active = false; }
  clear() { this.x = this.y = 0; this.active = false; }
}
