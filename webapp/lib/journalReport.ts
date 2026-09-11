// Отчёт по журналу сделок: один HTML-файл с диаграммами.
//
// Выгрузка журнала - функция маркета, и выглядеть она должна как вещь, за
// которую заплатили: не таблица, а разбор торговли. Файл самодостаточный -
// стили и диаграммы внутри, внешних ссылок нет, - открывается в любом
// браузере без интернета, печатается в PDF, а данные из него забираются
// кнопкой CSV для Excel.
//
// Всё, что пришло от человека (заметки, монеты), экранируется: файл
// открывают в браузере, и строка из заметки не должна стать разметкой.

import type { JournalTrade } from "./journal";
import { journalCsv } from "./journalCsv";
import { journalStats, type JournalStats } from "./journalStats";

export type ReportText = {
  title: string;
  subtitle: string;
  period: (from: string, to: string) => string;
  made: (at: string) => string;
  quota: (used: number, limit: number) => string;
  result: string;
  kpi: {
    trades: string;
    winRate: string;
    profitFactor: string;
    avgWin: string;
    avgLoss: string;
    drawdown: string;
    fees: string;
    volume: string;
    best: string;
    worst: string;
    streaks: string;
    streaksValue: (wins: number, losses: number) => string;
  };
  wins: (wins: number, losses: number) => string;
  equity: string;
  equityHint: string;
  days: string;
  daysHint: string;
  outcomes: string;
  outcome: { take: string; stop: string; manual: string };
  sides: string;
  side: { long: string; short: string };
  symbols: string;
  hours: string;
  hoursHint: string;
  table: {
    title: string;
    closed: string;
    coin: string;
    side: string;
    entry: string;
    exit: string;
    qty: string;
    outcome: string;
    fee: string;
    result: string;
  };
  csv: string;
  print: string;
  empty: string;
  footer: string;
};

export type ReportOptions = {
  text: ReportText;
  /** Кто выгружает: имя в шапке. */
  owner?: string;
  /** Какая по счёту выгрузка месяца и из скольких. */
  quota?: { used: number; limit: number };
  now?: Date;
};

const UP = "#0ecb81";
const DOWN = "#f6465d";
const GOLD = "#f0b90b";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number, sign = true): string {
  const text = Math.abs(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!sign) return `${text} $`;
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text} $`;
}

function price(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

function date(iso: string | null, withTime = false): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

const tone = (value: number) => (value > 0 ? UP : value < 0 ? DOWN : MUTED);

// ── Диаграммы ──────────────────────────────────────────────────────────────

const W = 720;

/** Кривая капитала: накопленный итог после каждой сделки. */
function equityChart(stats: JournalStats): string {
  const points = stats.equity;
  if (points.length < 2) return "";
  const H = 220;
  const pad = { l: 56, r: 12, t: 14, b: 26 };
  const values = [0, ...points.map((p) => p.value)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = points.at(-1)!.value;
  const color = last >= 0 ? UP : DOWN;
  const ticks = [max, (max + min) / 2, min]
    .map(
      (v) =>
        `<text x="${pad.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="axis">${esc(
          Math.round(v).toLocaleString("ru-RU"),
        )}</text><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${LINE}" stroke-dasharray="3 4"/>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="equity">
    <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${ticks}
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${MUTED}" stroke-opacity="0.5"/>
    <path d="${area}" fill="url(#eq)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4" fill="${color}"/>
    <text x="${pad.l}" y="${H - 6}" class="axis">${esc(date(points[0].at))}</text>
    <text x="${W - pad.r}" y="${H - 6}" text-anchor="end" class="axis">${esc(date(points.at(-1)!.at))}</text>
  </svg>`;
}

/** Столбцы вверх и вниз от нуля: итог дня, итог часа. */
function barsChart(values: { label: string; value: number }[], H = 200, labelEvery = 1): string {
  if (!values.length) return "";
  const pad = { l: 12, r: 12, t: 12, b: 24 };
  const top = Math.max(0, ...values.map((v) => v.value));
  const bottom = Math.min(0, ...values.map((v) => v.value));
  const span = top - bottom || 1;
  const zero = pad.t + (top / span) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / values.length;
  const bar = Math.max(2, Math.min(28, slot * 0.66));
  const bars = values
    .map((v, i) => {
      const h = (Math.abs(v.value) / span) * (H - pad.t - pad.b);
      const cx = pad.l + slot * i + slot / 2;
      const yTop = v.value >= 0 ? zero - h : zero;
      const label =
        i % labelEvery === 0
          ? `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(v.label)}</text>`
          : "";
      return `<rect x="${(cx - bar / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${tone(v.value)}"><title>${esc(v.label)}: ${esc(money(v.value))}</title></rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="${MUTED}" stroke-opacity="0.5"/>
    ${bars}
  </svg>`;
}

/** Кольцо исходов: цель, стоп, вручную. */
function donut(stats: JournalStats, text: ReportText): string {
  const parts = [
    { key: "take", value: stats.outcomes.take, color: UP, label: text.outcome.take },
    { key: "stop", value: stats.outcomes.stop, color: DOWN, label: text.outcome.stop },
    { key: "manual", value: stats.outcomes.manual, color: GOLD, label: text.outcome.manual },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return "";
  const R = 62;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const rings = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const length = (p.value / total) * C;
      const ring = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${length.toFixed(2)} ${(C - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 90 90)"/>`;
      offset += length;
      return ring;
    })
    .join("");
  const legend = parts
    .map(
      (p) =>
        `<div class="legend"><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b>${p.value}</b><em>${Math.round(
          (p.value / total) * 100,
        )}%</em></div>`,
    )
    .join("");
  return `<div class="donut"><svg viewBox="0 0 180 180" width="180" height="180" role="img">
      <circle r="${R}" cx="90" cy="90" fill="none" stroke="${LINE}" stroke-width="22"/>${rings}
      <text x="90" y="88" text-anchor="middle" class="big">${total}</text>
      <text x="90" y="108" text-anchor="middle" class="axis">${esc(text.kpi.trades)}</text>
    </svg><div>${legend}</div></div>`;
}

