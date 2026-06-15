import Header from "@/components/landing/Header";
import ScrollSceneMount from "@/components/landing/ScrollSceneMount";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import PublicSignals from "@/components/landing/PublicSignals";
import PlatformStats from "@/components/landing/PlatformStats";
import Testimonials from "@/components/landing/Testimonials";
import Faq from "@/components/landing/Faq";
import Socials from "@/components/landing/Socials";
import Footer from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <ScrollSceneMount />
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <PublicSignals />
        <PlatformStats />
        <Testimonials />
        <Faq />
        <Socials />
      </main>
      <Footer />
    </>
  );
}
