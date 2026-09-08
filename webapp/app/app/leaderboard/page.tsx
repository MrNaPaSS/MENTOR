"use client";

import Leaderboard from "@/components/Leaderboard";
import { useT } from "@/lib/i18n";

export default function CabinetLeaderboard() {
  const t = useT();

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-text-primary">{t.tools.leaderboard.heading}</h1>
      <Leaderboard />
    </div>
  );
}
