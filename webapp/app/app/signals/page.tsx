"use client";

import SignalsFeed from "@/components/signals/SignalsFeed";
import { useT } from "@/lib/i18n";

export default function SignalsPage() {
  const t = useT();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-text-primary">{t.signals.feedTitle}</h1>
      </div>
      <SignalsFeed />
    </div>
  );
}
