// Превращение результата структурного движка в фигуры для графика.
//
// Вынесено из компонента: здесь живут палитра и правила отрисовки, и их видно
// в одном месте, а не вперемешку с жизненным циклом графика.
//
// Палитра отличается от исходника осознанно. В нём линии структуры чёрные, а
// у нас тёмная тема — на ней чёрное не видно вовсе. Смысловые цвета (покупки
// зелёные, продажи красные, ордер-блоки фиолетовые) сохранены.

import type { Time, UTCTimestamp } from "lightweight-charts";
import type { Shapes, ShapeBand, ShapeBox, ShapePoint, ShapeSegment } from
  "@/components/scalping/primitives/ShapesPrimitive";
import { BULLISH, type SmcResult } from "./smc";
import { activeLevel, type ChandelierResult } from "./chandelier";

export type ShapeToggles = {
  /** Лента трейлинг-уровня: динамическая поддержка и сопротивление. */
  trend: boolean;
  structure: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  equal: boolean;
  zones: boolean;
};

export const SHAPE_DEFAULTS: ShapeToggles = {
  trend: true,
  structure: true,
  orderBlocks: true,
  fvg: true,
  equal: true,
  zones: false,
};

export type ChartTheme = "dark" | "light";

const DARK = {
  structure: "#8A93A0",
  swingLabel: "#B7BDC6",
  // Блоки различаются по роли, а не по размеру: поддержка снизу серая,
  // сопротивление сверху бледно-фиолетовое — так они размечены в терминале
  // заказчика, и по цвету сразу видно, чего от уровня ждать.
  //
  // Свинговые плотнее внутренних: их втрое меньше, и они весомее. Блок — это
  // одна свеча по высоте, узкая полоска, поэтому у всех есть рамка.
  supportBlock: "rgba(138, 147, 160, 0.24)",
  supportBlockBorder: "rgba(138, 147, 160, 0.55)",
  supportBlockStrong: "rgba(138, 147, 160, 0.38)",
  supportBlockStrongBorder: "rgba(138, 147, 160, 0.80)",
  resistBlock: "rgba(122, 110, 240, 0.22)",
  resistBlockBorder: "rgba(122, 110, 240, 0.50)",
  resistBlockStrong: "rgba(122, 110, 240, 0.36)",
  resistBlockStrongBorder: "rgba(122, 110, 240, 0.78)",
  bullishGap: "rgba(14, 203, 129, 0.16)",
  bearishGap: "rgba(246, 70, 93, 0.16)",
  equal: "#F0B90B",
  boxLabel: "rgba(183, 189, 198, 0.75)",
  // Лента тренда: рост сиреневый, падение серое — как в самом индикаторе.
  trendUpFill: "rgba(122, 110, 240, 0.16)",
  trendDownFill: "rgba(138, 147, 160, 0.16)",
  trendUpLine: "#7A6EF0",
  trendDownLine: "#8A93A0",
  trendUpMark: "#0ECB81",
  trendDownMark: "#F6465D",
  premium: "rgba(246, 70, 93, 0.07)",
  equilibrium: "rgba(122, 130, 144, 0.07)",
  discount: "rgba(14, 203, 129, 0.07)",
};

// Светлая палитра — по оформлению самого индикатора: структура и подписи
// чёрные, ордер-блоки сиреневые, разрывы бледно-фиолетовые. Прозрачности
// плотнее, чем на тёмной: на белом фоне слабая заливка исчезает вовсе.
const LIGHT: typeof DARK = {
  structure: "#000000",
  swingLabel: "#000000",
  supportBlock: "rgba(150, 150, 150, 0.26)",
  supportBlockBorder: "rgba(120, 120, 120, 0.55)",
  supportBlockStrong: "rgba(150, 150, 150, 0.42)",
  supportBlockStrongBorder: "rgba(110, 110, 110, 0.75)",
  resistBlock: "rgba(149, 117, 205, 0.20)",
  resistBlockBorder: "rgba(103, 58, 183, 0.45)",
  resistBlockStrong: "rgba(149, 117, 205, 0.36)",
  resistBlockStrongBorder: "rgba(103, 58, 183, 0.70)",
  bullishGap: "rgba(0, 168, 107, 0.13)",
  bearishGap: "rgba(255, 26, 46, 0.11)",
  equal: "#8D6E00",
  boxLabel: "rgba(60, 60, 70, 0.75)",
  trendUpFill: "rgba(149, 117, 205, 0.22)",
  trendDownFill: "rgba(150, 150, 150, 0.28)",
  trendUpLine: "#7E57C2",
  trendDownLine: "#8A8A8A",
  trendUpMark: "#2962FF",
  trendDownMark: "#2962FF",
  // Зоны в оригинале не красно-зелёные, а сиреневые полосы разной плотности:
  // премия и скидка одинаковым тоном, равновесие бледнее. Смысл несёт
  // положение относительно цены, а не цвет.
  premium: "rgba(149, 117, 205, 0.16)",
  equilibrium: "rgba(149, 117, 205, 0.07)",
  discount: "rgba(149, 117, 205, 0.16)",
};

const PALETTES = { dark: DARK, light: LIGHT };

/**
 * Собрать фигуры для графика.
 *
 * `lastTime` нужен боксам: ордер-блок и зоны в оригинале тянутся вправо до
 * последнего бара, а «до бесконечности» на канве нарисовать нельзя.
 */
