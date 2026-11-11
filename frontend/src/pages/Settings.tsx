import React, { useEffect, useState } from "react";
import { CircleCheck, CircleX, LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { api, errorMessage } from "../lib/api";
import { setPrefs, usePrefs, type CurrencyCode, type ThemeMode } from "../lib/prefs";
import { formatDate, formatMeasure, formatNumber } from "../lib/format";
import type { SystemStatus, User } from "../types";
import { Badge, Card, CardHeader, PageHeader, Skeleton } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { Select, Switch, Textfield } from "../components/ui/Field";

const THEMES: { value: ThemeMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const CURRENCIES: { value: CurrencyCode; label: string }[] = [
  { value: "none", label: "No symbol" },
  { value: "USD", label: "US dollar ($)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "British pound (£)" },
  { value: "INR", label: "Indian rupee (₹)" },
  { value: "JPY", label: "Japanese yen (¥)" },
];

const StatusRow: React.FC<{ label: string; ok: boolean | null; detail: React.ReactNode }> = ({ label, ok, detail }) => (
  <div className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
    <span className="flex items-center gap-2 text-ink">
      {ok === null ? <span className="h-4 w-4 rounded-full bg-surface-3" /> : ok ? <CircleCheck size={16} className="text-good" /> : <CircleX size={16} className="text-bad" />}
      {label}
    </span>
    <span className="text-right text-ink-3">{detail}</span>
  </div>
);

export const Settings: React.FC = () => {
  const { user, updateUser, logout } = useAuth();
  const prefs = usePrefs();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);

  const loadSystem = async () => {
    setSystemError(null);
    try {
      setSystem(await api<SystemStatus>("/health/ready", { auth: false }));
    } catch (err) {
      setSystem(null);
      setSystemError(errorMessage(err));
    }
  };
  useEffect(() => {
    void loadSystem();
  }, []);

  const profileDirty = name.trim() !== (user?.name ?? "") || email.trim() !== (user?.email ?? "");
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim() !== user?.name) body.name = name.trim();
      if (email.trim() !== user?.email) body.email = email.trim();
      const res = await api<{ user: User }>("/api/auth/me", { method: "PATCH", body });
      updateUser(res.user);
      toast.success("Profile updated");
    } catch (err) {
      toast.error("Couldn't update profile", errorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const mismatch = Boolean(confirm) && next !== confirm;
  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setSavingPassword(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed");
    } catch (err) {
      toast.error("Couldn't change password", errorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="animate-rise mx-auto max-w-4xl">
      <PageHeader eyebrow="Account" title="Settings" description="Your profile, security, appearance and data preferences." />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" description={user?.createdAt ? `Member since ${formatDate(user.createdAt, "long")}` : undefined} />
          <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
            <Textfield label="Full name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
            <Textfield label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" hint="Used to sign in" />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!profileDirty || !name.trim()} isLoading={savingProfile} data-track="settings_profile_save">
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Password" description="Use at least 6 characters." />
          <form onSubmit={savePassword} className="grid gap-4 sm:grid-cols-3">
            <Textfield label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            <Textfield label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} autoComplete="new-password" />
            <Textfield label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" error={mismatch ? "Passwords don't match" : undefined} />
            <div className="sm:col-span-3">
              <Button type="submit" variant="secondary" disabled={!current || next.length < 6 || mismatch || !confirm} isLoading={savingPassword} data-track="settings_password_save">
                Change password
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Appearance" description="Charts use colour-blind-tested palettes stepped separately for light and dark." />
          <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => {
              const active = prefs.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPrefs({ theme: t.value })}
                  data-track="settings_theme"
                  data-track-theme={t.value}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-[13px] font-medium transition-colors ${active ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong"}`}
                >
                  <t.icon size={20} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Number formatting" description="How metric values are displayed across charts, KPIs and tables." />
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Currency symbol for money columns</p>
              <Select value={prefs.currency} onChange={(e) => setPrefs({ currency: e.target.value as CurrencyCode })} options={CURRENCIES} aria-label="Currency symbol" />
            </div>
            <Switch label="Compact large numbers" description="Show 1.2M instead of 1,234,567" checked={prefs.compactNumbers} onChange={(v) => setPrefs({ compactNumbers: v })} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 rounded-lg bg-surface-2 p-3 text-[13px]">
            <span className="text-ink-3">Preview:</span>
            <span className="font-medium text-ink">{formatMeasure(1234567.89, "currency")}</span>
            <span className="text-ink-3">·</span>
            <span className="font-medium text-ink">{formatNumber(48210)}</span>
            <span className="text-ink-3">·</span>
            <span className="font-medium text-ink">{formatMeasure(0.4213, "percentage", { percentIsFraction: true })}</span>
          </div>
        </Card>

        <Card>
          <CardHeader title="Privacy" />
          <Switch
            label="Don't track my interactions in this browser"
            description="VizIntel records page views, clicks and searches to power your Activity page. Turning this off stops new events from this browser; existing history is kept for up to 30 days."
            checked={prefs.trackingOptOut}
            onChange={(v) => setPrefs({ trackingOptOut: v })}
          />
        </Card>

        <Card>
          <CardHeader
            title="System status"
            description="Live readiness of the services behind VizIntel."
            actions={
              <Button variant="ghost" size="xs" iconOnly onClick={loadSystem} aria-label="Refresh status">
                <RefreshCw size={14} />
              </Button>
            }
          />
          {systemError ? (
            <p className="text-[13px] text-bad">Status unavailable: {systemError}</p>
          ) : !system ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="divide-y divide-line">
              <StatusRow label="API & database (MongoDB)" ok={system.mongo.ready} detail={`up ${Math.round(system.uptimeSec / 60)} min`} />
              <StatusRow
                label="Cache & rate limits (Redis)"
                ok={system.redis.status === "ready" ? true : system.redis.enabled === false ? null : false}
                detail={system.redis.enabled === false ? "not configured — bypassed" : `${system.redis.status ?? "unknown"}${system.cache.hitRatio !== null ? ` · ${Math.round((system.cache.hitRatio ?? 0) * 100)}% hit ratio` : ""}`}
              />
              <StatusRow label="Event streaming (Kafka)" ok={system.kafka.healthy} detail={system.kafka.mode === "kafka" ? `kafka · outbox ${system.kafka.outboxSize ?? 0}` : "inline mode (in-process)"} />
              <StatusRow label="AI insights" ok={true} detail={<Badge tone="neutral">{system.insightsMode === "async" ? "background worker" : "generated on upload"}</Badge>} />
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Sign out</p>
            <p className="text-[13px] text-ink-3">Signed in as {user?.email}</p>
          </div>
          <Button variant="secondary" onClick={logout} data-track="logout">
            <LogOut size={15} /> Sign out
          </Button>
        </Card>
      </div>
    </div>
  );
};
