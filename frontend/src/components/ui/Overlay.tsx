import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Locks page scroll and restores focus to the opener when an overlay closes. */
function useOverlayBehaviour(open: boolean, onClose: () => void, panel: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel.current) {
        const focusables = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
      target?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose, panel]);
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const MODAL_SIZE = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, description, children, footer, size = "md" }) => {
  const panel = useRef<HTMLDivElement>(null);
  useOverlayBehaviour(open, onClose, panel);
  if (!open) return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(8_10_14/0.55)] backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full ${MODAL_SIZE[size]} animate-pop flex-col rounded-t-2xl border border-line bg-surface shadow-float outline-none sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

export const Drawer: React.FC<DrawerProps> = ({ open, onClose, title, description, children, footer, width = "max-w-xl" }) => {
  const panel = useRef<HTMLDivElement>(null);
  useOverlayBehaviour(open, onClose, panel);
  if (!open) return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(8_10_14/0.45)]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={`relative flex h-full w-full ${width} animate-slide-in-right flex-col border-l border-line bg-surface shadow-float outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
            {description && <div className="mt-0.5 text-[13px] text-ink-3">{description}</div>}
          </div>
          <button type="button" onClick={onClose} className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

/** Anchored popover (menus, pickers). Closes on outside click / Escape; flips to stay on screen. */
export const Popover: React.FC<{
  trigger: (props: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  width?: number;
}> = ({ trigger, children, align = "start", width = 240 }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const panelH = panelRef.current?.offsetHeight ?? 0;
      let left = align === "end" ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (panelH && top + panelH > window.innerHeight - 8 && r.top - panelH - 6 > 8) top = r.top - panelH - 6;
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: triggerRef })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="no-print fixed z-[90] animate-pop rounded-xl border border-line bg-surface p-1 shadow-float"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
          >
            {children(close)}
          </div>,
          document.body
        )}
    </>
  );
};

export const MenuItem: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; danger?: boolean; hint?: React.ReactNode }> = ({
  icon,
  danger,
  hint,
  children,
  className = "",
  ...props
}) => (
  <button
    type="button"
    role="menuitem"
    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50 ${
      danger ? "text-bad hover:bg-bad-soft" : "text-ink hover:bg-surface-3"
    } ${className}`}
    {...props}
  >
    {icon && <span className={`shrink-0 ${danger ? "" : "text-ink-3"}`}>{icon}</span>}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {hint && <span className="shrink-0 text-xs text-ink-3">{hint}</span>}
  </button>
);

export const MenuSeparator = () => <div className="my-1 h-px bg-line" role="separator" />;
export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">{children}</p>;

/** Confirmation dialog for destructive actions. */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}> = ({ open, title, description, confirmLabel = "Delete", onConfirm, onClose }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-3">
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
            className="h-9 rounded-lg bg-bad px-3.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-2">{description}</div>
    </Modal>
  );
};
