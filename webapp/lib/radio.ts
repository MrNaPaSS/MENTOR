"use client";

// Радио терминала: один плеер на всё приложение.
//
// Кнопка радио стоит в двух местах - в шапке кабинета и в полном экране
// терминала, где шапки нет. Это две кнопки, но плеер обязан быть один: свой
// <audio> у каждой означал бы второй поток поверх первого, и нажатие в полном
// экране включало бы вторую станцию, не выключив первую.
//
// Поэтому состояние живёт здесь, снаружи от React, а кнопки только смотрят на
// него и просят его измениться. Отсюда же музыку приглушает уведомление: звук
// события должен быть слышен, а не тонуть в бите.

/** Поток и его имя в списке. */
export type Station = { url: string; name: string };

export const STATIONS: readonly Station[] = [
  { url: "https://radio.promodj.com/klubb-192", name: "PromoDJ Klubb" },
  { url: "https://radio.promodj.com/fullmoon-192", name: "PromoDJ Full Moon" },
  { url: "https://radio.promodj.com/mini-192", name: "PromoDJ Mini" },
  { url: "https://play.sas-media.ru/play_256", name: "Noise FM" },
];

export type RadioMode = "off" | "loading" | "playing";

export type RadioState = {
  station: number;
  mode: RadioMode;
  volume: number;
  /** Есть ли настоящий разбор звука: без него пульс бьётся ровно. */
  live: boolean;
};

const KEY = "nmnh.radio";
const DEFAULT_VOLUME = 0.6;

/**
 * Станция, с которой радио открывается впервые.
 *
 * Ищем по адресу, а не по номеру в списке: список однажды переставят местами,
 * и номер молча выберет чужую станцию - ту, что окажется на этом месте.
 */
const DEFAULT_STATION = Math.max(
  0,
  STATIONS.findIndex((s) => s.url === "https://radio.promodj.com/mini-192"),
);

/**
 * Паузы перед возвратом на ту же станцию, миллисекунды.
 *
 * Живой поток обрывается не только когда станция умерла: хватает секунды без
 * связи или замершей на вкладке отрисовки, и браузер роняет на элемент ошибку
 * посреди песни. Перебор списка на таком обрыве проходил все станции за доли
 * секунды - каждая не отвечала по той же причине - и заканчивался выключенным
 * радио. Со стороны это выглядело так: перешёл в раздел, музыка встала.
 *
 * Поэтому оборвавшуюся станцию сперва возвращают. Пауза растёт: если связи нет
 * совсем, долбить поток четыре раза в секунду бессмысленно.
 */
const REVIVE_WAITS = [800, 2000, 5000, 12000];

/** До какой доли громкости приглушаем музыку под уведомление. */
const DUCK_TO = 0.25;
/** За сколько секунд громкость доезжает до цели: рывок слышен щелчком. */
const DUCK_FADE = 0.12;

/** Старые Safari прячут конструктор под своей приставкой. */
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let state: RadioState = {
  station: DEFAULT_STATION,
  mode: "off",
  volume: DEFAULT_VOLUME,
  live: false,
};
let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let buf: Uint8Array | null = null;
let duckUntil = 0;
let duckTimer: number | null = null;
let loaded = false;
/** Станция уже играла в этом включении - значит она живая, а связь пропала. */
let wasPlaying = false;
/** Сколько раз подряд её уже возвращали, не дождавшись звука. */
let revives = 0;
let reviveTimer: number | null = null;

const listeners = new Set<() => void>();

function emit(next: Partial<RadioState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function snapshot(): RadioState {
  return state;
}

/** На сервере радио не играет: снимок постоянный, иначе React уходит в цикл. */
const SERVER: RadioState = {
  station: DEFAULT_STATION,
  mode: "off",
  volume: DEFAULT_VOLUME,
  live: false,
};

export function serverSnapshot(): RadioState {
  return SERVER;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ station: state.station, volume: state.volume }));
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
  }
}

/**
 * Прочитать, что слушали в прошлый раз.
 *
 * Само радио при этом не включается: музыка, заигравшая от одного открытия
 * вкладки, - это то, что закрывают не глядя.
 */
