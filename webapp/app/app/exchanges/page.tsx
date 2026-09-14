"use client";

// Витрина бирж: где торгует терминал, что даёт счёт через академию и как его
// подключить.
//
// Одна страница на три вопроса, которые ученик задаёт подряд: «где заводить»,
// «что у меня уже подключено» и «как подключиться без ключей». Разводить их по
// разным местам значит заставить человека собирать ответ самому.
//
// Цифры условий приходят с сервера (core/venues.py) и не выдумываются: пока
// биржа не подтвердила ставку академии и долю кешбэка, вместо числа стоит
// «условия уточняются». Обещание скидки, которой нет, ученик запомнит, а
// оговорку - нет.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Check, ChevronLeft, ExternalLink, KeyRound, LogIn } from "lucide-react";

import { PaneHead, PaneScope } from "@/components/app/Pane";
import { EXCHANGE_SIGNUP } from "@/lib/content";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import VenueMark from "@/components/ui/VenueMark";
import { useLocale, useT } from "@/lib/i18n";
import {
  cashbackKind,
  cashbackPct,
  chooseVenue,
  dropVenue,
  finishVenueLogin,
  forgetLogin,
  loadVenues,
  pendingLogin,
  ratePct,
  startVenueLogin,
  type VenueListing,
  type VenueRow,
} from "@/lib/exchanges";
import { tradingStatus, type TradingStatus } from "@/lib/trading";

const CARD = "rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-4";

const CHIP =
  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

