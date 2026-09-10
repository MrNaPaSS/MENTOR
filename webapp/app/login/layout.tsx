import type { Metadata } from "next";

/**
 * Страница входа закрыта от поиска.
 *
 * Сама она ничего не рассказывает о платформе - только просит пароль, - но по
 * слову «nmnh» вполне может обойти витрину и встать первой строкой. Человек,
 * пришедший из поиска, увидит форму вместо рассказа и уйдёт.
 *
 * Метаданные живут в этом слое, а не на самой странице: страница помечена
 * «use client», и Next не читает метаданные из клиентских файлов.
 */
export const metadata: Metadata = {
  title: "Вход",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
