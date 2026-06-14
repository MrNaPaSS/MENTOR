import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Badge from "@/components/ui/Badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Новый</Badge>);
    expect(screen.getByText("Новый")).toBeInTheDocument();
  });

  it("applies variant class", () => {
    render(<Badge variant="gold">Топ</Badge>);
    expect(screen.getByText("Топ").className).toContain("badge-gold");
  });

  it("defaults to cyan variant", () => {
    render(<Badge>Дефолт</Badge>);
    expect(screen.getByText("Дефолт").className).toContain("badge-cyan");
  });
});
