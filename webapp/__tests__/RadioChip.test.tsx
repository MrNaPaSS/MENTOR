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
