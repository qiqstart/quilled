import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Download, Eraser, Link2, PenLine, Pencil, Play, Redo2, RotateCw, Square, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useP2PRoom } from "@/lib/multiplayer";
import type { Point } from "@/lib/quill/types";
import { traceAt } from "@/lib/quill/features/trace";
import { joinUrl, paintMark, readSample, sheetPoint, stainLeft, toPoints, type Brush, type QuillSample } from "@/lib/quilled/draw";

const STORE = "quilled:letter";

const INKS = [
  { id: "iron", color: "#111111", name: "Iron" },
  { id: "indigo", color: "#183b73", name: "Indigo" },
  { id: "oxblood", color: "#632727", name: "Oxblood" },
  { id: "forest", color: "#174d34", name: "Forest" },
] as const;

const PAPERS = ["lined", "blank", "cream", "dusk"] as const;
type Paper = (typeof PAPERS)[number];

const PAPER_FILL: Record<Paper, string> = {
  lined: "#fbfbfc",
  blank: "#fbfbfc",
  cream: "#f3e6c8",
  dusk: "#243044",
};

const PAPER_RULE: Record<Paper, string | null> = {
  lined: "#cbd8e5",
  blank: null,
  cream: null,
  dusk: "#3d4d66",
};

const BRUSHES: { id: Brush; label: string; Icon: typeof Pencil }[] = [
  { id: "pencil", label: "Pencil", Icon: Pencil },
  { id: "fountain", label: "Fountain", Icon: PenLine },
  { id: "italic", label: "Italic", Icon: PenLine },
];

type Hand = "hand" | "finger" | "type";

type Mark = {
  brush: Brush;
  color: string;
  size: number;
  eraser: boolean;
  az: number;
  pts: Point[];
  text?: string;
};

type Live = {
  brush: Brush;
  color: string;
  size: number;
  eraser: boolean;
  samples: QuillSample[];
};

type LetterFile = {
  marks: Mark[];
  paper: Paper;
  turn: number;
  stain: boolean;
};

function loadLetter(): LetterFile {
  const fresh: LetterFile = { marks: [], paper: "lined", turn: 0, stain: false };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<LetterFile> & { lined?: boolean };
    const paper: Paper =
      parsed.paper && (PAPERS as readonly string[]).includes(parsed.paper)
        ? parsed.paper
        : parsed.lined === false
          ? "blank"
          : "lined";
    const turn = parsed.turn === 90 || parsed.turn === 180 || parsed.turn === 270 ? parsed.turn : 0;
    return {
      marks: Array.isArray(parsed.marks) ? parsed.marks : [],
      paper,
      turn,
      stain: parsed.stain === true,
    };
  } catch {
    return fresh;
  }
}

function withDpr(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return withDpr(canvas);
}

function eventsOf(e: PointerEvent): PointerEvent[] {
  const list = e.getCoalescedEvents?.();
  return list && list.length ? list : [e];
}

function pathLen(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  return d;
}

function deskRoom(): string {
  const desk = new URLSearchParams(window.location.search).get("desk");
  return `q-${(desk || "shared").slice(0, 48)}`;
}

