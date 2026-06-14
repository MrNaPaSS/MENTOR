import Header from "@/components/landing/Header";
import ScrollSceneMount from "@/components/landing/ScrollSceneMount";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import PublicSignals from "@/components/landing/PublicSignals";
import PlatformStats from "@/components/landing/PlatformStats";
import Testimonials from "@/components/landing/Testimonials";
import Faq from "@/components/landing/Faq";
import Socials from "@/components/landing/Socials";
import Footer from "@/components/landing/Footer";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Calculator from "@/components/Calculator";
import Leaderboard from "@/components/Leaderboard";

export default function Home() {
  return (
    <>
      <ScrollSceneMount />
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <PublicSignals />

        {/* Калькулятор */}
        <section id="calculator" className="mx-auto max-w-5xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeading
            eyebrow="Калькулятор"
            title="Посчитай позицию до входа"
            subtitle="Маржа, объём, риск и профит по каждому тейк-профиту — мгновенно."
          />
          <Reveal className="mt-12">
            <Calculator />
          </Reveal>
        </section>

        <PlatformStats />

        {/* Лидерборд */}
        <section id="leaderboard" className="mx-auto max-w-5xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeading
            eyebrow="Лидерборд"
            title="Лучшие трейдеры платформы"
            subtitle="Реальные результаты учеников, торгующих по сигналам."
          />
          <Reveal className="mt-12">
            <Leaderboard limit={10} showHeading={false} />
          </Reveal>
        </section>

        <Testimonials />
        <Faq />
        <Socials />
      </main>
      <Footer />
    </>
  );
}
