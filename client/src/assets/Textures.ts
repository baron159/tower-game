// Procedural textures generated at runtime with the 2D canvas API.
// Avoids shipping any image files so the game has zero binary asset deps.

import * as THREE from "three";

export interface BlockTextureSpec {
  hue: number;       // 0..1
  shape: "slab" | "cube" | "wedge";
  blockId: number;   // for the printed numeral
}

const cache = new Map<string, THREE.CanvasTexture>();

function key(s: BlockTextureSpec): string {
  return `${s.shape}:${s.blockId}:${Math.round(s.hue * 100)}`;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${(h * 360).toFixed(0)}deg ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, hue: number, seed: number) {
  // Base
  const baseLight = 0.62;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, hsl(hue, 0.42, baseLight));
  grad.addColorStop(1, hsl(hue, 0.40, baseLight - 0.08));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Grain streaks
  ctx.globalCompositeOperation = "overlay";
  const rng = mulberry32(seed);
  for (let i = 0; i < 28; i++) {
    const y = Math.floor(rng() * h);
    const amp = 1.5 + rng() * 4;
    const wavelen = 60 + rng() * 100;
    const phase = rng() * Math.PI * 2;
    ctx.strokeStyle = `rgba(0,0,0,${0.06 + rng() * 0.10})`;
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const yy = y + Math.sin((x / wavelen) * Math.PI * 2 + phase) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // Knots
  for (let i = 0; i < 3; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = 6 + rng() * 14;
    const knotGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    knotGrad.addColorStop(0, `rgba(0,0,0,0.5)`);
    knotGrad.addColorStop(0.6, `rgba(0,0,0,0.15)`);
    knotGrad.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = knotGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Subtle bevel edge
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function getBlockTexture(spec: BlockTextureSpec): THREE.CanvasTexture {
  const k = key(spec);
  const cached = cache.get(k);
  if (cached) return cached;

  const size = 256;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  drawWoodGrain(ctx, size, size, spec.hue, spec.blockId * 9973 + 1);

  // Block number badge — helps players match cards to blocks.
  const badgeR = 28;
  const bx = size - badgeR - 18;
  const by = badgeR + 18;
  ctx.beginPath();
  ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 110, 86, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(spec.blockId + 1), bx, by + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(k, tex);
  return tex;
}

// ----- Card face textures -----

export interface CardFaceSpec {
  kind: "build" | "move" | "skip" | "draw2";
  blockId: number; // For build cards: which block face to show.
  hue: number;     // For build cards: matching block hue.
}

const cardCache = new Map<string, THREE.CanvasTexture>();

const CARD_W = 320;
const CARD_H = 448;

export function getCardTexture(spec: CardFaceSpec): THREE.CanvasTexture {
  const k = `${spec.kind}:${spec.blockId}:${Math.round(spec.hue * 100)}`;
  const cached = cardCache.get(k);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = CARD_W; c.height = CARD_H;
  const ctx = c.getContext("2d")!;

  // Background card stock
  ctx.fillStyle = "#f6f1e3";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // Inner border
  ctx.strokeStyle = "#1d9e75";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, CARD_W - 20, CARD_H - 20);

  // Title bar
  const palette = paletteFor(spec.kind);
  ctx.fillStyle = palette.bar;
  ctx.fillRect(20, 20, CARD_W - 40, 60);
  ctx.fillStyle = palette.barText;
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(titleFor(spec.kind), CARD_W / 2, 50);

  // Body illustration
  if (spec.kind === "build") {
    // Draw the matching block, large.
    const cx = CARD_W / 2;
    const cy = 230;
    drawBlockIcon(ctx, cx, cy, spec.hue, spec.blockId);
    ctx.fillStyle = "#5a4f33";
    ctx.font = "bold 22px system-ui";
    ctx.fillText(`Block #${spec.blockId + 1}`, CARD_W / 2, 360);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "#7d6e4a";
    wrapText(ctx, "Find this block and add it to the tower.", CARD_W / 2, 392, CARD_W - 60, 20);
  } else {
    const cx = CARD_W / 2;
    const cy = 230;
    drawSymbol(ctx, cx, cy, spec.kind);
    ctx.fillStyle = "#5a4f33";
    ctx.font = "16px system-ui";
    ctx.textAlign = "center";
    wrapText(ctx, descriptionFor(spec.kind), CARD_W / 2, 372, CARD_W - 60, 22);
  }

  // Corner indicators
  ctx.fillStyle = palette.bar;
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(shortFor(spec.kind), 28, 105);
  ctx.textAlign = "right";
  ctx.fillText(shortFor(spec.kind), CARD_W - 28, CARD_H - 28);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cardCache.set(k, tex);
  return tex;
}

function paletteFor(kind: CardFaceSpec["kind"]) {
  switch (kind) {
    case "build": return { bar: "#97c459", barText: "#1f3a0a" };
    case "move":  return { bar: "#85b7eb", barText: "#0a2740" };
    case "skip":  return { bar: "#b4b2a9", barText: "#2b2a25" };
    case "draw2": return { bar: "#fac775", barText: "#3a230a" };
  }
}
function titleFor(kind: CardFaceSpec["kind"]): string {
  return kind === "build" ? "BUILD" : kind === "move" ? "MOVE" : kind === "skip" ? "SKIP" : "DRAW 2";
}
function shortFor(kind: CardFaceSpec["kind"]): string {
  return kind === "build" ? "+" : kind === "move" ? "↔" : kind === "skip" ? "▶▶" : "×2";
}
function descriptionFor(kind: CardFaceSpec["kind"]): string {
  switch (kind) {
    case "move":  return "Move any block already on the tower to a new position.";
    case "skip":  return "Your turn ends. Pass to the next player.";
    case "draw2": return "Draw two more cards and complete both actions.";
    case "build": return "";
  }
}

function drawBlockIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, hue: number, blockId: number) {
  // Mini isometric block.
  const w = 130, h = 70;
  ctx.save();
  ctx.translate(cx, cy);
  // Top face
  ctx.fillStyle = hsl(hue, 0.45, 0.72);
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w, -h + 30);
  ctx.lineTo(0, -h + 60);
  ctx.lineTo(-w, -h + 30);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Right face
  ctx.fillStyle = hsl(hue, 0.45, 0.55);
  ctx.beginPath();
  ctx.moveTo(0, -h + 60);
  ctx.lineTo(w, -h + 30);
  ctx.lineTo(w, h - 30);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Left face
  ctx.fillStyle = hsl(hue, 0.45, 0.45);
  ctx.beginPath();
  ctx.moveTo(0, -h + 60);
  ctx.lineTo(-w, -h + 30);
  ctx.lineTo(-w, h - 30);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // ID badge on left face
  ctx.fillStyle = "rgba(15, 110, 86, 0.92)";
  ctx.beginPath();
  ctx.arc(-45, 10, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(blockId + 1), -45, 11);
  ctx.restore();
}

function drawSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, kind: "move" | "skip" | "draw2") {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "move") {
    ctx.strokeStyle = "#185fa5";
    ctx.beginPath();
    ctx.moveTo(-60, 0); ctx.lineTo(60, 0);
    ctx.moveTo(60, 0); ctx.lineTo(40, -20);
    ctx.moveTo(60, 0); ctx.lineTo(40, 20);
    ctx.moveTo(-60, 0); ctx.lineTo(-40, -20);
    ctx.moveTo(-60, 0); ctx.lineTo(-40, 20);
    ctx.stroke();
    ctx.strokeStyle = "#85b7eb";
    ctx.fillStyle = "#85b7eb";
    ctx.fillRect(-25, -50, 50, 30);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(-25, -50, 50, 30);
    ctx.fillStyle = "#85b7eb";
    ctx.fillRect(-25, 20, 50, 30);
    ctx.strokeRect(-25, 20, 50, 30);
  } else if (kind === "skip") {
    ctx.fillStyle = "#5f5e5a";
    ctx.beginPath();
    ctx.moveTo(-50, -40); ctx.lineTo(10, 0); ctx.lineTo(-50, 40); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10, -40); ctx.lineTo(70, 0); ctx.lineTo(10, 40); ctx.closePath();
    ctx.fill();
  } else {
    // Draw 2 — two stylized cards
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.translate(i * 18 - 20, i * 10 - 20);
      ctx.rotate(-0.15);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#854f0b";
      ctx.lineWidth = 4;
      ctx.fillRect(-30, -45, 60, 90);
      ctx.strokeRect(-30, -45, 60, 90);
      ctx.fillStyle = "#fac775";
      ctx.fillRect(-26, -41, 52, 18);
      ctx.fillStyle = "#854f0b";
      ctx.font = "bold 28px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("2", 0, 12);
      ctx.restore();
    }
  }
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + " ";
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line, x, yy);
      line = words[n] + " ";
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
}

// Wood floor texture for the table.
export function getTableTexture(): THREE.CanvasTexture {
  const cached = cache.get("table");
  if (cached) return cached;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  drawWoodGrain(ctx, size, size, 0.08, 7);
  // Darker tint than blocks
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(60,40,20,0.55)";
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  cache.set("table", tex);
  return tex;
}
