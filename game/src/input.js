// Keyboard and optional mouse-yoke flight controls with edge-triggered toggles.

export class InputController {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.keys = new Set();
    this.mouseFlight = false;
    this.invertPitch = false;
    this.mouseX = 0; // normalized -1..1
    this.mouseY = 0; // normalized -1..1

    this._onKeyDown = (e) => {
      const code = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        if (code === 'KeyG') this.callbacks.onToggleGear?.();
        if (code === 'KeyF') this.callbacks.onToggleFlaps?.();
        if (code === 'KeyC') this.callbacks.onToggleCamera?.();
        if (code === 'KeyM') this.callbacks.onToggleMouse?.();
        if (code === 'KeyI') this.callbacks.onToggleInvert?.();
        if (code === 'KeyV') this.callbacks.onToggleAudio?.();
        if (code === 'Escape') this.callbacks.onTogglePause?.();
      }
      this.keys.add(code);
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    this._onMouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      this.mouseX = Math.max(-1, Math.min(1, nx));
      this.mouseY = Math.max(-1, Math.min(1, ny));
    };

    this._onBlur = () => {
      this.keys.clear();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
  }

  sample() {
    let pitch = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitch += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitch -= 1;

    let roll = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) roll -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) roll += 1;

    let yaw = 0;
    if (this.keys.has('KeyQ')) yaw -= 1;
    if (this.keys.has('KeyE')) yaw += 1;

    if (this.mouseFlight) {
      const dead = 0.08;
      const mx = Math.abs(this.mouseX) > dead ? (this.mouseX - Math.sign(this.mouseX) * dead) / (1 - dead) : 0;
      const my = Math.abs(this.mouseY) > dead ? (this.mouseY - Math.sign(this.mouseY) * dead) / (1 - dead) : 0;
      roll = Math.max(-1, Math.min(1, roll + mx * 0.95));
      pitch = Math.max(-1, Math.min(1, pitch - my * 0.95));
    }

    if (this.invertPitch) {
      pitch = -pitch;
    }

    const throttleUp = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Equal') || this.keys.has('NumpadAdd');
    const throttleDown = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('Minus') || this.keys.has('NumpadSubtract');
    const afterburner = this.keys.has('Space');
    const airbrake = this.keys.has('KeyB');

    return {
      pitch,
      roll,
      yaw,
      throttleDelta: (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0),
      afterburner,
      airbrake,
    };
  }
}
