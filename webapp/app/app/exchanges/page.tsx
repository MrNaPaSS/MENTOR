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
import { useRouter, useSearchParams } from "next/navigation";
import { Check, KeyRound, LogIn } from "lucide-react";

import { PaneHead, PaneScope } from "@/components/app/Pane";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import { useT } from "@/lib/i18n";
import {
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
      <PaneHead title={d.title} hint={d.hint} />

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

      <div className="grid gap-3 lg:grid-cols-2">
        {(listing?.venues ?? []).map((venue) => (
          <VenueCard
            key={venue.exchange}
            venue={venue}
            active={venue.exchange === active}
            busy={busy === venue.exchange}
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
  onLogin,
  onKeys,
  onActive,
  onDrop,
}: {
  venue: VenueRow;
  active: boolean;
  busy: boolean;
  onLogin: () => void;
  onKeys: () => void;
  onActive: () => void;
  onDrop: () => void;
}) {
  const t = useT();
  const d = t.exchanges;
  const taker = ratePct(venue.taker);
  const maker = ratePct(venue.maker);
  const academy = ratePct(venue.academy_taker);
  const cashback = venue.cashback ? `${Math.round(venue.cashback * 100)}%` : null;

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-[var(--pane-text)]">{venue.title}</p>
          <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
            {d.broker[venue.broker] ?? venue.broker}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {active && (
            <span className={`${CHIP} bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]`}>
              {d.state.active}
            </span>
          )}
          <span
            className={`${CHIP} ${
              venue.trading
                ? "bg-[var(--pane-hover)] text-[var(--pane-text-2)]"
                : "bg-[var(--pane-hover)] text-[var(--pane-muted)]"
            }`}
          >
            {venue.trading ? d.state.trading : d.state.soon}
          </span>
          <span className={`${CHIP} bg-[var(--pane-hover)] text-[var(--pane-muted)]`}>
            {venue.book ? d.state.ownBook : d.state.sharedBook}
          </span>
        </div>
      </div>

      {/* Условия. Пусто - так и пишем: «уточняются». */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] tabular-nums">
        <Row label={d.terms.taker} value={taker} fallback={d.terms.unknown} />
        <Row label={d.terms.maker} value={maker} fallback={d.terms.unknown} />
        <Row label={d.terms.academy} value={academy} fallback={d.terms.unknown} />
        <Row label={d.terms.cashback} value={cashback} fallback={d.terms.unknown} />
      </div>

      {/* Свой счёт: подключён ли, чем и каким номером. */}
      <div className="mt-3 space-y-1 text-[11px] leading-snug">
        <p className="flex items-center gap-1.5 text-[var(--pane-text-2)]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              venue.connected ? "bg-[var(--pane-up)]" : "bg-[var(--pane-border)]"
            }`}
          />
          {venue.connected
            ? `${d.state.connected} · ${
                venue.auth_kind === "oauth" ? d.auth.oauth : d.auth.keys
              }${venue.key_tail ? ` · ${venue.key_tail}` : ""}`
            : d.state.notConnected}
        </p>
        {venue.connected && (
          <p
            className={
              venue.access === "academy" ? "text-[var(--pane-accent)]" : "text-[var(--pane-muted)]"
            }
          >
            {venue.access === "academy" ? d.access.academy : d.access.own}
          </p>
        )}
        {venue.uid && <p className="text-[var(--pane-muted)]">{d.access.uid(venue.uid)}</p>}
        {venue.academy_uids.length > 0 && (
          <p className="text-[var(--pane-muted)]">
            {d.access.confirmed(venue.academy_uids.join(", "))}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
            disabled={busy}
            className={`${ACTION} flex items-center gap-1.5 border-[var(--pane-border)] text-[var(--pane-text-2)]`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {venue.connected ? d.actions.replace : d.actions.keys}
          </button>
        )}
        {venue.connected && !active && (
          <button
            onClick={onActive}
            disabled={busy}
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

function Row({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--pane-muted)]">{label}</span>
      <span className={value ? "text-[var(--pane-text-2)]" : "text-[var(--pane-muted)]"}>
        {value ?? fallback}
      </span>
    </div>
  );
}
