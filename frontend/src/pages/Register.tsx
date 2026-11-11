import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/Auth";
import { Button } from "../components/Button";
import { Textfield } from "../components/Textfield";
import { Card } from "../components/Card";
import { ActivitySquare, CheckCircle2 } from "lucide-react";

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
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.msg || "Registration failed");
      }

      login(data.user, data.token);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

      <Card className="w-full max-w-md backdrop-blur-3xl bg-slate-900/60 border-slate-800/60 shadow-2xl relative z-10 px-8 py-10 mt-[-5%]">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-3 rounded-2xl shadow-lg mb-4 ring-4 ring-indigo-500/20">
            <ActivitySquare className="text-white w-8 h-8" strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-200 to-indigo-200">
            Create Account
          </h2>
          <p className="text-slate-400 mt-2 text-center text-sm">
            Start analyzing your massive datasets with AI instantly.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded-lg mb-6 flex items-center justify-center">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="flex flex-col gap-5">
          <Textfield
            label="Full Name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            required
            autoComplete="name"
          />
          <Textfield
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
          <Textfield
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="new-password"
            minLength={6}
          />

          <Button type="submit" className="w-full mt-2 group" size="lg" isLoading={loading} data-track="register_submit">
            Sign Up
            <CheckCircle2 className="ml-2 w-4 h-4" />
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link to="/login" data-track="nav_login" className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline transition-all">
            Sign in
          </Link>
        </div>
      </Card>
    </div>
  );
};
