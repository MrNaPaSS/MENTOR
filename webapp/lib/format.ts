// Форматтеры значений (ТЗ §10.2 - числа моноширинным шрифтом, единый формат).
//
// Словами говорят не только числа: «5 мин назад», «умеренный», «академия» -
// это тоже интерфейс, и на английском он обязан быть английским. Язык берётся
// в момент вызова: форматтер зовут из компонента, который на смену языка уже
// подписан, и второй подписки ему не нужно.

import { dict, intlLocale, type Locale } from "@/lib/i18n";

export function fmtUsd(
  v: string | number | null | undefined,
  maxFraction = 2
): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFraction });
}

export function fmtPct(
  v: string | number | null | undefined,
  digits = 1
): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  return Number.isNaN(n) ? "-" : n.toFixed(digits);
}

export function fmtRR(v: string | number): string {
  return `1:${Number(v).toFixed(1)}`;
}

export function modeLabel(mode: string, locale?: Locale): string {
  const t = dict(locale).format;
  return mode === "turbo" ? t.modeTurbo : t.modeModerate;
}

export function isLong(direction: string): boolean {
  return direction?.toUpperCase() === "LONG";
}

export function maskUid(uid: string | null | undefined): string {
  if (!uid) return "-";
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 2)}•••${uid.slice(-3)}`;
}

/** Когда это было, словами: «5 мин назад», «3 дня назад». */
export function fmtAgo(
  iso: string | null | undefined,
  now = Date.now(),
  locale?: Locale
): string {
  const t = dict(locale).format.ago;
  if (!iso) return t.never;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "-";

  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60) return t.now;
  if (sec < 3600) return t.minutes(Math.floor(sec / 60));
  if (sec < 86400) return t.hours(Math.floor(sec / 3600));

  const days = Math.floor(sec / 86400);
  if (days === 1) return t.yesterday;
  if (days < 30) return t.days(days);
  const months = Math.floor(days / 30);
  if (months < 12) return t.months(months);
  return t.years(Math.floor(days / 365));
}

/** Дата и время для подсказки: 26.07.2026, 17:08. */
export function fmtDateTime(iso: string | null | undefined, locale?: Locale): string {
  if (!iso) return "-";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "-";
  return new Date(ts).toLocaleString(intlLocale(locale), {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Откуда появилась запись ученика. */
export function sourceLabel(via: string, locale?: Locale): string {
  const t = dict(locale).format.source;
  if (via === "academy") return t.academy;
  if (via === "web") return t.web;
  return t.bot;
}