export function QuilledDesk() {
  const [room, setRoom] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<Mark[]>([]);
  const undoneRef = useRef<Mark[]>([]);
  const remoteMarks = useRef(new Map<string, Mark[]>());
  const remoteLive = useRef(new Map<string, Mark>());
  const liveStroke = useRef<Live | null>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const caret = useRef<{ x: number; y: number } | null>(null);
  const finger = useRef<{ color: string; amount: number } | null>(null);
  const playingRef = useRef(false);
  const turnRef = useRef(0);
  const lastCast = useRef(0);
  const sendRef = useRef<(data: unknown) => void>(() => {});
  const castRef = useRef<(data: unknown) => void>(() => {});
  const viewRef = useRef({ paper: "lined" as Paper, turn: 0, stain: false });

  const [brush, setBrush] = useState<Brush>("pencil");
  const [color, setColor] = useState<string>(INKS[0].color);
  const [size, setSize] = useState(2.5);
  const [erasing, setErasing] = useState(false);
  const [paper, setPaper] = useState<Paper>("lined");
  const [turn, setTurn] = useState(0);
  const [stain, setStain] = useState(false);
  const [hand, setHand] = useState<Hand>("hand");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinLink, setJoinLink] = useState("");
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState("Pencil");
  const [armedClear, setArmedClear] = useState(false);
  const [hasMarks, setHasMarks] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [others, setOthers] = useState(0);

  const toolRef = useRef({
    brush: "pencil" as Brush,
    color: INKS[0].color as string,
    size: 2.5,
    erasing: false,
    stain: false,
    hand: "hand" as Hand,
  });
  toolRef.current = { brush, color, size, erasing, stain, hand };
  viewRef.current = { paper, turn, stain };
  turnRef.current = turn;

  const redrawInk = useCallback(() => {
    const canvas = inkRef.current;
    if (!canvas) return;
    const ctx = sizeCanvas(canvas);
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    for (const mark of marksRef.current) paintMark(ctx, mark, false);
    for (const list of remoteMarks.current.values()) {
      for (const mark of list) paintMark(ctx, mark, false);
    }
  }, []);

  const redrawLive = useCallback(() => {
    const canvas = liveRef.current;
    if (!canvas) return;
    const ctx = sizeCanvas(canvas);
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const live = liveStroke.current;
    if (live && live.samples.length >= 2) {
      const pts = toPoints(live.samples, live.samples[0]!.t);
      paintMark(
        ctx,
        {
          brush: live.brush,
          color: live.color,
          size: live.size,
          eraser: live.eraser,
          az: live.samples[live.samples.length - 1]!.azimuth,
          pts,
        },
        true,
      );
    }
    for (const mark of remoteLive.current.values()) paintMark(ctx, mark, true);
  }, []);

  const persist = useCallback(() => {
    const view = viewRef.current;
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          marks: marksRef.current,
          paper: view.paper,
          turn: view.turn,
          stain: view.stain,
        }),
      );
    } catch {
      /* private mode */
    }
    setHasMarks(marksRef.current.length > 0 || remoteMarks.current.size > 0);
  }, []);

  const onWire = useCallback(
    (from: string, data: unknown) => {
      if (!data || typeof data !== "object") return;
      const msg = data as { t?: string; mark?: Mark; marks?: Mark[] };
      if (msg.t === "mark" && msg.mark) {
        const list = remoteMarks.current.get(from) ?? [];
        list.push(msg.mark);
        remoteMarks.current.set(from, list);
        const ink = inkRef.current;
        const ctx = ink ? withDpr(ink) : null;
        if (ctx) paintMark(ctx, msg.mark, false);
        setHasMarks(true);
      } else if (msg.t === "live" && msg.mark) {
        remoteLive.current.set(from, msg.mark);
        redrawLive();
      } else if (msg.t === "liveEnd") {
        remoteLive.current.delete(from);
        redrawLive();
      } else if (msg.t === "snap" && Array.isArray(msg.marks)) {
        remoteMarks.current.set(from, msg.marks);
        redrawInk();
        setHasMarks(marksRef.current.length > 0 || msg.marks.length > 0);
      }
    },
    [redrawInk, redrawLive],
  );

  const peerCount = useRef(0);
  const onPeers = useCallback((n: number) => {
    setOthers(n);
    if (n > peerCount.current) sendRef.current({ t: "snap", marks: marksRef.current });
    peerCount.current = n;
  }, []);

  useEffect(() => {
    const saved = loadLetter();
    marksRef.current = saved.marks;
    setPaper(saved.paper);
    setTurn(saved.turn);
    setStain(saved.stain);
    setHasMarks(saved.marks.length > 0);
    setRoom(deskRoom());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    redrawInk();
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      redrawInk();
      redrawLive();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [ready, redrawInk, redrawLive]);

  useEffect(() => {
    const canvas = liveRef.current;
    if (!canvas || !ready) return;

    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const local = sheetPoint(
        e.clientX,
        e.clientY,
        {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
        },
        turnRef.current,
      );
      return readSample(e, local.x, local.y, performance.now());
    };

    const down = (e: PointerEvent) => {
      if (playingRef.current || liveStroke.current) return;
      if (toolRef.current.hand === "type") {
        const at = point(e);
        caret.current = { x: at.x, y: at.y };
        typeRef.current?.focus();
        return;
      }
      if (e.pointerType === "touch" && toolRef.current.hand !== "finger") {
        const ink = finger.current;
        if (!toolRef.current.stain || !ink || ink.amount < 0.08) {
          setStatus(toolRef.current.stain ? "The finger is clean. Write first." : "Rest your hand. The pencil draws.");
          return;
        }
        e.preventDefault();
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic */
        }
        liveStroke.current = {
          brush: "smudge",
          color: ink.color,
          size: ink.amount,
          eraser: false,
          samples: [point(e)],
        };
        undoneRef.current = [];
        return;
      }
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
      const tool = toolRef.current;
      liveStroke.current = {
        brush: tool.brush,
        color: tool.color,
        size: tool.size,
        eraser: tool.erasing,
        samples: [point(e)],
      };
      undoneRef.current = [];
    };

    const move = (e: PointerEvent) => {
      const live = liveStroke.current;
      if (!live) return;
      if (e.pointerType === "touch" && live.brush !== "smudge" && toolRef.current.hand !== "finger") return;
      e.preventDefault();
      for (const ev of eventsOf(e)) live.samples.push(point(ev));
      redrawLive();
      const now = performance.now();
      if (now - lastCast.current > 48 && live.samples.length >= 2) {
        lastCast.current = now;
        const pts = toPoints(live.samples, live.samples[0]!.t);
        castRef.current({
          t: "live",
          mark: {
            brush: live.brush,
            color: live.color,
            size: live.size,
            eraser: live.eraser,
            az: live.samples[live.samples.length - 1]!.azimuth,
            pts,
          },
        });
      }
    };

    const up = (e: PointerEvent) => {
      const live = liveStroke.current;
      if (!live) return;
      if (e.pointerType !== "touch" || live.brush === "smudge" || toolRef.current.hand === "finger") {
        for (const ev of eventsOf(e)) live.samples.push(point(ev));
      }
      const pts = toPoints(live.samples, live.samples[0]!.t);
      liveStroke.current = null;
      castRef.current({ t: "liveEnd" });
      const liveCanvas = liveRef.current;
      const liveCtx = liveCanvas ? withDpr(liveCanvas) : null;
      liveCtx?.clearRect(0, 0, liveCanvas!.clientWidth, liveCanvas!.clientHeight);
      if (pts.length < 2) return;
      const mark: Mark = {
        brush: live.brush,
        color: live.color,
        size: live.size,
        eraser: live.eraser,
        az: live.samples[live.samples.length - 1]!.azimuth,
        pts,
      };
      marksRef.current.push(mark);
      const ink = inkRef.current;
      const ctx = ink ? withDpr(ink) : null;
      if (ctx) paintMark(ctx, mark, false);
      if (mark.brush === "smudge") {
        const prev = finger.current?.amount ?? mark.size;
        finger.current = { color: mark.color, amount: stainLeft(prev, pathLen(pts)) };
      } else if (!mark.eraser) {
        finger.current = { color: mark.color, amount: 1 };
      }
      sendRef.current({ t: "mark", mark });
      persist();
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [persist, ready, redrawLive]);

  function chooseBrush(next: Brush, label: string) {
    setBrush(next);
    setErasing(false);
    setStatus(label);
    setArmedClear(false);
  }

  function undo() {
    const mark = marksRef.current.pop();
    if (!mark) return;
    undoneRef.current.push(mark);
    redrawInk();
    persist();
    sendRef.current({ t: "snap", marks: marksRef.current });
  }

  function redo() {
    const mark = undoneRef.current.pop();
    if (!mark) return;
    marksRef.current.push(mark);
    redrawInk();
    persist();
    sendRef.current({ t: "snap", marks: marksRef.current });
  }

  function clearLetter() {
    if (!armedClear) {
      setArmedClear(true);
      window.setTimeout(() => setArmedClear(false), 2200);
      return;
    }
    marksRef.current = [];
    undoneRef.current = [];
    finger.current = null;
    setArmedClear(false);
    redrawInk();
    persist();
    sendRef.current({ t: "snap", marks: [] });
  }

  function cyclePaper() {
    const i = PAPERS.indexOf(viewRef.current.paper);
    const next = PAPERS[(i + 1) % PAPERS.length]!;
    setPaper(next);
    viewRef.current = { ...viewRef.current, paper: next };
    persist();
  }

  function rotateSheet() {
    const next = (viewRef.current.turn + 90) % 360;
    setTurn(next);
    viewRef.current = { ...viewRef.current, turn: next };
    persist();
  }

  function toggleStain() {
    const next = !viewRef.current.stain;
    setStain(next);
    viewRef.current = { ...viewRef.current, stain: next };
    setStatus(next ? "A wet finger can stain" : brushName(brush));
    persist();
  }

  function replay() {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      redrawInk();
      return;
    }
    const list = [
      ...marksRef.current,
      ...[...remoteMarks.current.values()].flat(),
    ];
    if (list.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    const durations = list.map((m) => Math.max(320, (m.pts[m.pts.length - 1]?.[3] ?? 0) + 90));
    const total = durations.reduce((a, b) => a + b, 0);
    const t0 = performance.now();
    const step = (now: number) => {
      if (!playingRef.current) return;
      const elapsed = now - t0;
      const canvas = inkRef.current;
      const ctx = canvas ? sizeCanvas(canvas) : null;
      if (elapsed >= total || !ctx || !canvas) {
        playingRef.current = false;
        setPlaying(false);
        redrawInk();
        return;
      }
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      let left = elapsed;
      for (let i = 0; i < list.length; i++) {
        const mark = list[i]!;
        const dur = durations[i]!;
        if (left >= dur) {
          paintMark(ctx, mark, false);
          left -= dur;
        } else if (mark.brush === "text") {
          paintMark(ctx, mark, false);
          break;
        } else {
          const pts = traceAt(mark.pts, left);
          if (pts.length >= 2) paintMark(ctx, { ...mark, pts }, true);
          break;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setHandMode(next: Hand) {
    setHand(next);
    setErasing(false);
    setStatus(next === "finger" ? "Finger draws" : next === "type" ? "Type on the page" : brushName(brush));
    if (next === "type") window.setTimeout(() => typeRef.current?.focus(), 0);
  }

  function commitType() {
    const value = typeRef.current?.value.trim() ?? "";
    const at = caret.current ?? { x: 48, y: 72 };
    if (!value) return;
    const mark: Mark = {
      brush: "text",
      color: toolRef.current.color,
      size: toolRef.current.size,
      eraser: false,
      az: 0,
      text: value,
      pts: [[at.x, at.y, 1, 0]],
    };
    marksRef.current.push(mark);
    undoneRef.current = [];
    const ink = inkRef.current;
    const ctx = ink ? withDpr(ink) : null;
    if (ctx) paintMark(ctx, mark, false);
    sendRef.current({ t: "mark", mark });
    if (typeRef.current) typeRef.current.value = "";
    caret.current = { x: at.x, y: at.y + Math.max(28, toolRef.current.size * 12) };
    persist();
  }

  async function share() {
    const url = joinUrl(window.location.href, room ?? "shared");
    setJoinLink(url);
    setJoinOpen(true);
    try {
      const QR = await import("qrcode");
      setQr(await QR.toDataURL(url, { margin: 1, width: 280, color: { dark: "#20242a", light: "#fbfbfc" } }));
    } catch {
      setQr("");
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* the panel still shows the link */
    }
  }

  function goDesk(name: string) {
    const clean = name.trim().slice(0, 48);
    if (!clean) return;
    const url = new URL(window.location.href);
    url.searchParams.set("desk", clean);
    window.location.assign(url.toString());
  }

  function savePng() {
    const ink = inkRef.current;
    const stage = stageRef.current;
    if (!ink || !stage) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * dpr));
    out.height = Math.max(1, Math.round(h * dpr));
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER_FILL[paper];
    ctx.fillRect(0, 0, w, h);
    const rule = PAPER_RULE[paper];
    if (rule) {
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      for (let y = 32; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y - 0.5);
        ctx.lineTo(w, y - 0.5);
        ctx.stroke();
      }
    }
    ctx.translate(w / 2, h / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(ink, -w / 2, -h / 2, w, h);
    const link = document.createElement("a");
    link.download = `quilled-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
  }

  const italicIcon = (
    <span className="font-display text-lg leading-none italic" aria-hidden>
      I
    </span>
  );

  return (
    <main className="flex h-dvh flex-col bg-quill-desk text-quill-ink">
      {room ? (
        <DeskMesh room={room} sendRef={sendRef} castRef={castRef} onWire={onWire} onPeers={onPeers} />
      ) : null}
      <header className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto px-3">
        <p className="font-display mr-1 shrink-0 text-2xl leading-none text-quill-ink italic">Quilled</p>
        <ToolButton label="Undo" onClick={undo}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label="Redo" onClick={redo}>
          <Redo2 className="size-4" />
        </ToolButton>
        {BRUSHES.map((item) => (
          <ToolButton
            key={item.id}
            label={item.label}
            active={!erasing && brush === item.id}
            onClick={() => chooseBrush(item.id, item.label)}
          >
            {item.id === "italic" ? italicIcon : <item.Icon className="size-4" />}
            <span className="hidden sm:inline">{item.label}</span>
          </ToolButton>
        ))}
        <ToolButton
          label="Eraser"
          active={erasing}
          onClick={() => {
            setErasing((v) => !v);
            setStatus(erasing ? brushName(brush) : "Eraser");
          }}
        >
          <Eraser className="size-4" />
        </ToolButton>
        <ToolButton label={playing ? "Stop replay" : "Replay"} active={playing} onClick={replay}>
          {playing ? <Square className="size-4" /> : <Play className="size-4" />}
        </ToolButton>
        <ToolButton label="Turn the page" onClick={rotateSheet}>
          <RotateCw className="size-4" />
        </ToolButton>
        <ToolButton label={armedClear ? "Clear the letter" : "Clear"} onClick={clearLetter}>
          <Trash2 className="size-4" />
        </ToolButton>
        <ToolButton label="Save PNG" onClick={savePng}>
          <Download className="size-4" />
        </ToolButton>
        <ToolButton label="Invite someone" onClick={() => void share()}>
          <Link2 className="size-4" />
        </ToolButton>
        <span className="ml-auto shrink-0 pr-1 text-sm text-quill-ink/70">
          {others > 0 ? `${others} here` : status}
        </span>
      </header>

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ transform: turn ? `rotate(${turn}deg)` : undefined }}
        >
          <div className={cn("pointer-events-none absolute inset-0", `quill-sheet-${paper}`)} />
          <canvas ref={inkRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <canvas ref={liveRef} className="absolute inset-0 h-full w-full touch-none" />
        </div>
        {!hasMarks ? (
          <p
            className={cn(
              "pointer-events-none absolute top-8 right-0 left-0 text-center font-display text-xl italic",
              paper === "dusk" ? "text-quill-ink/45" : "text-quill-desk/35",
            )}
          >
            {stain
              ? "Write, then a wet finger can stain."
              : hand === "finger"
                ? "A finger draws."
                : hand === "type"
                  ? "Tap the page, then type."
                  : "The pencil writes. A finger rests."}
          </p>
        ) : null}

        <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 overflow-x-auto rounded-xl bg-quill-desk/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {INKS.map((ink) => (
            <button
              key={ink.id}
              type="button"
              aria-label={ink.name}
              aria-pressed={color === ink.color}
              onClick={() => setColor(ink.color)}
              className={cn(
                "size-8 shrink-0 rounded-full border-2",
                color === ink.color ? "border-quill-ink" : "border-transparent",
              )}
              style={{ background: ink.color }}
            />
          ))}
          <label className="flex shrink-0 items-center gap-2 text-sm text-quill-ink">
            Size
            <input
              aria-label="Nib size"
              type="range"
              min={0.5}
              max={6}
              step={0.1}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 accent-quill-active"
            />
          </label>
          <ToolButton label={`Paper: ${paper}`} active={paper !== "blank"} onClick={cyclePaper}>
            {paper === "lined" ? "Lined" : paper === "blank" ? "Blank" : paper === "cream" ? "Cream" : "Dusk"}
          </ToolButton>
          <ToolButton label="Hand" active={hand === "hand"} onClick={() => setHandMode("hand")}>
            Hand
          </ToolButton>
          <ToolButton label="Finger" active={hand === "finger"} onClick={() => setHandMode("finger")}>
            Finger
          </ToolButton>
          <ToolButton label="Type" active={hand === "type"} onClick={() => setHandMode("type")}>
            Type
          </ToolButton>
          <ToolButton label="Finger stain" active={stain} onClick={toggleStain}>
            Stain
          </ToolButton>
          {hand === "type" ? (
            <input
              ref={typeRef}
              aria-label="Type on the page"
              placeholder="Type, then return"
              enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitType();
                }
              }}
              className="h-11 w-36 shrink-0 rounded-lg bg-quill-bar px-3 text-sm text-quill-ink placeholder:text-quill-ink/50"
            />
          ) : null}
        </div>
        {joinOpen ? (
          <div
            className="absolute inset-0 z-20 flex items-end justify-center bg-quill-desk/80 p-4 sm:items-center"
            onClick={() => setJoinOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl bg-quill-bar p-4 text-quill-ink"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-display text-3xl leading-none italic">Join this desk</p>
              <p className="mt-2 text-sm text-quill-ink/70">Scan the code, or type the desk name.</p>
              {qr ? (
                <img src={qr} alt="QR code to join this desk" className="mt-4 h-56 w-56 rounded-lg bg-quill-paper p-2" />
              ) : null}
              <p className="mt-3 break-all text-sm">{joinLink}</p>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  goDesk(String(data.get("desk") ?? ""));
                }}
              >
                <input
                  name="desk"
                  aria-label="Desk name"
                  placeholder="Desk name"
                  className="h-11 min-w-0 flex-1 rounded-lg bg-quill-desk px-3 text-sm text-quill-ink"
                />
                <button type="submit" className="h-11 shrink-0 rounded-lg bg-quill-active px-4 text-sm text-quill-ink">
                  Join
                </button>
              </form>
              <button type="button" className="mt-3 h-11 text-sm text-quill-ink/70" onClick={() => setJoinOpen(false)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function DeskMesh({
  room,
  sendRef,
  castRef,
  onWire,
  onPeers,
}: {
  room: string;
  sendRef: MutableRefObject<(data: unknown) => void>;
  castRef: MutableRefObject<(data: unknown) => void>;
  onWire: (from: string, data: unknown) => void;
  onPeers: (n: number) => void;
}) {
  const p2p = useP2PRoom({ room, name: "quilled" });
  sendRef.current = (data) => p2p.send(data);
  castRef.current = (data) => p2p.broadcast(data);
  useEffect(() => p2p.onMessage(onWire), [onWire, p2p.onMessage]);
  useEffect(() => {
    onPeers(p2p.peers.length);
  }, [onPeers, p2p.peers.length]);
  return null;
}

function brushName(brush: Brush) {
  if (brush === "fountain") return "Fountain";
  if (brush === "italic") return "Italic";
  if (brush === "smudge") return "Stain";
  if (brush === "text") return "Type";
  return "Pencil";
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-quill-bar px-3 text-sm text-quill-ink",
        active && "bg-quill-active",
      )}
    >
      {children}
    </button>
  );
}
