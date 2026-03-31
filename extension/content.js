(function () {
  const DEFAULT_BUDGET = 16000;
  const MAX_CONCURRENT = 8;
  const HOST_SELECTOR = [
    "a#thumbnail",
    "ytd-thumbnail",
    "yt-image"
  ].join(", ");
  const IMAGE_SELECTOR = [
    "img.yt-core-image",
    "a#thumbnail img.yt-core-image",
    "a#thumbnail img",
    "ytd-thumbnail img.yt-core-image",
    "ytd-thumbnail img",
    "yt-image img",
    "img[src*='ytimg.com']"
  ].join(",");
  const TICK_MS = 2000;
  const PROXIMITY_IMPORTANCE = 1.1;
  const QUALITY_SPEED = 0.55;
  const ANIMATION_DURATION_MS = 2800;
  const PREP_PASSES = 2;
  const PREP_SWAP_FRACTION = 0.12;
  const TAU = Math.PI * 2;
  const WAVE_SOURCES = [
    { x: 0.08, y: 0.2, phase: 0.0, weight: 1.0 },
    { x: 0.82, y: 0.3, phase: 1.7, weight: 0.85 },
    { x: 0.28, y: 0.84, phase: 3.1, weight: 0.95 },
    { x: 0.92, y: 0.76, phase: 4.6, weight: 0.75 }
  ];
  const WAVE_SWEEP = 0.34;
  const WAVE_AMPLITUDE = 0.12;
  const WAVE_CYCLES = 2.35;
  const WAVE_DETAIL = 11.5;
  const WAVE_DRIFT = 0.045;

  const VERTEX_SHADER = `
    attribute vec2 aPosition;
    attribute vec4 aColor;
    uniform vec2 uResolution;
    uniform float uPointSize;
    varying vec4 vColor;
    void main() {
      vec2 uv = (aPosition + vec2(0.5)) / uResolution;
      vec2 clip = uv * 2.0 - 1.0;
      clip.y *= -1.0;
      gl_Position = vec4(clip, 0.0, 1.0);
      gl_PointSize = uPointSize;
      vColor = aColor;
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec4 vColor;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float dist = dot(p, p);
      if (dist > 1.0) discard;
      float alpha = vColor.a * smoothstep(1.0, 0.0, dist);
      gl_FragColor = vec4(vColor.rgb, alpha);
    }
  `;

  const completedHosts = new WeakSet();
  const failedHosts = new WeakSet();
  const sourceCache = new Map();
  const targetDataCache = new Map();
  let targetDataUrl = "";
  let targetImagePromise = null;
  let particleBudget = DEFAULT_BUDGET;
  let statusEl = null;
  let tickScheduled = false;
  let activeCount = 0;
  const activeHosts = new WeakSet();

  installStatus();
  setStatus("starting");

  Promise.all([
    chrome.storage.sync.get({ particleBudget: DEFAULT_BUDGET }),
    chrome.storage.local.get({ targetImageDataUrl: "" })
  ]).then(([syncResult, localResult]) => {
    particleBudget = normalizeBudget(syncResult.particleBudget);
    targetDataUrl = localResult.targetImageDataUrl || "";
    targetImagePromise = null;
    targetDataCache.clear();
    setStatus(targetDataUrl ? "ready" : "no target image");
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.particleBudget) {
      particleBudget = normalizeBudget(changes.particleBudget.newValue);
    }
    if (areaName === "local" && changes.targetImageDataUrl) {
      targetDataUrl = changes.targetImageDataUrl.newValue || "";
      targetImagePromise = null;
      targetDataCache.clear();
      setStatus(targetDataUrl ? "ready" : "no target image");
    }
  });

  function normalizeBudget(value) {
    return Math.max(1000, Math.min(DEFAULT_BUDGET, Number(value) || DEFAULT_BUDGET));
  }

  function installStatus() {
    if (statusEl) return;
    statusEl = document.createElement("div");
    statusEl.style.position = "fixed";
    statusEl.style.right = "12px";
    statusEl.style.bottom = "12px";
    statusEl.style.zIndex = "999999";
    statusEl.style.padding = "8px 10px";
    statusEl.style.background = "rgba(17,17,17,0.88)";
    statusEl.style.color = "#fff";
    statusEl.style.font = "12px Arial, sans-serif";
    statusEl.style.border = "1px solid rgba(255,255,255,0.18)";
    statusEl.style.borderRadius = "8px";
    statusEl.style.pointerEvents = "none";
    document.documentElement.appendChild(statusEl);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = `thumbnail animator: ${text}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pixelLuma(pixels, index) {
    return (pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114) / 255;
  }

  function loadImage(src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });
  }

  async function loadTargetImage() {
    if (!targetDataUrl) throw new Error("no target image");
    if (!targetImagePromise) {
      targetImagePromise = loadImage(targetDataUrl);
    }
    return targetImagePromise;
  }

  async function loadSourceImage(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) throw new Error("missing thumbnail src");
    if (!sourceCache.has(src)) {
      sourceCache.set(src, loadImage(src, "anonymous"));
    }
    return sourceCache.get(src);
  }

  function getThumbnailImage(host) {
    const candidates = [...host.querySelectorAll(IMAGE_SELECTOR), ...host.querySelectorAll("img")]
      .filter((img, index, arr) => img instanceof HTMLImageElement && arr.indexOf(img) === index)
      .filter((img) => img.complete && img.naturalWidth && img.naturalHeight);

    const hostRect = host.getBoundingClientRect();
    const hostAspect = hostRect.width > 1 && hostRect.height > 1 ? hostRect.width / hostRect.height : 1;
    let best = null;
    let bestScore = -Infinity;
    for (const img of candidates) {
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width < 8 || rect.height < 8) continue;
      const imgAspect = rect.width / rect.height;
      const aspectPenalty = Math.abs(Math.log(imgAspect / hostAspect));
      const coverage = Math.min(1, area / Math.max(1, hostRect.width * hostRect.height));
      const score = area * (1.2 + coverage) - aspectPenalty * area * 1.5;
      if (score > bestScore) {
        best = img;
        bestScore = score;
      }
    }

    return best;
  }

  function getDisplayedAspect(imgEl) {
    const rect = imgEl.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      return rect.width / rect.height;
    }
    return (imgEl.naturalWidth || 1) / Math.max(1, imgEl.naturalHeight || 1);
  }

  function isUsableHost(host) {
    if (!host || !host.isConnected) return false;
    const rect = host.getBoundingClientRect();
    return rect.width > 40 && rect.height > 20;
  }

  function getHostFromImage(img) {
    return img.closest("a#thumbnail") || img.closest("ytd-thumbnail") || img.closest("yt-image") || img.parentElement;
  }

  function getAllCandidateImages() {
    return [...document.querySelectorAll(IMAGE_SELECTOR)]
      .filter((img) => img instanceof HTMLImageElement);
  }

  function getHostKey(host) {
    const img = getThumbnailImage(host);
    if (!img) return "";
    return img.currentSrc || img.src || "";
  }

  function getNextHosts(limit) {
    const hosts = [];
    const images = getAllCandidateImages();
    for (const img of images) {
      const host = getHostFromImage(img);
      if (!host) continue;
      if (!isUsableHost(host)) continue;
      if (completedHosts.has(host) || failedHosts.has(host) || activeHosts.has(host)) continue;
      const key = getHostKey(host);
      if (!key) continue;
      hosts.push(host);
      if (hosts.length >= limit) break;
    }
    return hosts;
  }

  function scheduleTick(delay = 0) {
    if (tickScheduled) return;
    tickScheduled = true;
    setTimeout(() => {
      tickScheduled = false;
      tick();
    }, delay);
  }

  function computeGridSize(budget, aspect) {
    const safeAspect = Math.max(0.2, Math.min(5, aspect || 1));
    let height = Math.max(24, Math.round(Math.sqrt(budget / safeAspect)));
    let width = Math.max(24, Math.round(height * safeAspect));
    const scale = Math.sqrt(budget / Math.max(1, width * height));
    width = Math.max(24, Math.round(width * scale));
    height = Math.max(24, Math.round(height * scale));
    return { width, height };
  }

  function sampleRectImageCover(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = Math.max(1, Math.round(image.width * scale));
    const drawHeight = Math.max(1, Math.round(image.height * scale));
    const dx = Math.floor((width - drawWidth) / 2);
    const dy = Math.floor((height - drawHeight) / 2);
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
    return { canvas, pixels: ctx.getImageData(0, 0, width, height).data };
  }

  function sampleRectImageContain(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);

    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = Math.max(1, Math.round(image.width * scale));
    const drawHeight = Math.max(1, Math.round(image.height * scale));
    const dx = Math.floor((width - drawWidth) / 2);
    const dy = Math.floor((height - drawHeight) / 2);
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);

    return {
      canvas,
      pixels: ctx.getImageData(0, 0, width, height).data,
      aspect: image.width / Math.max(1, image.height)
    };
  }

  function computeEdgeMap(pixels, width, height) {
    const edge = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const idx = i * 4;
        const l = pixelLuma(pixels, idx);
        const lx = pixelLuma(pixels, idx + 4) - pixelLuma(pixels, idx - 4);
        const ly = pixelLuma(pixels, idx + width * 4) - pixelLuma(pixels, idx - width * 4);
        edge[i] = Math.abs(lx) + Math.abs(ly) + (1 - l) * 0.35;
      }
    }
    return edge;
  }

  function buildTargetPoints(targetPixels, width, height, count) {
    const occupied = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = targetPixels[idx + 3] / 255;
        if (alpha < 0.04) continue;
        const nx = x / Math.max(1, width - 1);
        const ny = y / Math.max(1, height - 1);
        const centerBias = Math.hypot(nx - 0.5, ny - 0.5);
        occupied.push({
          x,
          y,
          brightness: pixelLuma(targetPixels, idx),
          nx,
          ny,
          revealAt: clamp(centerBias * 0.42, 0, 0.42)
        });
      }
    }

    if (!occupied.length) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const nx = x / Math.max(1, width - 1);
          const ny = y / Math.max(1, height - 1);
          const centerBias = Math.hypot(nx - 0.5, ny - 0.5);
          occupied.push({
            x,
            y,
            brightness: pixelLuma(targetPixels, idx),
            nx,
            ny,
            revealAt: clamp(centerBias * 0.42, 0, 0.42)
          });
        }
      }
    }

    occupied.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const chosen = [];
    if (occupied.length >= count) {
      const step = occupied.length / count;
      for (let i = 0; i < count; i++) {
        chosen.push(occupied[Math.min(occupied.length - 1, Math.floor(i * step))]);
      }
      return chosen;
    }

    for (const point of occupied) chosen.push({ ...point });
    let duplicateIndex = 0;
    while (chosen.length < count) {
      const base = occupied[duplicateIndex % occupied.length];
      chosen.push({ ...base });
      duplicateIndex++;
    }
    return chosen;
  }

  function buildParticles(sourcePixels, width, height) {
    const count = width * height;
    const particles = new Array(count);
    const positions = new Float32Array(count * 2);
    const colors = new Float32Array(count * 4);
    let p = 0;
    let c = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const id = y * width + x;
        const idx = id * 4;
        const r = sourcePixels[idx] / 255;
        const g = sourcePixels[idx + 1] / 255;
        const b = sourcePixels[idx + 2] / 255;
        const a = sourcePixels[idx + 3] / 255;
        particles[id] = {
          id,
          sourceX: x,
          sourceY: y,
          sourceNX: x / Math.max(1, width - 1),
          sourceNY: y / Math.max(1, height - 1),
          currentX: x,
          currentY: y,
          targetX: x,
          targetY: y,
          revealAt: 0,
          brightness: r * 0.299 + g * 0.587 + b * 0.114,
          wavePhase: ((x * 12.9898 + y * 78.233) % TAU + TAU) % TAU,
          waveJitter: ((Math.sin(x * 19.123 + y * 3.371) * 43758.5453) % 1 + 1) % 1
        };
        positions[p++] = x;
        positions[p++] = y;
        colors[c++] = r;
        colors[c++] = g;
        colors[c++] = b;
        colors[c++] = a;
      }
    }
    return { particles, positions, colors };
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeInitialAssignments(particles, targetPoints, seed) {
    const rng = mulberry32(seed);
    const sourceOrder = particles.map((particle) => particle.id);
    const targetOrder = targetPoints.map((_, index) => index);
    const rankParticle = (particle) =>
      particle.brightness * 4.2 + particle.sourceNY * 0.85 + particle.sourceNX * 0.25;
    const rankTarget = (targetPoint) =>
      targetPoint.brightness * 4.2 + targetPoint.ny * 0.85 + targetPoint.nx * 0.25;
    sourceOrder.sort((a, b) => {
      return rankParticle(particles[a]) - rankParticle(particles[b]) || (rng() - 0.5);
    });
    targetOrder.sort((a, b) => {
      return rankTarget(targetPoints[a]) - rankTarget(targetPoints[b]) || (rng() - 0.5);
    });
    const assignments = new Int32Array(particles.length);
    for (let i = 0; i < particles.length; i++) {
      assignments[sourceOrder[i]] = targetOrder[i % targetOrder.length];
    }
    return assignments;
  }

  function assignmentScore(particle, targetPoint) {
    const dx = particle.sourceNX - targetPoint.nx;
    const dy = particle.sourceNY - targetPoint.ny;
    const spatial = dx * dx + dy * dy;
    const brightness = particle.brightness - targetPoint.brightness;
    return brightness * brightness * 24 + spatial * PROXIMITY_IMPORTANCE * 180;
  }

  function setParticleDestination(particle, target) {
    particle.targetX = target.x;
    particle.targetY = target.y;
    particle.revealAt = target.revealAt;
  }

  function applyAssignments(particles, targetPoints, assignments) {
    for (let i = 0; i < particles.length; i++) {
      const target = targetPoints[assignments[i]];
      setParticleDestination(particles[i], target);
    }
  }

  function improveAssignments(particles, targetPoints, assignments, budget, seed) {
    const rng = mulberry32(seed);
    const total = particles.length;
    let accepted = 0;
    for (let step = 0; step < budget; step++) {
      const a = (rng() * total) | 0;
      let b = (rng() * total) | 0;
      if (a === b) b = (b + 1) % total;
      const particleA = particles[a];
      const particleB = particles[b];
      const assignA = assignments[a];
      const assignB = assignments[b];
      const targetA = targetPoints[assignA];
      const targetB = targetPoints[assignB];
      const before = assignmentScore(particleA, targetA) + assignmentScore(particleB, targetB);
      const after = assignmentScore(particleA, targetB) + assignmentScore(particleB, targetA);
      if (after < before) {
        assignments[a] = assignB;
        assignments[b] = assignA;
        setParticleDestination(particleA, targetB);
        setParticleDestination(particleB, targetA);
        accepted++;
      }
    }
    return accepted;
  }

  function stepParticles(particles, progress, gridWidth, gridHeight) {
    let movingCount = 0;
    const amplitudeBase = Math.max(6, Math.min(gridWidth, gridHeight) * WAVE_AMPLITUDE);
    for (const particle of particles) {
      let nearestWaveDelay = 1;
      let waveMix = 0;
      let waveWeight = 0;
      for (const source of WAVE_SOURCES) {
        const dxSource = particle.sourceNX - source.x;
        const dySource = particle.sourceNY - source.y;
        const distance = Math.hypot(dxSource, dySource);
        nearestWaveDelay = Math.min(nearestWaveDelay, distance * WAVE_SWEEP);
        const falloff = Math.max(0, 1 - distance * 1.35);
        const phase =
          progress * TAU * WAVE_CYCLES -
          distance * WAVE_DETAIL +
          source.phase +
          particle.wavePhase * 0.75;
        waveMix += Math.sin(phase) * falloff * source.weight;
        waveWeight += falloff * source.weight;
      }

      const waveInfluence = waveWeight > 0 ? waveMix / waveWeight : 0;
      const revealStart = clamp(
        particle.revealAt * 0.42 + nearestWaveDelay * 0.9 + particle.waveJitter * 0.045,
        0,
        0.9
      );
      const reveal = clamp((progress - revealStart) / Math.max(0.001, 1 - revealStart), 0, 1);
      const easedReveal = reveal * reveal * (3 - 2 * reveal);
      const baseX = particle.sourceX + (particle.targetX - particle.sourceX) * easedReveal;
      const baseY = particle.sourceY + (particle.targetY - particle.sourceY) * easedReveal;
      const travelX = particle.targetX - particle.sourceX;
      const travelY = particle.targetY - particle.sourceY;
      const travelLength = Math.hypot(travelX, travelY) || 1;
      const alongX = travelX / travelLength;
      const alongY = travelY / travelLength;
      const perpX = -alongY;
      const perpY = alongX;
      const envelope = Math.sin(reveal * Math.PI);
      const secondary =
        Math.sin(progress * TAU * (WAVE_CYCLES * 0.55) + particle.sourceNX * 4.3 - particle.sourceNY * 6.1) *
        0.45;
      const sidewaysOffset =
        amplitudeBase *
        envelope *
        (waveInfluence * 0.78 + secondary * 0.22) *
        (0.65 + 0.35 * (1 - easedReveal));
      const alongOffset =
        amplitudeBase *
        WAVE_DRIFT *
        envelope *
        Math.sin(progress * TAU * 1.35 + particle.wavePhase * 1.2 + particle.sourceNY * 5.2);
      particle.currentX = baseX + perpX * sidewaysOffset + alongX * alongOffset;
      particle.currentY = baseY + perpY * sidewaysOffset + alongY * alongOffset;
      if (reveal < 1) {
        movingCount++;
      }
    }
    return movingCount;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
    }
    return shader;
  }

  function createProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "program link failed");
    }
    return program;
  }

  function initGl(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("webgl not supported");
    const program = createProgram(gl);
    const positionBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return {
      gl,
      program,
      positionBuffer,
      colorBuffer,
      colorCapacity: 0,
      positionCapacity: 0,
      aPosition: gl.getAttribLocation(program, "aPosition"),
      aColor: gl.getAttribLocation(program, "aColor"),
      uResolution: gl.getUniformLocation(program, "uResolution"),
      uPointSize: gl.getUniformLocation(program, "uPointSize")
    };
  }

  function createOverlay(host, imgEl) {
    const existing = host.querySelector(":scope > .thumbnail-animator-overlay");
    if (existing) existing.remove();
    const canvas = document.createElement("canvas");
    canvas.className = "thumbnail-animator-overlay";
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "40";
    canvas.style.background = "#000";
    const style = window.getComputedStyle(host);
    if (style.position === "static") host.style.position = "relative";
    host.style.overflow = "hidden";

    const hostRect = host.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();
    const left = Math.max(0, imgRect.left - hostRect.left);
    const top = Math.max(0, imgRect.top - hostRect.top);
    const width = Math.max(1, imgRect.width);
    const height = Math.max(1, imgRect.height);

    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    host.appendChild(canvas);
    return canvas;
  }

  function freezeOverlay(host, canvas) {
    const snapshot = document.createElement("img");
    snapshot.className = "thumbnail-animator-overlay";
    snapshot.style.position = "absolute";
    snapshot.style.pointerEvents = "none";
    snapshot.style.zIndex = "40";
    snapshot.style.background = "#000";
    snapshot.style.left = canvas.style.left;
    snapshot.style.top = canvas.style.top;
    snapshot.style.width = canvas.style.width;
    snapshot.style.height = canvas.style.height;
    snapshot.src = canvas.toDataURL("image/png");
    host.appendChild(snapshot);
    canvas.remove();
    return snapshot;
  }

  function disposeGl(glApi) {
    if (!glApi) return;
    const { gl, program, positionBuffer, colorBuffer } = glApi;
    try {
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (colorBuffer) gl.deleteBuffer(colorBuffer);
      if (program) gl.deleteProgram(program);
      const loseContext = gl.getExtension("WEBGL_lose_context");
      if (loseContext) loseContext.loseContext();
    } catch (error) {
      console.warn("[thumbnail-animator] failed to dispose webgl context", error);
    }
  }

  function uploadStaticColors(glApi, colors) {
    const { gl, colorBuffer, aColor } = glApi;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    if (glApi.colorCapacity < colors.byteLength) {
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
      glApi.colorCapacity = colors.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
    }
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  }

  function renderGl(glApi, positions, count, gridWidth, gridHeight, particleSize) {
    const { gl, positionBuffer, aPosition, uResolution, uPointSize } = glApi;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.floor(gl.canvas.clientWidth * dpr);
    const height = Math.floor(gl.canvas.clientHeight * dpr);
    if (gl.canvas.width !== width || gl.canvas.height !== height) {
      gl.canvas.width = width;
      gl.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    if (glApi.positionCapacity < positions.byteLength) {
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STREAM_DRAW);
      glApi.positionCapacity = positions.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    }
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uResolution, gridWidth, gridHeight);
    gl.uniform1f(uPointSize, particleSize * dpr);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  async function getTargetData(gridWidth, gridHeight) {
    const cacheKey = `${gridWidth}x${gridHeight}`;
    if (targetDataCache.has(cacheKey)) return targetDataCache.get(cacheKey);
    const image = await loadTargetImage();
    const sampled = sampleRectImageContain(image, gridWidth, gridHeight);
    const points = buildTargetPoints(sampled.pixels, gridWidth, gridHeight, gridWidth * gridHeight);
    const data = { image, points, aspect: sampled.aspect };
    targetDataCache.set(cacheKey, data);
    return data;
  }

  async function processHost(host) {
    const imgEl = getThumbnailImage(host);
    if (!host || !imgEl) return;
    const previousOpacity = imgEl.style.opacity;
    const existing = host.querySelector(":scope > .thumbnail-animator-overlay");
    if (existing) existing.remove();
    imgEl.style.opacity = "0";

    setStatus("working");
    const sourceImage = await loadSourceImage(imgEl);
    const sourceAspect = getDisplayedAspect(imgEl);
    const { width: gridWidth, height: gridHeight } = computeGridSize(particleBudget, sourceAspect);
    const targetDataResolved = await getTargetData(gridWidth, gridHeight);

    const sampledSource = sampleRectImageCover(sourceImage, gridWidth, gridHeight);
    const { particles, positions, colors } = buildParticles(sampledSource.pixels, gridWidth, gridHeight);
    const assignments = makeInitialAssignments(particles, targetDataResolved.points, 1);
    applyAssignments(particles, targetDataResolved.points, assignments);
    const prepBudget = Math.max(64, Math.floor(particles.length * PREP_SWAP_FRACTION * QUALITY_SPEED));
    for (let pass = 0; pass < PREP_PASSES; pass++) {
      improveAssignments(particles, targetDataResolved.points, assignments, prepBudget, gridWidth * 101 + gridHeight + pass);
    }

    const overlay = createOverlay(host, imgEl);
    const glApi = initGl(overlay);
    uploadStaticColors(glApi, colors);

    await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let movingCount = particles.length;
      let rafId = 0;
      let settled = false;
      const timeoutId = setTimeout(() => finish(), ANIMATION_DURATION_MS + 500);

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cancelAnimationFrame(rafId);
        freezeOverlay(host, overlay);
        disposeGl(glApi);
        completedHosts.add(host);
        resolve();
      }

      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cancelAnimationFrame(rafId);
        overlay.remove();
        disposeGl(glApi);
        reject(error);
      }

      function frame(now) {
        try {
          const progress = clamp((now - startedAt) / ANIMATION_DURATION_MS, 0, 1);
          movingCount = stepParticles(particles, progress, gridWidth, gridHeight);

          let p = 0;
          for (const particle of particles) {
            positions[p++] = particle.currentX;
            positions[p++] = particle.currentY;
          }
          renderGl(glApi, positions, particles.length, gridWidth, gridHeight, 4.2);

          if (progress >= 1 || now - startedAt > ANIMATION_DURATION_MS + 400) {
            finish();
            return;
          }

          if (movingCount > 0) {
            rafId = requestAnimationFrame(frame);
            return;
          }

          finish();
        } catch (error) {
          fail(error);
        }
      }

      rafId = requestAnimationFrame(frame);
    });

    imgEl.style.opacity = previousOpacity || "0";
  }

  async function tick() {
    if (!targetDataUrl) {
      setStatus("no target image");
      return;
    }

    const available = MAX_CONCURRENT - activeCount;
    if (available <= 0) {
      setStatus(`working ${activeCount}/${MAX_CONCURRENT}`);
      return;
    }

    const hosts = getNextHosts(available);
    if (!hosts.length) {
      const candidates = [...document.querySelectorAll(HOST_SELECTOR)].filter((el) => isUsableHost(el)).length;
      setStatus(activeCount ? `working ${activeCount}/${MAX_CONCURRENT}` : `idle (${candidates} candidates)`);
      return;
    }

    for (const host of hosts) {
      activeHosts.add(host);
      activeCount++;
      setStatus(`working ${activeCount}/${MAX_CONCURRENT}`);
      processHost(host)
        .catch((error) => {
          failedHosts.add(host);
          const imgEl = getThumbnailImage(host);
          if (imgEl) imgEl.style.opacity = "";
          console.warn("[thumbnail-animator]", error);
        })
        .finally(() => {
          activeHosts.delete(host);
          activeCount = Math.max(0, activeCount - 1);
          setStatus(activeCount ? `working ${activeCount}/${MAX_CONCURRENT}` : "done");
          scheduleTick(120);
        });
    }
  }

  setInterval(tick, TICK_MS);
  window.addEventListener("scroll", () => scheduleTick(60), { passive: true });
  window.addEventListener("load", () => scheduleTick(0));
  document.addEventListener("yt-navigate-finish", () => scheduleTick(0));
  const observer = new MutationObserver(() => scheduleTick(120));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleTick(0);
})();
