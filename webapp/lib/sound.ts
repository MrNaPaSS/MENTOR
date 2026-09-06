// Звуки терминала.
//
// Скальпер смотрит в стакан, а не в ярлык позиции: цель может взяться, пока он
// разглядывает другую монету. Звук сообщает о событии, не требуя взгляда, — это
// его единственная задача, поэтому сигналы короткие и разные на слух.
//
// Тоны синтезируются, а не грузятся файлами: файл — это ещё один запрос,
// который может не дойти, и лишний вес в сборке ради полусекунды писка.
// Заодно ничего не нужно раздавать со стороннего домена.
//
// Браузер не даёт играть до первого действия пользователя, поэтому звуковой
// контекст создаётся лениво — на первом же событии после клика он уже готов.

export type SoundKind =
  /** Заявка ушла на биржу. */
  | "order"
  /** Цена дошла до уровня, позиция набрана. */
  | "entry"
  /** Взята цель. */
  | "take"
  /** Сделка отработала полностью. */
  | "profit"
  /** Сработал стоп. */
  | "stop"
  /** Позиция зафиксирована руками. */
  | "close"
  /** Биржа отказала. */
  | "error";

type Tone = {
  /** Частоты по порядку: одна нота или короткая последовательность. */
  notes: number[];
  /** Длительность одной ноты, секунды. */
  step: number;
  type: OscillatorType;
  gain: number;
};

// Смысл слышен без объяснений: вход — вверх, стоп — вниз, ошибка — резко и
// низко. Прибыль отличается от простой цели тем, что заканчивается выше.
const TONES: Record<SoundKind, Tone> = {
  order: { notes: [880], step: 0.05, type: "triangle", gain: 0.05 },
  entry: { notes: [660, 880], step: 0.07, type: "triangle", gain: 0.07 },
  take: { notes: [880, 1175], step: 0.08, type: "sine", gain: 0.07 },
  profit: { notes: [880, 1175, 1568], step: 0.09, type: "sine", gain: 0.08 },
  stop: { notes: [440, 330], step: 0.1, type: "sine", gain: 0.07 },
  close: { notes: [587, 440], step: 0.08, type: "triangle", gain: 0.06 },
  error: { notes: [220, 220], step: 0.12, type: "square", gain: 0.05 },
};

let context: AudioContext | null = null;
let muted = false;

/** Включить или выключить звук. Состояние хранит вызывающий. */
export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (context === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    // После бездействия вкладки контекст засыпает и играет в тишину.
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    // Звук — не то, ради чего стоит ронять терминал.
    return null;
  }
}

/**
 * Проиграть сигнал.
 *
 * Ничего не ждёт и ничего не возвращает: звук либо прозвучал, либо нет, и
 * второе не должно мешать работе.
 */
export function play(kind: SoundKind): void {
  if (muted) return;
  const ctx = ensureContext();
  if (!ctx) return;

  const tone = TONES[kind];
  const start = ctx.currentTime;

  tone.notes.forEach((frequency, i) => {
    const at = start + i * tone.step;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = tone.type;
    osc.frequency.setValueAtTime(frequency, at);

    // Мгновенное включение и выключение даёт щелчок, поэтому короткие спады.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(tone.gain, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.step);

    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + tone.step + 0.02);
  });
}
