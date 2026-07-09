const root = document.documentElement;
const audioToggle = document.querySelector(".audio-toggle");
const canvas = document.querySelector(".word-field");
const ctx = canvas.getContext("2d", { alpha: true });
const arms = [61, 133, 205, 277, 349];
const wordSlots = [];

let context;
let analyser;
let data;
let gainNode;
let timer;
let frame;
let playing = false;
let lastPulse = 0;
let lastMotion = performance.now();
let motion = 0;
let deviceScale = 1;
let viewportWidth = 0;
let viewportHeight = 0;

const cubic = (a, b, c, d, t) => {
  const mt = 1 - t;
  return mt ** 3 * a + 3 * mt ** 2 * t * b + 3 * mt * t ** 2 * c + t ** 3 * d;
};

const armPoint = (angleDeg, t, width, height) => {
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.max(width, height) * 1.02;
  const spin = -138;
  const squeeze = 0.82;
  const a0 = (angleDeg * Math.PI) / 180;
  const a1 = ((angleDeg + spin * 0.38) * Math.PI) / 180;
  const a2 = ((angleDeg + spin * 0.74) * Math.PI) / 180;
  const a3 = ((angleDeg + spin) * Math.PI) / 180;
  const p0 = { x: cx + Math.cos(a0) * outer, y: cy + Math.sin(a0) * outer * squeeze };
  const p1 = { x: cx + Math.cos(a1) * outer * 0.62, y: cy + Math.sin(a1) * outer * 0.62 * squeeze };
  const p2 = { x: cx + Math.cos(a2) * outer * 0.34, y: cy + Math.sin(a2) * outer * 0.34 * squeeze };
  const p3 = { x: cx, y: cy };

  return {
    x: cubic(p0.x, p1.x, p2.x, p3.x, t),
    y: cubic(p0.y, p1.y, p2.y, p3.y, t),
  };
};

const armTangent = (angleDeg, t, width, height) => {
  const before = armPoint(angleDeg, Math.max(0, t - 0.006), width, height);
  const after = armPoint(angleDeg, Math.min(0.998, t + 0.006), width, height);
  return Math.atan2(after.y - before.y, after.x - before.x);
};

const resizeCanvas = () => {
  const nextScale = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = window.innerWidth;
  const nextHeight = window.innerHeight;

  if (nextScale === deviceScale && nextWidth === viewportWidth && nextHeight === viewportHeight) return;

  deviceScale = nextScale;
  viewportWidth = nextWidth;
  viewportHeight = nextHeight;
  canvas.width = Math.ceil(viewportWidth * deviceScale);
  canvas.height = Math.ceil(viewportHeight * deviceScale);
  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
};

const createSlots = () => {
  arms.forEach((angle) => {
    for (let index = 0; index < 7; index += 1) {
      wordSlots.push({
        angle,
        phase: index / 7,
      });
    }
  });
};

createSlots();

const setBeat = (value) => {
  root.style.setProperty("--beat", value.toFixed(3));
};

const drawLetter = (letter, angle, t, fontSize, scale) => {
  if (t < 0 || t > 0.995) return;

  const point = armPoint(angle, t, viewportWidth, viewportHeight);
  const tangent = armTangent(angle, t, viewportWidth, viewportHeight);

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(tangent);
  ctx.scale(scale, scale);
  ctx.fillText(letter, 0, 0);
  ctx.restore();
};

const drawWord = (slot) => {
  const t = (slot.phase + motion) % 1;
  const baseSize = Math.min(viewportWidth, viewportHeight) * 0.072;
  const fontSize = Math.max(25, Math.min(58, baseSize));
  const next = armPoint(slot.angle, Math.min(0.995, t + 0.008), viewportWidth, viewportHeight);
  const point = armPoint(slot.angle, t, viewportWidth, viewportHeight);
  const speed = Math.max(180, Math.hypot(next.x - point.x, next.y - point.y) / 0.008);
  const letters = "танцуй";
  const wordScale = 1.92 - t * 1.66;

  ctx.font = `950 ${fontSize}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0d0d0d";

  const glyphs = letters.split("").map((letter) => ({
    letter,
    width: ctx.measureText(letter).width * wordScale,
  }));
  const gap = fontSize * wordScale * 0.025;
  const totalWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + gap * (glyphs.length - 1);
  let cursor = -totalWidth / 2;

  glyphs.forEach((glyph) => {
    const distance = cursor + glyph.width / 2;
    const letterT = t + distance / speed;
    drawLetter(glyph.letter, slot.angle, letterT, fontSize, wordScale);
    cursor += glyph.width + gap;
  });
};

const flow = (now) => {
  const delta = Math.min(48, now - lastMotion) / 1000;
  lastMotion = now;
  motion = (motion + delta * 0.052) % 1;

  resizeCanvas();
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  wordSlots
    .map((slot) => ({ slot, t: (slot.phase + motion) % 1 }))
    .sort((a, b) => a.t - b.t)
    .forEach(({ slot }) => drawWord(slot));

  requestAnimationFrame(flow);
};

const playKick = (time) => {
  const osc = context.createOscillator();
  const gain = context.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(126, time);
  osc.frequency.exponentialRampToValueAtTime(46, time + 0.16);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.82, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

  osc.connect(gain).connect(gainNode);
  osc.start(time);
  osc.stop(time + 0.22);
  lastPulse = performance.now();
};

const playTick = (time) => {
  const osc = context.createOscillator();
  const gain = context.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(196, time);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.14, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);

  osc.connect(gain).connect(gainNode);
  osc.start(time);
  osc.stop(time + 0.15);
};

const schedule = () => {
  let stepIndex = 0;
  const step = 60 / 122 / 2;

  timer = window.setInterval(() => {
    const time = context.currentTime + 0.025;
    if (stepIndex % 4 === 0) playKick(time);
    if (stepIndex % 4 === 2) playTick(time);
    stepIndex += 1;
  }, step * 1000);
};

const animate = () => {
  analyser.getByteFrequencyData(data);

  let bass = 0;
  for (let index = 0; index < 12; index += 1) bass += data[index];

  const bassEnergy = bass / (12 * 255);
  const pulse = Math.max(0, 1 - (performance.now() - lastPulse) / 240);
  setBeat(Math.min(1, bassEnergy * 1.5 + pulse * 0.5));

  frame = requestAnimationFrame(animate);
};

const start = async () => {
  if (!context) {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) {
      audioToggle.hidden = true;
      return;
    }

    context = new AudioEngine();
    analyser = context.createAnalyser();
    analyser.fftSize = 128;
    data = new Uint8Array(analyser.frequencyBinCount);
    gainNode = context.createGain();
    gainNode.gain.value = 0.38;
    gainNode.connect(analyser).connect(context.destination);
  }

  await context.resume();
  playing = true;
  audioToggle.setAttribute("aria-pressed", "true");
  audioToggle.setAttribute("aria-label", "Выключить звук");
  schedule();
  animate();
};

const stop = () => {
  playing = false;
  window.clearInterval(timer);
  cancelAnimationFrame(frame);
  setBeat(0);
  if (context) context.suspend();
  audioToggle.setAttribute("aria-pressed", "false");
  audioToggle.setAttribute("aria-label", "Включить звук");
};

audioToggle.addEventListener("click", () => {
  if (playing) {
    stop();
    return;
  }

  start();
});

requestAnimationFrame(flow);
