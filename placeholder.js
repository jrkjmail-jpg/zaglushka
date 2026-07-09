const root = document.documentElement;
const audioToggle = document.querySelector(".audio-toggle");
const canvas = document.querySelector(".word-field");
const ctx = canvas.getContext("2d", { alpha: true });
const arms = [61, 133, 205, 277, 349];
const streamOffsets = [0, 0.18, 0.36, 0.54, 0.72];
const pathCache = new Map();
const streamState = new Map();

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
let cacheKey = "";

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

const getDotMaskRadius = () => {
  const minSide = Math.min(viewportWidth, viewportHeight);
  const dotSize = Math.max(108, Math.min(164, minSide * 0.14));
  const ring = 13 + 8;
  return dotSize / 2 + ring + 6;
};

const buildPath = (angle) => {
  const samples = [];
  const steps = 760;
  let length = 0;
  let previous = armPoint(angle, 0, viewportWidth, viewportHeight);

  samples.push({ ...previous, t: 0, length: 0 });

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const point = armPoint(angle, t, viewportWidth, viewportHeight);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    samples.push({ ...point, t, length });
    previous = point;
  }

  return { samples, length };
};

const resetPaths = () => {
  pathCache.clear();
  arms.forEach((angle) => pathCache.set(angle, buildPath(angle)));
  streamState.clear();
};

const pathPointAt = (angle, distance) => {
  const path = pathCache.get(angle);
  if (!path || distance < 0 || distance > path.length) return null;

  let low = 0;
  let high = path.samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (path.samples[mid].length < distance) low = mid + 1;
    else high = mid;
  }

  const next = path.samples[low];
  const previous = path.samples[Math.max(0, low - 1)];
  const span = Math.max(1, next.length - previous.length);
  const mix = (distance - previous.length) / span;
  const x = previous.x + (next.x - previous.x) * mix;
  const y = previous.y + (next.y - previous.y) * mix;

  return {
    x,
    y,
    t: previous.t + (next.t - previous.t) * mix,
  };
};

const pathTangentAt = (angle, distance) => {
  const before = pathPointAt(angle, distance - 7);
  const after = pathPointAt(angle, distance + 7);
  if (!before || !after) return 0;
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

  const nextKey = `${viewportWidth}x${viewportHeight}`;
  if (nextKey !== cacheKey) {
    cacheKey = nextKey;
    resetPaths();
  }
};

const setBeat = (value) => {
  root.style.setProperty("--beat", value.toFixed(3));
};

const getScale = (t) => 1.62 - t * 1.34;
const phrase = "танцуй ";

const getFontSize = () => {
  const baseSize = Math.min(viewportWidth, viewportHeight) * 0.066;
  return Math.max(24, Math.min(54, baseSize));
};

const getAdvance = (letter, angle, distance, fontSize) => {
  const point = pathPointAt(angle, Math.max(0, distance));
  const scale = getScale(point ? point.t : 0);
  const width = letter === " " ? fontSize * 0.055 : ctx.measureText(letter).width * 0.8;
  return width * scale;
};

const drawLetter = (letter, angle, distance, fontSize) => {
  const point = pathPointAt(angle, distance);
  if (!point || point.t > 0.99) return;

  const tangent = pathTangentAt(angle, distance);
  const scale = getScale(point.t);

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(tangent);
  ctx.scale(scale, scale);
  ctx.fillText(letter, 0, 0);
  ctx.restore();
};

const createStream = (angle, offset, fontSize) => {
  const path = pathCache.get(angle);
  if (!path) return [];

  const glyphs = [];
  let index = 0;
  let cursor = -fontSize * 5 - offset * fontSize * 20;
  const endDistance = path.length + fontSize * 4;

  while (cursor < endDistance) {
    const letter = phrase[index % phrase.length];
    const advance = getAdvance(letter, angle, cursor, fontSize);

    glyphs.push({
      letter,
      index: index % phrase.length,
      distance: cursor + advance / 2,
    });

    cursor += advance;
    index += 1;
  }

  return glyphs;
};

const prependGlyphs = (angle, glyphs, fontSize) => {
  while (!glyphs.length || glyphs[0].distance > -fontSize * 3) {
    const first = glyphs[0];
    const nextIndex = first ? first.index : 0;
    const index = (nextIndex - 1 + phrase.length) % phrase.length;
    const letter = phrase[index];
    const nextAdvance = first ? getAdvance(first.letter, angle, first.distance, fontSize) : 0;
    const advance = getAdvance(letter, angle, first ? first.distance : 0, fontSize);
    const distance = first ? first.distance - nextAdvance / 2 - advance / 2 : -advance / 2;

    glyphs.unshift({ letter, index, distance });
  }
};

const compactGlyphs = (angle, glyphs, fontSize) => {
  for (let index = 1; index < glyphs.length; index += 1) {
    const previous = glyphs[index - 1];
    const current = glyphs[index];
    const previousAdvance = getAdvance(previous.letter, angle, previous.distance, fontSize);
    const currentAdvance = getAdvance(current.letter, angle, current.distance, fontSize);
    const targetDistance = previous.distance + previousAdvance / 2 + currentAdvance / 2;

    if (current.distance > targetDistance) {
      current.distance += (targetDistance - current.distance) * 0.38;
    }
  }
};

const drawStream = (angle, offset, delta) => {
  const path = pathCache.get(angle);
  if (!path) return;

  const fontSize = getFontSize();

  ctx.font = `950 ${fontSize}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0d0d0d";

  if (!streamState.has(angle)) streamState.set(angle, createStream(angle, offset, fontSize));

  const glyphs = streamState.get(angle);
  const speed = 58;
  const endDistance = path.length + fontSize * 3;

  glyphs.forEach((glyph) => {
    glyph.distance += delta * speed;
  });

  while (glyphs.length && glyphs[glyphs.length - 1].distance > endDistance) {
    glyphs.pop();
  }

  prependGlyphs(angle, glyphs, fontSize);
  compactGlyphs(angle, glyphs, fontSize);

  for (let index = glyphs.length - 1; index >= 0; index -= 1) {
    const glyph = glyphs[index];
    if (glyph.letter !== " ") drawLetter(glyph.letter, angle, glyph.distance, fontSize);
  }
};

const cutCenterMask = () => {
  const radius = getDotMaskRadius();

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(viewportWidth / 2, viewportHeight / 2, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const flow = (now) => {
  const delta = Math.min(48, now - lastMotion) / 1000;
  lastMotion = now;

  resizeCanvas();
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  arms.forEach((angle, index) => drawStream(angle, streamOffsets[index], delta));
  cutCenterMask();

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
