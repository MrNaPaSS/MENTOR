import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import PageBackdrop from "@/components/ui/PageBackdrop";
import Footer from "@/components/landing/Footer";
import LeaderboardIntro from "@/components/landing/LeaderboardIntro";

export const metadata: Metadata = {
  title: "Лидерборд",
  description:
    "Лучшие трейдеры платформы NMNH - реальные результаты учеников, торгующих по сигналам. Топ по балансу, винрейту и сделкам.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage() {
  return (
    <>
      <PageBackdrop />
      <Header />
      <LeaderboardIntro />
      <Footer />
    </>
  );
}
