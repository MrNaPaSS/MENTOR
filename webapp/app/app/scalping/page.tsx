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

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BookText,
  CandlestickChart,
  Maximize2,
  Minimize2,
  Moon,
  Palette,
  Radio,
  Volume2,
  VolumeX,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Star,
  Camera,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import ChatRoom from "@/components/chat/ChatRoom";
import { fromActive, shareShot as shotToChat } from "@/lib/chat/share";
import {
  open as openChat,
  serverSnapshot as chatServer,
  snapshot as chatSnapshot,
  subscribe as chatSubscribe,
} from "@/lib/chat/store";
import PaneDivider from "@/components/scalping/PaneDivider";
import ScreenerTable from "@/components/scalping/ScreenerTable";
import DomTrader from "@/components/scalping/DomTrader";
import PriceChart, { type Indicators } from "@/components/scalping/PriceChart";
import {
  CHART_PALETTES,
  CHART_PRESETS,
  isChartPaletteName,
  isChartPaper,
  isChartPresetName,
  paletteSwatch,
  type ChartPaletteName,
  type ChartPaper,
} from "@/lib/indicator/presets";
import TradeDialog, { type TradeDraft } from "@/components/scalping/TradeDialog";
import JournalPanel from "@/components/scalping/JournalPanel";
import { play } from "@/lib/sound";
import { setSoundOn, useSoundOn } from "@/lib/notifySound";
import {
  composeShot,
  copy as copyShot,
  download as downloadShot,
  upload as uploadShot,
  type ShotResult,
} from "@/lib/shot";
import { crossedAlerts, type PriceAlert } from "@/lib/trade/alerts";
import { setTerminalTheme } from "@/lib/terminalTheme";
import { onSymbolAsked, symbolFromUrl } from "@/lib/openSymbol";
import { readTrades, writeTrades } from "@/lib/tradeStore";
import {
  dismissSymbol,
  dismissToast,
  holdTerminal,
  pushToast,
  serverSnapshot as serverToasts,
  snapshot as snapshotToasts,
  subscribe as subscribeToasts,
} from "@/lib/tradeAlerts";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import ConnectDialog, { type ConnectNeed } from "@/components/scalping/ConnectDialog";
import CloseDialog from "@/components/scalping/CloseDialog";
import LevelMenu from "@/components/scalping/LevelMenu";
import ManualOrderCard from "@/components/scalping/ManualOrderCard";
import Toasts, { type Toast } from "@/components/scalping/Toasts";
import type { DragLevel } from "@/components/scalping/DragLevels";
import type { OrderChip } from "@/components/scalping/OrderChip";
import { draftAt, moveLevel, qtyOf, riskOf, type ManualDraft } from "@/lib/trade/manual";
import Logo from "@/components/ui/Logo";
import RadioChip from "@/components/app/RadioChip";
import { api, API_URL } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useCoins } from "@/lib/useCoins";
import { fmtUsd } from "@/lib/format";
import {
  closePosition,
  moveLevels,
  openPosition,
  openSizes,
  limitsOf,
  plansOf,
  positionOf,
  tradingStatus,
  type ExchangePlans,
  type SymbolLimits,
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
  wasEntered,
  type ActiveTrade,
} from "@/lib/trade/position";
import {
  base,
  money,
  price as fmtPrice,
  type LadderRow,
  type Wall,
  useScalpingFeed,
  SORT_KEYS,
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
// Десятиминутки у биржи нет - она собирается из пятиминуток на нашей
// стороне. Трейдеру это безразлично: границы совпадают, свечи те же.
const TIMEFRAMES = ["1m", "5m", "10m", "15m", "1h", "4h"];

// Объёмных свечей здесь нет: это не слой поверх графика, а вид самих свечей,
// и место ему рядом с выбором таймфрейма - там, где выбирают, как смотреть.
type LayerKey = Exclude<keyof Indicators, "heavy">;

// Порядок кнопок разметки. Названия - в словаре, кроме тех, что не переводятся.
const LAYER_ORDER: LayerKey[] = [
  "trend", "structure", "blocks", "gaps", "shelves", "zones", "ema", "volume",
];

const UNTRANSLATED_LAYERS: Partial<Record<LayerKey, string>> = {
  gaps: "FVG",
  ema: "EMA",
};

// Отклик на нажатие: 150 мс ease-out и лёгкое сжатие. Кнопка должна показать,
// что интерфейс услышал палец, не дожидаясь новых данных.
const CHIP =
  "rounded px-1.5 py-0.5 text-[11px] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]";
const CHIP_ON = "bg-[var(--pane-chip-faint)] text-[var(--pane-chip)]";
const CHIP_OFF = "text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

// Высота рабочей области: всё окно за вычетом шапки приложения. Заголовок
// раздела убран — он занимал полсотни пикселей и не нёс ничего, чего не видно
// по самим панелям. Стакан и график получают одинаковую высоту и заканчиваются
// на одной линии, иначе под коротким из них остаётся пустота.
// Высота журнала: раскрывается снизу и забирает своё место у панелей.
// Накрывать им график нельзя — сделки сверяют именно с ним, — но и разбирать
// месяц сделок в трёхстах пикселях невозможно, поэтому высота тянется.
const JOURNAL_LIMITS = { def: 300, min: 180, max: 900 };

function paneHeight(
  journalOpen: boolean,
  journalH: number,
  full: boolean,
): React.CSSProperties {
  // Сколько высоты забирает всё, что вокруг: шапка сайта с бегущей строкой
  // (девяносто шесть точек) и наше поле снизу (восемь). В полном экране их нет
  // - остаются только поля слоя, и эти сто пикселей достаются стакану.
  //
  // Число обязано сходиться с отступами: пока здесь стояло сто двадцать четыре,
  // а поле снизу стало восемью, под панелями оставалась лишняя полоса пустоты.
  const around = full ? 16 : 104;
  return journalOpen
    ? { height: `calc(100vh - ${around + journalH + 20}px)`, minHeight: 220 }
    : { height: `calc(100vh - ${around}px)`, minHeight: full ? 320 : 520 };
}

// Ширины панелей по умолчанию и границы, за которые их не утянуть.
// Нижняя граница стакана — 111 (колонка истории) + 177 (цена) плюс поля:
// уже этого он перестаёт быть читаемым.
const PANE_LIMITS = {
  screener: { def: 500, min: 360, max: 900 },
  dom: { def: 620, min: 320, max: 1200 },
  // Чат уже остальных: это лента коротких реплик, а не таблица. Шире 640 он
  // начинает отбирать место у графика, ради которого трейдер здесь и сидит.
  chat: { def: 340, min: 260, max: 640 },
};

const STORAGE_KEY = "nmnh.scalping.panes";

// Открытая сделка хранится отдельно от настроек: она живёт своей жизнью,
// пишется на каждом изменении и не должна тащить за собой ширины панелей.
// Уйти со страницы и вернуться — обычное дело, а позиция на рынке от этого не
// закрывается, значит и разметка её пропадать не должна.

// По умолчанию включено всё, кроме зон: они заливают половину окна сплошным
// цветом и нужны, только когда смотришь картину крупнее минуты.
/**
 * Сколько пустых ответов биржи подряд означают закрытую позицию.
 *
 * Один не означает ничего: биржа отвечает пустым списком и на своей заминке.
 * Столько же выдержки держит сопровождение на сервере (MISSING_TOLERANCE в
 * backend/trading/watcher.py) - расхождение здесь означало бы, что экран и
 * сервер расходятся во мнении, жива ли сделка.
 */
const MISSING_TOLERANCE = 2;

/**
 * Когда перечитывать журнал после закрытия сделки, миллисекунды.
 *
 * Настоящие числа приносит сопровождение на сервере, а оно ждёт, пока биржа
 * покажет закрывающее исполнение. Сроку у неё нет: бывает сразу, бывает через
 * полминуты. Растущий шаг закрывает и быстрый случай, и медленный, не превращая
 * ожидание в опрос по кругу.
 */
const JOURNAL_RETRIES = [0, 3000, 8000, 20000, 45000];

const DEFAULT_INDICATORS: Indicators = {
  trend: true,
  structure: true,
  shelves: true,
  blocks: true,
  gaps: true,
  ema: true,
  volume: true,
  // Выключен по умолчанию: непривычный вид свечей стоит включать осознанно.
  heavy: false,
  zones: false,
};

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, value));
}

