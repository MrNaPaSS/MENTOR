import Link from "next/link";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, faqLd, webPageLd } from "@/lib/seo/jsonLd";
import type { SeoToolPage } from "@/lib/seo/pages/types";

/**
 * Текст под открытым инструментом, например калькулятором.
 *
 * Такие инструменты клиентские и рисуются уже в браузере - в исходном HTML от
 * них остаётся пустая рамка, и страница выглядела для поисковика пустой: её
 * сканировали, но в выдачу не брали. Этот блок даёт ей текст.
 *
 * Компонент серверный по той же причине, что SeoArticle: текст обязан быть в
 * HTML с первого ответа. Вставляется в клиентскую обёртку страницы через
 * children - так он остаётся серверным и живёт внутри её <main>.
 *
 * Текст русский при переключаемом языке витрины, причина та же, что у
 * SeoArticle: один адрес - один язык.
 */
export default function SeoToolText({ page }: { page: SeoToolPage }) {
  return (
    <div className="mx-auto mt-20 max-w-3xl text-left">
      <JsonLd
        nodes={[
          webPageLd({ path: page.path, name: page.name, description: page.description }),
          breadcrumbLd([
            { name: "Главная", path: "/" },
            { name: page.name, path: page.path },
          ]),
          // Те же вопросы, что видны ниже: разметка повторяет видимый текст.
          faqLd(page.faq),
        ]}
      />

      {page.sections.map((section) => (
        <section key={section.heading} className="mt-14 first:mt-0">
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
    </div>
  );
}
