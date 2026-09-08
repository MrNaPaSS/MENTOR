// Объём внутри свечи — отдельной панелью поверх графика.
//
// Раньше это рисовалось на полотне прямо у свечи: колонка цифр без ценовой
// подписи, вплотную к телу, поверх соседей. Читать её было нечем — цену
// приходилось угадывать по высоте строки, а сама панель закрывала то место
// графика, ради которого её и открывали.
//
// Здесь это обычная панель терминала: те же переменные оформления, что у
// стакана и скринера, те же цифры моноширинным. Держится она на текущей свече
// и двигается рукой за заголовок: где на графике пусто, знает только трейдер,
// и спорить с ним вёрсткой бессмысленно.
//
// Строки: слева продали, справа купили - тот же порядок, что в стакане; между
// ними цена, по которой прошёл объём. За числами полосы: перевес видно, не
// читая цифр. Справа - профиль свечи целиком, с областью стоимости: где рынок
// стоял, а где пробежал.

import { useMemo } from "react";
import { Crosshair, X } from "lucide-react";

import {
  foldRows,
  markRows,
  stepForRows,
  type FootprintData,
} from "@/lib/indicator/footprint";
import { withValueArea } from "@/lib/indicator/valueArea";
import { clockLabel, money, price as fmtPrice } from "@/lib/scalping";
import { useT } from "@/lib/i18n";

/**
 * Сколько строк показывает карточка.
 *
 * Свеча на триста биржевых шагов в столбик не влезает ни на каком экране, а
 * прокручиваемая лента цифр перестаёт быть картинкой свечи. Двадцать четыре -
 * столько, сколько читается одним взглядом; остальное собирается в них
 * укрупнением шага.
 */
const MAX_ROWS = 24;

/** Подписи границ области стоимости. Они не переводятся: так их зовут везде. */
const EDGE_LABEL = { vah: "VAH", poc: "POC", val: "VAL" } as const;

