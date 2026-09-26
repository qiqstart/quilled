import { drawCalligraphy, drawLiveFountain } from "../quill/calligraphy.ts";
import { nibAngleFromPencil, samplePointer, type Pencil } from "../quill/features/pencil.ts";
import type { Point } from "../quill/types.ts";

/** Fixed italic nib, about 55 degrees, from the letter-desk example. */
export const ITALIC_ANGLE = (-55 * Math.PI) / 180;

export type Brush = "pencil" | "fountain" | "italic" | "smudge" | "text";

export type QuillSample = {
  x: number;
  y: number;
  pressure: number;
  azimuth: number;
  t: number;
};

export function readSample(e: PointerEvent, x: number, y: number, t: number): QuillSample {
  const pencil = samplePointer(
    {
      pointerType: e.pointerType,
      pressure: e.pressure,
      altitudeAngle: e.altitudeAngle,
      azimuthAngle: e.azimuthAngle,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
    },
    true,
  );
  return { x, y, pressure: pencil.pressure, azimuth: pencil.azimuth, t };
}

export function toPoints(samples: QuillSample[], t0: number): Point[] {
  return samples.map((s) => [
    s.x,
    s.y,
    Math.round(s.pressure * 100) / 100,
    Math.max(0, Math.round(s.t - t0)),
  ]);
}

/** Light pressure stays a hairline. Matches the example pencil. */
export function pencilWidth(size: number, pressure: number): number {
  return size * (0.55 + pressure * 0.8);
}

/** Italic keeps a broad nib. Pressure only nudges it. */
export function italicPressure(pressure: number): number {
  return 0.75 + pressure * 0.35;
}

export function fountainAngle(azimuth: number): number {
  return nibAngleFromPencil({ pressure: 0.5, altitude: 1, azimuth });
}

/** Ink left on a finger after it has been dragged `distance` across the page. */
export function stainLeft(amount: number, distance: number): number {
  return Math.max(0, amount - distance / 520);
}

/** Map a screen point into the sheet, undoing a clockwise turn of the page. */
export function sheetPoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number; clientWidth: number; clientHeight: number },
  turn: number,
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const rad = (-turn * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = clientX - cx;
  const dy = clientY - cy;
  return {
    x: dx * c - dy * s + box.clientWidth / 2,
    y: dx * s + dy * c + box.clientHeight / 2,
  };
}

function dampItalic(pts: Point[]): Point[] {
  return pts.map((p) => [p[0], p[1], italicPressure(p[2]), p[3]]);
}

export function drawPencil(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  color: string,
  size: number,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    ctx.beginPath();
    ctx.lineWidth = pencilWidth(size, b[2]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFountain(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  color: string,
  size: number,
  azimuth: number,
  live: boolean,
) {
  if (pts.length < 1) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const angle = fountainAngle(azimuth);
  if (live) drawLiveFountain(ctx, pts, 1, size, angle);
  else drawCalligraphy(ctx, pts, 1, size, angle);
  ctx.restore();
}

export function drawItalic(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  color: string,
  size: number,
  live: boolean,
) {
  if (pts.length < 1) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const shaped = dampItalic(pts);
  const nib = size * 1.35;
  if (live) drawLiveFountain(ctx, shaped, 1, nib, ITALIC_ANGLE);
  else drawCalligraphy(ctx, shaped, 1, nib, ITALIC_ANGLE);
  ctx.restore();
}

export function drawEraser(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  size: number,
  live = false,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 8;
  if (live) {
    ctx.strokeStyle = "rgba(32, 36, 42, 0.28)";
  } else {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
  ctx.restore();
}

/** Share URL for a desk. The name is the part after q-. */
export function joinUrl(href: string, room: string): string {
  const url = new URL(href);
  const name = room.replace(/^q-/, "").trim() || "shared";
  url.searchParams.set("desk", name.slice(0, 48));
  return url.toString();
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
) {
  const body = text.trim();
  if (!body) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${Math.max(16, size * 10)}px "Cormorant Garamond", Georgia, serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(body, x, y);
  ctx.restore();
}

export function drawSmudge(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  color: string,
  amount: number,
) {
  if (pts.length < 2) return;
  const wet = Math.min(1, Math.max(0, amount));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.08 + wet * 0.22;
  ctx.lineWidth = 14 + wet * 10;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
  ctx.globalAlpha = 0.12 + wet * 0.2;
  const last = pts[pts.length - 1]!;
  ctx.beginPath();
  ctx.ellipse(last[0], last[1] + 2, 7 + wet * 6, 5 + wet * 4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function paintMark(
  ctx: CanvasRenderingContext2D,
  mark: {
    brush: Brush;
    color: string;
    size: number;
    eraser: boolean;
    az: number;
    pts: Point[];
    text?: string;
  },
  live = false,
) {
  if (mark.eraser) {
    drawEraser(ctx, mark.pts, mark.size, live);
    return;
  }
  if (mark.brush === "text") {
    drawText(ctx, mark.text ?? "", mark.pts[0]?.[0] ?? 0, mark.pts[0]?.[1] ?? 0, mark.color, mark.size);
    return;
  }
  if (mark.brush === "pencil") drawPencil(ctx, mark.pts, mark.color, mark.size);
  else if (mark.brush === "fountain") drawFountain(ctx, mark.pts, mark.color, mark.size, mark.az, live);
  else if (mark.brush === "smudge") drawSmudge(ctx, mark.pts, mark.color, mark.size);
  else drawItalic(ctx, mark.pts, mark.color, mark.size, live);
}

export type { Pencil };
