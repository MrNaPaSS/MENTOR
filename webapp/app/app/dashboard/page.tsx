"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Dashboard() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("nmnh_access");
    if (!token) {
      router.replace("/login");
      return;
    }
    setAuthed(true);
  }, [router]);

  if (!authed) return null;

  function logout() {
    localStorage.removeItem("nmnh_access");
    localStorage.removeItem("nmnh_refresh");
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-2xl font-extrabold">
          ⚡ <span className="text-accent-cyan">NMNH</span>
        </Link>
        <button className="btn-outline" onClick={logout}>
          Выйти
        </button>
      </header>

      <h1 className="mt-8 text-3xl font-bold">Дашборд</h1>
      <p className="mt-2 text-text-secondary">
        Кабинет ученика в разработке. Здесь будут KPI, активные сигналы, график PnL и аналитика.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {["Баланс USDT", "PnL сегодня", "Активных сигналов", "Винрейт"].map((label) => (
          <div key={label} className="card">
            <div className="font-mono text-2xl font-bold text-accent-cyan">—</div>
            <div className="mt-1 text-sm text-text-secondary">{label}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
