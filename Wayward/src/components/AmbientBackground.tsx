import { useEffect, useRef, memo } from "react";

interface AmbientBackgroundProps {
  accent1: string;
  accent2: string;
  idle: boolean;
  hidden: boolean;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  const n = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/**
 * Renders a single static canvas with soft radial gradients derived from the
 * current accent colours. Re-paints only when accents change (i.e. on track
 * change). Total GPU cost between paints: effectively zero — it's just a
 * raster bitmap sitting in a layer.
 *
 * A subtle CSS `translate` drift animation is applied to the wrapper for gentle
 * movement at near-zero GPU cost (single-layer transform, no blur/blend).
 */
function AmbientBackground({ accent1, accent2, idle, hidden }: AmbientBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevKeyRef = useRef<string>("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // De-duplicate paints for the same input.
    const key = `${accent1}|${accent2}|${idle}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Use a fixed internal resolution — the CSS sizes it to fill the viewport.
    // 256×256 is more than enough for a blurred gradient background and keeps
    // the paint extremely cheap (~1-2ms).
    const W = 256;
    const H = 256;
    canvas.width = W;
    canvas.height = H;

    const c1 = hexToRgb(accent1);
    const c2 = hexToRgb(accent2);
    const dark: RGB = { r: 10, g: 12, b: 18 };

    // Base fill — very dark, tinted slightly towards the accent.
    const base = idle ? dark : mixRgb(dark, c1, 0.08);
    ctx.fillStyle = `rgb(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)})`;
    ctx.fillRect(0, 0, W, H);

    // We draw several soft radial gradients. Because canvas radialGradient is
    // resolution-independent and GPU-rasterized during drawImage, this is very
    // fast and produces smooth colour fields identical to the old CSS blobs.

    const opacity = idle ? 0.35 : 0.75;

    // Blob 1: accent1, top-left quadrant
    const g1 = ctx.createRadialGradient(W * 0.22, H * 0.18, 0, W * 0.22, H * 0.18, W * 0.7);
    g1.addColorStop(0, `rgba(${Math.round(c1.r)},${Math.round(c1.g)},${Math.round(c1.b)},${opacity})`);
    g1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    // Blob 2: accent2, bottom-right quadrant
    const g2 = ctx.createRadialGradient(W * 0.78, H * 0.82, 0, W * 0.78, H * 0.82, W * 0.65);
    g2.addColorStop(0, `rgba(${Math.round(c2.r)},${Math.round(c2.g)},${Math.round(c2.b)},${opacity})`);
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    // Blob 3: blend of both, centre — adds depth
    const mid = mixRgb(c1, c2, 0.5);
    const g3 = ctx.createRadialGradient(W * 0.5, H * 0.48, 0, W * 0.5, H * 0.48, W * 0.55);
    g3.addColorStop(0, `rgba(${Math.round(mid.r)},${Math.round(mid.g)},${Math.round(mid.b)},${opacity * 0.5})`);
    g3.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, W, H);

    // Blob 4: subtle accent1 wash, bottom-left — prevents the corner from
    // going fully dark and adds asymmetry.
    const g4 = ctx.createRadialGradient(W * 0.15, H * 0.75, 0, W * 0.15, H * 0.75, W * 0.5);
    g4.addColorStop(0, `rgba(${Math.round(c1.r)},${Math.round(c1.g)},${Math.round(c1.b)},${opacity * 0.3})`);
    g4.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g4;
    ctx.fillRect(0, 0, W, H);

  }, [accent1, accent2, idle]);

  return (
    <div
      className={`ambient-background ${hidden ? "ambient-paused" : ""}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="ambient-canvas"
      />
    </div>
  );
}

export default memo(AmbientBackground);
