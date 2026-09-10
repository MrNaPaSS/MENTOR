"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import Logo from "@/components/ui/Logo";
import LocaleSwitch from "@/components/ui/LocaleSwitch";
import { NAV_ANCHORS } from "@/lib/content";
import { useT } from "@/lib/i18n";
import { getAccessToken } from "@/lib/auth";

export interface HeaderLink {
  href: string;
  label: string;
}

interface HeaderProps {
  /**
   * Свой набор ссылок вместо якорей главной.
   *
   * Шапка одна на весь сайт, а якоря у страниц разные: на витрине
   * брокерской программы «Сигналы» и «Результаты» ведут в пустоту, потому
   * что таких разделов на ней нет. Ссылка, которая никуда не ведёт, дороже
   * отсутствующей: человек считает её сломанным сайтом, а не своей ошибкой.
   */
  links?: readonly HeaderLink[];
}

export default function Header({ links }: HeaderProps = {}) {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!getAccessToken());
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Блокируем скролл при открытом мобильном меню
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const nav: readonly HeaderLink[] =
    links ?? NAV_ANCHORS.map((l) => ({ href: l.href, label: t.landing.nav[l.key] }));

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border/70 bg-bg-deep/70 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        {/* Вошедшему знак ведёт в терминал: витрину он уже прочитал. */}
        <Logo href={authed ? "/app/scalping" : "/"} />

        {/* Центральная навигация (десктоп) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {nav.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Действия справа */}
        <div className="hidden items-center gap-2 md:flex">
          <LocaleSwitch />
          {authed ? (
            // С компьютера кабинет открывается терминалом: это рабочий стол
            // трейдера, с него начинается день. В меню телефона ниже дорога
            // ведёт в «Анализы» - три панели и стакан в сорок строк на ладони
            // не работают, и сам терминал с узкого экрана туда же и уводит.
            <Link href="/app/scalping" className="btn-primary">
              {t.common.cabinet} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link href="/login" className="btn-outline">
              {t.common.login}
            </Link>
          )}
        </div>

        {/* Бургер (мобайл) */}
        <button
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-lg text-text-primary ring-1 ring-border md:hidden"
          aria-label={t.common.menu}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Мобильное slide-in меню */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          className={`absolute inset-0 bg-bg-deep/60 transition-opacity ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 flex h-full w-80 max-w-[85%] flex-col gap-2 border-l border-border bg-bg-card p-5 transition-transform duration-300 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <Logo href={authed ? "/app/scalping" : "/"} />
            <button
              onClick={() => setOpen(false)}
              className="grid h-10 w-10 place-items-center rounded-lg text-text-primary ring-1 ring-border"
              aria-label={t.common.close}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {nav.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base text-text-secondary transition hover:bg-bg-panel/5 hover:text-text-primary"
            >
              {l.label}
            </a>
          ))}
          <LocaleSwitch className="mt-4 self-start" />

          <div className="mt-auto">
            {authed ? (
              <Link href="/app/analysis" className="btn-primary w-full">
                {t.common.cabinet} <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link href="/login" className="btn-primary w-full">
                {t.common.login}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
