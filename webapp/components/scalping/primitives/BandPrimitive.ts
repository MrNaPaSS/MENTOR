// Заливка области между двумя ценовыми рядами.
//
// В оригинале индикатора коридор Chandelier Exit — это `fill()` между средней
// ценой бара и линией стопа. Именно заливка делает стоп полосой, которую видно
// боковым зрением; без неё остаются две тонкие линии, неотличимые от обычных
// скользящих средних.
//
// Библиотека графика такого не умеет: fill между сериями в ней не предусмотрен,
// поэтому область рисуется своим примитивом прямо на канве. Тот же примитив
// потом закроет ордер-блоки и FVG — там тоже нужны произвольные фигуры.

import type {
  Coordinate,
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export type BandPoint = {
  time: Time;
  /** Верхняя и нижняя границы полосы в ценах. */
  upper: number;
  lower: number;
  /** Сторона: по ней выбирается цвет заливки. */
  up: boolean;
};

type Segment = {
  points: { x: Coordinate; upper: Coordinate; lower: Coordinate }[];
  up: boolean;
};

const UP_FILL = "rgba(14, 203, 129, 0.13)";
const DOWN_FILL = "rgba(246, 70, 93, 0.13)";

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly segments: Segment[]) {}

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
      for (const segment of this.segments) {
        if (segment.points.length < 2) continue;

        context.beginPath();
        // Верхняя граница слева направо, нижняя — обратно: получается
        // замкнутый контур полосы.
        segment.points.forEach((p, i) => {
          const x = p.x * horizontalPixelRatio;
          const y = p.upper * verticalPixelRatio;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        for (let i = segment.points.length - 1; i >= 0; i--) {
          const p = segment.points[i];
          context.lineTo(p.x * horizontalPixelRatio, p.lower * verticalPixelRatio);
        }
        context.closePath();

        context.fillStyle = segment.up ? UP_FILL : DOWN_FILL;
        context.fill();
      }
    });
  }
}

class BandPaneView implements IPrimitivePaneView {
  private segments: Segment[] = [];

  constructor(private readonly source: BandPrimitive) {}

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    if (!chart || !series) {
      this.segments = [];
      return;
    }

    const timeScale = chart.timeScale();
    const out: Segment[] = [];
    let current: Segment | null = null;

    for (const point of this.source.points) {
      const x = timeScale.timeToCoordinate(point.time);
      const upper = series.priceToCoordinate(point.upper);
      const lower = series.priceToCoordinate(point.lower);
      // Бар за пределами видимой области координат не имеет — обрываем полосу,
      // иначе она соединится через весь экран прямой.
      if (x === null || upper === null || lower === null) {
        current = null;
        continue;
      }

      // Смена стороны начинает новый сегмент: цвет заливки у них разный.
      if (!current || current.up !== point.up) {
        current = { points: [], up: point.up };
        out.push(current);
      }
      current.points.push({ x, upper, lower });
    }

    this.segments = out;
  }

  renderer() {
    return new BandRenderer(this.segments);
  }

  /** Заливка идёт под свечами, чтобы не перекрывать тела баров. */
  zOrder() {
    return "bottom" as const;
  }
}

export class BandPrimitive implements ISeriesPrimitive<Time> {
  points: BandPoint[] = [];
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;

  private readonly view = new BandPaneView(this);
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

  setPoints(points: BandPoint[]) {
    this.points = points;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}
