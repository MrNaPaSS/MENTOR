"use client";

import Link from "next/link";
import { SiTelegram } from "@icons-pack/react-simple-icons";
import Logo from "@/components/ui/Logo";
import { NAV_ANCHORS, SOCIAL_LINKS, weexRegisterUrl } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

export default function Footer() {
  const t = useT();
  const locale = useLocale();

  return (
    <footer className="border-t border-border bg-bg-panel/60">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-text-secondary">
              {t.landing.footer.about}
            </p>
            <div className="mt-5 flex gap-3">
              <a href={SOCIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary ring-1 ring-border transition hover:text-accent-cyan hover:ring-accent-cyan/40">
                <SiTelegram className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{t.landing.footer.navHeading}</h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              {NAV_ANCHORS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-text-secondary transition hover:text-text-primary">
                    {t.landing.nav[l.key]}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/calculator" className="text-text-secondary transition hover:text-text-primary">
                  {t.landing.footer.calculator}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{t.landing.footer.partnerHeading}</h4>
            <a
              href={weexRegisterUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent-cyan/40"
            >
              {t.landing.footer.weexButton}
            </a>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-sm text-text-muted">
          <p>{t.landing.footer.rights}</p>
          <p className="mt-1 max-w-3xl">
            {t.landing.footer.disclaimer}
          </p>
        </div>
      </div>
    </footer>
  );
}
