"use client";

import {
  TrendingUp, GraduationCap, Crown, BookOpen, BellRing, Bot, Chrome,
  Brain, Cpu, Gift, Sparkles, Zap, LineChart, Eye, ScanSearch, BarChart3, Rows3, Layers,
  type LucideIcon,
} from "lucide-react";

// Имя иконки (из ShopItem.icon) → компонент lucide. Fallback — Gift.
const MAP: Record<string, LucideIcon> = {
  TrendingUp, GraduationCap, Crown, BookOpen, BellRing, Bot, Chrome,
  Brain, Cpu, Gift, Sparkles, Zap, LineChart,
  // Инструменты терминала.
  Eye, ScanSearch, BarChart3, Rows3, Layers,
};

// Список имён для выпадающего выбора в админке.
export const ICON_NAMES = Object.keys(MAP);

export default function ShopIcon({ name, className }: { name: string; className?: string }) {
  const Icon = MAP[name] || Gift;
  return <Icon className={className} />;
}
