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
// Сама лента лежит снаружи, на складе: писать в неё умеет не только чат.
// Сделкой делятся из журнала, ожидающей заявкой - отсюда же, скрепкой.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Send, Crown, Pin, PanelRightClose, Paperclip, X, ImageIcon, Clock } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/content";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import {
  post,
  seedOnce,
  serverSnapshot,
  snapshot,
  subscribe,
  type ChatAttach,
  type ChatMessage,
  type SharedTrade,
} from "@/lib/chat/store";
import { firstLink } from "@/lib/chat/link";

/** Где показан чат: страницей кабинета или панелью терминала. */
export type ChatTone = "site" | "pane";

/** Кто пишет: ник и аватарка из Telegram. */
export type ChatMe = { name: string; avatar?: string | null };

const SKIN: Record<
  ChatTone,
  {
    head: string;
    headText: string;
    banner: string;
    bannerText: string;
    bannerArrow: string;
    pinned: string;
    pinnedIcon: string;
    pinnedText: string;
    pinnedName: string;
    feed: string;
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
  }
> = {
  site: {
    head: "mb-3 border-b border-border pb-2",
    headText: "text-text-primary",
    banner: "glass mb-3 rounded-xl px-4 py-2.5 text-sm",
    bannerText: "text-text-secondary",
    bannerArrow: "text-accent-cyan",
    pinned: "mb-3 rounded-xl border border-accent-gold/30 bg-accent-gold/[0.06] px-4 py-2.5",
    pinnedIcon: "text-accent-gold",
    pinnedText: "text-sm text-text-secondary",
    pinnedName: "font-semibold text-accent-gold",
    feed: "min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border bg-bg-panel/40 p-4",
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
      "shrink-0 rounded-xl border border-border px-3 text-text-secondary transition-colors hover:text-text-primary",
    note: "mt-2 text-center text-[11px] text-text-muted",
    up: "text-success",
    down: "text-danger",
  },
  pane: {
    head: "border-b border-[var(--pane-border)] px-2 py-1.5",
    headText: "text-[var(--pane-text)]",
    banner:
      "mx-2 mt-2 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2.5 py-1.5 text-[11px]",
    bannerText: "text-[var(--pane-text-2)]",
    bannerArrow: "text-[var(--pane-accent)]",
    pinned:
      "mx-2 mt-2 rounded-lg border border-[var(--pane-gold)]/40 bg-[var(--pane-gold)]/10 px-2.5 py-1.5",
    pinnedIcon: "text-[var(--pane-gold)]",
    pinnedText: "text-[11px] leading-snug text-[var(--pane-text-2)]",
    pinnedName: "font-semibold text-[var(--pane-gold)]",
    feed: "min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2",
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
      "shrink-0 rounded-lg border border-[var(--pane-border)] px-2 text-[var(--pane-text-2)] transition-colors hover:border-[var(--pane-accent)] hover:text-[var(--pane-text)]",
    note: "px-2 pb-2 text-center text-[10px] text-[var(--pane-muted)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
  },
};

/**
 * Аватарка собеседника.
 *
 * Фотография из Telegram есть не у всех: у половины комнаты стоит замок на
 * профиле, а у наставника она и вовсе своя. Без фотографии - кружок с первой
 * буквой ника, а не общий силуэт: по силуэтам собеседники неразличимы.
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

/** Карточка сделки или заявки внутри сообщения. */
function TradeCard({
  trade,
  skin,
  labels,
}: {
  trade: SharedTrade;
  skin: (typeof SKIN)[ChatTone];
  labels: { entry: string; stop: string; take: string; planned: string; open: string; closed: string };
}) {
  const long = trade.side === "long";
  const state =
    trade.state === "planned" ? labels.planned : trade.state === "open" ? labels.open : labels.closed;

  return (
    <div className={`mt-1.5 px-2.5 py-2 text-[11px] ${skin.card}`}>
      <div className="mb-1 flex items-center gap-1.5">
        {trade.state === "planned" && <Clock className={`h-3 w-3 ${skin.muted}`} />}
        <span className="font-semibold">{trade.symbol.replace(/USDT$/i, "")}</span>
        <span className={long ? skin.up : skin.down}>{long ? "LONG" : "SHORT"}</span>
        <span className={skin.muted}>×{trade.leverage}</span>
        <span className={`ml-auto ${skin.muted}`}>{state}</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[
          [labels.entry, trade.entry, ""],
          [labels.stop, trade.stop, skin.down],
          [labels.take, trade.targets[0] ?? 0, skin.up],
        ].map(([label, value, tone]) => (
          <div key={String(label)}>
            <div className={skin.muted}>{label}</div>
            <div className={String(tone)}>{Number(value) || "-"}</div>
          </div>
        ))}
      </div>
      {trade.state === "closed" && typeof trade.pnl === "number" && (
        <div className={`mt-1 font-semibold ${trade.pnl >= 0 ? skin.up : skin.down}`}>
          {money(trade.pnl)}
        </div>
      )}
    </div>
  );
}

