/** Softened velocity-Verlet n-body. Momentum-symmetric forces, fixed steps. */

export const G = 86;
export const EPS = 4;
export const VCAP = 2400;
export const TRAIL_MAX = 110;
export const WORLD_LIMIT = 9000;

export type PresetId = "dust" | "moon" | "world" | "giant" | "star" | "core";

export type Preset = {
  id: PresetId;
  label: string;
  mass: number;
  radius: number;
  hue: number;
  core: boolean;
};

export const PRESETS: readonly Preset[] = [
  { id: "dust", label: "Dust", mass: 2.4, radius: 3.1, hue: 36, core: false },
  { id: "moon", label: "Moon", mass: 14, radius: 6.2, hue: 208, core: false },
  { id: "world", label: "World", mass: 52, radius: 11, hue: 16, core: false },
  { id: "giant", label: "Giant", mass: 280, radius: 22, hue: 158, core: false },
  { id: "star", label: "Star", mass: 12000, radius: 32, hue: 40, core: false },
  { id: "core", label: "Core", mass: 26000, radius: 13, hue: 272, core: true },
];

export function presetById(id: PresetId): Preset {
  const found = PRESETS.find((preset) => preset.id === id);
  if (!found) return PRESETS[2];
  return found;
}

export type Body = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  mass: number;
  radius: number;
  hue: number;
  core: boolean;
  trail: { x: number; y: number }[];
};

export type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hue: number;
  size: number;
};

export type CollisionMode = "merge" | "bounce";

export function makeBody(
  id: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  preset: Preset,
): Body {
  return {
    id,
    x,
    y,
    vx,
    vy,
    ax: 0,
    ay: 0,
    mass: preset.mass,
    radius: preset.radius,
    hue: preset.hue,
    core: preset.core,
    trail: [],
  };
}

export function circularSpeed(mass: number, dist: number): number {
  const safe = Math.max(dist, 1);
  const dist2 = safe * safe + EPS * EPS;
  const dist3 = dist2 * Math.sqrt(dist2);
  return Math.sqrt((G * mass * safe * safe) / dist3);
}

function blendHue(h1: number, w1: number, h2: number, w2: number): number {
  const delta = ((((h2 - h1) % 360) + 540) % 360) - 180;
  return (h1 + (delta * w2) / (w1 + w2) + 360) % 360;
}

export function accelerations(bodies: Body[]): void {
  for (let i = 0; i < bodies.length; i++) {
    bodies[i].ax = 0;
    bodies[i].ay = 0;
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy + EPS * EPS;
      const inv = 1 / Math.sqrt(dist2);
      const scale = G * inv * inv * inv;
      const ax = scale * dx;
      const ay = scale * dy;
      a.ax += ax * b.mass;
      a.ay += ay * b.mass;
      b.ax -= ax * a.mass;
      b.ay -= ay * a.mass;
    }
  }
}

function capSpeed(body: Body): void {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > VCAP) {
    const scale = VCAP / speed;
    body.vx *= scale;
    body.vy *= scale;
  }
}

function pushSpark(
  sparks: Spark[],
  x: number,
  y: number,
  hue: number,
  power: number,
): void {
  const count = Math.min(22, 6 + Math.round(power / 40));
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 18 + Math.random() * (40 + power * 0.15);
    sparks.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.35 + Math.random() * 0.45,
      max: 0.8,
      hue,
      size: 1.2 + Math.random() * 2.2,
    });
  }
  if (sparks.length > 280) sparks.splice(0, sparks.length - 280);
}

function bounce(a: Body, b: Body): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    dx = 1;
    dy = 0;
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = a.radius + b.radius - dist;
  if (overlap > 0) {
    const invMass = 1 / (a.mass + b.mass);
    const push = overlap + 0.08;
    a.x -= nx * push * (b.mass * invMass);
    a.y -= ny * push * (b.mass * invMass);
    b.x += nx * push * (a.mass * invMass);
    b.y += ny * push * (a.mass * invMass);
  }
  const velN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (velN > 0) return;
  const impulse = -(1.86 * velN) / (1 / a.mass + 1 / b.mass);
  a.vx -= (impulse / a.mass) * nx;
  a.vy -= (impulse / a.mass) * ny;
  b.vx += (impulse / b.mass) * nx;
  b.vy += (impulse / b.mass) * ny;
  capSpeed(a);
  capSpeed(b);
}

function absorb(keep: Body, drop: Body): void {
  const mass = keep.mass + drop.mass;
  keep.x = (keep.x * keep.mass + drop.x * drop.mass) / mass;
  keep.y = (keep.y * keep.mass + drop.y * drop.mass) / mass;
  keep.vx = (keep.vx * keep.mass + drop.vx * drop.mass) / mass;
  keep.vy = (keep.vy * keep.mass + drop.vy * drop.mass) / mass;
  keep.hue = blendHue(keep.hue, keep.mass, drop.hue, drop.mass);
  keep.radius = Math.min(78, Math.cbrt(keep.radius ** 3 + drop.radius ** 3));
  keep.core = keep.core || (drop.core && drop.mass > keep.mass);
  keep.mass = mass;
  capSpeed(keep);
}

export type StepResult = {
  removed: number;
  pinnedId: number | null;
  shake: number;
};

