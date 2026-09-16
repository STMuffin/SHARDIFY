/**
 * Tiny WebAudio sound engine: clicks, correct/wrong answers and countdown ticks.
 * No audio files needed — everything is synthesized on the fly.
 */

let ctx: AudioContext | null = null;
let muted = false;

const STORAGE_KEY = "shardify:muted";

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(STORAGE_KEY) === "1";
}

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  }
}

type ToneOptions = {
  freq: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
};

function tone({ freq, duration = 0.12, type = "sine", gain = 0.08, delay = 0, slideTo }: ToneOptions) {
  const ac = audioCtx();
  if (!ac || muted) return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  vol.gain.setValueAtTime(0.0001, start);
  vol.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(vol).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const sfx = {
  click() {
    tone({ freq: 520, duration: 0.07, type: "triangle", gain: 0.05, slideTo: 720 });
  },
  hover() {
    tone({ freq: 880, duration: 0.05, type: "sine", gain: 0.02 });
  },
  correct() {
    tone({ freq: 660, duration: 0.14, type: "triangle", gain: 0.08 });
    tone({ freq: 880, duration: 0.16, type: "triangle", gain: 0.08, delay: 0.1 });
    tone({ freq: 1320, duration: 0.22, type: "sine", gain: 0.07, delay: 0.2 });
  },
  partial() {
    tone({ freq: 620, duration: 0.1, type: "triangle", gain: 0.06 });
    tone({ freq: 820, duration: 0.12, type: "triangle", gain: 0.06, delay: 0.08 });
  },
  wrong() {
    tone({ freq: 220, duration: 0.2, type: "sawtooth", gain: 0.05, slideTo: 110 });
  },
  tick() {
    tone({ freq: 1040, duration: 0.045, type: "square", gain: 0.035 });
  },
  timeUp() {
    tone({ freq: 400, duration: 0.35, type: "sawtooth", gain: 0.06, slideTo: 160 });
  },
  /** Wrong, but very close to the answer. */
  near() {
    tone({ freq: 500, duration: 0.09, type: "triangle", gain: 0.05 });
    tone({ freq: 700, duration: 0.11, type: "triangle", gain: 0.045, delay: 0.07 });
  },
  /** Round result being revealed. */
  reveal() {
    tone({ freq: 300, duration: 0.18, type: "sine", gain: 0.06, slideTo: 760 });
    tone({ freq: 900, duration: 0.2, type: "triangle", gain: 0.05, delay: 0.14 });
  },
  /** New round begins. */
  roundStart() {
    tone({ freq: 620, duration: 0.09, type: "square", gain: 0.04 });
    tone({ freq: 930, duration: 0.14, type: "triangle", gain: 0.05, delay: 0.08 });
  },
  /** Someone joined the room. */
  join() {
    tone({ freq: 700, duration: 0.08, type: "sine", gain: 0.05, slideTo: 1050 });
  },
  /** Message sent in the chat guess mode. */
  send() {
    tone({ freq: 760, duration: 0.06, type: "sine", gain: 0.035, slideTo: 980 });
  },
  /** End of the game fanfare. */
  victory() {
    tone({ freq: 523, duration: 0.14, type: "triangle", gain: 0.08 });
    tone({ freq: 659, duration: 0.14, type: "triangle", gain: 0.08, delay: 0.12 });
    tone({ freq: 784, duration: 0.16, type: "triangle", gain: 0.08, delay: 0.24 });
    tone({ freq: 1047, duration: 0.4, type: "sine", gain: 0.08, delay: 0.38 });
  },
  start() {
    tone({ freq: 440, duration: 0.12, type: "triangle", gain: 0.07 });
    tone({ freq: 660, duration: 0.12, type: "triangle", gain: 0.07, delay: 0.1 });
    tone({ freq: 990, duration: 0.25, type: "sine", gain: 0.07, delay: 0.2 });
  },
};

/** Plays a soft click on every button / link press across the app. */
export function installClickSounds() {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest("button, a, [role='button'], input[type='range'], label");
    if (!el) return;
    if ((el as HTMLButtonElement).disabled) return;
    sfx.click();
  };
  window.addEventListener("pointerdown", handler, { passive: true });
  return () => window.removeEventListener("pointerdown", handler);
}
