"use client";

// Кнопка радио: пуск и живой пульс рядом со знаком NMNH.
//
// За терминалом сидят часами, и музыку всё равно включают - в соседней вкладке,
// которую потом ищут по всему браузеру, когда рынок пошёл и надо приглушить.
// Здесь она под рукой и почти не занимает места.
//
// Сам плеер живёт в lib/radio: кнопок две - в шапке кабинета и в полном экране
// терминала, - а поток обязан быть один. Здесь только вид.
//
// Готовый виджет радиостанции сюда не встроен намеренно. Он приносит свой CSS,
// свою вёрстку и баннер со ссылкой наружу, и всё это пришлось бы перебивать
// через !important, а после каждого их обновления перебивать заново. От него
// взято единственное, что там своё, - адреса потоков.

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Music, Pause, Play } from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";
import {
  STATIONS,
  pick,
  restore,
  serverSnapshot,
  setVolume,
  snapshot,
  subscribe,
  toggle,
  waveform,
} from "@/lib/radio";

/** Пульс: размер полоски в пикселях. */
const PULSE_W = 26;
const PULSE_H = 14;

/**
 * Размах: во сколько раз форма волны растягивается по высоте.
 *
 * Отсчёты потока редко подходят к краям шкалы, и без растяжения линия едва
 * подрагивала. Верх всё равно ограничен окном и обрезкой, поэтому громкое место
 * упирается в потолок полоски - это и нужно: удар должен читаться как удар.
 */
const SWING = 4.6;

/**
 * Насколько быстро линия тянется к новой форме, доля за кадр.
 *
 * Меньше - вязко, рывок размазывается в плавную волну. Больше - дрожь: за кадр
 * звук меняется целиком, и линия начинает трястись вместо движения.
 */
const SNAP = 0.55;

