// Procedural WebAudio synthesizer for turbine hum, airflow rush, afterburner roar, and cockpit alerts.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.initialized = false;
    this.master = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain = null;
    this.windGain = null;
    this.windFilter = null;
    this.lastBeepTime = 0;
  }

  unlock() {
    if (this.initialized || !this.enabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.24;
      this.master.connect(this.ctx.destination);

      // Twin-turbine core drone
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.05;
      this.engineGain.connect(this.master);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 95;

      const engineLP = this.ctx.createBiquadFilter();
      engineLP.type = 'lowpass';
      engineLP.frequency.value = 340;
      this.engineOsc.connect(engineLP);
      engineLP.connect(this.engineGain);

      this.engineSub = this.ctx.createOscillator();
      this.engineSub.type = 'triangle';
      this.engineSub.frequency.value = 48;
      this.engineSub.connect(this.engineGain);

      // Filtered white-noise airflow / afterburner hiss
      const bufSize = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 420;
      this.windFilter.Q.value = 0.8;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.03;

      noiseSrc.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);

      this.engineOsc.start();
      this.engineSub.start();
      noiseSrc.start();
      this.initialized = true;
    } catch {
      this.initialized = false;
    }
  }

  setEnabled(flag) {
    this.enabled = flag;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(flag ? 0.24 : 0, this.ctx.currentTime, 0.05);
    }
  }

  updateFlight(state, active) {
    if (!this.initialized || !this.ctx) return;
    if (this.ctx.state === 'suspended' && active && this.enabled) {
      this.ctx.resume().catch(() => {});
    }

    const t = this.ctx.currentTime;
    if (!active || !this.enabled) {
      this.engineGain.gain.setTargetAtTime(0.01, t, 0.1);
      this.windGain.gain.setTargetAtTime(0.005, t, 0.1);
      return;
    }

    const thr = state.throttle;
    const boost = state.afterburner ? 1.35 : 1.0;
    const speedRatio = Math.min(1.4, state.airspeed / 160);

    this.engineOsc.frequency.setTargetAtTime((72 + thr * 115) * boost, t, 0.08);
    this.engineSub.frequency.setTargetAtTime((38 + thr * 55) * boost, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.05 + thr * 0.1 + (state.afterburner ? 0.07 : 0), t, 0.08);

    this.windFilter.frequency.setTargetAtTime(260 + speedRatio * 900 + (state.afterburner ? 420 : 0), t, 0.1);
    this.windGain.gain.setTargetAtTime(0.02 + speedRatio * 0.11 + (state.airbrake ? 0.08 : 0), t, 0.1);

    if (state.isStalling && t - this.lastBeepTime > 0.48) {
      this.lastBeepTime = t;
      this.playTone(880, 0.09, 'square', 0.12);
    }
  }

  playTone(freq, duration, type = 'sine', volume = 0.2) {
    if (!this.initialized || !this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  playRingPass(combo = 1) {
    if (!this.initialized || !this.enabled) return;
    const base = 523.25 * Math.pow(1.06, Math.min(8, combo - 1));
    this.playTone(base, 0.16, 'triangle', 0.24);
    setTimeout(() => this.playTone(base * 1.25, 0.22, 'sine', 0.22), 70);
  }

  playTouchdown(smooth = true) {
    if (!this.initialized || !this.enabled) return;
    this.playTone(smooth ? 110 : 72, 0.28, 'triangle', smooth ? 0.25 : 0.38);
    if (smooth) {
      setTimeout(() => this.playTone(660, 0.22, 'sine', 0.2), 120);
    }
  }

  playImpact() {
    if (!this.initialized || !this.enabled) return;
    this.playTone(62, 0.45, 'sawtooth', 0.4);
    this.playTone(46, 0.55, 'square', 0.3);
  }
}
