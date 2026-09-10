import type { Metadata } from "next";
import BackdropGrid from "@/components/ui/BackdropGrid";
import BrokerHeader from "@/components/broker/BrokerHeader";
import Footer from "@/components/landing/Footer";
import BrokerHero from "@/components/broker/BrokerHero";
import FeeFlow from "@/components/broker/FeeFlow";
import SavingsCalculator from "@/components/broker/SavingsCalculator";
import SubscriptionMath from "@/components/broker/SubscriptionMath";
import WhatsIncluded from "@/components/broker/WhatsIncluded";
import ExchangeTable from "@/components/broker/ExchangeTable";
import BrokerSteps from "@/components/broker/BrokerSteps";
import BrokerFaq from "@/components/broker/BrokerFaq";
import BrokerCta from "@/components/broker/BrokerCta";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, faqLd, webPageLd } from "@/lib/seo/jsonLd";
import { broker } from "@/lib/i18n/dict/ru/broker";

/**
 * Страница брокерской программы.
 *
 * Метаданные и разметка берут русский словарь напрямую: они уезжают
 * поисковику ещё на сборке, когда языка посетителя никто не знает, и русский
 * здесь - язык по умолчанию для всего сайта.
 */
export const metadata: Metadata = {
  title: broker.meta.title,
  description: broker.meta.description,
  alternates: { canonical: "/broker" },
  openGraph: {
    title: broker.meta.title,
    description: broker.meta.description,
    url: "/broker",
    type: "website",
    // Своя картинка вместо общей: страницу пересылают в чатах ради цифры о
    // возврате комиссии, и превью с рабочим местом объясняет её быстрее, чем
    // заголовок. Метка версии - потому что превью кэшируют все, кому его
    // однажды отдали, и держат старое неделями.
    images: [{ url: "/broker/og-broker.jpg?v=1", width: 1200, height: 630, type: "image/jpeg" }],
  },
  twitter: { card: "summary_large_image", images: ["/broker/og-broker.jpg?v=1"] },
};

export default function BrokerPage() {
  return (
    <>
      {/* Вопросы в разметке обязаны слово в слово повторять видимые: иначе
          Google считает разметку обманом и снимает оформление со всей выдачи
          сайта, а не только с этой страницы. */}
      <JsonLd
        nodes={[
          webPageLd({
            path: "/broker",
            name: broker.meta.title,
            description: broker.meta.description,
          }),
          breadcrumbLd([
            { name: "NMNH", path: "/" },
            { name: broker.hero.eyebrow, path: "/broker" },
          ]),
          faqLd(broker.faq.items),
        ]}
      />
      <BackdropGrid />
      <BrokerHeader />
      <main>
        <BrokerHero />
        <FeeFlow />
        <SavingsCalculator />
        <SubscriptionMath />
        <WhatsIncluded />
        <ExchangeTable />
        <BrokerSteps />
        <BrokerFaq />
        <BrokerCta />
      </main>
      <Footer />
    </>
  );
}
