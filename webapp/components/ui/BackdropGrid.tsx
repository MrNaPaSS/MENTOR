/**
 * Клетка на фоне всей страницы.
 *
 * Та же сетка в 48 пикселей, что на главной и на входе: она держит страницу
 * в одном ряду с ними, а длинную витрину не даёт прочесть как пустой белый
 * лист. Слой закреплён на экране, а не растянут по документу - иначе при
 * прокрутке клетка ехала бы вместе с текстом и рябила.
 *
 * Виньетка сверху и снизу гасит сетку у краёв: под шапкой и над подвалом она
 * спорила бы с надписями, а в середине экрана - ровно то, что нужно.
 */
export default function BackdropGrid() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <div className="absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-25" />
      <div className="absolute inset-0 bg-gradient-to-b from-bg-deep/60 via-bg-deep/35 to-bg-deep/75" />
    </div>
  );
}
