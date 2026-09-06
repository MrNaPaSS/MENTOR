"use client";

// Скальпинг: скринер, стакан и график.
//
// Раскладка рабочая, а не настроечная: слева узкий список монет, справа — стакан
// выбранной и её график. Ширины фиксированы, высота тянется во весь экран:
// стакан и график должны заканчиваться на одной линии, иначе под одним из них
// остаётся пустота в треть экрана.
//
// Настроек минимум и все по делу: шаг ценовой шкалы и глубина у стакана,
// таймфрейм и индикаторы у графика. Прошлая версия начиналась с семи
// переключателей и шести захардкоженных пар, и пользоваться этим было нельзя.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookText,
  Moon,
  Radio,
  Volume2,
  VolumeX,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import PaneDivider from "@/components/scalping/PaneDivider";
import ScreenerTable from "@/components/scalping/ScreenerTable";
import DomTrader from "@/components/scalping/DomTrader";
import PriceChart, { type Indicators } from "@/components/scalping/PriceChart";
import type { ChartTheme } from "@/lib/indicator/shapes";
import TradeDialog, { type TradeDraft } from "@/components/scalping/TradeDialog";
import JournalPanel from "@/components/scalping/JournalPanel";
import { play, setMuted } from "@/lib/sound";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import CloseDialog from "@/components/scalping/CloseDialog";
import {
  closePosition,
  openPosition,
  positionOf,
  tradingStatus,
  type TradingStatus,
} from "@/lib/trading";
import {
  journalAvailable,
  loadWorkspace,
  saveTrade,
  saveWorkspace,
  type JournalTrade,
} from "@/lib/journal";
import {
  computeTrade,
  sideForShelf,
  suggestStopPct,
  DEFAULT_LEVERAGE,
  DEFAULT_MARGIN,
  DEFAULT_TAKES,
} from "@/lib/trade/plan";
import {
  advanceQuote,
  closeManually,
  closePartially,
  createTrade,
  type ActiveTrade,
} from "@/lib/trade/position";
import {
  base,
  money,
  price as fmtPrice,
  type LadderRow,
  type Wall,
  useScalpingFeed,
  SORT_LABELS,
  type SortKey,
  type VisibleSortKey,
} from "@/lib/scalping";

// Укрупнение ценовой шкалы. На BTC шаг биржи — десять центов, и без укрупнения
// сорок строк стакана укладываются в четыре доллара. ×10 — из настроек
// заказчика (PriceScaleMultiplier).
const STEPS = [
  { agg: 1, label: "×1" },
  { agg: 5, label: "×5" },
  { agg: 10, label: "×10" },
  { agg: 25, label: "×25" },
];

// Ступени для колеса мыши. Мельче, чем кнопки: четыре пресета — это не
// масштабирование, а четыре скачка. Промежуточные ступени дают плавность,
// кнопки остаются быстрым переходом к привычным значениям.
const ZOOM_LADDER = [1, 2, 3, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100];

// Пороги полки ликвидности. На биткойне два миллиона — рядовой уровень, на
// монете из третьего десятка их не бывает вовсе: одного значения на все
// инструменты не существует, поэтому порог выбирает трейдер.
const SHELF_STEPS = [
  { value: 500_000, label: "500K" },
  { value: 1_000_000, label: "1M" },
  { value: 2_000_000, label: "2M" },
  { value: 5_000_000, label: "5M" },
  { value: 10_000_000, label: "10M" },
];

// 30 — глубина из рабочего пространства заказчика (DomAutoscaleDepth).
const DEPTHS = [30, 60, 100];

// Минута открывается по умолчанию: это рабочий масштаб скальпера. Остальные
// нужны, чтобы посмотреть, откуда цена пришла.
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"];

const INDICATOR_LABELS: Record<keyof Indicators, string> = {
  trend: "Тренд",
  structure: "Структура",
  blocks: "Блоки",
  gaps: "FVG",
  shelves: "Полки",
  levels: "Уровни",
  zones: "Зоны",
  ema: "EMA",
  volume: "Объём",
};

// Отклик на нажатие: 150 мс ease-out и лёгкое сжатие. Кнопка должна показать,
// что интерфейс услышал палец, не дожидаясь новых данных.
const CHIP =
  "rounded px-1.5 py-0.5 text-[11px] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]";
const CHIP_ON = "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]";
const CHIP_OFF = "text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

// Высота рабочей области: всё окно за вычетом шапки приложения. Заголовок
// раздела убран — он занимал полсотни пикселей и не нёс ничего, чего не видно
// по самим панелям. Стакан и график получают одинаковую высоту и заканчиваются
// на одной линии, иначе под коротким из них остаётся пустота.
// Высота журнала: раскрывается снизу и забирает своё место у панелей.
// Накрывать им график нельзя — сделки сверяют именно с ним, — но и разбирать
// месяц сделок в трёхстах пикселях невозможно, поэтому высота тянется.
const JOURNAL_LIMITS = { def: 300, min: 180, max: 900 };

function paneHeight(journalOpen: boolean, journalH: number): React.CSSProperties {
  return journalOpen
    ? { height: `calc(100vh - ${124 + journalH + 20}px)`, minHeight: 220 }
    : { height: "calc(100vh - 124px)", minHeight: 520 };
}

