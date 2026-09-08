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
          style={{ borderColor: "var(--pane-border)", color: "var(--pane-muted)" }}
          title={t.terminal.chart.footValueTitle}
        >
          <span>VAH {fmtPrice(area.vah, data.tick)}</span>
          <span style={{ color: "var(--pane-gold)" }}>{fmtPrice(area.poc, data.tick)}</span>
          <span>VAL {fmtPrice(area.val, data.tick)}</span>
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
              className="grid grid-cols-[auto_1fr_1fr_34px_18px] items-stretch pl-2 pr-1 leading-[15px]"
              style={{
                // Самая наторгованная цена свечи — рамкой, а не заливкой.
                // Залитая строка перекрашивает под собой обе ячейки, и то, чем
                // эта цена стала главной, на ней уже не разглядеть.
                boxShadow: row.poc ? "inset 0 0 0 1px var(--pane-gold)" : undefined,
              }}
            >
              {/* Цена слева, стороны рядом друг с другом. Разведённые ценой,
                  они читаются как два списка чисел; сведённые - как лестница,
                  на которой красное и зелёное сравниваются глазом, без счёта. */}
              <span
                className="pr-1.5 text-right"
                style={{ color: row.whale ? "var(--pane-gold)" : "var(--pane-muted)" }}
                title={row.whale ? t.terminal.chart.footWhale : undefined}
              >
                {fmtPrice(row.price, data.tick)}
              </span>

              <Side
                value={row.sell}
                peak={peak}
                tone="var(--pane-down)"
                pressed={row.imbalance < 0}
              />
              <Side
                value={row.buy}
                peak={peak}
                tone="var(--pane-up)"
                pressed={row.imbalance > 0}
              />

              {/* Профиль: строка целиком, одной полосой. Внутри области
                  стоимости цветом, снаружи серым - видно, где рынок стоял, а
                  где пробежал на пустоте. */}
              <span className="relative ml-1">
                <span
                  className="absolute inset-y-[4px] left-0 rounded-r-[2px]"
                  style={{
                    width: peakTotal > 0 ? `${Math.max(3, (row.total / peakTotal) * 100)}%` : 0,
                    background: row.poc
                      ? "var(--pane-gold)"
                      : row.value
                        ? "var(--pane-accent-soft)"
                        : "var(--pane-border)",
                  }}
                />
              </span>

              <span
                className="pl-0.5 text-[8px]"
                style={{
                  color: row.edge === "poc" ? "var(--pane-gold)" : "var(--pane-muted)",
                }}
              >
                {row.edge ? EDGE_LABEL[row.edge] : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Сторона строки: число на тепловой подложке.
 *
 * Подложка, а не полоса от края: полоса переменной длины оставляет за собой
 * рваный край, и два десятка таких краёв превращают панель в бахрому. Ячейка
 * же читается как в стакане - чем гуще цвет, тем больше денег, - и цифры на
 * ней стоят ровным столбцом.
 *
 * Густота идёт корнем, а не долей: на свече, где одна плита вдесятеро больше
 * соседей, доля кладёт все остальные строки в один бледный тон, и лестница
 * перестаёт быть лестницей.
 */
function Side({
  value,
  peak,
  tone,
  pressed,
}: {
  value: number;
  peak: number;
  tone: string;
  /** Эта сторона передавила встречную по диагонали. */
  pressed: boolean;
}) {
  const heat = peak > 0 && value > 0 ? 0.08 + 0.5 * Math.sqrt(value / peak) : 0;
  return (
    <span className="relative px-1 text-right">
      {heat > 0 && (
        <span className="absolute inset-x-0 inset-y-px" style={{ background: tone, opacity: heat }} />
      )}
      <span
        className="relative"
        style={{
          // Чернила общие: сторону называет подложка, а красное на красном
          // читается хуже, чем то же число обычным цветом панели.
          color: value > 0 ? "var(--pane-text)" : "var(--pane-muted)",
          fontWeight: pressed ? 700 : 400,
        }}
      >
        {value > 0 ? money(value) : "·"}
      </span>
    </span>
  );
}
