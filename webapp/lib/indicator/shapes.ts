// Превращение результата структурного движка в фигуры для графика.
//
// Вынесено из компонента: здесь живут палитра и правила отрисовки, и их видно
// в одном месте, а не вперемешку с жизненным циклом графика.
//
// Палитра отличается от исходника осознанно. В нём линии структуры чёрные, а
// у нас тёмная тема — на ней чёрное не видно вовсе. Смысловые цвета (покупки
// зелёные, продажи красные, ордер-блоки фиолетовые) сохранены.

import type { Time, UTCTimestamp } from "lightweight-charts";
import type { Shapes, ShapeBox, ShapePoint, ShapeSegment } from
  "@/components/scalping/primitives/ShapesPrimitive";
import { BULLISH, type SmcResult } from "./smc";

export type ShapeToggles = {
  structure: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  equal: boolean;
  zones: boolean;
};

export const SHAPE_DEFAULTS: ShapeToggles = {
  structure: true,
  orderBlocks: true,
  fvg: true,
  equal: true,
  zones: false,
};

const COLORS = {
  structure: "#8A93A0",
  swingLabel: "#B7BDC6",
  // Ордер-блоки фиолетовые, как в терминале заказчика. Внутренние бледнее
  // свинговых: их втрое больше, и одинаковой насыщенностью они забивают экран.
  // Блок — это одна свеча по высоте, узкая полоска: на прозрачности разрывов
  // её просто не видно, поэтому заливка плотнее и добавлена рамка.
  internalBlock: "rgba(122, 110, 240, 0.26)",
  internalBlockBorder: "rgba(122, 110, 240, 0.55)",
  swingBlock: "rgba(122, 110, 240, 0.40)",
  swingBlockBorder: "rgba(122, 110, 240, 0.80)",
  bullishGap: "rgba(14, 203, 129, 0.16)",
  bearishGap: "rgba(246, 70, 93, 0.16)",
  equal: "#F0B90B",
  premium: "rgba(246, 70, 93, 0.07)",
  equilibrium: "rgba(122, 130, 144, 0.07)",
  discount: "rgba(14, 203, 129, 0.07)",
};

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
): Shapes {
  const boxes: ShapeBox[] = [];
  const segments: ShapeSegment[] = [];
  const points: ShapePoint[] = [];

  const at = (t: number): Time => t as UTCTimestamp;

  if (toggles.zones) {
    for (const zone of smc.zones) {
      boxes.push({
        fromTime: at(smc.trailing?.bottomTime ?? lastTime),
        toTime: at(lastTime),
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
      boxes.push({
        fromTime: at(block.fromTime),
        toTime: at(lastTime),
        top: block.top,
        bottom: block.bottom,
        fill: block.internal ? COLORS.internalBlock : COLORS.swingBlock,
        border: block.internal ? COLORS.internalBlockBorder : COLORS.swingBlockBorder,
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

  return { boxes, segments, points };
}
