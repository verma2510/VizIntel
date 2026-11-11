import React from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { useAuth } from "../context/Auth";
import { ButtonLink } from "../components/ui/Button";

export const NotFound: React.FC = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const inApp = pathname.startsWith("/app");
  return (
    <div className={`flex flex-col items-center justify-center px-6 text-center ${inApp ? "min-h-[60vh]" : "min-h-screen bg-canvas"}`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 shadow-card-sm">
        <Compass size={22} />
      </span>
      <p className="mt-6 font-mono text-xs text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page doesn't exist</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-2">
        <span className="font-mono text-[13px]">{pathname}</span> isn't a page in VizIntel. It may have moved, or the link may be mistyped.
      </p>
      <ButtonLink to={user ? "/app" : "/"} className="mt-6" variant="secondary">
        <ArrowLeft size={15} /> {user ? "Back to workspace" : "Back home"}
      </ButtonLink>
    </div>
  );
};
