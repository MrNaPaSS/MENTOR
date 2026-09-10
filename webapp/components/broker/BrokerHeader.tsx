"use client";

import Header from "@/components/landing/Header";
import { useT } from "@/lib/i18n";

/**
 * Шапка со своими разделами.
 *
 * Отдельным клиентским компонентом, потому что подписи берутся из словаря, а
 * страница вокруг - серверная и о языке посетителя не знает.
 */
export default function BrokerHeader() {
  const t = useT();

  return (
    <Header
      links={[
        { href: "#how", label: t.broker.nav.how },
        { href: "#calculator", label: t.broker.nav.calculator },
        { href: "#plans", label: t.broker.nav.plans },
        { href: "#exchanges", label: t.broker.nav.exchanges },
        { href: "#faq", label: t.broker.nav.faq },
      ]}
    />
  );
}
