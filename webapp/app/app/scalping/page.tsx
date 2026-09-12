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
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookText,
  CandlestickChart,
  Lock,
  ChevronLeft,
  ChevronRight,
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
  ScrollText,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import CandleLensIcon from "@/components/scalping/CandleLensIcon";
import ChatRoom from "@/components/chat/ChatRoom";
import { fromActive, shareShot as shotToChat } from "@/lib/chat/share";
import type { SharedTrade } from "@/lib/chat/store";
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
  paneInk,
  isChartPaper,
  isChartPresetName,
  paletteSwatch,
  type ChartPaletteName,
  type ChartPaper,
} from "@/lib/indicator/presets";
import TradeDialog, { type TradeDraft } from "@/components/scalping/TradeDialog";
import JournalPanel from "@/components/scalping/JournalPanel";
import { hasFootprint } from "@/lib/indicator/footprint";
import {
  allowedAgg,
  allowedRows,
  FREE_MAX_AGG,
  FREE_ROWS,
  TOOLS_SHOP,
  useTools,
  VISION_LAYERS,
} from "@/lib/tools";
import { play } from "@/lib/sound";
import { asText as logText, clear as clearLog, record } from "@/lib/log";
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
import { setActiveSymbol } from "@/lib/symbolLink";
import { readTrades, writeTrades } from "@/lib/tradeStore";
import {
  announceClose,
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
  nudgeWatcher,
  openPosition,
  openBook,
  positionIn,
  liveTrades,
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
  loadCalendar,
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
  MISSING_TOLERANCE,
  noteMiss,
  shouldBury,
  type Miss,
} from "@/lib/trade/missing";
import {
  advanceQuote,
  closeOnExchange,
  closePartially,
  createTrade,
  pickFilled,
  wasEntered,
  type ActiveTrade,
} from "@/lib/trade/position";
import PositionsChip from "@/components/scalping/PositionsChip";
import {
  base,
  money,
  price as fmtPrice,
  type LadderRow,
  type ScreenerRow,
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

// Не чаще этого просим сервер проверить сделки вне очереди. Сопровождение само
// не принимает просьб чаще раза в две секунды (NUDGE_GAP), и просьба раньше
// ушла бы впустую.
const NUDGE_EVERY_MS = 2100;

// Цена дошла до цели: сколько после этого спрашиваем биржу часто и как часто.
// Стоп в безубыток сервер переставляет за секунду-две, а обычный опрос раз в
// четыре секунды показывал это на экране секунд через восемь-десять.
const RUSH_MS = 15000;
const RUSH_POLL_MS = 700;

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
//
// Нижняя граница стакана - одна колонка истории рядом с ценой: 111 на колонку,
// 177 на цену с заявками, остальное поля. Это самый узкий стакан, который ещё
// стакан: лестница цен целиком и одна свеча объёмов слева.
//
// В такую ширину не помещается шапка со всеми подписями - поэтому шаг в
// деньгах в ней прячется (см. DOM_TICK_W): он есть в подсказке множителя, а
// перенос ряда на вторую строку съедает у лестницы больше, чем эта подпись
// даёт.
const PANE_LIMITS = {
  screener: { def: 500, min: 360, max: 900 },
  dom: { def: 620, min: 300, max: 1200 },
  // Чат уже остальных: это лента коротких реплик, а не таблица. Шире 640 он
  // начинает отбирать место у графика, ради которого трейдер здесь и сидит.
  chat: { def: 340, min: 260, max: 640 },
};

/**
 * Свёрнутая панель: полоса у самого края.
 *
 * Одна на обе стороны - скринер слева, чат справа. Классы у них были свои,
 * зеркальные, и держались одинаковыми только потому, что их однажды написали
 * рядом: любая правка одной стороны разводила полосы по размеру. Общее здесь
 * всё, кроме стороны; сторона дописывается своим набором.
 */
const EDGE_STRIP =
  "hidden w-9 shrink-0 flex-col gap-2 rounded-xl border border-[var(--pane-border)] " +
  "bg-[var(--pane-bg)] py-3 text-[var(--pane-muted)] transition-colors duration-150 " +
  "ease-out hover:text-[var(--pane-text)] xl:flex";

/** Полоса слева: уезжает за левый край, содержимое прижато к правому. */
const EDGE_LEFT = `${EDGE_STRIP} -translate-x-[22px] items-end pr-[4px] xl:-mr-4`;

/** Полоса справа: зеркально. */
const EDGE_RIGHT = `${EDGE_STRIP} translate-x-[22px] items-start pl-[4px] xl:-ml-4`;

/**
 * С какой ширины стакана в шапке показывается шаг в деньгах.
 *
 * Ниже этого ряд из монеты, четырёх множителей, шага и трёх глубин на строке
 * не умещается и переносится - а вторая строка шапки отнимает у лестницы
 * целую цену. Подпись при этом не пропадает совсем: то же число стоит в
 * подсказке любого множителя.
 */
const DOM_TICK_W = 340;

const STORAGE_KEY = "nmnh.scalping.panes";

// Открытая сделка хранится отдельно от настроек: она живёт своей жизнью,
// пишется на каждом изменении и не должна тащить за собой ширины панелей.
// Уйти со страницы и вернуться — обычное дело, а позиция на рынке от этого не
// закрывается, значит и разметка её пропадать не должна.

// По умолчанию включено всё, кроме зон: они заливают половину окна сплошным
// цветом и нужны, только когда смотришь картину крупнее минуты.
// Столько же выдержки - пропавшей с биржи цели. Перенос цели делается заменой:
// прежняя условная заявка снимается, новая ставится, и между этими двумя
// действиями лестница на бирже короче на одну. Без выдержки терминал принимал
// эту дырку за исполнение и объявлял цель взятой - навсегда, потому что число
// взятых только растёт.
const TAKES_TOLERANCE = 2;

/**
 * Сколько сделка, закрытая здесь, не возвращается на график из памяти сервера.
 *
 * Сопровождение узнаёт о закрытии своим обходом раз в пять секунд, и до тех
 * пор считает сделку живой. Минуты хватает с запасом на любой его круг.
 */
const RESTORE_QUIET_MS = 60000;

// Сколько молчать про пропавшие цели после того, как трейдер сам подвинул
// уровень. Замена на бирже занимает доли секунды, но ответ о заявках мог уйти
// ещё до неё и вернуться уже после - двенадцати секунд хватает с запасом.
const MOVE_QUIET_MS = 12000;

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
  /**
   * Раскрыт ли ряд разметки.
   *
   * По умолчанию свёрнут: восемь кнопок слоёв занимают половину верхней
   * строки, а трогают их редко - разметку выбирают один раз и работают.
   * Свёрнутый ряд освобождает середину строки, где стоит знак с плеером.
   */
  layers?: boolean;
  /** Последняя открытая монета: возврат в раздел не должен начинаться с нуля. */
  symbol: string | null;
  /** Отметки на ценах: пережидают перезагрузку вместе с остальными настройками. */
  alerts: PriceAlert[];
  /** Избранные монеты: свой раздел наверху скринера. */
  favorites: string[];
  /** Показывать в скринере только избранное. */
  onlyFavorites: boolean;
  /**
   * Открыт ли разбор свечи по объёму.
   *
   * Живёт вместе с остальными переключателями по той же причине, что и
   * объёмные свечи: это способ смотреть на рынок, а не окно, которое открыли
   * на минуту. Включивший его находит его включённым и завтра.
   */
  foot?: boolean;
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
  // Когда последний раз просили сопровождение проверить сделки вне очереди.
  const nudgedRef = useRef(0);
  // Сделки, у которых цена дошла до цели: при каком числе взятых и каком стопе
  // это случилось и до какого времени спрашиваем биржу часто. Запись остаётся
  // и после конца - иначе цена, стоящая за целью, запускала бы спешку заново.
  const rushRef = useRef(
    new Map<string, { hit: number; stop: number; until: number; done: boolean }>(),
  );
  // Спросить биржу о защите сейчас, не дожидаясь круга. Живёт в круге опроса.
  const kickRef = useRef<(() => void) | null>(null);
  // Чей стоп сейчас едет в безубыток: на графике у него своя подпись.
  const [movingStops, setMovingStops] = useState<ReadonlySet<string>>(() => new Set());
  const syncMoving = useCallback(() => {
    setMovingStops(
      new Set([...rushRef.current].filter(([, rush]) => !rush.done).map(([id]) => id)),
    );
  }, []);
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
  // Перезапрос пределов: после отказа биржи сервер мог узнать новый.
  const [limitsAsked, setLimitsAsked] = useState(0);

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
      setCopyAllowed(Boolean(body.copy_allowed));
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
  // Ответил ли сервер о счёте хотя бы раз. Пока нет - неизвестно, чья правда
  // о сделке: биржевая или своя, и двигать сделку нельзя ни той, ни другой.
  const [exchangeKnown, setExchangeKnown] = useState(false);
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
  // Итог дня по журналу. null - журнал недоступен: ученик не вошёл в кабинет,
  // и показывать ему чужой ноль незачем.
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
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

  // Знак NMNH с плеером в полном экране.
  //
  // Стоит в своей строке и по середине **экрана**: слева от графика стакан, а
  // при открытом скринере ещё и список, и середина колонки уходит правее
  // середины монитора.
  //
  // Но середина экрана - это пожелание, а не закон. Открылся скринер - ряд
  // таймфреймов уехал вправо, и знак по середине экрана лёг бы поверх него.
  // Поэтому отступ зажат между соседями: знак смещается вместе с графиком и
  // ни на кнопки слева, ни на кнопки справа не наезжает.
  const brandRef = useRef<HTMLDivElement>(null);
  const [brandLeft, setBrandLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!full) {
      setBrandLeft(null);
      return;
    }

    const measure = () => {
      const el = brandRef.current;
      const row = el?.offsetParent as HTMLElement | null;
      if (!el || !row) return;

      const kids = [...row.children].filter((node) => node !== el) as HTMLElement[];
      const leftGroup = kids[0];
      const rightGroup = kids.length > 1 ? kids[kids.length - 1] : undefined;
      const gap = 16;

      const want = window.innerWidth / 2 - row.getBoundingClientRect().left - el.offsetWidth / 2;
      const min = leftGroup ? leftGroup.offsetLeft + leftGroup.offsetWidth + gap : 0;
      const max = rightGroup
        ? rightGroup.offsetLeft - el.offsetWidth - gap
        : row.offsetWidth - el.offsetWidth;

      setBrandLeft(Math.round(Math.min(Math.max(want, min), Math.max(min, max))));
    };

    // Первый замер - после того, как строка встала на место.
    const first = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    // Соседи меняют ширину и без изменения окна: свернули скринер, раскрыли
    // ряд разметки, сменили инструмент на длинное имя.
    const watch = new ResizeObserver(measure);
    const row = brandRef.current?.offsetParent as HTMLElement | null;
    if (row) watch.observe(row);
    for (const node of row ? [...row.children] : []) watch.observe(node);

    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("resize", measure);
      watch.disconnect();
    };
  }, [full, screenerOpen]);
  // Ряд разметки свёрнут по умолчанию: кнопки слоёв трогают редко, а места они
  // занимают половину строки.
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLSpanElement>(null);
  const [screenerW, setScreenerW] = useState(PANE_LIMITS.screener.def);
  // Стакан открывается самым узким из допустимых.
  //
  // Ширину ему задаёт не он сам, а то, что стоит рядом: график. Пришедший на
  // терминал впервые видит стакан на треть экрана и график в остаток - а
  // смотрят в первую очередь на график, стакан же читается и в минимальной
  // ширине, у него все колонки на месте. Кому нужен широкий - тянет за
  // разделитель; такая ширина держится, пока не откроют монету из скринера:
  // выбор монеты - это начало работы с ней, и начинают её с графика.
  const [domW, setDomW] = useState(PANE_LIMITS.dom.min);
  // Чат закрыт на старте: день начинается с рынка, а не с разговора. Открытый
  // держится до конца сессии, ширина переживает перезагрузку.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatW, setChatW] = useState(PANE_LIMITS.chat.def);
  // Фотография из Telegram: ею подписаны сообщения в чате. Путь приходит от
  // бэкенда, а сайт живёт на другом домене - отсюда и API_URL.
  const [avatar, setAvatar] = useState<string | null>(null);
  // Допуск к копированию сделок из чата. Выдаётся наставником поимённо и
  // приходит вместе с профилем: кнопки «войти» недопущенный не увидит вовсе.
  const [copyAllowed, setCopyAllowed] = useState(false);
  // Чат подключён, пока открыт терминал, - даже со свёрнутой панелью: иначе
  // точка непрочитанного загоралась бы только у того, кто и так в него смотрит.
  const chat = useSyncExternalStore(chatSubscribe, chatSnapshot, chatServer);
  useEffect(() => openChat(), []);

  /**
   * Сообщение чата из адреса: /app/scalping?chat=41.
   *
   * Так сюда приводит ссылка «обсуждение» в карточке сигнала. Панель при этом
   * открывается сама - иначе человек попадает в терминал и не понимает, за чем
   * его позвали.
   */
  const params = useSearchParams();
  const chatParam = params.get("chat");
  const chatFocus = Number(chatParam) || null;
  // ?chat=open - просто открыть чат: так ведёт баннер сообщества из Маркета.
  useEffect(() => {
    if (chatFocus || chatParam === "open") setChatOpen(true);
  }, [chatFocus, chatParam]);

  // Свеча, разобранная на графике. Живёт здесь, а не в графике: профиль этой
  // свечи приезжает кадром стакана, и сказать серверу, какую именно считать,
  // может только тот, кто держит канал.
  const [footBar, setFootBar] = useState(0);
  // Разбор свечи: открыт или нет. Держим здесь, потому что открывает его
  // кнопка в панели инструментов, а закрыть его можно и на самом графике -
  // крестиком в углу карточки.
  const [footOpen, setFootOpen] = useState(false);
  const footAvailable = hasFootprint(timeframe);

  // Инструменты маркета. Сохранённые настройки не трогаем: выбранные когда-то
  // сто строк или шаг ×25 вернутся сами, как только инструмент куплен. А пока
  // он не куплен, на экран и на сервер идёт разрешённое - бесплатный уровень.
  const tools = useTools();
  const router = useRouter();
  const openTools = useCallback(() => router.push(TOOLS_SHOP), [router]);
  const shownRows = allowedRows(rows, tools.depth);
  const shownAgg = allowedAgg(agg, tools.step25);
  const shownIndicators = useMemo<Indicators>(() => {
    const out = { ...indicators };
    if (!tools.vision) for (const key of VISION_LAYERS) out[key] = false;
    if (!tools.volumeCandles) out.heavy = false;
    return out;
  }, [indicators, tools.vision, tools.volumeCandles]);

  const { screener, dom, connected } = useScalpingFeed({
    symbol,
    rows: shownRows,
    agg: shownAgg,
    sort,
    shelf,
    interval: timeframe,
    foot: tools.footprint ? footBar : 0,
  });

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
    if (typeof saved.layers === "boolean") setLayersOpen(saved.layers);
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
    if (typeof saved.foot === "boolean") setFootOpen(saved.foot);
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
      .then((body) => {
        setExchange(body);
        setExchangeKnown(true);
      })
      // Не ответил - оставляем прежнее. Сброс в «не подключено» переводил
      // терминал на свою арифметику по стакану, и она закрывала живые
      // биржевые сделки по ценам, до которых биржа ничего не исполняла.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadExchange();
  }, [loadExchange]);

  /**
   * Отказ биржи - плашкой над графиком, а не строкой под ним.
   *
   * Строка статуса годится для отчёта в три слова: «заявка на бирже». Отказ
   * устроен иначе - это объяснение с числами, что именно сделать: «на плече
   * ×100 биржа держит позицию не больше 49.74, уменьшите сумму или плечо».
   * В строке он не помещался, расталкивал соседей по ряду и уходил сам через
   * двадцать секунд - ровно то сообщение, которое надо дочитать до конца.
   *
   * Плашка встаёт там же, где уведомления о входе и целях, - вверху графика,
   * куда трейдер и смотрит, - переносится по строкам и закрывается крестиком.
   *
   * Опознаватель - сам текст: два нажатия подряд с одним и тем же отказом
   * поднимают одну плашку, а не стопку одинаковых.
   */
  const refuse = useCallback((text: string) => {
    play("error");
    pushToast({ id: `refusal:${text}`, title: t.terminal.notes.refusedTitle, text, tone: "down", prose: true });
  }, [t]);

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

  /**
   * Ряд разметки закрывается сам, как только нажали мимо.
   *
   * Слои выбирают одним движением - включил, посмотрел, вернулся к цене, - и
   * оставленный открытым ряд отнимает половину верхней строки у того, ради
   * чего терминал открыт. Нажатие внутри самого ряда не в счёт: там как раз и
   * выбирают, иногда по нескольку слоёв подряд.
   */
  useEffect(() => {
    if (!layersOpen) return;
    function away(event: PointerEvent) {
      if (layersRef.current?.contains(event.target as Node)) return;
      setLayersOpen(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [layersOpen]);

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
      layers: layersOpen,
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
      foot: footOpen,
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
    layersOpen,
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
    footOpen,
  ]);

  /**
   * Журнал действий - в буфер обмена.
   *
   * Именно текстом и именно в буфер: его вставляют в переписку, а не открывают
   * в отдельном окне. Не дал браузер записать в буфер - показываем размер и
   * складываем файлом, чтобы человеку было что приложить.
   */
  async function copyLog() {
    const text = logText();
    try {
      await navigator.clipboard.writeText(text);
      setOrderNote({ text: t.terminal.notes.logCopied(text.split("\n").length - 5), bad: false });
    } catch {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nmnh-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      setOrderNote({ text: t.terminal.notes.logSaved, bad: false });
    }
  }

  /**
   * Повторить чужую заявку у себя.
   *
   * Уровни берутся один в один - вход, стоп и цели, - а объём считается по
   * своей сумме. Копировать чужой объём было бы не «той же сделкой», а другим
   * риском: у автора за этими цифрами свой депозит, у копирующего свой.
   *
   * Плечо берём авторское: им задан характер сделки, и менять его значит
   * повторять не её.
   */
  const copyTrade = useCallback(
    async (shared: SharedTrade) => {
      if (!copyAllowed) return;
      if (!exchange?.connected) {
        setOrderNote({ text: t.terminal.notes.notConnected, bad: true });
        setExchangeOpen(true);
        return;
      }

      const qty = (margin * shared.leverage) / shared.entry;
      if (!(qty > 0)) return;
      record("copy.start", { symbol: shared.symbol, side: shared.side, entry: shared.entry, qty });

      // График переезжает на монету сделки: разметка должна встать там, где на
      // неё можно смотреть.
      if (shared.symbol !== symbol) selectSymbol(shared.symbol);

      const next = createTrade(
        {
          symbol: shared.symbol,
          side: shared.side,
          entry: shared.entry,
          stop: shared.stop,
          targets: shared.targets,
          qty,
          margin,
          leverage: shared.leverage,
        },
        `${shared.symbol}-${Date.now()}`,
      );
      setTrades((list) => [...list, next]);
      setOrderNote({ text: t.terminal.notes.sendingOrder, bad: false });

      try {
        const result = await openPosition(next, true);
        if (!result) throw new Error(t.terminal.notes.orderRejected);
        setOrderNote({ text: t.chat.copied(base(shared.symbol)), bad: false });
      } catch (err) {
        // Та же осторожность, что и у своей заявки: биржа отказала - убираем и
        // с графика, иначе трейдер ждёт вход, которого нет.
        setTrades((list) => list.filter((t) => t.id !== next.id));
        // Отказ мог назвать предел позиции на плече - сервер его запомнил.
        setLimitsAsked((n) => n + 1);
        refuse(err instanceof Error ? err.message : t.terminal.notes.orderRejected);
      }
    },
    [copyAllowed, exchange?.connected, margin, refuse, symbol, selectSymbol, t],
  );

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
    // Символ терминала - он же активный символ приложения: панели за его
    // пределами и палитра по Ctrl+K смотрят на одно значение.
    setActiveSymbol(next);
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
    // Снятый расчёт уходит с экрана сразу.
    //
    // Позиции по нему нет: на бирже стоят только ждущие заявки - лимитка
    // входа, стоп и цели. Снять их - дело сервера и биржи, и занимает оно
    // секунды; всё это время разметка отменённой сделки продолжала висеть на
    // графике, и трейдер жал «снять» второй раз, думая, что не попал.
    //
    // Порядок «сначала биржа, потом экран» остаётся там, где он и нужен, - у
    // открытой позиции: пометить её закрытой, не закрыв на бирже, значит
    // сказать трейдеру, что он вышел, пока деньги стоят в рынке. У ждущей
    // заявки такой цены у ошибки нет, а не сорвалось - вернём на место и
    // скажем словами.
    if (current.status === "planned") {
      const { remaining } = closePartially(current, share, dom?.mid ?? 0, Date.now());
      setTrades((list) => list.map((t) => (t.id === current.id ? remaining : t)));
      setDraft(null);
      try {
        const result = await closePosition(current, share);
        if (result?.note) setOrderNote({ text: t.terminal.notes.exchangeNote(result.note), bad: false });
      } catch (err) {
        const text = err instanceof Error ? err.message : t.terminal.notes.closeFailed;
        // 428 - ключей нет: снимать на бирже нечего, расчёт был только у нас.
        if (text.includes("подключите") || text.includes("428")) return;
        // Заявки на бирже остались - значит и на графике им место.
        setTrades((list) => list.map((t) => (t.id === current.id ? current : t)));
        refuse(text);
      }
      return;
    }

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
          refuse(text);
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
      setLimitsAsked((n) => n + 1);
      refuse(err instanceof Error ? err.message : t.terminal.notes.limitRejected);
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
    // Пока идёт замена заявки, лестница на бирже короче на одну - и это не
    // исполнение. Отметку ставим до запроса и обновляем после ответа: круг
    // опроса мог уйти ещё до переноса, а вернуться уже после.
    movedRef.current.set(trade.id, Date.now());
    record("level.move", { id: trade.id, kind, index, from: was, to: price });
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
      movedRef.current.set(trade.id, Date.now());
      record("level.moved", { id: trade.id, kind, entry: body.entry, stop: body.stop, takes: body.takes });
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
      refuse(err instanceof Error ? err.message : t.terminal.notes.moveRejected);
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
    record("order.send", {
      id: next.id,
      symbol: next.symbol,
      side: next.side,
      entry: next.entry,
      stop: next.stop,
      targets: next.targets,
      qty: next.qty,
      leverage: next.leverage,
    });
    try {
      const result = await openPosition(next, true);
      // Ответа нет - значит запрос и не ушёл: сессия кончилась между открытием
      // окна и нажатием. Это отказ, а не тихий успех.
      if (!result) throw new Error(t.terminal.notes.orderRejected);
      record("order.placed", { id: next.id, warning: result.warning || undefined });
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
      record("order.rejected", {
        id: next.id,
        why: err instanceof Error ? err.message : String(err),
      });
      setTrades((list) => list.filter((t) => t.id !== next.id));
      // Отказ мог назвать предел позиции на плече - сервер его запомнил, и
      // следующая заявка должна упереться в него ещё в окне, а не на бирже.
      setLimitsAsked((n) => n + 1);
      refuse(err instanceof Error ? err.message : t.terminal.notes.orderRejected);
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
    const book = dom?.symbol ?? "";
    if (!(bid > 0) || !(ask > 0) || !book) return;
    // Пока сервер не сказал, подключён ли счёт, неизвестно, кто ведёт сделку.
    //
    // При переходе в терминал стакан приезжает по сокету раньше, чем ответ о
    // счёте, и первые кадры шли в свою арифметику, как у сделки без биржи. Она
    // закрывала живые биржевые сделки по цене стакана: трейдер видел «сделка
    // отработала», хотя на бирже позиция стояла, а после F5 сервер возвращал
    // её на график.
    if (!exchangeKnown) return;
    setTrades((list) => {
      let changed = false;
      const now = Date.now();
      const updated = list.map((current) => {
        // Цена стакана - только своей монете. Сделки идут по нескольким
        // монетам, а стакан один: цена BTC, приложенная к лонгу ETH,
        // «брала» все его цели разом, к шорту - выбивала стоп.
        if (current.symbol !== book) return current;
        // При подключённом счёте вход и выход подтверждает биржа: наша
        // арифметика ведёт только разметку идущей позиции.
        const next = advanceQuote(current, { bid, ask }, now, live);
        if (next !== current) changed = true;
        return next;
      });
      return changed ? updated : list;
    });
  }, [dom?.best_bid, dom?.best_ask, dom?.symbol, live, exchangeKnown]);

  // Цена дошла до цели идущей сделки - стоп вот-вот поедет в безубыток.
  //
  // Переносит его сервер, а экран узнавал об этом опросом раз в четыре
  // секунды - и ещё столько же о том, что стоп уже переставлен: трейдер видел
  // старый стоп секунд десять после взятой цели. Стакан показывает касание
  // сразу, и с этого мгновения мы зовём сервер и спрашиваем биржу часто, пока
  // стоп на ней не сменится.
  //
  // Сама линия едет только по ответу биржи: стакан у нас с другой площадки, и
  // касание его цены ещё не исполнение. До ответа на стопе подпись, что
  // перенос идёт.
  useEffect(() => {
    if (!live || !symbol) return;
    const bid = dom?.best_bid ?? 0;
    const ask = dom?.best_ask ?? 0;
    if (!(bid > 0) || !(ask > 0)) return;
    const now = Date.now();
    let fresh = false;
    for (const trade of tradesRef.current) {
      if (trade.symbol !== symbol || trade.status !== "open") continue;
      const next = trade.targets[trade.takesHit];
      if (!(next > 0)) continue;
      const reached = trade.side === "long" ? bid >= next : ask <= next;
      if (!reached) continue;
      if (rushRef.current.get(trade.id)?.hit === trade.takesHit) continue;
      rushRef.current.set(trade.id, {
        hit: trade.takesHit,
        stop: trade.stop,
        until: now + RUSH_MS,
        done: false,
      });
      fresh = true;
    }
    if (!fresh) return;
    syncMoving();
    kickRef.current?.();
  }, [dom?.best_bid, dom?.best_ask, live, symbol, syncMoving]);

  // Позиция глазами биржи. Терминал обязан быть её зеркалом: своё состояние он
  // может держать сколько угодно, но правда о том, открыта ли позиция, — там.
  //
  // Спрашиваем биржу одним снимком по всем монетам, а не по сделке за раз.
  // Раньше на каждую идущую сделку уходил свой запрос каждые три секунды, и
  // вместе с опросом объёмов их набиралось по нескольку в секунду. На такую
  // частоту биржа отвечает пустотой - а пустота здесь означала закрытую
  // позицию.
  //
  // Пустота, которой биржа не показала позицию: когда началась, когда
  // засчитана последний раз и сколько промахов накопилось. Меряем временем, а
  // не числом кругов: после первого промаха включалась перепроверка через
  // восемь десятых секунды, и вся выдержка съедалась за две секунды одной
  // заминкой биржи. Именно так 10 сентября с графика ушли две живые позиции
  // по ETH - на бирже они стояли, на экране их не стало.
  const missingRef = useRef(new Map<string, Miss>());
  /**
   * Объёмы прошлого круга опроса: по ним видно переход «не было - стало».
   *
   * Опрос теперь один - тот, что стережёт сделки. Их было два: зеркало сделки
   * спрашивало биржу по каждой открытой монете каждые три секунды, а этот -
   * все позиции разом каждые пять. На двух идущих сделках выходило по три-
   * четыре запроса позиций в секунду, и биржа отвечала на них пустотой - той
   * самой, по которой разметка уходила с графика.
   */
  const sizesRef = useRef<Record<string, number> | null>(null);

  // Сколько кругов подряд цели нет на бирже и когда трейдер последний раз
  // двигал уровни этой сделки. Оба живут между кругами опроса.
  // Когда сделка была закрыта здесь: столько времени она не возвращается на
  // график из памяти сервера.
  const buriedRef = useRef(new Map<string, number>());
  const goneRef = useRef(new Map<string, number>());
  const movedRef = useRef(new Map<string, number>());
  // Цена монеты для записи о закрытии: по открытой - из стакана, по остальным -
  // из списка. Сделок несколько и монет у них несколько, а стакан всегда один.
  const screenerRef = useRef<ScreenerRow[]>([]);
  screenerRef.current = screener;
  // Стережём все идущие сделки, а не только показанную монету. Позиция по ETH
  // закрывается, пока трейдер смотрит BTC, и узнать об этом он должен тогда
  // же, а не вернувшись на её график.
  const watchKey = trades
    .filter((t) => t.status !== "closed")
    .map((t) => `${t.id}:${t.status}`)
    .join("|");

  useEffect(() => {
    // Даже без разметки на графике: сделку, потерянную браузером, возвращает
    // сюда память сервера, и для этого круг должен идти.
    if (!live) return;
    let cancelled = false;

    /** Цена монеты: по открытой - из стакана, по остальным - из списка. */
    function priceOf(sym: string): number {
      if (sym === symbol) return midRef.current;
      return screenerRef.current.find((row) => row.symbol === sym)?.price ?? 0;
    }

    async function check() {
      const watching = tradesRef.current.filter((t) => t.status !== "closed");

      // Что о сделках думает сопровождение на сервере.
      //
      // Спрашиваем первым, до биржи. Второе мнение о том, жива ли сделка: пока
      // сервер её ведёт, пустой ответ биржи был заминкой, а не закрытием. И
      // единственный, кто может рассказать о сделке, когда на графике её нет
      // вовсе, - разметка живёт в браузере, а браузер вещь ненадёжная.
      //
      // Это память сервера, а не поход на биржу: спрашивать её каждый круг
      // дёшево.
      const mind = await liveTrades().catch(() => null);
      if (cancelled) return;
      const served = mind ? new Set(mind.trades.map((one) => one.client_id)) : null;
      const serverSays = new Map((mind?.trades ?? []).map((one) => [one.client_id, one]));
      // Только что закрытые - с настоящими ценой выхода и итогом. По ним
      // уведомление говорит, чем кончилась сделка, а не угадывает.
      const booked = new Map((mind?.closed ?? []).map((one) => [one.client_id, one]));
      // Ни на графике, ни у сервера ничего нет - биржу не тревожим.
      const knows = (mind?.trades ?? []).some((one) => one.status === "open");
      if (watching.length === 0 && !knows) {
        sizesRef.current = null;
        return;
      }

      // Один снимок на круг - на все сделки сразу.
      const book = await openBook().catch(() => null);
      if (cancelled || !book) return;

      // Объёмы прошлого круга: без «до» переход «не было - стало» не отличить
      // от позиции, стоявшей всё это время.
      const sizes: Record<string, number> = {};
      for (const [key, one] of Object.entries(book.byKey)) sizes[key] = one.size;
      const before = sizesRef.current;
      sizesRef.current = sizes;
      setLiveSizes(sizes);

      // Чьи входы ещё стоят на бирже. Без этого списка сводная позиция по
      // монете открывала все ждущие заявки разом: зацепило верхнюю лимитку, а
      // на графике открывались обе, и вторая жила сделкой, которой нет.
      //
      // Не спросили - считаем, что стоят все ждущие: показать заявку ждущей
      // лишние три секунды не страшно, а открыть несуществующую - страшно.
      let resting = new Set(
        watching.filter((t) => t.symbol === symbol && t.status === "planned").map((t) => t.id),
      );
      // Когда вход состоялся на самом деле - по сделкам сервера.
      const opened = new Map<string, number>();
      if (symbol) {
        try {
          const body = await plansOf(symbol);
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
      }

      // Кого биржа не показала. Хоронить по этому ещё рано: пустой ответ
      // приходит и на её заминке.
      const missed = watching.filter(
        (t) => t.status === "open" && !(book.byKey[`${t.symbol}:${t.side}`]?.size > 0),
      );
      // Видим позицию - забываем прошлые пустые ответы.
      for (const t of watching) {
        if (!missed.includes(t)) missingRef.current.delete(t.id);
      }

      const now = Date.now();

      // Решение по каждой сделке считаем здесь, а не внутри пересборки
      // состояния: там нельзя ни считать промахи, ни писать в журнал - React
      // вправе позвать пересборку дважды, и выдержка сгорала бы вдвое быстрее.
      const bury = new Set<string>();
      for (const trade of missed) {
        const one = positionIn(book, trade.symbol, trade.side);
        // Повтор в пределах пары секунд - тот же самый пустой ответ, а не
        // второе мнение биржи. Выдержка меряется временем, а не запросами.
        const miss = noteMiss(missingRef.current.get(trade.id), now);
        missingRef.current.set(trade.id, miss);
        const held = now - miss.since;
        // Знает ли о сделке сервер: да, нет или «не спросили».
        const alive = served ? served.has(trade.id) : null;

        // Пишем каждый пустой ответ, а не только последний: по одной записи
        // «закрыли» нельзя понять, что показывала биржа до этого - пустоту,
        // чужую сторону или пустой ответ целиком.
        record("position.missing", {
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          seen: miss.seen,
          of: MISSING_TOLERANCE,
          held,
          rows: one.rows,
          total: one.total,
          matched: one.matched,
          server: alive,
          takesHit: trade.takesHit,
          targets: trade.targets.length,
        });

        // Хороним только при согласии биржи и сервера: пока сопровождение
        // сделку ведёт, пустой ответ был заминкой, а не закрытием.
        if (!shouldBury(miss, now, alive)) continue;
        bury.add(trade.id);
        missingRef.current.delete(trade.id);
        // Пишем сделку сразу и своей оценкой: сопровождение на сервере
        // поправит её настоящими числами с биржи в ближайшие секунды. Молчать
        // нельзя - если сервер до неё не дойдёт, сделка не попадёт в журнал
        // вовсе, а именно так и терялись закрытые по стопу.
        record("trade.closed", {
          id: trade.id,
          symbol: trade.symbol,
          why: "позиции нет на бирже",
          at: priceOf(trade.symbol),
          held,
          takesHit: trade.takesHit,
          targets: trade.targets.length,
        });

        // Перечитываем журнал: в боевом режиме сделку пишет сервер, по
        // исполнениям с биржи, и терминалу об этом никто не сообщает - запись
        // появлялась только после перезагрузки страницы.
        //
        // Несколько раз с растущим шагом, а не дважды. Сервер ждёт, пока биржа
        // покажет закрывающее исполнение, а она показывает его когда захочет:
        // бывает сразу, бывает через полминуты.
        for (const wait of JOURNAL_RETRIES) {
          if (wait === 0) setJournalKey((n) => n + 1);
          else window.setTimeout(() => setJournalKey((n) => n + 1), wait);
        }
      }

      // Кто именно налился.
      //
      // Позиция приходит одной строкой на монету и сторону, а ждущих заявок в
      // ту же сторону может стоять несколько: трейдер поставил лимитку ниже,
      // передумал и добавил вторую выше, не убрав первую. Открытой объявлялась
      // первая попавшаяся в списке - и трейдер видел вход по цене, которой не
      // было, с чужим стопом и чужими целями.
      //
      // Решаем это до разбора сделок: по каждому ключу, где позиция появилась,
      // выбираем одну заявку - ближайшую к средней цене входа с биржи.
      const filled = new Map<string, string>();
      if (before) {
        for (const key of new Set(watching.map((one) => `${one.symbol}:${one.side}`))) {
          if ((before[key] ?? 0) > 0 || (sizes[key] ?? 0) <= 0) continue;
          const queue = watching.filter(
            (one) => one.status === "planned" && `${one.symbol}:${one.side}` === key,
          );
          const chosen = pickFilled(queue, book.byKey[key]?.entry ?? null);
          if (chosen) filled.set(key, chosen.id);
        }
      }

      // Что биржа рассказала о живых позициях.
      const patch = new Map<string, Partial<ActiveTrade>>();
      for (const trade of watching) {
        const key = `${trade.symbol}:${trade.side}`;
        const one = positionIn(book, trade.symbol, trade.side);

        if (!(one.size > 0)) continue;

        // Позиция набрана: у нас она могла ещё ждать входа. Но только если
        // исполнилась именно эта заявка - соседняя, всё ещё стоящая, к чужой
        // позиции отношения не имеет.
        //
        // По открытой монете это решает список стоящих заявок с сервера, по
        // остальным - появление позиции в этом круге и цена входа с биржи.
        if (trade.status === "planned") {
          const ours =
            trade.symbol === symbol ? !resting.has(trade.id) : filled.get(key) === trade.id;
          if (!ours) continue;

          // Уведомление о входе поднимает наблюдение за состоянием сделки: оно
          // видит переход и по этой монете, и по любой другой, а опознаватель
          // события общий - второй заметивший ничего не добавит.
          record("trade.opened", {
            id: trade.id,
            symbol: trade.symbol,
            size: one.size,
            entry: one.entry,
          });
          patch.set(trade.id, {
            status: "open",
            // Время входа - серверное, а «сейчас» только если сервер его ещё
            // не записал. Взяв «сейчас», сделка начиналась там, где на неё
            // посмотрели, - бокс на графике вставал не у своей свечи.
            openedAt: opened.get(trade.id) ?? Date.now(),
          });
          continue;
        }

        // Объём и цену входа берём биржевые: по ним считается результат на
        // экране. Наша формула не знает ни реальной цены исполнения, ни
        // комиссии, ни фандинга.
        //
        // Стопа здесь нет намеренно. Раньше сюда писалась цена безубытка по
        // расчёту биржи - справочное число, а не заявка, - и она раз в три
        // секунды затирала настоящий стоп. Цену стопа приносит опрос заявок:
        // там она и есть, а не выводится формулой.
        const qty =
          Math.abs(trade.qty - one.size) > one.size * 0.01 ? one.size : trade.qty;
        const entry = one.entry && one.entry > 0 ? one.entry : trade.entry;
        const unrealized = one.unrealized ?? undefined;
        if (qty === trade.qty && entry === trade.entry && unrealized === trade.unrealized) {
          continue;
        }
        patch.set(trade.id, { qty, entry, unrealized });
      }

      // Взятые цели и стоп по монетам, которых нет на экране. По открытой
      // монете это делает опрос защиты ниже - там числа с самой биржи, и спорить
      // с ними серверной памятью незачем.
      for (const trade of watching) {
        if (trade.symbol === symbol || trade.status !== "open") continue;
        const said = serverSays.get(trade.id);
        if (!said) continue;
        // Число взятых только растёт: назад его не отматывает ни сервер, ни мы.
        const takesHit = Math.max(trade.takesHit, said.takes_hit);
        const stop = said.stop > 0 ? said.stop : trade.stop;
        if (takesHit === trade.takesHit && Math.abs(stop - trade.stop) < Math.max(stop, 1) * 0.00001) {
          continue;
        }
        patch.set(trade.id, {
          ...(patch.get(trade.id) ?? {}),
          takesHit,
          stop,
          breakeven: takesHit > 0,
        });
      }

      // Сделка, которую ведёт сервер и показывает биржа, а на графике её нет.
      //
      // Разметка живёт в браузере, и потерять её можно по-разному: другая
      // машина, очищенное хранилище, ошибочные похороны по пустому ответу
      // биржи. Позиция от этого не закрывается - значит и бокс должен
      // вернуться. Возвращаем только по согласию обоих: сервер сделку ведёт и
      // биржа показывает позицию. Ждущие заявки не возвращаем - снятый расчёт
      // не должен воскресать.
      const restore: ActiveTrade[] = [];
      for (const said of mind?.trades ?? []) {
        if (said.status !== "open") continue;
        if (tradesRef.current.some((t) => t.id === said.client_id)) continue;
        if (!(book.byKey[`${said.symbol}:${said.side}`]?.size > 0)) continue;
        // Закрыли только что здесь - сервер ещё не знает.
        if (now - (buriedRef.current.get(said.client_id) ?? 0) < RESTORE_QUIET_MS) continue;

        const one = positionIn(book, said.symbol, said.side);
        const opened = said.opened_at ? new Date(said.opened_at).getTime() : NaN;
        const created = said.created_at ? new Date(said.created_at).getTime() : NaN;
        const openedAt = Number.isFinite(opened) ? opened : Date.now();
        restore.push({
          ...createTrade(
            {
              symbol: said.symbol,
              side: said.side,
              entry: one.entry && one.entry > 0 ? one.entry : said.entry,
              stop: said.initial_stop > 0 ? said.initial_stop : said.stop,
              targets: said.targets,
              qty: one.size > 0 ? one.size : said.qty,
              margin: said.margin,
              leverage: said.leverage,
            },
            said.client_id,
            Number.isFinite(created) ? created : openedAt,
          ),
          status: "open",
          openedAt,
          stop: said.stop > 0 ? said.stop : said.initial_stop,
          takesHit: said.takes_hit,
          breakeven: said.takes_hit > 0,
          unrealized: one.unrealized ?? undefined,
        });
        record("trade.restored", {
          id: said.client_id,
          symbol: said.symbol,
          side: said.side,
          size: one.size,
          takesHit: said.takes_hit,
        });
      }

      if (cancelled || (bury.size === 0 && patch.size === 0 && restore.length === 0)) return;
      setTrades((list) => {
        let changed = restore.length > 0;
        const next = list.map((current) => {
          if (current.status === "closed") return current;
          if (bury.has(current.id) && current.status === "open") {
            changed = true;
            const said = booked.get(current.id);
            return closeOnExchange(
              current,
              priceOf(current.symbol),
              Date.now(),
              said ? { exit: said.exit_price, pnl: said.pnl, fee: said.fee } : null,
            );
          }
          const fields = patch.get(current.id);
          if (!fields) return current;
          changed = true;
          return { ...current, ...fields };
        });
        // Пересборка может случиться дважды - берём только тех, кого ещё нет.
        const fresh = restore.filter((one) => !next.some((t) => t.id === one.id));
        return changed ? [...next, ...fresh] : list;
      });
    }

    // Опрос защиты - один за раз. Круг, частый опрос после цели и проверка
    // после ответа сервера сходятся во времени, и ответ, пришедший не по
    // порядку, затирал бы свежий стоп старым.
    let guarding = false;
    async function guard() {
      if (guarding) return;
      guarding = true;
      try {
        await inspect();
      } finally {
        guarding = false;
      }
    }

    /**
     * Попросить сопровождение проверить сделки - и сразу посмотреть, что
     * вышло, а не ждать круга: стоп переставлен, и показать его надо сейчас.
     */
    function nudge() {
      if (Date.now() - nudgedRef.current <= NUDGE_EVERY_MS) return;
      nudgedRef.current = Date.now();
      nudgeWatcher()
        .then((answer) => {
          if (!cancelled && answer?.checked) void guard();
        })
        .catch(() => undefined);
    }

    /**
     * Частый опрос после взятой цели. Идёт, пока стоп на бирже не сменился
     * или не вышло время, и заканчивается сам.
     */
    function rushTick() {
      const now = Date.now();
      let active = false;
      let changed = false;
      for (const [id, rush] of rushRef.current) {
        if (rush.done) continue;
        const trade = tradesRef.current.find((t) => t.id === id);
        const moved =
          trade !== undefined &&
          trade.takesHit > rush.hit &&
          Math.abs(trade.stop - rush.stop) > Math.max(rush.stop, 1) * 0.00001;
        if (!trade || trade.status !== "open" || moved || now > rush.until) {
          rushRef.current.set(id, { ...rush, done: true });
          changed = true;
        } else {
          active = true;
        }
      }
      if (changed) syncMoving();
      if (active) void guard();
    }

    async function inspect() {
      // Защита спрашивается по монете: без открытого стакана спрашивать не о
      // чем, а сделки по другим монетам стережёт круг выше.
      const open = symbol
        ? tradesRef.current.filter((t) => t.symbol === symbol && t.status === "open")
        : [];
      if (open.length === 0) {
        setPlans(null);
        return;
      }
      try {
        const body = await plansOf(symbol!);
        if (cancelled || !body) return;
        setPlans(body);

        // Цель ушла с биржи, а сопровождение её ещё не засчитало - просим его
        // проверить сделки сейчас. Стоп в безубыток переставляет оно, и ждать
        // его обхода значит стоять со старым стопом уже после взятой цели.
        // Переносимую цель в расчёт не берём: в миг замены целей на бирже
        // тоже меньше, и это не исполнение.
        const lagging = tradesRef.current.some((t) => {
          if (t.symbol !== symbol || t.status !== "open") return false;
          if (Date.now() - (movedRef.current.get(t.id) ?? 0) < MOVE_QUIET_MS) return false;
          const gone =
            body.placed_takes > 0 && Array.isArray(body.take_prices)
              ? t.targets.length - body.take_prices.length
              : 0;
          return gone > body.takes_hit;
        });
        if (lagging) nudge();

        // Жива ли позиция у тех, чья лестница на бирже поредела.
        //
        // Пропавшая цель - это исполнение, только пока позиция стоит. Стоп
        // закрывает позицию целиком, и вместе с ней с биржи разом уходят все
        // оставшиеся цели: по пустой лестнице терминал объявлял «взята цель
        // 3», а следом приходил стоп - два уведомления на одно событие, и
        // первое из них неправда. Позиции нет - значит сделка закрылась, и
        // чем именно, скажет закрытие, по цене выхода.
        //
        // Биржу спрашиваем только когда дырка в лестнице есть: это редкость, а
        // не каждый круг. Не ответила - не засчитываем: подождать круг
        // дешевле, чем объявить цель, которой не было.
        const gaps = open.filter((t) => {
          const gone =
            body.placed_takes > 0 && Array.isArray(body.take_prices)
              ? t.targets.length - body.take_prices.length
              : 0;
          return gone > t.takesHit;
        });
        const standingNow = new Set<string>();
        if (gaps.length > 0) {
          const book = await openBook().catch(() => null);
          if (cancelled) return;
          for (const t of gaps) {
            if ((book?.byKey[`${t.symbol}:${t.side}`]?.size ?? 0) > 0) standingNow.add(t.id);
          }
        }

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
            const gone =
              body.placed_takes > 0 && Array.isArray(body.take_prices)
                ? Math.max(0, t.targets.length - body.take_prices.length)
                : 0;

            // И только если дырка в лестнице держится. Перенос цели делается
            // заменой - прежняя заявка снимается, новая ставится, - и в этот
            // миг целей на бирже действительно меньше. Раньше терминал принимал
            // это за исполнение: трейдер двигал третью цель, а первые две
            // объявлялись взятыми и с графика пропадали, хотя на бирже стояли
            // обе. Ошибка была необратимой - число взятых только растёт.
            const quiet = Date.now() - (movedRef.current.get(t.id) ?? 0) < MOVE_QUIET_MS;
            let standing = 0;
            if (gone > t.takesHit && !quiet && standingNow.has(t.id)) {
              const seen = (goneRef.current.get(t.id) ?? 0) + 1;
              goneRef.current.set(t.id, seen);
              if (seen >= TAKES_TOLERANCE) standing = gone;
            } else {
              goneRef.current.delete(t.id);
            }
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
            //
            // И не сразу после переноса: заявка заменяется, и список на бирже
            // ещё показывает прежнюю цену. Линия цели возвращалась на старое
            // место и лишь потом вставала на новое.
            const live =
              !quiet && Array.isArray(body.take_prices) && body.take_prices.length === ahead
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
            if (hit !== t.takesHit) {
              record("takes.hit", {
                id: t.id,
                symbol: t.symbol,
                was: t.takesHit,
                now: hit,
                gone,
                quiet,
                placed: body.placed_takes,
                standing: Array.isArray(body.take_prices) ? body.take_prices.length : null,
                serverSays: body.takes_hit,
              });
            }
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
    const rush = setInterval(rushTick, RUSH_POLL_MS);
    // Касание цели в стакане: позвать сервер и спросить биржу сразу.
    kickRef.current = () => {
      nudge();
      void guard();
    };
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(watch);
      clearInterval(rush);
      kickRef.current = null;
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
        // Одно уведомление на закрытие - то же, что поднимает оболочка
        // кабинета: с исходом и итогом, а сказанное по дороге снимается.
        announceClose(row);
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
    //
    // И помечаем закрытыми здесь. Сопровождение на сервере узнаёт о закрытии
    // своим обходом, через несколько секунд, и всё это время оно считает
    // сделку живой - а терминал возвращает на график живые сделки сервера.
    // Без отметки закрытая руками сделка возвращалась бы на несколько секунд.
    if (trades.some((t) => t.status === "closed")) {
      const now = Date.now();
      for (const t of trades) {
        if (t.status === "closed") buriedRef.current.set(t.id, now);
      }
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

  // Сколько монеты уже занято на бирже: позиции обеих сторон и ждущие входы.
  // Предел позиции биржа считает по всему сразу, и окну заявки нужно знать,
  // сколько места осталось, а не только сам предел.
  const usedQty = useMemo(() => {
    if (!live || !symbol) return 0;
    const sym = symbol.toUpperCase();
    const held = Object.entries(liveSizes)
      .filter(([key]) => key.startsWith(`${sym}:`))
      .reduce((sum, [, size]) => sum + Math.max(0, size), 0);
    const resting = trades
      .filter((t) => t.symbol === symbol && t.status === "planned")
      .reduce((sum, t) => sum + Math.max(0, t.qty || 0), 0);
    return held + resting;
  }, [live, symbol, liveSizes, trades]);

  // Пределы спрашиваем на смену монеты: они не меняются месяцами и лежат в
  // кэше сервера, но у каждой монеты свои. И после отказа биржи: он мог
  // назвать предел на плече, и сервер его запомнил.
  useEffect(() => {
    if (!symbol) {
      setLimits(null);
      return;
    }
    let cancelled = false;
    // Смена монеты - прежние пределы не годятся. Перезапрос по той же монете
    // оставляет их до ответа: окно заявки не должно мигать без них.
    setLimits((prev) => (prev?.symbol === symbol.toUpperCase() ? prev : null));
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
  }, [symbol, limitsAsked]);

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
   * На телефоне терминала нет.
   *
   * Три панели рядом, перетаскивание уровней мышью и стакан в сорок строк на
   * ладони не работают, и в нижнем меню телефона раздела нет. Но открывается
   * терминал первым, и вход с телефона вёл ровно туда - в то, чем нельзя
   * пользоваться. Уводим в раздел, который на телефоне живёт.
   */
  // Переходом внутри приложения, а не перезагрузкой: перезагрузка обрывает
  // радио и всё, что держит открытый кабинет.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return;
    router.replace("/app/analysis");
  }, [router]);

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
  // Все идущие сделки, по всем монетам: их показывает кнопка «позиции».
  const active = trades.filter((t) => t.status !== "closed");

  /**
   * Свои сделки для скрепки: и ждущие входа, и уже идущие.
   *
   * По всем монетам, а не только по открытой: лимитки ставят с вечера на
   * десяток инструментов, а показать одну из них хотят, стоя на другом
   * графике - и переключаться ради этого туда и обратно незачем.
   *
   * Снимком, а не ссылкой: заявку через минуту переставят или отменят, позиция
   * закроется, а в ленте должно остаться то, что человек показал.
   */
  const myShares = useMemo(
    () =>
      trades
        .filter((t) => t.status !== "closed")
        // Биржа - от ключа счёта: идущая сделка открыта там, где стоит ключ.
        // Без ключа сделка учебная, и подписывать карточку биржей нечем.
        .map((t) => ({ ...fromActive(t), exchange: live ? exchange?.exchange : undefined })),
    [trades, live, exchange?.exchange],
  );


  /**
   * Сколько заявок ждёт и сколько позиций в работе - по всем монетам.
   *
   * Заявки свои: на бирже они лежат по одной монете, и спрашивать их по всем
   * полусотне значило бы полсотни запросов на каждом круге. Позиции - биржевые:
   * они приходят одним ответом, и врать о них нельзя.
   */
  // Итог дня из журнала. Перечитываем после каждой записанной сделки: цифра в
  // строке над графиком должна отвечать на «сколько я сегодня», а не «сколько
  // было на входе».
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    loadCalendar(now.getUTCFullYear(), now.getUTCMonth() + 1)
      .then((body) => {
        if (cancelled || !body) return;
        const today = now.toISOString().slice(0, 10);
        setTodayPnl(body.days.find((d) => d.date === today)?.pnl ?? 0);
      })
      .catch(() => {
        // Журнал недоступен — строка просто останется без итога.
      });
    return () => {
      cancelled = true;
    };
  }, [journalKey]);

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
  // Класс листа стоит только на корне рабочего места.
  //
  // На самих панелях его быть не должно: он объявляет весь набор переменных
  // заново, и цвета выбранной палитры, положенные корню стилем, до стакана уже
  // не доходили - он оставался стандартным зелёно-красным, какую свечу ни
  // выбери. Переменные наследуются, одного объявления сверху хватает всем.
  const pane = paper === "light" ? "pane-light" : "pane-dark";
  const paneStyle = paneHeight(journalOpen, journalH, full);

  // Выбранная палитра красит не только свечи: рост и падение нарисованы и в
  // стакане, и в ленте, и в скринере. Подменяем переменные панелей на корне -
  // ниже их возьмут все, кому они нужны, вместе с полупрозрачными заливками.
  const ink = paneInk(palette, paper) as React.CSSProperties;

  return (
    <div
      className={
        full
          ? // Слой поверх всего: навигация сайта и его отступы остаются под
            // ним. Просить у браузера полный экран мало - без этого слоя
            // терминал всё равно сидел бы в шапке и нижней панели.
            `${pane} fixed inset-0 z-[70] overflow-y-auto overflow-x-hidden bg-bg-deep p-2 pr-1`
          : // Отступы по краям - те же восемь точек, что и между панелями.
            // Кабинет держит по краям шестнадцать и двадцать четыре: остальным
            // разделам это к лицу, а терминалу нет - у него по краям пустые
            // поля, а в середине панели вплотную друг к другу. Снимаем отступ
            // кабинета своим отрицательным полем и задаём свой.
            //
            // Справа поле вдвое уже: за ценовой шкалой графика до края
            // оставалась полоса заметно шире левой, и терминал выглядел
            // сдвинутым влево.
            `${pane} -mx-4 overflow-x-clip pl-2 pr-1 md:-mx-6 lg:-mb-8 lg:pb-2`
      }
      style={ink}
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
            была панель.

            За край экрана уходит почти вся полоса: снаружи остаётся ровно
            столько, сколько занимают значок и подпись, и они встают под самым
            краем. Полоса шире нужного отъедала бы поле у графика впустую. И
            неподвижно:
            полоса, которая выезжает под курсором, тянет взгляд на себя каждый
            раз, когда мимо проходит рука, - а смотреть в этот момент нужно на
            цену. Место, которое она перестала занимать, забирает отрицательное
            поле - иначе между ней и стаканом остался бы зазор в ушедшую
            часть.

            Значок и название прижаты к внутреннему краю - к той части, что
            видна: полоса без подписи это просто выступ у края, о который
            спотыкаются, не зная, что за ним. */}
        {!screenerOpen && (
          <button
            onClick={() => setScreenerOpen(true)}
            title={t.terminal.expandScreener}
            className={EDGE_LEFT}
            style={paneStyle}
          >
            {/* Всё содержимое - в колонках одной ширины. Точка вдесятеро уже
                значка, и прижатая к тому же краю она вставала правее его
                середины: полоса читалась косой. Общая ширина ставит их на одну
                ось, а видно её или нет - решает край экрана. */}
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
            {/* Точка связи между значком и названием: там её ищут глазами - у
                открытого скринера она стоит ровно так же, в его заголовке. */}
            <span
              title={connected ? t.terminal.streamOn : t.terminal.streamOff}
              className="flex h-1.5 w-4 shrink-0 items-center justify-center"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--pane-up)]" : "bg-[var(--pane-down)]"}`}
              />
            </span>
            <span
              className="w-4 text-center text-[11px]"
              style={{ writingMode: "vertical-rl" }}
            >
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

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            <ScreenerTable
              rows={screenerRows}
              selected={symbol}
              state={tradeState}
              favorites={starred}
              onToggleFavorite={toggleFavorite}
              sort={sort}
              onSort={setSort}
              onSelect={(next) => {
                // Монета из скринера открывает стакан заново - и снова самым
                // узким: выбор монеты это начало работы с ней, а начинают её
                // с графика.
                setDomW(PANE_LIMITS.dom.min);
                selectSymbol(next);
              }}
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
              className={`flex shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-text-2)] xl:w-[var(--dom-w)]`}
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
                  {STEPS.map((step) => {
                    const locked = step.agg > FREE_MAX_AGG && !tools.step25;
                    return (
                      <button
                        key={step.agg}
                        onClick={() => (locked ? openTools() : setAgg(step.agg))}
                        title={
                          locked
                            ? t.terminal.toolLocked(t.terminal.toolNames.step25)
                            : t.terminal.aggTitle(step.agg)
                        }
                        className={`${CHIP} ${shownAgg === step.agg ? CHIP_ON : CHIP_OFF} ${
                          locked ? "opacity-60" : ""
                        }`}
                      >
                        {step.label}
                        {locked && <Lock className="ml-0.5 inline h-2.5 w-2.5" />}
                      </button>
                    );
                  })}
                  {dom && dom.tick > 0 && domW >= DOM_TICK_W && (
                    <span
                      className="ml-1 max-w-[7rem] truncate font-mono text-[10px] text-[var(--pane-text-2)]"
                      title={t.terminal.tickTitle(fmtPrice(dom.tick, dom.tick))}
                    >
                      = {fmtPrice(dom.tick, dom.tick)}
                    </span>
                  )}

                  <span className="mx-1 h-3 w-px bg-[var(--pane-border)]" />
                  {DEPTHS.map((depth) => {
                    const locked = depth > FREE_ROWS && !tools.depth;
                    return (
                      <button
                        key={depth}
                        onClick={() => (locked ? openTools() : setRows(depth))}
                        title={
                          locked
                            ? t.terminal.toolLocked(t.terminal.toolNames.depth)
                            : t.terminal.depthTitle(depth)
                        }
                        className={`${CHIP} ${shownRows === depth ? CHIP_ON : CHIP_OFF} ${
                          locked ? "opacity-60" : ""
                        }`}
                      >
                        {depth}
                        {locked && <Lock className="ml-0.5 inline h-2.5 w-2.5" />}
                      </button>
                    );
                  })}
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
              className={`flex min-w-0 flex-1 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]`}
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
                    onClick={() => (tools.volumeCandles ? toggle("heavy") : openTools())}
                    title={
                      tools.volumeCandles
                        ? t.terminal.volumeCandles
                        : t.terminal.toolLocked(t.terminal.toolNames.volumeCandles)
                    }
                    className={`${CHIP} ${shownIndicators.heavy ? CHIP_ON : CHIP_OFF} ${
                      tools.volumeCandles ? "" : "opacity-60"
                    }`}
                  >
                    <span className="inline-flex items-center">
                    <CandlestickChart className="h-3.5 w-3.5" />
                    {!tools.volumeCandles && <Lock className="ml-0.5 inline h-2.5 w-2.5" />}
                    </span>
                  </button>

                  {/* Свеча с лупой: раскрыть текущую свечу её внутренним
                      объёмом. Рядом с объёмными свечами не случайно - обе
                      кнопки про одно и то же, про деньги за движением, только
                      одна показывает их толщиной тела, а другая раскладывает
                      по ценам внутри. Открыть разбор можно было и раньше -
                      нажатием по текущей цене на графике, - но знать об этом
                      надо было заранее: ни кнопки, ни подписи у того движения
                      нет. */}
                  <button
                    onClick={() => (tools.footprint ? setFootOpen((open) => !open) : openTools())}
                    disabled={tools.footprint && !footAvailable}
                    title={
                      !tools.footprint
                        ? t.terminal.toolLocked(t.terminal.toolNames.footprint)
                        : footAvailable
                          ? t.terminal.candleVolume
                          : t.terminal.candleVolumeOff
                    }
                    className={`${CHIP} ${footOpen && tools.footprint ? CHIP_ON : CHIP_OFF} ${
                      !tools.footprint ? "opacity-60" : footAvailable ? "" : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    <span className="inline-flex items-center">
                    <CandleLensIcon className="h-3.5 w-3.5" />
                    {!tools.footprint && <Lock className="ml-0.5 inline h-2.5 w-2.5" />}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-0.5">
                  {/* Ряд разметки прячется за стрелку и по умолчанию свёрнут.
                      Восемь кнопок слоёв занимали половину верхней строки, а
                      трогают их редко: разметку выбирают один раз и работают.
                      Свёрнутый ряд возвращает середину строки знаку с плеером.

                      Стрелка смотрит туда, куда поедет ряд: влево - раскроется
                      влево, вправо - уедет обратно. */}
                  {/* Ряд и его стрелка - одно целое: по этому узлу решается,
                      нажали внутрь ряда или мимо него. `contents` значит, что
                      своей рамки у него нет и раскладка строки не меняется. */}
                  <span ref={layersRef} className="contents">
                  <button
                    onClick={() => setLayersOpen((open) => !open)}
                    title={layersOpen ? t.terminal.layersHide : t.terminal.layersShow}
                    className={`${CHIP} ${layersOpen ? CHIP_ON : CHIP_OFF}`}
                  >
                    {layersOpen ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronLeft className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {layersOpen &&
                    LAYER_ORDER.map((key) => {
                      // Разметка, кроме полок и объёма, - NMNH VISION.
                      const locked =
                        !tools.vision && (VISION_LAYERS as readonly string[]).includes(key);
                      return (
                        <button
                          key={key}
                          onClick={() => (locked ? openTools() : toggle(key))}
                          title={locked ? t.terminal.toolLocked(t.terminal.toolNames.vision) : undefined}
                          className={`${CHIP} ${shownIndicators[key] ? CHIP_ON : CHIP_OFF} ${
                            locked ? "opacity-60" : ""
                          }`}
                        >
                          {UNTRANSLATED_LAYERS[key] ?? (layerLabels as Record<string, string>)[key]}
                          {locked && <Lock className="ml-0.5 inline h-2.5 w-2.5" />}
                        </button>
                      );
                    })}
                  {/* Порог полок стоит рядом с их переключателем: цифра без
                      контекста непонятна, а так видно, к чему она. */}
                  {layersOpen && indicators.shelves && (
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
                  </span>

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

                  {/* Позиции и лимитки по всем монетам. Закрытие ушло отсюда
                      на ярлык сделки на графике: нажатие на пару в окне туда
                      и ведёт. */}
                  {active.length > 0 && (
                    <PositionsChip
                      trades={active}
                      current={symbol}
                      className={`${CHIP} ${CHIP_ON}`}
                      onPick={(next) => {
                        if (next !== symbol) selectSymbol(next);
                      }}
                    />
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
                    дорога назад - нажатие уводит на главную. Вместе с ним
                    радио: в шапке кабинета они стоят рядом, а музыку выключают
                    чаще всего именно отсюда - когда рынок пошёл и нужна тишина.
                    Плеер общий, кнопка здесь управляет тем же потоком.

                    Посреди верхней строки: ряд разметки теперь свёрнут, и
                    середина её свободна. Из-за него знак когда-то и уезжал
                    вниз - на широком экране кнопки слоёв доходили до самого
                    центра и знак ложился поверх них. */}
                {/* Центруется по экрану, а не по колонке графика: слева стоит
                    стакан со скринером, и середина колонки уходит правее
                    середины монитора. Высота при этом прежняя - знак стоит в
                    своей строке, а не всплывает к верхнему краю, - поэтому
                    двигаем только по горизонтали и считаем отступ от окна. */}
                {full && (
                  <div
                    ref={brandRef}
                    className="pointer-events-auto absolute z-20 flex items-center gap-2"
                    style={
                      brandLeft === null
                        ? { left: "50%", transform: "translateX(-50%)" }
                        : { left: brandLeft }
                    }
                  >
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

                {/* Итог дня. Раньше он висел поверх холста, в углу графика, и
                    закрывал собой свечи; здесь ему место по смыслу - это тот
                    же ряд про «что у меня сейчас», что цена и плита. Кнопкой,
                    а не подписью: цифра дня - это вопрос «из чего она», и
                    ответ на него в журнале. */}
                {todayPnl !== null && (
                  <button
                    onClick={() => setJournalOpen((open) => !open)}
                    title={journalOpen ? t.terminal.chart.closeJournal : t.terminal.chart.openJournal}
                    className={`flex items-center gap-1 transition-opacity duration-150 ease-out hover:opacity-80 ${orderNote ? "" : "ml-auto"}`}
                  >
                    <span className="text-[var(--pane-muted)]">{t.terminal.chart.pnlToday}</span>
                    <span className={todayPnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>
                      {todayPnl >= 0 ? "+" : "-"}
                      {Math.abs(todayPnl).toFixed(2)} $
                    </span>
                    {(counts.waiting > 0 || counts.open > 0) && (
                      <>
                        <span className="text-[var(--pane-border)]">·</span>
                        <span className="text-[var(--pane-text-2)]" title={t.terminal.chart.ordersTitle}>
                          {counts.waiting} / {counts.open}
                        </span>
                      </>
                    )}
                  </button>
                )}

                {/* Баланс и монеты - из шапки сайта, которой в этом режиме
                    нет. Прижаты к правому краю: слева живёт рынок, справа
                    счёт, и путать их нельзя. */}
                {full && (
                  <span className={`flex items-center gap-3 ${orderNote || todayPnl !== null ? "" : "ml-auto"}`}>
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
                    leverageCaps={limits?.leverage_caps}
                    used={usedQty}
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
                  indicators={shownIndicators}
                  trades={mine}
                  preview={preview}
                  movingStops={movingStops}
                  livePrice={chartPrice}
                  liveCandle={dom?.candle ?? null}
                  liveFoot={dom?.foot ?? null}
                  onFootBar={setFootBar}
                  // Разбор виден там, где он считается: на крупной свече
                  // сделок миллионы, и сервер её не разбирает. Но выключателя
                  // это не трогает - ушли на часовик и вернулись, разбор
                  // снова на месте. Гасит его только сам трейдер: кнопкой или
                  // крестиком, как и объёмные свечи.
                  footOpen={footOpen && footAvailable && tools.footprint}
                  onFootOpenChange={(open) => {
                    if (footAvailable && tools.footprint) setFootOpen(open);
                  }}
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
                  tick={dom && dom.tick > 0 ? dom.tick / Math.max(1, shownAgg) : undefined}
                  alerts={myAlerts}
                  onRemoveAlert={(id) => setAlerts((list) => list.filter((a) => a.id !== id))}
                  onShelfClick={openTrade}
                  dragLevels={dragLevels}
                  orderChip={orderChip}
                  onAddAlert={addAlert}
                  onAddOrder={startManual}
                  onAxisHeight={setAxisHeight}
                />

                {/* Журнал действий: всё, что нажимал трейдер, и все решения
                    терминала - в буфер обмена одним нажатием, правой кнопкой
                    очистка.

                    В углу самого графика, а не среди инструментов наверху: его
                    жмут не в работе, а когда что-то разошлось с биржей, - и
                    искать его среди двух десятков рабочих кнопок в этот момент
                    не надо. Приглушён, пока на него не навели: угол графика
                    занят ценой, и лишнее пятно там мешает. */}
                <button
                  onClick={copyLog}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    clearLog();
                    record("log.cleared");
                    setOrderNote({ text: t.terminal.notes.logCleared, bad: false });
                  }}
                  title={t.terminal.logTitle}
                  // Просто листочек, без рамки и подложки: это не орган
                  // управления графиком, а служебная мелочь в углу. Кнопкой он
                  // выглядел важнее, чем есть, и вырезал из графика квадрат
                  // ровно там, где идёт цена.
                  className="absolute bottom-0.5 right-1.5 z-20 p-1 text-[var(--pane-muted)] opacity-40 transition-opacity duration-150 ease-out hover:opacity-100 hover:text-[var(--pane-text)]"
                >
                  <ScrollText className="h-3 w-3" />
                </button>
              </div>
            </section>
          </>
        ) : (
          <section
            className={`grid flex-1 place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-6 text-center text-sm text-[var(--pane-muted)]`}
            style={paneStyle}
          >
            {t.terminal.pickSymbol}
          </section>
        )}
          {/* Чат справа от графика - той же жизнью, что и скринер слева:
              открывается, тянется за разделитель, сворачивается в полосу.
              Свёрнутый прячется не совсем: полоса у правого края говорит, где
              он был, - иначе панель ищут заново каждый раз.

              Стоит снаружи выбора монеты, а не внутри. Пока он жил внутри,
              на пустом терминале - когда монету ещё не выбрали и нет ни
              графика, ни стакана - чата не было вовсе: ни панели, ни полосы,
              ни следа от них. Разговор при этом идёт, и место его от выбора
              монеты не зависит.

              Только на широком экране. Ниже xl терминал складывается в
              колонку, и лента разговора между графиком и журналом оказалась
              бы там, где её никто не ждёт; для узкого экрана есть страница
              чата в кабинете. */}
          {chatOpen ? (
            <>
              <PaneDivider onResize={resizeChat} title={t.terminal.chatWidth} />
              <section
                className={`hidden shrink-0 flex-col rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] xl:flex xl:w-[var(--chat-w)]`}
                style={paneStyle}
              >
                <ChatRoom
                  tone="pane"
                  symbol={symbol ?? undefined}
                  own={myShares}
                  onCopy={copyAllowed ? copyTrade : undefined}
                  focus={chatFocus}
                  onClose={() => setChatOpen(false)}
                />
              </section>
            </>
          ) : (
            <button
              onClick={() => setChatOpen(true)}
              title={t.terminal.expandChat}
              // Полоса у правого края - зеркало скринера: почти вся за
              // краем, неподвижно, значок и название под самым краем.
              className={EDGE_RIGHT}
              style={paneStyle}
            >
              {/* Колонки одной ширины - как у скринера: иначе точка
                  непрочитанного встаёт мимо оси значка. */}
              <PanelRightOpen className="h-4 w-4 shrink-0" />
              {/* Метка непрочитанного: пока панель свёрнута, она числом.
                  Разговор в торговый час идёт о том, что происходит прямо
                  сейчас, и узнать о нём через час - всё равно что не узнать.
                  Точка говорила только «что-то было»; число говорит, стоит
                  ли раскрывать панель сию минуту. */}
              {chat.unread > 0 && (
                <span
                  title={t.chat.unread(chat.unread)}
                  className="flex w-4 shrink-0 items-center justify-center"
                >
                  <span className="grid h-4 min-w-4 animate-pulse place-items-center rounded-full bg-[var(--pane-accent)] px-1 text-[9px] font-semibold leading-none text-[var(--pane-bg)]">
                    {chat.unread > 99 ? "99+" : chat.unread}
                  </span>
                </span>
              )}
              <span
                className="w-4 text-center text-[11px]"
                style={{ writingMode: "vertical-rl" }}
              >
                {t.chat.title}
              </span>
            </button>
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
            className={`overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]`}
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
          maxQty={limits?.max_qty}
          maxPosition={limits?.max_position}
          leverageCaps={limits?.leverage_caps}
          used={usedQty}
          free={Number(balance ?? 0) || 0}
        />
      )}
    </div>
  );
}