// Ширины панелей по умолчанию и границы, за которые их не утянуть.
// Нижняя граница стакана — 111 (колонка истории) + 177 (цена) плюс поля:
// уже этого он перестаёт быть читаемым.
const PANE_LIMITS = {
  screener: { def: 500, min: 360, max: 900 },
  dom: { def: 620, min: 320, max: 1200 },
};

const STORAGE_KEY = "nmnh.scalping.panes";

// Открытая сделка хранится отдельно от настроек: она живёт своей жизнью,
// пишется на каждом изменении и не должна тащить за собой ширины панелей.
// Уйти со страницы и вернуться — обычное дело, а позиция на рынке от этого не
// закрывается, значит и разметка её пропадать не должна.
const TRADE_KEY = "nmnh.scalping.trade";

function readTrade(): ActiveTrade | null {
  try {
    const raw = localStorage.getItem(TRADE_KEY);
    const trade = raw ? (JSON.parse(raw) as ActiveTrade) : null;
    // Закрытая сделка уже в журнале — на графике ей делать нечего.
    return trade && trade.status !== "closed" ? trade : null;
  } catch {
    return null;
  }
}

// По умолчанию включено всё, кроме зон: они заливают половину окна сплошным
// цветом и нужны, только когда смотришь картину крупнее минуты.
const DEFAULT_INDICATORS: Indicators = {
  trend: true,
  structure: true,
  shelves: true,
  blocks: true,
  gaps: true,
  levels: true,
  ema: true,
  volume: true,
  zones: false,
};

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, value));
}

/** Настройки рабочего места, которые переживают перезагрузку страницы. */
type Workspace = {
  theme: ChartTheme;
  screener: number;
  dom: number;
  indicators: Indicators;
  sort: SortKey;
  timeframe: string;
  agg: number;
  rows: number;
  shelf: number;
  margin: number;
  leverage: number;
  journal: number;
  sound: boolean;
  /** Последняя открытая монета: возврат в раздел не должен начинаться с нуля. */
  symbol: string | null;
};

function readWorkspace(): Partial<Workspace> | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return null;
  }
}

