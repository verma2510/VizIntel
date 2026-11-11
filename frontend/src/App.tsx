import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/Auth";
import { ToastProvider } from "./context/Toast";
import { usePageTracking } from "./hooks/usePageTracking";
import { PageLoader } from "./components/ui/Surface";
import { AppShell } from "./components/layout/AppShell";

// Route-level code splitting: each page ships as its own chunk.
const page = <T extends Record<string, React.ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const Landing = page(() => import("./pages/Landing"), "Landing");
const Login = page(() => import("./pages/Login"), "Login");
const Register = page(() => import("./pages/Register"), "Register");
const Workspace = page(() => import("./pages/Workspace"), "Workspace");
const DataSources = page(() => import("./pages/DataSources"), "DataSources");
const Explorer = page(() => import("./pages/Explorer"), "Explorer");
const Insights = page(() => import("./pages/Insights"), "Insights");
const ChartBuilder = page(() => import("./pages/ChartBuilder"), "ChartBuilder");
const Dashboards = page(() => import("./pages/Dashboards"), "Dashboards");
const DashboardView = page(() => import("./pages/DashboardView"), "DashboardView");
const SharedDashboard = page(() => import("./pages/SharedDashboard"), "SharedDashboard");
const Reports = page(() => import("./pages/Reports"), "Reports");
const Activity = page(() => import("./pages/Activity"), "Activity");
const Settings = page(() => import("./pages/Settings"), "Settings");
const NotFound = page(() => import("./pages/NotFound"), "NotFound");

// Emits a page_view event on every client-side route change.
const RouteTracker = () => {
  usePageTracking();
  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const location = useLocation();
  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
};

/** Pre-redesign URL, still used by n8n notification emails: /dashboard?dataset=<id>. */
const LegacyDashboardRedirect = () => {
  const [params] = useSearchParams();
  const dataset = params.get("dataset");
  return <Navigate to={dataset ? `/app/insights/${encodeURIComponent(dataset)}` : "/app"} replace />;
};

function App() {
  return (
    <Router>
      <RouteTracker />
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
              <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
              <Route path="/share/:token" element={<SharedDashboard />} />
              <Route path="/dashboard" element={<ProtectedRoute><LegacyDashboardRedirect /></ProtectedRoute>} />
              <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                <Route index element={<Workspace />} />
                <Route path="data" element={<DataSources />} />
                <Route path="explore/:id?" element={<Explorer />} />
                <Route path="insights/:id?" element={<Insights />} />
                <Route path="builder" element={<ChartBuilder />} />
                <Route path="dashboards" element={<Dashboards />} />
                <Route path="dashboards/:id" element={<DashboardView />} />
                <Route path="reports" element={<Reports />} />
                <Route path="activity" element={<Activity />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}

export default App;
