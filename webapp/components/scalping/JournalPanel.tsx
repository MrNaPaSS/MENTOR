"use client";

// Журнал сделок и календарь прибыли.
//
// Сделка попадает сюда закрытой: со стопом, целью или закрытая руками. Пока
// она идёт, её видно на графике, а в журнале ей делать нечего — статистика по
// намерениям не считается.
//
// Календарь и список стоят рядом намеренно. По списку видно, что было в
// конкретной сделке, по календарю — что было с дисциплиной: один красный день
// на весь месяц и десять подряд выглядят одинаково в сумме и совершенно
// по-разному на сетке.

import { useT } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Lock, RefreshCw, Share2, Trash2, X } from "lucide-react";
import PnlCard from "./PnlCard";
import JournalTable, { type JournalRow } from "./JournalTable";
import PositionCard from "./PositionCard";
import ReviewPanel from "./ReviewPanel";
import TradeShots from "./TradeShots";
import JournalCalendar from "./JournalCalendar";
import Stat from "./Stat";
import { cardFromTrade } from "@/lib/pnl/data";
import { useJournalExport } from "@/lib/journalExport";
import {
  loadCalendar,
  loadTrades,
  canEditJournal,
  removeTrade,
  type JournalDay,
  type JournalSummary,
  type JournalTrade,
  type LiveJournalTrade,
  type VenueSlice,
} from "@/lib/journal";
import { useVenuePick, venueLabel } from "@/lib/venuePick";

