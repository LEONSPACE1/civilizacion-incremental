// Música de fondo de cada era, compuesta al vuelo con Web Audio: sin archivos ni licencias.
// Cada era tiene su escala, su tempo y sus instrumentos (flauta de hueso y tambor en el Paleolítico,
// caramillo y vasija de barro en el Neolítico, lira y crótalos en la Edad del Bronce, aulós y lira en
// la Antigüedad, flauta dulce, laúd y gaita en la Edad Media). La pieza va por frases de cuatro
// compases que se alternan (entrada, tema, variación y respiro), y la melodía se inventa en cada
// frase repitiendo un motivo, así suena distinta cada vez pero con forma de canción.

type Lead = 'bone' | 'pipe' | 'reed' | 'aulos' | 'recorder';
type Pluck = 'none' | 'harp' | 'lyre' | 'lute';
type Drone = 'hum' | 'reed' | 'bagpipe';
type Perc = 'frame' | 'udu' | 'tympanon' | 'tabor';

interface EraStyle {
  bpm: number;
  /** Pasos (semicorcheas) por compás: 16 para 4/4, 12 para 6/8. */
  steps: number;
  /** Tónica en Hz. */
  root: number;
  /** Escala en semitonos desde la tónica. */
  scale: number[];
  /** Grado de la escala sobre el que se apoya cada compás de la frase. */
  progression: number[];
  lead: Lead;
  pluck: Pluck;
  drone: Drone;
  perc: Perc;
  /** Golpes graves y agudos del compás ('x' fuerte, 'o' suave, '.' silencio). */
  low: string;
  high: string;
  /** Golpes agudos del último compás de la frase, que hace de redoble. */
  fill: string;
  /** Sonajero o crótalos: cada cuántos pasos suenan (0 = no hay). */
  shaker: number;
  /** Ritmos de la melodía: duraciones en pasos que suman un compás. */
  rhythms: number[][];
}

const ERA_STYLES: Record<number, EraStyle> = {
  // Paleolítico: tambor de piel como un latido, palos que chocan y una flauta de hueso.
  1: {
    bpm: 84, steps: 16, root: 146.83, scale: [0, 3, 5, 7, 10], progression: [0, 0, 3, 4],
    lead: 'bone', pluck: 'none', drone: 'hum', perc: 'frame',
    low: 'x.....x...x.....', high: '....o.......o.o.', fill: '....o...o.o.oooo', shaker: 4,
    rhythms: [[4, 4, 8], [6, 2, 8], [4, 2, 2, 8], [8, 8], [2, 2, 4, 8]],
  },
  // Neolítico: vasija de barro, sonajas de semillas, un caramillo de caña y cuerdas pulsadas.
  2: {
    bpm: 92, steps: 16, root: 164.81, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 3, 0, 4],
    lead: 'pipe', pluck: 'harp', drone: 'hum', perc: 'udu',
    low: 'x.....x.x.......', high: '..o...o...o.o.o.', fill: '..o.o.o.o.oooooo', shaker: 2,
    rhythms: [[4, 4, 4, 4], [2, 2, 4, 8], [6, 2, 4, 4], [4, 2, 2, 4, 4], [4, 4, 8]],
  },
  // Edad del Bronce: lira en arpegios, crótalos de bronce y una caña doble con aire de Oriente.
  3: {
    bpm: 98, steps: 16, root: 146.83, scale: [0, 1, 4, 5, 7, 8, 10], progression: [0, 0, 6, 0],
    lead: 'reed', pluck: 'lyre', drone: 'reed', perc: 'frame',
    low: 'x..x..x...x.....', high: '....o.....o.o..o', fill: '..o.o.o.oooooooo', shaker: 8,
    rhythms: [[4, 2, 2, 4, 4], [2, 2, 2, 2, 8], [6, 2, 8], [4, 4, 4, 4], [3, 3, 2, 8]],
  },
  // Antigüedad: aulós de dos cañas, lira y tímpano, con un paso de danza.
  4: {
    bpm: 104, steps: 16, root: 110, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 3, 4],
    lead: 'aulos', pluck: 'lyre', drone: 'reed', perc: 'tympanon',
    low: 'x.......x.x.....', high: '..o...o...o...o.', fill: '..o.o.o.o.o.oooo', shaker: 4,
    rhythms: [[4, 4, 4, 4], [2, 2, 4, 4, 4], [4, 2, 2, 8], [6, 2, 4, 4], [2, 2, 2, 2, 4, 4]],
  },
  // Edad Media: estampida en 6/8 con flauta dulce, laúd, tamboril y el bordón de la gaita.
  5: {
    bpm: 112, steps: 12, root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 6, 0, 4],
    lead: 'recorder', pluck: 'lute', drone: 'bagpipe', perc: 'tabor',
    low: 'x.....x.....', high: '....o.o...o.', fill: 'o.o.o.oooooo', shaker: 6,
    rhythms: [[4, 2, 4, 2], [6, 6], [2, 2, 2, 6], [4, 2, 6], [2, 2, 2, 4, 2]],
  },
};

