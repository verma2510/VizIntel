import React, { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ChevronsUpDown, CloudUpload, LayoutDashboard, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun, X } from "lucide-react";
import { useAuth } from "../../context/Auth";
import { DataProvider } from "../../context/Data";
import { DashboardsProvider, useDashboards } from "../../context/Dashboards";
import { setPrefs, usePrefs, useResolvedTheme, type ThemeMode } from "../../lib/prefs";
import { Logo, LogoMark } from "../brand/Logo";
import { Button } from "../ui/Button";
import { Kbd, PageLoader } from "../ui/Surface";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "../ui/Overlay";
import { CommandPalette } from "./CommandPalette";
import { UploadDialog } from "../data/UploadDialog";
import { NAV_GROUPS, NAV_ITEMS } from "./nav";

interface ShellApi {
  /** Opens the upload dialog; with a file, uploading starts immediately. */
  openUpload: (file?: File) => void;
  openSearch: () => void;
}
const ShellContext = createContext<ShellApi>({ openUpload: () => {}, openSearch: () => {} });
// eslint-disable-next-line react-refresh/only-export-components
export const useShell = () => useContext(ShellContext);

const initials = (name?: string) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

const ThemeIcon: Record<ThemeMode, React.ReactNode> = { light: <Sun size={14} />, dark: <Moon size={14} />, system: <Monitor size={14} /> };

const UserMenu: React.FC<{ collapsed: boolean; onNavigate?: () => void }> = ({ collapsed, onNavigate }) => {
  const { user, logout } = useAuth();
  const prefs = usePrefs();
  return (
    <Popover
      align="start"
      width={240}
      trigger={({ toggle, ref, open }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Account menu"
          className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-3 ${open ? "bg-surface-3" : ""}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-xs font-semibold text-canvas">{initials(user?.name)}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{user?.name}</span>
                <span className="block truncate text-xs text-ink-3">{user?.email}</span>
              </span>
              <ChevronsUpDown size={14} className="text-ink-3" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <MenuLabel>Theme</MenuLabel>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1">
            {(["light", "dark", "system"] as ThemeMode[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPrefs({ theme: t })}
                className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] capitalize ${prefs.theme === t ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-3"}`}
                aria-pressed={prefs.theme === t}
              >
                {ThemeIcon[t]}
                {t}
              </button>
            ))}
          </div>
          <MenuSeparator />
          <Link
            to="/app/settings"
            onClick={() => {
              close();
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink hover:bg-surface-3">
            <Settings size={15} className="text-ink-3" /> Settings
          </Link>
          <MenuItem
            icon={<LogOut size={15} />}
            danger
            data-track="logout"
            onClick={() => {
              close();
              logout();
            }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </Popover>
  );
};

const SidebarContent: React.FC<{ collapsed: boolean; onNavigate?: () => void }> = ({ collapsed, onNavigate }) => {
  const { dashboards } = useDashboards();
  const recent = dashboards.slice(0, 4);
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center ${collapsed ? "justify-center" : "px-4"}`}>
        <Link to="/app" onClick={onNavigate} aria-label="VizIntel home">
          {collapsed ? <LogoMark size={28} /> : <Logo />}
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            {!collapsed && <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    data-track="nav"
                    data-track-to={item.to}
                    className={({ isActive }) =>
                      `group flex items-center gap-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${collapsed ? "h-9 justify-center" : "h-8 px-2.5"} ${
                        isActive ? "bg-surface text-ink shadow-card-sm ring-1 ring-line" : "text-ink-2 hover:bg-surface-3 hover:text-ink"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon size={16} className={isActive ? "text-brand" : "text-ink-3 group-hover:text-ink-2"} />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!collapsed && recent.length > 0 && (
          <div className="mt-5">
            <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">Recent dashboards</p>
            <ul className="space-y-0.5">
              {recent.map((d) => (
                <li key={d._id}>
                  <NavLink
                    to={`/app/dashboards/${d._id}`}
                    onClick={onNavigate}
                    className={({ isActive }) => `flex h-7 items-center gap-2 rounded-lg px-2.5 text-[13px] ${isActive ? "text-ink" : "text-ink-3 hover:bg-surface-3 hover:text-ink"}`}
                  >
                    <LayoutDashboard size={13} className="shrink-0 opacity-70" />
                    <span className="truncate">{d.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
      <div className="border-t border-line p-2.5">
        <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
};

const ShellInner: React.FC = () => {
  const prefs = usePrefs();
  const theme = useResolvedTheme();
  const location = useLocation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const collapsed = prefs.sidebarCollapsed;

  const openUpload = useCallback((file?: File) => {
    setUploadFile(file instanceof File ? file : null);
    setUploadOpen(true);
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const api = useMemo(() => ({ openUpload, openSearch }), [openUpload, openSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = NAV_ITEMS.filter((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <ShellContext.Provider value={api}>
      <div className="min-h-screen bg-canvas">
        {/* Desktop sidebar */}
        <aside className={`no-print fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-canvas transition-[width] duration-200 lg:block ${collapsed ? "w-16" : "w-60"}`}>
          <SidebarContent collapsed={collapsed} />
        </aside>

        {/* Mobile sidebar */}
        {mobileNav && (
          <div className="no-print fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-[rgb(8_10_14/0.5)]" onClick={() => setMobileNav(false)} aria-hidden="true" />
            <aside className="relative h-full w-72 animate-slide-in-right border-r border-line bg-canvas shadow-float">
              <button type="button" onClick={() => setMobileNav(false)} className="absolute right-3 top-3.5 rounded-md p-1 text-ink-3 hover:bg-surface-3" aria-label="Close navigation">
                <X size={18} />
              </button>
              <SidebarContent collapsed={false} onNavigate={() => setMobileNav(false)} />
            </aside>
          </div>
        )}

        <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-16" : "lg:pl-60"}`}>
          <header className="no-print sticky top-0 z-20 flex h-14 min-w-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md sm:px-5">
            <Button variant="ghost" size="sm" iconOnly className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
              <Menu size={18} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="max-lg:hidden"
              onClick={() => setPrefs({ sidebarCollapsed: !collapsed })}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </Button>
            {current && <span className="hidden truncate text-[13px] font-medium text-ink-2 md:block">{current.label}</span>}

            <button
              type="button"
              onClick={openSearch}
              data-track="open_search"
              className="flex h-9 min-w-0 max-w-sm flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-left text-[13px] text-ink-3 shadow-card-sm transition-colors hover:border-line-strong md:mx-auto"
            >
              <Search size={15} />
              <span className="flex-1 truncate">Search datasets, dashboards, columns…</span>
              <span className="hidden items-center gap-0.5 sm:flex">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>

            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={() => setPrefs({ theme: theme === "dark" ? "light" : "dark" })}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                title="Toggle theme"
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </Button>
              <Button size="sm" onClick={() => openUpload()} data-track="topbar_upload">
                <CloudUpload size={15} />
                <span className="hidden sm:inline">Upload</span>
              </Button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </main>
        </div>

        <UploadDialog open={uploadOpen} initialFile={uploadFile} onClose={() => setUploadOpen(false)} />
        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onUpload={() => openUpload()} />
      </div>
    </ShellContext.Provider>
  );
};

/** Authenticated application frame; data stores live here so they reset on sign-out. */
export const AppShell: React.FC = () => (
  <DataProvider>
    <DashboardsProvider>
      <ShellInner />
    </DashboardsProvider>
  </DataProvider>
);
