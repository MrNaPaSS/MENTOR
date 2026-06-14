// Форматтеры значений (ТЗ §10.2 — числа моноширинным шрифтом, единый формат).

export function fmtUsd(
  v: string | number | null | undefined,
  maxFraction = 2
): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFraction });
}

export function fmtPct(
  v: string | number | null | undefined,
  digits = 1
): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? "—" : n.toFixed(digits);
}

export function fmtRR(v: string | number): string {
  return `1:${Number(v).toFixed(1)}`;
}

export function modeLabel(mode: string): string {
  return mode === "turbo" ? "⚡ ТУРБО" : "📊 УМЕРЕННЫЙ";
}

export function isLong(direction: string): boolean {
  return direction?.toUpperCase() === "LONG";
}

export function maskUid(uid: string | null | undefined): string {
  if (!uid) return "—";
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 2)}•••${uid.slice(-3)}`;
}
