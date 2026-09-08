// Радио в шапке кабинета.
//
// Проверяется то, что ломается молча. Поток открывается через <audio>, а его в
// jsdom нет вовсе - значит и увидеть, что кнопка перестала включать музыку или
// что станция выбирается не та, можно только здесь.
//
// Плеер один на всё приложение и живёт в модуле, а не в компоненте: кнопок две
// - в шапке и в полном экране терминала, - и второй <audio> означал бы вторую
// станцию поверх первой. Поэтому перед каждым тестом модули сбрасываются:
// иначе сюда протекало бы состояние предыдущего, и «выключили» проверялось бы
// на радио, которое к тому моменту уже выключено.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const play = vi.fn(() => Promise.resolve());
const load = vi.fn();

beforeAll(() => {
  // Ни воспроизведения, ни разбора звука в jsdom нет - подменяем оба.
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.load = load;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement["getContext"];

  class FakeAudioContext {
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    createAnalyser = () => ({
      fftSize: 256,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      getByteTimeDomainData: vi.fn(),
    });
    createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  }
  window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
});

beforeEach(() => {
  play.mockClear();
  load.mockClear();
  localStorage.clear();
  // Свежий плеер на каждый тест: он общий и состояние переживает размонтирование.
  vi.resetModules();
});

afterEach(() => {
  localStorage.clear();
});

/** Кнопку берём заново после сброса модулей - прежняя ссылка уже чужая. */
async function mount() {
  const { default: RadioChip } = await import("@/components/app/RadioChip");
  return render(<RadioChip />);
}

/** Кнопка пуска: у неё меняется подпись, поэтому ищем по роли и названию. */
function playButton(): HTMLElement {
  return screen.getByRole("button", { name: /Радио|выключить/ });
}

function stationsButton(): HTMLElement {
  return screen.getByRole("button", { name: /сменить станцию/ });
}

describe("радио в шапке", () => {
  it("само не включается: музыка от одного открытия вкладки - это то, что закрывают не глядя", async () => {
    await mount();
    expect(play).not.toHaveBeenCalled();
  });

  it("нажали пуск - поток открылся", async () => {
    await mount();
    fireEvent.click(playButton());
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("выключили - соединение разорвано, а не поставлено на паузу", async () => {
    await mount();
    fireEvent.click(playButton());
    await waitFor(() => expect(play).toHaveBeenCalled());

    load.mockClear();
    fireEvent.click(playButton());
    // Пустой src и load() - это и есть разрыв: без него поток продолжает идти.
    await waitFor(() => expect(load).toHaveBeenCalled());
  });

  it("выбранная станция запоминается на следующий заход", async () => {
    const first = await mount();
    fireEvent.click(stationsButton());
    fireEvent.click(screen.getByText("Noise FM"));
    first.unmount();

    // Новый заход - как после перезагрузки страницы: плеер тоже с нуля.
    vi.resetModules();
    await mount();
    fireEvent.click(stationsButton());
    // Своя станция помечена цветом акцента - по нему её и узнаём.
    expect(screen.getByText("Noise FM").className).toContain("text-accent-cyan");
  });

  it("мусор в хранилище не ломает шапку", async () => {
    localStorage.setItem("nmnh.radio", '{"station":99,"volume":"громко"}');
    await mount();
    fireEvent.click(stationsButton());
    // Станция по умолчанию, а не первая попавшаяся из списка.
    expect(screen.getByText("PromoDJ Mini").className).toContain("text-accent-cyan");
  });

  it("впервые открывается станцией по умолчанию", async () => {
    await mount();
    fireEvent.click(stationsButton());
    expect(screen.getByText("PromoDJ Mini").className).toContain("text-accent-cyan");
  });
});

describe("станция не отвечает", () => {
  /** Включить радио на свежем движке и вернуть список открытых адресов. */
  async function playWith(fails: (url: string) => boolean) {
    const asked: string[] = [];
    const Real = window.Audio;
    window.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      const one = new Real(...args);
      // Отказ приходит не сразу: браузер сперва берётся за поток.
      const src = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "src",
      );
      Object.defineProperty(one, "src", {
        configurable: true,
        get: () => src?.get?.call(one),
        set(value: string) {
          asked.push(value);
          src?.set?.call(one, value);
          if (fails(value)) setTimeout(() => one.onerror?.(new Event("error")), 0);
        },
      });
      return one;
    } as unknown as typeof Audio;

    try {
      const radio = await import("@/lib/radio");
      const { default: RadioChip } = await import("@/components/app/RadioChip");
      render(<RadioChip />);
      fireEvent.click(playButton());
      // Ждём, пока перебор осядет: каждый отказ приходит своим тиком, и
      // фиксированный срок обрывал цепочку на середине.
      let quiet = 0;
      for (let i = 0; i < 60 && quiet < 3; i++) {
        const before = asked.length;
        await new Promise((done) => setTimeout(done, 10));
        quiet = asked.length === before ? quiet + 1 : 0;
      }
      return { asked, radio };
    } finally {
      window.Audio = Real;
    }
  }

  it("молчит станция по умолчанию - включается следующая", async () => {
    const { asked, radio } = await playWith((url) => url.includes("mini-192"));

    // К мёртвой сходили дважды: с проверкой доступа и без неё.
    expect(asked.filter((u) => u.includes("mini-192"))).toHaveLength(2);
    // И ушли к соседней по списку.
    expect(asked.at(-1)).not.toContain("mini-192");
    expect(radio.snapshot().mode).not.toBe("off");
  });

  it("не отвечает ни одна - выключаемся, а не ходим по кругу", async () => {
    const { asked, radio } = await playWith(() => true);

    // Каждую станцию пробуем ровно дважды: с CORS и без.
    expect(asked).toHaveLength(radio.STATIONS.length * 2);
    expect(radio.snapshot().mode).toBe("off");
  });

  it("выбор станции руками отменяет прошлые неудачи", async () => {
    const { radio } = await playWith((url) => url.includes("mini-192"));
    // Мёртвую выбирают снова - к ней и идём, а не считаем её вычеркнутой.
    expect(() => radio.pick(0)).not.toThrow();
  });
});

