import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";

/**
 * Админка закрыт от поиска.
 *
 * Робот видит здесь не то, что видит вошедший трейдер, а пустую оболочку с
 * формой входа. Такие страницы Google называет тонкими и, набрав их с одного
 * домена десяток, хуже относится ко всему домену - включая витрину, ради
 * которой поиск нам и нужен.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
