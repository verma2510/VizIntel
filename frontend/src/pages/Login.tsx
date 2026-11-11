import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { useAuth } from "../context/Auth";
import { Button } from "../components/ui/Button";
import { Textfield } from "../components/ui/Field";
import { api, errorMessage } from "../lib/api";
import type { User } from "../types";
import { AuthLayout } from "./auth/AuthLayout";

export const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
      login(data.user, data.token, from && from.startsWith("/app") ? from : "/app");
    } catch (err) {
      setError(errorMessage(err, "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your VizIntel workspace."
      footer={
        <>
          New to VizIntel?{" "}
          <Link to="/register" data-track="nav_register" className="font-medium text-brand-ink hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
          {error}
        </div>
      )}
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Textfield label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" leading={<Mail size={15} />} autoFocus />
        <Textfield label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" leading={<Lock size={15} />} />
        <Button type="submit" size="lg" className="group mt-2 w-full" isLoading={loading} data-track="login_submit">
          Sign in
          {!loading && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
        </Button>
      </form>
    </AuthLayout>
  );
};
