import {
  EPS,
  G,
  MAX_BODIES,
  PRESETS,
  type Body,
  type CollisionMode,
  type PresetId,
  accelerations,
  createSeed,
  dominantAttractor,
  makeBody,
  presetById,
  substep,
  tickSparks,
  type Spark,
} from "./physics";

export type LabOptions = {
  downloadHref?: string | null;
};

type Drag =
  | {
      kind: "spawn";
      sx: number;
      sy: number;
      x: number;
      y: number;
      pointerId: number;
    }
  | {
      kind: "fling";
      sx: number;
      sy: number;
      pointerId: number;
      bodyId: number;
      vx: number;
      vy: number;
    }
  | {
      kind: "pan";
      sx: number;
      sy: number;
      pointerId: number;
      camX: number;
      camY: number;
    };

declare global {
  interface Window {
    __ky?: {
      bodyCount: () => number;
      mode: () => CollisionMode;
      timeScale: () => number;
    };
  }
}

const STEP = 1 / 90;
const MAX_STEPS = 16;

function cssColor(hue: number, light: number, alpha = 1): string {
  return `hsla(${hue} 72% ${light}% / ${alpha})`;
}

export function createLab(host: HTMLElement, options: LabOptions = {}): { destroy: () => void } {
  host.replaceChildren();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.createElement("canvas");
  canvas.className = "ky-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ctxOrNull = canvas.getContext("2d", { alpha: false });
  if (!ctxOrNull) throw new Error("Canvas is unavailable");
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  const top = document.createElement("header");
  top.className = "ky-top";

  const brand = document.createElement("div");
  brand.className = "ky-brand";
  const kicker = document.createElement("p");
  kicker.className = "ky-kicker";
  kicker.textContent = "n-body sandbox";
  const title = document.createElement("h1");
  title.textContent = "Kepler Yard";
  const hint = document.createElement("p");
  hint.className = "ky-hint";
  hint.textContent = coarse
    ? "Drag the sky to spawn. Drag a body to fling it. Pinch to zoom, two fingers to pan."
    : "Drag the sky to spawn. Drag a body to fling it. Wheel zooms. Right-drag pans.";
  brand.append(kicker, title, hint);

  const readout = document.createElement("p");
  readout.className = "ky-readout";
  const countEl = document.createElement("span");
  const speedEl = document.createElement("span");
  const modeEl = document.createElement("span");
  countEl.innerHTML = `<strong data-count>0</strong> bodies`;
  speedEl.innerHTML = `<strong data-speed>1.00×</strong>`;
  modeEl.innerHTML = `<strong data-mode>merge</strong>`;
  readout.append(countEl, speedEl, modeEl);

  const presets = document.createElement("div");
  presets.className = "ky-presets";
  presets.setAttribute("role", "radiogroup");
  presets.setAttribute("aria-label", "Mass presets");

  const empty = document.createElement("p");
  empty.className = "ky-empty";
  empty.textContent = "The yard is empty. Pick a mass, then drag across the sky.";

  const floatTip = document.createElement("div");
  floatTip.className = "ky-float";
  floatTip.hidden = true;

  const dock = document.createElement("div");
  dock.className = "ky-dock";

  const pauseBtn = button("Pause");
  pauseBtn.setAttribute("aria-pressed", "false");
  const timeWrap = document.createElement("label");
  timeWrap.className = "ky-time";
  timeWrap.append(document.createTextNode("Time"));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "3";
  slider.step = "0.05";
  slider.value = "1";
  slider.setAttribute("aria-label", "Time scale");
  const timeValue = document.createElement("b");
  timeValue.textContent = "1.00×";
  timeWrap.append(slider, timeValue);

  const mergeBtn = button("Merge");
  const bounceBtn = button("Bounce");
  mergeBtn.classList.add("is-on");
  mergeBtn.setAttribute("aria-pressed", "true");
  bounceBtn.setAttribute("aria-pressed", "false");
  const trailsBtn = button("Trails");
  trailsBtn.classList.add("is-on");
  trailsBtn.setAttribute("aria-pressed", "true");
  const seedBtn = button("Seed");
  const clearBtn = button("Clear");
  const frameBtn = button("Frame");

  dock.append(pauseBtn, timeWrap, mergeBtn, bounceBtn, trailsBtn, seedBtn, clearBtn, frameBtn);

  if (options.downloadHref) {
    const download = document.createElement("a");
    download.className = "ky-btn";
    download.href = options.downloadHref;
    download.setAttribute("download", "kepler-yard.zip");
    download.textContent = "Download site";
    dock.append(download);
  }

  const dev = document.createElement("a");
  dev.className = "ky-dev";
  dev.href = "https://www.instagram.com/_shouryasinha?dlrf=MTY3c2xsZHEydzc3YQ==";
  dev.target = "_blank";
  dev.rel = "noopener noreferrer";
  dev.textContent = "know developer";

  top.append(brand, readout, presets);
  host.append(canvas, empty, top, dock, dev, floatTip);

  let bodies: Body[] = [];
  const sparks: Spark[] = [];
  let nextBodyId = 1;
  let presetId: PresetId = "world";
  let mode: CollisionMode = "merge";
  let timeScale = 1;
  let paused = false;
  let showTrails = true;
  let pinnedId: number | null = null;
  let drag: Drag | null = null;
  let camX = 0;
  let camY = 0;
  let zoom = 1;
  let cssW = 1;
  let cssH = 1;
  let shake = 0;
  let accumulator = 0;
  let tick = 0;
  let last = performance.now();
  let raf = 0;
  let hoverBody: Body | null = null;
  const predict: { x: number; y: number }[] = [];
  const stars = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random(),
    z: 0.15 + Math.random() * 0.75,
    r: Math.random() * 1.15 + 0.25,
    a: 0.25 + Math.random() * 0.6,
  }));

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;

  function issueId(): number {
    const id = nextBodyId;
    nextBodyId += 1;
    return id;
  }

  function button(label: string): HTMLButtonElement {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "ky-btn";
    node.textContent = label;
    return node;
  }

  function syncReadout(): void {
    const count = countEl.querySelector("strong");
    const speed = speedEl.querySelector("strong");
    const modeNode = modeEl.querySelector("strong");
    if (count) count.textContent = String(bodies.length);
    if (speed) speed.textContent = paused ? "hold" : `${timeScale.toFixed(2)}×`;
    if (modeNode) modeNode.textContent = mode;
    timeValue.textContent = paused ? "hold" : `${timeScale.toFixed(2)}×`;
    empty.hidden = bodies.length > 0;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
  }

  function selectPreset(id: PresetId): void {
    presetId = id;
    for (const chip of presets.querySelectorAll<HTMLButtonElement>(".ky-chip")) {
      const on = chip.dataset.preset === id;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  for (const preset of PRESETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ky-chip";
    chip.dataset.preset = preset.id;
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", preset.id === presetId ? "true" : "false");
    const dot = document.createElement("span");
    dot.className = "ky-dot";
    dot.style.background = preset.core
      ? `radial-gradient(circle at 40% 40%, var(--ky-ink), hsl(${preset.hue} 70% 42%) 42%, var(--ky-void) 70%)`
      : `radial-gradient(circle at 35% 35%, hsl(40 40% 94%), hsl(${preset.hue} 75% 52%) 46%, hsl(${preset.hue} 80% 28%))`;
    const name = document.createElement("span");
    name.textContent = preset.label;
    const mass = document.createElement("small");
    mass.textContent = preset.mass >= 1000 ? `${Math.round(preset.mass / 100) / 10}k` : String(preset.mass);
    chip.append(dot, name, mass);
    chip.addEventListener("click", () => selectPreset(preset.id));
    presets.append(chip);
  }
  selectPreset(presetId);

  function bodyAt(x: number, y: number): Body | null {
    let found: Body | null = null;
    let best = Infinity;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const dx = body.x - x;
      const dy = body.y - y;
      const d2 = dx * dx + dy * dy;
      const hit = (body.radius + 6 / zoom) ** 2;
      if (d2 <= hit && d2 < best) {
        best = d2;
        found = body;
      }
    }
    return found;
  }

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - rect.width / 2) / zoom + camX,
      y: (sy - rect.top - rect.height / 2) / zoom + camY,
    };
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function frameAll(): void {
    if (bodies.length === 0) {
      camX = 0;
      camY = 0;
      zoom = 1;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const body of bodies) {
      minX = Math.min(minX, body.x - body.radius);
      minY = Math.min(minY, body.y - body.radius);
      maxX = Math.max(maxX, body.x + body.radius);
      maxY = Math.max(maxY, body.y + body.radius);
    }
    const pad = 90;
    camX = (minX + maxX) / 2;
    camY = (minY + maxY) / 2;
    const spanX = Math.max(40, maxX - minX + pad * 2);
    const spanY = Math.max(40, maxY - minY + pad * 2);
    zoom = Math.min(cssW / spanX, cssH / spanY);
    zoom = Math.max(0.18, Math.min(2.4, zoom));
  }

  function seed(): void {
    bodies = createSeed(issueId);
    pinnedId = null;
    drag = null;
    sparks.length = 0;
    frameAll();
    syncReadout();
  }

  function clearYard(): void {
    bodies = [];
    sparks.length = 0;
    pinnedId = null;
    drag = null;
    shake = 0;
    syncReadout();
  }

  function setMode(next: CollisionMode): void {
    mode = next;
    mergeBtn.classList.toggle("is-on", mode === "merge");
    bounceBtn.classList.toggle("is-on", mode === "bounce");
    mergeBtn.setAttribute("aria-pressed", mode === "merge" ? "true" : "false");
    bounceBtn.setAttribute("aria-pressed", mode === "bounce" ? "true" : "false");
    syncReadout();
  }

  function aimVelocity(startSx: number, startSy: number, sx: number, sy: number): { vx: number; vy: number } {
    const scale = 2.15;
    return {
      vx: ((sx - startSx) / zoom) * scale,
      vy: ((sy - startSy) / zoom) * scale,
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button === 1) return;
    canvas.setPointerCapture(event.pointerId);
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      drag = null;
      pinnedId = null;
      return;
    }
    if (event.button === 2 || event.altKey) {
      drag = {
        kind: "pan",
        sx: event.clientX,
        sy: event.clientY,
        pointerId: event.pointerId,
        camX,
        camY,
      };
      return;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    const hit = bodyAt(world.x, world.y);
    if (hit) {
      drag = {
        kind: "fling",
        sx: event.clientX,
        sy: event.clientY,
        pointerId: event.pointerId,
        bodyId: hit.id,
        vx: hit.vx,
        vy: hit.vy,
      };
      pinnedId = hit.id;
      return;
    }
    if (bodies.length >= MAX_BODIES) {
      floatTip.hidden = false;
      floatTip.textContent = "Yard is full — clear a few bodies";
      floatTip.style.left = `${event.clientX - host.getBoundingClientRect().left}px`;
      floatTip.style.top = `${event.clientY - host.getBoundingClientRect().top}px`;
      return;
    }
    drag = {
      kind: "spawn",
      sx: event.clientX,
      sy: event.clientY,
      x: world.x,
      y: world.y,
      pointerId: event.pointerId,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const rect = host.getBoundingClientRect();
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const nextZoom = Math.max(0.18, Math.min(3.2, pinch.zoom * (dist / pinch.dist)));
      const mid = screenToWorld(pinch.cx, pinch.cy);
      zoom = nextZoom;
      const after = screenToWorld(pinch.cx, pinch.cy);
      camX += mid.x - after.x;
      camY += mid.y - after.y;
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) {
      const world = screenToWorld(event.clientX, event.clientY);
      hoverBody = bodyAt(world.x, world.y);
      if (hoverBody) {
        floatTip.hidden = false;
        const mass =
          hoverBody.mass >= 1000 ? `${(hoverBody.mass / 1000).toFixed(1)}k` : hoverBody.mass.toFixed(0);
        floatTip.textContent = `m ${mass}`;
        floatTip.style.left = `${event.clientX - rect.left}px`;
        floatTip.style.top = `${event.clientY - rect.top}px`;
      } else {
        floatTip.hidden = true;
      }
      canvas.style.cursor = hoverBody ? "grab" : "crosshair";
      return;
    }
    floatTip.hidden = true;
    if (drag.kind === "pan") {
      camX = drag.camX - (event.clientX - drag.sx) / zoom;
      camY = drag.camY - (event.clientY - drag.sy) / zoom;
      return;
    }
    const aim = aimVelocity(drag.sx, drag.sy, event.clientX, event.clientY);
    if (drag.kind === "fling") {
      const bodyId = drag.bodyId;
      const heldVx = drag.vx;
      const heldVy = drag.vy;
      const body = bodies.find((item) => item.id === bodyId);
      if (!body) return;
      const moved = Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy);
      body.vx = moved < 5 ? heldVx : aim.vx;
      body.vy = moved < 5 ? heldVy : aim.vy;
    }
  }

  function finishDrag(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = drag;
    drag = null;
    pinnedId = null;
    canvas.style.cursor = "crosshair";
    if (current.kind === "pan") return;
    const moved = Math.hypot(event.clientX - current.sx, event.clientY - current.sy);
    if (current.kind === "fling") {
      const body = bodies.find((item) => item.id === current.bodyId);
      if (!body) return;
      if (moved < 5) {
        body.vx = current.vx;
        body.vy = current.vy;
      } else {
        const aim = aimVelocity(current.sx, current.sy, event.clientX, event.clientY);
        body.vx = aim.vx;
        body.vy = aim.vy;
      }
      return;
    }
    if (bodies.length >= MAX_BODIES) return;
    const aim = moved < 5 ? { vx: 0, vy: 0 } : aimVelocity(current.sx, current.sy, event.clientX, event.clientY);
    const body = makeBody(issueId(), current.x, current.y, aim.vx, aim.vy, presetById(presetId));
    bodies.push(body);
    accelerations(bodies);
    syncReadout();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const before = screenToWorld(event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0011);
    zoom = Math.max(0.18, Math.min(3.2, zoom * factor));
    const after = screenToWorld(event.clientX, event.clientY);
    camX += before.x - after.x;
    camY += before.y - after.y;
  }

  function onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (event.code === "Space") {
      event.preventDefault();
      paused = !paused;
      syncReadout();
    } else if (event.key >= "1" && event.key <= "6") {
      const preset = PRESETS[Number(event.key) - 1];
      if (preset) selectPreset(preset.id);
    } else if (event.key === "c" && !event.metaKey && !event.ctrlKey) {
      clearYard();
    } else if (event.key === "f") {
      frameAll();
    }
  }

  function onContext(event: Event): void {
    event.preventDefault();
  }

  function drawOrbitGuide(
    x: number,
    y: number,
    vx: number,
    vy: number,
    ignoreId: number | null,
  ): void {
    const attractor = dominantAttractor(bodies, x, y, ignoreId);
    if (!attractor) return;
    const speed = Math.hypot(vx, vy);
    const tx = -attractor.ny;
    const ty = attractor.nx;
    const tangent = speed < 1 ? 1 : Math.sign(vx * tx + vy * ty) || 1;
    const align = speed < 8 ? 0 : (vx * tx * tangent + vy * ty * tangent) / speed;
    const ratio = speed / attractor.speed;
    const locked = align > 0.94 && ratio > 0.82 && ratio < 1.18;
    ctx.beginPath();
    ctx.arc(attractor.body.x, attractor.body.y, attractor.dist, 0, Math.PI * 2);
    ctx.setLineDash([7 / zoom, 8 / zoom]);
    ctx.strokeStyle = locked ? "hsla(36 78% 64% / 0.85)" : "hsla(36 40% 62% / 0.28)";
    ctx.lineWidth = (locked ? 1.6 : 1) / zoom;
    ctx.stroke();
    ctx.setLineDash([]);
    const gx = x + tx * tangent * attractor.speed * 0.42;
    const gy = y + ty * tangent * attractor.speed * 0.42;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(gx, gy);
    ctx.strokeStyle = "hsla(36 70% 70% / 0.45)";
    ctx.lineWidth = 1.25 / zoom;
    ctx.stroke();
    if (locked) {
      ctx.font = `${12 / zoom}px ${getComputedStyle(host).fontFamily}`;
      ctx.fillStyle = "hsla(36 80% 68% / 0.95)";
      ctx.fillText("orbit lock", x + 10 / zoom, y - 12 / zoom);
    }
  }

  function drawArrow(x: number, y: number, vx: number, vy: number, hue: number): void {
    const scale = 0.42;
    const x2 = x + vx * scale;
    const y2 = y + vy * scale;
    if (Math.hypot(x2 - x, y2 - y) < 2 / zoom) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = cssColor(hue, 72, 0.9);
    ctx.lineWidth = 1.6 / zoom;
    ctx.stroke();
    const ang = Math.atan2(y2 - y, x2 - x);
    const head = 8 / zoom;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
    ctx.closePath();
    ctx.fillStyle = cssColor(hue, 72, 0.95);
    ctx.fill();
  }

  function predictPath(x: number, y: number, vx: number, vy: number, ignoreId: number | null): void {
    predict.length = 0;
    let px = x;
    let py = y;
    let pvx = vx;
    let pvy = vy;
    const others = bodies.filter((body) => body.id !== ignoreId);
    for (let i = 0; i < 72; i++) {
      let ax = 0;
      let ay = 0;
      for (const body of others) {
        const dx = body.x - px;
        const dy = body.y - py;
        const dist2 = dx * dx + dy * dy + EPS * EPS;
        const inv = 1 / Math.sqrt(dist2);
        const scale = G * inv * inv * inv * body.mass;
        ax += scale * dx;
        ay += scale * dy;
      }
      pvx += ax * 0.05;
      pvy += ay * 0.05;
      px += pvx * 0.05;
      py += pvy * 0.05;
      if (i % 2 === 0) predict.push({ x: px, y: py });
      for (const body of others) {
        const dx = body.x - px;
        const dy = body.y - py;
        if (dx * dx + dy * dy < (body.radius + 8) ** 2) return;
      }
    }
  }

  function drawBody(body: Body): void {
    const glowR = body.radius * (body.core ? 5.5 : 4.2);
    const glow = ctx.createRadialGradient(body.x, body.y, body.radius * 0.2, body.x, body.y, glowR);
    if (body.core) {
      glow.addColorStop(0, "hsla(270 40% 8% / 0.2)");
      glow.addColorStop(0.45, cssColor(body.hue, 48, 0.35));
      glow.addColorStop(1, cssColor(body.hue, 40, 0));
    } else if (body.mass > 2000) {
      glow.addColorStop(0, "hsla(42 90% 72% / 0.95)");
      glow.addColorStop(0.25, cssColor(body.hue, 58, 0.55));
      glow.addColorStop(1, cssColor(body.hue, 50, 0));
    } else {
      glow.addColorStop(0, cssColor(body.hue, 68, 0.55));
      glow.addColorStop(0.4, cssColor(body.hue, 48, 0.18));
      glow.addColorStop(1, cssColor(body.hue, 48, 0));
    }
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(body.x, body.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    if (body.mass > 160 && body.mass < 2500 && !body.core) {
      ctx.beginPath();
      ctx.ellipse(body.x, body.y, body.radius * 1.85, body.radius * 0.48, -0.4, 0, Math.PI * 2);
      ctx.strokeStyle = cssColor(body.hue, 78, 0.45);
      ctx.lineWidth = Math.max(1.2 / zoom, body.radius * 0.08);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
    if (body.core) {
      const disk = ctx.createRadialGradient(
        body.x,
        body.y,
        body.radius * 0.15,
        body.x,
        body.y,
        body.radius,
      );
      disk.addColorStop(0, voidFill);
      disk.addColorStop(0.72, "#100c16");
      disk.addColorStop(1, `hsl(${body.hue} 75% 58%)`);
      ctx.fillStyle = disk;
    } else {
      const disk = ctx.createRadialGradient(
        body.x - body.radius * 0.35,
        body.y - body.radius * 0.4,
        body.radius * 0.1,
        body.x,
        body.y,
        body.radius,
      );
      disk.addColorStop(0, "hsl(40 45% 92%)");
      disk.addColorStop(0.42, `hsl(${body.hue} 70% 58%)`);
      disk.addColorStop(1, `hsl(${body.hue} 75% 32%)`);
      ctx.fillStyle = disk;
    }
    ctx.fill();
  }

  function draw(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = voidFill;
    ctx.fillRect(0, 0, cssW, cssH);

    const parallaxX = camX * 0.08;
    const parallaxY = camY * 0.08;
    for (const star of stars) {
      const x = ((star.x * cssW - parallaxX * star.z) % cssW + cssW) % cssW;
      const y = ((star.y * cssH - parallaxY * star.z) % cssH + cssH) % cssH;
      ctx.fillStyle = `hsla(40 30% 90% / ${star.a})`;
      ctx.fillRect(x, y, star.r, star.r);
    }

    const vignette = ctx.createRadialGradient(
      cssW / 2,
      cssH / 2,
      Math.min(cssW, cssH) * 0.3,
      cssW / 2,
      cssH / 2,
      Math.max(cssW, cssH) * 0.72,
    );
    vignette.addColorStop(0, "hsla(220 20% 4% / 0)");
    vignette.addColorStop(1, "hsla(220 30% 2% / 0.45)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, cssW, cssH);

    const shakeMag = reduceMotion ? 0 : shake;
    const sx = (Math.random() - 0.5) * shakeMag;
    const sy = (Math.random() - 0.5) * shakeMag;
    ctx.save();
    ctx.translate(cssW / 2 + sx, cssH / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    if (showTrails) {
      for (const body of bodies) {
        const trail = body.trail;
        if (trail.length < 2) continue;
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) ** 1.7 * 0.55;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = cssColor(body.hue, 68, alpha);
          ctx.lineWidth = Math.max(1 / zoom, body.radius * 0.12);
          ctx.stroke();
        }
      }
    }

    predict.length = 0;
    const active = drag;
    if (active?.kind === "spawn") {
      const aim = aimVelocity(active.sx, active.sy, lastPointer.x, lastPointer.y);
      const preset = presetById(presetId);
      drawOrbitGuide(active.x, active.y, aim.vx, aim.vy, null);
      predictPath(active.x, active.y, aim.vx, aim.vy, null);
      drawArrow(active.x, active.y, aim.vx, aim.vy, preset.hue);
    } else if (active?.kind === "fling") {
      const body = bodies.find((item) => item.id === active.bodyId);
      if (body) {
        drawOrbitGuide(body.x, body.y, body.vx, body.vy, body.id);
        predictPath(body.x, body.y, body.vx, body.vy, body.id);
        drawArrow(body.x, body.y, body.vx, body.vy, body.hue);
      }
    }

    if (predict.length > 1) {
      ctx.beginPath();
      ctx.moveTo(predict[0].x, predict[0].y);
      for (let i = 1; i < predict.length; i++) ctx.lineTo(predict[i].x, predict[i].y);
      ctx.strokeStyle = "hsla(40 40% 86% / 0.55)";
      ctx.lineWidth = 1.15 / zoom;
      ctx.setLineDash([3 / zoom, 5 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const spark of sparks) {
      const alpha = Math.max(0, spark.life / spark.max);
      ctx.fillStyle = cssColor(spark.hue, 70, alpha);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size / zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const body of bodies) drawBody(body);
    ctx.restore();
  }

  const voidFill = "#07080c";
  const lastPointer = { x: 0, y: 0 };

  function frame(now: number): void {
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused && timeScale > 0) {
      accumulator += raw * timeScale;
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS) {
        tick += 1;
        const result = substep(bodies, STEP, mode, pinnedId, sparks, tick);
        pinnedId = result.pinnedId;
        if (result.shake > 0 && !reduceMotion) shake = Math.max(shake, result.shake);
        if (result.removed > 0) syncReadout();
        accumulator -= STEP;
        steps += 1;
      }
      if (steps === MAX_STEPS) accumulator = 0;
    }
    tickSparks(sparks, raw);
    shake = Math.max(0, shake - raw * 14);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function trackPointer(event: PointerEvent): void {
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
  }

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    if (!paused && timeScale === 0) {
      timeScale = 1;
      slider.value = "1";
    }
    syncReadout();
  });
  slider.addEventListener("input", () => {
    timeScale = Number(slider.value);
    paused = timeScale === 0;
    syncReadout();
  });
  mergeBtn.addEventListener("click", () => setMode("merge"));
  bounceBtn.addEventListener("click", () => setMode("bounce"));
  trailsBtn.addEventListener("click", () => {
    showTrails = !showTrails;
    trailsBtn.classList.toggle("is-on", showTrails);
    trailsBtn.setAttribute("aria-pressed", showTrails ? "true" : "false");
    if (!showTrails) {
      for (const body of bodies) body.trail = [];
    }
  });
  seedBtn.addEventListener("click", seed);
  clearBtn.addEventListener("click", clearYard);
  frameBtn.addEventListener("click", () => frameAll());
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", (event) => {
    trackPointer(event);
    onPointerMove(event);
  });
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);

  const observer = new ResizeObserver(() => resize());
  observer.observe(host);

  window.__ky = {
    bodyCount: () => bodies.length,
    mode: () => mode,
    timeScale: () => (paused ? 0 : timeScale),
  };

  resize();
  seed();
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", resize);
      if (window.__ky) delete window.__ky;
      host.replaceChildren();
    },
  };
}
