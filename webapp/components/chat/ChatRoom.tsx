"use client";

// Общий чат: кто сейчас в комнате, лента и строка ввода.
//
// Один компонент на два места. В кабинете он занимает страницу целиком и
// написан цветами сайта; в терминале живёт узкой панелью справа от графика и
// обязан слушаться листа - на белом графике панель тоже белая. Разводить это на
// два файла значило бы держать две ленты, которые однажды разойдутся.
//
// Цвета поэтому не в разметке, а в таблице ниже: строка «site» - оформление
// кабинета, строка «pane» - переменные панелей терминала.
//
// Сообщения, присутствие и история живут на сервере; здесь только показ и
// отправка. Склад с живым каналом - в lib/chat/store.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Send,
  Crown,
  Pin,
  PanelRightClose,
  Paperclip,
  X,
  ImageIcon,
  Clock,
  Activity,
  BookText,
  Pencil,
  Trash2,
  Check,
  ChevronRight,
  ChevronLeft,
  LogIn,
  Reply,
  Radio,
} from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/content";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { price as fmtPrice } from "@/lib/scalping";
import {
  change,
  drop,
  open,
  post,
  older,
  setReading,
  openThread,
  serverSnapshot,
  snapshot,
  subscribe,
  type ChatAttach,
  type ChatMessage,
  type SharedTrade,
} from "@/lib/chat/store";
import { preview, uploadPhoto, type LinkPreview } from "@/lib/chat/api";
import { fromJournal } from "@/lib/chat/share";
import { journalAvailable, loadTrades, type JournalTrade } from "@/lib/journal";
import { firstLink, type LinkCard } from "@/lib/chat/link";
import PnlCard from "@/components/scalping/PnlCard";
import { cardFromShared } from "@/lib/pnl/data";
import type { CardData } from "@/lib/pnl/card";

/** Где показан чат: страницей кабинета или панелью терминала. */
export type ChatTone = "site" | "pane";

const SKIN: Record<
  ChatTone,
  {
    head: string;
    banner: string;
    bannerText: string;
    bannerArrow: string;
    pinned: string;
    pinnedIcon: string;
    pinnedText: string;
    pinnedName: string;
    feed: string;
    stack: string;
    bubbleSelf: string;
    bubbleOther: string;
    nameMentor: string;
    nameSelf: string;
    nameOther: string;
    muted: string;
    card: string;
    input: string;
    button: string;
    ghost: string;
    note: string;
    up: string;
    down: string;
    divider: string;
    edge: string;
    /** Кнопка ветки: открытой и всех остальных. */
    threadOn: string;
    threadOff: string;
    upDot: string;
    downDot: string;
    pendingDot: string;
    doneDot: string;
    upBox: string;
    downBox: string;
    chip: string;
  }
> = {
  site: {
    head: "mb-3 border-b border-border pb-2",
    banner: "glass mb-3 rounded-xl px-4 py-2.5 text-sm",
    bannerText: "text-text-secondary",
    bannerArrow: "text-accent-cyan",
    pinned: "mb-3 rounded-xl border border-accent-gold/30 bg-accent-gold/[0.06] px-4 py-2.5",
    pinnedIcon: "text-accent-gold",
    pinnedText: "text-sm text-text-secondary",
    pinnedName: "font-semibold text-accent-gold",
    feed: "no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-border bg-bg-panel/40 p-4",
    stack: "mt-auto space-y-3",
    bubbleSelf: "bg-accent-cyan/15 text-text-primary ring-1 ring-accent-cyan/30",
    bubbleOther: "bg-bg-card text-text-primary ring-1 ring-border",
    nameMentor: "text-accent-gold",
    nameSelf: "text-accent-cyan",
    nameOther: "text-text-secondary",
    muted: "text-text-muted",
    card: "rounded-xl border border-border bg-bg-deep/40",
    input: "input flex-1",
    button: "btn-primary px-4",
    ghost:
      "h-full shrink-0 rounded-xl border border-border px-3 text-text-secondary transition-colors hover:text-text-primary",
    note: "mt-2 text-center text-[11px] text-text-muted",
    up: "text-success",
    down: "text-danger",
    divider: "bg-border",
    edge: "border-border",
    threadOn: "bg-accent-cyan/15 text-text-primary ring-1 ring-accent-cyan/30",
    threadOff: "hover:bg-white/[0.06] hover:text-text-primary",
    upDot: "bg-success",
    downDot: "bg-danger",
    pendingDot: "border-warning",
    doneDot: "bg-text-muted",
    upBox: "bg-success/12 text-success ring-1 ring-success/25",
    downBox: "bg-danger/12 text-danger ring-1 ring-danger/25",
    chip: "bg-bg-deep/60 text-text-muted",
  },
  pane: {
    head: "border-b border-[var(--pane-border)] px-2 py-1.5",
    banner:
      "mx-2 mt-2 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2.5 py-1.5 text-[11px]",
    bannerText: "text-[var(--pane-text-2)]",
    bannerArrow: "text-[var(--pane-accent)]",
    pinned:
      "mx-2 mt-2 rounded-lg border border-[var(--pane-gold)]/40 bg-[var(--pane-gold)]/10 px-2.5 py-1.5",
    pinnedIcon: "text-[var(--pane-gold)]",
    pinnedText: "text-[11px] leading-snug text-[var(--pane-text-2)]",
    pinnedName: "font-semibold text-[var(--pane-gold)]",
    feed: "no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2",
    stack: "mt-auto space-y-2",
    bubbleSelf:
      "bg-[var(--pane-accent)]/15 text-[var(--pane-text)] ring-1 ring-[var(--pane-accent)]/30",
    bubbleOther: "bg-[var(--pane-hover)] text-[var(--pane-text)] ring-1 ring-[var(--pane-border)]",
    nameMentor: "text-[var(--pane-gold)]",
    nameSelf: "text-[var(--pane-accent)]",
    nameOther: "text-[var(--pane-text-2)]",
    muted: "text-[var(--pane-muted)]",
    card: "rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]",
    input:
      "min-w-0 flex-1 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2 py-1.5 text-[12px] text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)] focus:border-[var(--pane-accent)]",
    button:
      "shrink-0 rounded-lg border border-[var(--pane-accent)]/50 px-2.5 text-[var(--pane-accent)] transition-colors hover:bg-[var(--pane-accent)]/10",
    ghost:
      "h-full shrink-0 rounded-lg border border-[var(--pane-border)] px-2 text-[var(--pane-text-2)] transition-colors hover:border-[var(--pane-accent)] hover:text-[var(--pane-text)]",
    note: "px-2 pb-2 text-center text-[10px] text-[var(--pane-muted)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
    divider: "bg-[var(--pane-border)]",
    edge: "border-[var(--pane-border)]",
    threadOn:
      "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)] ring-1 ring-[var(--pane-accent-soft)]",
    threadOff: "hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]",
    upDot: "bg-[var(--pane-up)]",
    downDot: "bg-[var(--pane-down)]",
    pendingDot: "border-[var(--pane-gold)]",
    doneDot: "bg-[var(--pane-muted)]",
    upBox: "bg-[var(--pane-up)]/12 text-[var(--pane-up)] ring-1 ring-[var(--pane-up)]/25",
    downBox: "bg-[var(--pane-down)]/12 text-[var(--pane-down)] ring-1 ring-[var(--pane-down)]/25",
    chip: "bg-[var(--pane-hover)] text-[var(--pane-muted)]",
  },
};

