"use client";

// Монеты в шапке и награды, которые ждут получения.
//
// Награда не падает в баланс сама: она ждёт, и об этом говорит значок с
// числом на счётчике. Нажатие открывает окно со списком - за что пришло и
// сколько, - и одну кнопку «Забрать все». Монеты вылетают из кнопки в
// счётчик, число докручивается до нового баланса.
//
// Без наград то же окно отвечает на вопрос, с которым сюда и нажимают:
// откуда монеты - ссылкой на историю в аналитике, куда их деть - в маркет.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Gift, Loader2, X } from "lucide-react";
import CoinIcon, { coinSrc } from "@/components/app/CoinIcon";
import { readTerminalTheme } from "@/lib/terminalTheme";
import { api, type CoinTx } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useIntlLocale, useT } from "@/lib/i18n";
import { COINS_EVENT, type CoinsEventDetail } from "@/lib/useCoins";
import { dismissRewardToasts, REWARDS_OPEN_EVENT } from "@/lib/rewards";
import { rewardLabel } from "@/lib/rewardLabel";
import { flyCoins } from "@/lib/coinFlight";
import { useRollingNumber } from "@/lib/useRollingNumber";
import { play } from "@/lib/sound";
import { CHIP, CHIP_OFF, NUM, PaneScope } from "@/components/app/Pane";

type Props = {
  coins: number;
  pending: CoinTx[];
  pendingTotal: number;
  pendingCount: number;
};

function announce(detail: CoinsEventDetail): void {
  window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail }));
}

export default function RewardsChip({ coins, pending, pendingTotal, pendingCount }: Props) {
  const t = useT();
  const numbers = useIntlLocale();
  const [open, setOpen] = useState(false);
  const shown = useRollingNumber(coins) ?? coins;
  const root = useRef<HTMLDivElement>(null);
  const waiting = pendingCount > 0;

  // Уведомление о награде просит открыть окно - откуда бы ни пришло.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(REWARDS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REWARDS_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const title = waiting ? t.rewards.badge(pendingCount) : t.rewards.chipTitle;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-coin-target
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        className="coin-chip relative hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 sm:flex"
      >
        <CoinIcon size={15} />
        <span className="font-mono text-sm font-bold tabular">{shown.toLocaleString(numbers)}</span>
        <span className="text-[9px] font-bold opacity-60">NMNH</span>
        {waiting && <Badge count={pendingCount} />}
      </button>

      {/* На узком экране чипа нет - места в шапке мало. Но награда, которую
          не видно, не заберётся: пока она ждёт, стоит значок-подарок. */}
      {waiting && (
        <button
          type="button"
          data-coin-target
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={title}
          className="coin-chip relative flex h-9 w-9 items-center justify-center rounded-xl border sm:hidden"
        >
          <Gift className="h-4 w-4" />
          <Badge count={pendingCount} />
        </button>
      )}

      {open && (
        <RewardsPanel
          pending={pending}
          total={pendingTotal}
          count={pendingCount}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Значок ожидания: число и мягкая волна вокруг, пока награда не забрана. */
function Badge({ count }: { count: number }) {
  return (
    <span
      className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-black"
      style={{ background: "rgb(var(--coin))" }}
    >
      <span
        aria-hidden
        className="absolute inset-0 animate-ping rounded-full motion-reduce:hidden"
        // Медленнее штатной волны: она висит всё время, пока награда ждёт,
        // и быстрая пульсация в углу глаза отвлекала бы от стакана.
        style={{ background: "rgb(var(--coin) / 0.55)", animationDuration: "2s" }}
      />
      <span className="relative tabular-nums">{count > 9 ? "9+" : count}</span>
    </span>
  );
}

/** «5 минут назад», «вчера» - тем языком, что выбран в кабинете. */
function ago(iso: string, locale: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "minute");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

function RewardsPanel({
  pending,
  total,
  count,
  onClose,
}: {
  pending: CoinTx[];
  total: number;
  count: number;
  onClose: () => void;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hasDebt = pending.some((tx) => tx.amount < 0);

  async function claim() {
    const token = getAccessToken();
    if (!token || busy) return;
    // Точку старта снимаем до закрытия окна: после него кнопки уже нет.
    const from = button.current?.getBoundingClientRect();
    setBusy(true);
    setError(null);
    try {
      const result = await api.coinsClaim(token);
      dismissRewardToasts();
      if (result.claimed <= 0 || !from) {
        // Забирать было нечего (успела соседняя вкладка) - перечитываем всё.
        announce({});
        onClose();
        return;
      }
      onClose();
      play("claim");
      await flyCoins(from, result.claimed, {
        // Летят настоящие монеты NMNH - той чеканки, что под текущую тему.
        src: coinSrc(readTerminalTheme()),
        // Число бежит вверх, когда первая монета коснулась счётчика.
        onFirstLand: () => announce({ balance: result.balance }),
      });
      // Значок гасим последним: на узком экране он и есть цель полёта.
      announce({ pending: [] });
    } catch {
      setError(t.rewards.claimError);
      setBusy(false);
    }
  }

  return (
    <PaneScope className="absolute right-0 top-full z-[80] mt-2 w-[320px] max-w-[calc(100vw-2rem)] origin-top-right animate-dialog-in motion-reduce:animate-none">
      <section
        role="dialog"
        aria-label={t.rewards.title}
        className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.rewards.title}</h2>
            {count > 0 && (
              <span className="truncate text-[11px] text-[var(--pane-muted)]">{t.rewards.hint}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.cancel}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {count === 0 ? (
          <p className="px-3 py-4 text-[11px] leading-relaxed text-[var(--pane-muted)]">{t.rewards.empty}</p>
        ) : (
          <ul className="max-h-[280px] overflow-y-auto">
            {pending.map((tx, i) => (
              <li
                key={tx.id}
                className="flex animate-fade-in items-center justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2 last:border-b-0 motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-[var(--pane-text)]">{rewardLabel(tx, t)}</p>
                  <p className="text-[10px] text-[var(--pane-muted)]">{ago(tx.created_at, numbers)}</p>
                </div>
                <span
                  className={`${NUM} shrink-0 text-[12px] font-semibold`}
                  style={{ color: tx.amount > 0 ? "var(--pane-gold)" : "var(--pane-down)" }}
                >
                  {tx.amount > 0 ? "+" : "−"}
                  {Math.abs(tx.amount).toLocaleString(numbers)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <footer className="space-y-2 border-t border-[var(--pane-border)] px-3 py-2.5">
          {count > 0 && (
            <>
              {hasDebt && <p className="text-[10px] text-[var(--pane-muted)]">{t.rewards.debtNote}</p>}
              <button
                ref={button}
                type="button"
                onClick={claim}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold text-black transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
                style={{ background: "var(--pane-gold)" }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CoinIcon size={15} />}
                {busy ? t.rewards.claiming : `${t.rewards.claimAll} · +${total.toLocaleString(numbers)}`}
              </button>
              {error && <p className="text-[11px] text-[var(--pane-down)]">{error}</p>}
            </>
          )}
          <div className="flex items-center justify-between gap-2">
            <Link href="/app/analytics" onClick={onClose} className={`${CHIP} ${CHIP_OFF}`}>
              {t.rewards.history}
            </Link>
            <Link href="/app/shop" onClick={onClose} className={`${CHIP} ${CHIP_OFF}`}>
              {t.rewards.spend}
            </Link>
          </div>
        </footer>
      </section>
    </PaneScope>
  );
}
