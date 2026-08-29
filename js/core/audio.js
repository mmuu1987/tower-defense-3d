// WebAudio 合成音效引擎：零素材依赖，程序化生成所有音效与主题 BGM
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.muted = false;
    this.vol = 0.55;
    this._last = {};
    this.musicTimer = null;
    this._rngState = 1234567;
  }

  _ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.vol; // 用已存音量（曾硬编码 0.55 导致存档音量重载失效）
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);
      // 白噪声缓冲
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }

  resume() { if (this._ensure() && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v));
    if (!this.muted && this.master) this.master.gain.value = this.vol;
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : (this.vol ?? 0.55);
  }

  throttle(key, ms) {
    const n = performance.now();
    if (n - (this._last[key] || 0) < ms) return false;
    this._last[key] = n;
    return true;
  }

  _rng() { // 音乐序列用确定性随机
    this._rngState = (this._rngState * 1103515245 + 12345) & 0x7fffffff;
    return this._rngState / 0x7fffffff;
  }

  // 基础单元：振荡器音（可滑音）
  tone({ f = 440, f2 = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.004, bus = null }) {
    if (!this._ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type === 'short' ? 'sine' : type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(bus || this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // 基础单元：滤波噪声
  noise({ dur = 0.2, vol = 0.3, type = 'bandpass', f = 1000, f2 = null, q = 1, delay = 0 }) {
    if (!this._ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const fl = this.ctx.createBiquadFilter();
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(fl).connect(g).connect(this.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // ———— 具体音效 ————
  shoot(kind) {
    if (!this.throttle('shoot' + kind, 45)) return;
    if (kind === 'bullet') {
      this.noise({ dur: 0.09, vol: 0.22, f: 2400, f2: 700, q: 0.8 });
      this.tone({ f: 220, f2: 60, type: 'square', dur: 0.07, vol: 0.1 });
    } else {
      this.noise({ dur: 0.07, vol: 0.1, f: 3200, f2: 1400, q: 1.4 });
    }
  }
  mortar() {
    this.tone({ f: 130, f2: 50, type: 'triangle', dur: 0.22, vol: 0.34 });
    this.noise({ dur: 0.16, vol: 0.16, f: 500, f2: 180, q: 0.7 });
  }
  hit(armored) {
    if (!this.throttle('hit', 60)) return;
    if (armored) {
      this.tone({ f: 1900 + Math.random() * 400, f2: 900, type: 'square', dur: 0.05, vol: 0.07 });
      this.noise({ dur: 0.05, vol: 0.1, f: 4200, q: 2 });
    } else {
      this.tone({ f: 340 + Math.random() * 120, f2: 140, type: 'triangle', dur: 0.07, vol: 0.11 });
    }
  }
  explosion(size = 1.5) {
    if (!this.throttle('boom', 80)) return;
    this.noise({ dur: 0.5 + size * 0.1, vol: 0.4, type: 'lowpass', f: 1400, f2: 90, q: 0.5 });
    this.tone({ f: 90, f2: 32, type: 'sine', dur: 0.42, vol: 0.44 });
  }
  frost() {
    if (!this.throttle('frost', 120)) return;
    this.tone({ f: 1250, f2: 2100, type: 'sine', dur: 0.18, vol: 0.07 });
    this.tone({ f: 1875, f2: 3150, type: 'sine', dur: 0.22, vol: 0.045, delay: 0.03 });
  }
  zap() {
    if (!this.throttle('zap', 90)) return;
    this.noise({ dur: 0.12, vol: 0.14, f: 5200, f2: 900, q: 3 });
    this.tone({ f: 98 + Math.random() * 40, f2: 48, type: 'sawtooth', dur: 0.1, vol: 0.09 });
  }
  build() {
    this.tone({ f: 200, f2: 380, type: 'square', dur: 0.1, vol: 0.12 });
    this.noise({ dur: 0.14, vol: 0.12, f: 800, f2: 300, q: 0.8, delay: 0.02 });
  }
  upgradeSnd() {
    [523, 659, 784].forEach((f, i) => this.tone({ f, type: 'triangle', dur: 0.12, vol: 0.12, delay: i * 0.07 }));
  }
  sell() {
    this.tone({ f: 500, f2: 240, type: 'triangle', dur: 0.16, vol: 0.12 });
  }
  coin() {
    if (!this.throttle('coin', 90)) return;
    this.tone({ f: 1318, type: 'sine', dur: 0.07, vol: 0.09 });
    this.tone({ f: 1760, type: 'sine', dur: 0.1, vol: 0.07, delay: 0.05 });
  }
  leak() {
    this.tone({ f: 220, f2: 110, type: 'sawtooth', dur: 0.3, vol: 0.18 });
    this.tone({ f: 165, f2: 82, type: 'sawtooth', dur: 0.34, vol: 0.14, delay: 0.12 });
  }
  waveStart(boss) {
    const notes = boss ? [196, 196, 233, 294] : [262, 330, 392];
    notes.forEach((f, i) => this.tone({ f, type: 'triangle', dur: 0.22, vol: 0.14, delay: i * 0.11 }));
  }
  victory() {
    [392, 494, 587, 784, 988].forEach((f, i) => this.tone({ f, type: 'triangle', dur: 0.34, vol: 0.16, delay: i * 0.13 }));
  }
  defeat() {
    [330, 277, 233, 175].forEach((f, i) => this.tone({ f, type: 'sine', dur: 0.42, vol: 0.17, delay: i * 0.2 }));
  }
  click() { this.tone({ f: 900, type: 'square', dur: 0.03, vol: 0.04 }); }
  roar() {
    this.tone({ f: 70, f2: 38, type: 'sawtooth', dur: 0.8, vol: 0.3 });
    this.noise({ dur: 0.7, vol: 0.16, type: 'lowpass', f: 420, f2: 100, q: 0.6 });
  }

  // ———— 主题 BGM（生成式，低音量氛围）————
  startMusic(themeId) {
    if (!this._ensure()) return;
    this.stopMusic();
    const conf = {
      meadow: { root: 220, scale: [0, 2, 4, 7, 9], bpm: 84, pad: 'sine' },
      lava:   { root: 174.6, scale: [0, 1, 4, 5, 7], bpm: 66, pad: 'sawtooth' },
      frost:  { root: 196, scale: [0, 2, 3, 7, 10], bpm: 74, pad: 'triangle' },
      sand:   { root: 164.8, scale: [0, 1, 4, 5, 8], bpm: 70, pad: 'sawtooth' }, // 弗里几亚主导：荒漠感
      graveyard: { root: 146.8, scale: [0, 1, 3, 6, 7, 8], bpm: 60, pad: 'sawtooth' }, // 幽冥暗夜调式
    }[themeId] || { root: 220, scale: [0, 2, 4], bpm: 80, pad: 'sine' };
    const beat = 60 / conf.bpm;
    let step = 0;
    const nf = (semi) => conf.root * Math.pow(2, semi / 12);

    const tick = () => {
      if (!this.ctx || this.ctx.state !== 'running') return; // 挂起时不积压调度
      const t = this.ctx.currentTime + 0.08;
      // 低音垫（每 4 拍）
      if (step % 4 === 0) {
        const chordRoot = conf.scale[Math.floor(step / 4) % conf.scale.length];
        [0, 7, 12].forEach((iv) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const fl = this.ctx.createBiquadFilter();
          fl.type = 'lowpass'; fl.frequency.value = 620;
          o.type = conf.pad;
          o.frequency.value = nf(chordRoot + iv - 12) / 2;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.05, t + beat * 1.2);
          g.gain.linearRampToValueAtTime(0, t + beat * 3.8);
          o.connect(fl).connect(g).connect(this.musicBus);
          o.start(t); o.stop(t + beat * 4);
        });
      }
      // 琶音点缀
      if (step % 2 === 1 && this._rng() > 0.35) {
        const semi = conf.scale[Math.floor(this._rng() * conf.scale.length)] + 12;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = nf(semi);
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
        o.connect(g).connect(this.musicBus);
        o.start(t); o.stop(t + beat);
      }
      step++;
    };
    tick();
    this.musicTimer = setInterval(tick, beat * 1000);
  }

  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}
