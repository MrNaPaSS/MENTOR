"use client";

// Сертификаты в аналитике, рядом с достижениями: три уровня и путь к ним.
//
// Полученный уровень открывается окном с подписью и печатью. Неполученный
// показывает, сколько столпов не хватает, а ниже - сами столпы с полосами:
// что осталось сделать, видно без справки.

import { useEffect, useState } from "react";
import { Award, BookOpen, Check, CalendarCheck, LineChart, Lock, Target } from "lucide-react";
import { api, type CertificatesOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useIntlLocale, useT } from "@/lib/i18n";
import { announceCertificates, CERT_UPDATED_EVENT, openCertificate } from "@/lib/certificates";
import { stampSrc, type CertLevel } from "@/lib/cert/render";

const LEVELS: { level: CertLevel; need: number }[] = [
  { level: "bronze", need: 2 },
  { level: "silver", need: 3 },
  { level: "gold", need: 4 },
];

const PILLAR_ICONS = {
  knowledge: BookOpen,
  practice: Target,
  discipline: CalendarCheck,
  growth: LineChart,
} as const;

export default function CertificatesPanel({ className = "" }: { className?: string }) {
  const t = useT();
  const numbers = useIntlLocale();
  const [data, setData] = useState<CertificatesOut | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api
      .certificates(token)
      .then((body) => {
        setData(body);
        announceCertificates(body);
      })
      .catch(() => {});
    const onUpdated = (e: Event) => {
      const body = (e as CustomEvent<CertificatesOut>).detail;
      if (body) setData(body);
    };
    window.addEventListener(CERT_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(CERT_UPDATED_EVENT, onUpdated);
  }, []);

  if (!data) return null;
  const done = data.pillars.filter((p) => p.done).length;

  return (
    <div className={`space-y-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-[var(--pane-gold)]" />
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.cert.title}</h2>
          <span className="hidden text-[11px] text-[var(--pane-muted)] sm:inline">{t.cert.hint}</span>
        </div>
        <span className="font-mono text-xs font-bold text-[var(--pane-gold)]">{done}/4</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {LEVELS.map(({ level, need }) => {
          const cert = data.certificates.find((c) => c.level === level);
          const reached = Boolean(cert);
          return (
            <button
              key={level}
              type="button"
              disabled={!cert}
              onClick={() => cert && openCertificate(cert.id)}
              className={`relative flex items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition-[transform,box-shadow] duration-200 ease-out ${
                reached
                  ? "border-accent-gold/40 shadow-[0_0_16px_rgba(240,185,11,0.18)] hover:-translate-y-0.5"
                  : "cursor-default border-[var(--pane-border)] opacity-70"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={stampSrc(level)}
                alt=""
                className={`h-14 w-14 shrink-0 object-contain ${reached ? "" : "opacity-40 grayscale"}`}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-[var(--pane-text)]">{t.cert.levels[level]}</p>
                <p className="text-[10px] text-[var(--pane-muted)]">{t.cert.need(need)}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold">
                  {cert ? (
                    <span className="flex items-center gap-1 text-[var(--pane-up)]">
                      <Check className="h-3 w-3" />
                      {cert.seen
                        ? t.cert.issued(
                            new Date(cert.issued_at).toLocaleDateString(numbers, { day: "numeric", month: "short" }),
                          )
                        : t.cert.open}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--pane-muted)]">
                      <Lock className="h-3 w-3" />
                      {t.cert.left(Math.max(0, need - done))}
                    </span>
                  )}
                </p>
              </div>
              {cert && !cert.seen && (
                <span className="absolute right-2 top-2 h-2 w-2 animate-ping rounded-full bg-[var(--pane-gold)] motion-reduce:animate-none" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {data.pillars.map((pillar) => {
          const Icon = PILLAR_ICONS[pillar.key];
          const share = Math.min(1, pillar.target > 0 ? pillar.value / pillar.target : 0);
          return (
            <div
              key={pillar.key}
              className="rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--pane-text)]">
                  <Icon className={`h-3.5 w-3.5 ${pillar.done ? "text-[var(--pane-up)]" : "text-[var(--pane-muted)]"}`} />
                  {t.cert.pillars[pillar.key]}
                </span>
                <span className="font-mono text-[10px] text-[var(--pane-muted)]">
                  {pillar.done ? <Check className="h-3 w-3 text-[var(--pane-up)]" /> : `${Math.min(pillar.value, pillar.target)}/${pillar.target}`}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--pane-muted)]">{t.cert.pillarHow[pillar.key]}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--pane-bg)]">
                <div
                  className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
                  style={{
                    transform: `scaleX(${share})`,
                    background: pillar.done ? "var(--pane-up)" : "var(--pane-gold)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
