import Header from "@/components/landing/Header";
import ScrollSceneMount from "@/components/landing/ScrollSceneMount";
import Hero from "@/components/landing/Hero";
import Terminal from "@/components/landing/Terminal";
import HowItWorks from "@/components/landing/HowItWorks";
import PublicSignals from "@/components/landing/PublicSignals";
import PlatformStats from "@/components/landing/PlatformStats";
import Testimonials from "@/components/landing/Testimonials";
import Faq from "@/components/landing/Faq";
import Socials from "@/components/landing/Socials";
import Footer from "@/components/landing/Footer";
import JsonLd from "@/components/seo/JsonLd";
import { faqLd, terminalAppLd, webPageLd } from "@/lib/seo/jsonLd";
import { landing } from "@/lib/i18n/dict/ru/landing";

export default function Home() {
  return (
    <>
      {/* Вопросы берём из того же словаря, которым нарисован блок FAQ ниже:
          разметка обязана слово в слово повторять видимый текст, иначе Google
          считает её обманом и снимает оформление со всей выдачи сайта. */}
      <JsonLd
        nodes={[
          webPageLd({
            path: "/",
            name: "Торговый терминал для скальпинга криптовалют - NMNH",
            description:
              "Бесплатный терминал для скальпинга криптовалют, сообщество трейдеров и журнал сделок с аналитикой по отчётам биржи.",
          }),
          terminalAppLd(),
          faqLd(landing.faq.items),
        ]}
      />
      <ScrollSceneMount />
      <Header />
      <main>
        <Hero />
        <Terminal />
        <HowItWorks />
        <PublicSignals />
        <PlatformStats />
        <Testimonials />
        <Faq />
        <Socials />
      </main>
      <Footer />
    </>
  );
}
