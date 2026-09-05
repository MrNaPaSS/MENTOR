// Произвольные фигуры на графике: прямоугольники, отрезки и подписи.
//
// Всё это библиотека рисовать не умеет — у неё есть только серии и
// горизонтальные линии во всю ширину. Ордер-блок ограничен по времени, линия
// структуры идёт от пивота до бара пробоя, подпись свинга стоит над конкретной
// свечой. Поэтому фигуры рисуются на канве самостоятельно.
//
// Один примитив на все три вида намеренно: они делят преобразование координат
// и порядок отрисовки. Разложив их по трём примитивам, пришлось бы следить,
// чтобы боксы не легли поверх подписей.

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export type ShapeBox = {
  fromTime: Time;
  toTime: Time;
  top: number;
  bottom: number;
  fill: string;
  border?: string;
  /** Подпись у левого края бокса. */
  label?: string;
  labelColor?: string;
};

export type ShapeSegment = {
  fromTime: Time;
  toTime: Time;
  price: number;
  color: string;
  dashed: boolean;
  label?: string;
};

export type ShapePoint = {
  time: Time;
  price: number;
  text: string;
  color: string;
  /** Подпись над баром или под ним. */
  above: boolean;
};

export type Shapes = {
  boxes: ShapeBox[];
  segments: ShapeSegment[];
  points: ShapePoint[];
};

export const EMPTY_SHAPES: Shapes = { boxes: [], segments: [], points: [] };

const FONT = "10px ui-monospace, monospace";
const LABEL_PADDING = 4;

type Ready = {
  boxes: (ShapeBox & { x1: number; x2: number; y1: number; y2: number })[];
  segments: (ShapeSegment & { x1: number; x2: number; y: number })[];
  points: (ShapePoint & { x: number; y: number })[];
};

class ShapesRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ready: Ready) {}

  draw(target: {
    useBitmapCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D;
        horizontalPixelRatio: number;
        verticalPixelRatio: number;
      }) => void,
    ) => void;
  }) {
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const hx = horizontalPixelRatio;
      const vy = verticalPixelRatio;

      for (const box of this.ready.boxes) {
        const x = box.x1 * hx;
        const y = Math.min(box.y1, box.y2) * vy;
        const w = (box.x2 - box.x1) * hx;
        const h = Math.abs(box.y2 - box.y1) * vy;

        context.fillStyle = box.fill;
        context.fillRect(x, y, w, h);
        if (box.border) {
          context.strokeStyle = box.border;
          context.lineWidth = 1;
          context.strokeRect(x, y, w, h);
        }
        if (box.label) {
          context.fillStyle = box.labelColor ?? "#B7BDC6";
          context.font = FONT;
          context.textBaseline = "top";
          context.fillText(box.label, x + LABEL_PADDING, y + LABEL_PADDING);
        }
      }

      for (const segment of this.ready.segments) {
        const y = segment.y * vy;
        context.strokeStyle = segment.color;
        context.lineWidth = 1;
        context.setLineDash(segment.dashed ? [3 * hx, 3 * hx] : []);
        context.beginPath();
        context.moveTo(segment.x1 * hx, y);
        context.lineTo(segment.x2 * hx, y);
        context.stroke();
        context.setLineDash([]);

        if (segment.label) {
          context.fillStyle = segment.color;
          context.font = FONT;
          context.textBaseline = "bottom";
          context.textAlign = "center";
          // Подпись по центру линии: так её видно и когда линия короткая.
          context.fillText(segment.label, ((segment.x1 + segment.x2) / 2) * hx, y - 2 * vy);
          context.textAlign = "left";
        }
      }

      for (const point of this.ready.points) {
        context.fillStyle = point.color;
        context.font = FONT;
        context.textAlign = "center";
        context.textBaseline = point.above ? "bottom" : "top";
        context.fillText(
          point.text,
          point.x * hx,
          (point.y + (point.above ? -4 : 4)) * vy,
        );
        context.textAlign = "left";
      }
    });
  }
}

class ShapesPaneView implements IPrimitivePaneView {
  private ready: Ready = { boxes: [], segments: [], points: [] };

  constructor(private readonly source: ShapesPrimitive) {}

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    if (!chart || !series) {
      this.ready = { boxes: [], segments: [], points: [] };
      return;
    }

    const scale = chart.timeScale();
    const x = (t: Time) => scale.timeToCoordinate(t);
    const y = (p: number) => series.priceToCoordinate(p);

    const boxes: Ready["boxes"] = [];
    for (const box of this.source.shapes.boxes) {
      const x1 = x(box.fromTime);
      const x2 = x(box.toTime);
      const y1 = y(box.top);
      const y2 = y(box.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      boxes.push({ ...box, x1, x2, y1, y2 });
    }

    const segments: Ready["segments"] = [];
    for (const s of this.source.shapes.segments) {
      const x1 = x(s.fromTime);
      const x2 = x(s.toTime);
      const yy = y(s.price);
      if (x1 === null || x2 === null || yy === null) continue;
      segments.push({ ...s, x1, x2, y: yy });
    }

    const points: Ready["points"] = [];
    for (const p of this.source.shapes.points) {
      const xx = x(p.time);
      const yy = y(p.price);
      if (xx === null || yy === null) continue;
      points.push({ ...p, x: xx, y: yy });
    }

    this.ready = { boxes, segments, points };
  }

  renderer() {
    return new ShapesRenderer(this.ready);
  }

  /** Под свечами: фигуры — это контекст, а не сами данные. */
  zOrder() {
    return "bottom" as const;
  }
}

export class ShapesPrimitive implements ISeriesPrimitive<Time> {
  shapes: Shapes = EMPTY_SHAPES;
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;

  private readonly view = new ShapesPaneView(this);
  private requestUpdate?: () => void;

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  setShapes(shapes: Shapes) {
    this.shapes = shapes;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}