export function restore(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as
      | { station?: unknown; volume?: unknown }
      | null;
    const station = Number(raw?.station);
    const volume = Number(raw?.volume);
    emit({
      station: Number.isInteger(station) && STATIONS[station] ? station : DEFAULT_STATION,
      volume: volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME,
    });
  } catch {
    // Не прочиталось - остаёмся на станции по умолчанию.
  }
}

function teardown(): void {
  if (reviveTimer !== null) {
    window.clearTimeout(reviveTimer);
    reviveTimer = null;
  }
  if (audio) {
    // Снимаем обработчики до остановки: сброс src сам по себе роняет на
    // элемент ошибку, а она у нас означает "поток не пошёл, пробуй иначе".
    audio.onplaying = null;
    audio.onerror = null;
    audio.onended = null;
    audio.pause();
    // Пустой src рвёт соединение. На одной паузе поток продолжал бы качаться
    // в фоне - мегабайты в час за музыку, которую никто не слушает.
    audio.removeAttribute("src");
    audio.load();
  }
  source?.disconnect();
  source = null;
  audio = null;
}

/**
 * Завести разбор звука для этого элемента.
 *
 * Узел источника делается на элемент один раз и навсегда, поэтому у каждого
 * включения свой <audio> и свой источник, а контекст с анализатором - общие.
 */
function graph(element: HTMLAudioElement): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return false;
    ctx = ctx ?? new Ctor();
    // Контекст рождается спящим: браузер будит его только по нажатию.
    void ctx.resume();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      buf = new Uint8Array(analyser.fftSize);
    }
    source = ctx.createMediaElementSource(element);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    return true;
  } catch {
    // Не собралось - играем мимо графа, без пульса, но со звуком.
    return false;
  }
}

function loudness(): number {
  return Date.now() < duckUntil ? state.volume * DUCK_TO : state.volume;
}

/**
 * Включить станцию.
 *
 * `tried` - те, что в этой попытке уже не пошли: по ним не ходим второй раз,
 * иначе перебор зациклится на мёртвом списке.
 */
function start(index: number, cors: boolean, tried: Set<number> = new Set()): void {
  teardown();
  const element = new Audio();
  element.preload = "none";
  element.volume = loudness();
  // Пульсу нужен доступ к самим отсчётам, а его даёт только CORS. Обе станции
  // заголовки отдают; если однажды перестанут - вторая попытка идёт без него.
  if (cors) element.crossOrigin = "anonymous";
  element.src = STATIONS[index].url;
  audio = element;
  emit({ station: index, mode: "loading", live: false });

  element.onplaying = () => {
    // Звук пошёл: станция живая, и запас возвратов ей полагается заново.
    wasPlaying = true;
    revives = 0;
    emit({ mode: "playing" });
  };

  /**
   * Станция не пошла.
   *
   * Сначала та же, но без CORS: с ним поток падает целиком, если станция не
   * отдала заголовки, - музыка важнее пульса. Не помогло - идём к следующей
   * станции списка.
   *
   * Молча выключаться нельзя. Станция может умолкнуть на неделю, а человек
   * жмёт пуск и не понимает, сломано радио или у него звук выключен. Играет
   * соседняя - вопрос снимается сам.
   */
  function failed() {
    // Станция играла и оборвалась - это не мёртвый поток, а провал связи.
    // Возвращаем её же, с паузой. Уходить по списку нельзя: человек выбрал эту
    // станцию, а пройдя список до конца, радио выключилось бы совсем.
    if (wasPlaying && revives < REVIVE_WAITS.length) {
      const wait = REVIVE_WAITS[revives++];
      teardown();
      // Не "off": радио не выключено, оно возвращается. Кнопка показывает
      // ожидание, а не пуск, и человек видит разницу между обрывом и тем, что
      // он сам нажал паузу.
      emit({ mode: "loading", live: false });
      reviveTimer = window.setTimeout(() => {
        reviveTimer = null;
        start(index, true, new Set());
      }, wait);
      return;
    }
    // Возвраты кончились - станция и правда молчит, идём по списку.
    wasPlaying = false;
    if (cors) {
      start(index, false, tried);
      return;
    }
    const dead = new Set(tried).add(index);
    // Следующая по кругу, начиная от той, что не пошла.
    for (let step = 1; step <= STATIONS.length; step++) {
      const next = (index + step) % STATIONS.length;
      if (!dead.has(next)) {
        start(next, true, dead);
        return;
      }
    }
    // Не отвечает ни одна - дело не в станции, а в связи.
    emit({ mode: "off", live: false });
  }

  element.onerror = failed;
  // Живой поток не кончается сам. Кончился - станция оборвалась, и это тот же
  // отказ, только посреди песни.
  element.onended = failed;

  const live = cors ? graph(element) : false;
  emit({ live });
  element.play().catch(failed);
}

