"use client";

import SignalsFeed from "@/components/signals/SignalsFeed";

export default function SignalsPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-white">Лента сигналов</h1>
      </div>
      <SignalsFeed />
    </div>
  );
}
