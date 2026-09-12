import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import PageBackdrop from "@/components/ui/PageBackdrop";
import Footer from "@/components/landing/Footer";
import LeaderboardIntro from "@/components/landing/LeaderboardIntro";
import SeoToolText from "@/components/seo/SeoToolText";
import { leaderboardPage } from "@/lib/seo/pages/leaderboard";

export const metadata: Metadata = {
  title: leaderboardPage.title,
  description: leaderboardPage.description,
  alternates: { canonical: leaderboardPage.path },
  openGraph: {
    title: leaderboardPage.title,
    description: leaderboardPage.description,
    url: leaderboardPage.path,
  },
};

export default function LeaderboardPage() {
  return (
    <>
      <PageBackdrop />
      <Header />
      <LeaderboardIntro>
        <SeoToolText page={leaderboardPage} />
      </LeaderboardIntro>
      <Footer />
    </>
  );
}
