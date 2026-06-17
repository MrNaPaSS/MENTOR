"use client";

import { useEffect, useState } from "react";
import { Trash2, ImageOff } from "lucide-react";
import { useMentorToken } from "@/components/admin/AdminShell";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface BroadcastItem {
  id: number;
  text: string;
  chart_url: string | null;
  created_at: string;
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
}

export default function AnalysesPage() {
  const token = useMentorToken();
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/broadcast`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(id: number) {
    setDeleting(id);
    try {
      await fetch(`${API}/api/broadcast/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function resolveChart(url: string | null) {
    if (!url) return null;
    if (url.startsWith("/")) return url;
    const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
    if (m) return `https://s3.tradingview.com/snapshots/${m[1][0].toLowerCase()}/${m[1]}.png`;
    return url;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Анализы на сайте</h1>
        <span className="text-sm text-text-muted">{items.length} записей</span>
      </div>

      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-text-muted">
          <ImageOff className="h-10 w-10 opacity-40" />
          <p>Анализов пока нет</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const img = resolveChart(item.chart_url);
          return (
            <div
              key={item.id}
              className="group relative flex gap-4 overflow-hidden rounded-2xl border border-white/8 bg-white/4 p-4 transition hover:border-white/15"
            >
              {/* Превью */}
              {img ? (
                <div className="h-20 w-32 flex-shrink-0 overflow-hidden rounded-xl">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-20 w-32 flex-shrink-0 items-center justify-center rounded-xl bg-white/5">
                  <ImageOff className="h-6 w-6 text-text-muted opacity-40" />
                </div>
              )}

              {/* Текст */}
              <div className="flex flex-1 flex-col justify-between overflow-hidden">
                <p className="line-clamp-2 text-sm text-white/90">
                  {item.text || <span className="text-text-muted italic">без текста</span>}
                </p>
                <span className="mt-2 text-xs text-text-muted">{timeAgo(item.created_at)}</span>
              </div>

              {/* Удалить */}
              <button
                onClick={() => remove(item.id)}
                disabled={deleting === item.id}
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-danger/10 text-danger opacity-0 transition hover:bg-danger/20 group-hover:opacity-100 disabled:opacity-50"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