export default function ChatRoom({
  tone = "site",
  me,
  pending = [],
  onClose,
}: {
  tone?: ChatTone;
  /** Кто пишет. Без профиля - просто «вы». */
  me?: ChatMe;
  /** Ожидающие входа заявки: их можно приложить к сообщению скрепкой. */
  pending?: SharedTrade[];
  /** Кнопка сворачивания в шапке. Есть только у панели терминала. */
  onClose?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const skin = SKIN[tone];
  const messages = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<ChatAttach | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedOnce(t);
  }, [t]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const myName = me?.name || t.chat.you;

  /**
   * Кто сейчас в комнате.
   *
   * Настоящее присутствие знает только сервер, а его у чата пока нет. Поэтому
   * здесь честный минимум: те, чьи сообщения в ленте, и сам трейдер. Выдумывать
   * число «сейчас онлайн» нельзя - по нему решают, ждать ли ответа.
   */
  const people = useMemo(() => {
    const seen = new Map<string, { name: string; avatar?: string | null; mentor?: boolean }>();
    seen.set(myName, { name: myName, avatar: me?.avatar });
    for (const m of messages) {
      if (m.self) continue;
      if (!seen.has(m.author)) seen.set(m.author, { name: m.author, mentor: m.mentor });
    }
    return [...seen.values()];
  }, [messages, myName, me?.avatar]);

  function attachPhoto(file: File | undefined | null) {
    if (!file || !file.type.startsWith("image/")) return;
    // Ссылка на файл в памяти вкладки: снимок графика весит мегабайты, и
    // превращать его в строку ради ленты, которая живёт до перезагрузки, незачем.
    setAttach({ kind: "photo", src: URL.createObjectURL(file), name: file.name });
    setAttachMenu(false);
  }

  function send() {
    const body = text.trim();
    if (!body && !attach) return;
    post({
      author: myName,
      text: body,
      self: true,
      attach: attach ?? undefined,
    });
    setText("");
    setAttach(null);
  }

  const pinned = messages.find((m) => m.mentor);
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });

  const cardLabels = {
    entry: t.chat.card.entry,
    stop: t.chat.card.stop,
    take: t.chat.card.take,
    planned: t.chat.card.planned,
    open: t.chat.card.open,
    closed: t.chat.card.closed,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка: кто в комнате. На странице кабинета заголовок свой, здесь
          только лица и счёт. */}
      <div className={`flex items-center gap-2 ${skin.head}`}>
        <div className="flex -space-x-1.5">
          {people.slice(0, 5).map((p) => (
            <Avatar key={p.name} src={p.avatar} name={p.name} size={tone === "pane" ? 20 : 26} />
          ))}
        </div>
        <span className={`text-[11px] ${skin.muted}`}>{t.chat.inRoom(people.length)}</span>
        {onClose && (
          <button
            onClick={onClose}
            title={t.terminal.collapseChat}
            className={`ml-auto rounded px-1.5 py-0.5 ${skin.muted} transition-colors hover:text-[var(--pane-text)]`}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

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
            <span className={skin.pinnedName}>👑 {t.chat.mentor}:</span> {pinned.text}
          </p>
        </div>
      )}

      <div className={skin.feed}>
        {messages.map((m) => (
          <Bubble key={m.id} message={m} skin={skin} tone={tone} me={me} time={time(m.at)} labels={cardLabels} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Приложенное - над строкой ввода, чтобы было видно, что уйдёт. */}
      {attach && (
        <div className={`mx-2 mt-1 flex items-center gap-2 px-2 py-1.5 text-[11px] ${skin.card}`}>
          {attach.kind === "photo" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attach.src} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="min-w-0 flex-1 truncate">{attach.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate">
              {attach.trade.symbol} · {t.chat.card.planned}
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
          onChange={(e) => attachPhoto(e.target.files?.[0])}
        />
        <button
          onClick={() => setAttachMenu((v) => !v)}
          className={skin.ghost}
          title={t.chat.attach}
          aria-label={t.chat.attach}
        >
          <Paperclip className="h-4 w-4" />
        </button>

        {attachMenu && (
          <div
            className={`absolute bottom-full left-0 z-30 mb-1 w-52 overflow-hidden py-1 shadow-xl ${skin.card}`}
          >
            <button
              onClick={() => fileRef.current?.click()}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t.chat.attachPhoto}
            </button>
            {pending.length === 0 ? (
              <p className={`px-3 py-1.5 text-[11px] ${skin.muted}`}>{t.chat.noPending}</p>
            ) : (
              pending.map((trade, i) => (
                <button
                  key={`${trade.symbol}-${i}`}
                  onClick={() => {
                    setAttach({ kind: "trade", trade });
                    setAttachMenu(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${skin.nameOther} hover:opacity-80`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  {t.chat.attachOrder(trade.symbol.replace(/USDT$/i, ""))}
                </button>
              ))
            )}
          </div>
        )}

        <input
          className={skin.input}
          placeholder={t.chat.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => attachPhoto(e.clipboardData.files?.[0])}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className={skin.button} onClick={send} aria-label={t.chat.send}>
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className={skin.note}>{t.chat.note}</p>
    </div>
  );
}

/** Одно сообщение: лицо, ник, время и то, что приложено. */
function Bubble({
  message,
  skin,
  tone,
  me,
  time,
  labels,
}: {
  message: ChatMessage;
  skin: (typeof SKIN)[ChatTone];
  tone: ChatTone;
  me?: ChatMe;
  time: string;
  labels: Parameters<typeof TradeCard>[0]["labels"];
}) {
  const link = firstLink(message.text);
  const avatar = message.self ? me?.avatar : null;

  return (
    <div className={`flex items-end gap-1.5 ${message.self ? "justify-end" : "justify-start"}`}>
      {!message.self && <Avatar src={avatar} name={message.author} size={tone === "pane" ? 20 : 28} />}
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${
          message.self ? skin.bubbleSelf : skin.bubbleOther
        }`}
      >
        <div className="mb-0.5 flex items-center gap-1 text-[11px]">
          <span
            className={`font-semibold ${
              message.mentor ? skin.nameMentor : message.self ? skin.nameSelf : skin.nameOther
            }`}
          >
            {message.mentor && <Crown className="mr-0.5 inline h-3 w-3" />}
            {message.author}
          </span>
          <span className={skin.muted}>· {time}</span>
        </div>

        {message.text && (
          <p className={tone === "pane" ? "break-words text-[12px] leading-snug" : "break-words text-sm"}>
            {message.text}
          </p>
        )}

        {message.attach?.kind === "photo" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.attach.src}
            alt={message.attach.name}
            className="mt-1.5 max-h-56 w-full rounded-lg object-cover"
          />
        )}

        {message.attach?.kind === "trade" && (
          <TradeCard trade={message.attach.trade} skin={skin} labels={labels} />
        )}

        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-1.5 block overflow-hidden text-[11px] ${skin.card}`}
          >
            {link.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={link.href} alt="" className="max-h-40 w-full object-cover" />
            )}
            <span className="block px-2.5 py-1.5">
              <span className="block font-semibold">{link.host}</span>
              {link.rest && <span className={`block truncate ${skin.muted}`}>{link.rest}</span>}
            </span>
          </a>
        )}
      </div>
      {message.self && <Avatar src={avatar} name={message.author} size={tone === "pane" ? 20 : 28} />}
    </div>
  );
}
