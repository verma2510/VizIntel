import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Lock, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/Auth";
import { Button } from "../components/ui/Button";
import { Textfield } from "../components/ui/Field";
import { api, errorMessage } from "../lib/api";
import type { User } from "../types";
import { AuthLayout } from "./auth/AuthLayout";

export const Register: React.FC = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User }>("/api/auth/register", { method: "POST", body: { name, email, password }, auth: false });
      login(data.user, data.token, "/app");
    } catch (err) {
      setError(errorMessage(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Turn your first spreadsheet into insights in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" data-track="nav_login" className="font-medium text-brand-ink hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
          {error}
        </div>
      )}
      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        <Textfield label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" required autoComplete="name" leading={<UserIcon size={15} />} autoFocus />
        <Textfield label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" leading={<Mail size={15} />} />
        <Textfield
          label="Password"
          hint="At least 6 characters"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          minLength={6}
          autoComplete="new-password"
          leading={<Lock size={15} />}
        />
        <Button type="submit" size="lg" className="group mt-2 w-full" isLoading={loading} data-track="register_submit">
          Create account
          {!loading && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
        </Button>
      </form>
    </AuthLayout>
  );
};
