/**
 * Постоянная ссылка на обработчик.
 *
 * Обработчик, рождённый заново на каждой отрисовке, обесценивает `memo` у
 * ребёнка: пропс другой по ссылке, и ребёнок считает себя заново. Хук держит
 * ссылку постоянной, но вызов обязан уходить в свежее тело - иначе он показал
 * бы состояние, которого на экране уже нет.
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";

import { useEvent } from "@/lib/useEvent";

describe("постоянный обработчик", () => {
  it("ссылка одна и та же на всех отрисовках", () => {
    const seen: Array<() => void> = [];
    let bump = () => {};

    function Probe() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      seen.push(useEvent(() => undefined));
      return <span>{n}</span>;
    }

    render(<Probe />);
    act(() => bump());
    act(() => bump());

    expect(seen.length).toBe(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it("вызов уходит в свежее тело, а не в то, что было при первой отрисовке", () => {
    let call = () => 0;
    let bump = () => {};

    function Probe() {
      const [n, setN] = useState(1);
      bump = () => setN((v) => v + 1);
      call = useEvent(() => n);
      return <span>{n}</span>;
    }

    render(<Probe />);
    expect(call()).toBe(1);

    act(() => bump());
    expect(screen.getByText("2")).toBeTruthy();
    // Ссылка прежняя, а число - нынешнее: иначе обработчик закрыл бы сделку по
    // цене, которой на экране уже нет.
    expect(call()).toBe(2);
  });

  it("доводы и ответ проходят насквозь", () => {
    let call = (_a: number, _b: number) => 0;

    function Probe() {
      call = useEvent((a: number, b: number) => a * b);
      return null;
    }

    render(<Probe />);
    expect(call(6, 7)).toBe(42);
  });
});