/** Горизонтальные столбцы по монетам: крупнейшие по модулю итога. */
function symbolsChart(stats: JournalStats): string {
  const rows = stats.symbols.slice(0, 10);
  if (!rows.length) return "";
  const most = Math.max(...rows.map((r) => Math.abs(r.pnl))) || 1;
  return `<div class="hbars">${rows
    .map((r) => {
      const width = Math.max(2, (Math.abs(r.pnl) / most) * 100);
      return `<div class="hbar"><span class="coin">${esc(r.symbol.replace(/USDT$/, ""))}</span>
        <span class="track"><span style="width:${width.toFixed(1)}%;background:${tone(r.pnl)}"></span></span>
        <b style="color:${tone(r.pnl)}">${esc(money(r.pnl))}</b><em>${r.count} · ${Math.round((r.wins / r.count) * 100)}%</em></div>`;
    })
    .join("")}</div>`;
}

function sidesBlock(stats: JournalStats, text: ReportText): string {
  const side = (label: string, s: JournalStats["long"], color: string) => `
    <div class="side"><div class="side-head"><i style="background:${color}"></i>${esc(label)}</div>
      <div class="side-num" style="color:${tone(s.pnl)}">${esc(money(s.pnl))}</div>
      <div class="side-sub">${s.count} · ${s.count ? Math.round((s.wins / s.count) * 100) : 0}%</div></div>`;
  return `<div class="sides">${side(text.side.long, stats.long, UP)}${side(text.side.short, stats.short, DOWN)}</div>`;
}

// ── Отчёт ──────────────────────────────────────────────────────────────────

