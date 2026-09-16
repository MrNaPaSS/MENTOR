// Окна выходят из области панелей.
//
// `PaneScope` объявляет `isolate` - свою стопку слоёв, - и всё нарисованное
// внутри неё остаётся под шапкой сайта, какой бы `z-index` ему ни задали.
// Затемнение накрывало раздел, а лента рынка и навигация оставались светлыми
// поверх него. Проверяем, что окно уезжает в конец `body`, а цвета панелей
// едут вместе с ним.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ModalPortal from "@/components/ui/ModalPortal";
import { PaneScope } from "@/components/app/Pane";

describe("ModalPortal", () => {
  it("рисует окно за пределами области панелей", () => {
    const { container } = render(
      <PaneScope>
        <ModalPortal>
          <div data-testid="window">окно</div>
        </ModalPortal>
      </PaneScope>,
    );

    const window = screen.getByTestId("window");
    expect(window).toBeTruthy();
    // Внутри самой области раздела окна нет - оно уехало в body.
    expect(container.querySelector("[data-testid='window']")).toBeNull();
    expect(document.body.contains(window)).toBe(true);
  });

  it("несёт с собой класс темы панелей", () => {
    render(
      <PaneScope>
        <ModalPortal>
          <div data-testid="window">окно</div>
        </ModalPortal>
      </PaneScope>,
    );

    const host = screen.getByTestId("window").parentElement;
    expect(host?.className).toMatch(/pane-(dark|light)/);
  });
});
