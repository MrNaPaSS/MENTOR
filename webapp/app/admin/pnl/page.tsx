"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Upload, ImageIcon } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";

export default function PnlPage() {
  const token = useMentorToken();
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await fetch(`${API_URL}/api/pnl`);
    const d = await r.json();
    setImages(d.images ?? []);
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch(`${API_URL}/api/pnl/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error((d as any).detail || `HTTP ${r.status}`);
        }
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(src: string) {
    const filename = src.split("/").pop();
    if (!filename) return;
    await fetch(`${API_URL}/api/pnl/${filename}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-h2 text-white">PnL скриншоты</h1>

      {/* Загрузка */}
      <div className="card space-y-4">
        <p className="text-sm text-text-secondary">Добавь новые скриншоты - они появятся на лендинге в карусели.</p>

        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-10 transition hover:border-accent-cyan/40 hover:bg-accent-cyan/[0.02]"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
        >
          <Upload className="h-8 w-8 text-text-muted" />
          <p className="text-sm font-semibold text-white">Кликни или перетащи файлы</p>
          <p className="text-xs text-text-muted">JPG, PNG, WEBP</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />

        {uploading && <p className="text-sm text-accent-cyan">Загружаем...</p>}
        {error && <p className="text-sm text-danger">⚠ {error}</p>}
      </div>

      {/* Список */}
      {images.length === 0 ? (
        <div className="card grid place-items-center py-16 text-text-muted">
          <ImageIcon className="mb-3 h-8 w-8 opacity-30" />
          <p>Скриншотов пока нет</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((src) => (
            <div key={src} className="group relative overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="pnl"
                className="h-52 w-full object-cover"
              />
              <button
                onClick={() => handleDelete(src)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white opacity-0 transition hover:bg-danger/80 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
