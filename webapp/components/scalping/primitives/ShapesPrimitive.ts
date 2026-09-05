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

/**
 * Правый край фигуры.
 *
 * `"edge"` — до правого края окна. `{ bars: n }` — на n баров правее начала:
 * бокс сделки живёт в будущем, где времени для баров ещё не существует, но и
 * растягиваться на весь экран он не должен.
 */
export type ShapeEnd = Time | "edge" | { kind: "bars"; bars: number };

export type ShapeBox = {
  fromTime: Time;
  toTime: ShapeEnd;
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
  toTime: ShapeEnd;
  price: number;
  color: string;
  dashed: boolean;
  label?: string;
};

export type ShapePoint = {
  time: Time;
  price: number;
  /** Подпись. Пусто — значит рисуем только точку. */
  text?: string;
  color: string;
  /** Подпись над баром или под ним. */
  above: boolean;
  /** Радиус точки в пикселях. Без него точка не рисуется. */
  dot?: number;
};

/** Точка ленты: у каждого бара своя верхняя и нижняя граница. */
export type ShapeBandPoint = { time: Time; top: number; bottom: number };

/**
 * Лента: заливка между двумя линиями по барам.
 *
 * Прямоугольником такое не нарисовать — обе границы меняются на каждом баре.
 * Обводится только та сторона, которая и есть уровень: у поддержки нижняя, у
 * сопротивления верхняя. Вторая граница — средняя цена бара, линии там нет.
 */
export type ShapeBand = {
  points: ShapeBandPoint[];
  fill: string;
  line?: string;
  lineWidth?: number;
  level: "top" | "bottom";
};

export type Shapes = {
  bands: ShapeBand[];
  boxes: ShapeBox[];
  segments: ShapeSegment[];
  points: ShapePoint[];
};

export const EMPTY_SHAPES: Shapes = { bands: [], boxes: [], segments: [], points: [] };

const FONT = "10px ui-monospace, monospace";

type Ready = {
  bands: { xs: number[]; tops: number[]; bottoms: number[]; band: ShapeBand }[];
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

      // Лента идёт первой: она фон для всего остального.
      for (const { xs, tops, bottoms, band } of this.ready.bands) {
        if (xs.length < 2) continue;
        context.beginPath();
        context.moveTo(xs[0] * hx, tops[0] * vy);
        for (let i = 1; i < xs.length; i++) context.lineTo(xs[i] * hx, tops[i] * vy);
        for (let i = xs.length - 1; i >= 0; i--) context.lineTo(xs[i] * hx, bottoms[i] * vy);
        context.closePath();
        context.fillStyle = band.fill;
        context.fill();

        if (band.line) {
          const edge = band.level === "top" ? tops : bottoms;
          context.beginPath();
          context.moveTo(xs[0] * hx, edge[0] * vy);
          for (let i = 1; i < xs.length; i++) context.lineTo(xs[i] * hx, edge[i] * vy);
          context.strokeStyle = band.line;
          context.lineWidth = (band.lineWidth ?? 2) * hx;
          context.stroke();
          context.lineWidth = 1;
        }
      }

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
          // По центру бокса, а не в углу: у края подпись сливается с соседними
          // фигурами, а в середине она однозначно про этот прямоугольник.
          context.fillStyle = box.labelColor ?? "#B7BDC6";
          context.font = FONT;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(box.label, x + w / 2, y + h / 2);
          context.textAlign = "left";
          context.textBaseline = "top";
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

        if (point.dot) {
          context.beginPath();
          // Радиус по горизонтальному масштабу: на экранах с разной плотностью
          // точка должна оставаться круглой, а не превращаться в овал.
          context.arc(point.x * hx, point.y * vy, point.dot * hx, 0, Math.PI * 2);
          context.fill();
        }

        if (point.text) {
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
      }
    });
  }
}

class ShapesPaneView implements IPrimitivePaneView {
  private ready: Ready = { bands: [], boxes: [], segments: [], points: [] };

  constructor(private readonly source: ShapesPrimitive) {}

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    if (!chart || !series) {
      this.ready = { bands: [], boxes: [], segments: [], points: [] };
      return;
    }

    const scale = chart.timeScale();
    // Правый край — это край самой области графика в пикселях, а не координата
    // последнего бара. Считать по барам нельзя: стоит отмотать историю назад, и
    // «последний бар» оказывается правее экрана, а фигура рисуется от него
    // влево через весь график.
    const edge = scale.width();
    const perBar = scale.options().barSpacing;
    const x = (t: ShapeEnd, from = 0) => {
      if (t === "edge") return edge;
      // Различаем по метке: время в библиотеке тоже бывает объектом, и без
      // неё компилятор не может сказать, что перед ним.
      if (typeof t === "object" && "kind" in t) return from + t.bars * perBar;
      return scale.timeToCoordinate(t);
    };
    const y = (p: number) => series.priceToCoordinate(p);

    const bands: Ready["bands"] = [];
    for (const band of this.source.shapes.bands) {
      const xs: number[] = [];
      const tops: number[] = [];
      const bottoms: number[] = [];
      for (const point of band.points) {
        const px = x(point.time);
        const yTop = y(point.top);
        const yBottom = y(point.bottom);
        if (px === null || yTop === null || yBottom === null) continue;
        xs.push(px);
        tops.push(yTop);
        bottoms.push(yBottom);
      }
      if (xs.length >= 2) bands.push({ xs, tops, bottoms, band });
    }

    const boxes: Ready["boxes"] = [];
    for (const box of this.source.shapes.boxes) {
      const x1 = x(box.fromTime);
      const x2 = x1 === null ? null : x(box.toTime, x1);
      const y1 = y(box.top);
      const y2 = y(box.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      // Бокс с отрицательной шириной канва рисует зеркально — влево от начала.
      // Это тот самый случай, когда история отмотана и левый край фигуры ушёл
      // правее экрана: рисовать нечего.
      if (x2 <= x1) continue;
      boxes.push({ ...box, x1, x2, y1, y2 });
    }

    const segments: Ready["segments"] = [];
    for (const s of this.source.shapes.segments) {
      const x1 = x(s.fromTime);
      const x2 = x1 === null ? null : x(s.toTime, x1);
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

    this.ready = { bands, boxes, segments, points };
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