export function substep(
  bodies: Body[],
  dt: number,
  mode: CollisionMode,
  pinnedId: number | null,
  sparks: Spark[],
  tick: number,
): StepResult {
  let shake = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === pinnedId) continue;
    body.x += body.vx * dt + 0.5 * body.ax * dt * dt;
    body.y += body.vy * dt + 0.5 * body.ay * dt * dt;
  }

  const prevAx = new Float64Array(bodies.length);
  const prevAy = new Float64Array(bodies.length);
  for (let i = 0; i < bodies.length; i++) {
    prevAx[i] = bodies[i].ax;
    prevAy[i] = bodies[i].ay;
  }
  accelerations(bodies);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === pinnedId) continue;
    body.vx += 0.5 * (prevAx[i] + body.ax) * dt;
    body.vy += 0.5 * (prevAy[i] + body.ay) * dt;
    capSpeed(body);
  }

  const dead = new Set<number>();
  let removed = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (dead.has(a.id)) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (dead.has(b.id)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.radius + b.radius;
      if (dx * dx + dy * dy > min * min) continue;
      if (mode === "bounce") {
        bounce(a, b);
        if (sparks.length < 220 && Math.random() < 0.35) {
          pushSpark(sparks, (a.x + b.x) / 2, (a.y + b.y) / 2, a.hue, 20);
        }
        shake = Math.max(shake, 1.5);
        continue;
      }
      const keep = a.mass >= b.mass ? a : b;
      const drop = keep === a ? b : a;
      const impact = Math.hypot(keep.vx - drop.vx, keep.vy - drop.vy);
      absorb(keep, drop);
      dead.add(drop.id);
      removed += 1;
      if (pinnedId === drop.id) pinnedId = keep.id;
      pushSpark(sparks, keep.x, keep.y, keep.hue, Math.min(180, impact));
      shake = Math.max(shake, Math.min(9, 2.2 + impact * 0.02));
    }
  }

  if (dead.size > 0 || tick % 30 === 0) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const body = bodies[i];
      const far = body.x * body.x + body.y * body.y > WORLD_LIMIT * WORLD_LIMIT;
      if (dead.has(body.id) || far) {
        if (pinnedId === body.id) pinnedId = null;
        if (far && !dead.has(body.id)) removed += 1;
        bodies.splice(i, 1);
      }
    }
  }

  if (tick % 2 === 0) {
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const last = body.trail[body.trail.length - 1];
      if (last && (last.x - body.x) ** 2 + (last.y - body.y) ** 2 < 0.35) continue;
      body.trail.push({ x: body.x, y: body.y });
      if (body.trail.length > TRAIL_MAX) body.trail.shift();
    }
  }

  return { removed, pinnedId, shake };
}

export function tickSparks(sparks: Spark[], dt: number): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.life -= dt;
    if (spark.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vx *= 0.985;
    spark.vy *= 0.985;
  }
}

export type Attractor = {
  body: Body;
  dist: number;
  nx: number;
  ny: number;
  speed: number;
};

/** Nearest gravitationally dominant body, plus the circular-orbit speed around it. */
export function dominantAttractor(
  bodies: Body[],
  x: number,
  y: number,
  ignoreId: number | null,
): Attractor | null {
  let best: Body | null = null;
  let bestScore = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === ignoreId) continue;
    const dx = body.x - x;
    const dy = body.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 4) continue;
    const score = body.mass / d2;
    if (score > bestScore) {
      bestScore = score;
      best = body;
    }
  }
  if (!best) return null;
  const dx = x - best.x;
  const dy = y - best.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;
  return {
    body: best,
    dist,
    nx: dx / dist,
    ny: dy / dist,
    speed: circularSpeed(best.mass, dist),
  };
}

let seedClock = 1;

export function createSeed(nextId: () => number): Body[] {
  seedClock += 1;
  const star = makeBody(nextId(), 0, 0, 0, 0, presetById("star"));
  const bodies: Body[] = [star];
  const layout: { id: PresetId; dist: number; ang: number; speedScale: number }[] = [
    { id: "world", dist: 150, ang: 0.4 + seedClock * 0.17, speedScale: 1 },
    { id: "moon", dist: 235, ang: 2.2 + seedClock * 0.11, speedScale: 1 },
    { id: "giant", dist: 390, ang: 3.9 + seedClock * 0.08, speedScale: 1 },
    { id: "world", dist: 560, ang: 5.5 + seedClock * 0.13, speedScale: 1 },
    { id: "dust", dist: 730, ang: 1.05 + seedClock * 0.19, speedScale: 0.94 },
  ];
  for (const spec of layout) {
    const preset = presetById(spec.id);
    const x = Math.cos(spec.ang) * spec.dist;
    const y = Math.sin(spec.ang) * spec.dist;
    const speed = circularSpeed(star.mass, spec.dist) * spec.speedScale;
    bodies.push(
      makeBody(
        nextId(),
        x,
        y,
        -Math.sin(spec.ang) * speed,
        Math.cos(spec.ang) * speed,
        preset,
      ),
    );
  }
  let px = 0;
  let py = 0;
  let mass = 0;
  for (const body of bodies) {
    px += body.vx * body.mass;
    py += body.vy * body.mass;
    mass += body.mass;
  }
  const cvx = px / mass;
  const cvy = py / mass;
  for (const body of bodies) {
    body.vx -= cvx;
    body.vy -= cvy;
  }
  accelerations(bodies);
  return bodies;
}

export const MAX_BODIES = 72;
