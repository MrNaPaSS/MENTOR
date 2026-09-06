// Свечи, нарисованные своей рукой: ширина каждой зависит от её объёма.
//
// Библиотека рисует все свечи одинаковыми - ширина у неё общая на серию, и
// поменять её у одной свечи нельзя. Поэтому в этом режиме встроенная серия
// становится прозрачной, а свечи рисует примитив: он видит и время, и цену, и
// шаг сетки, а значит может дать каждой свою толщину.
//
// Сама серия при этом остаётся на месте - на ней держатся автомасштаб,
// перекрестие и подпись последней цены.

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
import type { Candle } from "@/lib/indicator/types";
import { candleWidth, referenceVolume } from "@/lib/indicator/volumeCandles";

export type CandlePalette = {
  up: string;
  down: string;
  upWick: string;
  downWick: string;
  /**
   * Обводка тела. Пусто - без неё.
   *
   * На светлой теме свеча роста белая, и без обводки её просто нет на белом
   * листе: видно только фитиль, торчащий из пустоты.
   */
  upBorder?: string;
  downBorder?: string;
};

type Ready = {
  x: number;
  width: number;
  open: number;
  close: number;
  high: number;
  low: number;
  rising: boolean;
}[];

class VolumeCandlesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly bars: Ready,
    private readonly palette: CandlePalette,
  ) {}

  draw(target: {
    useBitmapCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D;
        horizontalPixelRatio: number;
        verticalPixelRatio: number;
      }) => void,
    ) => void;
  }) {
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hx, verticalPixelRatio: vy }) => {
      for (const bar of this.bars) {
        const body = bar.rising ? this.palette.up : this.palette.down;
        const wick = bar.rising ? this.palette.upWick : this.palette.downWick;
        const x = bar.x * hx;
        const width = Math.max(1, bar.width * hx);

        // Фитиль по центру свечи и всегда тонкий: он говорит, куда цена
        // ходила, а не сколько за этим стояло денег.
        context.strokeStyle = wick;
        context.lineWidth = Math.max(1, hx);
        context.beginPath();
        context.moveTo(x, bar.high * vy);
        context.lineTo(x, bar.low * vy);
        context.stroke();

        const top = Math.min(bar.open, bar.close) * vy;
        const bottom = Math.max(bar.open, bar.close) * vy;
        const height = Math.max(bottom - top, vy);
        const left = x - width / 2;

        context.fillStyle = body;
        // Доджи рисуем чертой: тело нулевой высоты просто исчезло бы.
        context.fillRect(left, top, width, height);

        const border = bar.rising ? this.palette.upBorder : this.palette.downBorder;
        if (border) {
          // Обводка внутрь: линия по краю прямоугольника съедала бы полпикселя
          // с каждой стороны, и тонкие свечи выглядели бы толще соседей.
          context.strokeStyle = border;
          context.lineWidth = Math.max(1, hx);
          const inset = context.lineWidth / 2;
          context.strokeRect(left + inset, top + inset, Math.max(width - context.lineWidth, 0), Math.max(height - context.lineWidth, 0));
        }
      }
    });
  }
}

class VolumeCandlesPaneView implements IPrimitivePaneView {
  private ready: Ready = [];

  constructor(private readonly source: VolumeCandlesPrimitive) {}

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    const candles = this.source.candles;
    if (!chart || !series || candles.length === 0) {
      this.ready = [];
      return;
    }

    const scale = chart.timeScale();
    const spacing = scale.options().barSpacing;
    const width = scale.width();

    // Опору считаем по всей загруженной истории, а не по видимому окну: иначе
    // толщина свечей менялась бы от прокрутки, и одна и та же свеча выглядела
    // бы то мощной, то пустой.
    const reference = this.source.reference;

    const bars: Ready = [];
    for (const candle of candles) {
      const x = scale.timeToCoordinate(candle.time as Time);
      if (x === null || x < -spacing || x > width + spacing) continue;

      const open = series.priceToCoordinate(candle.open);
      const close = series.priceToCoordinate(candle.close);
      const high = series.priceToCoordinate(candle.high);
      const low = series.priceToCoordinate(candle.low);
      if (open === null || close === null || high === null || low === null) continue;

      bars.push({
        x,
        width: candleWidth(candle.volume, reference, spacing),
        open,
        close,
        high,
        low,
        rising: candle.close >= candle.open,
      });
    }
    this.ready = bars;
  }

  renderer() {
    return new VolumeCandlesRenderer(this.ready, this.source.palette);
  }

  /** Поверх фигур индикатора, но под метками: свечи это данные. */
  zOrder() {
    return "normal" as const;
  }
}

export class VolumeCandlesPrimitive implements ISeriesPrimitive<Time> {
  candles: Candle[] = [];
  reference = 0;
  palette: CandlePalette = { up: "#0ECB81", down: "#F6465D", upWick: "#0ECB81", downWick: "#F6465D" };
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;

  private readonly view = new VolumeCandlesPaneView(this);
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

  setData(candles: Candle[], palette: CandlePalette) {
    this.candles = candles;
    this.palette = palette;
    this.reference = referenceVolume(candles.map((c) => c.volume));
    this.requestUpdate?.();
  }

  clear() {
    this.candles = [];
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}
