// Перетаскивание уровней сделки.
//
// Здесь проверяется одна вещь, которая уже стоила трейдеру денег: заявка после
// перетаскивания обязана уйти на биржу. Она не уходила - конец пути сравнивался
// с текущей ценой уровня, а её мы сами же и меняли, пока вели. Цены совпадали
// всегда, отправка не срабатывала ни разу, и стоп через несколько секунд
// возвращался на прежнее место, потому что на бирже он никуда не двигался.

import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DragLevels, { type DragLevel } from "@/components/scalping/DragLevels";

beforeAll(() => {
  // Захвата указателя в jsdom нет, а без него обработчики не отработают.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

/** Цена и координата: один к одному, чтобы в тесте считать было нечего. */
const toY = (price: number) => price;
const toPrice = (y: number) => y;

function level(over: Partial<DragLevel> = {}): DragLevel {
  return {
    id: "trade:stop",
    kind: "stop",
    price: 100,
    title: "стоп",
    color: "#f00",
    onDrag: vi.fn(),
    onDrop: vi.fn(),
    ...over,
  };
}

/** Полоска захвата у уровня: она невидима, поэтому ищем по подсказке. */
function strip(container: HTMLElement): HTMLElement {
  const node = container.querySelector("[title]");
  if (!node) throw new Error("полоска захвата не отрисована");
  return node as HTMLElement;
}

describe("перетаскивание уровня", () => {
  it("отпустили на новой цене - заявка уходит на биржу", () => {
    const one = level();
    // Как на странице: пока ведут, цена уровня меняется снаружи. Именно из-за
    // этого сравнение с текущей ценой и не работало.
    const { container, rerender } = render(
      <DragLevels levels={[one]} toY={toY} toPrice={toPrice} format={String} />,
    );
    const node = strip(container);

    fireEvent.pointerDown(node, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 1, clientY: 140 });
    rerender(
      <DragLevels
        levels={[{ ...one, price: 140 }]}
        toY={toY}
        toPrice={toPrice}
        format={String}
      />,
    );
    fireEvent.pointerUp(strip(container), { pointerId: 1, clientY: 140 });

    expect(one.onDrag).toHaveBeenCalledWith(140);
    expect(one.onDrop).toHaveBeenCalledWith(140);
  });

  it("отпустили там же, откуда взяли - на биржу не ходим", () => {
    const one = level();
    const { container } = render(
      <DragLevels levels={[one]} toY={toY} toPrice={toPrice} format={String} />,
    );
    const node = strip(container);

    fireEvent.pointerDown(node, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 1, clientY: 100 });
    fireEvent.pointerUp(node, { pointerId: 1, clientY: 100 });

    expect(one.onDrop).not.toHaveBeenCalled();
  });

  it("без захвата движение мыши уровень не трогает", () => {
    const one = level();
    const { container } = render(
      <DragLevels levels={[one]} toY={toY} toPrice={toPrice} format={String} />,
    );

    fireEvent.pointerMove(strip(container), { pointerId: 1, clientY: 140 });

    expect(one.onDrag).not.toHaveBeenCalled();
    expect(one.onDrop).not.toHaveBeenCalled();
  });
});