export function buildShapes(
  smc: SmcResult,
  lastTime: number,
  toggles: ShapeToggles = SHAPE_DEFAULTS,
  theme: ChartTheme = "dark",
  ce: ChandelierResult | null = null,
): Shapes {
  const COLORS = PALETTES[theme];
  const bands: ShapeBand[] = [];
  const boxes: ShapeBox[] = [];
  const segments: ShapeSegment[] = [];
  const points: ShapePoint[] = [];

  const at = (t: number): Time => t as UTCTimestamp;

  // Лента трейлинг-уровня. Разрывается на каждом развороте: одной фигурой её
  // рисовать нельзя — при смене направления уровень перескакивает через всю
  // свечу, и заливка протянулась бы поперёк графика.
  if (toggles.trend && ce && ce.bars.length > 1) {
    let run: typeof ce.bars = [];
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const up = run[0].dir === 1;
      bands.push({
        points: run.map((bar) => ({
          time: at(bar.time),
          top: Math.max(bar.mid, activeLevel(bar)),
          bottom: Math.min(bar.mid, activeLevel(bar)),
        })),
        fill: up ? COLORS.trendUpFill : COLORS.trendDownFill,
        line: up ? COLORS.trendUpLine : COLORS.trendDownLine,
        // Обводим ту сторону, которая и есть уровень: при росте он снизу.
        level: up ? "bottom" : "top",
      });
      run = [];
    };

    for (const bar of ce.bars) {
      if (run.length > 0 && bar.dir !== run[run.length - 1].dir) flush();
      run.push(bar);
    }
    flush();

    for (const signal of ce.signals) {
      points.push({
        time: at(signal.time),
        price: signal.price,
        text: signal.dir === 1 ? "BY↑" : "SL↓",
        color: signal.dir === 1 ? COLORS.trendUpMark : COLORS.trendDownMark,
        above: signal.dir === -1,
      });
    }
  }

  if (toggles.zones) {
    for (const zone of smc.zones) {
      boxes.push({
        fromTime: at(smc.trailing?.bottomTime ?? lastTime),
        // До правого края окна: в оригинале зоны и блоки тянутся вправо без
        // конца, а обрыв на последней свече читается как «здесь уровень
        // кончился», чего в них нет.
        toTime: "edge",
        top: zone.top,
        bottom: zone.bottom,
        // Зоны без подписей: они занимают полэкрана, и три надписи поверх
        // свечей только мешают. Цвет и положение говорят сами за себя.
        fill:
          zone.tag === "Premium"
            ? COLORS.premium
            : zone.tag === "Discount"
              ? COLORS.discount
              : COLORS.equilibrium,
      });
    }
  }

  if (toggles.orderBlocks) {
    for (const block of smc.orderBlocks) {
      // Бычий блок — это спрос под ценой, то есть поддержка; медвежий стоит
      // над ценой и работает сопротивлением.
      const support = block.bias === BULLISH;
      const strong = !block.internal;
      boxes.push({
        fromTime: at(block.fromTime),
        toTime: "edge",
        top: block.top,
        bottom: block.bottom,
        fill: support
          ? strong
            ? COLORS.supportBlockStrong
            : COLORS.supportBlock
          : strong
            ? COLORS.resistBlockStrong
            : COLORS.resistBlock,
        border: support
          ? strong
            ? COLORS.supportBlockStrongBorder
            : COLORS.supportBlockBorder
          : strong
            ? COLORS.resistBlockStrongBorder
            : COLORS.resistBlockBorder,
        // Подпись, чтобы блок не путался с разрывом: они рисуются рядом и
        // одинаковыми прямоугольниками, а смысл у них разный.
        label: support ? "поддержка" : "сопротивление",
        labelColor: COLORS.boxLabel,
      });
    }
  }

  if (toggles.fvg) {
    for (const gap of smc.fvgs) {
      boxes.push({
        fromTime: at(gap.fromTime),
        toTime: at(gap.toTime),
        top: gap.top,
        bottom: gap.bottom,
        fill: gap.bias === BULLISH ? COLORS.bullishGap : COLORS.bearishGap,
        label: "FVG",
        labelColor: COLORS.boxLabel,
      });
    }
  }

  if (toggles.structure) {
    for (const line of smc.structures) {
      segments.push({
        fromTime: at(line.fromTime),
        toTime: at(line.toTime),
        price: line.price,
        color: COLORS.structure,
        // Внутренняя структура пунктиром, свинговая сплошной — как в оригинале.
        dashed: line.internal,
        label: line.tag,
      });
    }
    for (const swing of smc.swings) {
      points.push({
        time: at(swing.time),
        price: swing.price,
        text: swing.tag,
        color: COLORS.swingLabel,
        // Вершины подписываем сверху, впадины снизу.
        above: swing.tag === "HH" || swing.tag === "LH",
      });
    }
  }

  if (toggles.equal) {
    for (const eq of smc.equals) {
      segments.push({
        fromTime: at(eq.fromTime),
        toTime: at(eq.toTime),
        price: eq.price,
        color: COLORS.equal,
        dashed: true,
        label: eq.tag,
      });
    }
  }

  return { bands, boxes, segments, points };
}