/** Las frases se suceden en este orden y luego vuelven a empezar por el tema. */
const FORM = ['intro', 'theme', 'theme', 'variation', 'theme', 'rest'] as const;
type Section = (typeof FORM)[number];

export class Music {
  private era = 1;
  private bar = 0;
  private phrase = 0;
  private nextBar = 0;
  private timer: number | undefined;
  private plucks = new Map<string, AudioBuffer>();
  /** Motivo del tema: grado de la escala y duración de cada nota de los dos primeros compases. */
  private motif: { degree: number; steps: number }[][] = [];
  private lastDegree = 7;
  private readonly bus: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
    /** Si hay que componer: con el audio en silencio no se programa nada. */
    private readonly active: () => boolean,
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(out);
    this.timer = window.setInterval(() => this.schedule(), 250);
  }

  setEra(era: number): void {
    if (era === this.era) return;
    this.era = era;
    this.plucks.clear();
    // Al cambiar de era la música se apaga un momento y vuelve a empezar por la entrada.
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + 0.6);
    this.bus.gain.linearRampToValueAtTime(1, now + 2.2);
    this.phrase = 0;
    this.bar = 0;
    this.nextBar = now + 1.4;
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }

  private get style(): EraStyle {
    return ERA_STYLES[this.era] ?? ERA_STYLES[5];
  }

  private schedule(): void {
    const now = this.ctx.currentTime;
    if (!this.active()) {
      this.nextBar = Math.max(this.nextBar, now + 0.3);
      return;
    }
    // Tras una pausa larga se retoma sin intentar recuperar los compases perdidos.
    if (this.nextBar < now) this.nextBar = now + 0.1;
    while (this.nextBar < now + 1.2) {
      const barTime = this.nextBar;
      this.playBar(barTime);
      this.nextBar += this.stepDur * this.style.steps;
    }
  }

  private get stepDur(): number {
    return 60 / this.style.bpm / 4;
  }

  private freq(degree: number, octave = 0): number {
    const sc = this.style.scale;
    const o = Math.floor(degree / sc.length) + octave;
    const semis = sc[((degree % sc.length) + sc.length) % sc.length] + o * 12;
    return this.style.root * 2 ** (semis / 12);
  }

  private playBar(t: number): void {
    const st = this.style;
    const section: Section = FORM[this.phrase % FORM.length];
    const inPhrase = this.bar % 4;
    const chord = st.progression[inPhrase];
    const barDur = this.stepDur * st.steps;
    const last = inPhrase === 3;

    if (inPhrase === 0 && (section === 'theme' || section === 'variation')) this.newMotif(section === 'variation');

    // Bordón: tónica y quinta de fondo, que se apagan al final del compás.
    this.drone(t, barDur, chord, section === 'intro' && inPhrase === 0);

    // Percusión
    const drums = section !== 'intro' || inPhrase >= 2;
    if (drums) {
      const high = last && section !== 'rest' ? st.fill : st.high;
      for (let s = 0; s < st.steps; s++) {
        const when = t + s * this.stepDur + this.swing(s);
        if (st.low[s] !== '.') this.drum(when, 'low', st.low[s] === 'x' ? 1 : 0.6);
        if (high[s] !== '.' && section !== 'intro') this.drum(when, 'high', high[s] === 'x' ? 1 : 0.6);
        if (st.shaker && s % st.shaker === 0 && section !== 'intro') this.shake(when, s % (st.shaker * 2) === 0 ? 1 : 0.6);
      }
    }

    // Cuerdas pulsadas: arpegio del acorde del compás.
    if (st.pluck !== 'none') this.arpeggio(t, chord, section);

    // Melodía
    if (section === 'theme' || section === 'variation') this.melody(t, inPhrase, chord, section === 'variation');
    else if (section === 'rest' && inPhrase === 1 && Math.random() < 0.7) {
      // En el respiro, una llamada corta y lejana
      this.lead(t + this.stepDur * 4, this.freq(chord + 4, 2), this.stepDur * 6, 0.5);
    }

    this.bar++;
    if (this.bar % 4 === 0) this.phrase++;
    if (this.phrase >= FORM.length) this.phrase = 1; // la entrada solo suena al principio
  }

  /** Un poco de balanceo en los contratiempos, que lo hace sonar menos mecánico. */
  private swing(step: number): number {
    return step % 2 === 1 ? this.stepDur * 0.12 : 0;
  }

  private newMotif(variation: boolean): void {
    const st = this.style;
    const n = st.scale.length;
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    this.motif = [0, 1].map(() => {
      const rhythm = pick(st.rhythms);
      return rhythm.map((steps) => {
        // Pasos cortos sobre la escala, con algún salto de vez en cuando
        const jump = Math.random() < 0.2 ? (Math.random() < 0.5 ? -3 : 3) : Math.floor(Math.random() * 5) - 2;
        this.lastDegree = Math.min(n * 2 + 2, Math.max(2, this.lastDegree + jump));
        return { degree: this.lastDegree + (variation ? 2 : 0), steps };
      });
    });
  }

  private melody(t: number, inPhrase: number, chord: number, variation: boolean): void {
    const st = this.style;
    // Compases 1 y 2: el motivo; compás 3: el motivo otra vez, llevado al acorde; compás 4: cadencia.
    let notes = inPhrase === 3 ? null : this.motif[inPhrase === 2 ? 0 : inPhrase];
    if (!notes) {
      const half = st.steps / 2;
      notes = [
        { degree: this.lastDegree, steps: half / 2 },
        { degree: this.lastDegree - 1, steps: half / 2 },
        { degree: st.scale.length * (variation ? 2 : 1), steps: half },
      ];
    }
    const shift = inPhrase === 2 ? chord : 0;
    let s = 0;
    notes.forEach((note, k) => {
      const strong = s === 0 || s === st.steps / 2;
      // En los tiempos fuertes la nota se acerca al acorde para que no desentone con el bordón
      let degree = note.degree + shift;
      if (strong && k > 0) {
        const n = st.scale.length;
        const rel = (((degree - chord) % n) + n) % n;
        if (rel !== 0 && rel !== 2 && rel !== 4) degree += rel === 1 || rel === 3 ? -1 : rel === 5 ? -1 : 1;
      }
      const rest = !strong && Math.random() < 0.12;
      if (!rest) this.lead(t + s * this.stepDur + this.swing(s), this.freq(degree, 1), note.steps * this.stepDur * 0.95, strong ? 1 : 0.8);
      s += note.steps;
    });
  }

  private arpeggio(t: number, chord: number, section: Section): void {
    const st = this.style;
    const tones = [chord, chord + 2, chord + 4, chord + 7];
    let pattern: number[]; // índice del tono en cada paso, -1 = silencio
    if (st.pluck === 'lute') pattern = [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1];
    else if (st.pluck === 'harp') pattern = [0, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1, 3, -1, 1, -1];
    else pattern = [0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 2, -1, 3, -1];
    const sparse = section === 'intro' || section === 'rest';
    pattern.forEach((idx, s) => {
      if (idx < 0 || (sparse && s % 4 !== 0)) return;
      const octave = st.pluck === 'lute' && idx === 0 ? 0 : 1;
      this.pluck(t + s * this.stepDur + this.swing(s), this.freq(tones[idx], octave), idx === 0 ? 0.9 : 0.65);
    });
  }

  // ---------- Instrumentos ----------

  private env(t: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.bus);
    return g;
  }

  /** Voz principal de cada era. */
  private lead(t: number, freq: number, dur: number, level: number): void {
    const ctx = this.ctx;
    const kind = this.style.lead;
    const end = t + dur + 0.4;
    // Vibrato que entra poco a poco, como al soplar
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.8 + Math.random() * 0.8;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(freq * (kind === 'reed' || kind === 'aulos' ? 0.008 : 0.006), t + Math.min(0.35, dur));
    vib.connect(vibDepth);
    vib.start(t);
    vib.stop(end);

    const voices: [OscillatorType, number, number][] =
      kind === 'bone' ? [['sine', 1, 1], ['triangle', 2, 0.08]]
      : kind === 'pipe' ? [['triangle', 1, 0.8], ['sine', 2, 0.2]]
      : kind === 'recorder' ? [['triangle', 1, 0.7], ['sine', 1, 0.5], ['sine', 2, 0.12]]
      : kind === 'aulos' ? [['sawtooth', 1, 0.45], ['sawtooth', 1.006, 0.35]]
      : [['sawtooth', 1, 0.5], ['square', 1, 0.15]];
    const reedy = kind === 'reed' || kind === 'aulos';
    const peak = (reedy ? 0.07 : 0.11) * level;
    const g = this.env(t, peak, reedy ? 0.03 : 0.06, Math.max(0, dur - 0.1), 0.25);
    let into: AudioNode = g;
    if (reedy) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(4000, freq * 4);
      lp.Q.value = 2;
      lp.connect(g);
      into = lp;
    }
    for (const [type, mult, gain] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      // Ataque con una pizca de desafinación, como un instrumento de verdad
      o.frequency.setValueAtTime(freq * mult * 0.985, t);
      o.frequency.linearRampToValueAtTime(freq * mult, t + 0.05);
      vibDepth.connect(o.frequency);
      const vg = ctx.createGain();
      vg.gain.value = gain;
      o.connect(vg).connect(into);
      o.start(t);
      o.stop(end);
    }
    // Soplo de aire al empezar la nota en las flautas
    if (!reedy) this.noiseHit(t, freq * 2, 1.5, 0.05, 0.025 * level);
  }

  /** Cuerda pulsada con el algoritmo de Karplus-Strong: lira, arpa o laúd. */
  private pluck(t: number, freq: number, level: number): void {
    const kind = this.style.pluck;
    const key = `${kind}:${freq.toFixed(1)}`;
    let buf = this.plucks.get(key);
    if (!buf) {
      buf = this.makePluck(freq, kind === 'lute' ? 0.992 : kind === 'harp' ? 0.996 : 0.997, kind === 'lute' ? 0.5 : 0.8);
      this.plucks.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.16 * level;
    src.connect(g).connect(this.bus);
    src.start(t);
  }

  private makePluck(freq: number, decay: number, brightness: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 1.4);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    // Ráfaga inicial de ruido, más o menos apagada según el instrumento
    let prev = 0;
    for (let i = 0; i < period; i++) {
      const n = Math.random() * 2 - 1;
      prev = prev + (n - prev) * brightness;
      d[i] = prev;
    }
    for (let i = period; i < len; i++) d[i] = decay * 0.5 * (d[i - period] + d[i - period - 1 >= 0 ? i - period - 1 : 0]);
    // Final suave para que no chasquee
    for (let i = len - 2000; i < len; i++) d[i] *= (len - i) / 2000;
    return buf;
  }

  private drone(t: number, dur: number, chord: number, swell: boolean): void {
    const ctx = this.ctx;
    const kind = this.style.drone;
    const root = this.freq(0, -1);
    const pitches = kind === 'hum' ? [root, root * 1.5] : [root, root * 1.5, root * 2];
    const peak = kind === 'bagpipe' ? 0.035 : kind === 'reed' ? 0.03 : 0.05;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (swell ? 1.5 : 0.25));
    g.gain.setValueAtTime(peak, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'hum' ? 500 : kind === 'bagpipe' ? 1400 : 900;
    lp.connect(g).connect(this.bus);
    // En el último grado del compás el bordón no cambia: solo cambia de color con el acorde
    lp.frequency.setValueAtTime(lp.frequency.value * (chord === 0 ? 1 : 1.2), t);
    for (const f of pitches) {
      const o = ctx.createOscillator();
      o.type = kind === 'hum' ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.35);
    }
  }

  private drum(t: number, which: 'low' | 'high', level: number): void {
    const perc = this.style.perc;
    if (which === 'low') {
      const [from, to] = perc === 'udu' ? [110, 160] : perc === 'tabor' ? [150, 90] : perc === 'tympanon' ? [130, 70] : [110, 55];
      this.thump(t, from, to, 0.35, 0.32 * level);
      this.noiseHit(t, 300, 0.8, 0.05, 0.06 * level);
    } else if (perc === 'udu') {
      // Golpe en la boca de la vasija: un "bup" que sube
      this.thump(t, 260, 360, 0.12, 0.12 * level);
    } else if (perc === 'tabor') {
      // Tamboril con bordón: chasquido brillante
      this.noiseHit(t, 2200, 0.9, 0.09, 0.12 * level);
      this.thump(t, 240, 200, 0.06, 0.08 * level);
    } else {
      // Golpe de dedos en el borde del pandero
      this.noiseHit(t, 1500, 1.2, 0.06, 0.11 * level);
      this.thump(t, 330, 260, 0.05, 0.05 * level);
    }
  }

  /** Sonajero de semillas o, desde la Edad del Bronce, crótalos de metal. */
  private shake(t: number, level: number): void {
    const era = this.era;
    if (era === 3 || era === 4) {
      if (level < 1) return;
      for (const [f, g] of [[2630, 0.02], [3910, 0.012], [5270, 0.006]] as const) this.ring(t, f, 0.9, g);
    } else this.noiseHit(t, 6500, 1.2, 0.05, 0.04 * level);
  }

  private thump(t: number, from: number, to: number, decay: number, gain: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.8);
    const g = this.env(t, gain, 0.004, 0, decay);
    o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private ring(t: number, f: number, decay: number, gain: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = f;
    const g = this.env(t, gain, 0.002, 0, decay);
    o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private noiseHit(t: number, freq: number, q: number, decay: number, gain: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(t, gain, 0.002, 0, decay);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
  }
}
