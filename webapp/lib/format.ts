// Форматтеры значений (ТЗ §10.2 - числа моноширинным шрифтом, единый формат).

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

export function modeLabel(mode: string): string {
  return mode === "turbo" ? "ТУРБО" : "УМЕРЕННЫЙ";
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
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "никогда";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "-";

  const sec = Math.floor((now - ts) / 1000);
  if (sec < 0) return "только что";
  if (sec < 60) return "только что";
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;

  const days = Math.floor(sec / 86400);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} дн назад`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} мес назад`;
  return `${Math.floor(days / 365)} г назад`;
}

/** Дата и время для подсказки: 26.07.2026, 17:08. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "-";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Откуда появилась запись ученика. */
export function sourceLabel(via: string): string {
  if (via === "academy") return "академия";
  if (via === "web") return "сайт";
  return "бот";
}
