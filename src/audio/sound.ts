// Sonidos sintetizados con Web Audio: no hay archivos que descargar ni licencias que pagar.
// El navegador solo deja sonar audio después de que el jugador toca algo, así que el
// contexto se crea con el primer clic.

import { Music } from './music';

const SETTINGS_KEY = 'civilizacion-incremental:sound';

export interface SoundSettings {
  muted: boolean;
  /** Volumen general. */
  volume: number;
  /** Efectos al recolectar, comprar y desbloquear. */
  effects: number;
  /** Sonido de fondo de la era: fogata y grillos de noche, pájaros de día. */
  ambience: number;
  /** Música de la era. */
  music: number;
}

const DEFAULTS: SoundSettings = { muted: false, volume: 0.7, effects: 0.9, ambience: 0.6, music: 0.6 };
const clamp01 = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

function loadSettings(): SoundSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return {
      muted: s.muted === true,
      volume: clamp01(s.volume, DEFAULTS.volume),
      effects: clamp01(s.effects, DEFAULTS.effects),
      ambience: clamp01(s.ambience, DEFAULTS.ambience),
      music: clamp01(s.music, DEFAULTS.music),
    };
  } catch {
    return { ...DEFAULTS };
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
  private musicBus!: GainNode;
  private music: Music | null = null;
  private noise!: AudioBuffer;
  private crackleTimer: number | undefined;
  private cricketTimer: number | undefined;
  private daylight = 1;
  private birdTimer: number | undefined;
  private anvilTimer: number | undefined;
  private cicadaTimer: number | undefined;
  private churchTimer: number | undefined;
  private industryTimer: number | undefined;
  private era = 1;
  /** Si la pestaña se ve. */
  private pageVisible = true;

  get muted(): boolean {
    return this.settings.muted;
  }

  get volume(): number {
    return this.settings.volume;
  }

  get effects(): number {
    return this.settings.effects;
  }

  get ambienceVolume(): number {
    return this.settings.ambience;
  }

  get musicVolume(): number {
    return this.settings.music;
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
      this.sfx.connect(this.master);
      this.ambience = this.ctx.createGain();
      this.ambience.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.noise = this.makeNoise(2);
      this.applyVolume();
      this.startAmbience();
      this.music = new Music(this.ctx, this.musicBus, this.noise, () => this.audible && this.settings.music > 0);
      this.music.setEra(this.era);
    }
    this.syncRunning();
  }

  /** Si no va a oírse nada, el audio se apaga del todo: el procesado de sonido gasta batería aunque esté en silencio. */
  private get audible(): boolean {
    return this.pageVisible && !this.settings.muted && this.settings.volume > 0;
  }

  private syncRunning(): void {
    if (!this.ctx) return;
    if (this.audible) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } else if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    saveSettings(this.settings);
    this.applyVolume();
    this.syncRunning();
  }

  setVolume(volume: number): void {
    this.set({ volume });
  }

  setEffects(effects: number): void {
    this.set({ effects });
  }

  setAmbience(ambience: number): void {
    this.set({ ambience });
  }

  setMusic(music: number): void {
    this.set({ music });
  }

  private set(change: Partial<SoundSettings>): void {
    Object.assign(this.settings, change);
    saveSettings(this.settings);
    this.applyVolume();
    this.syncRunning();
  }

  /** El ambiente cambia con la era y con la hora: grillos de noche y pájaros de día en todas, martillos
   *  sobre el yunque desde la Edad del Bronce, cigarras en la Antigüedad y campanas lejanas desde la
   *  Edad Media, silbatos de fábrica y resoplidos de vapor en la Revolución Industrial y, en la Era
   *  Moderna, el rumor del tráfico y algún avión a lo lejos. Encima suena la música de la era. */
  setEra(era: number): void {
    this.era = era;
    this.music?.setEra(era);
  }

  /** Luz del día en la aldea (0 = noche, 1 = día): de noche cantan los grillos y de día los pájaros. */
  setDaylight(k: number): void {
    this.daylight = k;
  }

  /** Pausa el ambiente cuando la pestaña no se ve. */
  setActive(active: boolean): void {
    this.pageVisible = active;
    this.syncRunning();
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
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, now, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.effects, now, 0.05);
    // El ambiente se mezcla bajo para no tapar los efectos.
    this.ambience.gain.setTargetAtTime(this.settings.ambience * 0.55, now, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.8, now, 0.05);
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
      // En silencio no se programan sonidos: se acumularían y sonarían todos juntos al volver.
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && this.audible; i++) {
        this.noiseBurst({ freq: 1800 + Math.random() * 3000, q: 4, decay: 0.015 + Math.random() * 0.03, gain: 0.15 + Math.random() * 0.35, out: this.ambience, delay: i * 0.03 });
      }
      this.crackleTimer = window.setTimeout(crackle, this.audible ? 120 + Math.random() * 700 : 2000);
    };
    crackle();

    const cricket = () => {
      // Los grillos cantan de noche en todas las eras
      if (this.daylight < 0.4 && this.audible) {
        const f = 4200 + Math.random() * 500;
        for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: f, decay: 0.04, gain: 0.03, delay: i * 0.07, out: this.ambience });
      }
      this.cricketTimer = window.setTimeout(cricket, 1500 + Math.random() * 4000);
    };
    this.cricketTimer = window.setTimeout(cricket, 2000);

    // De día cantan los pájaros: trinos cortos que suben y bajan.
    const bird = () => {
      if (this.daylight > 0.6 && this.audible) {
        const base = 2200 + Math.random() * 1400, notes = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < notes; i++) {
          const up = i % 2 === 0;
          this.tone({ type: 'sine', freq: up ? base : base * 1.35, to: up ? base * 1.4 : base * 0.95, decay: 0.07 + Math.random() * 0.05, gain: 0.05, delay: i * 0.11, out: this.ambience });
        }
      }
      this.birdTimer = window.setTimeout(bird, 1800 + Math.random() * 5000);
    };
    this.birdTimer = window.setTimeout(bird, 1200);

    // En la Edad del Bronce suenan a lo lejos martillos sobre el bronce: golpes cortos con
    // armónicos que no casan entre sí, como el metal.
    const anvil = () => {
      // Los martillos callan de noche
      if (this.era >= 3 && this.daylight > 0.5 && this.audible) {
        // En la Antigüedad se forja hierro: el golpe suena más grave.
        const base = (this.era >= 4 ? 620 : 900) + Math.random() * 300, hits = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < hits; i++) {
          for (const [k, g] of [[1, 0.035], [2.76, 0.02], [5.4, 0.01]] as const) {
            this.tone({ type: 'sine', freq: base * k, decay: 0.5 + Math.random() * 0.3, gain: g, delay: i * 0.42, out: this.ambience });
          }
          this.noiseBurst({ freq: 3200, q: 2, decay: 0.03, gain: 0.05, out: this.ambience, delay: i * 0.42 });
        }
      }
      this.anvilTimer = window.setTimeout(anvil, 2500 + Math.random() * 6000);
    };
    this.anvilTimer = window.setTimeout(anvil, 1800);

    // Antigüedad: el canto de las cigarras al mediodía, pulsos muy rápidos que suben y se apagan.
    const cicada = () => {
      if (this.era === 4 && this.daylight > 0.7 && this.audible) {
        const f = 5600 + Math.random() * 900, pulses = 18 + Math.floor(Math.random() * 20);
        for (let i = 0; i < pulses; i++) {
          const k = Math.sin((i / pulses) * Math.PI);
          this.tone({ type: 'square', freq: f, decay: 0.018, gain: 0.006 + k * 0.012, delay: i * 0.032, out: this.ambience });
        }
      }
      this.cicadaTimer = window.setTimeout(cicada, 2500 + Math.random() * 5000);
    };
    this.cicadaTimer = window.setTimeout(cicada, 1500);

    // Edad Media: a lo lejos dan la hora las campanas de la iglesia. Los parciales de una campana
    // no son armónicos (0,5, 1, 1,2, 1,5, 2…), por eso suena a metal y no a flauta.
    const church = () => {
      if (this.era >= 5 && this.audible) {
        const base = 220 + Math.floor(Math.random() * 3) * 27.5, strokes = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < strokes; i++) {
          for (const [k, g, d] of [[0.5, 0.03, 3.5], [1, 0.035, 2.8], [1.19, 0.018, 2], [1.5, 0.012, 1.6], [2, 0.01, 1.2], [2.66, 0.006, 0.8]] as const) {
            this.tone({ type: 'sine', freq: base * k, attack: 0.004, decay: d, gain: g, delay: i * 1.6, out: this.ambience });
          }
        }
      }
      this.churchTimer = window.setTimeout(church, 22000 + Math.random() * 20000);
    };
    this.churchTimer = window.setTimeout(church, 8000);

    // Revolución Industrial: el silbato de la fábrica (dos tonos que se rozan) y resoplidos de vapor.
    // En la Era Moderna, un claxon lejano y el paso de un avión.
    const industry = () => {
      if (this.era === 7 && this.audible) {
        if (Math.random() < 0.35 && this.daylight > 0.3) {
          for (const f of [440, 523]) this.tone({ type: 'sawtooth', freq: f * 0.98, to: f, attack: 0.25, decay: 1.6, gain: 0.008, out: this.ambience });
        } else {
          const puffs = 2 + Math.floor(Math.random() * 4);
          for (let i = 0; i < puffs; i++) this.noiseBurst({ freq: 900 + Math.random() * 400, q: 0.7, decay: 0.22, gain: 0.07, out: this.ambience, delay: i * 0.3 });
        }
      } else if (this.era >= 8 && this.audible) {
        if (Math.random() < 0.5) {
          for (const f of [392, 494]) this.tone({ type: 'square', freq: f, decay: 0.25, gain: 0.006, out: this.ambience });
        } else this.noiseBurst({ freq: 300, q: 0.5, decay: 3.5, gain: 0.05, out: this.ambience });
      }
      this.industryTimer = window.setTimeout(industry, 7000 + Math.random() * 12000);
    };
    this.industryTimer = window.setTimeout(industry, 5000);
  }

  dispose(): void {
    window.clearTimeout(this.crackleTimer);
    window.clearTimeout(this.cricketTimer);
    window.clearTimeout(this.birdTimer);
    window.clearTimeout(this.anvilTimer);
    window.clearTimeout(this.cicadaTimer);
    window.clearTimeout(this.churchTimer);
    window.clearTimeout(this.industryTimer);
    this.music?.dispose();
    void this.ctx?.close();
  }
}
