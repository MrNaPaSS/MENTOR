import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import PageBackdrop from "@/components/ui/PageBackdrop";
import Footer from "@/components/landing/Footer";
import CalculatorIntro from "@/components/landing/CalculatorIntro";
import SeoToolText from "@/components/seo/SeoToolText";
import { calculatorPage } from "@/lib/seo/pages/calculator";

export const metadata: Metadata = {
  title: calculatorPage.title,
  description: calculatorPage.description,
  alternates: { canonical: calculatorPage.path },
  openGraph: {
    title: calculatorPage.title,
    description: calculatorPage.description,
    url: calculatorPage.path,
  },
};

export default function CalculatorPage() {
  return (
    <>
      <PageBackdrop />
      <Header />
      <CalculatorIntro>
        <SeoToolText page={calculatorPage} />
      </CalculatorIntro>
      <Footer />
    </>
  );
}
