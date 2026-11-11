import React from "react";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean }> = ({
  children,
  className = "",
  padded = true,
  interactive = false,
  ...props
}) => (
  <div
    className={`rounded-xl border border-line bg-surface shadow-card-sm ${padded ? "p-5" : ""} ${interactive ? "transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-line-strong hover:shadow-card" : ""} ${className}`}
    {...props}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<{ title: React.ReactNode; eyebrow?: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }> = ({
  title,
  eyebrow,
  description,
  actions,
  className = "",
}) => (
  <div className={`mb-4 flex items-start justify-between gap-3 ${className}`}>
    <div className="min-w-0">
      {eyebrow && <p className="vz-eyebrow mb-1">{eyebrow}</p>}
      <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
  </div>
);

export type BadgeTone = "neutral" | "brand" | "good" | "warn" | "bad" | "ai";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  brand: "bg-brand-soft text-brand-ink",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  ai: "bg-volt text-volt-ink",
};

export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode; className?: string; icon?: React.ReactNode }> = ({ tone = "neutral", children, className = "", icon }) => (
  <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${BADGE[tone]} ${className}`}>
    {icon}
    {children}
  </span>
);

export const Spinner: React.FC<{ size?: number; className?: string; label?: string }> = ({ size = 18, className = "", label = "Loading" }) => (
  <LoaderCircle size={size} className={`animate-spin text-brand ${className}`} aria-label={label} role="status" />
);

export const Skeleton: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = "", style }) => (
  <div className={`vz-skeleton ${className}`} style={style} aria-hidden="true" />
);

export const PageLoader: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink-3">
    <Spinner size={22} />
    {label}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}> = ({ icon, title, description, action, className = "", compact = false }) => (
  <div className={`flex flex-col items-center justify-center text-center ${compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14"} ${className}`}>
    {icon && <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2 shadow-card-sm">{icon}</div>}
    <h3 className={`font-semibold tracking-tight text-ink ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
    {description && <p className="max-w-md text-[13px] leading-relaxed text-ink-3">{description}</p>}
    {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ title?: string; message: string; onRetry?: () => void; compact?: boolean }> = ({ title = "Something went wrong", message, onRetry, compact }) => (
  <EmptyState
    compact={compact}
    icon={<CircleAlert size={20} className="text-bad" />}
    title={title}
    description={message}
    action={
      onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </Button>
      )
    }
  />
);

export const ProgressBar: React.FC<{ value: number; className?: string; indeterminate?: boolean }> = ({ value, className = "", indeterminate }) => (
  <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}>
    <div
      className={`h-full rounded-full bg-brand transition-[width] duration-300 ${indeterminate ? "w-1/3 animate-[shimmer_1.2s_linear_infinite]" : ""}`}
      style={indeterminate ? { backgroundImage: "linear-gradient(90deg, transparent, var(--vz-brand), transparent)", backgroundSize: "400px 100%", width: "100%" } : { width: `${Math.max(2, value * 100)}%` }}
    />
  </div>
);

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[10px] font-medium text-ink-3">{children}</kbd>
);

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = "md", className = "", ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]"} ${
              active ? "bg-surface text-ink shadow-card-sm" : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const PageHeader: React.FC<{ eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }> = ({
  eyebrow,
  title,
  description,
  actions,
  children,
}) => (
  <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      {eyebrow && <p className="vz-eyebrow mb-2">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px] sm:leading-9">{title}</h1>
      {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>}
      {children}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);
