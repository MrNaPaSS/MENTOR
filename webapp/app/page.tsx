import Header from "@/components/landing/Header";
import ScrollSceneMount from "@/components/landing/ScrollSceneMount";
import Hero from "@/components/landing/Hero";
import Exchanges from "@/components/landing/Exchanges";
import Problem from "@/components/landing/Problem";
import Terminal from "@/components/landing/Terminal";
import TradeCase from "@/components/landing/TradeCase";
import TradeFlow from "@/components/landing/TradeFlow";
import ValueStack from "@/components/landing/ValueStack";
import Analytics from "@/components/landing/Analytics";
import Certificate from "@/components/landing/Certificate";
import Showcase from "@/components/landing/Showcase";
import WhyFree from "@/components/landing/WhyFree";
import HowItWorks from "@/components/landing/HowItWorks";
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
      {/* Порядок разделов - порядок решения, а не порядок красоты:
          что это (Hero) -> кому верить (биржи) -> узнал ли себя (Problem) ->
          чем закрывается (Terminal) -> правда ли это работает (TradeCase) ->
          чем удобнее того, в чём торгую сейчас (TradeFlow) -> что ещё входит
          (ValueStack) -> чем это подтверждается (Certificate) -> в чём подвох
          (WhyFree) -> с чего начать (HowItWorks).

          Блок «четыре части одной системы» (WhyUs) с главной убран: его работу
          теперь делают ValueStack и WhyFree, и рядом с ними он повторял уже
          сказанное. Компонент остался в репозитории. */}
      <main>
        <Hero />
        <Exchanges />
        <Problem />
        <Terminal />
        <TradeCase />
        <TradeFlow />
        <ValueStack />
        <Analytics />
        <Certificate />
        <Showcase />
        <WhyFree />
        <HowItWorks />
        <Faq />
        <Socials />
      </main>
      <Footer />
    </>
  );
}
