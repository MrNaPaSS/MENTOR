// Страницы нет.
//
// Тот же экран, что у остальных поломок, и по той же причине: снаружи разница
// между «адрес устарел» и «сервер молчит» неразличима - человек в обоих случаях
// не попал туда, куда шёл. Отличается только предложение: здесь возвращать
// нечего, поэтому ведём на главную.

import MaintenanceScreen, { MaintenanceAction } from "@/components/app/MaintenanceScreen";

export default function NotFound() {
  return (
    <MaintenanceScreen
      title="Страницы нет"
      note="Ссылка устарела или её адрес изменился. С главной можно дойти до всего остального."
      action={<MaintenanceAction href="/">На главную</MaintenanceAction>}
    />
  );
}