/** Настройки рабочего места, которые переживают перезагрузку страницы. */
type Workspace = {
  /** Лист графика: тёмная бумага или белая. Он же красит кабинет вокруг. */
  paper: ChartPaper;
  /** Палитра свечей: стандартная или один из пресетов. */
  palette: ChartPaletteName;
  screener: number;
  dom: number;
  /** Ширина чата справа от графика. */
  chat: number;
  indicators: Indicators;
  sort: SortKey;
  timeframe: string;
  agg: number;
  rows: number;
  shelf: number;
  margin: number;
  leverage: number;
  journal: number;
  /**
   * Звук событий - остаток от прежнего места хранения.
   *
   * Настройка переехала в профиль: выключить её хочется оттуда, где собраны
   * остальные, а рабочее место - про ширину панелей и набор индикаторов. Поле
   * оставлено в типе, потому что оно лежит в уже сохранённых свёртках: по нему
   * `notifySound` один раз считывает прежний выбор человека.
   */
  sound?: boolean;
  /**
   * Лист и палитра одной настройкой - остаток от прежней формы.
   *
   * До разделения тема была единственным полем и принимала как «dark», так и
   * «velvet». Поле оставлено в типе, потому что такие свёртки уже сохранены:
   * по нему один раз разбирается прежний выбор человека.
   */
  theme?: string;
  /** Последняя открытая монета: возврат в раздел не должен начинаться с нуля. */
  symbol: string | null;
  /** Отметки на ценах: пережидают перезагрузку вместе с остальными настройками. */
  alerts: PriceAlert[];
  /** Избранные монеты: свой раздел наверху скринера. */
  favorites: string[];
  /** Показывать в скринере только избранное. */
  onlyFavorites: boolean;
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
  const t = useT();
  const layerLabels = t.terminal.layers;
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
  // Сделок может идти несколько сразу, в том числе встречных: открыть шорт,
  // не закрывая лонг, — обычное дело, и стирать за это разметку идущей сделки
  // терминал не вправе.
  const [trades, setTrades] = useState<ActiveTrade[]>([]);
  // Какую сделку фиксируем в окне закрытия.
  const [closing, setClosing] = useState<ActiveTrade | null>(null);
  const tradesRef = useRef<ActiveTrade[]>([]);
  tradesRef.current = trades;
  // Встречная позиция на бирже: на одностороннем счёте ордер против неё её же
  // и уменьшает, а не создаёт вторую сделку. Трейдер должен знать это до
  // нажатия, а не по факту закрытия своего лонга.
  const [opposing, setOpposing] = useState(0);

  // Что из защиты реально стоит на бирже. График рисует цели по замыслу
  // сделки, и когда биржа их не приняла, картинка успокаивает вместо того,
  // чтобы предупредить.
  const [plans, setPlans] = useState<ExchangePlans | null>(null);

  // Пределы монеты: потолок плеча и комиссия. У большинства монет биржи
  // плечо упирается в ×20 или ×50, а кнопки предлагают до ×400 - без этого
  // отказ приходил уже после нажатия «Войти».
  const [limits, setLimits] = useState<SymbolLimits | null>(null);

  // Отметки на ценах: терминал скажет, когда уровень пересекут.
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  // Избранные монеты: свой раздел наверху и отдельный режим показа.
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  // Уровень, по которому нажали в стакане: спрашиваем, что с ним делать.
  const [level, setLevel] = useState<LadderRow | null>(null);
  // Способ снять холст графика: кладёт его сам график, пользуется кнопка.
  const shotRef = useRef<(() => ShotResult | null) | null>(null);
  const [shotMenu, setShotMenu] = useState(false);
  const shotMenuRef = useRef<HTMLDivElement>(null);
  const [themeMenu, setThemeMenu] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  // Имя для подписи на снимке. Оно рисуется в картинке и на сервер не уходит.
  const [author, setAuthor] = useState<string | null>(null);

  // Полный экран: терминал остаётся один на всём стекле.
  //
  // Навигация, шапка сайта и отступы съедают полторы сотни пикселей высоты -
  // на скальпе это две трети стакана. В этом режиме их нет, а баланс и монеты
  // переезжают в строку с ценой: они нужны и там, но места занимают строку.
  const [full, setFull] = useState(false);
  const { coins } = useCoins(full ? "full" : "windowed");
  const [balance, setBalance] = useState<string | null>(null);
  // Высота шкалы времени графика. Её сообщает сам график - считает её
  // библиотека, от шрифта, - а стакан по ней равняет свой подвал: две панели
  // стоят бок о бок и обязаны кончаться на одной линии.
  const [axisHeight, setAxisHeight] = useState(0);

  /**
   * Баланс счёта и имя для подписи на снимке.
   *
   * Двумя запросами, и это не лишнее. Профиль отдаёт сохранённое - оно уже в
   * базе и приезжает мгновенно, поэтому строка не пустует. Следом идёт запрос
   * за свежим: там, где ученик подключил ключи, баланс берётся по ним, то есть
   * ровно тот, что он видит в приложении биржи. Ждать эту цифру, ничего не
   * показывая, нельзя - по ней считается объём сделки, а биржа отвечает не
   * мгновенно.
   *
   * Имя рисуется в самой картинке снимка и на сервер не уходит: подпись нужна
   * тому, кто смотрит, а базе о владельце знать незачем.
   */
  const loadBalance = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const body = await api.profile(token);
      setBalance(body.balance_usdt ?? "0");
      // Подпись на снимках и карточках: своя, если задана, иначе ник Telegram.
      setAuthor(body.card_name || body.username || null);
      setAvatar(body.avatar_url ? `${API_URL}${body.avatar_url}` : null);
    } catch {
      // Не ответил профиль - строка просто останется без баланса.
    }
    try {
      const fresh = await api.refreshBalance(token);
      if (fresh) setBalance(fresh.balance_usdt ?? "0");
    } catch {
      // Биржа промолчала - остаёмся при сохранённом.
    }
  }, []);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  /**
   * Полный экран.
   *
   * Просим у браузера настоящий полноэкранный режим, но не полагаемся на
   * него: он может быть запрещён политикой страницы, и тогда терминал всё
   * равно раскрывается на всё окно своим слоем.
   */
  const toggleFull = useCallback(() => {
    setFull((current) => {
      const next = !current;
      try {
        if (next && !document.fullscreenElement) {
          void document.documentElement.requestFullscreen?.().catch(() => {});
        } else if (!next && document.fullscreenElement) {
          void document.exitFullscreen?.().catch(() => {});
        }
      } catch {
        // Браузер отказал - остаёмся со своим слоем на всё окно.
      }
      return next;
    });
  }, []);

  // Выход по Esc и по кнопке браузера: режим не должен пережить окно, из
  // которого в него вошли.
  useEffect(() => {
    if (!full) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFull(false);
    }
    function onChange() {
      if (!document.fullscreenElement) setFull(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [full]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [exchange, setExchange] = useState<TradingStatus | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  // Чего не хватает, чтобы торговать. Null - всё на месте.
  const [need, setNeed] = useState<ConnectNeed | null>(null);
  // Отчёт об ордере: текст и тон. Молчание после нажатия «Войти» — худшее из
  // возможных поведений: трейдер не знает, ушла заявка или нет.
  const [orderNote, setOrderNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  // Звук событий сделки. Скальпер смотрит в стакан, а не в ярлык позиции:
  // цель может взяться, пока он разглядывает другую монету.
  // Звук - общая настройка человека, из профиля. Здесь только кнопка к ней.
  const sound = useSoundOn();
  const [journalH, setJournalH] = useState(JOURNAL_LIMITS.def);
  // Счётчик записанных сделок: журнал перечитывает список, когда он растёт.
  const [journalKey, setJournalKey] = useState(0);
  // Сделка из журнала под курсором: её разметка показывается на графике.
  const [hovered, setHovered] = useState<JournalTrade | null>(null);
  // Сделка, открытая из журнала нажатием. Наведение показывает разметку, пока
  // курсор на строке; нажатие оставляет её на графике и увозит его к тому
  // времени, когда сделка шла.
  const [picked, setPicked] = useState<JournalTrade | null>(null);

  // Разметка из журнала живёт вместе с журналом.
  //
  // Панель закрывают тем же движением, каким убирают с графика показанную
  // сделку, - а бокс оставался висеть: строка под курсором исчезала вместе с
  // панелью, и `onHover(null)` от неё уже не приходил, а выбранную нажатием
  // снять было и вовсе нечем. Гасим обе на закрытии, в одном месте: закрыть
  // журнал можно и кнопкой в панели, и ярлыком на графике, и чипом в шапке.
  useEffect(() => {
    if (journalOpen) return;
    setPicked(null);
    setHovered(null);
  }, [journalOpen]);
  // Строка стакана под курсором: график проводит по ней линию. Держим только
  // цену, сторону и подпись — сама строка меняется восемь раз в секунду, и
  // хранить её значило бы перерисовывать график с той же частотой.
  const [levelHint, setLevelHint] = useState<
    { price: number; label: string; side: "bid" | "ask" } | null
  >(null);
  const hoverLevel = useCallback((row: LadderRow | null) => {
    setLevelHint((current) => {
      if (!row) return null;
      const next = {
        price: row.price,
        label: money(row.notional),
        side: row.bid > 0 ? ("bid" as const) : ("ask" as const),
      };
      return current && current.price === next.price && current.label === next.label
        ? current
        : next;
    });
  }, []);
  // Какие сделки уже ушли в журнал: их может закрыться несколько подряд, и
  // одной ячейки на всех не хватает.
  const savedTradesRef = useRef(new Set<string>());
  // Пока настройки и сделка не подняты из хранилища, писать туда нельзя:
  // первый проход эффектов видит пустое состояние и стёр бы живую запись.
  const hydrated = useRef(false);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [timeframe, setTimeframe] = useState("1m");
  const [indicators, setIndicators] = useState<Indicators>(DEFAULT_INDICATORS);
  // Светлый лист - оформление сайта по умолчанию; сохранённый выбор подставит
  // рабочее место, когда доедет.
  const [paper, setPaper] = useState<ChartPaper>("light");
  // Палитра свечей независима от листа: любой пресет включается на обоих.
  const [palette, setPalette] = useState<ChartPaletteName>("default");

  // Открыт при каждой загрузке: работа начинается с выбора монеты, и свёрнутый
  // список на старте — это лишний клик перед каждой сессией. Свернётся сам,
  // как только монета выбрана, и сохранять это состояние незачем.
  const [screenerOpen, setScreenerOpen] = useState(true);
  const [screenerW, setScreenerW] = useState(PANE_LIMITS.screener.def);
  const [domW, setDomW] = useState(PANE_LIMITS.dom.def);
  // Чат закрыт на старте: день начинается с рынка, а не с разговора. Открытый
  // держится до конца сессии, ширина переживает перезагрузку.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatW, setChatW] = useState(PANE_LIMITS.chat.def);
  // Фотография из Telegram: ею подписаны сообщения в чате. Путь приходит от
  // бэкенда, а сайт живёт на другом домене - отсюда и API_URL.
  const [avatar, setAvatar] = useState<string | null>(null);
  // Чат подключён, пока открыт терминал, - даже со свёрнутой панелью: иначе
  // точка непрочитанного загоралась бы только у того, кто и так в него смотрит.
  const chat = useSyncExternalStore(chatSubscribe, chatSnapshot, chatServer);
  useEffect(() => openChat(), []);

  const { screener, dom, connected } = useScalpingFeed({ symbol, rows, agg, sort, shelf, interval: timeframe });

  // Цена для графика — три раза в секунду вместо восьми. Ярлык позиции и итог
  // сделки от этого не станут менее живыми, а перерисовку всего графика на
  // каждом кадре стакана это снимает.
  const [chartPrice, setChartPrice] = useState(0);

  // Ручная лимитка: вход, стоп и цель ставятся мышью прямо по графику.
  //
  // Заготовка живёт до нажатия «Выставить»: на бирже в это время ничего нет, и
  // трейдер волен тянуть уровни сколько угодно. Отдельно от расчёта по полке -
  // там первичен процент стопа, здесь цена уровня.
  const [manual, setManual] = useState<ManualDraft | null>(null);
  // Уведомления поверх терминала: сюда попадает то, что случилось само и не
  // на глазах у трейдера.
  // Уведомления - на общем складе снаружи от React: событие может поднять и
  // оболочка кабинета, когда терминал закрыт, и список не должен пропадать от
  // перехода между разделами.
  const toasts = useSyncExternalStore(subscribeToasts, snapshotToasts, serverToasts);
  // Пока терминал открыт, оболочка не наблюдает: одно событие не должно
  // прийти дважды.
  useEffect(() => holdTerminal(), []);

  // Объёмы всех открытых позиций счёта: по ним считается счётчик у итога дня.
  const [liveSizes, setLiveSizes] = useState<Record<string, number>>({});

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
    // Прежде лист и палитра были одним полем: «dark» и «light» означали лист,
    // имя пресета - тёмный лист с этими свечами. Новые поля важнее старого.
    if (isChartPaper(saved.paper)) setPaper(saved.paper);
    else if (isChartPaper(saved.theme)) setPaper(saved.theme);
    else if (isChartPresetName(saved.theme)) setPaper("dark");

    if (isChartPaletteName(saved.palette)) setPalette(saved.palette);
    else if (isChartPresetName(saved.theme)) setPalette(saved.theme);
    if (typeof saved.screener === "number") {
      setScreenerW(clamp(saved.screener, PANE_LIMITS.screener));
    }
    if (typeof saved.dom === "number") setDomW(clamp(saved.dom, PANE_LIMITS.dom));
    if (typeof saved.chat === "number") setChatW(clamp(saved.chat, PANE_LIMITS.chat));
    // Индикаторы сливаем с умолчаниями: если в новой версии появился
    // переключатель, которого в сохранённом наборе нет, он не должен пропасть.
    if (saved.indicators) {
      setIndicators({ ...DEFAULT_INDICATORS, ...saved.indicators });
    }
    if (saved.sort && (SORT_KEYS as SortKey[]).includes(saved.sort)) setSort(saved.sort);
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
    if (Array.isArray(saved.favorites)) {
      setFavorites(saved.favorites.filter((s) => typeof s === "string" && s));
    }
    if (typeof saved.onlyFavorites === "boolean") setOnlyFavorites(saved.onlyFavorites);
    if (Array.isArray(saved.alerts)) {
      setAlerts(
        saved.alerts.filter(
          (a): a is PriceAlert =>
            Boolean(a) && typeof a.price === "number" && a.price > 0 && Boolean(a.symbol),
        ),
      );
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
    // Сделки записываются в журнал только после закрытия, поэтому метка
    // «уже сохранено» здесь не ставится.
    setTrades(readTrades());
    applyWorkspace(readWorkspace());
    // Монета из адреса важнее запомненной: по такой ссылке приходят намеренно -
    // из бегущей строки, из чужого сообщения, из закладки на конкретную пару.
    // Рабочее место при этом не переписывается: вернувшись сюда без адреса,
    // трейдер найдёт ту монету, с которой работал.
    const asked = symbolFromUrl();
    if (asked) {
      setSymbol(asked);
      setScreenerOpen(false);
    }
    hydrated.current = true;
    if (!journalAvailable()) return;
    let cancelled = false;
    loadWorkspace()
      .then((body) => {
        if (!cancelled && body?.payload) {
          applyWorkspace(body.payload as Partial<Workspace>);
          // Рабочее место приезжает с сервера через мгновение после открытия и
          // несёт в себе прошлую монету. Просьбу из адреса оно перебивало:
          // терминал открывался на нужной паре и тут же сам уходил на другую.
          if (asked) {
            setSymbol(asked);
            setScreenerOpen(false);
          }
        }
      })
      .catch(() => {
        // Сервер молчит — работаем на том, что сохранил браузер.
      });
    return () => {
      cancelled = true;
    };
  }, [applyWorkspace]);

  // Нажали пару в бегущей строке, не выходя из терминала. Адрес при этом
  // меняется, а страница остаётся прежней - чтение адреса при появлении здесь
  // уже не сработает, поэтому монета приходит событием.
  useEffect(() => onSymbolAsked((next) => selectSymbol(next)), []);

  useEffect(() => {
    if (!hydrated.current) return;
    const snapshot = {
      paper,
      palette,
      screener: screenerW,
      dom: domW,
      chat: chatW,
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
      alerts,
      favorites,
      onlyFavorites,
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
    paper,
    palette,
    screenerW,
    domW,
    chatW,
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
    alerts,
    favorites,
    onlyFavorites,
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

  // Разделитель у чата слева от него: тянем вправо - чат становится уже,
  // поэтому знак смещения обратный, как и у журнала.
  function resizeChat(delta: number) {
    setChatW((w) =>
      Number.isNaN(delta) ? PANE_LIMITS.chat.def : clamp(w - delta, PANE_LIMITS.chat),
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
    // Расчёт привязан к цене прошлой монеты — на новой он врёт. Идущие сделки
    // при этом остаются: они живут на бирже, а не на экране, и вернувшись к
    // своей монете, трейдер должен найти их на месте.
    setDraft(null);
    setDialogOpen(false);
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
    const current = closing;
    setClosing(null);
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
    // Комиссия обеих ног по данным биржи: без неё «плюс 519 там, плюс 487
    // здесь» выглядит расхождением, а это она и есть.
    let charged: number | null = null;

    if (current.status !== "closed") {
      try {
        const result = await closePosition(current, share);
        if (result && typeof result.realized === "number") settled = result.realized;
        if (result && typeof result.fee === "number") charged = result.fee;
        setOrderNote({
          text: result?.note
            ? t.terminal.notes.exchangeNote(result.note)
            : t.terminal.notes.closed(String(result?.closed ?? 0), base(current.symbol)) +
              (settled !== null
                ? ` · ${settled >= 0 ? "+" : "-"}${Math.abs(settled).toFixed(2)} USD`
                : "") +
              (result?.fee ? t.terminal.notes.fee(result.fee.toFixed(2)) : "") +
              (result && result.remaining > 0 ? t.terminal.notes.remaining(String(result.remaining)) : ""),
          bad: false,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : t.terminal.notes.closeFailed;
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

    const finished =
      settled !== null && remaining.status === "closed"
        ? { ...remaining, pnl: settled, fee: charged ?? undefined }
        : remaining;
    setTrades((list) => list.map((t) => (t.id === current.id ? finished : t)));
    if (remaining.status === "closed") setDraft(null);
  }

  /**
   * Чего не хватает, чтобы считать сделку. `true` - окно уже показано.
   *
   * Спрашиваем до расчёта, а не после. Прежде терминал пускал считать и молчал
   * до самого конца: трейдер набирал сумму, плечо, двигал стоп - и только на
   * «Открыть» узнавал, что счёта нет. Расчёт при этом выглядел настоящим.
   *
   * Порядок именно такой: сперва вход в кабинет, потом ключи. Без входа
   * подключать ключи некуда, и предлагать это первым значит звать в пустоту.
   */
  function blocked(): boolean {
    if (!getAccessToken()) {
      setNeed("login");
      return true;
    }
    // Ключей нет - торговать нечем.
    //
    // Проверяем именно «знаем и их нет», а не «не знаем». Состояние счёта
    // приезжает отдельным запросом, и в первые мгновения после открытия
    // терминала оно пустое: отказать в расчёте тому, у кого ключи есть, было бы
    // хуже, чем пропустить. Настоящая защита стоит на отправке ордера, а здесь
    // речь о вежливости - сказать заранее, а не после минуты работы.
    if (exchange && !exchange.connected) {
      setNeed("keys");
      return true;
    }
    return false;
  }

  /**
   * Открыть расчёт сделки от уровня.
   *
   * Сумму и плечо берём прошлые, стоп предлагаем по волатильности: график
   * знает ATR своего таймфрейма, стакан — нет, и тогда остаётся значение по
   * умолчанию. Все три поля трейдер всё равно правит в самом окне.
   */
  function openTrade(level: Wall, atr = 0) {
    if (blocked()) return;
    setDraft({
      shelf: level,
      tick: dom?.tick ?? 0,
      margin,
      leverage,
      stopPct: suggestStopPct(atr, level.price),
    });
    setDialogOpen(true);
  }

  /**
   * Расчёт сделки с цены под плюсиком.
   *
   * То же окно, что открывается от уровня в стакане: сумма, плечо, стоп и цели
   * в одном месте. Своей карточки у плюсика больше нет - от места, откуда
   * начали, расчёт зависеть не должен, а два разных окна для одной и той же
   * сделки заставляли трейдера помнить, где какое.
   *
   * Полки здесь нет: цену назвали пальцем, а не нашли в стакане. Подставляем
   * её саму нулевым объёмом - окно об этом знает и не пишет про заявки, которых
   * на этой цене никто не ставил.
   */
  function startManual(price: number, atr: number, side: "long" | "short") {
    openTrade(
      {
        price,
        size: 0,
        notional: 0,
        side: side === "long" ? "bid" : "ask",
        distance_bp: 0,
        ratio: 0,
      },
      atr,
    );
  }

  /** Отметка на цене из того же плюсика. */
  function addAlert(price: number) {
    if (!symbol || !(price > 0)) return;
    setAlerts((list) => [
      ...list.filter((a) => !(a.symbol === symbol && Math.abs(a.price - price) < 1e-9)),
      { id: `${symbol}-${Date.now()}`, symbol, price },
    ]);
    setOrderNote({ text: t.terminal.notes.alertAt(fmtPrice(price, limits?.tick ?? 0)), bad: false });
  }

  /**
   * Отправить ручную лимитку на биржу.
   *
   * Тем же путём, что и расчёт от полки: вход лимиткой, стоп вместе с ним одним
   * ордером, цель ставит сопровождение в момент набора позиции.
   */
  async function sendManual() {
    if (!manual || !symbol) return;
    if (!exchange?.connected) {
      setOrderNote({
        text: t.terminal.notes.notConnected,
        bad: true,
      });
      setExchangeOpen(true);
      return;
    }

    const next = createTrade(
      {
        symbol,
        side: manual.side,
        entry: manual.entry,
        stop: manual.stop,
        targets: [manual.take],
        qty: qtyOf(manual),
        margin: manual.margin,
        leverage: manual.leverage,
      },
      `${symbol}-${Date.now()}`,
    );
    setTrades((list) => [...list, next]);
    setManual(null);
    setMargin(manual.margin);
    setLeverage(manual.leverage);

    setOrderNote({ text: t.terminal.notes.sendingLimit, bad: false });
    try {
      await openPosition(next, true);
      setOrderNote({
        text: t.terminal.notes.limitPlaced(
          next.side === "long" ? t.terminal.events.long : t.terminal.events.short,
          base(next.symbol)
        ),
        bad: false,
      });
    } catch (err) {
      // Заявка не встала - убираем её и с графика: нарисованная лимитка,
      // которой нет на бирже, хуже отсутствия лимитки.
      setTrades((list) => list.filter((t) => t.id !== next.id));
      setOrderNote({
        text: err instanceof Error ? err.message : t.terminal.notes.limitRejected,
        bad: true,
      });
    }
  }

  /**
   * Перенести уровень идущей сделки: пока тянут - только на экране.
   *
   * Отправлять каждый кадр значит слать бирже сотню запросов на одно движение
   * мышью; она ответит отказом по частоте, и уровень не переедет вовсе.
   */
  function dragTrade(
    trade: ActiveTrade,
    kind: "entry" | "stop" | "take",
    index: number,
    price: number,
  ) {
    setTrades((list) =>
      list.map((t) => {
        if (t.id !== trade.id) return t;
        if (kind === "entry") {
          // Вход тянет за собой стоп и цели: расстояния до них трейдер задал
          // сам, и терять их при переносе заявки он не просил.
          const shift = price - t.entry;
          return {
            ...t,
            entry: price,
            stop: t.stop + shift,
            initialStop: t.initialStop + shift,
            targets: t.targets.map((p) => p + shift),
          };
        }
        const step = limits?.tick && limits.tick > 0 ? limits.tick : t.entry * 1e-6;
        const long = t.side === "long";
        if (kind === "stop") {
          // Предел у стопа разный до входа и после.
          //
          // У ждущей заявки он по ту сторону входа: иначе это не стоп, а вторая
          // цель, и биржа такую не примет. У открытой позиции - по ту сторону
          // рынка: стоп в безубытке стоит выше входа лонга, и запрет по входу
          // не давал его туда перенести вовсе.
          const from = t.status === "open" && chartPrice > 0 ? chartPrice : t.entry;
          const edge = long ? from - step : from + step;
          return { ...t, stop: long ? Math.min(price, edge) : Math.max(price, edge) };
        }
        const edge = long ? t.entry + step : t.entry - step;
        const value = long ? Math.max(price, edge) : Math.min(price, edge);
        const at = t.takesHit + index;
        return { ...t, targets: t.targets.map((p, i) => (i === at ? value : p)) };
      }),
    );
  }

  /**
   * Отпустили: только теперь уровень едет на бирже.
   *
   * Рисуем ответ биржи, а не то, куда дотянул трейдер: она округляет цену до
   * своего шага и вправе отказать. Отказ возвращает уровень на место - иначе на
   * графике стоял бы стоп, которого на бирже нет.
   */
  async function dropTrade(
    trade: ActiveTrade,
    kind: "entry" | "stop" | "take",
    index: number,
    price: number,
  ) {
    const was =
      kind === "entry"
        ? trade.entry
        : kind === "stop"
          ? trade.stop
          : trade.targets[trade.takesHit + index];
    try {
      const body = await moveLevels({
        symbol: trade.symbol,
        side: trade.side,
        trade_id: trade.id,
        take_index: index,
        // Перенос лимитки везёт с собой стоп и цель: расстояния до них задал
        // трейдер, и на бирже они должны переехать вместе с входом. Иначе
        // заявка встанет на новой цене со старым стопом - то есть с другим
        // риском, чем показано на графике.
        ...(kind === "entry"
          ? {
              entry: price,
              stop: trade.stop + (price - trade.entry),
              take: trade.targets[trade.takesHit] + (price - trade.entry),
            }
          : kind === "stop"
            ? { stop: price }
            : { take: price }),
      });
      if (!body) throw new Error(t.terminal.notes.serverSilent);
      dragTrade(
        trade,
        kind,
        index,
        kind === "entry"
          ? body.entry
          : kind === "stop"
            ? body.stop
            : body.takes[index] ?? price,
      );
      setOrderNote({
        text:
          kind === "entry"
          ? t.terminal.notes.movedEntry
          : kind === "stop"
            ? t.terminal.notes.movedStop
            : t.terminal.notes.movedTake,
        bad: false,
      });
    } catch (err) {
      dragTrade(trade, kind, index, was);
      setOrderNote({
        text: err instanceof Error ? err.message : t.terminal.notes.moveRejected,
        bad: true,
      });
    }
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

    // Без подключённого счёта сделки не заводим вовсе. Прежде терминал рисовал
    // её на графике и вёл как настоящую: на бирже при этом не было ничего, а
    // трейдер видел позицию, стоп и цели.
    if (!exchange?.connected) {
      setOrderNote({
        text: t.terminal.notes.notConnected,
        bad: true,
      });
      setExchangeOpen(true);
      return;
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
    setTrades((list) => [...list, next]);
    setDraft(null);

    setOrderNote({ text: t.terminal.notes.sendingOrder, bad: false });
    try {
      const result = await openPosition(next, true);
      // Ответа нет - значит запрос и не ушёл: сессия кончилась между открытием
      // окна и нажатием. Это отказ, а не тихий успех.
      if (!result) throw new Error(t.terminal.notes.orderRejected);
      const id =
        typeof result.entry === "object" && result.entry
          ? String((result.entry as Record<string, unknown>).orderId ?? "")
          : "";
      setOrderNote({
        text: result?.warning
          ? t.terminal.notes.orderPlacedWarn(result.warning)
          : t.terminal.notes.orderPlaced(
              next.side === "long" ? t.terminal.events.long : t.terminal.events.short,
              base(next.symbol)
            ) + (id ? t.terminal.orderNumber(id) : ""),
        bad: false,
      });
    } catch (err) {
      // Биржа отказала - убираем заявку и с графика.
      //
      // Причина у отказа чаще всего будничная: на счёте уже стоит предельное
      // число заявок или запрошенное плечо по монете недоступно. Но заявка к
      // этому моменту уже нарисована - её добавляют сразу, чтобы уровни встали
      // на график, не дожидаясь ответа биржи. И если её не убрать, трейдер
      // видит вход, ожидающий своей цены, которого на бирже нет: он ждёт
      // исполнения и не ставит заявку заново, пока цена уходит.
      //
      // Так же поступает и ручная лимитка: нарисованная заявка, которой нет на
      // бирже, хуже отсутствия заявки.
      setTrades((list) => list.filter((t) => t.id !== next.id));
      setOrderNote({
        text: err instanceof Error ? err.message : t.terminal.notes.orderRejected,
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
    // Ручная лимитка показывается тем же предпросмотром: линии входа, стопа и
    // цели с боксами риска и потенциала уже нарисованы - заводить для неё
    // вторую разметку значит получить две, которые разойдутся.
    if (manual && symbol) {
      return createTrade(
        {
          symbol,
          side: manual.side,
          entry: manual.entry,
          stop: manual.stop,
          targets: [manual.take],
          qty: qtyOf(manual),
          margin: manual.margin,
          leverage: manual.leverage,
        },
        "preview",
      );
    }
    if (!dialogOpen || !plan || !draft || !symbol) return null;
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
  }, [dialogOpen, planKey, symbol, draft?.margin, draft?.leverage, manual]);

  // Спрашиваем про встречную позицию, когда открыто окно расчёта.
  useEffect(() => {
    if (!dialogOpen || !plan || !symbol || !exchange?.connected) {
      setOpposing(0);
      return;
    }
    let cancelled = false;
    positionOf(symbol, plan.side === "long" ? "short" : "long")
      .then((body) => {
        if (!cancelled) setOpposing(body?.size ?? 0);
      })
      .catch(() => {
        // Биржа не ответила - предупреждать не о чем, а мешать не будем.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, symbol, plan?.side, exchange?.connected]);

  // Сделка идёт на бирже: тогда её состоянием распоряжается биржа, а не мы.
  const live = Boolean(exchange?.connected);

  // Живой ход сделки по цене стакана: вход, взятые цели, перенос стопа в
  // безубыток и закрытие. Функция возвращает прежнюю ссылку, когда ничего не
  // изменилось, поэтому восемь кадров в секунду не приводят к перерисовке.
  useEffect(() => {
    const bid = dom?.best_bid ?? 0;
    const ask = dom?.best_ask ?? 0;
    if (!(bid > 0) || !(ask > 0)) return;
    setTrades((list) => {
      let changed = false;
      const now = Date.now();
      const updated = list.map((current) => {
        // При подключённом счёте вход и выход подтверждает биржа: наша
        // арифметика ведёт только разметку идущей позиции.
        const next = advanceQuote(current, { bid, ask }, now, live);
        if (next !== current) changed = true;
        return next;
      });
      return changed ? updated : list;
    });
  }, [dom?.best_bid, dom?.best_ask, live]);

  // Позиция глазами биржи. Терминал обязан быть её зеркалом: своё состояние он
  // может держать сколько угодно, но правда о том, открыта ли позиция, — там.
  //
  // Спрашиваем по каждой идущей сделке отдельно и со стороной: в хедже по
  // одному инструменту стоят две позиции, и без стороны лонг увидел бы объём
  // шорта.
  // Сколько раз подряд биржа не показала позицию. Живёт между кругами опроса:
  // выдержка иначе не выдержка.
  const missingRef = useRef(new Map<string, number>());
  const watchKey = trades
    .filter((t) => t.symbol === symbol && t.status !== "closed")
    .map((t) => `${t.id}:${t.status}`)
    .join("|");

  useEffect(() => {
    if (!live || !symbol || !watchKey) return;
    let cancelled = false;

    async function check() {
      const watching = tradesRef.current.filter(
        (t) => t.symbol === symbol && t.status !== "closed",
      );

      // Чьи входы ещё стоят на бирже. Без этого списка сводная позиция по
      // монете открывала все ждущие заявки разом: зацепило верхнюю лимитку, а
      // на графике открывались обе, и вторая жила сделкой, которой нет.
      //
      // Не спросили - считаем, что стоят все ждущие: показать заявку ждущей
      // лишние три секунды не страшно, а открыть несуществующую - страшно.
      let resting = new Set(watching.filter((t) => t.status === "planned").map((t) => t.id));
      // Когда вход состоялся на самом деле - по сделкам сервера.
      const opened = new Map<string, number>();
      try {
        const body = await plansOf(symbol!);
        if (cancelled) return;
        if (body) {
          resting = new Set(body.resting);
          for (const [id, at] of Object.entries(body.opened ?? {})) {
            const ms = at ? new Date(at).getTime() : NaN;
            if (Number.isFinite(ms)) opened.set(id, ms);
          }
        }
      } catch {
        // Биржа не ответила - остаёмся при осторожном предположении.
      }

      for (const watched of watching) {
        try {
          const position = await positionOf(symbol!, watched.side);
          if (cancelled || !position) continue;

          setTrades((list) =>
            list.map((current) => {
              if (current.id !== watched.id || current.status === "closed") return current;

              if (position.size > 0) {
                // Видим позицию - забываем прошлые пустые ответы.
                missingRef.current.delete(current.id);
                // Позиция набрана: у нас она могла ещё ждать входа. Но только
                // если исполнилась именно эта заявка - соседняя, всё ещё
                // стоящая, к чужой позиции отношения не имеет.
                if (current.status === "planned") {
                  if (resting.has(current.id)) return current;
                  // Время входа - серверное, а «сейчас» только если сервер его
                  // ещё не записал. Терминал следит за одной монетой, и вход,
                  // случившийся на другой, он замечает лишь при возвращении:
                  // взяв «сейчас», сделка начиналась там, где на неё
                  // посмотрели, - бокс на графике вставал не у своей свечи.
                  return {
                    ...current,
                    status: "open",
                    openedAt: opened.get(current.id) ?? Date.now(),
                  };
                }
                // Объём и безубыток берём биржевые: по ним считается результат
                // на экране и туда же сопровождение переставляет стоп. Наша
                // формула не знает ни реальной цены исполнения, ни комиссии,
                // ни фандинга.
                const qty =
                  Math.abs(current.qty - position.size) > position.size * 0.01
                    ? position.size
                    : current.qty;
                // Стопа здесь нет намеренно. Раньше сюда писалась цена
                // безубытка по расчёту биржи - справочное число, а не заявка, -
                // и она раз в три секунды затирала настоящий стоп. Трейдер
                // переносил стоп руками, на бирже он переезжал, а на графике не
                // менялось ничего. Цену стопа приносит опрос заявок ниже: там
                // она и есть, а не выводится формулой.
                //
                // Цена входа и плавающий результат - биржевые. Своя средняя
                // берётся от задуманного уровня, а исполнилось по другой цене:
                // у биржи +25, у нас +5.
                const entry = position.entry && position.entry > 0 ? position.entry : current.entry;
                const unrealized = position.unrealized ?? undefined;
                if (
                  qty === current.qty &&
                  entry === current.entry &&
                  unrealized === current.unrealized
                ) {
                  return current;
                }
                return { ...current, qty, entry, unrealized };
              }

              if (current.status === "open") {
                // Позиции не видно. Но не с первого раза.
                //
                // Пустой ответ - это ещё не закрытая сделка. Биржа отвечает
                // пустым списком и на своей заминке, и в тот момент, когда
                // позицию переоткрывают частями; ключи могли на секунду
                // отвалиться. А цена такой ошибки высокая: разметка уходит с
                // графика, сделка пишется в журнал, и трейдер остаётся с живой
                // позицией на бирже и пустым экраном - именно так она и
                // пропадала. Столько же выдержки держит сопровождение на
                // сервере.
                const seen = (missingRef.current.get(current.id) ?? 0) + 1;
                missingRef.current.set(current.id, seen);
                if (seen < MISSING_TOLERANCE) return current;

                // Пишем сделку сразу и своей оценкой: сопровождение на сервере
                // поправит её настоящими числами с биржи в ближайшие секунды.
                // Молчать нельзя - если сервер до неё не дойдёт, сделка не
                // попадёт в журнал вовсе, а именно так и терялись закрытые по
                // стопу.
                missingRef.current.delete(current.id);
                return closeManually(current, dom?.mid ?? 0, Date.now());
              }
              return current;
            }),
          );
        } catch {
          // Биржа не ответила — разметку не трогаем.
        }
      }
    }

    async function guard() {
      const open = tradesRef.current.filter(
        (t) => t.symbol === symbol && t.status === "open",
      );
      if (open.length === 0) {
        setPlans(null);
        return;
      }
      try {
        const body = await plansOf(symbol!);
        if (cancelled || !body) return;
        setPlans(body);

        // Стоп и взятые цели - с биржи. Свой расчёт здесь только мешал: он
        // решал, что цель взята, ставил безубыток и рисовал стоп формулой, а на
        // бирже в это время стояла прежняя заявка.
        const at = body.stop_price;
        setTrades((list) =>
          list.map((t) => {
            if (t.symbol !== symbol || t.status !== "open") return t;

            // Взятые цели: число сопровождения и то, что реально висит на
            // бирже. Берём худшее из двух - то есть большее.
            //
            // Одного счётчика мало: он поднимается по остатку позиции и по
            // пропавшим заявкам, и вторая цель, сработавшая частью, поднимала
            // его не сразу - на графике она оставалась висеть уже после того,
            // как исполнилась. Список стоящих целей отвечает на этот вопрос
            // прямо: цели на бирже нет - значит она отработала.
            //
            // Считаем так только когда лестница на бирже действительно была:
            // без неё «поставлено минус висит» врало и объявляло взятыми все.
            const standing =
              body.placed_takes > 0 && Array.isArray(body.take_prices)
                ? Math.max(0, t.targets.length - body.take_prices.length)
                : 0;
            const hit = Math.min(
              t.targets.length,
              Math.max(t.takesHit, body.takes_hit, standing),
            );
            const stop = at && at > 0 ? at : t.stop;

            // Цены целей - тоже с биржи, а не по замыслу.
            //
            // Отсюда брались только стоп и число взятых, а сами цели график
            // рисовал по расчёту сделки. Цель, переехавшую на бирже, он
            // показывал на старом месте: в терминале «тейк 2» стоял на 78996,
            // а на бирже на 78860 - и трейдер вёл сделку по цене, которой на
            // бирже нет.
            //
            // Порядок восстанавливаем по стороне: биржа отдаёт цены по
            // возрастанию, у лонга цели идут вверх от входа, у шорта вниз.
            // Раскладываем оставшиеся от ближней к дальней - в том же порядке,
            // в каком они лежат в замысле.
            //
            // Только когда цен ровно столько, сколько целей впереди. Меньше -
            // значит часть лестницы на бирже не стоит, и раскладывать не по
            // чему: подставить две цены на три цели значит соврать о том,
            // какая из них где.
            const ahead = t.targets.length - hit;
            const live =
              Array.isArray(body.take_prices) && body.take_prices.length === ahead
                ? [...body.take_prices].sort((a, b) =>
                    t.side === "long" ? a - b : b - a,
                  )
                : null;
            const targets = live ? [...t.targets.slice(0, hit), ...live] : t.targets;

            const same =
              hit === t.takesHit &&
              Math.abs(stop - t.stop) < Math.max(stop, 1) * 0.00001 &&
              targets.every(
                (price, i) =>
                  Math.abs(price - t.targets[i]) < Math.max(price, 1) * 0.00001,
              );
            if (same) return t;
            return { ...t, takesHit: hit, stop, targets, breakeven: hit > 0 };
          }),
        );
      } catch {
        // Биржа не ответила - молчим, а не пугаем понапрасну.
      }
    }

    check();
    guard();
    const id = setInterval(check, 3000);
    const watch = setInterval(guard, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(watch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, symbol, watchKey]);

  // Разметка сделки переживает уход со страницы.
  useEffect(() => {
    if (!hydrated.current) return;
    writeTrades(trades);
  }, [trades]);

  // Звук на переходах сделки: вход, взятая цель, стоп, закрытие. Следим за
  // состоянием, а не за нажатиями, — цель берётся сама, без участия трейдера.
  // Отпечаток на каждую сделку: их несколько, и одна общая строка молчала бы
  // о событиях второй.
  const heard = useRef(new Map<string, string>());
  useEffect(() => {
    for (const row of trades) {
      const stamp = `${row.status}:${row.takesHit}:${row.outcome ?? ""}`;
      const previous = heard.current.get(row.id);
      if (previous === stamp) continue;
      heard.current.set(row.id, stamp);
      if (previous === undefined) continue; // появление сделки - это не событие

      // Звук говорит, что что-то случилось; уведомление - что именно. Раньше
      // здесь был только звук: трейдер слышал сигнал, смотрел на другую монету
      // и не знал, чей он и что произошло.
      //
      // Опознаватели общие с опросом объёмов - вход и закрытие видят оба, и
      // второй заметивший ничего не добавит.
      const coin = base(row.symbol);
      const side = row.side === "long" ? t.terminal.events.long : t.terminal.events.short;
      const wasTakes = Number(previous.split(":")[1] || 0);
      if (row.status === "open" && row.takesHit > wasTakes) {
        play("take");
        pushToast({
          id: `${row.id}:take:${row.takesHit}`,
          symbol: row.symbol,
          title: t.terminal.events.takeHit(coin, row.takesHit),
          text:
            row.takesHit >= row.targets.length
              ? t.terminal.events.lastTake(side)
              : t.terminal.events.takesLeft(side, row.targets.length - row.takesHit),
          tone: "up",
        });
      } else if (row.status === "open") {
        play("entry");
        pushToast({
          id: `${row.id}:in`,
          symbol: row.symbol,
          title: t.terminal.events.entered(coin),
          text: t.terminal.events.enteredAt(side, fmtPrice(row.entry, limits?.tick ?? 0)),
          tone: row.side === "long" ? "up" : "down",
        });
      } else if (row.status === "closed") {
        const done =
          row.outcome === "take"
            ? { sound: "profit" as const, title: t.terminal.events.worked, tone: "up" as const }
            : row.outcome === "stop"
              ? { sound: "stop" as const, title: t.terminal.events.stopped, tone: "down" as const }
              : { sound: "close" as const, title: t.terminal.events.closed, tone: "plain" as const };
        play(done.sound);
        pushToast({
          id: `${row.id}:out`,
          symbol: row.symbol,
          title: `${coin} - ${done.title}`,
          text: `${side} · ${row.pnl >= 0 ? "+" : "-"}${Math.abs(row.pnl).toFixed(2)} $`,
          tone: done.tone,
        });
      }
    }
    // Забываем ушедшие: карта не должна расти вместе с историей за день.
    const alive = new Set(trades.map((one) => one.id));
    for (const id of heard.current.keys()) {
      if (!alive.has(id)) heard.current.delete(id);
    }
  }, [trades, limits?.tick, pushToast]);

  // Закрытая сделка уходит в журнал ровно один раз и после этого пропадает с
  // экрана. Идентификатор сделки сохраняется на клиенте, поэтому повтор после
  // обрыва связи не создаст вторую запись — сервер обновит существующую.
  useEffect(() => {
    // Снятая лимитка в журнал не идёт: позиции не было, и запись о ней
    // засоряет и список, и статистику.
    //
    // При подключённом счёте не пишем вовсе: сделку записывает сопровождение
    // по исполнениям с биржи, и делает это до того, как пометит её закрытой,
    // повторяя попытки при неудаче. Наша оценка считается по цене стакана и
    // расходится с настоящей в разы - вписывать её в журнал значит вести
    // статистику по выдуманным числам.
    const done = trades.filter(
      (t) =>
        t.status === "closed" &&
        wasEntered(t) &&
        !live &&
        !savedTradesRef.current.has(t.id),
    );
    for (const t of done) {
      savedTradesRef.current.add(t.id);
      saveTrade(t)
        .then((saved) => {
          if (saved) setJournalKey((k) => k + 1);
        })
        .catch(() => {
          // Не записалось — сделка всё равно закрыта, ломать экран незачем.
          savedTradesRef.current.delete(t.id);
        });
    }
    // Закрытые с графика убираем: они уже в журнале, и держать их в состоянии
    // значит копить за день список, который никто не читает.
    if (trades.some((t) => t.status === "closed")) {
      setTrades((list) => list.filter((t) => t.status !== "closed"));
    }
  }, [trades, live]);

  /**
   * Поставить или снять отметку на цене.
   *
   * Повторное нажатие по той же цене снимает её: отдельная кнопка «удалить» на
   * строку стакана не влезет, а жест «нажал ещё раз — передумал» понятен без
   * объяснений.
   */
  const toggleAlert = useCallback(
    (price: number) => {
      if (!symbol || !(price > 0)) return;
      setAlerts((list) => {
        const same = list.find((a) => a.symbol === symbol && a.price === price);
        if (same) return list.filter((a) => a.id !== same.id);
        // Разрешение на уведомления спрашиваем в ответ на действие трейдера —
        // браузер только так его и даёт.
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          void Notification.requestPermission().catch(() => {});
        }
        return [...list, { id: `${symbol}-${price}-${Date.now()}`, symbol, price }];
      });
    },
    [symbol],
  );

  // Пересечение отметки. Сравниваем с ценой прошлого кадра: «цена выше уровня»
  // само по себе не событие — событие в том, что она была по другую сторону.
  const lastMid = useRef(0);
  useEffect(() => {
    const mid = dom?.mid ?? 0;
    const previous = lastMid.current;
    lastMid.current = mid;
    if (!(mid > 0) || !(previous > 0) || !symbol) return;

    const crossed = crossedAlerts(alerts, symbol, previous, mid);
    if (crossed.length === 0) return;

    for (const hit of crossed) {
      const text = t.terminal.events.crossed(base(hit.symbol), fmtPrice(hit.price, dom?.tick ?? 0));
      play("alert");
      setOrderNote({ text, bad: false });
      // Плашка внизу графика годится для ответа на нажатие, но отметку ставят
      // как раз затем, чтобы не смотреть на график: уведомление сверху.
      pushToast({
        id: `alert:${hit.id}`,
        symbol: hit.symbol,
        title: t.terminal.events.crossedTitle(base(hit.symbol)),
        text: fmtPrice(hit.price, dom?.tick ?? 0),
        tone: "plain",
      });
      // Вкладка может быть свёрнута — ради этого отметку и ставят.
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(t.terminal.events.crossedNotification, { body: text, tag: hit.id });
        } catch {
          // Уведомление не показалось — звук и плашка уже сработали.
        }
      }
    }
    // Отметка одноразовая: уровень пробит, и напоминать о нём второй раз
    // значит звенеть на каждом колебании вокруг него.
    const done = new Set(crossed.map((a) => a.id));
    setAlerts((list) => list.filter((a) => !done.has(a.id)));
  }, [dom?.mid, dom?.tick, alerts, symbol]);

  // Пределы спрашиваем на смену монеты: они не меняются месяцами и лежат в
  // кэше сервера, но у каждой монеты свои.
  useEffect(() => {
    if (!symbol) {
      setLimits(null);
      return;
    }
    let cancelled = false;
    setLimits(null);
    limitsOf(symbol)
      .then((body) => {
        if (!cancelled) setLimits(body);
      })
      .catch(() => {
        // Не ответил справочник - окно расчёта покажет полный набор плеч, а
        // предел, если что, назовёт сама биржа отказом.
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  /**
   * Чип ждущей лимитки: он же и способ поставить стоп с целью.
   *
   * Кнопки SL и TP стоят на линии входа, а не в углу экрана: нажал и повёл -
   * уровень встал туда, куда смотрел трейдер.
   */
  const orderChip = useMemo<OrderChip | null>(() => {
    if (!manual) return null;
    const step = limits?.tick ?? 0;
    return {
      price: manual.entry,
      side: manual.side,
      text: t.terminal.events.draftPlaced(qtyOf(manual).toFixed(4), riskOf(manual).toFixed(2)),
      onDragStop: (price) =>
        setManual((draft) => (draft ? moveLevel(draft, "stop", price, step) : draft)),
      onDragTake: (price) =>
        setManual((draft) => (draft ? moveLevel(draft, "take", price, step) : draft)),
      onCancel: () => setManual(null),
    };
  }, [manual, limits?.tick]);

  /**
   * Исполнение лимитки по любой монете, а не только по открытой.
   *
   * Заявка срабатывает сама и почти всегда тогда, когда трейдер смотрит на
   * другой график. Зеркало биржи спрашивает только текущую монету, и о своей
   * же сделке трейдер узнавал последним - открыв её монету через полчаса.
   *
   * Спрашиваем объёмы всех позиций одним запросом и следим за переходом «не
   * было - стало»: именно он и означает, что вход состоялся.
   */
  const sizesRef = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    async function look() {
      const mine = tradesRef.current.filter((t) => t.status !== "closed");
      if (mine.length === 0) {
        sizesRef.current = null;
        return;
      }
      const sizes = await openSizes().catch(() => null);
      if (cancelled || !sizes) return;

      const before = sizesRef.current;
      sizesRef.current = sizes;
      setLiveSizes(sizes);
      // Первый круг только запоминает: без «до» переход не отличить от того,
      // что позиция стояла всё это время.
      if (!before) return;

      const raise = pushToast;

      for (const trade of mine) {
        const key = `${trade.symbol}:${trade.side}`;
        const was = before[key] ?? 0;
        const now = sizes[key] ?? 0;
        const side = trade.side === "long" ? t.terminal.events.long : t.terminal.events.short;

        // Позиции не было - стала: лимитка исполнилась.
        if (trade.status === "planned" && was <= 0 && now > 0) {
          raise({
            id: `${trade.id}:in`,
            symbol: trade.symbol,
            title: t.terminal.events.entered(base(trade.symbol)),
            text: t.terminal.events.enteredAt(side, fmtPrice(trade.entry, limits?.tick ?? 0)),
            tone: trade.side === "long" ? "up" : "down",
          });
          play("entry");

          // Сделка становится открытой здесь же, а не только когда трейдер
          // вернётся к её монете.
          //
          // Раньше «ждёт» превращалось в «открыта» единственным местом - тем,
          // что следит за показанной парой. Пока трейдер смотрел на другую,
          // исполнившаяся лимитка оставалась ждущей: разметки позиции нет,
          // журнал о ней не знает, а уведомление приходило в тот момент, когда
          // он возвращался, - о входе, случившемся десять минут назад.
          //
          // Опрос объёмов видит все пары сразу, и знать о входе он начинает
          // первым. Ему и переводить.
          setTrades((list) =>
            list.map((one) =>
              one.id === trade.id && one.status === "planned"
                ? { ...one, status: "open", openedAt: Date.now() }
                : one,
            ),
          );
          continue;
        }

        // Была - не стало: сделка закрылась. Стопом, целью или руками - об
        // этом скажет журнал, а знать о самом событии трейдер должен сразу,
        // даже если смотрит на другую монету.
        if (trade.status === "open" && was > 0 && now <= 0) {
          raise({
            id: `${trade.id}:out`,
            symbol: trade.symbol,
            title: t.terminal.events.closedTitle(base(trade.symbol)),
            text: t.terminal.events.closedText(side),
            tone: "plain",
          });
          play("order");

          // Перечитываем журнал: в боевом режиме сделку пишет сервер, по
          // исполнениям с биржи, и терминалу об этом никто не сообщает - запись
          // появлялась только после перезагрузки страницы.
          //
          // Несколько раз с растущим шагом, а не дважды. Сервер ждёт, пока
          // биржа покажет закрывающее исполнение, а она показывает его когда
          // захочет: бывает сразу, бывает через полминуты. Двух попыток на это
          // не хватало, и в журнале оставалась наша оценка - та, что считана по
          // цене стакана и без комиссии.
          for (const wait of JOURNAL_RETRIES) {
            if (wait === 0) setJournalKey((key) => key + 1);
            else window.setTimeout(() => setJournalKey((key) => key + 1), wait);
          }
        }
      }
    }

    look();
    const id = setInterval(look, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  /**
   * На телефоне терминала нет.
   *
   * Три панели рядом, перетаскивание уровней мышью и стакан в сорок строк на
   * ладони не работают, и в нижнем меню телефона раздела нет. Но открывается
   * терминал первым, и вход с телефона вёл ровно туда - в то, чем нельзя
   * пользоваться. Уводим в раздел, который на телефоне живёт.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return;
    window.location.replace("/app/analysis");
  }, []);

  // Отметки открытой монеты: их рисует график и подсвечивает стакан.
  const myAlerts = alerts.filter((a) => a.symbol === symbol);
  const alertPrices = myAlerts.map((a) => a.price);

  /**
   * Список для скринера тремя разделами: сделки, избранное, остальное.
   *
   * Наверху то, за чем следят: открытая позиция или ждущая заявка. Следом
   * избранное - монеты, которые трейдер отобрал сам. Дальше поток по обороту.
   * Внутри разделов порядок прежний, тот, что задан выбранной сортировкой.
   *
   * Монету, выпавшую из состава наблюдения, поднять неоткуда: её строки в
   * потоке просто нет. Разметка сделки при этом никуда не девается - она на
   * графике, стоит открыть монету.
   */
  const traded = useMemo(
    () => new Set(trades.filter((t) => t.status !== "closed").map((t) => t.symbol)),
    [trades],
  );
  /**
   * Что происходит по каждой монете: ждёт заявка или набрана позиция.
   *
   * Открытая сильнее ждущей: по одной монете бывает и то и другое, а в списке
   * место под одну точку - и она должна говорить о деньгах, которые уже в
   * рынке, а не о намерении.
   */
  const tradeState = useMemo(() => {
    const map = new Map<string, "planned" | "open">();
    for (const t of trades) {
      if (t.status === "planned" && !map.has(t.symbol)) map.set(t.symbol, "planned");
      else if (t.status === "open") map.set(t.symbol, "open");
    }
    return map;
  }, [trades]);
  const starred = useMemo(() => new Set(favorites), [favorites]);
  const screenerRows = useMemo(() => {
    const mine = screener.filter((r) => traded.has(r.symbol));
    const liked = screener.filter((r) => !traded.has(r.symbol) && starred.has(r.symbol));
    if (onlyFavorites) return [...mine, ...liked];
    const rest = screener.filter((r) => !traded.has(r.symbol) && !starred.has(r.symbol));
    return [...mine, ...liked, ...rest];
  }, [screener, traded, starred, onlyFavorites]);

  const toggleFavorite = useCallback((sym: string) => {
    setFavorites((list) =>
      list.includes(sym) ? list.filter((s) => s !== sym) : [...list, sym],
    );
  }, []);

  // Сделки по открытой монете: их рисует график, остальные ждут своей.
  const mine = trades.filter((t) => t.symbol === symbol && t.status !== "closed");

  /**
   * Ждущие входа заявки - их прикладывают к сообщению скрепкой.
   *
   * По всем монетам, а не только по открытой: лимитки ставят с вечера на
   * десяток инструментов, а показать одну из них хотят, стоя на другом
   * графике - и переключаться ради этого туда и обратно незачем.
   *
   * Снимком, а не ссылкой: заявку через минуту переставят или отменят, а в
   * ленте должно остаться то, что человек показал.
   */
  const pendingShares = useMemo(
    () => trades.filter((t) => t.status === "planned").map(fromActive),
    [trades],
  );


  /**
   * Сколько заявок ждёт и сколько позиций в работе - по всем монетам.
   *
   * Заявки свои: на бирже они лежат по одной монете, и спрашивать их по всем
   * полусотне значило бы полсотни запросов на каждом круге. Позиции - биржевые:
   * они приходят одним ответом, и врать о них нельзя.
   */
  const counts = useMemo(() => {
    const waiting = trades.filter((t) => t.status === "planned").length;
    const open = Object.values(liveSizes).filter((size) => size > 0).length;
    return { waiting, open };
  }, [trades, liveSizes]);

  /**
   * Уровни, которые трейдер тянет мышью.
   *
   * Заготовка ручной лимитки - целиком: вход, стоп и цель. У идущей сделки -
   * только защита: вход состоялся, и двигать его нечем.
   *
   * Собираем здесь, а не в графике: график знает геометрию, но о заявках и
   * деньгах знать не должен.
   */
  const dragLevels = useMemo<DragLevel[]>(() => {
    const out: DragLevel[] = [];

    if (manual) {
      const step = limits?.tick ?? 0;
      const at = (kind: "entry" | "stop" | "take"): DragLevel => ({
        id: `manual:${kind}`,
        kind,
        price: kind === "entry" ? manual.entry : kind === "stop" ? manual.stop : manual.take,
        title:
          kind === "entry"
            ? t.terminal.levels.entry
            : kind === "stop"
              ? t.terminal.levels.stop
              : t.dialogs.manual.target,
        color:
          kind === "entry"
            ? "var(--pane-text)"
            : kind === "stop"
              ? "var(--pane-down)"
              : "var(--pane-up)",
        onDrag: (price) => setManual((draft) => (draft ? moveLevel(draft, kind, price, step) : draft)),
        onDrop: () => {
          // На бирже этой заявки ещё нет - отпускать некуда.
        },
      });
      out.push(at("entry"), at("stop"), at("take"));
    }

    for (const trade of mine) {
      if (trade.status === "closed") continue;
      if (trade.status === "planned") {
        // Позиции ещё нет - значит и саму лимитку можно перенести. У открытой
        // сделки вход уже состоялся, и двигать его нечем.
        out.push({
          id: `${trade.id}:entry`,
          trade: trade.id,
          kind: "entry",
          price: trade.entry,
          title: t.terminal.levels.limit,
          color: "var(--pane-text)",
          onDrag: (price) => dragTrade(trade, "entry", 0, price),
          onDrop: (price) => void dropTrade(trade, "entry", 0, price),
        });
      }
      out.push({
        id: `${trade.id}:stop`,
        trade: trade.id,
        kind: "stop",
        price: trade.stop,
        title: t.terminal.levels.stop,
        color: "var(--pane-down)",
        onDrag: (price) => dragTrade(trade, "stop", 0, price),
        onDrop: (price) => void dropTrade(trade, "stop", 0, price),
      });
      trade.targets.slice(trade.takesHit).forEach((price, index) => {
        out.push({
          id: `${trade.id}:take${index}`,
          trade: trade.id,
          kind: "take",
          price,
          title: t.terminal.levels.target(trade.takesHit + index + 1),
          color: "var(--pane-up)",
          onDrag: (next) => dragTrade(trade, "take", index, next),
          onDrop: (next) => void dropTrade(trade, "take", index, next),
        });
      });
    }

    return out;
    // Обработчики читают свежее состояние через setTrades - пересобирать
    // список из-за них не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, mine, limits?.tick]);


  // Тема уезжает наружу: по ней светлеет оболочка сайта вокруг терминала.
  // Белые панели на чёрной странице выглядят вырезанными из другого
  // приложения.
  //
  // Уезжает именно лист: палитра свечей меняет график, а не кабинет.
  useEffect(() => {
    setTerminalTheme(paper);
  }, [paper]);

  // Нажатие мимо меню снимка закрывает его. Меню, которое не уходит само,
  // остаётся висеть поверх графика и мешает работать.
  useEffect(() => {
    if (!shotMenu) return;
    function away(event: PointerEvent) {
      if (!shotMenuRef.current?.contains(event.target as Node)) setShotMenu(false);
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") setShotMenu(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [shotMenu]);

  // То же для списка палитр.
  useEffect(() => {
    if (!themeMenu) return;
    function away(event: PointerEvent) {
      if (!themeMenuRef.current?.contains(event.target as Node)) setThemeMenu(false);
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") setThemeMenu(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [themeMenu]);

  /**
   * Снимок графика: скачать, скопировать или получить ссылку.
   *
   * Картинка собирается из холста графика и шапки с монетой, таймфреймом,
   * именем и временем: чужой скриншот без этих подписей бесполезен.
   */
  async function takeShot(action: "download" | "copy" | "link" | "chat") {
    setShotMenu(false);
    const taken = shotRef.current?.();
    if (!taken || !symbol) {
      setOrderNote({ text: t.terminal.notes.chartNotReady, bad: true });
      return;
    }

    // Пустой снимок выглядит как настоящий: файл на месте, размеры верные, а
    // внутри ровное поле. Молчать нельзя - трейдер отправит пустоту и узнает об
    // этом от собеседника. Заодно называем, что нашлось: без этих чисел причину
    // пустого снимка не отличить от причины пустого графика.
    if (taken.source === "empty") {
      const why = taken.note ? ` · ${taken.note}` : "";
      setOrderNote({ text: t.terminal.notes.shotEmpty(taken.layers, why), bad: true });
      return;
    }

    // Читать холсты браузер может и запрещать - защита от отпечатка в Brave, в
    // Firefox с resistFingerprinting, в расширениях приватности. Картинка тогда
    // собирается верно, а наружу уходит белый лист, и по самой картинке этого не
    // понять. Снимок всё равно отдаём: вдруг ограничено только чтение.
    const guard =
      taken.source === "blocked"
        ? t.terminal.notes.shotGuard
        : "";

    // Обещанием, а не готовой картинкой: право писать в буфер браузер даёт
    // только на свежее нажатие, и любое ожидание между кликом и записью его
    // снимает - запись молча отклоняется, а в буфере остаётся прежнее.
    const building = Promise.resolve(
      composeShot(taken.canvas, {
        symbol,
        interval: timeframe,
        author: author ?? undefined,
        theme: paper,
      }),
    );

    if (action === "copy") {
      const done = await copyShot(building);
      setOrderNote({
        text: done
          ? t.terminal.notes.shotCopied(guard)
          : t.terminal.notes.shotCopyFailed,
        bad: !done || guard !== "",
      });
      return;
    }

    const picture = await building;

    if (action === "download") {
      await downloadShot(picture, `${base(symbol)}-${timeframe}`);
      setOrderNote({ text: t.terminal.notes.shotSaved(guard), bad: guard !== "" });
      return;
    }

    setOrderNote({ text: t.terminal.notes.shotUploading, bad: false });
    try {
      const saved = await uploadShot(picture, { symbol, interval: timeframe, theme: paper });
      if (!saved) {
        setOrderNote({ text: t.terminal.notes.linkFailed, bad: true });
        return;
      }

      // В чат - тем же снимком: в ленте он показывается картинкой, а нажатие
      // открывает ту же страницу на сайте, что и ссылка.
      if (action === "chat") {
        await shotToChat(saved.url, saved.image);
        setChatOpen(true);
        setOrderNote({ text: t.terminal.notes.shotToChat, bad: false });
        return;
      }

      const link = saved.url;
      // Ссылку сразу в буфер: её для того и просят, чтобы отправить дальше.
      try {
        await navigator.clipboard.writeText(link);
        setOrderNote({ text: t.terminal.notes.linkCopied(link), bad: false });
      } catch {
        setOrderNote({ text: link, bad: false });
      }
    } catch {
      setOrderNote({ text: t.terminal.notes.linkFailed, bad: true });
    }
  }

  // Класс темы для рабочих панелей: стакан и график светлеют вместе.
  const pane = paper === "light" ? "pane-light" : "pane-dark";
  const paneStyle = paneHeight(journalOpen, journalH, full);

  return (
    <div
      className={
        full
          ? // Слой поверх всего: навигация сайта и его отступы остаются под
            // ним. Просить у браузера полный экран мало - без этого слоя
            // терминал всё равно сидел бы в шапке и нижней панели.
            `${pane} fixed inset-0 z-[70] overflow-auto bg-bg-deep p-2`
          : // Отступы по краям - те же восемь точек, что и между панелями.
            // Кабинет держит по краям шестнадцать и двадцать четыре: остальным
            // разделам это к лицу, а терминалу нет - у него по краям пустые
            // поля, а в середине панели вплотную друг к другу. Снимаем отступ
            // кабинета своим отрицательным полем и задаём свой.
            `${pane} -mx-4 px-2 md:-mx-6 lg:-mb-8 lg:pb-2`
      }
    >
      {/* Уведомления поверх всего: лимитка срабатывает сама, и почти всегда
          тогда, когда трейдер смотрит на другую монету. */}
      <div
        className="flex flex-col gap-3 xl:flex-row xl:gap-0"
        style={
          {
            "--screener-w": `${screenerW}px`,
            "--dom-w": `${domW}px`,
            "--chat-w": `${chatW}px`,
          } as React.CSSProperties
        }
      >
        {/* Свёрнутый скринер: узкая полоса, по которой его видно и можно
            вернуть. Прятать совсем нельзя - трейдер не должен вспоминать, где
            была панель. */}
        {!screenerOpen && (
          <button
            onClick={() => setScreenerOpen(true)}
            title={t.terminal.expandScreener}
            // Отступ справа — тот же, что даёт разделитель у открытого
            // скринера: свёрнутая полоса не должна прилипать к стакану.
            className={`hidden w-9 shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] py-3 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)] xl:mr-2 xl:flex`}
            style={paneStyle}
          >
            <PanelLeftOpen className="h-4 w-4" />
            <span
              title={connected ? t.terminal.streamOn : t.terminal.streamOff}
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--pane-up)]" : "bg-[var(--pane-down)]"}`}
            />
            <span className="text-[11px]" style={{ writingMode: "vertical-rl" }}>
              {t.terminal.screenerTitle}
            </span>
          </button>
        )}

        {/* Скринер: ширина по своим колонкам, без растягивания. */}
        <section
          className={`${screenerOpen ? "flex" : "hidden"} shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] xl:w-[var(--screener-w)]`}
          style={paneStyle}
        >
          <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-2 py-1.5">
            <span className="text-xs font-semibold text-[var(--pane-text)]">{t.terminal.screenerTitle}</span>
            <div className="flex items-center gap-1">
              {/* Связь переехала сюда из заголовка страницы: строка заголовка
                  съедала полсотни пикселей высоты, а знать о разрыве потока
                  нужно постоянно. */}
              <span
                title={connected ? t.terminal.streamOn : t.terminal.streamOff}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                  connected ? "text-[var(--pane-up)]" : "bg-[var(--pane-down-soft)] text-[var(--pane-down)]"
                }`}
              >
                {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {connected ? t.terminal.streamShort : t.terminal.streamOffShort}
              </span>
              <button
                onClick={() => setScreenerOpen(false)}
                title={t.terminal.collapseScreener}
                className={`${CHIP} ${CHIP_OFF}`}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-[var(--pane-border)] px-2 py-2">
            <button
              onClick={() => setOnlyFavorites((v) => !v)}
              title={
                onlyFavorites
                  ? t.terminal.showAll
                  : t.terminal.showOnlyMine
              }
              className={`${CHIP} mr-1 ${
                onlyFavorites ? "text-[var(--pane-gold)]" : CHIP_OFF
              }`}
            >
              <Star className="h-3 w-3" fill={onlyFavorites ? "currentColor" : "none"} />
            </button>
            <span className="mr-1 text-[11px] text-[var(--pane-muted)]">{t.terminal.sorting}</span>
            {SORT_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`${CHIP} ${
                  sort === key ? CHIP_ON : "text-[var(--pane-text-2)] hover:text-[var(--pane-text)]"
                }`}
              >
                {t.domScreener.sortLabels[key]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ScreenerTable
              rows={screenerRows}
              selected={symbol}
              state={tradeState}
              favorites={starred}
              onToggleFavorite={toggleFavorite}
              sort={sort}
              onSort={setSort}
              onSelect={selectSymbol}
            />
          </div>
        </section>

        {/* Свёрнутую панель тянуть не за что — разделитель не нужен. */}
        {screenerOpen && (
          <PaneDivider onResize={resizeScreener} title={t.terminal.screenerWidth} />
        )}

        {symbol ? (
          <>
            {/* Стакан: ширина по своим колонкам, история прокручивается влево. */}
            <section
              className={`${pane} flex shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-text-2)] xl:w-[var(--dom-w)]`}
              style={paneStyle}
            >
              {/* Шапка переносится по строкам, а не выдавливает кнопки наружу.
                  На монете с мелким шагом подпись «= 0.00000001» длиннее всех
                  кнопок вместе взятых, и глубина уезжала за край панели. */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-[var(--pane-border)] px-3 py-2">
                <span className="font-semibold text-[var(--pane-text)]">{base(symbol)}</span>
                {/* Без словесных подписей: множители и глубина разделены
                    чертой, а что делает кнопка - говорит подсказка при
                    наведении. Рядом с множителем стоит получившийся шаг в
                    деньгах - по нему и ориентируются, а не по кратности. */}
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-0.5">
                  {STEPS.map((step) => (
                    <button
                      key={step.agg}
                      onClick={() => setAgg(step.agg)}
                      title={t.terminal.aggTitle(step.agg)}
                      className={`${CHIP} ${agg === step.agg ? CHIP_ON : CHIP_OFF}`}
                    >
                      {step.label}
                    </button>
                  ))}
                  {dom && dom.tick > 0 && (
                    <span
                      className="ml-1 max-w-[7rem] truncate font-mono text-[10px] text-[var(--pane-text-2)]"
                      title={t.terminal.tickTitle(fmtPrice(dom.tick, dom.tick))}
                    >
                      = {fmtPrice(dom.tick, dom.tick)}
                    </span>
                  )}

                  <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />
                  {DEPTHS.map((depth) => (
                    <button
                      key={depth}
                      onClick={() => setRows(depth)}
                      title={t.terminal.depthTitle(depth)}
                      className={`${CHIP} ${rows === depth ? CHIP_ON : CHIP_OFF}`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1">
                {dom ? (
                  <DomTrader
                    frame={dom}
                    onZoom={zoomDom}
                    onPickLevel={setLevel}
                    onHoverLevel={hoverLevel}
                    alerts={alertPrices}
                    footerHeight={axisHeight}
                  />
                ) : (
                  <p className="grid h-full place-items-center text-sm text-[var(--pane-muted)]">
                    {t.terminal.collectingDom(base(symbol))}
                  </p>
                )}
              </div>
            </section>

            <PaneDivider onResize={resizeDom} title={t.terminal.domWidth} />

            {/* График занимает всё оставшееся место. */}
            <section
              className={`${pane} flex min-w-0 flex-1 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]`}
              style={paneStyle}
            >
              <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-2">
                {/* Название инструмента переехало на сам график: там же цена и
                    плита, и всё это рядом с свечами, а не по краю рамки. */}
                <div className="flex items-center gap-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      title={t.terminal.timeframe}
                      className={`${CHIP} ${timeframe === tf ? CHIP_ON : CHIP_OFF}`}
                    >
                      {tf}
                    </button>
                  ))}

                  {/* Вид свечей - продолжение выбора таймфрейма: и то и другое
                      отвечает на «как смотреть», а не «что нарисовать поверх». */}
                  <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />
                  <button
                    onClick={() => toggle("heavy")}
                    title={t.terminal.volumeCandles}
                    className={`${CHIP} ${indicators.heavy ? CHIP_ON : CHIP_OFF}`}
                  >
                    <CandlestickChart className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-0.5">
                  {LAYER_ORDER.map((key) => (
                    <button
                      key={key}
                      onClick={() => toggle(key)}
                      className={`${CHIP} ${indicators[key] ? CHIP_ON : CHIP_OFF}`}
                    >
                      {UNTRANSLATED_LAYERS[key] ?? (layerLabels as Record<string, string>)[key]}
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
                          title={t.terminal.shelvesFrom(step.label)}
                          className={`${CHIP} ${shelf === step.value ? CHIP_ON : CHIP_OFF}`}
                        >
                          {step.label}
                        </button>
                      ))}
                    </>
                  )}

                  {alertPrices.length > 0 && (
                    <button
                      onClick={() =>
                        setAlerts((list) => list.filter((a) => a.symbol !== symbol))
                      }
                      title={t.terminal.clearAlerts}
                      className={`${CHIP} text-[var(--pane-gold)] hover:bg-[var(--pane-bg)]`}
                    >
                      {t.terminal.alertsCount(alertPrices.length)}
                    </button>
                  )}

                  {mine.length > 0 && (
                    <button
                      onClick={() => {
                        // Последняя открытая по этой монете: остальные
                        // закрываются со своего ярлыка на графике.
                        setClosing(mine[mine.length - 1]);
                        setCloseOpen(true);
                      }}
                      title={t.terminal.closePosition}
                      className={`${CHIP} ${CHIP_ON}`}
                    >
                      {t.terminal.tradeChip} ✕{mine.length > 1 ? ` (${mine.length})` : ""}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const next = !sound;
                      setSoundOn(next);
                      // Первое нажатие ещё и разрешает браузеру звук: до
                      // действия пользователя он играть не даёт.
                      if (next) play("order");
                    }}
                    title={sound ? t.terminal.soundOn : t.terminal.soundOff}
                    className={`${CHIP} ${sound ? CHIP_ON : CHIP_OFF}`}
                  >
                    {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  </button>

                  <button
                    onClick={() => setExchangeOpen(true)}
                    title={
                      exchange?.connected
                        ? t.terminal.exchangeConnected(exchange.key_tail)
                        : t.terminal.connectExchange
                    }
                    className={`${CHIP} ${exchange?.connected ? CHIP_ON : CHIP_OFF}`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={() => setJournalOpen((v) => !v)}
                    title={t.terminal.journalTitle}
                    className={`${CHIP} ${journalOpen ? CHIP_ON : CHIP_OFF}`}
                  >
                    <BookText className="h-3.5 w-3.5" />
                  </button>

                  <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />

                  {/* Лист графика: белая бумага или тёмная. Он же красит
                      кабинет вокруг терминала, поэтому и остался отдельной
                      кнопкой - это одно нажатие, а не выбор из списка. */}
                  <button
                    onClick={() => setPaper((p) => (p === "dark" ? "light" : "dark"))}
                    title={t.terminal.chartPaper}
                    className={`${CHIP} ${CHIP_OFF}`}
                  >
                    {paper === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  </button>

                  {/* Палитра свечей: стандартная и пять пресетов. Независима от
                      листа - любую можно включить и на белом, и на тёмном. Два
                      кружка у строки показывают рост и падение на текущем
                      листе: имена пресетов ни о чём не говорят, пока их не
                      увидишь, а на разной бумаге они выглядят по-разному. */}
                  <div className="relative" ref={themeMenuRef}>
                    <button
                      onClick={() => setThemeMenu((v) => !v)}
                      title={t.terminal.chartPalette}
                      className={`${CHIP} ${themeMenu ? CHIP_ON : CHIP_OFF}`}
                    >
                      <Palette className="h-3.5 w-3.5" />
                    </button>
                    {themeMenu && (
                      <div className="absolute right-0 top-7 z-30 w-40 overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] py-1 shadow-xl">
                        {CHART_PALETTES.map((key) => {
                          const swatch = paletteSwatch(key, paper);
                          return (
                            <button
                              key={key}
                              onClick={() => {
                                setPalette(key);
                                setThemeMenu(false);
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)] ${
                                palette === key ? "text-[var(--pane-text)]" : "text-[var(--pane-text-2)]"
                              }`}
                            >
                              <span className="flex shrink-0 gap-0.5">
                                {[swatch.bull, swatch.bear].map((color, side) => (
                                  <span
                                    key={side}
                                    className="h-2.5 w-2.5 rounded-sm border border-[var(--pane-border)]"
                                    style={{ background: color }}
                                  />
                                ))}
                              </span>
                              {key === "default" ? t.terminal.paletteDefault : CHART_PRESETS[key].name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Снимок графика: три способа поделиться одним нажатием. */}
                  <div className="relative" ref={shotMenuRef}>
                    <button
                      onClick={() => setShotMenu((v) => !v)}
                      title={t.terminal.shotTitle}
                      className={`${CHIP} ${shotMenu ? CHIP_ON : CHIP_OFF}`}
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    {shotMenu && (
                      <div className="absolute right-0 top-7 z-30 w-44 overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] py-1 shadow-xl">
                        {(
                          [
                            ["download", t.terminal.shotDownload],
                            ["copy", t.terminal.shotCopy],
                            ["link", t.terminal.shotLink],
                            ["chat", t.chat.shotToChat],
                          ] as const
                        ).map(([action, label]) => (
                          <button
                            key={action}
                            onClick={() => takeShot(action)}
                            className="block w-full px-3 py-1.5 text-left text-[11px] text-[var(--pane-text-2)] transition-colors hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={toggleFull}
                    title={full ? t.terminal.collapseFull : t.terminal.expandFull}
                    className={`${CHIP} ${full ? CHIP_ON : CHIP_OFF}`}
                  >
                    {full ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* В полном экране шапки сайта нет, а знак нужен: он же и
                    дорога назад - нажатие уводит на главную. */}
                {full && (
                  // Знак и радио вместе, как в шапке кабинета: в полном экране
                  // её не видно, а музыку выключают чаще всего именно отсюда -
                  // когда рынок пошёл и нужна тишина. Плеер общий, поэтому
                  // кнопка здесь управляет тем же потоком, что и та.
                  <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
                    <Logo
                      href="/app/analysis"
                      tone={paper === "light" ? "text-[var(--pane-text)]" : "text-text-primary"}
                      className="text-base"
                    />
                    <RadioChip tone="pane" />
                  </div>
                )}
              </div>

              {/* Инструмент, цена и плита — отдельной строкой под таймфреймами.
                  Наложением поверх холста эта строка терялась: библиотека
                  графика рисует своим слоем, и спорить с ним ради трёх слов
                  незачем. */}
              <div className="flex h-6 items-center gap-3 border-b border-[var(--pane-border)] px-3 font-mono text-[11px] tabular-nums">
                <span className="text-[12px] font-semibold text-[var(--pane-text)]">
                  {base(symbol)}
                </span>
                <span className="text-[var(--pane-text-2)]">
                  {dom ? fmtPrice(dom.mid, dom.tick) : "-"}
                </span>
                {dom?.wall && (
                  <span
                    className="cursor-help text-[var(--pane-gold)]"
                    title={
                      t.terminal.wallTitle
                    }
                  >
                    {t.terminal.wall(money(dom.wall.notional), fmtPrice(dom.wall.price, dom.tick))}
                    {dom.wall.side === "bid" ? t.terminal.support : t.terminal.resistance}
                  </span>
                )}
                {/* Защита сверена с биржей: цели на графике и цели на бирже -
                    разные вещи, и знать об этом трейдер должен сразу. */}
                {plans && mine.some((t) => t.status === "open") && (
                  <>
                    {plans.takes === 0 && mine.some((t) => t.targets.length > 0) && (
                      <span className="text-[var(--pane-down)]" title={t.terminal.targetsOffExchangeTitle}>
                        {t.terminal.targetsOffExchange}
                      </span>
                    )}
                    {plans.stops === 0 && (
                      <span className="text-[var(--pane-down)]" title={t.terminal.stopOffExchangeTitle}>
                        {t.terminal.stopOffExchange}
                      </span>
                    )}
                    {/* Цены целей график берёт с биржи. Когда разложить их по
                        целям нельзя - на бирже их другое число, - он рисует
                        замысел, и об этом надо сказать: молча показанная цель
                        по цене, которой на бирже нет, хуже отсутствия цели.
                        Только при одной открытой сделке: на двух биржа отдаёт
                        общий список, и он не сойдётся никогда. */}
                    {plans.takes > 0 &&
                      (() => {
                        const open = mine.filter((t) => t.status === "open");
                        return (
                          open.length === 1 &&
                          open[0].targets.length - open[0].takesHit !==
                            (plans.take_prices?.length ?? 0)
                        );
                      })() && (
                        <span
                          className="text-[var(--pane-down)]"
                          title={t.terminal.takesMismatchTitle}
                          >
                          {t.terminal.takesMismatch}
                        </span>
                      )}
                  </>
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

                {/* Баланс и монеты - из шапки сайта, которой в этом режиме
                    нет. Прижаты к правому краю: слева живёт рынок, справа
                    счёт, и путать их нельзя. */}
                {full && (
                  <span className={`flex items-center gap-3 ${orderNote ? "" : "ml-auto"}`}>
                    {coins !== null && (
                      <span className="text-[var(--pane-gold)]">{coins.toLocaleString("ru")} NMNH</span>
                    )}
                    {balance !== null && (
                      <span className="text-[var(--pane-text)]">{fmtUsd(balance)}</span>
                    )}
                  </span>
                )}
              </div>

              <div className="relative min-h-0 flex-1 p-1">
                {/* Уведомления - вверху по центру самого графика: событие
                    случается, пока трейдер смотрит сюда, и здесь же он его
                    видит. Нажатие открывает монету, о которой речь. */}
                <Toasts
                  items={toasts}
                  onClose={dismissToast}
                  onPick={(next) => {
                    selectSymbol(next);
                    dismissSymbol(next);
                  }}
                />

                {manual && (
                  <ManualOrderCard
                    draft={manual}
                    tick={limits?.tick ?? 0}
                    maxLeverage={limits?.max_leverage}
                    takerFee={limits?.taker_fee}
                    maxQty={limits?.max_qty}
                    maxPosition={limits?.max_position}
                    free={Number(balance ?? 0) || 0}
                    onChange={setManual}
                    onSubmit={sendManual}
                    onCancel={() => setManual(null)}
                  />
                )}

                <PriceChart
                  symbol={symbol}
                  interval={timeframe}
                  wall={dom?.wall ?? null}
                  shelves={dom?.shelves ?? []}
                  paper={paper}
                  preset={palette}
                  indicators={indicators}
                  trades={mine}
                  preview={preview}
                  livePrice={chartPrice}
                  liveCandle={dom?.candle ?? null}
                  onCloseTrade={(t) => {
                    setClosing(t);
                    setCloseOpen(true);
                  }}
                  showJournal={journalOpen}
                  journalKey={journalKey}
                  ghost={(() => {
                    const one = picked ?? hovered;
                    return one && one.symbol === symbol ? one : null;
                  })()}
                  hoverLevel={levelHint}
                  shot={shotRef}
                  // Шаг сетки лестницы делим на укрупнение: биржевой шаг от
                  // него не зависит, а точность шкалы должна быть по бирже.
                  tick={dom && dom.tick > 0 ? dom.tick / Math.max(1, agg) : undefined}
                  alerts={myAlerts}
                  onRemoveAlert={(id) => setAlerts((list) => list.filter((a) => a.id !== id))}
                  onShelfClick={openTrade}
                  dragLevels={dragLevels}
                  orderChip={orderChip}
                  onAddAlert={addAlert}
                  onOpenJournal={() => setJournalOpen((open) => !open)}
                  counts={counts}
                  onAddOrder={startManual}
                  onAxisHeight={setAxisHeight}
                />
              </div>
            </section>

            {/* Чат справа от графика - той же жизнью, что и скринер слева:
                открывается, тянется за разделитель, сворачивается в полосу.
                Свёрнутый прячется не совсем: полоса у правого края говорит, где
                он был, - иначе панель ищут заново каждый раз.

                Только на широком экране. Ниже xl терминал складывается в
                колонку, и лента разговора между графиком и журналом оказалась
                бы там, где её никто не ждёт; для узкого экрана есть страница
                чата в кабинете. */}
            {chatOpen ? (
              <>
                <PaneDivider onResize={resizeChat} title={t.terminal.chatWidth} />
                <section
                  className={`${pane} hidden shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] xl:flex xl:w-[var(--chat-w)]`}
                  style={paneStyle}
                >
                  <ChatRoom
                    tone="pane"
                    symbol={symbol ?? undefined}
                    pending={pendingShares}
                    onClose={() => setChatOpen(false)}
                  />
                </section>
              </>
            ) : (
              <button
                onClick={() => setChatOpen(true)}
                title={t.terminal.expandChat}
                className="hidden w-9 shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] py-3 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)] xl:ml-2 xl:flex"
                style={paneStyle}
              >
                <PanelRightOpen className="h-4 w-4" />
                {/* Точка непрочитанного: мигает, пока панель свёрнута. Разговор
                    в торговый час идёт о том, что происходит прямо сейчас, и
                    узнать о нём через час - всё равно что не узнать. */}
                {chat.unread > 0 && (
                  <span
                    title={t.chat.unread(chat.unread)}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--pane-accent)]"
                  />
                )}
                <span className="text-[11px]" style={{ writingMode: "vertical-rl" }}>
                  {t.chat.title}
                </span>
              </button>
            )}
          </>
        ) : (
          <section
            className={`grid flex-1 place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-6 text-center text-sm text-[var(--pane-muted)]`}
            style={paneStyle}
          >
            {t.terminal.pickSymbol}
          </section>
        )}
      </div>

      {/* Развилка по уровню из стакана: расчёт сделки или уведомление. */}
      {level && (
        <LevelMenu
          row={level}
          tick={dom?.tick ?? 0}
          alerted={alertPrices.includes(level.price)}
          onTrade={() => {
            openTradeFromRow(level);
            setLevel(null);
          }}
          onAlert={() => {
            toggleAlert(level.price);
            setLevel(null);
          }}
          onCancel={() => setLevel(null)}
        />
      )}

      {need && (
        <ConnectDialog
          need={need}
          onConnect={() => {
            setNeed(null);
            // Полной перезагрузкой: уходим из терминала совсем, а он держит
            // сокеты стакана и ленты - обрывать их всё равно придётся.
            if (need === "login") window.location.href = "/login";
            else setExchangeOpen(true);
          }}
          onClose={() => setNeed(null)}
        />
      )}

      {closeOpen && closing && (
        <CloseDialog
          trade={closing}
          price={dom?.mid ?? 0}
          tick={dom?.tick ?? 0}
          onConfirm={applyClose}
          onCancel={() => {
            setCloseOpen(false);
            setClosing(null);
          }}
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
            // Ключи подключили - баланс теперь берётся по ним, а не по UID.
            void loadBalance();
            setExchangeOpen(false);
          }}
        />
      )}

      {journalOpen && (
        <>
          <PaneDivider
            onResize={resizeJournal}
            title={t.terminal.journalHeight}
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
              onPick={(t) => {
                setPicked(t);
                if (t.symbol !== symbol) setSymbol(t.symbol);
              }}
              owner={author ?? undefined}
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
          opposing={opposing}
          maxLeverage={limits?.max_leverage}
          takerFee={limits?.taker_fee}
        />
      )}
    </div>
  );
}
