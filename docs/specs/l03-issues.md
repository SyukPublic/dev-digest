# Development Plan: L03 issues & доопрацювання (гілка `labs/l03-issues`)

> **Umbrella-спека** для пакету фіксів/доробок, знайдених у L03-ревʼю-сесії.
> Кожен issue: симптом → корінь (з `file:line`) → фікс (+ код-скетч) → зачеплені
> файли → skills → tests → критерій готовності. Наприкінці — **фази** з
> диз'юнктними, паралелізованими слайсами та порядком залежностей.
> Статус усіх issue: **TODO** (специфіковано, готово до імплементації).

## Інваріанти й конвенції (діють для ВСІХ backend-слайсів)

- **Onion** (звірено зі скілом `onion-architecture`): залежності лише всередину.
  Чиста логіка (екстракція тексту з діфа, предикати) → `reviewer-core` (БЕЗ
  `node:crypto`/`db`/мережі — діф є ВХОДОМ). Хеш (`node:crypto`) — у СЕРВЕРІ (як
  уже зроблено в `reviews/freshness.ts`). DB-доступ — ЛИШЕ в `repository.ts`.
  Зовнішні системи — лише через адаптери, конструюються в `container.ts`.
- **Контракти** — розширювати `@devdigest/shared` НОВИМ вмістом; не редагувати
  барель; після зміни — `node scripts/sync-shared.mjs` (CI падає на дрейфі).
- **Міграції — MANUAL**: тільки `pnpm db:generate`; `pnpm db:migrate` запускає
  людина (агент НЕ застосовує). Нова колонка = окрема міграція.
