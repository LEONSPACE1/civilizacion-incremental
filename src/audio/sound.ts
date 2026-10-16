// Sonidos sintetizados con Web Audio: no hay archivos que descargar ni licencias que pagar.
// El navegador solo deja sonar audio después de que el jugador toca algo, así que el
// contexto se crea con el primer clic.

const SETTINGS_KEY = 'civilizacion-incremental:sound';

interface SoundSettings {
  muted: boolean;
  volume: number;
}

function loadSettings(): SoundSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { muted: s.muted === true, volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.7 };
  } catch {
    return { muted: false, volume: 0.7 };
  }
}

function saveSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Sin almacenamiento: los ajustes duran solo esta sesión.
  }
}

export class Sound {
  private settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private crackleTimer: number | undefined;
  private cricketTimer: number | undefined;

  get muted(): boolean {
    return this.settings.muted;
  }

  get volume(): number {
    return this.settings.volume;
  }

  /** Llamar desde un gesto del jugador (clic o tecla). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(this.master);
      this.ambience = this.ctx.createGain();
      this.ambience.gain.value = 0.35;
      this.ambience.connect(this.master);
      this.noise = this.makeNoise(2);
      this.applyVolume();
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    saveSettings(this.settings);
    this.applyVolume();
  }

  setVolume(volume: number): void {
    this.settings.volume = volume;
    saveSettings(this.settings);
    this.applyVolume();
  }

  /** Pausa el ambiente cuando la pestaña no se ve. */
  setActive(active: boolean): void {
    if (!this.ctx) return;
    if (active) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  // ---------- Efectos ----------

  /** Recolectar: un "pop" suave de baya, con tono un poco distinto cada vez. */
  gather(): void {
    this.tone({ type: 'triangle', freq: 520 + Math.random() * 180, to: 300, attack: 0.004, decay: 0.12, gain: 0.35 });
    this.noiseBurst({ freq: 2400, q: 1.2, decay: 0.04, gain: 0.12 });
  }

  /** Comprar un edificio: golpe de madera. */
  buy(): void {
    this.tone({ type: 'sine', freq: 190, to: 120, decay: 0.18, gain: 0.5 });
    this.tone({ type: 'triangle', freq: 330, to: 260, decay: 0.09, gain: 0.25, delay: 0.01 });
    this.noiseBurst({ freq: 1300, q: 3, decay: 0.05, gain: 0.25 });
  }

  /** Comprar una mejora: campanillas ascendentes. */
  upgrade(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ type: 'sine', freq: f, decay: 0.6, gain: 0.22, delay: i * 0.07 }));
  }

  /** Algo nuevo se desbloquea. */
  unlockSound(): void {
    [659.25, 987.77].forEach((f, i) => this.tone({ type: 'sine', freq: f, decay: 0.45, gain: 0.18, delay: i * 0.1 }));
  }

  /** Meta de la era: tambores y fanfarria. */
  goal(): void {
    [0, 0.25, 0.5].forEach((d) => this.tone({ type: 'sine', freq: 110, to: 55, decay: 0.35, gain: 0.6, delay: d }));
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ type: 'triangle', freq: f, decay: 0.9, gain: 0.2, delay: 0.75 + i * 0.12 }));
  }

  // ---------- Internos ----------

  private applyVolume(): void {
    if (!this.ctx) return;
    const target = this.settings.muted ? 0 : this.settings.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(o: { type: OscillatorType; freq: number; to?: number; attack?: number; decay: number; gain: number; delay?: number; out?: AudioNode }): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    osc.connect(g).connect(o.out ?? this.sfx);
    osc.start(t);
    osc.stop(t + o.decay + 0.05);
  }

  private noiseBurst(o: { freq: number; q: number; decay: number; gain: number; out?: AudioNode; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = o.freq;
    filter.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    src.connect(filter).connect(g).connect(o.out ?? this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.decay + 0.02);
  }

  /** Ambiente nocturno: rumor grave del fuego, chasquidos de leña y grillos lejanos. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 320;
    const rg = ctx.createGain();
    rg.gain.value = 0.25;
    rumble.connect(low).connect(rg).connect(this.ambience);
    rumble.start();

    const crackle = () => {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.noiseBurst({ freq: 1800 + Math.random() * 3000, q: 4, decay: 0.015 + Math.random() * 0.03, gain: 0.15 + Math.random() * 0.35, out: this.ambience, delay: i * 0.03 });
      }
      this.crackleTimer = window.setTimeout(crackle, 120 + Math.random() * 700);
    };
    crackle();

    const cricket = () => {
      const f = 4200 + Math.random() * 500;
      for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: f, decay: 0.04, gain: 0.03, delay: i * 0.07, out: this.ambience });
      this.cricketTimer = window.setTimeout(cricket, 1500 + Math.random() * 4000);
    };
    this.cricketTimer = window.setTimeout(cricket, 2000);
  }

  dispose(): void {
    window.clearTimeout(this.crackleTimer);
    window.clearTimeout(this.cricketTimer);
    void this.ctx?.close();
  }
}
