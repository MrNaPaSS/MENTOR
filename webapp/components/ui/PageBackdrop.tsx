import ScrollSceneMount from "@/components/landing/ScrollSceneMount";

/**
 * Фон витринной страницы: клетка, объёмная сцена и вуаль поверх неё.
 *
 * Три слоя строго в этом порядке, и порядок здесь - не оформление, а смысл.
 * Клетка держит страницу в одном ряду с главной и входом. Сцена даёт ей
 * глубину. Вуаль гасит сцену настолько, чтобы ближние свечи не проходили
 * тёмными полосами сквозь таблицы и цифры: на главной под ними один экран
 * с крупным заголовком, а здесь - страницы, которые читают строку за строкой.
 *
 * Слой закреплён на экране, а не растянут по документу: иначе при прокрутке
 * клетка ехала бы вместе с текстом и рябила.
 */
export default function PageBackdrop() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg-deep/60 via-bg-deep/35 to-bg-deep/75" />
      </div>

      <ScrollSceneMount />

      {/* Вуаль идёт последней, поэтому ложится поверх сцены - её же слой
          закреплён на том же уровне глубины. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-bg-deep/50" aria-hidden />
    </>
  );
}