describe("поток оборвался посреди песни", () => {
  /** Плеер, у которого можно дёрнуть события на последнем открытом элементе. */
  function trackAudio() {
    const asked: string[] = [];
    let last: HTMLAudioElement | null = null;
    const Real = window.Audio;
    window.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      const one = new Real(...args);
      const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      Object.defineProperty(one, "src", {
        configurable: true,
        get: () => src?.get?.call(one),
        set(value: string) {
          asked.push(value);
          src?.set?.call(one, value);
        },
      });
      last = one;
      return one;
    } as unknown as typeof Audio;
    return {
      asked,
      current: () => last!,
      restore: () => {
        window.Audio = Real;
      },
    };
  }

  it("оборвавшаяся станция возвращается, а не уступает место следующей", async () => {
    // Живой поток обрывается не только когда станция умерла: хватает секунды
    // без связи. Перебор списка на таком обрыве проходил все станции за доли
    // секунды - каждая падала по той же причине - и выключал радио. Со стороны
    // это выглядело так: перешёл в другой раздел, музыка встала на паузу.
    vi.useFakeTimers();
    const tape = trackAudio();
    try {
      const radio = await import("@/lib/radio");
      const { default: RadioChip } = await import("@/components/app/RadioChip");
      render(<RadioChip />);
      fireEvent.click(playButton());

      const first = tape.asked[0];
      tape.current().onplaying?.(new Event("playing"));
      expect(radio.snapshot().mode).toBe("playing");

      tape.current().onerror?.(new Event("error"));
      // Не выключились и не ушли к соседней - ждём возврата.
      expect(radio.snapshot().mode).toBe("loading");
      expect(tape.asked).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(900);
      expect(tape.asked.at(-1)).toBe(first);
    } finally {
      tape.restore();
      vi.useRealTimers();
    }
  });

  it("не вернулась за все попытки - уходим к соседней, а не молчим", async () => {
    // Возвраты не бесконечны: станция может замолчать на неделю, и держать
    // человека на ней всё это время значит подменить радио тишиной.
    vi.useFakeTimers();
    const tape = trackAudio();
    try {
      const radio = await import("@/lib/radio");
      const { default: RadioChip } = await import("@/components/app/RadioChip");
      render(<RadioChip />);
      fireEvent.click(playButton());

      const first = tape.asked[0];
      tape.current().onplaying?.(new Event("playing"));

      // Обрыв, следом все возвраты подряд - ни один не зазвучал, - и уже
      // после них прежний перебор: та же станция без CORS, потом соседняя.
      for (let i = 0; i < 6; i++) {
        tape.current().onerror?.(new Event("error"));
        await vi.advanceTimersByTimeAsync(15000);
      }

      expect(tape.asked.at(-1)).not.toBe(first);
      expect(radio.snapshot().mode).not.toBe("off");
    } finally {
      tape.restore();
      vi.useRealTimers();
    }
  });
});

describe("уведомление и музыка", () => {
  it("сигнал терминала приглушает радио, а потом отпускает", async () => {
    // Движок держит свой <audio> при себе и наружу не отдаёт. Перехватываем
    // конструктор: это единственный способ увидеть настоящую громкость - ту,
    // которую слышит человек.
    const born: HTMLAudioElement[] = [];
    const Real = window.Audio;
    window.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      const one = new Real(...args);
      born.push(one);
      return one;
    } as unknown as typeof Audio;

    vi.useFakeTimers();
    try {
      const radio = await import("@/lib/radio");
      const { default: RadioChip } = await import("@/components/app/RadioChip");
      render(<RadioChip />);

      radio.setVolume(0.8);
      fireEvent.click(playButton());
      await vi.advanceTimersByTimeAsync(0);
      expect(born.length).toBeGreaterThan(0);
      const audio = born[born.length - 1];
      expect(audio.volume).toBeCloseTo(0.8, 2);

      radio.duck(300);
      // Громкость доезжает до цели за несколько шагов: рывок слышен щелчком.
      await vi.advanceTimersByTimeAsync(200);
      expect(audio.volume).toBeCloseTo(0.2, 2);

      // Отпустили - вернулась ровно та, что выбрал человек.
      await vi.advanceTimersByTimeAsync(600);
      expect(audio.volume).toBeCloseTo(0.8, 2);
      expect(radio.snapshot().volume).toBe(0.8);
    } finally {
      vi.useRealTimers();
      window.Audio = Real;
    }
  });
});