export default function ScalpingPage() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("walls");
  const [agg, setAgg] = useState(10);
  const [rows, setRows] = useState(30);
  const [shelf, setShelf] = useState(2_000_000);

  // Расчёт сделки от уровня. Черновик живёт и после закрытия окна: разметка
  // остаётся на графике, пока трейдер сам её не убрал.
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Живая сделка: пока цена не дошла до уровня — «ждём», дальше открыта и
  // считает результат, после стопа или последней цели закрывается сама.
  const [trade, setTrade] = useState<ActiveTrade | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [exchange, setExchange] = useState<TradingStatus | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  // Отчёт об ордере: текст и тон. Молчание после нажатия «Войти» — худшее из
  // возможных поведений: трейдер не знает, ушла заявка или нет.
  const [orderNote, setOrderNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  // Звук событий сделки. Скальпер смотрит в стакан, а не в ярлык позиции:
  // цель может взяться, пока он разглядывает другую монету.
  const [sound, setSound] = useState(true);
  const [journalH, setJournalH] = useState(JOURNAL_LIMITS.def);
  // Счётчик записанных сделок: журнал перечитывает список, когда он растёт.
  const [journalKey, setJournalKey] = useState(0);
  // Сделка из журнала под курсором: её разметка показывается на графике.
  const [hovered, setHovered] = useState<JournalTrade | null>(null);
  const savedTradeRef = useRef<string | null>(null);
  // Пока настройки и сделка не подняты из хранилища, писать туда нельзя:
  // первый проход эффектов видит пустое состояние и стёр бы живую запись.
  const hydrated = useRef(false);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [timeframe, setTimeframe] = useState("1m");
  const [indicators, setIndicators] = useState<Indicators>(DEFAULT_INDICATORS);
  const [theme, setTheme] = useState<ChartTheme>("dark");

  // Открыт при каждой загрузке: работа начинается с выбора монеты, и свёрнутый
  // список на старте — это лишний клик перед каждой сессией. Свернётся сам,
  // как только монета выбрана, и сохранять это состояние незачем.
  const [screenerOpen, setScreenerOpen] = useState(true);
  const [screenerW, setScreenerW] = useState(PANE_LIMITS.screener.def);
  const [domW, setDomW] = useState(PANE_LIMITS.dom.def);

  const { screener, dom, connected } = useScalpingFeed({ symbol, rows, agg, sort, shelf, interval: timeframe });

  // Цена для графика — три раза в секунду вместо восьми. Ярлык позиции и итог
  // сделки от этого не станут менее живыми, а перерисовку всего графика на
  // каждом кадре стакана это снимает.
  const [chartPrice, setChartPrice] = useState(0);
  const midRef = useRef(0);
  midRef.current = dom?.mid ?? 0;
  useEffect(() => {
    const id = setInterval(() => {
      setChartPrice((current) => (current === midRef.current ? current : midRef.current));
    }, 330);
    return () => clearInterval(id);
  }, []);

  // Рабочее место трейдера: ширины панелей, набор индикаторов, таймфрейм, шаг
  // и глубина стакана. Настроил один раз — и после перезагрузки всё на месте.
  //
  // Источников два. Браузер отвечает мгновенно и работает без входа в кабинет,
  // сервер помнит настройки на любом устройстве. Сначала показываем local,
  // потом, если сервер что-то хранит, подменяем на него: шаблон, сохранённый
  // трейдером, важнее того, что осталось в этом браузере.
  const applyWorkspace = useCallback((saved: Partial<Workspace> | null) => {
    if (!saved) return;
    if (saved.theme === "light" || saved.theme === "dark") setTheme(saved.theme);
    if (typeof saved.screener === "number") {
      setScreenerW(clamp(saved.screener, PANE_LIMITS.screener));
    }
    if (typeof saved.dom === "number") setDomW(clamp(saved.dom, PANE_LIMITS.dom));
    // Индикаторы сливаем с умолчаниями: если в новой версии появился
    // переключатель, которого в сохранённом наборе нет, он не должен пропасть.
    if (saved.indicators) {
      setIndicators({ ...DEFAULT_INDICATORS, ...saved.indicators });
    }
    if (saved.sort && saved.sort in SORT_LABELS) setSort(saved.sort);
    if (saved.timeframe && TIMEFRAMES.includes(saved.timeframe)) {
      setTimeframe(saved.timeframe);
    }
    if (typeof saved.agg === "number" && STEPS.some((s) => s.agg === saved.agg)) {
      setAgg(saved.agg);
    }
    if (typeof saved.rows === "number" && DEPTHS.includes(saved.rows)) setRows(saved.rows);
    if (typeof saved.shelf === "number" && SHELF_STEPS.some((s) => s.value === saved.shelf)) {
      setShelf(saved.shelf);
    }
    // Сумма и плечо у трейдера из раза в раз одни и те же — вводить их заново
    // в каждой сделке незачем.
    if (typeof saved.margin === "number" && saved.margin > 0) setMargin(saved.margin);
    if (typeof saved.leverage === "number" && saved.leverage >= 1) setLeverage(saved.leverage);
    if (typeof saved.journal === "number") {
      setJournalH(clamp(saved.journal, JOURNAL_LIMITS));
    }
    if (typeof saved.sound === "boolean") {
      setSound(saved.sound);
      setMuted(!saved.sound);
    }
    if (typeof saved.symbol === "string" && saved.symbol) {
      setSymbol(saved.symbol);
      // Монета уже выбрана — список для этого больше не нужен. Он открывается
      // сам, только когда работать ещё не с чем.
      setScreenerOpen(false);
    }
  }, []);

  // Состояние биржевого счёта: подключены ли ключи и включено ли хранилище.
  const loadExchange = useCallback(() => {
    tradingStatus()
      .then((body) => setExchange(body))
      .catch(() => setExchange(null));
  }, []);

  useEffect(() => {
    loadExchange();
  }, [loadExchange]);

  // Сообщение об ордере живёт несколько секунд: это отчёт о действии, а не
  // состояние экрана.
  useEffect(() => {
    if (!orderNote) return;
    play(orderNote.bad ? "error" : "order");
    // Ошибку держим дольше удачи: её надо успеть прочитать.
    const id = setTimeout(() => setOrderNote(null), orderNote.bad ? 20000 : 8000);
    return () => clearTimeout(id);
  }, [orderNote]);

  useEffect(() => {
    const restored = readTrade();
    if (restored) {
      setTrade(restored);
      // Сделка уже записана в журнал только после закрытия, поэтому метка
      // «уже сохранено» здесь не ставится.
    }
    applyWorkspace(readWorkspace());
    hydrated.current = true;
    if (!journalAvailable()) return;
    let cancelled = false;
    loadWorkspace()
      .then((body) => {
        if (!cancelled && body?.payload) {
          applyWorkspace(body.payload as Partial<Workspace>);
        }
      })
      .catch(() => {
        // Сервер молчит — работаем на том, что сохранил браузер.
      });
    return () => {
      cancelled = true;
    };
  }, [applyWorkspace]);

  useEffect(() => {
    if (!hydrated.current) return;
    const snapshot = {
      theme,
      screener: screenerW,
      dom: domW,
      indicators,
      sort,
      timeframe,
      agg,
      rows,
      shelf,
      margin,
      leverage,
      journal: journalH,
      symbol,
      sound,
    } satisfies Workspace;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Не сохранилось — не повод ломать экран.
    }

    if (!journalAvailable()) return;
    // Задержка перед отправкой: ширина панели меняется десятками событий на
    // одно перетаскивание, и слать каждое значит долбить сервер впустую.
    const id = setTimeout(() => {
      saveWorkspace(snapshot).catch(() => {
        // Настройки уже в браузере — потеря запроса ничего не стоит.
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [
    theme,
    screenerW,
    domW,
    indicators,
    sort,
    timeframe,
    agg,
    rows,
    shelf,
    margin,
    leverage,
    journalH,
    symbol,
    sound,
  ]);

  // NaN приходит по двойному клику на разделителе — это сброс к умолчанию.
  function resizeScreener(delta: number) {
    setScreenerW((w) =>
      Number.isNaN(delta) ? PANE_LIMITS.screener.def : clamp(w + delta, PANE_LIMITS.screener),
    );
  }

  // Тянем за верхний край журнала: вниз — журнал меньше, вверх — больше,
  // поэтому знак смещения обратный.
  function resizeJournal(delta: number) {
    setJournalH((h) =>
      Number.isNaN(delta) ? JOURNAL_LIMITS.def : clamp(h - delta, JOURNAL_LIMITS),
    );
  }

  function resizeDom(delta: number) {
    setDomW((w) => (Number.isNaN(delta) ? PANE_LIMITS.dom.def : clamp(w + delta, PANE_LIMITS.dom)));
  }

  function toggle(key: keyof Indicators) {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /**
   * Монета выбрана — список сворачивается.
   *
   * Скринер нужен, чтобы найти инструмент; дальше он только занимает место,
   * которое стакану и графику куда полезнее. Вернуть список — один клик по
   * свёрнутой полосе слева.
   */
  function selectSymbol(next: string) {
    setSymbol(next);
    setScreenerOpen(false);
    // Разметка сделки привязана к цене прошлой монеты — на новой она врёт.
    setDraft(null);
    setDialogOpen(false);
    setTrade(null);
  }

  /**
   * Зафиксировать часть позиции или всю.
   *
   * Частичная фиксация уходит в журнал отдельной записью со своим объёмом и
   * своим итогом: записать её как сделку целиком значит соврать и в прибыли, и
   * в количестве сделок. Остаток продолжает жить на графике.
   */
  async function applyClose(share: number) {
    setCloseOpen(false);
    const current = trade;
    if (!current) return;

    // Сначала биржа, потом экран. Пометить сделку закрытой у себя, не закрыв
    // позицию на бирже, — худшее, что может сделать терминал: трейдер уверен,
    // что вышел, а деньги продолжают стоять в рынке.
    // Снимаем и незашедшую сделку: с ней на бирже стоят лимитка входа, стоп и
    // цели, и «отменённый» расчёт иначе откроется сам, стоило цене дойти.
    // Идём на биржу всегда, не спрашивая, подключён ли счёт по нашим данным:
    // состояние счёта могло не успеть загрузиться, а заявка на бирже при этом
    // стоит. Сервер сам ответит, что ключей нет, — это дешевле, чем оставить
    // висеть лимитку, которую трейдер считает снятой.
    // Результат с биржи, если она успела его сообщить: наша оценка считается по
    // цене маркировки и без комиссий, а на счёт приходит другое.
    let settled: number | null = null;

    if (current.status !== "closed") {
      try {
        const result = await closePosition(current, share);
        if (result && typeof result.realized === "number") settled = result.realized;
        setOrderNote({
          text: result?.note
            ? `Биржа: ${result.note}`
            : `Закрыто ${result?.closed ?? 0} ${base(current.symbol)}` +
              (settled !== null
                ? ` · ${settled >= 0 ? "+" : "−"}${Math.abs(settled).toFixed(2)} USD`
                : "") +
              (result?.fee ? `, комиссия ${result.fee.toFixed(2)}` : "") +
              (result && result.remaining > 0 ? `, осталось ${result.remaining}` : ""),
          bad: false,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : "Биржа не закрыла позицию";
        // 428 — ключи не подключены: закрывать нечего, это не сбой.
        if (!text.includes("подключите") && !text.includes("428")) {
          setOrderNote({ text, bad: true });
          // Разметку не трогаем: позиция как стояла, так и стоит.
          return;
        }
      }
    }

    const { remaining, recorded } = closePartially(
      current,
      share,
      dom?.mid ?? 0,
      Date.now(),
    );

    // В журнал идёт то, что пришло на счёт. Наша оценка годится только когда
    // биржа промолчала: записать её вместо реальной значит завести себе
    // статистику красивее, чем на самом деле.
    const truthful =
      settled !== null && recorded ? { ...recorded, pnl: settled } : recorded;

    if (truthful && truthful.id !== remaining.id) {
      // Частичную запись эффект журнала не увидит: у него на руках останется
      // живая сделка, а не закрытая. Пишем сами.
      saveTrade(truthful)
        .then((saved) => {
          if (saved) setJournalKey((k) => k + 1);
        })
        .catch(() => {
          // Не записалось — позиция всё равно сокращена.
        });
    }

    setTrade(
      settled !== null && remaining.status === "closed"
        ? { ...remaining, pnl: settled }
        : remaining,
    );
    if (remaining.status === "closed") setDraft(null);
  }

  /**
   * Открыть расчёт сделки от уровня.
   *
   * Сумму и плечо берём прошлые, стоп предлагаем по волатильности: график
   * знает ATR своего таймфрейма, стакан — нет, и тогда остаётся значение по
   * умолчанию. Все три поля трейдер всё равно правит в самом окне.
   */
  function openTrade(level: Wall, atr = 0) {
    setDraft({
      shelf: level,
      tick: dom?.tick ?? 0,
      margin,
      leverage,
      stopPct: suggestStopPct(atr, level.price),
    });
    setDialogOpen(true);
  }

  /** Строка стакана как уровень: сторона по тому, чьи заявки в ней стоят. */
  function openTradeFromRow(row: LadderRow) {
    const mid = dom?.mid ?? row.price;
    openTrade({
      price: row.price,
      size: row.bid > 0 ? row.bid : row.ask,
      notional: row.notional,
      side: row.bid > 0 ? "bid" : "ask",
      distance_bp: mid > 0 ? (Math.abs(row.price - mid) / mid) * 10_000 : 0,
      ratio: 1,
    });
  }

  /**
   * Подтвердить расчёт.
   *
   * Только здесь прежняя сделка уступает место новой. Пока окно просто открыто,
   * трейдер разглядывает уровень — трогать за это уже идущую сделку нельзя.
   *
   * Вошедшая сделка перед заменой закрывается по текущей цене и уходит в
   * журнал: бросать её без записи значит испортить собственную статистику.
   * В боевом режиме новая сделка следом уходит на биржу тем же расчётом.
   */
  async function confirmTrade() {
    setDialogOpen(false);
    if (!plan || !draft || !symbol) return;

    if (trade && trade.status === "open") {
      const done = closeManually(trade, dom?.mid ?? 0, Date.now());
      savedTradeRef.current = done.id;
      saveTrade(done)
        .then((saved) => {
          if (saved) setJournalKey((k) => k + 1);
        })
        .catch(() => {
          savedTradeRef.current = null;
        });
    }

    const next = createTrade(
      {
        symbol,
        side: plan.side,
        entry: plan.entry,
        stop: plan.stop,
        targets: plan.targets.map((t) => t.price),
        qty: plan.qty,
        margin: draft.margin,
        leverage: draft.leverage,
      },
      `${symbol}-${Date.now()}`,
    );
    setTrade(next);
    setDraft(null);

    // Вход в сделку — это торговля, а не режим. Расчёт живёт вместе со
    // сделкой, а не вместо неё: цифры трейдер уже видел в окне, дальше заявка
    // уходит на биржу. Единственное, что может помешать, — неподключённый счёт.
    if (!exchange?.connected) {
      setOrderNote({ text: "Биржевой счёт не подключён — заявка не отправлена", bad: true });
      setExchangeOpen(true);
      return;
    }

    setOrderNote({ text: "Отправляем ордер…", bad: false });
    try {
      const result = await openPosition(next, true);
      const id =
        result && typeof result.entry === "object" && result.entry
          ? String((result.entry as Record<string, unknown>).orderId ?? "")
          : "";
      setOrderNote({
        text: result?.warning
          ? `Заявка на бирже · ${result.warning}`
          : `Заявка на бирже: ${next.side === "long" ? "лонг" : "шорт"} ${base(next.symbol)}${
              id ? ` · №${id}` : ""
            }`,
        bad: false,
      });
    } catch (err) {
      setOrderNote({
        text: err instanceof Error ? err.message : "Биржа не приняла ордер",
        bad: true,
      });
    }
  }

  /**
   * Закрыть окно расчёта, ничего не сделав.
   *
   * Ни одной сделки это не касается — ни идущей, ни ожидающей входа. Пропадает
   * только предпросмотр, которого и не было нигде, кроме экрана.
   */
  function cancelDialog() {
    setDialogOpen(false);
    setDraft(null);
  }

  function updateDraft(next: TradeDraft) {
    setDraft(next);
    setMargin(next.margin);
    setLeverage(next.leverage);
  }

  /**
   * Масштаб стакана колесом мыши, как на графике.
   *
   * Вверх — мельче шаг и подробнее уровни, вниз — крупнее шаг и шире охват.
   * Ищем ближайшую ступень к текущему значению: попасть можно и кнопкой, и
   * колесом, и они не обязаны совпадать.
   */
  function zoomDom(direction: 1 | -1) {
    setAgg((current) => {
      let nearest = 0;
      for (let i = 1; i < ZOOM_LADDER.length; i++) {
        if (
          Math.abs(ZOOM_LADDER[i] - current) < Math.abs(ZOOM_LADDER[nearest] - current)
        ) {
          nearest = i;
        }
      }
      const next = Math.max(0, Math.min(ZOOM_LADDER.length - 1, nearest + direction));
      return ZOOM_LADDER[next];
    });
  }

  const plan = draft
    ? computeTrade({
        entry: draft.shelf.price,
        side: sideForShelf(draft.shelf.side),
        stopPct: draft.stopPct,
        margin: draft.margin,
        leverage: draft.leverage,
        takes: DEFAULT_TAKES,
      })
    : null;

  // Ключ расчёта: пересобирать сделку нужно при смене чисел, а не на каждом
  // кадре — объект расчёта создаётся заново при любой перерисовке.
  const planKey = plan
    ? `${plan.entry}|${plan.stop}|${plan.qty}|${plan.targets.map((t) => t.price).join(",")}`
    : "";

  // Пока окно открыто, расчёт виден на графике — но только как предпросмотр и
  // только если ничего не идёт. Ни одна кнопка окна не должна касаться уже
  // существующей сделки: трейдер открыл расчёт посмотреть соотношение по
  // другому уровню, а его ожидающая заявка от этого исчезала.
  const preview = useMemo(() => {
    if (!dialogOpen || !plan || !draft || !symbol || trade) return null;
    return createTrade(
      {
        symbol,
        side: plan.side,
        entry: plan.entry,
        stop: plan.stop,
        targets: plan.targets.map((t) => t.price),
        qty: plan.qty,
        margin: draft.margin,
        leverage: draft.leverage,
      },
      "preview",
    );
    // planKey намеренно вместо plan: у объекта расчёта каждый раз новая ссылка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, planKey, symbol, trade, draft?.margin, draft?.leverage]);

  // Сделка идёт на бирже: тогда её состоянием распоряжается биржа, а не мы.
  const live = Boolean(exchange?.connected);

  // Живой ход сделки по цене стакана: вход, взятые цели, перенос стопа в
  // безубыток и закрытие. Функция возвращает прежнюю ссылку, когда ничего не
  // изменилось, поэтому восемь кадров в секунду не приводят к перерисовке.
  useEffect(() => {
    const bid = dom?.best_bid ?? 0;
    const ask = dom?.best_ask ?? 0;
    if (!(bid > 0) || !(ask > 0)) return;
    setTrade((current) => {
      if (!current) return current;
      const next = advanceQuote(current, { bid, ask }, Date.now());
      // Когда сделка живёт на бирже, закрывать её нашей арифметикой нельзя:
      // терминал уже показывал «закрыто», пока позиция оставалась открытой.
      // Цели и безубыток по цене считаем — это разметка, а закрытие приходит
      // от самой биржи.
      if (live && next.status === "closed" && current.status !== "closed") {
        return current;
      }
      return next;
    });
  }, [dom?.best_bid, dom?.best_ask, live]);

  // Позиция глазами биржи. Терминал обязан быть её зеркалом: своё состояние он
  // может держать сколько угодно, но правда о том, открыта ли позиция, — там.
  useEffect(() => {
    if (!live || !trade || trade.status === "closed" || !symbol) return;
    let cancelled = false;

    async function check() {
      try {
        const position = await positionOf(symbol!);
        if (cancelled || !position) return;

        setTrade((current) => {
          if (!current || current.status === "closed") return current;

          if (position.size > 0) {
            // Позиция набрана: у нас она могла ещё ждать входа.
            if (current.status === "planned") {
              return { ...current, status: "open", openedAt: Date.now() };
            }
            // Объём и безубыток берём биржевые: по ним считается результат на
            // экране и туда же сопровождение переставляет стоп. Наша формула не
            // знает ни реальной цены исполнения, ни комиссии, ни фандинга.
            const qty =
              Math.abs(current.qty - position.size) > position.size * 0.01
                ? position.size
                : current.qty;
            const stop =
              current.breakeven && position.breakeven && position.breakeven > 0
                ? position.breakeven
                : current.stop;
            return qty === current.qty && stop === current.stop
              ? current
              : { ...current, qty, stop };
          }

          if (current.status === "open") {
            // Позиции больше нет. Запись в журнал делает сопровождение на
            // сервере — по настоящим исполнениям, поэтому здесь только снимаем
            // разметку и помечаем сделку записанной.
            savedTradeRef.current = current.id;
            return closeManually(current, dom?.mid ?? 0, Date.now());
          }
          return current;
        });
      } catch {
        // Биржа не ответила — разметку не трогаем.
      }
    }

    check();
    const id = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, symbol, trade?.id, trade?.status]);

  // Разметка сделки переживает уход со страницы.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      if (trade && trade.status !== "closed") {
        localStorage.setItem(TRADE_KEY, JSON.stringify(trade));
      } else {
        localStorage.removeItem(TRADE_KEY);
      }
    } catch {
      // Не сохранилось — сделка всё равно на экране.
    }
  }, [trade]);

  // Звук на переходах сделки: вход, взятая цель, стоп, закрытие. Следим за
  // состоянием, а не за нажатиями, — цель берётся сама, без участия трейдера.
  const heard = useRef<string>("");
  useEffect(() => {
    if (!trade) {
      heard.current = "";
      return;
    }
    const stamp = `${trade.id}:${trade.status}:${trade.takesHit}:${trade.outcome ?? ""}`;
    if (heard.current === stamp) return;
    const previous = heard.current;
    heard.current = stamp;
    if (!previous) return; // первое появление сделки — это не событие

    const [, status, takes, outcome] = stamp.split(":");
    const wasTakes = Number(previous.split(":")[2] || 0);

    if (status === "open" && Number(takes) > wasTakes) play("take");
    else if (status === "open") play("entry");
    else if (status === "closed") {
      if (outcome === "take") play("profit");
      else if (outcome === "stop") play("stop");
      else play("close");
    }
  }, [trade]);

  // Закрытая сделка уходит в журнал ровно один раз. Идентификатор сделки
  // сохраняется на клиенте, поэтому повтор после обрыва связи не создаст
  // вторую запись — сервер обновит существующую.
  useEffect(() => {
    if (!trade || trade.status !== "closed") return;
    if (savedTradeRef.current === trade.id) return;
    savedTradeRef.current = trade.id;
    saveTrade(trade)
      .then((saved) => {
        if (saved) setJournalKey((k) => k + 1);
      })
      .catch(() => {
        // Не записалось — сделка всё равно закрыта, ломать экран незачем.
        savedTradeRef.current = null;
      });
  }, [trade]);

  // Класс темы для рабочих панелей: стакан и график светлеют вместе.
  const pane = theme === "light" ? "pane-light" : "pane-dark";
  const paneStyle = paneHeight(journalOpen, journalH);

  return (
    <div className={pane}>
      <div
        className="flex flex-col gap-3 xl:flex-row xl:gap-0"
        style={
          {
            "--screener-w": `${screenerW}px`,
            "--dom-w": `${domW}px`,
          } as React.CSSProperties
        }
      >
        {/* Свёрнутый скринер: узкая полоса, по которой его видно и можно
            вернуть. Прятать совсем нельзя — трейдер не должен вспоминать, где
            была панель. */}
        {!screenerOpen && (
          <button
            onClick={() => setScreenerOpen(true)}
            title="Развернуть скринер"
            className={`hidden w-9 shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] py-3 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)] xl:flex`}
            style={paneStyle}
          >
            <PanelLeftOpen className="h-4 w-4" />
            <span
              title={connected ? "Поток биржи идёт" : "Нет связи с потоком биржи"}
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--pane-up)]" : "bg-[var(--pane-down)]"}`}
            />
            <span className="text-[11px]" style={{ writingMode: "vertical-rl" }}>
              Скринер
            </span>
          </button>
        )}

        {/* Скринер: ширина по своим колонкам, без растягивания. */}
        <section
          className={`${screenerOpen ? "flex" : "hidden"} shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] xl:w-[var(--screener-w)]`}
          style={paneStyle}
        >
          <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-2 py-1.5">
            <span className="text-xs font-semibold text-[var(--pane-text)]">Скринер</span>
            <div className="flex items-center gap-1">
              {/* Связь переехала сюда из заголовка страницы: строка заголовка
                  съедала полсотни пикселей высоты, а знать о разрыве потока
                  нужно постоянно. */}
              <span
                title={connected ? "Поток биржи идёт" : "Нет связи с потоком биржи"}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                  connected ? "text-[var(--pane-up)]" : "bg-[var(--pane-down-soft)] text-[var(--pane-down)]"
                }`}
              >
                {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {connected ? "поток" : "нет связи"}
              </span>
              <button
                onClick={() => setScreenerOpen(false)}
                title="Свернуть скринер"
                className={`${CHIP} ${CHIP_OFF}`}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-[var(--pane-border)] px-2 py-2">
            <span className="mr-1 text-[11px] text-[var(--pane-muted)]">Сортировка:</span>
            {(Object.keys(SORT_LABELS) as VisibleSortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`${CHIP} ${
                  sort === key ? CHIP_ON : "text-[var(--pane-text-2)] hover:text-[var(--pane-text)]"
                }`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ScreenerTable
              rows={screener}
              selected={symbol}
              sort={sort}
              onSort={setSort}
              onSelect={selectSymbol}
            />
          </div>
        </section>

        {/* Свёрнутую панель тянуть не за что — разделитель не нужен. */}
        {screenerOpen && (
          <PaneDivider onResize={resizeScreener} title="Ширина списка · двойной клик сбрасывает" />
        )}

        {symbol ? (
          <>
            {/* Стакан: ширина по своим колонкам, история прокручивается влево. */}
            <section
              className={`${pane} flex shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-text-2)] xl:w-[var(--dom-w)]`}
              style={paneStyle}
            >
              <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-3 py-2">
                <span className="font-semibold text-[var(--pane-text)]">{base(symbol)}</span>
                {/* Без словесных подписей: множители и глубина разделены
                    чертой, а что делает кнопка — говорит подсказка при
                    наведении. Рядом с множителем стоит получившийся шаг в
                    деньгах — по нему и ориентируются, а не по кратности. */}
                <div className="flex items-center gap-0.5">
                  {STEPS.map((step) => (
                    <button
                      key={step.agg}
                      onClick={() => setAgg(step.agg)}
                      title={`Укрупнить шаг биржи в ${step.agg} раз: чем крупнее, тем шире охват и меньше подробностей`}
                      className={`${CHIP} ${agg === step.agg ? CHIP_ON : CHIP_OFF}`}
                    >
                      {step.label}
                    </button>
                  ))}
                  {dom && dom.tick > 0 && (
                    <span className="ml-1 font-mono text-[10px] text-[var(--pane-text-2)]">
                      = {fmtPrice(dom.tick, dom.tick)}
                    </span>
                  )}

                  <span className="mx-2 h-3 w-px bg-[var(--pane-border)]" />
                  {DEPTHS.map((depth) => (
                    <button
                      key={depth}
                      onClick={() => setRows(depth)}
                      title={`Показывать ${depth} строк в каждую сторону от цены`}
                      className={`${CHIP} ${rows === depth ? CHIP_ON : CHIP_OFF}`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1">
                {dom ? (
                  <DomTrader frame={dom} onZoom={zoomDom} onPickLevel={openTradeFromRow} />
                ) : (
                  <p className="grid h-full place-items-center text-sm text-[var(--pane-muted)]">
                    Собираем стакан {base(symbol)}…
                  </p>
                )}
              </div>
            </section>

            <PaneDivider onResize={resizeDom} title="Ширина стакана · двойной клик сбрасывает" />

            {/* График занимает всё оставшееся место. */}
            <section
              className={`${pane} flex min-w-0 flex-1 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]`}
              style={paneStyle}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-2">
                {/* Название инструмента переехало на сам график: там же цена и
                    плита, и всё это рядом с свечами, а не по краю рамки. */}
                <div className="flex items-center gap-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      title="Таймфрейм"
                      className={`${CHIP} ${timeframe === tf ? CHIP_ON : CHIP_OFF}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-0.5">
                  {(Object.keys(INDICATOR_LABELS) as (keyof Indicators)[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => toggle(key)}
                      className={`${CHIP} ${indicators[key] ? CHIP_ON : CHIP_OFF}`}
                    >
                      {INDICATOR_LABELS[key]}
                    </button>
                  ))}
                  {/* Порог полок стоит рядом с их переключателем: цифра без
                      контекста непонятна, а так видно, к чему она. */}
                  {indicators.shelves && (
                    <>
                      <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />
                      {SHELF_STEPS.map((step) => (
                        <button
                          key={step.value}
                          onClick={() => setShelf(step.value)}
                          title={`Показывать полки от ${step.label} в стакане`}
                          className={`${CHIP} ${shelf === step.value ? CHIP_ON : CHIP_OFF}`}
                        >
                          {step.label}
                        </button>
                      ))}
                    </>
                  )}

                  {trade && trade.status !== "closed" && (
                    <button
                      onClick={() => setCloseOpen(true)}
                      title="Зафиксировать позицию"
                      className={`${CHIP} ${CHIP_ON}`}
                    >
                      сделка ✕
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const next = !sound;
                      setSound(next);
                      setMuted(!next);
                      // Первое нажатие ещё и разрешает браузеру звук: до
                      // действия пользователя он играть не даёт.
                      if (next) play("order");
                    }}
                    title={sound ? "Звук событий включён" : "Звук выключен"}
                    className={`${CHIP} ${sound ? CHIP_ON : CHIP_OFF}`}
                  >
                    {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  </button>

                  <button
                    onClick={() => setExchangeOpen(true)}
                    title={
                      exchange?.connected
                        ? `Биржа подключена (${exchange.key_tail})`
                        : "Подключить биржевой счёт"
                    }
                    className={`${CHIP} ${exchange?.connected ? CHIP_ON : CHIP_OFF}`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={() => setJournalOpen((v) => !v)}
                    title="Журнал сделок"
                    className={`${CHIP} ${journalOpen ? CHIP_ON : CHIP_OFF}`}
                  >
                    <BookText className="h-3.5 w-3.5" />
                  </button>

                  <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />
                  <button
                    onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                    title="Тема графика"
                    className={`${CHIP} ${CHIP_OFF}`}
                  >
                    {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Инструмент, цена и плита — отдельной строкой под таймфреймами.
                  Наложением поверх холста эта строка терялась: библиотека
                  графика рисует своим слоем, и спорить с ним ради трёх слов
                  незачем. */}
              <div className="flex items-baseline gap-3 border-b border-[var(--pane-border)] px-3 py-1 font-mono text-[11px] tabular-nums">
                <span className="text-[12px] font-semibold text-[var(--pane-text)]">
                  {base(symbol)}
                </span>
                <span className="text-[var(--pane-text-2)]">
                  {dom ? fmtPrice(dom.mid, dom.tick) : "—"}
                </span>
                {dom?.wall && (
                  <span className="text-[var(--pane-gold)]">
                    плита {money(dom.wall.notional)} · {fmtPrice(dom.wall.price, dom.tick)} ·{" "}
                    {dom.wall.side === "bid" ? "поддержка" : "сопротивление"}
                  </span>
                )}
                {orderNote && (
                  <span
                    className={`ml-auto ${
                      orderNote.bad ? "text-[var(--pane-down)]" : "text-[var(--pane-accent)]"
                    }`}
                  >
                    {orderNote.text}
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 p-1">
                <PriceChart
                  symbol={symbol}
                  interval={timeframe}
                  wall={dom?.wall ?? null}
                  shelves={dom?.shelves ?? []}
                  theme={theme}
                  indicators={indicators}
                  trade={
                    trade && trade.symbol === symbol ? trade : preview
                  }
                  livePrice={chartPrice}
                  liveCandle={dom?.candle ?? null}
                  onCloseTrade={() => setCloseOpen(true)}
                  showJournal={journalOpen}
                  journalKey={journalKey}
                  ghost={hovered && hovered.symbol === symbol ? hovered : null}
                  onShelfClick={openTrade}
                />
              </div>
            </section>
          </>
        ) : (
          <section
            className={`grid flex-1 place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-6 text-center text-sm text-[var(--pane-muted)]`}
            style={paneStyle}
          >
            Выберите монету в списке — здесь появятся её стакан и график
          </section>
        )}
      </div>

      {closeOpen && trade && (
        <CloseDialog
          trade={trade}
          price={dom?.mid ?? 0}
          tick={dom?.tick ?? 0}
          onConfirm={applyClose}
          onCancel={() => setCloseOpen(false)}
        />
      )}

      {/* Окно открывается всегда: если состояние счёта получить не удалось,
          оно само объяснит почему. Кнопка, которая молча ничего не делает,
          выглядит сломанной. */}
      {exchangeOpen && (
        <ExchangeDialog
          status={
            exchange ?? { enabled: false, connected: false, key_tail: "", updated_at: null }
          }
          reachable={exchange !== null}
          onClose={() => setExchangeOpen(false)}
          onSaved={() => {
            loadExchange();
            setExchangeOpen(false);
          }}
        />
      )}

      {journalOpen && (
        <>
          <PaneDivider
            onResize={resizeJournal}
            title="Высота журнала · двойной клик сбрасывает"
            horizontal
          />
          <section
            className={`${pane} overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]`}
            style={{ height: journalH }}
          >
            <JournalPanel
              symbol={symbol ?? undefined}
              refreshKey={journalKey}
              onHover={setHovered}
              onClose={() => setJournalOpen(false)}
            />
          </section>
        </>
      )}

      {dialogOpen && draft && (
        <TradeDialog
          draft={draft}
          onChange={updateDraft}
          onConfirm={confirmTrade}
          onCancel={cancelDialog}
          live={Boolean(exchange?.connected)}
        />
      )}
    </div>
  );
}