function JournalPanel({
  symbol,
  refreshKey,
  onHover,
  onPick,
  owner,
  since,
  onFit,
  onClose,
}: {
  /** Показать только этот инструмент. Пусто — все. */
  symbol?: string;
  /** Меняется, когда терминал записал новую сделку: повод перечитать. */
  refreshKey: number;
  /** Сделка под курсором: её разметка показывается на графике. */
  onHover?: (trade: JournalRow | null) => void;
  /**
   * Нажали на строку: разметка сделки ложится на график.
   *
   * Масштаб при этом не трогаем. Переезд к времени сделки сбивал вид, который
   * трейдер только что настроил под свою работу, - а настраивает он его руками
   * и не для того, чтобы посмотреть историю. Сделка старше видимого куска
   * просто не покажется: доехать до неё дешевле, чем каждый раз возвращать
   * график на место.
   *
   * Наведение показывает разметку мельком и только если открыта та же монета.
   * Нажатие переключает инструмент и увозит график к её времени - строка в
   * таблице отвечает на вопрос «сколько», а на вопрос «почему» отвечает
   * только сам график.
   */
  onPick?: (trade: JournalRow) => void;
  /** Имя владельца: печать на карточке заверяет чью-то сделку, а не ничью. */
  owner?: string;
  /** День регистрации: с него ведётся карта торговли в разборе. */
  since?: string | null;
  /**
   * Сколько высоты панели хватит, чтобы календарь поместился целиком.
   *
   * Журнал открывается заданной высотой, и календарь в ней обрезался на
   * последней неделе: месяц виден, а итог месяца - нет. Панель меряет себя
   * сама и говорит это наружу; двигать высоту дальше - дело трейдера.
   */
  onFit?: (height: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  // Чья карточка открыта. Null - окна нет.
  const [card, setCard] = useState<JournalRow | null>(null);
  // Чью сделку разбираем снимками - по опознавателю, а не самой строкой.
  //
  // Строка приходит с сервера и обновляется после каждого добавления: держать
  // в состоянии её снимок значило бы показывать в окне вчерашний список, а
  // закрывать окно после каждой картинки - мешать раскладывать разбор.
  const [shotsOf, setShotsOf] = useState<string | null>(null);
  // Открытая позиция: её карточка со всеми этапами и разбором.
  const [openPos, setOpenPos] = useState<{ id: string; number?: number } | null>(null);
  // Шапка панели и колонка с календарём: по ним и считается нужная высота.
  const headRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  // Что показываем: список сделок или разбор - план недели и все снимки
  // за период рядом. Разбор смотрят иначе, чем ведут журнал: там читают
  // строки, здесь - картинки.
  const [tab, setTab] = useState<"list" | "review">("list");
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [onlySymbol, setOnlySymbol] = useState(false);

  const [trades, setTrades] = useState<JournalTrade[]>([]);
  // Сделки, которые идут прямо сейчас: показываются сверху, отдельно от
  // закрытых, и в итоги периода не входят - их результат ещё изменится.
  const [live, setLive] = useState<LiveJournalTrade[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  // Биржи, встречающиеся в сделках за период, и та, на которую уходят новые.
  // По ним рисуется переключатель: журнал показывает один счёт за раз, потому
  // что суммы двух счетов в одной строке итога не сходятся ни с одним из них.
  const [venues, setVenues] = useState<VenueSlice[]>([]);
  const [active, setActive] = useState("");
  const [days, setDays] = useState<JournalDay[]>([]);
  // Выбранный в календаре день. Список справа показывает тогда только его
  // сделки: по календарю ищут «что случилось в тот вторник», и добираться до
  // ответа прокруткой всего периода человек не должен.
  const [day, setDay] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Право править журнал спрашиваем после отрисовки: ключ лежит в браузере, а
  // на сервере страницы его нет, и разметка разошлась бы с ним.
  const [mentor, setMentor] = useState(false);
  useEffect(() => {
    let alive = true;
    canEditJournal()
      .then((may) => {
        if (alive) setMentor(may);
      })
      .catch(() => {
        // Не ответили - кнопки не будет. Лишняя кнопка хуже её отсутствия.
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = useVenuePick(
    venues.map((row) => row.exchange),
    active,
  );
  const venue = pick.venue;

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [list, cal] = await Promise.all([
        loadTrades(90, onlySymbol ? symbol : undefined, venue || undefined),
        loadCalendar(year, month, venue || undefined),
      ]);
      if (list) {
        setTrades(list.trades);
        setLive(list.live ?? []);
        setSummary(list.summary);
        // Разрез приходит полным и с выбранной биржей: переключатель не должен
        // терять биржу, которую только что отфильтровали.
        setVenues(list.by_exchange ?? []);
        setActive(list.active ?? "");
      }
      if (cal) {
        setDays(cal.days);
        setTotal(cal.total);
      }
      if (!list && !cal) setError(t.journal.needLogin);
    } catch {
      setError(t.journal.loadFailed);
    } finally {
      setBusy(false);
    }
  }, [year, month, onlySymbol, symbol, venue]);

  useEffect(() => {
    // Ждём, пока прочитается запомненный выбор биржи. Один кадр против одного
    // лишнего круга к серверу: без этого журнал спрашивал сделки сперва без
    // биржи, а следом ещё раз - с ней.
    if (!pick.ready) return;
    reload();
  }, [reload, refreshKey, pick.ready]);

  async function drop(id: number) {
    await removeTrade(id);
    reload();
  }

  // Сделки выбранного дня. День календаря считает сервер по своим суткам, и
  // сравниваем по ним же - иначе вечерняя сделка попадёт в соседнюю клетку.
  const shown = day === null ? trades : trades.filter((row) => row.closed_at.slice(0, 10) === day);


  // Сделка, снимки которой открыты. Ищем её в свежих строках, а не помним
  // отдельно: после добавления картинки журнал перечитывается, и окно должно
  // показать новый список само.
  // Высоту сообщаем, когда календарь уже нарисован: до этого мерить нечего.
  useEffect(() => {
    if (!onFit || tab !== "list") return;
    const head = headRef.current?.offsetHeight ?? 0;
    const left = leftRef.current?.scrollHeight ?? 0;
    if (left === 0) return;
    // Отступы содержимого - те же восемь пикселей сверху и снизу, что в
    // разметке: считать их по классам нельзя, а промахнуться на них - значит
    // снова обрезать последнюю строку.
    onFit(head + left + 16);
  }, [onFit, tab, days, summary]);

  const shotsRow = shotsOf
    ? [...live, ...trades].find((row) => row.client_id === shotsOf) ?? null
    : null;

  function toToday() {
    const now = new Date();
    setYear(now.getUTCFullYear());
    setMonth(now.getUTCMonth() + 1);
    setDay(null);
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
    // Выбранный день остался в прошлом месяце: держать его фильтром значит
    // показывать пустой список рядом с полным календарём.
    setDay(null);
  }

  // Выгрузка журнала - инструмент маркета. Не куплена - на её месте замок,
  // который ведёт в «Инструменты». Куплена - три выгрузки в месяц: счёт держит
  // сервер, а здесь он виден рядом с кнопкой.
  //
  // Сама выгрузка живёт в общем хуке: та же кнопка стоит в расширенной
  // аналитике, и отчёт должен быть один и тот же.
  const report = useJournalExport();

  useEffect(() => {
    if (report.error) setError(report.error);
  }, [report.error]);

  return (
    <div className="flex h-full flex-col text-[12px]">
      <div
        ref={headRef}
        className="flex items-center justify-between border-b border-[var(--pane-border)] px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-[var(--pane-text)]">{t.journal.title}</span>
          {/* Биржи журнала. Показывается одна: итог, календарь и отчёт считаются
              по ней, а суммы двух счетов в одной строке не сходятся ни с одним
              из них. История при этом вся - переключатель доводит до любой. */}
          {pick.many &&
            venues.map((row) => (
              <button
                key={row.exchange}
                onClick={() => pick.pick(row.exchange)}
                title={t.journal.venueHint(venueLabel(row.exchange, t.journal.venueNone), row.count)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors duration-150 ease-out ${
                  venue === row.exchange
                    ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                    : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
                }`}
              >
                {venueLabel(row.exchange, t.journal.venueNone)}
              </button>
            ))}
        </div>
        <div className="flex items-center gap-2">
          {symbol && (
            <button
              onClick={() => setOnlySymbol((v) => !v)}
              className={`rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 ease-out ${
                onlySymbol
                  ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                  : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              }`}
            >
              {t.journal.onlyCoin(symbol.replace(/USDT$/, ""))}
            </button>
          )}
          {report.loaded &&
            (report.owned ? (
              <button
                onClick={() => report.run(onlySymbol ? symbol : undefined, venue || undefined)}
                disabled={report.busy || report.spent}
                title={
                  report.quota
                    ? report.spent
                      ? t.journal.exportSpent(report.resetDay)
                      : `${t.journal.exportCsv}. ${t.journal.exportLeftTitle(report.quota.left, report.quota.limit, report.resetDay)}`
                    : t.journal.exportCsv
                }
                className="flex items-center gap-1 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {report.quota && (
                  <span className="font-mono text-[10px] tabular-nums">
                    {t.journal.exportLeft(report.quota.left, report.quota.limit)}
                  </span>
                )}
              </button>
            ) : (
              <Link
                href="/app/shop?cat=tools"
                title={t.journal.exportLocked}
                className="flex items-center text-[var(--pane-muted)] opacity-60 transition-opacity duration-150 ease-out hover:opacity-100"
              >
                <Download className="h-3.5 w-3.5" />
                <Lock className="-ml-1 h-2.5 w-2.5" />
              </Link>
            ))}
          {/* Список и разбор - две стороны одного журнала, поэтому
              переключатель стоит в его же шапке. */}
          <div className="mr-1 flex overflow-hidden rounded border border-[var(--pane-border)] text-[10px]">
            {(["list", "review"] as const).map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={`px-2 py-0.5 transition-colors duration-150 ease-out ${
                  tab === name
                    ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                    : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
                }`}
              >
                {name === "list" ? t.journal.tabList : t.journal.tabReview}
              </button>
            ))}
          </div>
          <button
            onClick={reload}
            title={t.journal.refresh}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onClose}
            title={t.journal.close}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="grid flex-1 place-items-center px-4 text-center text-[var(--pane-muted)]">
          {error}
        </p>
      ) : tab === "review" ? (
        // Разбор: план недели и снимки за тот же период, что и список.
        <div className="no-scrollbar min-h-0 flex-1 overflow-hidden px-3 py-2">
          <ReviewPanel
            rows={[...live, ...shown]}
            year={year}
            month={month}
            picked={day}
            since={since}
            onPickDay={setDay}
            onPick={(row, number) => setOpenPos({ id: row.client_id, number })}
          />
        </div>
      ) : (
        <div className="no-scrollbar min-h-0 flex-1 overflow-auto px-3 py-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:overflow-hidden">
          {/* Ровно пополам: слева итог и календарь, справа сами сделки.
              Растянутый на всю ширину календарь отодвигал список вниз, и на
              невысокой панели от сделок было видно две строки. Плечом к плечу
              обе половины отвечают на свои вопросы сразу: календарь - про
              дисциплину, список - про конкретную сделку. Узкая панель
              (телефон, вторая колонка терминала) остаётся столбиком: две
              колонки там не разойдутся. */}
          <div ref={leftRef} className="no-scrollbar lg:max-h-full lg:min-h-0 lg:overflow-auto">
            {summary && (
              <div className="mb-3 grid grid-cols-5 gap-2 font-mono tabular-nums">
                <Stat label={t.journal.statPnl} value={money(summary.pnl)} tone={tone(summary.pnl)} />
                <Stat label={t.journal.statTrades} value={String(summary.count)} />
                <Stat label={t.journal.statWinRate} value={`${summary.win_rate}%`} />
                <Stat
                  label={t.journal.statBest}
                  value={summary.wins > 0 ? money(summary.best) : "-"}
                  tone={summary.wins > 0 ? tone(summary.best) : undefined}
                />
                <Stat
                  label={t.journal.statWorst}
                  value={summary.losses > 0 ? money(summary.worst) : "-"}
                  tone={summary.losses > 0 ? tone(summary.worst) : undefined}
                />
              </div>
            )}

            <JournalCalendar
              year={year}
              month={month}
              days={days}
              total={total}
              onShift={shiftMonth}
              onToday={toToday}
              picked={day}
              onPickDay={setDay}
            />
          </div>

          <div className="no-scrollbar lg:max-h-full lg:min-h-0 lg:overflow-auto">
            {/* Чип выбранного дня: видно, почему список короче обычного, и
                чем его вернуть. */}
            {day !== null && (
              <button
                onClick={() => setDay(null)}
                title={t.journal.clearDay}
                className="mb-2 inline-flex items-center gap-1 rounded bg-[var(--pane-accent-faint)] px-2 py-0.5 text-[10px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)]"
              >
                {t.journal.dayFilter(day.slice(8, 10) + "." + day.slice(5, 7))}
                <X className="h-3 w-3" />
              </button>
            )}

            {/* Идущие сделки - своим разделом сверху, ровно того же вида, что
                список ниже: те же колонки и те же ширины. Нет идущих - нет и
                раздела, лишней пустой шапки на экране не висит. */}
            {live.length > 0 && day === null && (
              <div className="mb-3">
                <JournalTable
                  rows={live}
                  onHover={onHover}
                  onPick={onPick}
                  onCard={setCard}
                  onDrop={mentor ? drop : undefined}
                  onShots={(row) => setOpenPos({ id: row.client_id })}
                  dateLabel={t.journal.colLive}
                />
              </div>
            )}

            {shown.length === 0 ? (
              live.length === 0 || day !== null ? (
                <p className="py-6 text-center text-[var(--pane-muted)]">{t.journal.empty}</p>
              ) : null
            ) : (
              <JournalTable
                rows={shown}
                onHover={onHover}
                onPick={onPick}
                onCard={setCard}
                onDrop={mentor ? drop : undefined}
                onShots={(row) => setOpenPos({ id: row.client_id })}
                resultLabel={t.journal.colResultFee}
              />
            )}
          </div>
        </div>
      )}

      {card && (
        <PnlCard data={cardFromTrade(card, owner)} onClose={() => setCard(null)} />
      )}

      {(() => {
        const one = openPos
          ? [...live, ...shown].find((row) => row.client_id === openPos.id)
          : null;
        if (!one || !openPos) return null;
        return (
          <PositionCard
            trade={one}
            number={openPos.number}
            owner={owner}
            onClose={() => setOpenPos(null)}
            onChange={() => void reload()}
          />
        );
      })()}

      {shotsRow && (
        <TradeShots
          clientId={shotsRow.client_id}
          symbol={shotsRow.symbol}
          shots={shotsRow.shots ?? []}
          trade={shotsRow}
          onClose={() => setShotsOf(null)}
          // Окно остаётся открытым: снимков к сделке прикладывают несколько
          // подряд, и закрываться после каждого - значит открывать его заново
          // ради второй картинки. Список сам обновится перечитанным журналом.
          onChange={() => void reload()}
        />
      )}
    </div>
  );
}



// Журнал не зависит от стакана, а страница под ним перерисовывается восемь
// раз в секунду. Со стороны терминала все пропсы постоянны (lib/useEvent.ts),
// поэтому список сделок пересчитывается только когда в нём что-то меняется.
export default memo(JournalPanel);
