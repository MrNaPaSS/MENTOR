"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

interface FngPoint {
  value: string;
  value_classification: string;
  timestamp: string;
}

function getColor(v: number) {
  if (v <= 25) return "#FF4757";      // Extreme Fear
  if (v <= 45) return "#FF8C00";      // Fear
  if (v <= 55) return "#FFD700";      // Neutral
  if (v <= 75) return "#00D4A0";      // Greed
  return "#0AFFE0";                   // Extreme Greed
}

function getLabel(cls: string) {
  const map: Record<string, string> = {
    "Extreme Fear": "Крайний страх",
    "Fear": "Страх",
    "Neutral": "Нейтрально",
    "Greed": "Жадность",
    "Extreme Greed": "Крайняя жадность",
  };
  return map[cls] || cls;
}

interface Props {
  compact?: boolean;
}

export default function FearGreed({ compact = false }: Props) {
  const [current, setCurrent] = useState<FngPoint | null>(null);
  const [history, setHistory] = useState<FngPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/market/fear-greed`, { headers: { "ngrok-skip-browser-warning": "1" } });
        if (!res.ok) return;
        const data = await res.json();
        setCurrent(data.current);
        setHistory(data.history || []);
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div className="skeleton h-24 w-full rounded-xl" />;
  if (!current) return null;

  const value = parseInt(current.value);
  const color = getColor(value);
  const label = getLabel(current.value_classification);

  // SVG дуга (полукруг)
  const r = 54;
  const cx = 72, cy = 72;
  const circ = Math.PI * r;
  const dash = (value / 100) * circ;

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <svg width="56" height="32" viewBox="0 0 112 64">
          <path d={`M 8 56 A ${r} ${r} 0 0 1 104 56`} fill="none" stroke="#2A2A3E" strokeWidth="10" strokeLinecap="round" />
          <path d={`M 8 56 A ${r} ${r} 0 0 1 104 56`} fill="none" stroke={color}
            strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(value / 100) * (Math.PI * r)} ${Math.PI * r}`} />
          <text x="56" y="52" textAnchor="middle" fill="white" fontSize="14" fontWeight="700" fontFamily="JetBrains Mono">{value}</text>
        </svg>
        <div>
          <div className="text-sm font-semibold" style={{ color }}>{label}</div>
          <div className="text-[10px] text-text-muted">F&G Index</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Fear & Greed Index</h3>
        <span className="badge-muted text-[10px]">Крипто-рынок</span>
      </div>

      {/* Круговой индикатор */}
      <div className="flex items-center gap-6">
        <div className="relative flex-shrink-0">
          <svg width="144" height="84" viewBox="0 0 144 90">
            <path d={`M 12 80 A ${r} ${r} 0 0 1 132 80`} fill="none" stroke="#1A1A2E" strokeWidth="14" strokeLinecap="round" />
            <path d={`M 12 80 A ${r} ${r} 0 0 1 132 80`} fill="none" stroke={color}
              strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${(value / 100) * (Math.PI * r)} ${Math.PI * r}`}
              style={{ transition: "stroke-dasharray 0.8s ease" }} />
            <text x="72" y="72" textAnchor="middle" fill="white" fontSize="28" fontWeight="800" fontFamily="JetBrains Mono">{value}</text>
          </svg>
        </div>
        <div>
          <div className="text-xl font-bold" style={{ color }}>{label}</div>
          <div className="mt-1 text-xs text-text-muted">
            {new Date(parseInt(current.timestamp) * 1000).toLocaleDateString("ru-RU")}
          </div>
        </div>
      </div>

      {/* История (мини-бары последних 14 дней) */}
      {history.length > 1 && (
        <div>
          <div className="mb-1.5 text-[10px] text-text-muted">История (14 дней)</div>
          <div className="flex items-end gap-0.5" style={{ height: 32 }}>
            {history.slice(0, 14).reverse().map((h, i) => {
              const v = parseInt(h.value);
              const hpct = (v / 100);
              return (
                <div key={i} title={`${v} - ${getLabel(h.value_classification)}`}
                  className="flex-1 rounded-sm transition-all"
                  style={{ height: `${Math.max(hpct * 32, 4)}px`, backgroundColor: getColor(v), opacity: 0.7 + 0.3 * hpct }} />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-text-muted">
            <span>14 дн. назад</span><span>Сегодня</span>
          </div>
        </div>
      )}
    </div>
  );
}
