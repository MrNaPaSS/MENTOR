"use client";

import Calculator from "@/components/Calculator";
import { useT } from "@/lib/i18n";

export default function CalculatorPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-text-primary">{t.tools.calculator.appTitle}</h1>
        <p className="mt-1 text-sm text-text-muted">{t.tools.calculator.appSubtitle}</p>
      </div>
      <Calculator />
    </div>
  );
}