type Skin = (typeof SKIN)[ChatTone];

// Сколько истории журнала предлагать в скрепке. Три месяца - то же окно, в
// котором журнал открывается сам; в список берём последние сделки, потому что
// показывают почти всегда свежую.
const JOURNAL_DAYS = 90;
const JOURNAL_SHOWN = 60;

/**
 * Какого дня сообщение. Ключом служит сама дата, а не её подпись: подпись
 * зависит от языка, а группировка - нет.
 */
function dayKey(at: number): string {
  const day = new Date(at);
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
}

/**
 * Аватарка собеседника.
 *
 * Фотография из Telegram есть не у всех: у половины комнаты стоит замок на
 * профиле. Без фотографии - кружок с первой буквой ника, а не общий силуэт: по
 * силуэтам собеседники неразличимы.
 */
function Avatar({ src, name, size = 24 }: { src?: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const side = { width: size, height: size };

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        style={side}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover ring-1 ring-black/10"
      />
    );
  }

  // Цвет по имени, а не случайный: у одного человека он один и тот же всегда.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return (
    <span
      style={{ ...side, background: `hsl(${hash} 45% 40%)`, fontSize: size * 0.45 }}
      className="grid shrink-0 place-items-center rounded-full font-semibold uppercase text-white/90"
    >
      {name.slice(0, 1)}
    </span>
  );
}

function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

/**
 * Карточка сделки или заявки внутри сообщения.
 *
 * У закрытой сделки главное - результат, и он стоит первым по величине: её
 * показывают, чтобы сказать «вот чем кончилось», а не чтобы свериться по
 * ценам. У ждущей заявки наоборот - результата ещё нет, и главное в ней уровни.
 */
