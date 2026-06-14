import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Calculator from "@/components/Calculator";

afterEach(() => vi.restoreAllMocks());

describe("Calculator", () => {
  it("renders the form", () => {
    render(<Calculator />);
    expect(screen.getByText("Калькулятор позиции")).toBeInTheDocument();
    expect(screen.getByText("Рассчитать")).toBeInTheDocument();
  });

  it("shows result after compute", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "moderate",
          direction: "LONG",
          balance: "1000",
          leverage: 10,
          entry_price: "100",
          margin_usd: "80",
          position_size: "800",
          sl_percent: "1.5",
          sl_price: "98.5",
          risk_usd: "12",
          risk_percent_of_balance: "1.2",
          margin_type: "cross",
          take_profits: [{ index: 1, percent: "1.5", price: "101.5", profit_usd: "12", rr: "1.0" }],
          warnings: [],
          status: "ok",
        }),
      })
    );

    render(<Calculator />);
    fireEvent.click(screen.getByText("Рассчитать"));

    await waitFor(() => expect(screen.getByText("Маржа")).toBeInTheDocument());
    expect(screen.getByText("TP1 (RR 1:1.0)")).toBeInTheDocument();
  });

  it("shows error on failed compute", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: "bad" }) })
    );
    render(<Calculator />);
    fireEvent.click(screen.getByText("Рассчитать"));
    await waitFor(() => expect(screen.getByText(/bad/)).toBeInTheDocument());
  });
});
