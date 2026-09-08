"use client";

import ChatRoom from "@/components/chat/ChatRoom";
import { useT } from "@/lib/i18n";

export default function ChatPage() {
  const t = useT();

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <h1 className="text-h2 mb-3 text-text-primary">{t.chat.title}</h1>
      <ChatRoom />
    </div>
  );
}