function TradeCard({
  trade,
  skin,
  labels,
  onOpen,
}: {
  trade: SharedTrade;
  skin: Skin;
  /** Нажатие по карточке. Нет - карточка просто показывается. */
  onOpen?: () => void;
  labels: Record<
    "entry" | "stop" | "take" | "planned" | "open" | "closed" | "byStop" | "byTake" | "byHand" | "ofMargin",
    string
  >;
}) {
  const long = trade.side === "long";
  const closed = trade.state === "closed";
  const result = trade.state !== "planned" && typeof trade.pnl === "number";
  const win = (trade.pnl ?? 0) >= 0;
  const state =
    trade.state === "planned" ? labels.planned : trade.state === "open" ? labels.open : labels.closed;
  const outcome =
    trade.outcome === "stop" ? labels.byStop : trade.outcome === "take" ? labels.byTake : labels.byHand;

  // Проценты считаем от маржи, а не от объёма: вложено было именно столько, и
  // «плюс двадцать процентов» здесь означает пятую часть внесённых денег.
  const percent =
    result && trade.margin && trade.margin > 0 ? ((trade.pnl ?? 0) / trade.margin) * 100 : null;

  const Box = onOpen ? "button" : "div";

  return (
    <Box
      onClick={onOpen}
      title={onOpen ? undefined : undefined}
      className={`mt-1.5 w-full overflow-hidden text-left text-[11px] ${skin.card} ${
        onOpen ? "transition-opacity hover:opacity-90" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {trade.state === "planned" && <Clock className={`h-3 w-3 ${skin.muted}`} />}
        <span className="text-[12px] font-semibold">{trade.symbol.replace(/USDT$/i, "")}</span>
        <span
          className={`rounded px-1 py-px text-[10px] font-semibold ${long ? skin.upBox : skin.downBox}`}
        >
          {long ? "LONG" : "SHORT"}
        </span>
        <span className={`rounded px-1 py-px text-[10px] ${skin.chip}`}>×{trade.leverage}</span>
        {/* Точка состояния у самой подписи: идущая сделка светится и мигает,
            ждущая - пустой кружок, закрытая - глухой серый. По одному взгляду
            видно, живая она или уже нет. */}
        <span className={`ml-auto flex items-center gap-1 text-[10px] ${skin.muted}`}>
          <span
            className={
              trade.state === "open"
                ? `h-1.5 w-1.5 animate-pulse rounded-full ${long ? skin.upDot : skin.downDot}`
                : trade.state === "planned"
                  ? `h-1.5 w-1.5 rounded-full border ${skin.pendingDot}`
                  : `h-1.5 w-1.5 rounded-full ${skin.doneDot}`
            }
          />
          {closed ? outcome : state}
        </span>
      </div>

      {/* Результат: крупно и с процентом от маржи. Только у закрытой - у ждущей
          заявки его ещё нет, и рисовать там ноль значит соврать. */}
      {result && (
        <div className={`flex items-baseline gap-2 px-2.5 py-1.5 ${win ? skin.upBox : skin.downBox}`}>
          <span className="text-[15px] font-bold leading-none">{money(trade.pnl ?? 0)}</span>
          <span className="text-[10px] opacity-80">USD</span>
          {percent !== null && (
            <span className="ml-auto text-[10px] opacity-80">
              {percent >= 0 ? "+" : "-"}
              {Math.abs(percent).toFixed(1)}% {labels.ofMargin}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 px-2.5 pb-2 pt-1.5">
        {(
          [
            [labels.entry, trade.entry, "", false],
            [labels.stop, trade.stop, skin.down, false],
            // Точки взятых целей стоят у самой подписи «цель», а не отдельной
            // строкой внизу: это про неё, и глазу не нужно связывать их через
            // всю карточку.
            [labels.take, trade.targets[0] ?? 0, skin.up, trade.targets.length > 1],
          ] as const
        ).map(([label, value, colour, dots]) => (
          <div key={label}>
            <div className={`flex items-center gap-1 text-[10px] ${skin.muted}`}>
              {label}
              {dots && (
                <span className="flex items-center gap-px leading-none">
                  {trade.targets.map((_, i) => (
                    <span
                      key={i}
                      className={i < (trade.takesHit ?? 0) ? skin.up : "opacity-40"}
                    >
                      {i < (trade.takesHit ?? 0) ? "●" : "○"}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {/* Цена округляется как на графике: у дорогих монет два знака,
                у дешёвых больше - на них два знака показали бы один и тот же
                ноль вместо цены. */}
            <div className={colour}>{value ? fmtPrice(value) : "-"}</div>
          </div>
        ))}
      </div>
    </Box>
  );
}

// Предпросмотр ссылки спрашиваем у сервера один раз на адрес: одно и то же
// сообщение перерисовывается десятки раз, и ходить за обложкой на каждый кадр
// значит выбрать чужую страницу за десять минут.
const previews = new Map<string, LinkPreview | null>();

function useLinkPreview(link: LinkCard | null): LinkPreview | null {
  const [, redraw] = useState(0);
  const href = link?.href ?? "";

  useEffect(() => {
    if (!href || previews.has(href)) return;
    // Метка «уже спрашиваем»: два сообщения с одной ссылкой не должны
    // отправлять два запроса.
    previews.set(href, null);
    void preview(href).then((body) => {
      if (body && (body.title || body.image)) {
        previews.set(href, body);
        redraw((n) => n + 1);
      }
    });
  }, [href]);

  return href ? (previews.get(href) ?? null) : null;
}

export default function ChatRoom({
  tone = "site",
  symbol,
  own = [],
  onCopy,
  focus,
  onClose,
}: {
  tone?: ChatTone;
  /** Открытая монета: ею подписывается страница отправленной фотографии. */
  symbol?: string;
  /** Свои сделки по всем монетам - идущие и ждущие входа: их прикладывают скрепкой. */
  own?: SharedTrade[];
  /**
   * Повторить чужую заявку у себя.
   *
   * Не передан - кнопки нет. Так это и работает у недопущенных и на странице
   * чата в кабинете: там нет ни графика, ни биржевого счёта.
   */
  onCopy?: (trade: SharedTrade) => void;
  /**
   * Показать это сообщение при открытии.
   *
   * Приходит из адреса, по которому ведёт ссылка «обсуждение» в карточке
   * сигнала: человек пришёл смотреть конкретную заявку, и искать её в ленте
   * глазами он не должен.
   */
  focus?: number | null;
  /** Кнопка сворачивания в шапке. Есть только у панели терминала. */
  onClose?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const skin = SKIN[tone];
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Кто сейчас в комнате - набором, а не поиском по списку на каждое
  // сообщение: в ленте их сотни, а присутствующих десяток.
  const here = useMemo(() => new Set(state.people.map((p) => p.id)), [state.people]);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<ChatAttach | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  // Меню скрепки в два уровня: сначала короткий список того, что под рукой, и
  // строка «журнал сделок». По ней то же окно разворачивается в сам журнал -
  // уводить человека из чата ради выбора сделки незачем, он в этот момент пишет
  // сообщение.
  const [menu, setMenu] = useState<"main" | "journal">("main");
  // Отработанные сделки для скрепки. Тянем при первом открытии меню, а не
  // при показе панели: журнал за три месяца ради кнопки, которую могут и не
  // нажать, - лишний запрос на каждое открытие чата.
  const [journal, setJournal] = useState<JournalTrade[] | null>(null);
  const [busy, setBusy] = useState(false);
  // На что отвечаем. Полоса цитаты стоит над вводом, пока не отправили или не
  // сняли крестиком.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Показать заявку во вкладке «Сигналы». Только наставнику: заявками делятся и
  // просто так, а сигнал - это обещание.
  const [asSignal, setAsSignal] = useState(false);
  const [audience, setAudience] = useState<"all" | "moderate" | "turbo">("all");
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);

  // Пока чат на экране, пришедшее считается прочитанным: точка у свёрнутой
  // панели загорается только тогда, когда её и правда не видели.
  useEffect(() => {
    const close = open();
    setReading(true);
    return () => {
      setReading(false);
      close();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  /**
   * Показать оригинал цитаты.
   *
   * Если его нет в загруженном куске, дочитываем историю вверх - иначе ответ на
   * утреннее сообщение никуда не ведёт.
   */
  async function goToMessage(id: number) {
    let node = document.getElementById(`chat-msg-${id}`);
    for (let step = 0; !node && step < 5 && snapshot().more; step++) {
      await older();
      node = document.getElementById(`chat-msg-${id}`);
    }
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("chat-found");
    setTimeout(() => node?.classList.remove("chat-found"), 1200);
  }

  // Сообщение из адреса. Ждём, пока приедет история: до неё прокручивать не к
  // чему, а дочитывать вверх с пустой ленты бессмысленно.
  const focused = useRef(0);
  useEffect(() => {
    if (!focus || focused.current === focus || state.messages.length === 0) return;
    focused.current = focus;
    void goToMessage(focus);
    // goToMessage читает ленту сам и в зависимостях не нуждается.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, state.messages.length]);

  // Нажатие мимо закрывает меню скрепки. Меню, которое не уходит само, остаётся
  // висеть над лентой и закрывает собой разговор - а человек уже передумал
  // прикладывать.
  useEffect(() => {
    if (!attachMenu) return;
    function away(event: PointerEvent) {
      if (attachRef.current?.contains(event.target as Node)) return;
      setAttachMenu(false);
      setMenu("main");
    }
    function esc(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAttachMenu(false);
      setMenu("main");
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [attachMenu]);

  useEffect(() => {
    if (menu !== "journal" || journal !== null || !journalAvailable()) return;
    void loadTrades(JOURNAL_DAYS)
      .then((body) => setJournal(body?.trades ?? []))
      .catch(() => setJournal([]));
  }, [menu, journal]);

  async function attachPhoto(file: File | undefined | null) {
    if (!file || !file.type.startsWith("image/")) return;
    setAttachMenu(false);
    setBusy(true);
    // Фотография уезжает на сервер сразу: в ленте она должна открываться
    // страницей у нас, а страница появляется только после загрузки.
    const uploaded = await uploadPhoto(file, symbol ?? "");
    setBusy(false);
    if (uploaded) setAttach(uploaded);
  }

  /** Выбрали, что приложить: меню закрывается и возвращается на первый уровень. */
  function pick(next: ChatAttach) {
    setAttach(next);
    setAttachMenu(false);
    setMenu("main");
  }

  async function submit() {
    const body = text.trim();
    if ((!body && !attach) || busy) return;
    setBusy(true);
    setText("");
    const sending = attach;
    const quoting = replyTo;
    const signalling = asSignal && sending?.kind === "trade";
    setAttach(null);
    setReplyTo(null);
    setAsSignal(false);
    try {
      const failed = await post(body, sending, {
        replyTo: quoting?.id ?? null,
        asSignal: signalling,
        audience,
      });
      // Сообщение ушло, а сигнал не собрался - об этом надо сказать: молчание
      // здесь означало бы, что наставник ждёт сигнал, которого нет.
      setSignalNote(failed ?? null);
    } finally {
      setBusy(false);
    }
  }

  // Идущие отдельно от ждущих: это разные вопросы к собеседнику - «посмотри,
  // что у меня в рынке» и «посмотри, что я поставил».
  const running = own.filter((t) => t.state === "open");
  const waiting = own.filter((t) => t.state === "planned");

  // Жалоба сервера на несобравшийся сигнал. Живёт до следующей отправки.
  const [signalNote, setSignalNote] = useState<string | null>(null);
  // Открытая карточка результата. Null - окна нет.
  const [card, setCard] = useState<CardData | null>(null);
  const mentor = Boolean(state.me?.mentor);

  const pinned = state.messages.find((m) => m.author.mentor);
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });

  // Сегодня и вчера называем словами: дата у них читается хуже, чем «сегодня».
  const dayLabel = (at: number) => {
    const now = Date.now();
    if (dayKey(at) === dayKey(now)) return t.chat.today;
    if (dayKey(at) === dayKey(now - 86400000)) return t.chat.yesterday;
    return new Date(at).toLocaleDateString(intlLocale(locale), {
      day: "numeric",
      month: "long",
      year: dayKey(at).slice(0, 4) === dayKey(now).slice(0, 4) ? undefined : "numeric",
    });
  };

  const cardLabels = {
    entry: t.chat.card.entry,
    stop: t.chat.card.stop,
    take: t.chat.card.take,
    planned: t.chat.card.planned,
    open: t.chat.card.open,
    closed: t.chat.card.closed,
    byStop: t.chat.card.byStop,
    byTake: t.chat.card.byTake,
    byHand: t.chat.card.byHand,
    ofMargin: t.chat.card.ofMargin,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка: кто в комнате прямо сейчас. Список приходит от сервера - это
          настоящее присутствие, а не догадка по ленте. */}
      <div className={`flex items-center gap-2 ${skin.head}`}>
        <div className="flex -space-x-1.5">
          {state.people.slice(0, 5).map((p) => (
            <Avatar key={p.id} src={p.avatar} name={p.name} size={tone === "pane" ? 20 : 26} />
          ))}
        </div>
        {/* Сколько нас: в комнате сейчас и в форуме всего. Второе число - от
            бота: разговор идёт в двух местах сразу, и «1 в чате» без него
            выглядит пустой комнатой, хотя рядом целая группа. */}
        <span className={`text-[11px] ${skin.muted}`}>
          {state.live ? t.chat.inRoom(state.people.length) : t.chat.offline}
          {state.forum > 0 && ` · ${t.chat.inForum(state.forum)}`}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            title={t.terminal.collapseChat}
            className={`ml-auto rounded px-1.5 py-0.5 ${skin.muted} transition-colors hover:opacity-80`}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Ветки разговора - те же, что темы в форуме. Строкой, а не списком в
          меню: ветка это не настройка, а место, где сейчас идёт разговор, и
          прятать её за нажатием значит прятать сам разговор.

          При одной ветке строки нет вовсе: выбирать не из чего, а полоса
          отнимает у ленты высоту.

          Полосу прокрутки под ветками прячем. Windows рисует её всегда, а не
          на время движения, и под строкой из четырёх кнопок она читается как
          отдельный элемент интерфейса, который зачем-то нужно тянуть. Ветки
          листаются колесом, пальцем и самой строкой - ползунок для этого не
          нужен. */}
      {state.threads.length > 1 && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-1.5">
          {state.threads.map((branch) => (
            <button
              key={branch.id}
              onClick={() => openThread(branch.id)}
              title={branch.forum ? t.chat.threadInForum : undefined}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150 ease-out ${
                branch.id === state.thread
                  ? skin.threadOn
                  : `${skin.muted} ${skin.threadOff}`
              }`}
            >
              {branch.title}
              {branch.closed && " ·"}
            </button>
          ))}
        </div>
      )}

      <a
        href={SOCIAL_LINKS.telegram}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center justify-between ${skin.banner}`}
      >
        <span className={skin.bannerText}>{t.chat.telegramBanner}</span>
        <span className={skin.bannerArrow}>→</span>
      </a>

      {pinned && (
        <div className={`flex items-start gap-2 ${skin.pinned}`}>
          <Pin className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${skin.pinnedIcon}`} />
          <p className={skin.pinnedText}>
            <span className={skin.pinnedName}>👑 {pinned.author.name}:</span> {pinned.text}
          </p>
        </div>
      )}

      <div className={skin.feed}>
        {/* Отступ сверху берёт на себя mt-auto: пока сообщений мало, они стоят
            у самого поля ввода. Разговор читают снизу вверх, и начинать его в
            середине пустого поля незачем. */}
        <div className={skin.stack}>
        {state.more && (
          <button
            onClick={() => void older()}
            className={`mx-auto block rounded px-2 py-1 text-[11px] ${skin.muted} hover:opacity-80`}
          >
            {t.chat.earlier}
          </button>
        )}
        {state.messages.length === 0 && (
          <p className={`py-6 text-center text-[11px] ${skin.muted}`}>{t.chat.empty}</p>
        )}
        {state.messages.map((m, i) => {
          const previous = state.messages[i - 1];
          const fresh = !previous || dayKey(previous.at) !== dayKey(m.at);
          return (
            <div key={m.id} className="space-y-2">
              {/* Разделитель дня, как в мессенджерах: без него вчерашний
                  разговор читается как сегодняшний, а в торговом чате это
                  разница между «уже поздно» и «ещё можно». */}
              {fresh && (
                <div className="flex items-center gap-2 py-1">
                  <span className={`h-px flex-1 ${skin.divider}`} />
                  <span className={`text-[10px] uppercase tracking-wide ${skin.muted}`}>
                    {dayLabel(m.at)}
                  </span>
                  <span className={`h-px flex-1 ${skin.divider}`} />
                </div>
              )}
              <Bubble
                message={m}
                self={state.me?.id === m.author.id}
                online={here.has(m.author.id)}
                mentor={mentor}
                onCopy={onCopy}
                onCard={(trade) =>
                  setCard(
                    cardFromShared(
                      trade,
                      // Закрытую заверяет дата закрытия, идущую - время
                      // сообщения: заверять её временем, которого ещё не было,
                      // нельзя.
                      trade.closedAt ?? new Date(m.at).toISOString(),
                      m.author.name,
                    ),
                  )
                }
                onReply={() => setReplyTo(m)}
                onGoTo={goToMessage}
                skin={skin}
                tone={tone}
                time={time(m.at)}
                labels={cardLabels}
              />
            </div>
          );
        })}
        <div ref={endRef} />
        </div>
      </div>

      {/* На что отвечаем. Стоит над вводом, пока не отправили или не сняли. */}
      {replyTo && (
        <div className={`mx-2 mt-1 flex items-center gap-2 px-2 py-1.5 text-[11px] ${skin.card}`}>
          <Reply className={`h-3.5 w-3.5 shrink-0 ${skin.muted}`} />
          <span className="min-w-0 flex-1 truncate">
            <span className={`font-semibold ${skin.nameOther}`}>{replyTo.author.name}</span>{" "}
            <span className={skin.muted}>
              {replyTo.text || (replyTo.attach?.kind === "shot" ? t.chat.attachPhoto : t.chat.card.planned)}
            </span>
          </span>
          <button onClick={() => setReplyTo(null)} className={skin.muted} title={t.chat.drop}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Заявка уйдёт ещё и в сигналы. Только наставнику и только у заявки. */}
      {mentor && attach?.kind === "trade" && (
        <div className={`mx-2 mt-1 flex items-center gap-2 px-2 py-1.5 text-[11px] ${skin.card}`}>
          <button
            onClick={() => setAsSignal((v) => !v)}
            className={`flex items-center gap-1.5 ${asSignal ? skin.nameSelf : skin.muted}`}
          >
            <Radio className="h-3.5 w-3.5" />
            {t.chat.asSignal}
          </button>
          {asSignal && (
            <span className="ml-auto flex gap-1">
              {(["all", "moderate", "turbo"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setAudience(key)}
                  className={`rounded px-1.5 py-px ${audience === key ? skin.upBox : skin.chip}`}
                >
                  {t.chat.audience[key]}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {signalNote && (
        <p className={`mx-2 mt-1 text-[10px] ${skin.down}`}>{signalNote}</p>
      )}

      {/* Приложенное - над строкой ввода, чтобы было видно, что уйдёт. */}
      {attach && (
        <div className={`mx-2 mt-1 flex items-center gap-2 px-2 py-1.5 text-[11px] ${skin.card}`}>
          {attach.kind === "shot" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attach.image} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="min-w-0 flex-1 truncate">{t.chat.attachPhoto}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate">
              {attach.trade.symbol.replace(/USDT$/i, "")} · {t.chat.card.planned}
            </span>
          )}
          <button onClick={() => setAttach(null)} className={skin.muted} title={t.chat.drop}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className={`relative flex gap-2 ${tone === "pane" ? "px-2 pt-1" : "mt-3"}`}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void attachPhoto(e.target.files?.[0])}
        />
        <div className="relative" ref={attachRef}>
        <button
          onClick={() => {
            setAttachMenu((v) => !v);
            setMenu("main");
          }}
          className={skin.ghost}
          title={t.chat.attach}
          aria-label={t.chat.attach}
        >
          <Paperclip className="h-4 w-4" />
        </button>

        {attachMenu && menu === "main" && (
          <div
            className={`no-scrollbar absolute bottom-full left-0 z-30 mb-1 max-h-72 w-56 overflow-y-auto py-1 shadow-xl ${skin.card}`}
          >
            <button
              onClick={() => fileRef.current?.click()}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t.chat.attachPhoto}
            </button>

            {/* Идущие сделки - по всем монетам сразу. */}
            {running.length > 0 && (
              <>
                <p className={`px-3 pt-1.5 text-[10px] uppercase tracking-wide ${skin.muted}`}>
                  {t.chat.groupRunning}
                </p>
                {running.map((trade, i) => (
                  <button
                    key={`open-${trade.symbol}-${i}`}
                    onClick={() => pick({ kind: "trade", trade })}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    <span className={trade.side === "long" ? skin.up : skin.down}>
                      {trade.side === "long" ? "L" : "S"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {trade.symbol.replace(/USDT$/i, "")}
                    </span>
                    {typeof trade.pnl === "number" && (
                      <span className={trade.pnl >= 0 ? skin.up : skin.down}>
                        {money(trade.pnl)}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Ждущие заявки - по всем монетам сразу. */}
            <p className={`px-3 pt-1.5 text-[10px] uppercase tracking-wide ${skin.muted}`}>
              {t.chat.groupPending}
            </p>
            {waiting.length === 0 ? (
              <p className={`px-3 py-1 text-[11px] ${skin.muted}`}>{t.chat.noPending}</p>
            ) : (
              waiting.map((trade, i) => (
                <button
                  key={`${trade.symbol}-${trade.entry}-${i}`}
                  onClick={() => pick({ kind: "trade", trade })}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span className={trade.side === "long" ? skin.up : skin.down}>
                    {trade.side === "long" ? "L" : "S"}
                  </span>
                  {t.chat.attachOrder(trade.symbol.replace(/USDT$/i, ""))}
                </button>
              ))
            )}

            {/* Отработанные сделки живут за этой строкой: их сотни, и
                вываливать их в общий список значит утопить в них то, что
                под рукой. */}
            <button
              onClick={() => setMenu("journal")}
              className={`mt-1 flex w-full items-center gap-1 border-t px-3 py-1.5 text-left text-[10px] uppercase tracking-wide ${skin.edge} ${skin.muted} hover:opacity-80`}
            >
              {t.chat.groupJournal}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Второй уровень: тот же журнал, но целиком и в том же окне. */}
        {attachMenu && menu === "journal" && (
          <div
            className={`absolute bottom-full left-0 z-30 mb-1 flex max-h-72 w-64 flex-col overflow-hidden shadow-xl ${skin.card}`}
          >
            <button
              onClick={() => setMenu("main")}
              className={`flex shrink-0 items-center gap-1 border-b px-3 py-1.5 text-left text-[10px] uppercase tracking-wide ${skin.edge} ${skin.muted} hover:opacity-80`}
            >
              <ChevronLeft className="h-3 w-3" />
              {t.chat.groupJournal}
            </button>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
              {journal === null ? (
                <p className={`px-3 py-1.5 text-[11px] ${skin.muted}`}>{t.chat.loading}</p>
              ) : journal.length === 0 ? (
                <p className={`px-3 py-1.5 text-[11px] ${skin.muted}`}>{t.chat.noJournal}</p>
              ) : (
                journal.slice(0, JOURNAL_SHOWN).map((row) => (
                  <button
                    key={row.id}
                    onClick={() => pick({ kind: "trade", trade: fromJournal(row) })}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
                  >
                    <span className={row.side === "long" ? skin.up : skin.down}>
                      {row.side === "long" ? "L" : "S"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.symbol.replace(/USDT$/i, "")}
                    </span>
                    <span className={`shrink-0 text-[10px] ${skin.muted}`}>
                      {new Date(row.closed_at).toLocaleDateString(intlLocale(locale), {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className={`shrink-0 ${row.pnl >= 0 ? skin.up : skin.down}`}>
                      {money(row.pnl)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        </div>

        <input
          className={skin.input}
          placeholder={t.chat.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => void attachPhoto(e.clipboardData.files?.[0])}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <button
          className={skin.button}
          onClick={() => void submit()}
          disabled={busy}
          aria-label={t.chat.send}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className={skin.note}>{state.live ? t.chat.hint : t.chat.note}</p>

      {card && <PnlCard data={card} onClose={() => setCard(null)} />}
    </div>
  );
}

/**
 * Текст, в который вшиты ссылки.
 *
 * Из форума сообщения приходят именно такими: наставник пишет «BTC 1m», а
 * адрес графика спрятан в этих знаках и в самом тексте не виден. Отрезки
 * считаются по знакам - так их и присылает Telegram.
 *
 * Наложившиеся отрезки пропускаем: ссылка внутри ссылки невозможна, а попытка
 * её нарисовать даёт разъехавшуюся разметку.
 */
function Woven({
  text,
  links,
}: {
  text: string;
  links: { offset: number; length: number; url: string }[];
}) {
  if (links.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const link of [...links].sort((a, b) => a.offset - b.offset)) {
    const start = link.offset;
    const end = Math.min(start + link.length, text.length);
    if (start < at || start >= text.length) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <a
        key={`${start}-${link.url}`}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:opacity-80"
      >
        {text.slice(start, end)}
      </a>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Сделка из сообщения. Отдельной строкой - разбирать вложение дважды незачем. */
function trade(message: ChatMessage): SharedTrade {
  return (message.attach as { kind: "trade"; trade: SharedTrade }).trade;
}

/** Одно сообщение: лицо, ник, время и то, что приложено. */
function Bubble({
  message,
  self,
  online,
  mentor,
  onCopy,
  onCard,
  onReply,
  onGoTo,
  skin,
  tone,
  time,
  labels,
}: {
  message: ChatMessage;
  self: boolean;
  /**
   * Автор сейчас в комнате.
   *
   * Считается по списку присутствующих, а не по свежести сообщения: человек,
   * написавший минуту назад и закрывший вкладку, ответа уже не увидит, и
   * зелёная точка у его ника обещала бы разговор, которого не будет.
   */
  online: boolean;
  /** Смотрит наставник: ему разрешено убирать чужое. */
  mentor: boolean;
  onCopy?: (trade: SharedTrade) => void;
  /** Показать карточку результата этой сделки. */
  onCard: (trade: SharedTrade) => void;
  onReply: () => void;
  onGoTo: (id: number) => void;
  skin: Skin;
  tone: ChatTone;
  time: string;
  labels: Parameters<typeof TradeCard>[0]["labels"];
}) {
  const t = useT();
  const link = firstLink(message.text);
  const rich = useLinkPreview(link);
  const size = tone === "pane" ? 20 : 28;
  const [draft, setDraft] = useState<string | null>(null);

  // Править можно только своё - и наставнику тоже только своё: убрать чужое это
  // про порядок в комнате, а переписать чужое значит вложить человеку в рот
  // слова, которых он не говорил.
  const canEdit = self && Boolean(message.text);
  const canDrop = self || mentor;

  async function keep() {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next && next !== message.text) await change(message.id, next);
  }

  return (
    <div
      id={`chat-msg-${message.id}`}
      className={`flex items-end gap-1.5 rounded-2xl transition-colors duration-500 ${
        self ? "justify-end" : "justify-start"
      }`}
    >
      {!self && <Avatar src={message.author.avatar} name={message.author.name} size={size} />}
      <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${self ? skin.bubbleSelf : skin.bubbleOther}`}>
        <div className="mb-0.5 flex items-center gap-1 text-[11px]">
          {/* Точка присутствия. Стоит перед ником, а не после: по ней взгляд
              решает, стоит ли ждать ответа, ещё до того, как прочтёт имя. */}
          <span
            title={online ? t.chat.online : t.chat.away}
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
              online ? "bg-emerald-400" : "bg-current opacity-25"
            }`}
          />
          <span
            className={`font-semibold ${
              message.author.mentor ? skin.nameMentor : self ? skin.nameSelf : skin.nameOther
            }`}
          >
            {message.author.mentor && <Crown className="mr-0.5 inline h-3 w-3" />}
            {message.author.name}
          </span>

          {/* Заявка ушла во вкладку «Сигналы»: видно, что разговором дело не
              ограничилось. */}
          {message.signalId ? (
            <span title={t.chat.isSignal} className={skin.nameSelf}>
              <Radio className="h-3 w-3" />
            </span>
          ) : null}

          {/* Правка и уборка - в самой строке подписи, а не отдельным меню:
              нажатий и так хватает, а прятать их за долгим нажатием значит
              спрятать совсем. */}
          {canEdit && draft === null && (
            <button
              onClick={() => setDraft(message.text)}
              title={t.chat.edit}
              className={`ml-1 ${skin.muted} hover:opacity-80`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {canDrop && (
            <button
              onClick={() => void drop(message.id)}
              title={self ? t.chat.removeMine : t.chat.removeTheirs}
              className={`${canEdit && draft === null ? "" : "ml-auto"} ${skin.muted} hover:opacity-80`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Цитата: две строки оригинала с чертой слева. Нажатие уводит к нему;
            у удалённого нажимать не на что, и это сказано словом. */}
        {message.reply && (
          <button
            onClick={() => !message.reply?.deleted && onGoTo(message.reply!.id)}
            disabled={Boolean(message.reply.deleted)}
            className={`mb-1 flex w-full flex-col items-start gap-0.5 border-l-2 pl-2 text-left text-[11px] ${skin.edge} ${
              message.reply.deleted ? "opacity-60" : "hover:opacity-80"
            }`}
          >
            {message.reply.deleted ? (
              <span className={skin.muted}>{t.chat.quoteGone}</span>
            ) : (
              <>
                <span className={`font-semibold ${skin.nameOther}`}>{message.reply.author}</span>
                <span className={`line-clamp-2 ${skin.muted}`}>
                  {message.reply.text ||
                    (message.reply.attach === "shot" ? t.chat.attachPhoto : t.chat.card.planned)}
                </span>
              </>
            )}
          </button>
        )}

        {draft !== null ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void keep();
                if (e.key === "Escape") setDraft(null);
              }}
              className={skin.input}
            />
            <button onClick={() => void keep()} title={t.chat.save} className={skin.muted}>
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setDraft(null)} title={t.chat.drop} className={skin.muted}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          message.text && (
            <p
              className={
                tone === "pane" ? "break-words text-[12px] leading-snug" : "break-words text-sm"
              }
            >
              <Woven text={message.text} links={message.links ?? []} />
            </p>
          )
        )}

        {/* Снимок открывается страницей на сайте: там подпись, монета и время,
            и там же его развернёт превью мессенджера. */}
        {message.attach?.kind === "shot" && (
          <a href={message.attach.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.attach.image}
              alt=""
              className="mt-1.5 max-h-56 w-full rounded-lg object-cover"
            />
          </a>
        )}

        {message.attach?.kind === "trade" && (
          <>
            {/* Нажатие открывает карточку результата - ту же, которой делятся
                из журнала. У ждущей заявки результата ещё нет, и открывать там
                нечего: карточка с нулём обещала бы итог, которого не было. */}
            <TradeCard
              trade={message.attach.trade}
              skin={skin}
              labels={labels}
              onOpen={
                message.attach.trade.state === "planned"
                  ? undefined
                  : () => onCard(trade(message))
              }
            />
            {/* Повторить чужую заявку у себя. Только ждущую и только чужую: в
                идущую сделку заходят по её цене, которой уже нет, а свою
                собственную копировать незачем. */}
            {onCopy && !self && message.attach.trade.state === "planned" && (
              <button
                onClick={() => onCopy(trade(message))}
                className={`mt-1 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold ${skin.upBox}`}
              >
                <LogIn className="h-3 w-3" />
                {t.chat.copyIn}
              </button>
            )}
          </>
        )}

        {/* Подвал: «ответить» слева, время справа - у самой аватарки. Время
            читают, дочитав реплику, а не до неё; отвечают - тоже после. */}
        <div className="mt-0.5 flex items-center gap-2 text-[10px]">
          <button
            onClick={onReply}
            title={t.chat.reply}
            className={`flex items-center gap-0.5 ${skin.muted} hover:opacity-80`}
          >
            <Reply className="h-3 w-3" />
            {t.chat.reply}
          </button>
          <span className={`ml-auto ${skin.muted}`}>
            {message.edited > 0 && <span>{t.chat.edited} · </span>}
            {time}
          </span>
        </div>

        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-1.5 block overflow-hidden text-[11px] ${skin.card}`}
          >
            {(rich?.image || link.image) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rich?.image || link.href}
                alt=""
                className="max-h-40 w-full object-cover"
              />
            )}
            <span className="block px-2.5 py-1.5">
              <span className="block font-semibold">{rich?.title || link.host}</span>
              {rich?.description ? (
                <span className={`block line-clamp-2 ${skin.muted}`}>{rich.description}</span>
              ) : (
                link.rest && <span className={`block truncate ${skin.muted}`}>{link.rest}</span>
              )}
            </span>
          </a>
        )}
      </div>
      {self && <Avatar src={message.author.avatar} name={message.author.name} size={size} />}
    </div>
  );
}
