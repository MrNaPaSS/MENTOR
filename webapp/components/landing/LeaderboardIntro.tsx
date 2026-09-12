"use client";

// Видимая часть открытой страницы лидерборда - по той же причине, что и у
// калькулятора: страница серверная ради `metadata`, надписи - клиентские.

import type { ReactNode } from "react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Badge from "@/components/ui/Badge";
import Leaderboard from "@/components/Leaderboard";
import { useT } from "@/lib/i18n";

/** children - серверный текст для поисковика, он встаёт под таблицей. */
export default function LeaderboardIntro({ children }: { children?: ReactNode }) {
  const t = useT();
  const l = t.tools.leaderboard;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-28 md:px-6 md:pt-32">
      <div className="flex justify-center">
        <Badge variant="gold">{l.badge}</Badge>
      </div>
      <SectionHeading
        as="h1"
        className="mt-4"
        eyebrow={l.eyebrow}
        title={l.title}
        subtitle={l.subtitle}
      />

      <Reveal className="mt-12">
        <Leaderboard />
      </Reveal>

      <p className="mt-10 text-center text-xs text-text-muted">{l.disclaimer}</p>

      {children}
    </main>
  );
}