export default function RadioChip({ tone }: { tone?: "site" | "pane" }) {
  const t = useT();
  const theme = useTerminalTheme();
  const radio = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [menu, setMenu] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => restore(), []);

  // Нажатие мимо закрывает список станций: меню, которое не уходит само,
  // остаётся висеть поверх графика и мешает работать.
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
  // Линия стоит на месте, а шевелится её середина - как жилка под кожей. Форма
  // волны приходит с ленты каждый кадр и умножается на оконный множитель: он
  // равен нулю на краях, поэтому первая и последняя точка прибиты к базовому
  // уровню, что бы ни играло.
  //
  // Раньше линия ехала влево: память сдвигалась на пиксель за кадр, и вместе с
  // серединой двигались оба конца. Полоска в двадцать шесть пикселей от этого
  // читалась как убегающий хвост, а не как признак жизни.
  //
  // Столбиков эквалайзера здесь намеренно нет - в шапке с бегущей строкой и
  // цифрами ещё один частокол читался бы как сбой.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PULSE_W * dpr;
    canvas.height = PULSE_H * dpr;
    ctx.scale(dpr, dpr);

    // Форма линии: то, что рисуем, и то, что пришло с ленты. Между ними
    // сглаживание - без него линия дрожала бы, а не двигалась.
    const shape = new Float32Array(PULSE_W);
    const raw = new Float32Array(PULSE_W);
    // Оконный множитель: ноль на краях, единица в середине. Он и прибивает
    // концы линии к базовому уровню - что бы ни играло, начало и конец стоят
    // на месте, а живёт только середина.
    const taper = new Float32Array(PULSE_W);
    for (let x = 0; x < PULSE_W; x++) {
      taper[x] = Math.sin((Math.PI * x) / (PULSE_W - 1)) ** 2;
    }
    const mid = PULSE_H / 2;
    const amp = mid - 1.5;
    const off = radio.mode === "off";
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
        const name = off ? "--c-muted" : "--c-accent";
        color = root.getPropertyValue(name).trim() || "#0affe0";
      }

      if (waveform(raw)) {
        // Своя форма волны. Тянемся к ней, а не прыгаем: за кадр звук успевает
        // измениться целиком, и без сглаживания вместо движения выходит рябь.
        for (let x = 0; x < PULSE_W; x++) shape[x] += (raw[x] * SWING - shape[x]) * SNAP;
      } else if (!off) {
        // Играем, но отсчётов не видим - ровное сердцебиение раз в секунду.
        // Врать про громкость нечем, а показать, что звук идёт, надо.
        const phase = (tick % 60) / 60;
        const beat = phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) * 0.8 : 0;
        for (let x = 0; x < PULSE_W; x++) shape[x] += (beat - shape[x]) * SNAP;
      }
      // Выключено - форма так и остаётся нулевой, и линия выходит прямой.
      // Отдельная ветка ей не нужна: эффект пересоздаётся на смене состояния, и
      // массив приходит чистым.

      ctx.clearRect(0, 0, PULSE_W, PULSE_H);
      ctx.beginPath();
      for (let x = 0; x < PULSE_W; x++) {
        // Окно решает, насколько точке позволено отойти от базовой линии: на
        // краях ноль, поэтому первая и последняя стоят ровно на ней.
        const swing = Math.max(-1, Math.min(1, shape[x])) * taper[x];
        const y = mid - swing * amp;
        if (x === 0) ctx.moveTo(x + 0.5, y);
        else ctx.lineTo(x + 0.5, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Без свечения. Ореол вокруг линии размывал её края в туман, и в ряду
      // чётких значков шапки пульс выглядел не элементом интерфейса, а
      // подсвеченной наклейкой поверх него.
      ctx.stroke();

      tick++;
      if (!off) frame = requestAnimationFrame(paint);
    }

    // Молчащий пульс - ровная линия: рисуем один раз и отпускаем кадры.
    // Крутить анимацию ради неподвижной черты в торговом терминале не за что.
    paint();
    return () => cancelAnimationFrame(frame);
  }, [radio.mode, theme]);

  // В полном экране терминала палитра своя - панельная: там знак стоит на
  // белом листе светлой темы, и цвета шапки сайта на нём не читаются.
  //
  // Классы пишутся целиком в обеих ветках, а не собираются из кусков: Tailwind
  // ищет их в исходнике текстом, и `hover:${переменная}` в сборку не попадёт.
  const pane = tone === "pane";
  const idle = pane ? "text-[var(--pane-muted)]" : "text-text-muted";
  const hot = pane ? "text-[var(--pane-accent)]" : "text-accent-cyan";
  const button = pane
    ? "text-[var(--pane-muted)] hover:text-[var(--pane-accent)]"
    : "text-text-muted hover:text-accent-cyan";
  const card = pane
    ? "border-[var(--pane-border)] bg-[var(--pane-bg)]"
    : "border-border bg-bg-card";

  const now = STATIONS[radio.station];
  const label =
    radio.mode === "off" ? t.shell.radio.play(now.name) : t.shell.radio.stop(now.name);

  return (
    <div ref={boxRef} className="relative hidden items-center md:flex">
      <button
        onClick={toggle}
        title={label}
        aria-label={label}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 ${button}`}
      >
        {radio.mode === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : radio.mode === "playing" ? (
          <Pause className={`h-3.5 w-3.5 ${hot}`} />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Пульс - он же вход в список станций: отдельная стрелка рядом с двумя
          значками была бы третьим элементом там, где хватает двух. */}
      <button
        onClick={() => setMenu((v) => !v)}
        title={t.shell.radio.change(now.name)}
        // Подпись называет станцию по имени: aria-label перекрывает title, и
        // без имени в озвучке оставалось бы «выбрать станцию» без ответа на
        // вопрос, какая играет сейчас.
        aria-label={t.shell.radio.changeAria(now.name)}
        className="rounded px-0.5 py-1 opacity-80 transition-opacity duration-150 hover:opacity-100"
      >
        <canvas ref={canvasRef} style={{ width: PULSE_W, height: PULSE_H }} className="block" />
      </button>

      {menu && (
        <div
          className={`absolute left-0 top-9 z-50 w-52 overflow-hidden rounded-xl border py-1 shadow-xl ${card}`}
        >
          {STATIONS.map((s, i) => (
            <button
              key={s.url}
              onClick={() => {
                pick(i);
                setMenu(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                i === radio.station
                  ? hot
                  : pane
                    ? "text-[var(--pane-text-2)] hover:bg-[var(--pane-hover)]"
                    : "text-text-secondary hover:bg-bg-panel"
              }`}
            >
              <Music className="h-3 w-3 shrink-0 opacity-60" />
              {s.name}
            </button>
          ))}

          <div
            className={`mt-1 flex items-center gap-2 border-t px-3 pb-1 pt-2 ${
              pane ? "border-[var(--pane-border)]" : "border-border"
            }`}
          >
            <span className={`text-[10px] uppercase tracking-wider ${idle}`}>{t.shell.radio.volume}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={radio.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ accentColor: pane ? "var(--pane-accent)" : "var(--c-accent)" }}
              // min-w-0: у ползунка своя внутренняя ширина, а флекс-элемент по
              // умолчанию не сжимается меньше неё - от этого он и вылезал за
              // край ярлыка. w-full заставляет его брать ровно то, что дали.
              className="h-1 w-full min-w-0 shrink cursor-pointer"
              aria-label={t.shell.radio.volumeAria}
            />
          </div>
        </div>
      )}
    </div>
  );
}
