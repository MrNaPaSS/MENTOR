import type { Metadata } from "next";

import ScrollSceneMount from "@/components/landing/ScrollSceneMount";
import Footer from "@/components/landing/Footer";
import PricingPage from "@/components/pricing/PricingPage";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, faqLd, webPageLd } from "@/lib/seo/jsonLd";
import { pricing } from "@/lib/i18n/dict/ru/pricing";

/**
 * Страница подписки на терминал.
 *
 * Второй вход для трейдера, у которого счёт уже открыт мимо нашей ссылки:
 * партнёрская модель его не видит, и терминал ему оплачивает не биржа, а он
 * сам. Метаданные и разметка берут русский словарь напрямую - они уезжают
 * поисковику на сборке, когда языка посетителя ещё никто не знает.
 */
export const metadata: Metadata = {
  title: pricing.meta.title,
  description: pricing.meta.description,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: pricing.meta.title,
    description: pricing.meta.description,
    url: "/pricing",
    type: "website",
  },
};

export default function Pricing() {
  return (
    <>
      <JsonLd
        nodes={[
          webPageLd({
            path: "/pricing",
            name: pricing.meta.title,
            description: pricing.meta.description,
          }),
          breadcrumbLd([
            { name: "NMNH", path: "/" },
            { name: pricing.nav.plans, path: "/pricing" },
          ]),
          faqLd(pricing.faq.items),
        ]}
      />
      <ScrollSceneMount />
      <PricingPage />
      <Footer />
    </>
  );
}
