import Link from "next/link";
import { SiTelegram } from "@icons-pack/react-simple-icons";
import Logo from "@/components/ui/Logo";
import { NAV_LINKS, SOCIAL_LINKS } from "@/lib/content";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-bg-panel/60">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-text-secondary">
              Финтех-платформа торгового ментора No Money No Honey. Персональные сигналы под депозит,
              аналитика и закрытое сообщество.
            </p>
            <div className="mt-5 flex gap-3">
              <a href={SOCIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary ring-1 ring-border transition hover:text-accent-cyan hover:ring-accent-cyan/40">
                <SiTelegram className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Навигация</h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-text-secondary transition hover:text-white">
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/calculator" className="text-text-secondary transition hover:text-white">
                  Калькулятор
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Партнёр</h4>
            <a
              href={SOCIAL_LINKS.weexAffiliate}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-white transition hover:border-accent-cyan/40"
            >
              Биржа WEEX →
            </a>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-sm text-text-muted">
          <p>© 2020 NMNH. Все права защищены.</p>
          <p className="mt-1 max-w-3xl">
            Торговля криптовалютами связана с высоким риском, особенно с использованием большого плеча
            (до x400 в турбо-режиме). Возможна полная потеря депозита. Это не финансовый совет.
          </p>
        </div>
      </div>
    </footer>
  );
}
