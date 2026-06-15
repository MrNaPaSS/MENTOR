import Calculator from "@/components/Calculator";

export default function CalculatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Калькулятор позиции</h1>
        <p className="mt-1 text-sm text-text-muted">
          Рассчитай маржу, объём, риск и профит по каждому TP перед входом в сделку
        </p>
      </div>
      <Calculator />
    </div>
  );
}
