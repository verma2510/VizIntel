/**
 * User preferences persisted in localStorage, exposed as a tiny external store so both React
 * (via usePrefs) and plain functions (formatters, chart theming) read the same values.
 */
import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type CurrencyCode = "none" | "USD" | "EUR" | "GBP" | "INR" | "JPY";

export interface Preferences {
  theme: ThemeMode;
  currency: CurrencyCode;
  compactNumbers: boolean;
  sidebarCollapsed: boolean;
  trackingOptOut: boolean;
}

const PREFS_KEY = "vz_prefs";
const THEME_KEY = "vz_theme"; // read by the pre-paint script in index.html
export const TRACKING_OPT_OUT_KEY = "vz_tracking_optout"; // read by lib/tracker.ts

const DEFAULTS: Preferences = {
  theme: "system",
  currency: "none",
  compactNumbers: true,
  sidebarCollapsed: false,
  trackingOptOut: false,
};

const load = (): Preferences => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const theme = (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? raw.theme;
    return { ...DEFAULTS, ...raw, theme: theme === "light" || theme === "dark" ? theme : "system" };
  } catch {
    return DEFAULTS;
  }
};

let state: Preferences = load();
const listeners = new Set<() => void>();

export const getPrefs = (): Preferences => state;

export function setPrefs(patch: Partial<Preferences>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state));
    localStorage.setItem(THEME_KEY, state.theme);
    if (state.trackingOptOut) localStorage.setItem(TRACKING_OPT_OUT_KEY, "1");
    else localStorage.removeItem(TRACKING_OPT_OUT_KEY);
  } catch {
    // storage unavailable (private mode): keep in-memory state only
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePrefs = (): Preferences => useSyncExternalStore(subscribe, getPrefs, getPrefs);

// ---- Resolved theme ---------------------------------------------------------------------------

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const resolveTheme = (): "light" | "dark" => (state.theme === "system" ? (media?.matches ? "dark" : "light") : state.theme);

let resolved = resolveTheme();
const themeListeners = new Set<() => void>();

function applyTheme() {
  const next = resolveTheme();
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", next);
  if (next !== resolved) {
    resolved = next;
    themeListeners.forEach((l) => l());
  }
}

subscribe(applyTheme);
media?.addEventListener("change", applyTheme);
applyTheme();

export const getResolvedTheme = () => resolved;
export const useResolvedTheme = (): "light" | "dark" =>
  useSyncExternalStore(
    (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    getResolvedTheme,
    getResolvedTheme
  );
