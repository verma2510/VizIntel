import type React from "react";
import { CalendarDays, Hash, KeyRound, Tag, Type } from "lucide-react";
import type { FieldRole } from "../../lib/data/prepare";

export const ROLE_META: Record<FieldRole, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }> = {
  measure: { label: "Metric", icon: Hash, tone: "text-brand-ink" },
  date: { label: "Date", icon: CalendarDays, tone: "text-good" },
  dimension: { label: "Category", icon: Tag, tone: "text-warn" },
  identifier: { label: "Identifier", icon: KeyRound, tone: "text-ink-3" },
  text: { label: "Text", icon: Type, tone: "text-ink-3" },
};