export function FootprintCard({
  data,
  live,
  onLive,
  onDragStart,
  onClose,
}: {
  data: FootprintData;
  /** Панель идёт за текущей свечой: закроется эта - покажет следующую. */
  live: boolean;
  /** Вернуться к текущей свече. Пусто - возвращаться не с чего. */
  onLive?: () => void;
  /** Заголовок он же ручка: за него панель и таскают по графику. */
  onDragStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
}) {
  const t = useT();

  const { rows, area } = useMemo(() => {
    if (data.levels.length === 0) return { rows: [], area: null };
    const prices = data.levels.map((level) => level.price);
    const span = Math.max(...prices) - Math.min(...prices);
    const step = stepForRows(data.tick, span, MAX_ROWS);
    return withValueArea(markRows(foldRows(data.levels, step)));
  }, [data]);

  // Опора полос — самая крупная сторона в строке, а не весь оборот свечи:
  // иначе на свече с одной плитой все остальные строки лежат в ноль.
  const peak = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
  // У профиля опора своя: он про строку целиком, и мерить его той же
  // величиной значит рисовать все полосы вдвое длиннее, чем есть.
  const peakTotal = rows.reduce((acc, row) => Math.max(acc, row.total), 0);
  const delta = data.buy - data.sell;

  return (
    <div
      className="pointer-events-auto flex max-h-[62%] w-[252px] flex-col overflow-hidden rounded-lg border font-mono text-[10px] tabular-nums shadow-lg"
      style={{
        borderColor: "var(--pane-border)",
        background: "var(--pane-bg)",
        color: "var(--pane-text)",
      }}
    >
      {/* Заголовок он же ручка. Курсор со стрелками говорит об этом раньше,
          чем трейдер решится потянуть: панель, которую можно двигать, но по
          которой это не видно, так и остаётся стоять там, где мешает. */}
      <div
        onPointerDown={onDragStart}
        title={onDragStart ? t.terminal.chart.footMove : undefined}
        className={`flex shrink-0 select-none items-center justify-between border-b px-2 py-1${
          onDragStart ? " cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{ borderColor: "var(--pane-border)" }}
      >
        <span className="flex items-center gap-1.5" style={{ color: "var(--pane-text-2)" }}>
          {clockLabel(data.time)} · {data.interval}
          {/* Живая свеча ещё набирается: цифры в ней меняются на глазах, и
              принимать их за итог нельзя. */}
          {live && (
            <span
              title={t.terminal.chart.footLiveTitle}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--pane-accent)" }}
            />
          )}
        </span>
        <span className="flex items-center gap-1">
          {onLive && (
            <button
              onClick={onLive}
              title={t.terminal.chart.footLive}
              className="transition-opacity duration-150 ease-out hover:opacity-70"
              style={{ color: "var(--pane-muted)" }}
            >
              <Crosshair className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onClose}
            title={t.terminal.chart.footClose}
            className="transition-opacity duration-150 ease-out hover:opacity-70"
            style={{ color: "var(--pane-muted)" }}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>

      {/* Итоги свечи: стороны порознь, под ними перевес и весь оборот. Считает
          их сервер по всем сделкам, а не по видимым строкам, - укрупнение на
          них не влияет. */}
      <div
        className="grid shrink-0 grid-cols-2 gap-x-2 border-b px-2 py-1"
        style={{ borderColor: "var(--pane-border)" }}
      >
        <span style={{ color: "var(--pane-down)" }}>
          {t.terminal.chart.footSell} {money(data.sell)}
        </span>
        <span className="text-right" style={{ color: "var(--pane-up)" }}>
          {money(data.buy)} {t.terminal.chart.footBuy}
        </span>
        <span style={{ color: delta >= 0 ? "var(--pane-up)" : "var(--pane-down)" }}>
          Δ {delta >= 0 ? "+" : "−"}
          {money(Math.abs(delta))}
        </span>
        <span
          className="text-right"
          style={{ color: "var(--pane-text-2)" }}
          // «≈» вместо «Σ», когда свеча разобрана не целиком: цифра рядом всё
          // равно меньше настоящей, и выдавать её за полную нельзя.
          title={data.partial ? t.terminal.chart.footPartial : undefined}
        >
          {data.partial ? "≈" : "Σ"} {money(data.buy + data.sell)}
        </span>
      </div>

      {/* Область стоимости словами: три цены, по которым и работают. Прочесть
          их с полос профиля можно, продиктовать по телефону - нет. */}
      {area && (
        <div
          className="flex shrink-0 items-center justify-between border-b px-2 py-1"
          style={{ borderColor: "var(--pane-border)" }}
          title={t.terminal.chart.footValueTitle}
        >
          <span style={{ color: "var(--pane-muted)" }}>
            VAH {fmtPrice(area.vah, data.tick)}
          </span>
          <span style={{ color: "var(--pane-gold)" }}>
            POC {fmtPrice(area.poc, data.tick)}
          </span>
          <span style={{ color: "var(--pane-muted)" }}>
            VAL {fmtPrice(area.val, data.tick)}
          </span>
        </div>
      )}

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-center" style={{ color: "var(--pane-muted)" }}>
            {t.terminal.chart.footEmpty}
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.price}
              className="relative grid grid-cols-[1fr_auto_1fr_46px] items-center gap-x-1 px-2 leading-[15px]"
              style={{
                // Самая наторгованная цена свечи: к ней она и возвращается, и
                // по ней ставят стоп.
                background: row.poc ? "var(--pane-gold-soft)" : undefined,
              }}
            >
              {/* Полосы объёма: растут от середины к краям, как в стакане.
                  Занимают только колонки цифр - у профиля справа своя мерка,
                  и заезжать под него полосам нельзя. */}
              {peak > 0 && row.sell > 0 && (
                <span
                  className="pointer-events-none absolute inset-y-px left-0"
                  style={{
                    width: `${(row.sell / peak) * 40}%`,
                    background: "var(--pane-down-faint)",
                  }}
                />
              )}
              {peak > 0 && row.buy > 0 && (
                <span
                  className="pointer-events-none absolute inset-y-px right-[46px]"
                  style={{
                    width: `${(row.buy / peak) * 40}%`,
                    background: "var(--pane-up-faint)",
                  }}
                />
              )}

              <span
                className="relative text-right"
                style={{
                  color: row.sell > 0 ? "var(--pane-down)" : "var(--pane-muted)",
                  // Перевес агрессии по диагонали: сторона, которая передавила,
                  // идёт жирным. Метка сбоку в строке высотой в пятнадцать
                  // точек читалась бы как соринка.
                  fontWeight: row.imbalance < 0 ? 700 : 400,
                }}
              >
                {row.sell > 0 ? money(row.sell) : "·"}
              </span>
              <span
                className="relative px-1"
                style={{
                  // Крупная сделка - тем же жёлтым, что плита в стакане: это
                  // одно и то же событие, только уже прошедшее.
                  color: row.whale ? "var(--pane-gold)" : "var(--pane-muted)",
                }}
              >
                {fmtPrice(row.price, data.tick)}
              </span>
              <span
                className="relative"
                style={{
                  color: row.buy > 0 ? "var(--pane-up)" : "var(--pane-muted)",
                  fontWeight: row.imbalance > 0 ? 700 : 400,
                }}
              >
                {row.buy > 0 ? money(row.buy) : "·"}
              </span>

              {/* Профиль свечи: строка целиком, одной полосой. Внутри области
                  стоимости - цветом, снаружи - серым: так с одного взгляда
                  видно, где рынок стоял, а где пробежал на пустоте. */}
              <span className="relative h-[15px]">
                <span
                  className="absolute inset-y-[3px] left-0 rounded-r-sm"
                  style={{
                    width: peakTotal > 0 ? `${Math.max(2, (row.total / peakTotal) * 100)}%` : 0,
                    background: row.poc
                      ? "var(--pane-gold)"
                      : row.value
                        ? "var(--pane-accent-soft)"
                        : "var(--pane-border)",
                  }}
                />
                {row.edge && (
                  <span
                    className="absolute right-0 top-0 text-[8px] leading-[15px]"
                    style={{
                      color: row.edge === "poc" ? "var(--pane-gold)" : "var(--pane-text-2)",
                    }}
                  >
                    {EDGE_LABEL[row.edge]}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