export function journalReport(trades: readonly JournalTrade[], options: ReportOptions): string {
  const { text } = options;
  const now = options.now ?? new Date();
  const stats = journalStats(trades);
  const csv = journalCsv(trades);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const stamp = now.toISOString().slice(0, 10);

  const kpis: [string, string, string?][] = [
    [text.kpi.trades, String(stats.count), text.wins(stats.wins, stats.losses)],
    [text.kpi.winRate, `${stats.winRate.toLocaleString("ru-RU")}%`],
    [text.kpi.profitFactor, stats.profitFactor === null ? "∞" : stats.profitFactor.toLocaleString("ru-RU")],
    [text.kpi.drawdown, money(-stats.maxDrawdown)],
    [text.kpi.avgWin, money(stats.avgWin)],
    [text.kpi.avgLoss, money(stats.avgLoss)],
    [text.kpi.best, money(stats.best)],
    [text.kpi.worst, money(stats.worst)],
    [text.kpi.fees, money(stats.fees, false)],
    [text.kpi.volume, money(stats.volume, false)],
    [text.kpi.streaks, text.kpi.streaksValue(stats.longestWinStreak, stats.longestLossStreak)],
  ];

  // Итог по дням: последние шестьдесят торговых дней, иначе столбцы в нитку.
  const days = stats.days.slice(-60).map((d) => ({ label: d.day.slice(8, 10) + "." + d.day.slice(5, 7), value: d.pnl }));
  const hours = stats.hours.map((value, h) => ({ label: String(h), value }));

  const rows = [...trades]
    .sort((a, b) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime())
    .map(
      (t) => `<tr>
        <td>${esc(date(t.closed_at, true))}</td>
        <td class="coin">${esc(t.symbol.replace(/USDT$/, ""))}</td>
        <td><span class="pill ${t.side}">${esc(t.side === "long" ? text.side.long : text.side.short)}</span></td>
        <td class="num">${esc(price(t.entry))}</td>
        <td class="num">${esc(price(t.exit_price))}</td>
        <td class="num">${esc(price(t.qty))}</td>
        <td>${esc(text.outcome[t.outcome] ?? t.outcome)}</td>
        <td class="num">${esc(money(t.fee || 0, false))}</td>
        <td class="num" style="color:${tone(t.pnl)};font-weight:700">${esc(money(t.pnl))}</td>
      </tr>`,
    )
    .join("");

  const card = (title: string, body: string, hint = "") =>
    body ? `<section class="card"><h2>${esc(title)}</h2>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}${body}</section>` : "";

  const body = !stats.count
    ? `<section class="card"><p class="hint">${esc(text.empty)}</p></section>`
    : `
    <section class="hero card">
      <div>
        <div class="label">${esc(text.result)}</div>
        <div class="result" style="color:${tone(stats.pnl)}">${esc(money(stats.pnl))}</div>
        <div class="hint">${esc(text.wins(stats.wins, stats.losses))} · ${esc(text.kpi.winRate)} ${stats.winRate.toLocaleString("ru-RU")}%</div>
      </div>
      <div class="kpis">${kpis
        .map(
          ([label, value, sub]) =>
            `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<em>${esc(sub)}</em>` : ""}</div>`,
        )
        .join("")}</div>
    </section>
    ${card(text.equity, equityChart(stats), text.equityHint)}
    <div class="two">
      ${card(text.outcomes, donut(stats, text))}
      ${card(text.sides, sidesBlock(stats, text))}
    </div>
    ${card(text.days, barsChart(days, 200, Math.max(1, Math.ceil(days.length / 15))), text.daysHint)}
    <div class="two">
      ${card(text.symbols, symbolsChart(stats))}
      ${card(text.hours, barsChart(hours, 300, 3), text.hoursHint)}
    </div>
    <section class="card"><h2>${esc(text.table.title)}</h2>
      <div class="scroll"><table>
        <thead><tr><th>${esc(text.table.closed)}</th><th>${esc(text.table.coin)}</th><th>${esc(text.table.side)}</th>
        <th class="num">${esc(text.table.entry)}</th><th class="num">${esc(text.table.exit)}</th><th class="num">${esc(text.table.qty)}</th>
        <th>${esc(text.table.outcome)}</th><th class="num">${esc(text.table.fee)}</th><th class="num">${esc(text.table.result)}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(text.title)} · ${esc(stamp)}</title>