const ACTION =
  "rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export default function ExchangesPage() {
  const t = useT();
  const d = t.exchanges;
  const router = useRouter();
  const params = useSearchParams();

  const [listing, setListing] = useState<VenueListing | null>(null);
  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  // Окно ключей открывается прямо здесь: ответ на «как подключить» не должен
  // уводить в другой раздел.
  const [keysOpen, setKeysOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [venues, trading] = await Promise.all([loadVenues(), tradingStatus()]);
    if (venues) setListing(venues);
    if (trading) setStatus(trading);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Возврат с биржи: в адресе код входа. Меняем его на подключённый счёт и
  // сразу убираем из адреса - код одноразовый, и держать его в истории вкладки
  // незачем.
  useEffect(() => {
    const code = params.get("code");
    const denied = params.get("error");
    const saved = pendingLogin();
    if (!code && !denied) return;
    if (denied) {
      forgetLogin();
      setNote({ text: d.login.cancelled, bad: true });
      router.replace("/app/exchanges");
      return;
    }
    if (!code || !saved) return;

    let cancelled = false;
    setBusy(saved.exchange);
    setNote({ text: d.login.working, bad: false });
    finishVenueLogin(saved.exchange, code, saved.state)
      .then(async () => {
        if (cancelled) return;
        forgetLogin();
        setNote({ text: d.login.done, bad: false });
        await refresh();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        forgetLogin();
        setNote({ text: err instanceof Error ? err.message : d.login.failed, bad: true });
      })
      .finally(() => {
        if (!cancelled) {
          setBusy("");
          router.replace("/app/exchanges");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params, router, refresh, d.login]);

  async function act(code: string, run: () => Promise<unknown>) {
    setBusy(code);
    setNote(null);
    try {
      await run();
      await refresh();
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : d.login.failed, bad: true });
    } finally {
      setBusy("");
    }
  }

  async function login(code: string) {
    setBusy(code);
    setNote(null);
    try {
      const body = await startVenueLogin(code);
      if (body?.url) window.location.href = body.url;
      else setNote({ text: d.actions.loginSoon, bad: true });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : d.login.failed, bad: true });
    } finally {
      setBusy("");
    }
  }

  const active = listing?.active ?? "";

  return (
    <PaneScope className="flex flex-col gap-3">
      <PaneHead title={d.title} hint={d.hint}>
        {/* Раздел открывается из профиля, а в меню кабинета его нет: без этой
            кнопки уйти отсюда можно было только кнопкой браузера. */}
        <Link
          href="/app/profile"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {d.actions.backToProfile}
        </Link>
      </PaneHead>

      <p className="text-[12px] leading-relaxed text-[var(--pane-muted)]">{d.lead}</p>
      {listing && !listing.vault && (
        <p className="rounded-lg bg-[var(--pane-down-faint)] px-3 py-2 text-[12px] text-[var(--pane-down)]">
          {d.vaultOff}
        </p>
      )}
      {note && (
        <p
          className={`rounded-lg px-3 py-2 text-[12px] ${
            note.bad
              ? "bg-[var(--pane-down-faint)] text-[var(--pane-down)]"
              : "bg-[var(--pane-hover)] text-[var(--pane-text-2)]"
          }`}
        >
          {note.text}
        </p>
      )}

      {/* Три колонки на широком экране: на двух карточка растягивалась через
          пол-стола, и плитки условий расползались вместе с ней.

          Неторгующие биржи отсеиваем и здесь, хотя их не присылает и сервер:
          кабинет открыт из браузера, а сервер обновляют отдельно, и один
          вечер между этими двумя правками ученик смотрел бы на биржи, с
          которыми ничего нельзя сделать. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(listing?.venues ?? []).filter((one) => one.trading).map((venue) => (
          <VenueCard
            key={venue.exchange}
            venue={venue}
            active={venue.exchange === active}
            busy={busy === venue.exchange}
            busyTrades={
              // Сделки той биржи, с которой уходим: чужие переключению не
              // мешают, каждая ведётся своим ключом.
              (listing?.venues ?? []).find((one) => one.exchange === active)?.live ?? 0
            }
            onLogin={() => login(venue.exchange)}
            onKeys={() => setKeysOpen(true)}
            onActive={() => act(venue.exchange, () => chooseVenue(venue.exchange))}
            onDrop={() => act(venue.exchange, () => dropVenue(venue.exchange))}
          />
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--pane-muted)]">{d.terms.note}</p>

      {keysOpen && status && (
        <ExchangeDialog
          status={status}
          onClose={() => setKeysOpen(false)}
          onSaved={() => {
            setKeysOpen(false);
            refresh();
          }}
        />
      )}
    </PaneScope>
  );
}

function VenueCard({
  venue,
  active,
  busy,
  busyTrades,
  onLogin,
  onKeys,
  onActive,
  onDrop,
}: {
  venue: VenueRow;
  active: boolean;
  busy: boolean;
  /** Сделок терминала, идущих на активной бирже: они держат переключение. */
  busyTrades: number;
  onLogin: () => void;
  onKeys: () => void;
  onActive: () => void;
  onDrop: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const d = t.exchanges;
  // Партнёрская ссылка биржи. Счёт заводят по ней: иначе ни сниженной ставки,
  // ни кешбэка не будет - биржа не узнает, что человек пришёл от нас.
  const signup = EXCHANGE_SIGNUP.find((one) => one.code === venue.exchange);
  const taker = ratePct(venue.taker);
  const maker = ratePct(venue.maker);
  const academy = ratePct(venue.academy_taker);
  // Биржа закрыта, пока академия не подтвердила счёт. Сервер, собранный до
  // этого правила, поля не присылает - тогда ведём себя как раньше.
  const locked = venue.keys_supported && venue.may_connect === false;

  return (
    <div
      className={`${CARD} ${
        // Подключённая биржа выделена рамкой: в списке из пяти карточек своя
        // должна находиться взглядом, а не чтением.
        venue.connected ? "border-[var(--pane-accent-soft)]" : ""
      }`}
    >
      {/* Шапка: знак, название и состояние счёта одной строкой.
          Состояние счёта стоит прямо под названием - это первое, что человек
          здесь ищет; раньше на этом месте была подпись «переговоры идут»,
          которая ничего ему не говорила. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--pane-hover)]">
            <VenueMark
              code={venue.exchange}
              name={venue.name}
              decorative
              className="h-7 w-8"
              nameClassName="text-[10px]"
            />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-[var(--pane-text)]">
              {venue.title}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--pane-text-2)]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  venue.connected ? "bg-[var(--pane-up)]" : "bg-[var(--pane-border)]"
                }`}
              />
              <span className="truncate">
                {venue.connected
                  ? `${d.state.connected} · ${
                      venue.auth_kind === "oauth" ? d.auth.oauth : d.auth.keys
                    }${venue.key_tail ? ` · ${venue.key_tail}` : ""}`
                  : d.state.notConnected}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {active && (
            <span className={`${CHIP} bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]`}>
              {d.state.active}
            </span>
          )}
          <span className={`${CHIP} bg-[var(--pane-hover)] text-[var(--pane-muted)]`}>
            {venue.book ? d.state.ownBook : d.state.sharedBook}
          </span>
        </div>
      </div>

      {/* Условия тремя плитками: тейкер, мейкер, возврат.
          Строкой они растягивались по ширине карточки, и между подписью и
          числом оставалась пустая полоса - глаз их не связывал. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Tile label={d.terms.taker} value={taker} fallback={d.terms.unknown} />
        <Tile label={d.terms.maker} value={maker} fallback={d.terms.unknown} />
        <CashbackTile venue={venue} />
      </div>
      {academy && (
        <p className="mt-2 text-[11px] text-[var(--pane-muted)]">
          {d.terms.academy}: <span className="font-mono tabular-nums">{academy}</span>
        </p>
      )}

      <Cashback venue={venue} />

      {/* Свой счёт: чем подключён, каким номером и что на нём идёт. */}
      <div className="mt-3 space-y-1 text-[11px] leading-snug">
        {venue.connected && (
          <p
            className={
              venue.access === "academy" ? "text-[var(--pane-accent)]" : "text-[var(--pane-muted)]"
            }
          >
            {venue.access === "academy" ? d.access.academy : d.access.own}
          </p>
        )}
        {(venue.live ?? 0) > 0 && (
          <p className="flex items-center gap-1.5 text-[var(--pane-accent)]">
            <Activity className="h-3 w-3 shrink-0" />
            {d.state.liveTrades(venue.live ?? 0)}
          </p>
        )}
        {venue.uid && <p className="text-[var(--pane-muted)]">{d.access.uid(venue.uid)}</p>}
        {venue.academy_uids.length > 0 && (
          <p className="text-[var(--pane-muted)]">
            {d.access.confirmed(venue.academy_uids.join(", "))}
          </p>
        )}
      </div>

      {locked && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--pane-muted)]">
          {d.access.needsAcademy}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Первый шаг для того, у кого счёта на бирже ещё нет. Стоит первым и
            заметным: подключать ключи нечего, пока счёта нет, а заведённый
            мимо нашей ссылки счёт останется без условий академии. */}
        {signup && !venue.connected && (
          <a
            href={signup.url(locale)}
            target="_blank"
            rel="noopener noreferrer"
            className={`${ACTION} flex items-center gap-1.5 border-[var(--pane-accent-soft)] bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {d.actions.signup}
          </a>
        )}
        {venue.connect.includes("oauth") && (
          <button
            onClick={onLogin}
            disabled={busy || !venue.oauth_ready}
            title={venue.oauth_ready ? undefined : d.actions.loginSoon}
            className={`${ACTION} flex items-center gap-1.5 border-[var(--pane-accent-soft)] text-[var(--pane-accent)]`}
          >
            <LogIn className="h-3.5 w-3.5" />
            {d.actions.login}
          </button>
        )}
        {venue.keys_supported && (
          <button
            onClick={onKeys}
            // Биржа открывается подтверждением академии: пока счёт не назван в
            // боте и не подтверждён, подключать нечего. Кнопку не прячем -
            // человек должен видеть, что биржа есть и что для неё сделать.
            disabled={busy || locked}
            title={locked ? d.actions.needsAcademy : undefined}
            className={`${ACTION} flex items-center gap-1.5 border-[var(--pane-border)] text-[var(--pane-text-2)]`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {venue.connected ? d.actions.replace : d.actions.keys}
          </button>
        )}
        {/* Уйти с биржи, где идёт сделка, нельзя: позиция осталась бы на одной
            бирже, а следующая заявка ушла бы на другую. Сделки других бирж не
            мешают - они ведутся своим ключом. Сервер откажет и сам, но кнопку
            лучше запереть до нажатия, с причиной. */}
        {venue.connected && !active && (
          <button
            onClick={onActive}
            disabled={busy || busyTrades > 0}
            title={busyTrades > 0 ? d.actions.switchLocked(busyTrades) : undefined}
            className={`${ACTION} flex items-center gap-1.5 border-[var(--pane-border)] text-[var(--pane-text-2)]`}
          >
            <Check className="h-3.5 w-3.5" />
            {d.actions.makeActive}
          </button>
        )}
        {venue.connected && (
          <button
            onClick={onDrop}
            disabled={busy}
            className={`${ACTION} border-transparent text-[var(--pane-down)] hover:bg-[var(--pane-down-faint)]`}
          >
            {d.actions.disconnect}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Плитка возврата: доля числом либо короткий ответ, почему её нет.
 *
 * Стоит третьей в ряду ставок, потому что читается вместе с ними: тейкер,
 * мейкер и то, сколько из них вернётся. Подробности - строкой ниже
 * (`Cashback`), здесь только цифра.
 */
function CashbackTile({ venue }: { venue: VenueRow }) {
  const d = useT().exchanges;
  const kind = cashbackKind(venue);
  const back = cashbackPct(venue.cashback);

  if (kind === "pays") {
    return (
      <div className="rounded-lg bg-[var(--pane-accent-faint)] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--pane-accent)] opacity-80">
          {d.terms.cashback}
        </p>
        <p className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[var(--pane-accent)]">
          {back}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--pane-hover)] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--pane-muted)]">
        {d.terms.cashback}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-[var(--pane-muted)]">
        {kind === "forbidden" ? d.terms.noCashback : d.terms.unknown}
      </p>
    </div>
  );
}

/**
 * Куда придёт возврат.
 *
 * Сколько - написано плиткой выше (`CashbackTile`), а здесь второй вопрос,
 * который человек задаёт сразу за первым: куда эти деньги попадут. Ответ
 * короткий и стоит под ставками, чтобы за ним не идти в сноску.
 *
 * Где возврата нет, строка всё равно стоит и называет причину. Пустое место
 * на карточке биржи читается как «забыли», а не как «не даём».
 */
function Cashback({ venue }: { venue: VenueRow }) {
  const d = useT().exchanges;
  const kind = cashbackKind(venue);

  // Возврата нет - плитка выше уже сказала это словом, и повторять незачем.
  if (kind !== "pays") return null;

  return (
    <p className="mt-2 text-[11px] leading-relaxed text-[var(--pane-text-2)]">
      {d.payout.where(venue.name)}
    </p>
  );
}

/** Плитка условия: подпись сверху, число под ней. */
function Tile({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--pane-hover)] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--pane-muted)]">{label}</p>
      <p
        className={`mt-0.5 font-mono text-[13px] tabular-nums ${
          value ? "text-[var(--pane-text)]" : "text-[11px] text-[var(--pane-muted)]"
        }`}
      >
        {value ?? fallback}
      </p>
    </div>
  );
}