export function toggle(): void {
  // Нажали руками - прошлые обрывы забываются: и при пуске, и при остановке.
  wasPlaying = false;
  revives = 0;
  if (state.mode === "off") start(state.station, true);
  else {
    teardown();
    emit({ mode: "off", live: false });
  }
}

export function pick(index: number): void {
  if (!STATIONS[index]) return;
  wasPlaying = false;
  revives = 0;
  emit({ station: index });
  save();
  // Станцию меняют обычно на ходу - переключаем, не заставляя жать пуск.
  // Перебор начинается заново: выбор руками отменяет прошлые неудачи.
  if (state.mode !== "off") start(index, true);
}

export function setVolume(next: number): void {
  const value = Math.min(1, Math.max(0, next));
  emit({ volume: value });
  if (audio) audio.volume = loudness();
  save();
}

/** Довести громкость до цели за несколько шагов, а не рывком. */
function ramp(element: HTMLAudioElement, to: number): void {
  const from = element.volume;
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    window.setTimeout(
      () => {
        // За время перехода станцию могли переключить - элемент уже не тот.
        if (element !== audio) return;
        element.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / steps));
      },
      (DUCK_FADE * 1000 * i) / steps,
    );
  }
}

/**
 * Приглушить музыку на время уведомления.
 *
 * Сигнал терминала короткий и негромкий - в клубном бите он тонет, а именно он
 * и сообщает, что взята цель или выбило стопом. На эти полсекунды музыка
 * отходит на задний план и возвращается сама.
 */
export function duck(ms = 900): void {
  if (!audio || state.mode === "off") return;
  duckUntil = Math.max(duckUntil, Date.now() + ms);
  ramp(audio, state.volume * DUCK_TO);
  if (duckTimer !== null) window.clearTimeout(duckTimer);
  duckTimer = window.setTimeout(
    () => {
      duckTimer = null;
      duckUntil = 0;
      if (audio) ramp(audio, state.volume);
    },
    Math.max(0, duckUntil - Date.now()),
  );
}

/**
 * Форма волны прямо сейчас, разложенная по длине переданного массива.
 *
 * Значения от -1 до 1. Каждая точка - среднее по своему отрезку отсчётов, а не
 * один взятый наугад: двадцать шесть точек из двухсот пятидесяти шести иначе
 * скакали бы от кадра к кадру, и линия дрожала бы вместо того, чтобы двигаться.
 *
 * `false` означает, что слушать нечем - не играет или отсчётов не видно.
 */
export function waveform(into: Float32Array): boolean {
  if (state.mode !== "playing" || !state.live || !analyser || !buf) return false;
  analyser.getByteTimeDomainData(buf);
  const step = buf.length / into.length;
  for (let i = 0; i < into.length; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j++) sum += (buf[j] - 128) / 128;
    into[i] = sum / (to - from);
  }
  return true;
}

/**
 * Громкость текущего мгновения, 0..1.
 *
 * `null` означает, что слушать нечем: либо не играет, либо отсчётов не видно.
 * Пульс в этом случае бьётся ровно и честно говорит, что музыки не слышит.
 */
export function level(): number | null {
  if (state.mode !== "playing" || !state.live || !analyser || !buf) return null;
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const d = (buf[i] - 128) / 128;
    sum += d * d;
  }
  // Корень от корня: тихие места иначе лежат в ноль, а музыка редко подходит
  // к самому верху шкалы.
  return Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.15);
}
