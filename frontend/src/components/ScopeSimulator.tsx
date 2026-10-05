import { useEffect, useRef } from "react";
import type { ScopeSettings } from "../types";

export const SIGNAL = { freqHz: 1000, vpp: 2.0 }; // 1 kHz, 2 Vpp sine (±1 V)
export const VDIV_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
export const SDIV_STEPS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2];

export const DEFAULT_SETTINGS: ScopeSettings = {
  vdiv: 0.5,
  sdiv: 0.0005,
  trigEnabled: false,
  trigLevel: 0.4,
  edge: "rise",
  running: true,
};

export function formatVdiv(v: number): string {
  return v >= 1 ? `${v} V/div` : `${Math.round(v * 1000)} mV/div`;
}

export function formatSdiv(s: number): string {
  return s >= 1e-3 ? `${s * 1000} ms/div` : `${s * 1e6} µs/div`;
}

/** Signal amplitude (peak volts) of the simulated source. */
export const PEAK_V = SIGNAL.vpp / 2;

interface Props {
  settings: ScopeSettings;
  width?: number;
  height?: number;
}

/**
 * Canvas oscilloscope: 10 x 8 division graticule, 1 kHz sine source.
 * Stability model: with the trigger enabled and the level crossing the chosen
 * edge of the sine, the trace locks; otherwise it free-runs (drifts sideways).
 */
export default function ScopeSimulator({ settings, width = 760, height = 420 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const isStable = (s: ScopeSettings): boolean => {
      if (!s.trigEnabled) return false;
      const lvl = s.trigLevel;
      if (lvl <= -PEAK_V || lvl >= PEAK_V) return false; // no crossing exists
      return true;
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = settingsRef.current;

      // background
      ctx.fillStyle = "#0b1512";
      ctx.fillRect(0, 0, width, height);

      const divW = width / 10;
      const divH = height / 8;
      const cx = width / 2;
      const cy = height / 2;

      // graticule
      ctx.strokeStyle = "#1d3a30";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        ctx.moveTo(i * divW, 0);
        ctx.lineTo(i * divW, height);
      }
      for (let j = 0; j <= 8; j++) {
        ctx.moveTo(0, j * divH);
        ctx.lineTo(width, j * divH);
      }
      ctx.stroke();
      // center crosshair
      ctx.strokeStyle = "#2c5949";
      ctx.beginPath();
      for (let i = 0; i <= 10; i += 1) {
        for (let tick = -2; tick <= 2; tick++) {
          if (tick === 0) continue;
          ctx.moveTo(i * divW + (divW / 10) * tick, cy - 4);
          ctx.lineTo(i * divW + (divW / 10) * tick, cy + 4);
        }
      }
      for (let j = 0; j <= 8; j += 1) {
        for (let tick = -2; tick <= 2; tick++) {
          if (tick === 0) continue;
          ctx.moveTo(cx - 4, j * divH + (divH / 8) * tick);
          ctx.lineTo(cx + 4, j * divH + (divH / 8) * tick);
        }
      }
      ctx.stroke();

      const stable = isStable(s);
      if (s.running && !stable) {
        driftRef.current += divW * 0.9;
        if (driftRef.current > 1e9) driftRef.current = 0;
      }
      const windowT = 10 * s.sdiv;

      // time origin: locked to a rising-edge crossing near 15% of the window
      let t0: number;
      if (stable) {
        const phase = Math.asin(Math.max(-1, Math.min(1, s.trigLevel / PEAK_V)));
        const tCross = (s.edge === "rise" ? phase : Math.PI - phase) / (2 * Math.PI * SIGNAL.freqHz);
        t0 = tCross - 0.15 * windowT;
      } else {
        t0 = driftRef.current / 1000;
      }

      // waveform
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#4ade8055";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      const N = 700;
      for (let i = 0; i <= N; i++) {
        const t = t0 + (i / N) * windowT;
        const v = PEAK_V * Math.sin(2 * Math.PI * SIGNAL.freqHz * t);
        const y = cy - (v / s.vdiv) * divH;
        const x = (i / N) * width;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // trigger level line
      if (s.trigEnabled) {
        const ty = cy - (s.trigLevel / s.vdiv) * divH;
        const onSlope = s.trigLevel > -PEAK_V && s.trigLevel < PEAK_V;
        ctx.strokeStyle = onSlope ? "#fbbf24" : "#f87171";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(width, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = onSlope ? "#fbbf24" : "#f87171";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText(
          onSlope ? `trigger ${s.trigLevel.toFixed(2)} V (${s.edge})` : `trigger ${s.trigLevel.toFixed(2)} V — no crossing!`,
          8,
          ty - 6,
        );
      }

      // status readout
      ctx.font = "12px ui-monospace, monospace";
      if (!s.running) {
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("STOPPED", width - 74, 18);
      } else if (stable) {
        ctx.fillStyle = "#4ade80";
        ctx.fillText("TRIGGERED — LOCKED", width - 178, 18);
      } else {
        ctx.fillStyle = "#f87171";
        ctx.fillText("FREE-RUN — DRIFTING", width - 168, 18);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 10, display: "block" }} />;
}