<style>
  :root { --up:${UP}; --down:${DOWN}; --gold:${GOLD}; --ink:${INK}; --muted:${MUTED}; --line:${LINE}; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f4f6f9; color:var(--ink); font:14px/1.45 -apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; }
  .page { max-width:1120px; margin:0 auto; padding:28px 20px 40px; }
  header { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; justify-content:space-between; margin-bottom:18px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .mark { width:52px; height:52px; border-radius:14px; background:linear-gradient(135deg,#0b1220,#1e293b); color:var(--up); display:grid; place-items:center; font-weight:900; font-size:12px; letter-spacing:.02em; }
  h1 { margin:0; font-size:22px; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:12px; }
  .meta { text-align:right; color:var(--muted); font-size:12px; }
  .meta b { color:var(--ink); }
  .actions { display:flex; gap:8px; margin-top:8px; justify-content:flex-end; }
  .btn { border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:10px; padding:7px 12px; font-weight:600; font-size:12px; font-family:inherit; cursor:pointer; text-decoration:none; }
  .btn.primary { background:var(--ink); color:#fff; border-color:var(--ink); }
  .card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:18px; margin-bottom:14px; break-inside:avoid; }
  .card h2 { margin:0 0 4px; font-size:14px; }
  .hint { margin:0 0 10px; color:var(--muted); font-size:12px; }
  .hero { display:grid; grid-template-columns:minmax(220px,1fr) 2.2fr; gap:20px; align-items:center; }
  .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
  .result { font-size:40px; font-weight:800; letter-spacing:-.02em; margin:4px 0; }
  .kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
  .kpi { background:#f8fafc; border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
  .kpi span { display:block; color:var(--muted); font-size:11px; }
  .kpi b { display:block; font-size:16px; margin-top:2px; }
  .kpi em { display:block; font-style:normal; color:var(--muted); font-size:11px; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .two .card { margin-bottom:14px; }
  svg { width:100%; height:auto; display:block; }
  .axis { font-size:11px; fill:var(--muted); }
  .big { font-size:30px; font-weight:800; fill:var(--ink); }
  .donut { display:flex; align-items:center; gap:18px; }
  .donut svg { width:180px; flex:none; }
  .legend { display:grid; grid-template-columns:12px 1fr auto auto; gap:8px; align-items:center; margin:6px 0; font-size:13px; }
  .legend i { width:12px; height:12px; border-radius:4px; }
  .legend em { color:var(--muted); font-style:normal; font-size:12px; }
  .sides { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .side { background:#f8fafc; border:1px solid var(--line); border-radius:12px; padding:14px; }
  .side-head { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; }
  .side-head i { width:10px; height:10px; border-radius:50%; }
  .side-num { font-size:24px; font-weight:800; margin-top:6px; }
  .side-sub { color:var(--muted); font-size:12px; }
  .hbars { display:grid; gap:8px; }
  .hbar { display:grid; grid-template-columns:64px 1fr auto 70px; gap:10px; align-items:center; font-size:13px; }
  .hbar .coin { font-weight:700; }
  .hbar .track { height:10px; background:#f1f5f9; border-radius:6px; overflow:hidden; }
  .hbar .track span { display:block; height:100%; border-radius:6px; }
  .hbar em { color:var(--muted); font-style:normal; font-size:11px; text-align:right; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid #f1f5f9; white-space:nowrap; }
  tbody tr:nth-child(even) td { background:#fafbfc; }
  .num { text-align:right; }
  td.coin { font-weight:700; }
  .pill { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .pill.long { background:rgba(14,203,129,.12); color:#079a60; }
  .pill.short { background:rgba(246,70,93,.12); color:#d0304a; }
  footer { color:var(--muted); font-size:11px; text-align:center; margin-top:18px; }
  @media (max-width: 820px) { .hero, .two { grid-template-columns:1fr; } .kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .meta { text-align:left; } .actions { justify-content:flex-start; } }
  @media print { body { background:#fff; } .actions { display:none; } .card { border-color:#e5e7eb; } .page { padding:0; } }
</style></head>
<body><div class="page">
  <header>
    <div class="brand"><div class="mark">NMNH</div><div>
      <h1>${esc(text.title)}</h1>
      <div class="sub">${esc(text.subtitle)}${options.owner ? ` · ${esc(options.owner)}` : ""}</div>
    </div></div>
    <div class="meta">
      <div><b>${esc(text.period(date(stats.from), date(stats.to)))}</b></div>
      <div>${esc(text.made(date(now.toISOString(), true)))}${options.quota ? ` · ${esc(text.quota(options.quota.used, options.quota.limit))}` : ""}</div>
      <div class="actions">
        <a class="btn" href="${csvHref}" download="nmnh-journal-${esc(stamp)}.csv">${esc(text.csv)}</a>
        <button class="btn primary" onclick="window.print()">${esc(text.print)}</button>
      </div>
    </div>
  </header>
  ${body}
  <footer>${esc(text.footer)}</footer>
</div></body></html>`;
}

/** Отдать файл браузеру на сохранение. */
export function saveReport(name: string, html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
