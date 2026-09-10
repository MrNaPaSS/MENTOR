import Link from "next/link";
import Header from "@/components/landing/Header";
import PageBackdrop from "@/components/ui/PageBackdrop";
import Footer from "@/components/landing/Footer";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, faqLd, webPageLd } from "@/lib/seo/jsonLd";
import type { SeoPage } from "@/lib/seo/pages/types";

/**
 * Страница витрины, написанная под поисковый запрос.
 *
 * Четыре такие страницы устроены одинаково, поэтому вёрстка у них одна на
 * всех, а различаются они только текстом - он приходит параметром из
 * lib/seo/pages.
 *
 * Компонент серверный и намеренно обходится без «use client»: весь текст,
 * ради которого страница существует, обязан быть в исходном HTML. Дорисованный
 * скриптом текст поисковик увидит в лучшем случае со второго захода, а по
 * конкурентным запросам второго захода может и не случиться. По той же причине
 * здесь нет ни раскрывающихся вопросов, ни появления по прокрутке: всё видно
 * сразу.
 *
 * Текст остаётся русским, тогда как остальная витрина переключает язык. Это
 * осознанно: язык здесь переключается в браузере, а у страницы под запрос
 * должен быть один адрес и один язык на нём - иначе поисковик видит на одном
 * URL то одно, то другое. Английские версии, когда понадобятся, получат
 * собственные адреса вида /en/terminal.
 */
export default function SeoArticle({ page }: { page: SeoPage }) {
  return (
    <>
      <JsonLd
        nodes={[
          webPageLd({
            path: page.path,
            name: page.h1,
            description: page.description,
          }),
          breadcrumbLd([
            { name: "Главная", path: "/" },
            { name: page.eyebrow, path: page.path },
          ]),
          // Вопросы те же, что видны ниже на странице: разметка обязана
          // повторять видимый текст слово в слово.
          faqLd(page.faq),
        ]}
      />

      {/* Тот же фон, что на главной: клетка и объёмная сцена позади текста.
          Страница остаётся серверной - фон ничего не дорисовывает к тексту,
          ради которого она существует, а сцена грузится отдельным куском
          после него. */}
      <PageBackdrop />
      <Header />

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-28 md:px-6 md:pt-32">
        <article>
          <span className="eyebrow">{page.eyebrow}</span>
          {/* Единственный H1 страницы: второй сбивает поисковику понимание
              того, о чём она вообще. */}
          <h1 className="text-h1 mt-2 text-text-primary">{page.h1}</h1>
          <p className="mt-6 text-lg leading-relaxed text-text-secondary">{page.lead}</p>

          {page.sections.map((section) => (
            <section key={section.heading} className="mt-14">
              <h2 className="text-h3 text-text-primary">{section.heading}</h2>
              {section.paragraphs.map((text) => (
                <p key={text} className="mt-4 leading-relaxed text-text-secondary">
                  {text}
                </p>
              ))}
              {section.bullets && (
                <ul className="mt-5 space-y-2.5">
                  {section.bullets.map((item) => (
                    <li key={item} className="flex gap-3 text-text-secondary">
                      <span
                        aria-hidden
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-cyan"
                      />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section className="mt-16">
            <h2 className="text-h3 text-text-primary">Частые вопросы</h2>
            <div className="mt-6 space-y-4">
              {page.faq.map((item) => (
                <div key={item.q} className="card">
                  <h3 className="font-semibold leading-snug text-text-primary">{item.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-16 rounded-2xl border border-border bg-bg-panel/60 p-8 text-center">
            <h2 className="text-h3 text-text-primary">{page.cta.heading}</h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-text-secondary">
              {page.cta.text}
            </p>
            <Link href="/login" className="btn-primary mt-6 inline-flex">
              Получить доступ
            </Link>
          </section>

          {/* Перелинковка - не украшение: поисковик обходит сайт по ссылкам, и
              страница, на которую не ведёт ни одна из них, для него не
              существует, даже если стоит в карте сайта. */}
          <nav className="mt-16" aria-label="Смежные разделы">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Читать дальше
            </h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {page.related.map((link) => (
                <li key={link.path}>
                  <Link
                    href={link.path}
                    className="block h-full rounded-xl border border-border p-4 transition hover:border-accent-cyan/40"
                  >
                    <span className="font-semibold text-text-primary">{link.label}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
                      {link.hint}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <p className="mt-12 text-xs leading-relaxed text-text-muted">
            Торговля криптовалютами связана с высоким риском, особенно с использованием
            большого плеча. Возможна полная потеря депозита. Материалы сайта носят
            информационный характер и не являются индивидуальной инвестиционной
            рекомендацией.
          </p>
        </article>
      </main>

      <Footer />
    </>
  );
}
