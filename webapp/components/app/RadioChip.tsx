"use client";

// Радио в шапке кабинета - рядом со знаком NMNH.
//
// За терминалом сидят часами, и музыку всё равно включают: в соседней вкладке,
// которую потом ищут по всему браузеру, когда рынок пошёл и надо приглушить.
// Здесь она под рукой и почти не занимает места: кнопка размером с остальные
// значки шапки и живой пульс рядом.
//
// Готовый виджет радиостанции сюда не встроен намеренно. Он приносит свой CSS,
// свою вёрстку и баннер со ссылкой наружу - и всё это пришлось бы перебивать
// через !important, а после каждого их обновления перебивать заново. От него
// взято единственное, что там своё, - адреса потоков. Дальше хватает обычного
// <audio>, и он наш до последнего пикселя.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Music, Pause, Play } from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";

/** Поток и его имя в списке. */
type Station = { url: string; name: string };

const STATIONS: readonly Station[] = [
  { url: "https://radio.promodj.com/klubb-192", name: "PromoDJ Klubb" },
  { url: "https://radio.promodj.com/fullmoon-192", name: "PromoDJ Full Moon" },
  { url: "https://radio.promodj.com/mini-192", name: "PromoDJ Mini" },
  { url: "https://play.sas-media.ru/play_256", name: "Noise FM" },
];

const KEY = "nmnh.radio";

/**
 * Пульс: ширина в пикселях - она же длина памяти, по столбику на кадр.
 *
 * Двадцать шесть кадров - меньше полусекунды звука. Больше растянуло бы линию
 * в неразборчивую щетину, меньше - и удар не успевает проехать по экрану.
 */
const PULSE_W = 26;
const PULSE_H = 14;

/** Старые Safari прячут конструктор под своей приставкой. */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

type Saved = { station: number; volume: number };

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<Saved> | null;
    const station = Number(raw?.station);
    const volume = Number(raw?.volume);
    return {
      station: Number.isInteger(station) && STATIONS[station] ? station : 0,
      volume: volume >= 0 && volume <= 1 ? volume : 0.6,
    };
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return { station: 0, volume: 0.6 };
  }
}

