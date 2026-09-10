import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";

/**
 * Кабинет закрыт от поиска.
 *
 * Робот видит здесь не то, что видит вошедший трейдер, а пустую оболочку с
 * формой входа. Такие страницы Google называет тонкими и, набрав их с одного
 * домена десяток, хуже относится ко всему домену - включая витрину, ради
 * которой поиск нам и нужен.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
