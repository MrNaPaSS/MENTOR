"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import Logo from "@/components/ui/Logo";
import { NAV_LINKS } from "@/lib/content";
import { getAccessToken } from "@/lib/auth";

export default function Header() {
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

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border/70 bg-bg-deep/70 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <Logo />

        {/* Центральная навигация (десктоп) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Действия справа */}
        <div className="hidden items-center gap-2 md:flex">
          {authed ? (
            <Link href="/app/dashboard" className="btn-primary">
              Кабинет <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link href="/login" className="btn-outline">
              Войти
            </Link>
          )}
        </div>

        {/* Бургер (мобайл) */}
        <button
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-lg text-white ring-1 ring-border md:hidden"
          aria-label="Меню"
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
          className={`absolute inset-0 bg-black/60 transition-opacity ${
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
            <Logo />
            <button
              onClick={() => setOpen(false)}
              className="grid h-10 w-10 place-items-center rounded-lg text-white ring-1 ring-border"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base text-text-secondary transition hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-auto">
            {authed ? (
              <Link href="/app/dashboard" className="btn-primary w-full">
                Кабинет <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link href="/login" className="btn-primary w-full">
                Войти
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
