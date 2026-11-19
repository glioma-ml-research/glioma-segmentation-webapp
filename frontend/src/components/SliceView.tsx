import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { inBounds, roundToIndex, voxelOffset, voxelToWorld, worldToVoxel, type Vec3 } from "../lib/geometry";
import type { LabelInfo } from "../lib/types";
import { lookupWorld, type VolumeSet } from "../lib/volumes";
import { useViewerStore } from "../state/viewerStore";
import { HoverTip, MaximizeButton, type Tip } from "./ViewChrome";

export type Plane = "axial" | "coronal" | "sagittal";

/**
 * Slices are taken along the voxel axes of the viewer grid, which the backend
 * has reoriented to RAS (i → Right, j → Anterior, k → Superior). Displayed in
 * radiological convention: patient right on screen left.
 */
const PLANES: Record<Plane, { fixed: 0 | 1 | 2; h: 0 | 1 | 2; v: 0 | 1 | 2; edges: [string, string, string, string]; title: string }> = {
  //                                         left, right, top, bottom
  axial: { fixed: 2, h: 0, v: 1, edges: ["R", "L", "A", "P"], title: "Axial" },
  coronal: { fixed: 1, h: 0, v: 2, edges: ["R", "L", "S", "I"], title: "Coronal" },
  sagittal: { fixed: 0, h: 1, v: 2, edges: ["A", "P", "S", "I"], title: "Sagittal" },
};

const MAX_ZOOM = 12;
const TAP_SLOP = 6; // px a finger may move and still count as a tap
const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100];

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

interface View {
  zoom: number;
  /** Offset of the image centre from the panel centre, CSS px. */
  x: number;
  y: number;
}

type Gesture =
  | { kind: "crosshair" }
  | { kind: "window"; x: number; y: number; low: number; high: number }
  | { kind: "pan"; x: number; y: number; start: View; moved: boolean; tap: boolean }
  | { kind: "pinch"; distance: number; mid: { x: number; y: number }; start: View };

interface Props {
  plane: Plane;
  volumes: VolumeSet;
  labelMap: LabelInfo[];
  /** Extra buttons for the view's title bar, before the enlarge button. */
  actions?: ReactNode;
}

