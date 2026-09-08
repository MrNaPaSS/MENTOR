"use client";

// Переключатель языка для тех, кто ещё не вошёл.
//
// В кабинете язык меняется в профиле и уезжает на сервер вместе с остальными
// настройками. Но лендинг и страницу входа читают до всякого профиля, и
// англоязычному гостю иначе некуда нажать: он упирается в русский текст на
// первом же экране.

import { Globe } from "lucide-react";
import { setLocale, useLocale, type Locale } from "@/lib/i18n";

const LOCALES: Locale[] = ["ru", "en"];

export default function LocaleSwitch({ className = "" }: { className?: string }) {
  const locale = useLocale();

  return (
    <div
      className={`flex items-center gap-0.5 rounded-full border border-border px-1 py-0.5 ${className}`}
    >
      <Globe className="ml-1 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          aria-pressed={locale === value}
          className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
            locale === value
              ? "bg-accent-cyan/15 text-accent-cyan"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
