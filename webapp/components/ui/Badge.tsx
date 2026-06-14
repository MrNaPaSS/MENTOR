import type { ReactNode } from "react";

type BadgeVariant = "cyan" | "gold" | "success" | "danger" | "muted";

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  cyan: "badge-cyan",
  gold: "badge-gold",
  success: "badge-success",
  danger: "badge-danger",
  muted: "badge-muted",
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

/** Типизированный бейдж поверх классов дизайн-системы (.badge-*). */
export default function Badge({ children, variant = "cyan", className = "" }: BadgeProps) {
  return <span className={`${VARIANT_CLASS[variant]} ${className}`}>{children}</span>;
}
