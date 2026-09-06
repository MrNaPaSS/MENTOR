import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TradeDialog, { type TradeDraft } from "@/components/scalping/TradeDialog";
import type { Wall } from "@/lib/scalping";

// Окно расчёта живёт поверх страницы, которая перерисовывается восемь раз в
// секунду — столько кадров приходит из стакана. Всё, что окно делает с полем
// ввода, обязано случаться один раз, а не на каждом кадре: иначе трейдер не
// может набрать свою сумму, она затирается под пальцами.

const shelf: Wall = {
  price: 100,
  size: 20000,
  notional: 2_000_000,
  side: "bid",
  distance_bp: 5,
  ratio: 1,
};

const draft: TradeDraft = { shelf, tick: 0.1, margin: 10, leverage: 25, stopPct: 0.2 };

/** Поля идут в одном порядке: сумма, плечо, стоп. */
function fields() {
  const [margin, leverage, stop] = screen.getAllByRole("textbox") as HTMLInputElement[];
  return { margin, leverage, stop };
}

describe("окно расчёта сделки", () => {
  it("выделяет сумму один раз, а не на каждом кадре", () => {
    const view = render(
      <TradeDialog draft={draft} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const field = fields().margin;
    // При открытии — выделена: заменить готовую сумму своей одним набором.
    expect(field.selectionEnd).toBe(2);

    // Трейдер поставил курсор в конец и дописывает.
    field.setSelectionRange(2, 2);
    view.rerender(
      <TradeDialog draft={draft} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(2);
  });

  it("принимает набранное число, в том числе через запятую", () => {
    const onChange = vi.fn();
    render(
      <TradeDialog draft={draft} onChange={onChange} onConfirm={() => {}} onCancel={() => {}} />,
    );
    fireEvent.change(fields().margin, { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ margin: 250 }));

    fireEvent.change(fields().stop, { target: { value: "0,35" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stopPct: 0.35 }));
  });

  it("незаконченный ввод не сбрасывается в ноль", () => {
    const onChange = vi.fn();
    render(
      <TradeDialog draft={draft} onChange={onChange} onConfirm={() => {}} onCancel={() => {}} />,
    );
    // «0.» — это половина числа, а не ноль: стирать её под пальцами нельзя.
    fireEvent.change(fields().stop, { target: { value: "0." } });
    expect(screen.getByDisplayValue("0.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ stopPct: 0 }));
  });
});
