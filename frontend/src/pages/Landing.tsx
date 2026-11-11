import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChartColumn,
  ChartScatter,
  CloudUpload,
  Command,
  Database,
  FileText,
  LayoutDashboard,
  MousePointerClick,
  Share2,
  Sparkles,
  Table2,
  Workflow,
  Zap,
} from "lucide-react";
import { useAuth } from "../context/Auth";
import { Logo } from "../components/brand/Logo";
import { ButtonLink } from "../components/ui/Button";

/** Illustrative product shot (decorative SVG/HTML, not live data). */
const ProductShot: React.FC = () => (
  <div className="relative mx-auto mt-16 max-w-5xl" aria-hidden="true">
    <div className="absolute -inset-x-10 -top-10 bottom-0 rounded-[40px] bg-gradient-to-b from-brand/20 via-brand/5 to-transparent blur-2xl" />
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 rounded-md bg-surface px-2.5 py-0.5 font-mono text-[11px] text-ink-3">vizintel / insights / quarterly-sales.xlsx</span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_1fr]">
        {[
          ["Revenue", "4.82M", "+12.4%"],
          ["Orders", "18,240", "+6.1%"],
          ["Avg order", "264", "+5.9%"],
          ["Margin", "31.2%", "−0.8%"],
        ].map(([l, v, d]) => (
          <div key={l} className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-ink-3">{l}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-ink">{v}</p>
            <p className="mt-1 text-[11px] text-ink-2">{d} vs prev. month</p>
          </div>
        ))}
        <div className="rounded-xl border border-line p-3 md:col-span-3">
          <p className="mb-2 text-[12px] font-medium text-ink">Revenue over time</p>
          <svg viewBox="0 0 600 160" className="h-40 w-full">
            <defs>
              <linearGradient id="lpg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#3d5afe" stopOpacity="0.28" />
                <stop offset="1" stopColor="#3d5afe" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[30, 70, 110, 150].map((y) => (
              <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="var(--vz-line)" strokeWidth="1" />
            ))}
            <path d="M0 120 C50 115 80 104 120 108 S200 86 240 90 S320 62 360 70 S440 40 480 46 S560 24 600 20 L600 150 L0 150Z" fill="url(#lpg)" />
            <path d="M0 120 C50 115 80 104 120 108 S200 86 240 90 S320 62 360 70 S440 40 480 46 S560 24 600 20" fill="none" stroke="#3d5afe" strokeWidth="2.25" />
            <path d="M0 136 C60 134 100 128 140 130 S220 118 260 122 S340 108 380 112 S460 96 500 100 S570 90 600 88" fill="none" stroke="#eb6834" strokeWidth="2" />
            <circle cx="360" cy="70" r="6" fill="none" stroke="#9fc93a" strokeWidth="2" />
          </svg>
        </div>
        <div className="flex flex-col rounded-xl border border-line p-3">
          <p className="mb-2 text-[12px] font-medium text-ink">Share by region</p>
          <svg viewBox="0 0 120 120" className="mx-auto h-32 w-32">
            {[
              ["#3d5afe", 0, 0.42],
              ["#eb6834", 0.42, 0.68],
              ["#1baf7a", 0.68, 0.86],
              ["#eda100", 0.86, 1],
            ].map(([c, a, b]) => {
              const r = 46;
              const toXY = (t: number) => [60 + r * Math.sin(2 * Math.PI * t), 60 - r * Math.cos(2 * Math.PI * t)];
              const [x1, y1] = toXY(Number(a) + 0.006);
              const [x2, y2] = toXY(Number(b) - 0.006);
              const large = Number(b) - Number(a) > 0.5 ? 1 : 0;
              return <path key={String(c)} d={`M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`} fill="none" stroke={String(c)} strokeWidth="16" />;
            })}
            <text x="60" y="64" textAnchor="middle" className="fill-ink" style={{ font: "600 14px Geist, sans-serif" }}>
              4.82M
            </text>
          </svg>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3 md:col-span-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-md bg-volt px-1.5 py-0.5 text-[10px] font-semibold text-volt-ink">AI</span>
            <span className="text-ink-2">North drives 42% of revenue · Unusual spike in March (2.4× typical month) · Units and Revenue move together (r = 0.91)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const STEPS = [
  { icon: CloudUpload, title: "Upload", body: "Drop a CSV or Excel file. Columns are typed and classified by meaning — currency, quantity, dates, categories." },
  { icon: Sparkles, title: "Understand", body: "KPIs, trends, anomalies, outliers and correlations are detected automatically, with an AI-written narrative." },
  { icon: ChartColumn, title: "Visualize", body: "Open any finding as a chart, or build your own across eleven chart types with filters and drill-down." },
  { icon: Share2, title: "Share", body: "Compose dashboards, arrange and resize widgets, then share a read-only link or print a report." },
];

