import React from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/brand/Logo";

/** Split auth layout: form on the left, brand panel with an illustrative product glimpse on the right. */
export const AuthLayout: React.FC<{ title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }> = ({ title, subtitle, children, footer }) => (
  <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <div className="flex flex-col px-6 py-6 sm:px-10">
      <Link to="/" className="self-start" aria-label="VizIntel home">
        <Logo />
      </Link>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{subtitle}</p>
        <div className="mt-8">{children}</div>
        <div className="mt-8 text-sm text-ink-2">{footer}</div>
      </div>
      <p className="text-xs text-ink-3">© {new Date().getFullYear()} VizIntel</p>
    </div>

    <div className="relative hidden overflow-hidden bg-[#0b0d12] lg:block" aria-hidden="true">
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
      <div className="absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full bg-[#3d5afe] opacity-25 blur-[120px]" />
      <div className="absolute -bottom-40 left-10 h-[360px] w-[360px] rounded-full bg-[#c6f24e] opacity-[0.12] blur-[120px]" />
      <div className="relative flex h-full flex-col justify-between p-12 text-white">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">AI-first analytics</p>
        <div>
          <p className="max-w-md text-[44px] leading-[1.05] tracking-tight">
            Ask your spreadsheets <span className="font-display italic text-[#c6f24e]">anything.</span>
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/60">
            Upload a file. Get KPIs, trends, anomalies and a written narrative — then build the dashboard your team actually reads.
          </p>
        </div>
        {/* Illustrative glimpse of the product (not live data) */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[13px] font-medium text-white/80">Signals detected</span>
            <span className="rounded-md bg-[#c6f24e] px-1.5 py-0.5 text-[10px] font-semibold text-[#1d2a00]">AI</span>
          </div>
          <svg viewBox="0 0 360 90" className="h-24 w-full">
            <defs>
              <linearGradient id="authg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#5b76ff" stopOpacity="0.45" />
                <stop offset="1" stopColor="#5b76ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 70 C40 66 60 58 90 60 S150 40 180 44 S240 22 270 30 S330 10 360 12 L360 90 L0 90Z" fill="url(#authg)" />
            <path d="M0 70 C40 66 60 58 90 60 S150 40 180 44 S240 22 270 30 S330 10 360 12" fill="none" stroke="#5b76ff" strokeWidth="2" />
            <circle cx="270" cy="30" r="5" fill="none" stroke="#c6f24e" strokeWidth="2" />
          </svg>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            {["Trend ↑ detected", "1 anomaly flagged", "r = 0.91 correlation"].map((t) => (
              <span key={t} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-white/70">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);
