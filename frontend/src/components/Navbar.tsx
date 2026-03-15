import React from "react";
import { LogOut, User as UserIcon, ActivitySquare } from "lucide-react";
import { useAuth } from "../context/Auth";
import { Button } from "./Button";

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-slate-950/80 backdrop-blur-xl supports-[backdrop-filter]:bg-slate-950/60 shadow-lg shadow-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2 rounded-xl ring-2 ring-purple-500/20 shadow-lg">
              <ActivitySquare className="text-white relative z-10" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-200 to-indigo-200">
              VizIntel Dashboard
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-sm font-semibold text-slate-200">{user.name}</span>
                  <span className="text-xs text-slate-500">{user.email}</span>
                </div>
                <div className="h-8 w-px bg-slate-800" />
                <Button 
                  onClick={logout} 
                  variant="ghost" 
                  className="flex gap-2 items-center text-red-400 hover:text-red-300 hover:bg-red-950/30"
                >
                  <LogOut size={16} />
                  <span>Logout</span>
                </Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button variant="ghost" className="flex gap-2 items-center">
                  <UserIcon size={16} />
                  Login
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
