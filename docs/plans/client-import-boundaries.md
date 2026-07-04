# Development Plan: client import-boundary lint cleanup

> **Статус:** APPROVED (2026-06-28) — Fix A + Fix B (варіант **B2**, динамічний список), ОДИН спільний коміт. Прибрати 4 pre-existing eslint-помилки
> у клієнті (`client pnpm lint` зараз червоний) + (на обговоренні) закрити прогалину
> в `ROUTE_FEATURES`. Не стосується пакету L03 — окремий tech-debt cleanup, окремий коміт.

## Контекст / корінь

`client/eslint.config.mjs` робить route-features під `src/app/<feature>` приватними:
спільний код — лише через `@/components`, `@/lib`, `@/vendor`. Два правила:
- `no-restricted-imports` — банить будь-який `@/app/**` і глибокі `^(\.\./){3,}`.
- `import/no-restricted-paths` — зони з `ROUTE_FEATURES = ["agents","onboarding","repos","settings"]`:
  файл під `./src/app/<feature>` не може імпортувати з `./src/app` окрім свого ж піддерева.

Два маленькі **pure** модулі (лише типи з `@devdigest/shared`, без React) живуть у
route-private `app/skills/_components/` і тягнуться ззовні → 4 помилки (3 файли):

| Символ | Джерело сьогодні | Зовнішній імпортер | Помилки |
|---|---|---|---|
| `typeColor` | `app/skills/_components/SkillCard/helpers.ts` | `agents/[id]/.../SkillsTab/SkillsTab.tsx` | **2** (`no-restricted-imports` + `no-restricted-paths`: cross-feature agents→skills) |
| `isUntrustedSource` | той самий `helpers.ts` | `skills/[id]/.../PreviewTab/PreviewTab.tsx` | **1** (`@/app/**`) |
| `SKILL_TYPE_VALUES` | `app/skills/_components/skill-constants.ts` | `skills/[id]/.../ConfigTab/ConfigTab.tsx` | **1** (`@/app/**`) |

Pre-existing: ці файли/імпорти НЕ входять до L03-коміту `b434388`.

## Fix A — винести спільні skill-доменні символи у `@/lib` (core зміна)

Обидва модулі — pure domain helpers/constants (не компоненти) → санкціонований дім
`@/lib` (за зразком `lib/format.ts`, `lib/github-urls.ts`).

1. **NEW `client/src/lib/skills.ts`** — консолідує всі три символи (імена + JSDoc 1:1):
   `SKILL_TYPE_VALUES`, `typeColor`, `isUntrustedSource`.
2. **Перенацілити 5 імпортерів** на `@/lib/skills`:
   - `agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx` (`typeColor`) — −2 помилки
   - `skills/[id]/_components/SkillEditor/_components/PreviewTab/PreviewTab.tsx` (`isUntrustedSource`) — −1
   - `skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx` (`SKILL_TYPE_VALUES`) — −1
   - `skills/_components/SkillCard/SkillCard.tsx` (`./helpers` → `@/lib/skills`) — джерело переїхало
   - `skills/_components/CreateSkillModal/CreateSkillModal.tsx` (`../skill-constants` → `@/lib/skills`) — те саме
3. **Видалити спорожнілі** `app/skills/_components/SkillCard/helpers.ts` та
   `app/skills/_components/skill-constants.ts` (інших експортів немає).
   Перевірити барелі (`SkillCard/index.ts` тощо) на ре-експорт цих символів; репоінт за потреби.

## Fix B — закрити прогалину `ROUTE_FEATURES` (ПІД ОБГОВОРЕННЯМ)

`ROUTE_FEATURES` = `["agents","onboarding","repos","settings"]`, але реальні top-level
features включають ще **`skills`** і **`conventions`** (мають `page.tsx`). Тобто файли під
`skills/**` і `conventions/**` НЕ охороняються `import/no-restricted-paths` як importer-и
(zone-правило їх не націлює) — лишається лише частковий backstop `@/app/**`/deep-relative.

**Заґрунтовано:** додавання `skills`+`conventions` дає **0 нових порушень** (єдині cross-feature
імпорти сьогодні — 3× `@/app/skills/...`, які Fix A прибирає; deep-relative cross-feature — 0).
→ Безкоштовне hardening.

Дві опції закриття (обрати на обговоренні):
- **B1 (мінімальна):** додати `"skills","conventions"` у масив + коментар «тримати в синку з
  усіма `src/app/<feature>` дирами».
- **B2 (drift-proof):** обчислювати `ROUTE_FEATURES` динамічно — `readdirSync('./src/app')`,
  лише директорії, без `[...]`-сегментів і `_`-префіксних. Жодного майбутнього дрейфу.

**ОБРАНО: B2** (динамічний список з ФС) — усуває корінь дрейфу (майбутні features
підхоплюються автоматично). Реалізація: у `eslint.config.mjs` обчислити список,
відносно теки конфіга (`dirname(fileURLToPath(import.meta.url))` + `node:path` `join`,
НЕ від cwd), через `readdirSync(<…>/src/app, { withFileTypes: true })` →
`.filter(d => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('_') && !d.name.startsWith('.'))`
`.map(d => d.name)`. Оновити коментар-шапку (рядки 10-18), що список тепер похідний.

## Верифікація
- `cd client && pnpm lint` → **0 errors** (4 зникли; з Fix B — без нових).
- `pnpm typecheck` (шляхи резолвляться) + `pnpm test` (зміна суто механічна, нульова поведінкова).

## Коміт
ОДИН спільний коміт: `refactor(client): move shared skill helpers to @/lib + derive import-boundary zones`.
Локально, без push (pr-self-review лишається на push/PR).

## Межі / ризики
- Нульова зміна поведінки — лише переміщення pure-функцій/константи + репоінт.
- B виявляє 0 нових порушень (статично перевірено); фінальне підтвердження — `pnpm lint` під час імплементації.
- Поза обсягом: жодних backend/контракт/L03 змін.
