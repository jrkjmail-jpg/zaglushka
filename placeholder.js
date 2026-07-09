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
let audio;
let source;
let frame;
let playing = false;
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

const getScale = (t) => 7 - t * 6.84;
const phrase = "танцуй ";

const getFontSize = () => {
  const baseSize = Math.min(viewportWidth, viewportHeight) * 0.066;
  return Math.max(24, Math.min(54, baseSize));
};

const getGlyphWidth = (letter, angle, distance, fontSize) => {
  const point = pathPointAt(angle, Math.max(0, distance));
  const scale = getScale(point ? point.t : 0);

  if (letter === " ") return fontSize * 0.1 * scale;

  const metrics = ctx.measureText(letter);
  const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const width = Math.max(inkWidth || 0, metrics.width * 0.72);
  return width * scale;
};

const getLetterGap = (fontSize) => Math.max(1.2, fontSize * 0.018);

const getPairDistance = (previousLetter, currentLetter, angle, previousDistance, currentDistance, fontSize) => (
  getGlyphWidth(previousLetter, angle, previousDistance, fontSize) / 2
  + getGlyphWidth(currentLetter, angle, currentDistance, fontSize) / 2
  + getLetterGap(fontSize)
);

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
  let distance = -fontSize * 5 - offset * fontSize * 20;
  const endDistance = path.length + fontSize * 4;

  while (distance < endDistance) {
    const letter = phrase[index % phrase.length];

    glyphs.push({
      letter,
      index: index % phrase.length,
      distance,
    });

    const nextLetter = phrase[(index + 1) % phrase.length];
    distance += getPairDistance(letter, nextLetter, angle, distance, distance + fontSize, fontSize);
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
    const distance = first
      ? first.distance - getPairDistance(letter, first.letter, angle, first.distance - fontSize, first.distance, fontSize)
      : -fontSize;

    glyphs.unshift({ letter, index, distance });
  }
};

const alignGlyphs = (angle, glyphs, fontSize) => {
  for (let index = 1; index < glyphs.length; index += 1) {
    const previous = glyphs[index - 1];
    const current = glyphs[index];
    current.distance = previous.distance
      + getPairDistance(previous.letter, current.letter, angle, previous.distance, current.distance, fontSize);
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
  alignGlyphs(angle, glyphs, fontSize);

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

const animate = () => {
  analyser.getByteFrequencyData(data);

  let bass = 0;
  for (let index = 0; index < 18; index += 1) bass += data[index];

  const bassEnergy = bass / (18 * 255);
  setBeat(Math.min(1, bassEnergy * 2.2));

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
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    data = new Uint8Array(analyser.frequencyBinCount);

    audio = new Audio("assets/music.mp3");
    audio.loop = true;
    audio.preload = "auto";

    source = context.createMediaElementSource(audio);
    source.connect(analyser).connect(context.destination);
  }

  await context.resume();
  await audio.play();
  playing = true;
  audioToggle.setAttribute("aria-pressed", "true");
  audioToggle.setAttribute("aria-label", "Выключить звук");
  animate();
};

const stop = () => {
  playing = false;
  cancelAnimationFrame(frame);
  setBeat(0);
  if (audio) audio.pause();
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
