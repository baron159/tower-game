// Procedural audio — synthesised on demand with the Web Audio API.
// Zero binary asset dependencies.

let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    ctx = new Ctor();
  }
  // Resume on user gesture (autoplay policy).
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// One-time priming on first user gesture.
let primed = false;
export function primeAudio() {
  if (primed) return;
  primed = true;
  ac();
}

interface ToneOpts {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  decay?: number;
  detune?: number;
}

function tone(opts: ToneOpts, t0Offset = 0): void {
  const c = ac();
  const t0 = c.currentTime + t0Offset;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.value = opts.freq;
  if (opts.detune) osc.detune.value = opts.detune;
  const peak = opts.gain ?? 0.18;
  const a = opts.attack ?? 0.005;
  const d = opts.decay ?? opts.duration;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + a + d + 0.05);
}

function noiseBurst(duration: number, gain = 0.12, filterFreq = 1200): void {
  const c = ac();
  const t0 = c.currentTime;
  const len = Math.floor(c.sampleRate * duration);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const k = 1 - i / len;
    data[i] = (Math.random() * 2 - 1) * k * k;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t0);
}

// --- Sound effects ---

export const sfx = {
  click(): void {
    tone({ freq: 660, duration: 0.06, type: "square", gain: 0.06 });
  },
  cardDraw(): void {
    noiseBurst(0.18, 0.10, 4500);
    tone({ freq: 480, duration: 0.08, type: "triangle", gain: 0.08 }, 0.02);
  },
  blockPlace(): void {
    tone({ freq: 180, duration: 0.18, type: "square", gain: 0.12 });
    noiseBurst(0.12, 0.08, 800);
  },
  blockPickup(): void {
    tone({ freq: 320, duration: 0.08, type: "triangle", gain: 0.07 });
  },
  yourTurn(): void {
    tone({ freq: 660, duration: 0.10, type: "sine", gain: 0.12 });
    tone({ freq: 880, duration: 0.12, type: "sine", gain: 0.10 }, 0.08);
    tone({ freq: 1320, duration: 0.16, type: "sine", gain: 0.08 }, 0.18);
  },
  collapse(): void {
    // Rumble + crashes
    noiseBurst(0.6, 0.18, 300);
    for (let i = 0; i < 8; i++) {
      tone({ freq: 80 + Math.random() * 60, duration: 0.18, type: "square", gain: 0.10 }, i * 0.04);
    }
  },
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, duration: 0.22, type: "triangle", gain: 0.12 }, i * 0.12));
  },
  lose(): void {
    [392, 330, 261.63].forEach((f, i) =>
      tone({ freq: f, duration: 0.32, type: "sawtooth", gain: 0.10 }, i * 0.18));
  },
};
