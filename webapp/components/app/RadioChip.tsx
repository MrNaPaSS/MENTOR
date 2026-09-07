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

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Music, Pause, Play } from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";
import {
  STATIONS,
  level,
  pick,
  restore,
  serverSnapshot,
  setVolume,
  snapshot,
  subscribe,
  toggle,
} from "@/lib/radio";

/**
 * Пульс: ширина в пикселях - она же длина памяти, по столбику на кадр.
 *
 * Двадцать шесть кадров - меньше полусекунды звука. Больше растянуло бы линию
 * в неразборчивую щетину, меньше - и удар не успевает проехать по экрану.
 */
const PULSE_W = 26;
const PULSE_H = 14;

export default function RadioChip({ tone }: { tone?: "site" | "pane" }) {
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

      const now = level();
      let value = 0;
      if (now !== null) value = now;
      else if (!off) {
        // Играем, но отсчётов не видим - ровное сердцебиение раз в секунду.
        // Врать про громкость нечем, а показать, что звук идёт, надо.
        const phase = (tick % 60) / 60;
        value = phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) * 0.75 : 0;
      }

      history.copyWithin(0, 1);
      history[PULSE_W - 1] = value;

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
    radio.mode === "off" ? `Радио - ${now.name}` : `${now.name} - нажмите, чтобы выключить`;

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
        title={`${now.name} - сменить станцию`}
        // Подпись называет станцию по имени: aria-label перекрывает title, и
        // без имени в озвучке оставалось бы «выбрать станцию» без ответа на
        // вопрос, какая играет сейчас.
        aria-label={`Станция ${now.name} - сменить станцию`}
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
            <span className={`text-[10px] uppercase tracking-wider ${idle}`}>звук</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={radio.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ accentColor: pane ? "var(--pane-accent)" : "var(--c-accent)" }}
              className="h-1 flex-1 cursor-pointer"
              aria-label="Громкость радио"
            />
          </div>
        </div>
      )}
    </div>
  );
}
