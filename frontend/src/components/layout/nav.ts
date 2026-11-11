import { ChartColumn, Database, FileText, History, House, LayoutDashboard, Settings, Sparkles, Table2, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  end?: boolean;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [{ to: "/app", label: "Home", icon: House, description: "Overview of your data and dashboards", end: true }],
  },
  {
    label: "Data",
    items: [
      { to: "/app/data", label: "Data sources", icon: Database, description: "Upload and manage datasets" },
      { to: "/app/explore", label: "Explorer", icon: Table2, description: "Browse rows, columns and profiles" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { to: "/app/insights", label: "AI insights", icon: Sparkles, description: "KPIs, trends, anomalies and AI narrative" },
      { to: "/app/builder", label: "Chart builder", icon: ChartColumn, description: "Build any chart from your data" },
    ],
  },
  {
    label: "Present",
    items: [
      { to: "/app/dashboards", label: "Dashboards", icon: LayoutDashboard, description: "Compose, arrange and share dashboards" },
      { to: "/app/reports", label: "Reports", icon: FileText, description: "Print-ready reports and exports" },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/app/activity", label: "Activity", icon: History, description: "Your usage history" },
      { to: "/app/settings", label: "Settings", icon: Settings, description: "Profile, appearance and preferences" },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
