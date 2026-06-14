import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Badge from "@/components/ui/Badge";
import Leaderboard from "@/components/Leaderboard";

export const metadata: Metadata = {
  title: "Лидерборд",
  description:
    "Лучшие трейдеры платформы NMNH — реальные результаты учеников, торгующих по сигналам. Топ по балансу, винрейту и сделкам.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28 md:px-6 md:pt-32">
        <div className="flex justify-center">
          <Badge variant="gold">Обновляется в реальном времени</Badge>
        </div>
        <SectionHeading
          className="mt-4"
          eyebrow="Лидерборд"
          title="Лучшие трейдеры платформы"
          subtitle="Реальные результаты учеников, торгующих по сигналам. Топ-3 отмечены медалями."
        />

        <Reveal className="mt-12">
          <Leaderboard />
        </Reveal>

        <p className="mt-10 text-center text-xs text-text-muted">
          Результаты отражают торговлю конкретных учеников и не гарантируют доходность в будущем.
        </p>
      </main>
      <Footer />
    </>
  );
}
