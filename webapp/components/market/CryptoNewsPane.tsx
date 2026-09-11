"use client";

// Крипто-новости: заголовки изданий, которые сервер собирает из их RSS.
//
// Жили в разделе «ТВ»; раздел убран, а новости переехали на «Рынок», вкладкой
// сразу за скринером: заголовок дня и монета, которую он двигает, смотрятся
// рядом.
//
// Новости берём у своего сервера, а он - из RSS самих изданий. Раньше лента
// шла от CryptoCompare прямо из браузера; тот закрыл бесплатный доступ ключом,
// и раздел молча опустел.

import { useEffect, useState } from "react";
import { useIntlLocale, useT } from "@/lib/i18n";
import { useLocale, type Locale } from "@/lib/i18n/locale";
import { API_URL } from "@/lib/api";
import { CHIP, CHIP_OFF, CHIP_ON, Pane } from "@/components/app/Pane";

/** Строка ленты - так её отдаёт `/api/market/news`. */
interface NewsItem {
  title: string;
  url: string;
  source: string;
  /** Время публикации, секунды; 0 - издание его не указало. */
  published: number;
  summary: string;
}

/** Откуда лента на каждом языке - подписью в шапке панели. */
const NEWS_SOURCES: Record<Locale, string> = {
  ru: "ForkLog · Bits.media · Incrypted",
  en: "Cointelegraph · Decrypt · The Block",
};

function CryptoNewsFeed({ lang }: { lang: Locale }) {
  const t = useT();
  const numbers = useIntlLocale();
  // null - ещё грузится; пустой массив - сервер ответил, но новостей нет.
  const [news, setNews] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    setNews(null);
    fetch(`${API_URL}/api/market/news?lang=${lang}`, {
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: NewsItem[] } | null) => {
        if (alive) setNews(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => alive && setNews([]));
    return () => {
      alive = false;
    };
  }, [lang]);

  if (news === null) {
    return (
      <div className="space-y-2 p-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md bg-[var(--pane-hover)]"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (!news.length) {
    return <p className="py-10 text-center text-[12px] text-[var(--pane-muted)]">{t.market.news.loadFailed}</p>;
  }

  return (
    <ul className="max-h-[640px] divide-y divide-[var(--pane-border)] overflow-y-auto">
      {news.map((n) => (
        <li key={n.url}>
          <a
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2.5 transition-colors duration-150 hover:bg-[var(--pane-hover)]"
          >
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--pane-text)]">{n.title}</p>
            {n.summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--pane-muted)]">{n.summary}</p>}
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--pane-muted)]">
              <span className="font-semibold text-[var(--pane-chip)]">{n.source}</span>
              {n.published > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(n.published * 1000).toLocaleString(numbers, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function CryptoNewsPane() {
  const t = useT();
  // Язык ленты - по языку интерфейса, пока человек не выбрал другой сам:
  // англоязычные издания быстрее, русские - понятнее.
  const locale = useLocale();
  const [newsLang, setNewsLang] = useState<Locale | null>(null);
  const feedLang = newsLang ?? locale;

  return (
    <Pane
      title={t.market.news.title}
      hint={NEWS_SOURCES[feedLang]}
      body=""
      actions={(["ru", "en"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setNewsLang(lang)}
          className={`${CHIP} font-semibold uppercase ${feedLang === lang ? CHIP_ON : CHIP_OFF}`}
        >
          {lang}
        </button>
      ))}
    >
      <CryptoNewsFeed lang={feedLang} />
    </Pane>
  );
}
