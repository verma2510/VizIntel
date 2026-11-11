import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../lib/tracker";

// Routes that only redirect (e.g. "/" -> "/dashboard") would otherwise count as a page view.
const REDIRECT_ONLY_PATHS = new Set(["/"]);

/** Emits one page_view per client-side route change (deduplicated against StrictMode double effects). */
export const usePageTracking = () => {
  const { pathname } = useLocation();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (REDIRECT_ONLY_PATHS.has(pathname) || lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    trackPageView(pathname);
  }, [pathname]);
};
