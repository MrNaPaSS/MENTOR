import Link from "next/link";
import LiveStats from "@/components/LiveStats";
import Calculator from "@/components/Calculator";
import Leaderboard from "@/components/Leaderboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="text-2xl font-extrabold tracking-tight">
          ⚡ <span className="text-accent-cyan">NMNH</span>
        </div>
        <Link href="/login" className="btn-outline">
          Войти
        </Link>
      </header>

      {/* Hero */}
      <section className="py-16 text-center">
        <h1 className="text-4xl font-extrabold leading-tight md:text-6xl">
          Торгуй как профи.
          <br />
          <span className="text-accent-cyan">Учись у лучших.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-text-secondary">
          Персональные сигналы под твой депозит. Реальный расчёт. Реальный результат.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="btn-primary">
            ⚡ Начать обучение
          </Link>
          <a href="https://www.weex.com" className="btn-outline">
            📊 Открыть счёт на WEEX
          </a>
        </div>
      </section>

      {/* Live stats */}
      <section className="py-6">
        <LiveStats />
      </section>

      {/* Calculator */}
      <section className="py-8">
        <Calculator />
      </section>

      {/* Leaderboard */}
      <section className="py-8">
        <Leaderboard />
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-text-muted">
        <p>© 2025 NMNH. Все права защищены.</p>
        <p className="mt-1">
          Торговля криптовалютами связана с риском. Это не финансовый совет.
        </p>
      </footer>
    </main>
  );
}
