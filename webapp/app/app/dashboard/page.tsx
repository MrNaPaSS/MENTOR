"use client";

// Дашборд убран: главным разделом стали «Анализы».
//
// Адрес оставлен живым намеренно. На него ведут закладки, ярлык установленного
// приложения и старые ссылки в переписке — тихий переход туда, где теперь
// начинается работа, честнее, чем страница «не найдено».
//
// Переход клиентский: сайт собирается статикой (output: "export"), серверных
// редиректов в такой сборке не бывает.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/analysis");
  }, [router]);

  return null;
}
