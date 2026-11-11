import React from "react";

/** VizIntel mark: three ascending bars on an ink tile, with a volt "signal" spark for AI. */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 28, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#0d1017" />
    <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="rgb(255 255 255 / 0.12)" />
    <rect x="7.5" y="17" width="4" height="8" rx="2" fill="#ffffff" fillOpacity="0.45" />
    <rect x="14" y="12" width="4" height="13" rx="2" fill="#ffffff" fillOpacity="0.8" />
    <rect x="20.5" y="9" width="4" height="16" rx="2" fill="#5b76ff" />
    <circle cx="22.5" cy="5.6" r="2.1" fill="#c6f24e" />
  </svg>
);

export const Logo: React.FC<{ className?: string; showWordmark?: boolean; size?: number }> = ({ className = "", showWordmark = true, size = 28 }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <LogoMark size={size} />
    {showWordmark && (
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        Viz<span className="text-ink-3">Intel</span>
      </span>
    )}
  </span>
);