export function SliceView({ plane, volumes, labelMap, actions }: Props) {
  const config = PLANES[plane];
  const header = volumes.labels.header;
  const shape = header.shape;
  const nh = shape[config.h];
  const nv = shape[config.v];

  const crosshair = useViewerStore((state) => state.crosshair);
  const base = useViewerStore((state) => state.base);
  const range = useViewerStore((state) => state.windows[base]);
  const overlayOpacity = useViewerStore((state) => state.overlayOpacity);
  const overlayStyle = useViewerStore((state) => state.overlayStyle);
  const showUncertain = useViewerStore((state) => state.showUncertain);
  const uncertainBelow = useViewerStore((state) => state.uncertainBelow);
  const layers = useViewerStore((state) => state.labels);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 300, height: 300 });
  const [tip, setTip] = useState<Tip | null>(null);
  const [view, setViewState] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [panning, setPanning] = useState(false);

  // Crosshair in continuous voxel coordinates; the slice shown is the one containing it.
  const crossVoxel: Vec3 = useMemo(
    () => (crosshair ? worldToVoxel(crosshair, header.inverse_affine) : [shape[0] / 2, shape[1] / 2, shape[2] / 2]),
    [crosshair, header, shape],
  );
  const slice = Math.min(shape[config.fixed] - 1, Math.max(0, roundToIndex(crossVoxel)[config.fixed]));

  const palette = useMemo(() => {
    const colours: Record<number, [number, number, number]> = {};
    for (const label of labelMap) colours[label.value] = hexToRgb(label.color);
    return colours;
  }, [labelMap]);

  // Offscreen bitmaps at native voxel resolution (one pixel per voxel): the image with its
  // overlay, and, when asked for, a mask of the voxels where the model was unsure.
  const { bitmap, uncertainMask } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = nh;
    canvas.height = nv;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(nh, nv);
    const volume = volumes[base];
    const { scl_slope: slope, scl_inter: inter } = volume.header;
    const span = Math.max(1e-9, range.high - range.low);
    const labels = volumes.labels.data;
    const stride = [1, shape[0], shape[0] * shape[1]];
    const strideH = stride[config.h];
    const strideV = stride[config.v];
    const fillAlpha = overlayStyle === "outline" ? 0 : overlayOpacity;
    const edgeAlpha = overlayStyle === "fill" ? overlayOpacity : Math.min(1, overlayOpacity * 2);
    const visible = (value: number) => value !== 0 && layers[value]?.visible === true;

    const confidence = showUncertain ? volumes.confidence : null;
    const mask = confidence ? context.createImageData(nh, nv) : null;
    const confSlope = confidence?.header.scl_slope ?? 1;
    const confInter = confidence?.header.scl_inter ?? 0;

    const ijk: Vec3 = [0, 0, 0];
    ijk[config.fixed] = slice;
    for (let py = 0; py < nv; py++) {
      const vi = nv - 1 - py; // S or A at the top
      ijk[config.v] = vi;
      for (let px = 0; px < nh; px++) {
        const hi = nh - 1 - px; // R (axial/coronal) or A (sagittal) on the left
        ijk[config.h] = hi;
        const offset = voxelOffset(ijk, shape);
        const value = volume.data[offset] * slope + inter;
        let grey = Math.round(((value - range.low) / span) * 255);
        grey = grey < 0 ? 0 : grey > 255 ? 255 : grey;
        let r = grey, g = grey, b = grey;
        const label = labels[offset];
        if (visible(label) && overlayOpacity > 0) {
          const colour = palette[label];
          if (colour) {
            // A voxel is on the outline when an in-plane neighbour is something else.
            const edge =
              (hi > 0 && labels[offset - strideH] !== label) ||
              (hi < nh - 1 && labels[offset + strideH] !== label) ||
              (vi > 0 && labels[offset - strideV] !== label) ||
              (vi < nv - 1 && labels[offset + strideV] !== label);
            const alpha = edge ? edgeAlpha : fillAlpha;
            if (alpha > 0) {
              r = Math.round(r + (colour[0] - r) * alpha);
              g = Math.round(g + (colour[1] - g) * alpha);
              b = Math.round(b + (colour[2] - b) * alpha);
            }
          }
        }
        const target = 4 * (py * nh + px);
        image.data[target] = r;
        image.data[target + 1] = g;
        image.data[target + 2] = b;
        image.data[target + 3] = 255;
        if (mask && confidence && confidence.data[offset] * confSlope + confInter < uncertainBelow) mask.data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    let maskCanvas: HTMLCanvasElement | null = null;
    if (mask) {
      maskCanvas = document.createElement("canvas");
      maskCanvas.width = nh;
      maskCanvas.height = nv;
      maskCanvas.getContext("2d")!.putImageData(mask, 0, 0);
    }
    return { bitmap: canvas, uncertainMask: maskCanvas };
  }, [volumes, base, range, overlayOpacity, overlayStyle, showUncertain, uncertainBelow, layers, palette, slice, config, nh, nv, shape]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The slice fitted in the panel with the true physical aspect ratio (mm, not voxels).
  const fit = useMemo(() => {
    const physicalWidth = nh * header.spacing_mm[config.h];
    const physicalHeight = nv * header.spacing_mm[config.v];
    const scale = Math.min(box.width / physicalWidth, box.height / physicalHeight);
    return { width: Math.max(1, physicalWidth * scale), height: Math.max(1, physicalHeight * scale), physicalWidth };
  }, [box, nh, nv, header, config]);

  /** Keep the image covering the panel when zoomed in; centred when it fits. */
  const clampView = useCallback(
    (next: View): View => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const spareX = Math.max(0, (fit.width * zoom - box.width) / 2);
      const spareY = Math.max(0, (fit.height * zoom - box.height) / 2);
      return { zoom, x: Math.min(spareX, Math.max(-spareX, next.x)), y: Math.min(spareY, Math.max(-spareY, next.y)) };
    },
    [fit, box],
  );
  const setView = useCallback(
    (next: View) => {
      const clamped = clampView(next);
      viewRef.current = clamped;
      setViewState(clamped);
    },
    [clampView],
  );
  // A resized panel can leave the old offset out of range.
  useEffect(() => setView(viewRef.current), [setView]);

  const layout = useMemo(() => {
    const width = fit.width * view.zoom;
    const height = fit.height * view.zoom;
    return { width, height, left: (box.width - width) / 2 + view.x, top: (box.height - height) / 2 + view.y };
  }, [fit, view, box]);

  /** Zoom so that the image point under (cx, cy) stays under it. */
  const zoomAt = useCallback(
    (zoom: number, cx: number, cy: number, from: View = viewRef.current) => {
      const width = fit.width * from.zoom;
      const height = fit.height * from.zoom;
      const left = (box.width - width) / 2 + from.x;
      const top = (box.height - height) / 2 + from.y;
      const fx = (cx - left) / width;
      const fy = (cy - top) / height;
      const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const nextWidth = fit.width * z;
      const nextHeight = fit.height * z;
      setView({ zoom: z, x: cx - fx * nextWidth - (box.width - nextWidth) / 2, y: cy - fy * nextHeight - (box.height - nextHeight) / 2 });
    },
    [fit, box, setView],
  );

  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    // A view hidden by another one being enlarged has no size: nothing to draw.
    if (canvas.width < 1 || canvas.height < 1 || layout.width < 1 || layout.height < 1) return;
    const context = canvas.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#000";
    context.fillRect(0, 0, box.width, box.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, layout.left, layout.top, layout.width, layout.height);

    // Uncertain voxels: the mask, scaled like the image, drawn as one plain highlight.
    if (uncertainMask) {
      scratchRef.current ??= document.createElement("canvas");
      const scratch = scratchRef.current;
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const pen = scratch.getContext("2d")!;
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      pen.imageSmoothingEnabled = false;
      pen.drawImage(uncertainMask, layout.left, layout.top, layout.width, layout.height);
      pen.globalCompositeOperation = "source-in";
      pen.fillStyle = "rgba(255, 255, 255, 0.72)";
      pen.fillRect(0, 0, box.width, box.height);
      pen.globalCompositeOperation = "source-over";
      context.drawImage(scratch, 0, 0, box.width, box.height);
    }

    // The part of the image that is on screen (all of it unless zoomed in).
    const visLeft = Math.max(0, layout.left);
    const visRight = Math.min(box.width, layout.left + layout.width);
    const visTop = Math.max(0, layout.top);
    const visBottom = Math.min(box.height, layout.top + layout.height);

    // Crosshair: same world point as every other view.
    const px = (nh - 1 - crossVoxel[config.h] + 0.5) / nh;
    const py = (nv - 1 - crossVoxel[config.v] + 0.5) / nv;
    if (crosshair && px >= 0 && px <= 1 && py >= 0 && py <= 1) {
      const x = layout.left + px * layout.width;
      const y = layout.top + py * layout.height;
      context.strokeStyle = "rgba(0, 200, 224, 0.85)";
      context.lineWidth = 1;
      const gap = 6;
      context.beginPath();
      context.moveTo(visLeft, y); context.lineTo(x - gap, y);
      context.moveTo(x + gap, y); context.lineTo(visRight, y);
      context.moveTo(x, visTop); context.lineTo(x, y - gap);
      context.moveTo(x, y + gap); context.lineTo(x, visBottom);
      context.stroke();
    }

    // Orientation letters at the edges of what is visible.
    context.fillStyle = "rgba(255,255,255,0.82)";
    context.font = "600 11px 'Inter Variable', system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const [left, right, top, bottom] = config.edges;
    const midX = (visLeft + visRight) / 2;
    const midY = (visTop + visBottom) / 2;
    context.fillText(left, visLeft + 10, midY);
    context.fillText(right, visRight - 10, midY);
    context.fillText(top, midX, visTop + 10 + (layout.top < 40 ? 30 : 0));
    context.fillText(bottom, midX, visBottom - 10);

    // Scale bar, bottom left: a round number of millimetres.
    const mmPerPx = fit.physicalWidth / layout.width;
    const length = [...SCALE_STEPS].reverse().find((mm) => mm / mmPerPx <= Math.min(110, box.width * 0.3)) ?? 1;
    const barPx = length / mmPerPx;
    if (barPx >= 24 && box.width > 160) {
      const x0 = 12;
      const y0 = box.height - 12;
      for (const [colour, width] of [["rgba(0,0,0,0.6)", 3], ["rgba(255,255,255,0.88)", 1]] as const) {
        context.strokeStyle = colour;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(x0, y0 - 4); context.lineTo(x0, y0); context.lineTo(x0 + barPx, y0); context.lineTo(x0 + barPx, y0 - 4);
        context.stroke();
      }
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = "rgba(255,255,255,0.88)";
      context.fillText(`${length} mm`, x0 + barPx + 6, y0);
    }
  }, [bitmap, uncertainMask, layout, box, crossVoxel, crosshair, config, nh, nv, fit]);

  /** Pointer position → world mm, through the affine. */
  const eventToWorld = useCallback(
    (event: { clientX: number; clientY: number }): Vec3 | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const fx = (event.clientX - rect.left - layout.left) / layout.width;
      const fy = (event.clientY - rect.top - layout.top) / layout.height;
      if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
      const ijk: Vec3 = [0, 0, 0];
      ijk[config.fixed] = slice;
      ijk[config.h] = nh - 1 - (fx * nh - 0.5);
      ijk[config.v] = nv - 1 - (fy * nv - 0.5);
      return voxelToWorld(ijk, header.affine);
    },
    [layout, config, slice, nh, nv, header],
  );

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const moveCrosshair = (event: { clientX: number; clientY: number }) => {
    const world = eventToWorld(event);
    if (!world) return;
    const store = useViewerStore.getState();
    store.setCrosshair(world);
    store.setPicked(lookupWorld(world, volumes, "2d"));
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      kind: "pinch",
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      start: viewRef.current,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    setTip(null);
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const zoomed = viewRef.current.zoom > 1.01;
    if (event.pointerType === "mouse") {
      if (event.button === 2) {
        gesture.current = { kind: "window", x: event.clientX, y: event.clientY, low: range.low, high: range.high };
      } else if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
        event.preventDefault();
        gesture.current = { kind: "pan", x: event.clientX, y: event.clientY, start: viewRef.current, moved: false, tap: false };
        setPanning(true);
      } else if (event.button === 0) {
        gesture.current = { kind: "crosshair" };
        moveCrosshair(event);
      }
      return;
    }
    // Touch and pen: zoomed in, a finger pans and a tap places the crosshair; at full view it places it straight away.
    if (zoomed) {
      gesture.current = { kind: "pan", x: event.clientX, y: event.clientY, start: viewRef.current, moved: false, tap: true };
    } else {
      gesture.current = { kind: "crosshair" };
      moveCrosshair(event);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, local(event));
    const current = gesture.current;
    if (current?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Zoom about where the pinch started, then follow the fingers as they move together.
      const start = current.start;
      const width = fit.width * start.zoom;
      const height = fit.height * start.zoom;
      const fx = (current.mid.x - ((box.width - width) / 2 + start.x)) / width;
      const fy = (current.mid.y - ((box.height - height) / 2 + start.y)) / height;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, (start.zoom * distance) / current.distance));
      const nextWidth = fit.width * zoom;
      const nextHeight = fit.height * zoom;
      setView({ zoom, x: mid.x - fx * nextWidth - (box.width - nextWidth) / 2, y: mid.y - fy * nextHeight - (box.height - nextHeight) / 2 });
      return;
    }
    if (current?.kind === "window") {
      // Right-drag: horizontal = window width, vertical = level.
      const full = (volumes[base].header.display_range?.[1] ?? 1) - (volumes[base].header.display_range?.[0] ?? 0);
      const width = Math.max(full * 0.01, current.high - current.low + ((event.clientX - current.x) / 300) * full);
      const centre = (current.high + current.low) / 2 - ((event.clientY - current.y) / 300) * full;
      useViewerStore.getState().setWindow(base, centre - width / 2, centre + width / 2);
      return;
    }
    if (current?.kind === "pan") {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      if (!current.moved) setPanning(true);
      current.moved = true;
      setView({ zoom: current.start.zoom, x: current.start.x + dx, y: current.start.y + dy });
      return;
    }
    if (current?.kind === "crosshair") {
      moveCrosshair(event);
      return;
    }
    if (event.pointerType !== "mouse") return;
    const world = eventToWorld(event);
    const info = world ? lookupWorld(world, volumes, "2d") : null;
    useViewerStore.getState().setHover(info);
    const position = local(event);
    setTip(info ? { x: position.x, y: position.y, info } : null);
  };

  const onPointerEnd = (event: React.PointerEvent) => {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (current?.kind === "pan" && current.tap && !current.moved && event.type === "pointerup") moveCrosshair(event);
    if (current?.kind === "pinch" && pointers.current.size === 1) {
      // One finger stays down: carry on as a pan from where the pinch left the image.
      const [rest] = [...pointers.current.values()];
      const rect = canvasRef.current!.getBoundingClientRect();
      gesture.current = { kind: "pan", x: rest.x + rect.left, y: rest.y + rect.top, start: viewRef.current, moved: true, tap: false };
      return;
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setPanning(false);
    }
  };

  // Scroll: move the shared crosshair one voxel along this view's normal.
  const step = useCallback(
    (delta: number) => {
      const next: Vec3 = [crossVoxel[0], crossVoxel[1], crossVoxel[2]];
      next[config.fixed] = Math.min(shape[config.fixed] - 1, Math.max(0, slice + delta));
      if (!inBounds(roundToIndex(next), shape)) return;
      useViewerStore.getState().setCrosshair(voxelToWorld(next, header.affine));
    },
    [crossVoxel, config, shape, slice, header],
  );

  // Wheel scrolls through slices; with Ctrl/⌘ (and trackpad pinch, which arrives as Ctrl+wheel) it zooms at the cursor.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAt(viewRef.current.zoom * Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      step(event.deltaY > 0 ? -1 : 1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [step, zoomAt]);

  const zoomed = view.zoom > 1.01;
  const zoomBy = (factor: number) => zoomAt(viewRef.current.zoom * factor, box.width / 2, box.height / 2);

  return (
    <div className="slice-view">
      <div className="slice-title">
        <span>{config.title}</span>
        <span className="slice-index">
          <span>
            {slice + 1} / {shape[config.fixed]}
          </span>
          {zoomed && (
            <>
              <span className="zoom-badge" aria-live="polite">
                {view.zoom.toFixed(1)}×
              </span>
              <button className="icon-button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} title="Fit the whole slice" aria-label="Fit the whole slice">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M6 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </>
          )}
          <button className="icon-button" onClick={() => zoomBy(1.6)} disabled={view.zoom >= MAX_ZOOM} title="Zoom in (or pinch, or Ctrl/⌘ + scroll)" aria-label="Zoom in">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14M5 7h4M7 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {actions}
          <MaximizeButton view={plane} />
        </span>
      </div>
      <div className={`slice-canvas${panning ? " is-panning" : ""}`} ref={containerRef}>
        <canvas
          ref={canvasRef}
          // Full view: vertical swipes scroll the page. Zoomed in: the finger moves the image.
          style={{ width: box.width, height: box.height, touchAction: zoomed ? "none" : "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={() => {
            useViewerStore.getState().setHover(null);
            setTip(null);
          }}
          onDoubleClick={() => useViewerStore.getState().toggleMaximized(plane)}
          onContextMenu={(event) => event.preventDefault()}
          onAuxClick={(event) => event.preventDefault()}
          onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        />
        <HoverTip tip={tip} width={box.width} height={box.height} labelMap={labelMap} />
      </div>
      <input
        className="slice-slider"
        type="range"
        min={0}
        max={shape[config.fixed] - 1}
        value={slice}
        onChange={(event) => step(Number(event.target.value) - slice)}
        aria-label={`${config.title} slice`}
      />
    </div>
  );
}
