// Объём внутри свечи — карточкой в углу графика.
//
// Раньше это рисовалось на полотне прямо у свечи: колонка цифр без ценовой
// подписи, вплотную к телу, поверх соседей. Читать её было нечем — цену
// приходилось угадывать по высоте строки, а сама панель закрывала то место
// графика, ради которого её и открывали.
//
// Здесь это обычная панель терминала: те же переменные оформления, что у
// стакана и скринера, те же цифры моноширинным. Стоит она в стороне от цены,
// справа и выше, и с графиком связана только заголовком - временем свечи.
//
// Строки: слева продали, справа купили - тот же порядок, что в стакане; между
// ними цена, по которой прошёл объём. За числами полосы: перевес видно, не
// читая цифр.

import { useMemo } from "react";
import { X } from "lucide-react";

import {
  foldRows,
  markRows,
  stepForRows,
  type FootprintData,
} from "@/lib/indicator/footprint";
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

export function FootprintCard({
  data,
  onClose,
}: {
  data: FootprintData;
  onClose: () => void;
}) {
  const t = useT();

  const rows = useMemo(() => {
    if (data.levels.length === 0) return [];
    const prices = data.levels.map((level) => level.price);
    const span = Math.max(...prices) - Math.min(...prices);
    const step = stepForRows(data.tick, span, MAX_ROWS);
    return markRows(foldRows(data.levels, step));
  }, [data]);

  // Опора полос — самая крупная сторона в строке, а не весь оборот свечи:
  // иначе на свече с одной плитой все остальные строки лежат в ноль.
  const peak = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
  const delta = data.buy - data.sell;

  return (
    <div
      className="pointer-events-auto flex max-h-[62%] w-[212px] flex-col overflow-hidden rounded-lg border font-mono text-[10px] tabular-nums shadow-lg"
      style={{
        borderColor: "var(--pane-border)",
        background: "var(--pane-bg)",
        color: "var(--pane-text)",
      }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b px-2 py-1"
        style={{ borderColor: "var(--pane-border)" }}
      >
        <span style={{ color: "var(--pane-text-2)" }}>
          {clockLabel(data.time)} · {data.interval}
        </span>
        <button
          onClick={onClose}
          title={t.terminal.chart.footClose}
          className="transition-opacity duration-150 ease-out hover:opacity-70"
          style={{ color: "var(--pane-muted)" }}
        >
          <X className="h-3 w-3" />
        </button>
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

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-center" style={{ color: "var(--pane-muted)" }}>
            {t.terminal.chart.footEmpty}
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.price}
              className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-x-1 px-2 leading-[15px]"
              style={{
                // Самая наторгованная цена свечи: к ней она и возвращается, и
                // по ней ставят стоп.
                background: row.poc ? "var(--pane-gold-soft)" : undefined,
              }}
            >
              {/* Полосы объёма: растут от середины к краям, как в стакане. */}
              {peak > 0 && row.sell > 0 && (
                <span
                  className="pointer-events-none absolute inset-y-px left-0"
                  style={{
                    width: `${(row.sell / peak) * 50}%`,
                    background: "var(--pane-down-faint)",
                  }}
                />
              )}
              {peak > 0 && row.buy > 0 && (
                <span
                  className="pointer-events-none absolute inset-y-px right-0"
                  style={{
                    width: `${(row.buy / peak) * 50}%`,
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
