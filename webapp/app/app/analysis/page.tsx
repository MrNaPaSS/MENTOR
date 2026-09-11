"use client";

import { useEffect, useState } from "react";
import { api, BroadcastItem } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { TrendingUp, ImageIcon, Radio, Lock } from "lucide-react";
import SignalsFeed from "@/components/signals/SignalsFeed";
import BroadcastCard from "@/components/analysis/BroadcastCard";
import { useT } from "@/lib/i18n";
import { PaneHead, PaneScope } from "@/components/app/Pane";

type Tab = "analysis" | "signals";

// Вкладки раздела - тем же видом, что в маркете и аналитике: рамка, выбранная
// золотом.
const TAB =
  "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ease-out";
const TAB_ON = "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]";
const TAB_OFF =
  "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

function AnalysisFeed() {
  const t = useT();
  const [items,  setItems]  = useState<BroadcastItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.broadcasts(token)
      .then((list) => {
        setItems(list);
        // Заход в раздел - это просмотр разборов в ленте: отмечаем их разом,
        // одним запросом, и сразу показываем новые числа. Сервер считает
        // человека один раз, повторный заход число не накручивает.
        if (!list.length) return;
        api
          .broadcastViewed(token, list.map((item) => item.id))
          .then((r) =>
            setItems((prev) => prev.map((item) => ({ ...item, views: r.views[String(item.id)] ?? item.views }))),
          )
          .catch(() => {});
      })
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <>
      {!loaded ? (
        <div className="space-y-3 xl:max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
              <div className="skeleton h-48 w-full" />
              <div className="space-y-2 p-3">
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] grid place-items-center py-16 text-center text-[var(--pane-muted)]">
          <TrendingUp className="mb-3 h-10 w-10 opacity-20" />
          <p className="font-medium">{t.signals.emptyAnalysis}</p>
          <p className="mt-1 text-sm opacity-60">{t.signals.emptyAnalysisHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <BroadcastCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

export default function AnalysisPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("analysis");
  // null — ещё проверяем, число — количество активных сигналов
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const signalsLocked = activeCount === 0;

  useEffect(() => {
    api.activeSignals()
      .then((list) => setActiveCount(list.length))
      .catch(() => setActiveCount(0));
  }, []);

  // Если активные сигналы пропали, пока пользователь был на их вкладке — вернём на анализы
  useEffect(() => {
    if (signalsLocked && tab === "signals") setTab("analysis");
  }, [signalsLocked, tab]);

  return (
    <PaneScope className="space-y-3">
      {/* Вкладки сразу за названием, как в маркете и на рынке, строка о
          разделе - под ними. */}
      <PaneHead
        title={t.signals.analysisTitle}
        hint={tab === "analysis" ? t.signals.analysisSubtitle : t.signals.signalsSubtitle}
        hintBelow
        nav={
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setTab("analysis")}
              className={`${TAB} ${tab === "analysis" ? TAB_ON : TAB_OFF}`}
            >
              <ImageIcon className="h-3 w-3 shrink-0" />
              {t.signals.tabAnalysis}
            </button>

            {/* Сигналы открыты, только пока есть хоть один живой. */}
            <button
              type="button"
              onClick={() => !signalsLocked && setTab("signals")}
              disabled={signalsLocked}
              title={signalsLocked ? t.signals.noActiveSignals : undefined}
              className={`${TAB} ${
                signalsLocked
                  ? "cursor-not-allowed border-[var(--pane-border)] bg-[var(--pane-bg)] text-[color:color-mix(in_srgb,var(--pane-muted)_40%,transparent)]"
                  : tab === "signals"
                    ? TAB_ON
                    : TAB_OFF
              }`}
            >
              {signalsLocked ? <Lock className="h-3 w-3 shrink-0" /> : <Radio className="h-3 w-3 shrink-0" />}
              {t.signals.tabSignals}
              {!signalsLocked && activeCount !== null && activeCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pane-accent-soft)] px-1 text-[10px] font-bold text-[var(--pane-accent)]">
                  {activeCount}
                </span>
              )}
            </button>
          </div>
        }
      />

      {tab === "analysis" ? <AnalysisFeed /> : <SignalsFeed />}
    </PaneScope>
  );
}
