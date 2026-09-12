import type { ReactNode } from "react";
import Reveal from "./Reveal";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
  className?: string;
  /** Уровень заголовка. H1 - только когда секция открывает страницу: он у неё один. */
  as?: "h1" | "h2";
}

export default function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className = "",
  as: Tag = "h2",
}: SectionHeadingProps) {
  const alignment = align === "center" ? "items-center text-center" : "items-start text-left";
  return (
    <Reveal className={`flex flex-col gap-3 ${alignment} ${className}`}>
      {eyebrow && (
        <span className="eyebrow">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
          {eyebrow}
        </span>
      )}
      <Tag className="text-h2 text-text-primary">{title}</Tag>
      {subtitle && (
        <p className="max-w-2xl text-text-secondary">{subtitle}</p>
      )}
    </Reveal>
  );
}
