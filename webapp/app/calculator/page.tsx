import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import PageBackdrop from "@/components/ui/PageBackdrop";
import Footer from "@/components/landing/Footer";
import CalculatorIntro from "@/components/landing/CalculatorIntro";

export const metadata: Metadata = {
  title: "Калькулятор позиции",
  description:
    "Рассчитай маржу, объём, риск и профит по каждому тейк-профиту под свой депозит - бесплатно. Умеренный и турбо режимы.",
  alternates: { canonical: "/calculator" },
};

export default function CalculatorPage() {
  return (
    <>
      <PageBackdrop />
      <Header />
      <CalculatorIntro />
      <Footer />
    </>
  );
}
