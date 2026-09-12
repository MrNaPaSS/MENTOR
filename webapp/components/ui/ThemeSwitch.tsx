"use client";

// Переключатель темы: светлая или тёмная.
//
// Тема одна на весь сайт - и на лендинге, и в кабинете: палитра меняется
// каналами цветов на корне документа (lib/terminalTheme), разметка о ней не
// знает. Раньше переключить её можно было только в профиле, то есть после
// входа; гость, которому белый лист режет глаза, упирался в него сразу.

import { Moon, Sun } from "lucide-react";
import { setTerminalTheme, useTerminalTheme, type TerminalTheme } from "@/lib/terminalTheme";
import { useT } from "@/lib/i18n";

const THEMES: { value: TerminalTheme; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
];

export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const t = useT();
  const theme = useTerminalTheme();
  const labels: Record<TerminalTheme, string> = {
    light: t.profile.themeLight,
    dark: t.profile.themeDark,
  };

  return (
    <div
      className={`flex items-center gap-0.5 rounded-full border border-border px-1 py-0.5 ${className}`}
    >
      {THEMES.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTerminalTheme(value)}
          aria-pressed={theme === value}
          title={labels[value]}
          aria-label={labels[value]}
          className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${
            theme === value
              ? "bg-accent-cyan/15 text-accent-cyan"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
