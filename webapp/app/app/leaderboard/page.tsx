"use client";

import Leaderboard from "@/components/Leaderboard";

export default function CabinetLeaderboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-white">Лидерборд</h1>
      <Leaderboard />
    </div>
  );
}
