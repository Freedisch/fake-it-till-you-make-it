// Tiny synthesized sound effects (WebAudio, no audio files). window.Sound.play("name").
(() => {
  "use strict";

  let ctx = null;
  let master = null;
  let muted = false;
  try {
    muted = localStorage.getItem("fitymi.muted") === "1";
  } catch {
    /* storage blocked: default to sound on */
  }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One enveloped oscillator note. `at` is seconds from now.
  function tone(freq, at, dur, { type = "triangle", gain = 0.18, slideTo = null } = {}) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const SOUNDS = {
    click: () => tone(700, 0, 0.06, { type: "square", gain: 0.04 }),
    tick: () => tone(1250, 0, 0.05, { type: "square", gain: 0.035 }),
    good: () => {
      tone(660, 0, 0.12);
      tone(990, 0.09, 0.22);
    },
    meh: () => tone(440, 0, 0.16),
    suspicious: () => tone(240, 0, 0.32, { type: "sawtooth", gain: 0.06, slideTo: 150 }),
    caught: () => {
      for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, i * 0.11, 0.1, { type: "square", gain: 0.05 });
    },
    question: () => {
      tone(523, 0, 0.12);
      tone(392, 0.12, 0.24);
    },
    timeup: () => tone(160, 0, 0.45, { type: "sawtooth", gain: 0.08 }),
    stage: () => {
      tone(587, 0, 0.12);
      tone(880, 0.1, 0.12);
      tone(1175, 0.2, 0.25);
    },
    hired: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.6 : 0.16, { gain: 0.2 }));
      tone(1319, 0.44, 0.6, { gain: 0.1 });
    },
    overqualified: () => {
      tone(784, 0, 0.14);
      tone(784, 0.16, 0.14);
      tone(523, 0.34, 0.5, { slideTo: 494 });
    },
    busted: () => {
      for (let i = 0; i < 3; i++) tone(950, i * 0.38, 0.34, { type: "square", gain: 0.05, slideTo: 520 });
    },
    rejected: () => {
      // sad trombone: four sinking notes, the last one long
      [392, 370, 349].forEach((f, i) => tone(f, i * 0.32, 0.3, { type: "sawtooth", gain: 0.06, slideTo: f * 0.97 }));
      tone(330, 0.96, 0.9, { type: "sawtooth", gain: 0.06, slideTo: 300 });
    },
  };

  window.Sound = {
    // Call from a click/keypress so browsers allow audio.
    unlock() {
      if (!muted) audio();
    },
    play(name) {
      if (muted || !SOUNDS[name]) return;
      try {
        SOUNDS[name]();
      } catch {
        /* audio is decoration; never let it break the game */
      }
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem("fitymi.muted", muted ? "1" : "0");
      } catch {
        /* fine */
      }
      if (!muted) audio();
      return muted;
    },
  };
})();