const FEATURES = [
  { icon: Sparkles, title: "AI narrative + signals", body: "A Groq-generated briefing sits beside deterministic statistics, so every claim links to the chart that proves it.", span: "md:col-span-2" },
  { icon: ChartScatter, title: "Visual chart builder", body: "Bar, line, area, pie, doughnut, polar, radar, scatter, bubble and histogram — with series splits, top-N, sorting and colors." },
  { icon: LayoutDashboard, title: "Custom dashboards", body: "Drag to rearrange, resize on a 12-column grid, set a global date range and cross-filter every widget." },
  { icon: Table2, title: "Dataset explorer", body: "Profile every column — types, missing values, distributions — and search, sort and filter rows." },
  { icon: MousePointerClick, title: "Drill-down everywhere", body: "Click any bar, slice or point to see the exact rows behind it, then filter the whole view by it." },
  { icon: FileText, title: "Reports & exports", body: "Print-ready reports, PDF via your browser, CSV of raw or aggregated data, and PNG charts." },
  { icon: Command, title: "Global search", body: "⌘K finds datasets, dashboards, columns and commands from anywhere.", span: "md:col-span-2" },
];

export const Landing: React.FC = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="VizIntel home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-[13.5px] text-ink-2 md:flex" aria-label="Product">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#platform" className="hover:text-ink">Platform</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <ButtonLink to="/app" size="sm" data-track="landing_open_app">
                Open workspace <ArrowRight size={14} />
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm" data-track="landing_sign_in">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register" size="sm" data-track="landing_get_started">
                  Get started
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="vz-dot-grid relative overflow-hidden px-5 pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-2 shadow-card-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-volt ring-2 ring-volt/30" />
            AI-first, self-service analytics
          </span>
          <h1 className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.03em] text-ink sm:text-[68px]">
            Your spreadsheets,
            <br />
            <span className="font-display text-[1.12em] font-normal italic tracking-[-0.01em] text-brand">explained.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2">
            Upload a CSV or Excel file. VizIntel profiles every column, surfaces KPIs, trends and anomalies, writes the narrative, and helps you build dashboards your team can share — in minutes, not afternoons.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink to={user ? "/app" : "/register"} size="lg" data-track="hero_cta">
              {user ? "Open your workspace" : "Start analyzing — it's free"} <ArrowRight size={16} />
            </ButtonLink>
            {!user && (
              <ButtonLink to="/login" variant="secondary" size="lg">
                Sign in
              </ButtonLink>
            )}
          </div>
          <p className="mt-5 text-[12.5px] text-ink-3">CSV · XLSX · up to 15 MB · no setup required</p>
        </div>
        <ProductShot />
      </section>

      <section id="how" className="border-t border-line bg-surface px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="vz-eyebrow">How it works</p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
            From raw file to <span className="font-display font-normal italic">findings</span> in four steps.
          </h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-line bg-canvas p-5">
                <span className="font-mono text-[11px] text-ink-3">0{i + 1}</span>
                <s.icon size={22} className="mt-4 text-brand" />
                <h3 className="mt-3 text-[15px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="vz-eyebrow">Features</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Everything between “here's a spreadsheet” and “here's what it means”.</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className={`rounded-2xl border border-line bg-surface p-6 shadow-card-sm ${f.span ?? ""}`}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
                  <f.icon size={18} />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid items-center gap-8 overflow-hidden rounded-2xl border border-line bg-[#0b0d12] p-8 text-white md:grid-cols-2 md:p-12">
            <div>
              <span className="rounded-md bg-[#c6f24e] px-1.5 py-0.5 text-[11px] font-semibold text-[#1d2a00]">Ask AI</span>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                Describe the chart. <span className="font-display font-normal italic text-[#c6f24e]">Get the chart.</span>
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-white/60">
                Ask in plain English. The AI picks the fields and the form; VizIntel computes every number from your full dataset — the model never invents figures.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 font-mono text-[12.5px]" aria-hidden="true">
              <p className="text-white/50">› which regions grew fastest last quarter?</p>
              <div className="mt-3 space-y-2">
                {[
                  ["North", 86],
                  ["West", 64],
                  ["South", 41],
                  ["East", 23],
                ].map(([r, w]) => (
                  <div key={r} className="flex items-center gap-3">
                    <span className="w-12 text-white/60">{r}</span>
                    <span className="h-3 rounded-sm bg-[#5b76ff]" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="border-t border-line bg-surface px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="vz-eyebrow">Platform</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Built on a production-grade event pipeline.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            {[
              { icon: Zap, title: "Redis caching", body: "Datasets, search and summaries are cache-aside with instant per-user invalidation." },
              { icon: Workflow, title: "Kafka streaming", body: "Interactions and domain events stream through Kafka; AI insights run on a background worker." },
              { icon: Database, title: "MongoDB", body: "Datasets, dashboards and rolled-up activity metrics, indexed for the queries the app makes." },
              { icon: Sparkles, title: "n8n automations", body: "Emails when a dataset is processed or insights are ready, weekly reports, automatic retries." },
            ].map((p) => (
              <div key={p.title} className="rounded-2xl border border-line p-5">
                <p.icon size={20} className="text-ink-2" />
                <h3 className="mt-3 text-[14.5px] font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-24 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Stop building dashboards. <span className="font-display font-normal italic text-brand">Start reading them.</span>
        </h2>
        <div className="mt-8">
          <ButtonLink to={user ? "/app" : "/register"} size="lg" data-track="footer_cta">
            {user ? "Open your workspace" : "Create a free workspace"} <ArrowRight size={16} />
          </ButtonLink>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-[12.5px] text-ink-3">
          <Logo size={22} />
          <span>© {new Date().getFullYear()} VizIntel. Your data stays in your workspace.</span>
        </div>
      </footer>
    </div>
  );
};