- **Version-sensitive** (Issue #10 / Octokit): звіряти з ВСТАНОВЛЕНОЮ версією
  (`octokit@^4`) + офіційні докази плагінів `retry`/`throttling`.
- **Тести**: backend `server/` (DB-тести — суфікс `*.it.test.ts`), `reviewer-core/`,
  `client/` (Vitest+RTL). Прогнати відповідні пакети до зеленого.

## Зведення issues

| # | Коротко | Сюрфейс | Пріоритет | Зусилля | Залежить від |
|---|---|---|---|---|---|
| 1 | counts `+/-` із того ж джерела, що й patch | client | середній | S | — (синергія з 4B) |
| 2 | підказка «сукупний діф PR відносно `<base>`» | client+i18n | низький | XS | — |
| 3 | новий стан `content_changed` (L2-lite re-anchor) | core+server+client | **високий** | L | — |
| 4 | `anchor_status` оновлюється не одразу | server+client | **високий** | M | — |
| 5 | бейдж `orphaned` нечитабельний | client/тема | низький | XS | — (коорд. з 3, 9 по файлах) |
| 6 | popover-фільтри переносяться | client | низький | XS | — (один файл з 7) |
| 7 | card-popover вилазить; ширше ×1.5; movable | client | середній | M | — (один файл з 6) |
| 8 | `Recompute` внизу, коли intent порожній | client | низький | XS | — |
| 9 | спінери завмирають при reduced-motion | client/тема | низький | S | — (коорд. з 5 по `styles.css`) |
| 10 | 30s GitHub-таймаут блокує UI | server/adapter | середній | M | — (один файл з 4 у `pulls/service.ts`) |

## Підтверджені рішення (НЕ перевідкривати)

1. **Issue #3:** новий статус **`content_changed`** (не мапимо в `moved_out`).
   Порядок класифікації: `orphaned` → `moved_out` → `content_changed` → `current`.
2. **Issue #3 (б), зафіксовано:** зберігати **`sha256`** нормалізованого
   заанкореного сніпета (НЕ сам сніпет) — приватність + обсяг; сирий код у БД не
   потрапляє.
3. **Issue #3 (в), зафіксовано:** реалізуємо під ЦИМ планом як **Stage 2b** до
   `docs/specs/review-freshness.md` (там — лише крос-посилання-стаб).
4. **Issue #7:** ширина card-mode `CARD_WIDTH` **×1.5 (480 → 720)**.
5. **Issue #9:** причину ПІДТВЕРДЖЕНО (ОС «Reduce motion»); фікс — централізований
   клас `.dd-spin` + виняток у reduced-motion (re-enable функціональних спінерів).
6. **Issue #3 (нормалізація `anchoredText`), зафіксовано:** парсер
   `lib/diff-parser.ts` НЕ тримає текст рядків (перевірено код) → розширити його
   (PURE) адитивним полем у `DiffHunk` (текст нової сторони, без маркера, вирівняний
   з `newLineNumbers`). `anchoredText` = нові-сторонні рядки з номерами ∈
   `[min(start,end)..max]`, кожен **rtrim** (лише трейлінг; відступи лишаємо),
   join `\n`; без інших нормалізацій. `sha256` рахує СЕРВЕР (запис+читання).
7. **Issue #3 (бейдж `content_changed`), зафіксовано:** та сама читабельна пара,
   що й `moved_out` (`--warn`/`--warn-bg`), окремий лейбл «Outdated — code changed»
   + тултіп (відрізняємо текстом, не кольором — WCAG).
8. **Issue #9 (`.dd-pulse`), зафіксовано:** live-пульси лишаємо рухомими під
   reduced-motion (сигналізують «йде live-процес»).
9. **Issue #10-E, зафіксовано:** ВІДКЛАСТИ як окремий follow-up; у цьому пакеті —
   лише A–D. Повертатись до E ЛИШЕ якщо A–D не прибрали стопори на практиці.

## Контекст розслідування (фон, щоб не передосліджувати)

Вкладка «Files changed» у DevDigest показує **кумулятивний діф усього PR**
(`base...head`), що **збігається з вкладкою GitHub «Files changed»** байт-у-байт.
Перевірено на PR #7 `SyukPublic/dev-digest` (`db659fae…`, head `1ffc6b4a`): обидва
файли `server/src/modules/share/*` — **нові** (`status: added`), тому діф PR = лише
додавання (`+50 −0` / `+153 −0`). «+/-» зі скриншота — це перегляд **одного
коміту** GitHub (`GET /commits/1ffc6b4` → `+12 −15`). **Staleness-багу немає** —
нижче реальні доробки. Модель оновлення `pr_files` (підтверджено): resync списку
(`upsertImportedPulls`) оновлює `head_sha`/статус, але НЕ `pr_files`; `pr_files`
оновлює лише `getDetail` на відкритті PR (`replacePrFiles`).

---

## Issue #1 — лічильники `+/-` і текст патча беруться з різних джерел

**Статус:** TODO · **Пріоритет:** середній · **Сюрфейс:** client

**Симптом:** у бейджах файлів («+50 −0») число може на одне завантаження
відставати від реально показаного патча після нового коміту.

**Корінь:** у Smart Diff вʼювері два різні джерела зливаються по `path`:
- `additions/deletions` ← `SmartDiffFile` ([helpers.ts:161](client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts:161),
  джерело `usePrSmartDiff` → `["smart-diff", prId]`, читає **збережені** `pr_files`);
- `patch` ← `PrFile` ([helpers.ts:166](client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts:166),
  `usePullDetail` → `["pull", prId]`, свіжий `getDetail` → GitHub).
- `getDetail` пише свіжі `pr_files` ([pulls/service.ts:151](server/src/modules/pulls/service.ts:151)),
  але `smart-diff` ([smart-diff/service.ts:31](server/src/modules/smart-diff/service.ts:31))
  і `getDetail` — окремі паралельні запити → на першому завантаженні counts
  відстають на один рендер.

**Фікс (2 кроки; почати з A):**
- **A (консистентність):** у `joinSmartDiff` брати `additions/deletions` з `PrFile`
  (`pull.data.files` — те саме джерело, що й `patch`); `smart-diff` лишити лише для
  ролей/порядку/`finding_lines`/`pseudocode_summary`.
- **B (сходимість):** інвалідувати `["smart-diff", prId]` після осідання
  `usePullDetail` (спільно з Issue #4B).

```ts
// helpers.ts joinSmartDiff — counts з PrFile, fallback на smart-diff
const meta = patchByPath.get(file.path); // { patch, additions, deletions } | undefined
return {
  ...,
  additions: meta?.additions ?? file.additions,
  deletions: meta?.deletions ?? file.deletions,
  patch: meta?.patch ?? null,
};
```

**Зачеплені файли:** `SmartDiffViewer/helpers.ts`, `lib/hooks/*` (інвалідація),
тест `SmartDiffViewer.test.tsx`.
**Skills:** `react-best-practices`, `react-testing-library`.
**Tests:** юніт `joinSmartDiff` — counts тягнуться з `PrFile`; за відсутності
`PrFile` — fallback на smart-diff.
**Критерій готовності:** після нового коміту бейдж `+/-` і патч показують однакові
числа вже на **першому** відкритті PR.

---

## Issue #2 — UI-підказка «сукупний діф PR відносно `<base>`»

**Статус:** TODO · **Пріоритет:** низький · **Сюрфейс:** client (+ i18n)

**Симптом:** користувач плутає кумулятивний діф PR (тільки `+` для нових файлів)
з перглядом окремого коміту GitHub (`+/-`).

**Фікс:** ненавʼязлива підказка біля «Files changed · N files» — «Сукупний діф PR
відносно `<base>`» (підставляти `pr.base` з `PrDetail`), опц. тултіп-пояснення.

**Зачеплені файли:** [DiffTab.tsx:74](client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:74)
(потрібно прокинути `base` пропом у `DiffTab` зі сторінки PR — зараз його немає),
i18n `client/messages/en/shell.json` під `diffViewer`.
**Skills:** `next-best-practices` (i18n через next-intl), `react-frontend-architecture`.
**Tests:** RTL — рядок із реальною назвою base рендериться; строка локалізована.
**Критерій готовності:** видно текст із реальним `base`; без хардкоду.

---

## Issue #3 — новий стан `content_changed` (L2-lite re-anchoring, без LLM)

**Статус:** TODO · **Пріоритет:** ВИСОКИЙ (суть скарги) · **Сюрфейс:**
reviewer-core + server + client · **= Stage 2b** до `review-freshness.md`

**Симптом:** коміт `1ffc6b4` виправив дефекти (видно в діфах), але finding-и
лишаються `current`, а не «Outdated».

**Корінь (підтверджено відтворенням):** `reviews.head_sha` штампується
(`4857bca6…`), `pull.head_sha=1ffc6b4a…` — гейт [service.ts:197](server/src/modules/reviews/service.ts:197)
заходить у гілку `anchorStatus`, але всі 16 finding-ів = `current`, бо
`anchorStatus` ([grounding.ts:96](reviewer-core/src/grounding.ts:96)) перевіряє лише
**присутність номера рядка** (`buildLineIndex`→`rangeIntersects`), а **не контент**.
Файли `share/*` — нові (`status: added`) → діф = один hunk на весь файл
(`@@ -0,0 +1,50 @@`) → усі рядки `1..N` «в гані» → `current`, хоч контент
переписано. Для added-файлів `moved_out`/`orphaned` практично НЕ спрацьовують. Це
задокументоване обмеження L1; виправляє його L2 (content re-anchoring).

**Фікс — L2-lite (детермінований, без LLM, onion-коректний):**
1. **reviewer-core (PURE):** додати екстрактор тексту анкера + розширити статус.
   ```ts
   // reviewer-core/src/grounding.ts
   export type AnchorStatus = 'current' | 'moved_out' | 'orphaned' | 'content_changed';

   /** Нормалізований текст НОВОЇ сторони діфа в межах finding-а ([start..end]),
    *  рядки trim-нуті праворуч і зʼєднані '\n'. null, якщо рядків немає.
    *  PURE — діф є входом; БЕЗ crypto (хеш рахує сервер). Потребує тексту рядків
    *  у `DiffHunk` — парсер розширюється в 1A (див. блок «ПІДТВЕРДЖЕНО» нижче). */
   export function anchoredText(finding: Finding, diff: UnifiedDiff): string | null { /* … */ }
   ```
   `anchorStatus(finding, diff)` лишається current|moved_out|orphaned (без змін).
2. **server / запис (run-executor):** після ґраундингу для кожного збереженого
   finding-а порахувати `sha256(anchoredText(f, diff))` (crypto у сервері) і
   зберегти в новий нульований стовпець `findings.anchor_fingerprint`.
   ```ts
   // run-executor: при insertFindings
   import { createHash } from 'node:crypto';
   const fp = (f) => { const t = anchoredText(f, diff); return t == null ? null
     : createHash('sha256').update(t).digest('hex'); };
   ```
3. **server / читання (`reviewsForPull`, [service.ts:193-203](server/src/modules/reviews/service.ts:193)):**
   після `anchorStatus`, якщо `current` і є збережений fingerprint — порівняти з
   поточним; розбіжність → `content_changed`.
   ```ts
   const st = anchorStatus(f, currentDiff);              // orphaned|moved_out|current
   if (st === 'current' && f.anchorFingerprint != null) {
     const t = anchoredText(f, currentDiff);
     const cur = t == null ? null : sha256(t);
     f.anchor_status = cur !== f.anchorFingerprint ? 'content_changed' : 'current';
   } else f.anchor_status = st;
   ```
   (Fingerprint рахується ОДНАКОВО на запис і читання — один шлях.)
4. **schema + міграція:** `findings.anchor_fingerprint text` (nullable; legacy =
   NULL = не порівнюємо → `current`). `pnpm db:generate`; MANUAL apply.
5. **contract:** розширити `anchor_status` НОВИМ значенням `content_changed`
   (enum → `current | moved_out | orphaned | content_changed`) у
   `vendor/shared/contracts/review-api.ts` → `sync-shared.mjs`.
6. **client:** додати рендер `content_changed` — бейдж «Outdated — code changed»
   у `FindingCard` (читабельна пара кольорів, див. Issue #5) і збір у секцію
   «Outdated findings» у `SmartDiffViewer` (поряд з `moved_out`/`orphaned`).

**Зачеплені файли:** `server/src/lib/diff-parser.ts` (+ `DiffHunk` у
`vendor/shared/contracts` — текст нової сторони, адитивно) → `sync-shared.mjs`;
`reviewer-core/src/grounding.ts` (+ `index.ts`),
`server/src/db/schema/reviews.ts` (+ міграція), `reviews/repository/review.repo.ts`
(`insertFindings` приймає fingerprint; `FindingRow` підхопить колонку),
`reviews/run-executor.ts` (стамп), `reviews/service.ts` + `helpers.ts`
(`reviewsForPull` порівняння; `anchor_status` уже в DTO), `review-api.ts`
(+`content_changed`) + `sync-shared.mjs`; client: `FindingCard.tsx`,
`SmartDiffViewer.tsx` + `helpers.ts`, i18n.
**Skills:** `onion-architecture` (core pure / crypto у сервері / DB у repo),
`drizzle-orm-patterns` + `postgresql-table-design` (нульований стовпець, міграція),
`zod` (enum-розширення, optional), `typescript-expert`; client —
`react-best-practices`, `react-testing-library`.
**Tests:** reviewer-core — `anchoredText` (екстракт+нормалізація) і таблиця
статусів, зокрема **added-file з переписаним контентом → `content_changed`**, а
незмінений → `current`; server `*.it.test.ts` — round-trip fingerprint, fast-path
(head незмінний), порівняння на читання; client RTL — бейдж/секція для
`content_changed`.
**Критерій готовності:** для PR #7 finding SQL-injection на `repository.ts` стає
`content_changed`; незмінені — `current`; `moved_out`/`orphaned`/fast-path як
раніше; без LLM і мережі.

**ПІДТВЕРДЖЕНО (перевірено код):** `lib/diff-parser.ts` тримає лише
`newLineNumbers` (БЕЗ тексту); `DiffHunk = { file, oldStart, oldLines, newStart,
newLines, newLineNumbers }`. Тому **перший крок 1A** — розширити парсер (PURE):
додати в `DiffHunk` (контракт `@devdigest/shared`, адитивно) текст нової сторони
на рядок (вирівняний з `newLineNumbers`, без маркера `+`/` `) і заповнити його в
`parseUnifiedDiff` ([diff-parser.ts:63-74](server/src/lib/diff-parser.ts:63), гілки
`+`-рядка та контексту). `anchoredText` будується вже над цим полем.

---

## Issue #4 — `anchor_status` оновлюється не одразу («сходинками»)

**Статус:** TODO · **Пріоритет:** ВИСОКИЙ · **Сюрфейс:** server + client ·
**Синергія з** Issue #1/#3

**Симптом:** після коміту бейджі «Outdated» зʼявляються через кілька релоадів
(«8 outdated» → «16 outdated»).

**Корінь:** `anchor_status` рахується в `reviewsForPull` з ДВОХ незалежно
синхронізованих сторів: `pull.head_sha` (оновлює лише list-sync
`upsertImportedPulls`, НЕ `getDetail` — [pulls/repository.ts:106](server/src/modules/pulls/repository.ts:106)
`updateDetail` не пише `headSha`) і `pr_files` (оновлює лише `getDetail`). Поки
`pull.head_sha` старий → fast-path усе `current`; якщо один зрушив, а інший ні →
неконсистентний знімок. До того ж `usePrReviews` ([reviews.ts:52](client/src/lib/hooks/reviews.ts:52))
не інвалідовується услід `usePulls`/`usePullDetail`; глобально `staleTime:30_000`
+ `refetchOnWindowFocus:false` ([providers.tsx:28](client/src/lib/providers.tsx:28)).

**Фікс:**
- **A (server, консистентність знімка):** `getDetail` персистить свіжий
  `pull.head_sha` (він уже є в `detail.head_sha`), щоб `pr_files`+`head_sha`
  рухались РАЗОМ.
  ```ts
  // pulls/repository.ts updateDetail — додати headSha у set
  // pulls/service.ts getDetail (success):
  await this.pulls.updateDetail(pr.id, { body: detail.body ?? null,
    additions: detail.additions, deletions: detail.deletions,
    filesCount: detail.files_count, headSha: detail.head_sha });
  ```
- **B (client, сходимість за один релоад):** інвалідувати `["reviews", prId]` і
  `["smart-diff", prId]`, коли змінюється `pr.head_sha`.
  ```ts
  // page.tsx (PR detail)
  React.useEffect(() => {
    if (!prId || !pr) return;
    qc.invalidateQueries({ queryKey: ["reviews", prId] });
    qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
  }, [prId, pr?.head_sha]);   // тільки на зміну head — без циклу
  ```
- **C (опц.):** на маршруті деталі знизити `staleTime` для цих запитів.

**Зачеплені файли:** `pulls/service.ts` (getDetail — спільний файл з Issue #10,
координувати), `pulls/repository.ts` (`updateDetail`), client `page.tsx` /
`lib/hooks`.
**Skills:** `onion-architecture` (DB у repo, сервіс оркеструє),
`drizzle-orm-patterns`, `react-best-practices` (derive, інвалідація по ключу).
**Tests:** server `*.it.test.ts` — `getDetail` пише `head_sha`; client — інвалідація
спрацьовує на зміну `head_sha`.
**Критерій готовності:** один релоад PR показує фінальні `anchor_status` атомарно;
немає залежності від 60s-полінгу.

---

## Issue #5 — бейдж `orphaned` нечитабельний (сіре на сірому)

**Статус:** TODO · **Пріоритет:** низький · **Сюрфейс:** client (UI/тема)

**Корінь:** [FindingCard.tsx:36](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:36)
— `orphaned: { color: "var(--stale)", bg: "var(--text-muted)" }`; темна тема
`--stale:#6b7280` на `--text-muted:#6a6a6a` → контраст ~0. `moved_out` коректно
бере `--warn`/`--warn-bg`.

**Фікс:** додати токен `--stale-bg` (обидві теми, напр. `rgba(107,114,128,0.14)`)
і дати `orphaned: { color:"var(--stale)", bg:"var(--stale-bg)" }`. Для
`content_changed` (Issue #3) — **зафіксовано** пару `--warn`/`--warn-bg` (як
`moved_out`) з окремим лейблом «Outdated — code changed». Перевірити WCAG
(≥3:1 UI / 4.5:1 текст).
**Зачеплені файли:** `FindingCard.tsx` (спільний з Issue #3-client),
`vendor/ui/styles.css` (токен; спільний з Issue #9 — координувати).
**Skills:** `react-frontend-architecture` (токени теми).
**Tests:** RTL — бейдж `orphaned` рендериться з не-muted фоном.
**Критерій готовності:** `orphaned`/`content_changed` читабельні в обох темах.

---

## Issue #6 — у findings-popover кнопки-фільтри переносяться

**Статус:** TODO · **Пріоритет:** низький · **Сюрфейс:** client (UI)

**Корінь:** `DEFAULT_WIDTH=400` ([FindingsFilterPopover.tsx:16](client/src/components/findings/FindingsFilterPopover.tsx:16))
мінус padding `filterRow` ≈372px; `SeverityFilter` має `flexWrap:"wrap"`
([SeverityFilter.tsx:27](client/src/vendor/ui/primitives/SeverityFilter.tsx:27)) →
три чипи не вміщаються.

**Фікс:** підняти `DEFAULT_WIDTH` (~460–480); `flexWrap` лишити запобіжником; не
чіпати спільний `SeverityFilter`. Клемп позиції вже тримає в межах екрана.
**Зачеплені файли:** `FindingsFilterPopover.tsx` (СПІЛЬНИЙ з Issue #7 — робити
разом одним слайсом).
**Skills:** `react-frontend-architecture`.
**Tests:** RTL — три чипи в один рядок на дефолтній ширині.
**Критерій готовності:** `CRITICAL`/`WARNING`/`SUGGESTION` в один рядок; на
вузькому екрані не вилазить.

---

## Issue #7 — card-popover вилазить за екран; ширше ×1.5; movable

**Статус:** TODO · **Пріоритет:** середній · **Сюрфейс:** client (UI)

**Корінь:** клемпиться лише горизонталь; `top = anchor.bottom + 6` без
клемпу/перевороту ([FindingsFilterPopover.tsx:91-92](client/src/components/findings/FindingsFilterPopover.tsx:91)).
Якір унизу → fixed-панель вилазить під в'юпорт; сторінка fixed не скролить.
Card-mode `CARD_WIDTH=480`.

**Фікс (3 частини):**
- **A — розміщення (root, обовʼязково):** вертикальний клемп/переворот за аналогією
  з `left`; вимірювати висоту панелі (`useLayoutEffect`+ref); якщо знизу бракує —
  відкривати над якорем або клемпити `top + height ≤ innerHeight - 8`.
- **B — ширше ×1.5:** `CARD_WIDTH` 480 → **720**; клемп до `innerWidth - 16`.
- **C — movable:** drag за хедер `FINDINGS [X]` (`cursor:move`, крім кнопки X);
  підняти `top/left` у `useState` (ініт з A), drag оновлює, тримати в межах екрана.

**Зачеплені файли:** `FindingsFilterPopover.tsx` (+ `findings/styles.ts` cursor) —
СПІЛЬНИЙ з Issue #6.
**Skills:** `react-best-practices` (state vs derived; pointer events),
`react-testing-library`.
**Tests:** RTL/jsdom — за низького `anchor` `top` клемпиться так, що
`top+height ≤ innerHeight`; ширина 720 (клемп до екрана); drag оновлює позицію.
**Критерій готовності:** popover завжди в межах в'юпорта (зокрема якір унизу/праворуч);
ширший ×1.5; перетягується за шапку; внутрішній скрол `cardBody` лишається.

---

## Issue #8 — `Recompute` внизу, коли intent ще не розраховано

**Статус:** TODO · **Пріоритет:** низький · **Сюрфейс:** client (UI)

**Корінь:** у гілці `intent == null` `SectionLabel` без `right`, кнопка в кінці
`Card` ([IntentCard.tsx:142-154](client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:142));
у розрахованому стані — `right={recomputeButton}` ([IntentCard.tsx:159](client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:159)).

**Фікс:** у гілці `intent == null` передати кнопку в `right`-слот і прибрати
трейлінговий `{recomputeButton}`:
```tsx
<SectionLabel icon="Target" right={recomputeButton}>{t("block.intent")}</SectionLabel>
<p>…unavailable…</p><p>…unavailableHint…</p>   {/* без {recomputeButton} в кінці */}
```
**Зачеплені файли:** `IntentCard.tsx`.
**Skills:** `react-best-practices`.
**Tests:** `IntentCard.test.tsx` — у стані «unavailable» кнопка у `right`-слоті.
**Критерій готовності:** `Recompute` у правому верхньому куті в ОБОХ станах;
aria-live незмінні.

---

## Issue #9 — спінери завмирають при `prefers-reduced-motion` (ЦЕНТРАЛІЗОВАНО)

**Статус:** TODO · **Причину ПІДТВЕРДЖЕНО** (ОС «Reduce motion») · **Пріоритет:**
низький · **Сюрфейс:** client (UI/тема, a11y)

**Корінь:** код анімації коректний (`Button` loading → `RefreshCw` +
`animation: ddspin` [Button.tsx:82](client/src/vendor/ui/primitives/Button.tsx:82);
keyframes [styles.css:225](client/src/vendor/ui/styles.css:225)). Бланкетний
`@media (prefers-reduced-motion: reduce) { * { animation-duration:0.01ms!important } }`
([styles.css:286](client/src/vendor/ui/styles.css:286)) морозить УСІ анімації,
включно з функціональними спінерами/skeleton/live-пульсами.

**Фікс (централізовано, щоб покрити ВСІ спінери):**
1. Утиліта: `.dd-spin { animation: ddspin 1s linear infinite; }` (+ опц. `.dd-pulse`).
2. У reduced-motion після бланкетного скидання — ВИНЯТОК:
   `.dd-spin{animation-duration:1s!important}` `.skeleton{animation-duration:1.4s!important}`
   (+ опц. `.dd-pulse`); декоративні входи (`ddpop`/`ddfadein`/`ddslidein`/
   `ddToastIn`) лишаються приглушеними.
3. Перевести ВСІ обертові спінери з інлайнового `animation:"ddspin…"` на `.dd-spin`:
   `Button.tsx:82` (покриває всі `<Button loading>`), `FindingsTab.tsx:100`
   (`Loader2`), `SkillCard.tsx:51`, `AgentCard.tsx:58`, `ReviewRunAccordion.tsx:127`.
4. «Живі» `ddpulse` (`LiveLogStream.tsx:94,129`, `AutoTriggerStatus.tsx:34`) → `.dd-pulse`.
   `aria-busy`/`aria-live` усюди лишаються.

**Зачеплені файли:** `vendor/ui/styles.css` (СПІЛЬНИЙ з Issue #5 — координувати),
`Button.tsx`, `FindingsTab.tsx`, `SkillCard.tsx`, `AgentCard.tsx`,
`ReviewRunAccordion.tsx`, `LiveLogStream.tsx`, `AutoTriggerStatus.tsx`.
**Skills:** `react-frontend-architecture` (утилітні класи/токени).
**Tests:** ручна перевірка в DevTools з емуляцією `prefers-reduced-motion: reduce`
(юніт на CSS-медіа складний — мінімум перевірити, що спінери мають клас `.dd-spin`).
**Критерій готовності:** при «Reduce motion» УСІ спінери активні; декоративні входи
приглушені; без reduced-motion поведінка незмінна.

---

## Issue #10 — 30s «Operation timed out» на GitHub-викликах блокує UI

**Статус:** TODO · **Пріоритет:** середній · **Сюрфейс:** server (adapter/resilience)

**Симптом:** інколи `getDetail`/list-sync «зависають» 30s; лог
`TimeoutError: Operation timed out after 30000ms` + WARN «no token / offline»;
запит завершується 200 (persisted), але пізно.

**Корінь:** `withRetry(() => withTimeout(fn, 30_000))` ([octokit.ts:18](server/src/adapters/github/octokit.ts:18));
`TimeoutError` не ретраябельний ([resilience.ts:35-44](server/src/platform/resilience.ts:35))
→ одинарний 30s-блок. `octokit@4` має вбудовані `retry`+`throttling` → внутрішні
ретраї/сон з backoff усередині нашого 30s-вікна. Токен Є; WARN «no token /
offline» — лише generic-текст catch-блоку (вводить в оману). Це латентність +
діагностика, не падіння (local-first віддає persisted).

**Фікс:**
- **A — коротший таймаут:** `TIMEOUT` 30_000 → **10_000** (GitHub p99 субсекундний).
- **B — ретрай на свіжому зʼєднанні:** зробити `TimeoutError`/мережу ретраябельними
  з КОРОТКИМ per-attempt таймаутом + `retries: 1` для GitHub-шляху.
  ```ts
  // resilience.ts defaultIsRetryable — додати:
  if (err instanceof TimeoutError) return true;       // таймаут = транзієнт
  // octokit.ts — обмежити кількість:
  withRetry(() => withTimeout(call(), TIMEOUT), { retries: 1 });  // worst ~2×10s
  ```
- **C — приборкати внутрішні ретраї Octokit:** `new Octokit({ auth, retry:{ retries:0 },
  request:{ signal: AbortSignal.timeout(TIMEOUT) } })` — щоб застопорений сокет
  аборт ився швидше і не було подвійного (Octokit×наш) ретраю. ⚠ звірити API з
  `octokit@4` (version-sensitive).
- **D — чесне повідомлення:** у catch розрізняти `TimeoutError`/мережу vs
  `ConfigError`; логувати `err.name`/тип замість завжди «no token / offline».
- **E (follow-up, ВІДКЛАДЕНО):** GitHub-refresh для detail/list зробити фоновим
  (миттєво persisted → async-оновлення → клієнт перезапитує; перетин з Issue #4B).
  Окремий issue, НЕ в цьому пакеті (рішення зафіксовано); повертатись лише якщо
  A–D не прибрали стопори на практиці.

**Зачеплені файли:** `adapters/github/octokit.ts` (TIMEOUT, опції Octokit, per-call
retry), `platform/resilience.ts` (предикат), `pulls/service.ts` (catch WARN —
СПІЛЬНИЙ з Issue #4A, координувати), `polling/service.ts` (WARN).
**Skills:** `onion-architecture` (resilience/SDK у адаптері/платформі),
`fastify-best-practices` (логування Pino), version-check Octokit.
**Tests:** unit `resilience` — `TimeoutError` тепер ретраябельний; ретрай на свіжому
attempt; з обмеженням `retries` worst-case ≤2×TIMEOUT.
**Критерій готовності:** transient-стопор деградує ≤~10s; короткий ретрай відновлює
частину випадків; лог показує `TimeoutError`/мережу замість «no token»; немає
подвійного ретраю.
**Діагностика:** при таймауті логувати GitHub `x-ratelimit-remaining`/`-reset`,
`retry-after`, щоб відрізнити мережевий стопор від throttling.

---

## Фази імплементації (диз'юнктні, паралелізовані слайси)

> Порядок залежностей: **Фаза 1 (backend)** і **Фаза 2 (frontend)** переважно
> незалежні; єдина крос-фазна залежність — Issue #3-client (Фаза 2) потребує
> контракт-enum `content_changed` із Фази 1. Слайси в межах фази НЕ перетинаються
> по файлах (де перетин — позначено «коорд.»), тож виконуються паралельно.

### Фаза 1 — Backend
- **Слайс 1A — Issue #3 (core+reviews+contract+міграція).** reviewer-core
  (`anchoredText` + enum), `findings.anchor_fingerprint` + міграція,
  `review.repo.ts`/`run-executor.ts` (стамп), `reviews/service.ts` (порівняння),
  `review-api.ts` + `sync-shared.mjs`. **ПЕРШИЙ крок** — розширити
  `lib/diff-parser.ts` + `DiffHunk` (PURE, текст нової сторони): від цього
  залежить `anchoredText`. Skills: `onion-architecture`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `zod`. Має МІГРАЦІЮ (MANUAL apply).
- **Слайс 1B — Issue #4A + #10 (pulls + github + resilience).** Один власник усіх
  файлів `pulls/service.ts` (getDetail success `headSha` + catch WARN),
  `pulls/repository.ts` (`updateDetail` headSha), `adapters/github/octokit.ts`,
  `platform/resilience.ts`, `polling/service.ts`. БЕЗ міграції. Skills:
  `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`.
- 1A і 1B диз'юнктні (reviews/* vs pulls+github+resilience) → паралельно.

### Фаза 2 — Frontend (1 крос-залежність: 2B ← контракт із 1A)
- **Слайс 2A — Issue #1 + #4B (data-flow).** `SmartDiffViewer/helpers.ts` (counts
  з `PrFile`), `lib/hooks`/`page.tsx` (інвалідація `reviews`+`smart-diff` на зміну
  `head_sha`). Skills: `react-best-practices`, `react-testing-library`.
- **Слайс 2B — Issue #5 + #9 + #3-client (бейджі/тема/спінери).** `styles.css`
  (`--stale-bg` + `.dd-spin`/`.dd-pulse` + reduced-motion виняток), `FindingCard.tsx`
  (orphaned колір + `content_changed` бейдж), `SmartDiffViewer` (`content_changed`
  у «Outdated»), спінер-рефактор (`Button`, `FindingsTab`, `SkillCard`, `AgentCard`,
  `ReviewRunAccordion`, `LiveLogStream`, `AutoTriggerStatus`) + i18n. Один власник
  (спільні `styles.css` + `FindingCard.tsx`). **Залежить від** контракту 1A.
- **Слайс 2C — Issue #6 + #7 (popover).** Весь `FindingsFilterPopover.tsx`
  (+ `findings/styles.ts`) — один власник. Skills: `react-best-practices`, RTL.
- **Слайс 2D — Issue #2 + #8 (дрібний UI).** `DiffTab.tsx`+`shell.json` (#2),
  `IntentCard.tsx` (#8) — диз'юнктні. Skills: `react-best-practices`, `next-best-practices`.

### Фаза 3 — Wrap-up
- Прогнати `reviewer-core` / `server` (вкл. `*.it.test.ts`) / `client` до зеленого;
  `pnpm typecheck` усюди; `arch:check`; `sync-shared.mjs --check`.
- `engineering-insights`: записати (а) L2-lite `content_changed` (fingerprint у
  сервері, екстракт у core), (б) reduced-motion глушив функціональні спінери →
  `.dd-spin`-виняток, (в) `getDetail` тепер персистить `head_sha` для консистентного
  знімка `anchor_status`.
- Крос-посилання-стаб у `docs/specs/review-freshness.md` → «Stage 2b = Issue #3».

## Ризики та мітигації

- **Парсер без тексту рядків (Issue #3).** Найбільший ризик. Мітигація: 1A
  СПОЧАТКУ перевіряє `lib/diff-parser.ts`; за потреби розширює парсер (PURE) на
  текст нової сторони, з юнітом.
- **Асиметрія fingerprint запис/читання → хибний `content_changed`.** Один пурний
  `anchoredText` + один `sha256`-шлях; юніт, що однакові входи дають однаковий хеш.
- **Подвійний ретрай (Octokit×наш) множить затримку (Issue #10).** `retry:{retries:0}`
  в Octokit + `retries:1` у нашому `withRetry`.
- **`TimeoutError` ретраябельний глобально** зачіпає всіх користувачів `withRetry`;
  обмежити worst-case через `retries` на GitHub-шляху; звірити інші виклики.
- **Міграція не застосовується авто.** Лише `pnpm db:generate`; у PR-body —
  нагадування `pnpm db:migrate` (MANUAL).
- **Спільні файли між слайсами** (`styles.css`: #5/#9; `FindingCard.tsx`: #5/#3;
  `FindingsFilterPopover.tsx`: #6/#7; `pulls/service.ts`: #4A/#10) — призначати
  ОДНОМУ власнику на слайс (відображено у фазах).

## Відкриті питання — ВСІ ВИРІШЕНІ (2026-06-27)

- **Issue #3 нормалізація `anchoredText`** — РІШЕНО (перевірено код): парсер не
  тримає тексту → розширити PURE; нові-сторонні рядки в `[min(start,end)..max]`,
  rtrim, join `\n`; `sha256` у сервері. Включає `+`-рядки ТА контекст (усе, що
  `newLineNumbers` позначає покритим) — узгоджено з `anchorStatus`. Див.
  «Підтверджені рішення» #6.
- **Issue #3 нормалізація — контекстні рядки:** РІШЕНО — включаємо (так само, як їх
  включає `buildLineIndex`/`anchorStatus`), щоб fingerprint і статус були консистентні.
- **Issue #10-E (фоновий refresh)** — РІШЕНО: ВІДКЛАДЕНО як окремий follow-up;
  у пакеті лише A–D. Див. «Підтверджені рішення» #9.

**Звірити ПІД ЧАС імплементації (version-sensitive, не блокує план):** точна форма
опцій `octokit@4` для #10-C (`retry: { retries }`, `request.signal` /
`request.fetch`, throttle-хендлери) — підтвердити проти ВСТАНОВЛЕНОЇ версії
(`octokit@^4`) + офіційних доказів перед застосуванням (правило AGENTS.md).

---

## Backlog / наступні проблеми

> Поповнюється далі по ходу сесії.

- _(додати)_
