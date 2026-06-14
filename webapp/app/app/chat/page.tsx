"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Crown, Pin } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/content";

interface Msg {
  id: number;
  author: string;
  text: string;
  time: string;
  self?: boolean;
  mentor?: boolean;
}

const SEED: Msg[] = [
  { id: 1, author: "Ментор", text: "Сегодня работаем аккуратно — рынок волатильный. Стопы по сигналам выставлены.", time: "09:12", mentor: true },
  { id: 2, author: "alex", text: "Взял BTC лонг по сигналу, спасибо 🙌", time: "09:20" },
  { id: 3, author: "sasha", text: "Какой риск на сделку в умеренном?", time: "09:24" },
  { id: 4, author: "Ментор", text: "1–5% от депозита, настраивается в профиле.", time: "09:26", mentor: true },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [
      ...m,
      { id: Date.now(), author: "Вы", text: t, time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), self: true },
    ]);
    setText("");
  }

  const pinned = messages.find((m) => m.mentor);

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <h1 className="text-h2 mb-3 text-white">Чат сообщества</h1>

      {/* Баннер Telegram */}
      <a
        href={SOCIAL_LINKS.telegram}
        target="_blank"
        rel="noopener noreferrer"
        className="glass mb-3 flex items-center justify-between rounded-xl px-4 py-2.5 text-sm"
      >
        <span className="text-text-secondary">Больше обсуждений в нашем Telegram-форуме</span>
        <span className="text-accent-cyan">→</span>
      </a>

      {/* Закреплённое */}
      {pinned && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-accent-gold/30 bg-accent-gold/[0.06] px-4 py-2.5">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-gold" />
          <p className="text-sm text-text-secondary">
            <span className="font-semibold text-accent-gold">👑 Ментор:</span> {pinned.text}
          </p>
        </div>
      )}

      {/* Лента */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border bg-bg-panel/40 p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.self ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
              m.self
                ? "bg-accent-cyan/15 text-white ring-1 ring-accent-cyan/30"
                : "bg-bg-card text-text-primary ring-1 ring-border"
            }`}>
              <div className="mb-0.5 flex items-center gap-1 text-xs">
                <span className={`font-semibold ${m.mentor ? "text-accent-gold" : m.self ? "text-accent-cyan" : "text-text-secondary"}`}>
                  {m.mentor && <Crown className="mr-0.5 inline h-3 w-3" />}
                  {m.author}
                </span>
                <span className="text-text-muted">· {m.time}</span>
              </div>
              <p className="text-sm">{m.text}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Ввод */}
      <div className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Написать сообщение…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn-primary px-4" onClick={send} aria-label="Отправить">
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-text-muted">
        Реалтайм-чат через WebSocket подключается. Сейчас сообщения локальные.
      </p>
    </div>
  );
}