export default function RadioChip() {
  const theme = useTerminalTheme();
  const [station, setStation] = useState(0);
  const [state, setState] = useState<"off" | "loading" | "playing">("off");
  const [menu, setMenu] = useState(false);
  const [volume, setVolume] = useState(0.6);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null);
  // Есть ли настоящий разбор звука. Без него пульс бьётся ровно - и честно
  // говорит об этом подписью, а не притворяется, что слышит музыку.
  const liveRef = useRef(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Что слушали в прошлый раз. Само радио не включаем: музыка, заигравшая от
  // одного открытия вкладки, - это то, что закрывают не глядя.
  useEffect(() => {
    const saved = read();
    setStation(saved.station);
    setVolume(saved.volume);
  }, []);

  const teardown = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Снимаем обработчики до остановки: сброс src сам по себе роняет на
      // элемент ошибку, а она у нас означает "поток не пошёл, пробуй иначе".
      audio.onplaying = null;
      audio.onerror = null;
      audio.pause();
      // Пустой src рвёт соединение. На одной паузе поток продолжал качаться в
      // фоне - мегабайты в час за музыку, которую никто не слушает.
      audio.removeAttribute("src");
      audio.load();
    }
    srcRef.current?.disconnect();
    srcRef.current = null;
    audioRef.current = null;
    liveRef.current = false;
  }, []);

  /**
   * Завести разбор звука для этого элемента.
   *
   * Узел источника делается на элемент один раз и навсегда, поэтому у каждого
   * включения свой <audio> и свой источник, а анализатор с контекстом - общие.
   */
  const graph = useCallback((audio: HTMLAudioElement): boolean => {
    try {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = ctxRef.current ?? new Ctor();
      ctxRef.current = ctx;
      // Контекст рождается спящим: браузер будит его только по нажатию.
      void ctx.resume();
      const analyser = analyserRef.current ?? ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      analyserRef.current = analyser;
      const src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      srcRef.current = src;
      return true;
    } catch {
      // Не собралось - значит играем мимо графа, без пульса, но со звуком.
      return false;
    }
  }, []);

  const start = useCallback(
    function start(index: number, cors: boolean) {
      teardown();
      const audio = new Audio();
      audio.preload = "none";
      audio.volume = volumeRef.current;
      // Пульсу нужен доступ к самим отсчётам, а его даёт только CORS. Обе
      // станции заголовки отдают; если однажды перестанут - вторая попытка
      // пойдёт без него.
      if (cors) audio.crossOrigin = "anonymous";
      audio.src = STATIONS[index].url;
      audioRef.current = audio;
      setState("loading");

      audio.onplaying = () => setState("playing");
      audio.onerror = () => {
        // Поток не пошёл. С CORS он падает целиком, если станция не отдала
        // заголовки, - тогда пробуем ещё раз без него: музыка важнее картинки.
        if (cors) start(index, false);
        else setState("off");
      };

      if (cors) liveRef.current = graph(audio);
      audio.play().catch(() => {
        if (cors) start(index, false);
        else setState("off");
      });
    },
    [graph, teardown],
  );

  // Уходя со страницы, гасим и звук, и контекст: вкладка кабинета закрывается
  // вместе с музыкой, а не оставляет её играть в невидимом элементе.
  useEffect(() => {
    return () => {
      teardown();
      void ctxRef.current?.close();
      ctxRef.current = null;
      analyserRef.current = null;
    };
  }, [teardown]);

  function toggle() {
    if (state === "off") start(station, true);
    else {
      teardown();
      setState("off");
    }
  }

  function pick(index: number) {
    setStation(index);
    setMenu(false);
    save({ station: index, volume: volumeRef.current });
    // Меняют станцию обычно на ходу - переключаем, не заставляя жать play.
    if (state !== "off") start(index, true);
  }

  function setLoudness(next: number) {
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
    save({ station, volume: next });
  }

  // Нажатие мимо закрывает список станций: меню, которое не уходит само,
  // остаётся висеть поверх шапки и мешает работать.
  useEffect(() => {
    if (!menu) return;
    function away(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setMenu(false);
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  // ── Пульс ────────────────────────────────────────────────────────────────
  //
  // Линия кардиомонитора: каждый кадр справа дописывается громкость текущего
  // мгновения, а вся память едет на пиксель влево. Столбиков эквалайзера здесь
  // намеренно нет - в шапке с бегущей строкой и цифрами ещё один частокол
  // читался бы как сбой, а одна живая линия читается как признак жизни.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PULSE_W * dpr;
    canvas.height = PULSE_H * dpr;
    ctx.scale(dpr, dpr);

    const history = new Float32Array(PULSE_W);
    const buf = new Uint8Array(analyserRef.current?.fftSize ?? 256);
    const mid = PULSE_H / 2;
    const amp = mid - 1.5;
    let frame = 0;
    let tick = 0;
    let color = "";

    function paint() {
      if (!canvas || !ctx) return;
      // Цвет акцента читаем не каждый кадр: обращение к стилям заставляет
      // браузер пересчитывать их целиком. Дважды в секунду - незаметно для
      // глаза и бесплатно для кадра.
      if (tick % 30 === 0) {
        const root = getComputedStyle(document.documentElement);
        color =
          (state === "off" ? root.getPropertyValue("--c-muted") : root.getPropertyValue("--c-accent")).trim() ||
          "#0affe0";
      }

      const analyser = analyserRef.current;
      let level = 0;
      if (state === "playing" && liveRef.current && analyser) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = (buf[i] - 128) / 128;
          sum += d * d;
        }
        // Корень от корня: тихие места иначе лежат в ноль, а музыка редко
        // подходит к самому верху шкалы.
        level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.15);
      } else if (state !== "off") {
        // Играем, но отсчётов не видим - ровное сердцебиение раз в секунду.
        // Врать про громкость нечем, а показать, что звук идёт, надо.
        const phase = (tick % 60) / 60;
        level = phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) * 0.75 : 0;
      }

      history.copyWithin(0, 1);
      history[PULSE_W - 1] = level;

      ctx.clearRect(0, 0, PULSE_W, PULSE_H);
      ctx.beginPath();
      for (let x = 0; x < PULSE_W; x++) {
        const y = mid - history[x] * amp;
        if (x === 0) ctx.moveTo(x + 0.5, y);
        else ctx.lineTo(x + 0.5, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Свечение только когда играет: у погасшей линии оно смотрелось бы
      // включённым радио.
      ctx.shadowBlur = state === "playing" ? 4 : 0;
      ctx.shadowColor = color;
      ctx.stroke();

      tick++;
      if (state !== "off") frame = requestAnimationFrame(paint);
    }

    // Молчащий пульс - ровная линия: рисуем один раз и отпускаем кадры.
    // Крутить анимацию ради неподвижной черты в торговом терминале не за что.
    paint();
    return () => cancelAnimationFrame(frame);
  }, [state, theme]);

  const now = STATIONS[station];
  const label =
    state === "off" ? `Радио - ${now.name}` : `${now.name} - нажмите, чтобы выключить`;

  return (
    <div ref={boxRef} className="relative hidden items-center md:flex">
      <button
        onClick={toggle}
        title={label}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:text-accent-cyan"
      >
        {state === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "playing" ? (
          <Pause className="h-3.5 w-3.5 text-accent-cyan" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Пульс - он же вход в список станций: отдельная стрелка рядом с двумя
          значками была бы третьим элементом там, где хватает двух. */}
      <button
        onClick={() => setMenu((v) => !v)}
        title={`${now.name} - сменить станцию`}
        // Подпись называет station по имени: aria-label перекрывает title, и
        // без имени в озвучке оставалось бы «выбрать станцию» без ответа на
        // вопрос, какая играет сейчас.
        aria-label={`Станция ${now.name} - сменить станцию`}
        className="rounded px-0.5 py-1 opacity-80 transition-opacity duration-150 hover:opacity-100"
      >
        <canvas
          ref={canvasRef}
          style={{ width: PULSE_W, height: PULSE_H }}
          className="block"
        />
      </button>

      {menu && (
        <div className="absolute left-0 top-9 z-50 w-52 overflow-hidden rounded-xl border border-border bg-bg-card py-1 shadow-xl">
          {STATIONS.map((s, i) => (
            <button
              key={s.url}
              onClick={() => pick(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-panel ${
                i === station ? "text-accent-cyan" : "text-text-secondary"
              }`}
            >
              <Music className="h-3 w-3 shrink-0 opacity-60" />
              {s.name}
            </button>
          ))}

          <div className="mt-1 flex items-center gap-2 border-t border-border px-3 pb-1 pt-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">звук</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setLoudness(Number(e.target.value))}
              style={{ accentColor: "var(--c-accent)" }}
              className="h-1 flex-1 cursor-pointer"
              aria-label="Громкость радио"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function save(next: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Не сохранилось - в этой вкладке станция всё равно играет.
  }
}
