// Радио в шапке кабинета.
//
// Проверяется то, что ломается молча. Поток открывается через <audio>, а его в
// jsdom нет вовсе - значит и увидеть, что кнопка перестала включать музыку или
// что станция выбирается не та, можно только здесь.
//
// Отдельно проверяется остановка: на паузе поток продолжал бы качаться в фон,
// и радио, которое «выключили», тихо съедало бы мегабайты весь торговый день.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import RadioChip from "@/components/app/RadioChip";

const play = vi.fn(() => Promise.resolve());
const load = vi.fn();

beforeAll(() => {
  // Ни воспроизведения, ни разбора звука в jsdom нет - подменяем оба.
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.load = load;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

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
});

afterEach(() => {
  localStorage.clear();
});

/** Кнопка пуска: у неё меняется подпись, поэтому ищем по роли и названию. */
function playButton(): HTMLElement {
  return screen.getByRole("button", { name: /Радио|выключить/ });
}

describe("радио в шапке", () => {
  it("само не включается: музыка от одного открытия вкладки - это то, что закрывают не глядя", () => {
    render(<RadioChip />);
    expect(play).not.toHaveBeenCalled();
  });

  it("нажали пуск - поток открылся", async () => {
    render(<RadioChip />);
    fireEvent.click(playButton());
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("выключили - соединение разорвано, а не поставлено на паузу", async () => {
    render(<RadioChip />);
    fireEvent.click(playButton());
    await waitFor(() => expect(play).toHaveBeenCalled());

    load.mockClear();
    fireEvent.click(playButton());
    // Пустой src и load() - это и есть разрыв: без него поток продолжает идти.
    await waitFor(() => expect(load).toHaveBeenCalled());
  });

  it("выбранная станция запоминается на следующий заход", () => {
    const { unmount } = render(<RadioChip />);
    fireEvent.click(screen.getByRole("button", { name: /сменить станцию/ }));
    fireEvent.click(screen.getByText("Noise FM"));
    unmount();

    render(<RadioChip />);
    fireEvent.click(screen.getByRole("button", { name: /сменить станцию/ }));
    // Своя станция помечена цветом акцента - по нему её и узнаём.
    expect(screen.getByText("Noise FM").className).toContain("text-accent-cyan");
  });

  it("мусор в хранилище не ломает шапку", () => {
    localStorage.setItem("nmnh.radio", '{"station":99,"volume":"громко"}');
    render(<RadioChip />);
    fireEvent.click(screen.getByRole("button", { name: /сменить станцию/ }));
    expect(screen.getByText("PromoDJ Klubb").className).toContain("text-accent-cyan");
  });
});
