# Development Plan: чотири нові Claude Code субагенти (test-writer, architecture-reviewer, plan-verifier, doc-writer)

## Context

У `.claude/agents/` уже живуть три субагенти — `researcher.md`, `implementation-planner.md`,
`implementer.md` — які формують конвеєр «дослідити → спланувати → реалізувати». Бракує
агентів для **наступних** стадій життєвого циклу зміни: написання тестів, архітектурного
аудиту, звіряння реалізації з планом і документування. Ця зміна додає ЧОТИРИ нові
інфраструктурні агенти (не продуктову фічу DevDigest), кожен — окремий файл
`.claude/agents/<name>.md` з YAML-frontmatter. Усі чотири мають наслідувати формат і
конвенції наявних трьох агентів 1-в-1 (frontmatter `name`/`description`/`model`/`tools`/
опційно `skills`; тіло: роль → Hard constraints → project-map / skills-per-surface →
Working loop → Output format → Reply language), оскільки final message агента = return value
для оркестратора.

Перевірений стан репозиторію (звірено з реальним репо станом на 2026-06-25):
- `.claude/agents/` — `researcher.md`, `implementation-planner.md`, `implementer.md`, `README.md`.
- `.claude/settings.json` — має `PreToolUse` hook ЛИШЕ на `Bash` (pre-publish self-review gate)
  і `Stop` hook (insights). Hook на `Write`/`Edit` відсутній.
- `docs/specs/` існує (містить `run-cost.md`).

**Рішення користувача щодо write-boundary (ключове для дизайну):** механічного path-enforcement
**НЕ вводимо**. Межа запису для test-writer і doc-writer тримається на ДВОХ м'яких рівнях:
(1) `tools`-whitelist у frontmatter (визначає, ЧИ є `Write`/`Edit` взагалі); (2) ЖОРСТКЕ
промпт-правило в Hard constraints + явне речення в `description`. Окремих `PreToolUse`-хуків і
Node-валідаторів ця зміна **не створює** — це свідоме рішення (див. Risks). Зауваження на
майбутнє: жорсткий хук технічно можливий через блок `hooks:` у frontmatter САМОГО субагента
(хуки в `settings.json` для субагентів не спрацьовують — кожен субагент має власну сесію;
звірено з офіційними доками Claude Code 2026-06-25). Це лишається опційним майбутнім
посиленням, якщо промпт-дисципліна виявиться недостатньою — у поточну зміну воно НЕ входить.

Очікуваний результат: чотири нові коректно написані агентські файли, повністю диз'юнктні
(кожен — один `.md`), тож їх можна реалізувати паралельними implementer-ами.

## Affected packages & files

Це інфраструктура агентів, не пакети DevDigest. Конкретні файли (по одному `.md` на фазу):

- `.claude/agents/test-writer.md` — НОВИЙ. Агент, що пише UI- і backend-тести. Phase 1.
- `.claude/agents/architecture-reviewer.md` — НОВИЙ. Read-only архітектурний аудитор. Phase 2.
- `.claude/agents/plan-verifier.md` — НОВИЙ. Read-only верифікатор покриття вимог плану. Phase 3.
- `.claude/agents/doc-writer.md` — НОВИЙ. Агент документації + Mermaid. Phase 4.

> `.claude/settings.json` і `.claude/hooks/` **НЕ змінюються** цією зміною (write-boundary
> тримається на tools + промпт-дисципліні, без нових хуків/валідаторів — рішення користувача).

Шаблонний матеріал (форма frontmatter, порядок секцій, спільні Hard-constraints, Reply-language,
Output-format каркас) ВИНЕСЕНО дослівно у **§Shared scaffold** нижче — implementer бере його ЗВІДТИ
і НЕ перечитує `implementer.md` / `researcher.md` / `implementation-planner.md` пофазно (відкривати ці
файли лише якщо pack справді недостатній для крайового випадку).

## Shared scaffold (context pack — прочитати ОДИН раз, реюзати дослівно)

> **Призначення:** усунути найбільшу приховану витрату — повторне читання тих самих шаблонних файлів
> кожним із 4 паралельних implementer-ів. Усе спільне для всіх чотирьох агентів зібрано тут ДОСЛІВНО з
> цитатами-джерелами. Implementer-и беруть ці фрагменти ЗВІДСИ і НЕ перечитують
> `researcher.md` / `implementation-planner.md` / `implementer.md` пофазно — best-practices кожного
> агента вже inline у його фазі (готові фрагменти, не «йди прочитай там»).

### S1. Порядок секцій тіла (однаковий для всіх 4 агентів)
`# <name>` → роль (1 абзац) → `## Hard constraints (non-negotiable)` → project-map / skills-per-surface
таблиця (за потреби) → `## Working loop` (нумерований) → `## Output format` → `## Reply language`.

### S2. Frontmatter-кістяк
```yaml
---
name: <name>
description: >-
  <тригер-фрази для авто-роутингу + явне розмежування зони проти сусідніх агентів>
model: <sonnet | opus>
tools: <whitelist>
skills:                  # preloaded always-on ONLY — surface skills load on demand via the Skill tool (see table in body)
  - <skill>              # лише always-on; ПОЛЕ ОПУСТИТИ повністю, якщо preloaded не потрібні (напр. plan-verifier)
---
```
(рядок-коментар біля `skills:` — дослівно з `implementation-planner.md:15` / `implementer.md:15`.)

### S3. Reply language — секція ДОСЛІВНО (ідентична в усіх; джерело `researcher.md:145-151`)
```markdown
## Reply language

Follow the project rule (AGENTS.md): detect the natural language of the request and reply in that same
language, when feasible. Keep code, identifiers, file paths, CLI commands, and quoted strings verbatim.
The section headings shown above may stay in English; the prose you write around them should match the
user's language.
```

### S4. Read-only Bash whitelist — ДОСЛІВНО (для read-only агентів Phase 2/3; джерело `researcher.md:24-29`)
> **Read-only.** ... With `Bash`, use only non-mutating, read-only commands (e.g. `git log`, `git show`,
> `git diff`, `ls`, `cat`, `rg`, `find`, `wc`). NEVER run commands that change state (no
> `git commit/push/checkout`, no `rm`, `mv`, `mkdir`, `npm install`, package builds, migrations, writes,
> or redirections like `>`/`>>`).

### S5. Спільні Hard-constraints (вставити в КОЖЕН агент)
- **No publishing actions:** не `git commit`/`push`/`gh pr create`/merge; не запускати міграції
  (`pnpm db:migrate` — MANUAL, власник — користувач). (джерело `implementer.md:57-60`)
- **Verify, don't recall:** заземлювати кожне рішення у скілах + реальному коді, не в пам'яті; reuse перед
  новим кодом (adopt → adapt → invent). (джерело `implementer.md:64-66`)

### S6. Output-format каркас (final message = return value; патерн з `implementer.md:111-135`)
```markdown
## <Agent> report — <scope>

**Status:** done | blocked
<далі — секції, специфічні для агента; точний перелік див. у «Output format» його фази>
```

## Phases

Усі чотири агентські файли (Phase 1–4) диз'юнктні (різні файли, жодного перетину) → запускати
паралельно різними implementer-ами. Жодна фаза не редагує спільні файли (`settings.json`,
`.claude/hooks/`, код).

### Phase 1 — `test-writer`
- **Surface:** cross-cutting (агентський файл) — сам агент покриває client + server + reviewer-core тести.
- **Disjoint scope:** ВЛАСНИК лише `.claude/agents/test-writer.md`. Не торкатися інших агентів,
  settings.json, hooks, коду.
- **Depends on:** none.
- **Authoring inputs (без re-read):** форму брати з **§Shared scaffold** (S1–S6); RTL-правила і
  backend-правила вже inline нижче в цій фазі. НЕ перечитувати `implementer.md` і НЕ викликати скіли
  (`react-testing-library`/`fastify-best-practices`) під час авторингу — це готові фрагменти, не «йди
  прочитай». (Завантаження скілів on-demand — це поведінка САМОГО test-writer у runtime, описана в тілі.)
- **What changes & why:** створити агента, що пише тести і для UI, і для backend, спираючись на скіли
  проєкту, і пише ВИКЛЮЧНО в тестові шляхи (не чіпає продакшн-код) — межа задана `tools`-whitelist +
  промпт-дисципліною (без механічного хука).
- **Frontmatter (точно):**
  - `name: test-writer`
  - `description: >-` блок із тригер-фразами авто-роутингу: "write tests", "add tests", "cover with tests",
    "unit test", "integration test", "test this component/route/service", "RTL", "vitest". Має явно містити
    речення: **"Writes ONLY to test files; never modifies production source."** Має ТАКОЖ розмежувати зону
    проти сусіднього агента: на відміну від `implementer` (пише продакшн-код + тести для слайсу) — пише
    ВИКЛЮЧНО тести й ніколи не чіпає продакшн-код.
  - `model: sonnet`
  - `tools: Read, Write, Edit, Bash, Grep, Glob, Skill`
  - `skills:` (always-on preloaded ONLY) → `typescript-expert` (з коментарем
    `# preloaded always-on ONLY — surface skills load on demand via the Skill tool`).
- **Skills-per-surface таблиця (в тілі, on-demand через Skill tool):**
  - `client/**` тести → `react-testing-library` (+ `react-frontend-architecture` / `react-best-practices` /
    `next-best-practices` для контексту UI під тестом).
  - `server/**`, `reviewer-core/**` тести → `fastify-best-practices`, `drizzle-orm-patterns`.
  - `@devdigest/shared` контракти → `zod`.
- **Hard constraints (вписати в тіло):**
  - **Write-boundary (промпт-дисципліна — єдиний рівень enforcement):** писати/редагувати ВИКЛЮЧНО
    тестові файли — `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, файли в `**/__tests__/**`,
    та будь-що в `e2e/**`. НІКОЛИ не редагувати продакшн-джерела, schema, конфіги, міграції. Якщо тест
    вимагає зміни продакшн-коду — зафіксувати як follow-up для implementer, не робити самому. (Механічного
    хука немає — дотримання межі є прямою відповідальністю агента; сформулювати це жорстко й однозначно.)
  - **No write-boundary bypass via Bash:** НЕ використовувати `Bash` для запису у продакшн-файли через
    редирект (`echo ... > file`, `tee`, `cat > file`, heredoc у файл). `Bash` призначений ЛИШЕ для
    `pnpm test` та read-only діагностики.
  - **Mock-policy ПО ШАРАХ (анти-«test theatre»):** service-тест = stub repository-порту; repository-тест =
    реальний Postgres із транзакційним rollback (`drizzle-orm-test`), НЕ мокати ORM; route-тест = `app.inject`
    з реальним DI, мокати лише зовнішні HTTP (LLM/GitHub) через fake-адаптер/MSW. НІКОЛИ не мокати unit-under-test.
    Кожен тест — мінімум 1 ассерт на спостережувану поведінку, не лише на call-count. (Агенти зловживають моками
    36% проти 26% у людей — це задокументований антипатерн.)
  - **Intention-guided generation:** перед написанням явно сформулювати (юніт / вхід / що повертають стаби /
    очікуваний вихід), потім код.
  - **Self-verification (блокуючий gate):** після написання запустити `pnpm test` пакета у WSL
    (`Ubuntu-24.04-dev-digest-test`, repo за WSL-mount шляхом — див. CLAUDE.local.md); чесно звітувати
    passed/failed/skipped + coverage delta; НЕ оголошувати done якщо є failing або `.skip`; не послаблювати
    тести заради зеленого.
  - **No publishing actions:** не commit/push/PR; не запускати міграції.
  - **Verify, don't recall:** заземлювати рішення в скілах + реальному коді, не в пам'яті.
- **RTL/Vitest правила (в тілі, як checklist):** пріоритет запитів `getByRole` > `getByLabelText` >
  `getByText` > `getByTestId` (останній засіб); завжди `await userEvent`; `findBy*` для async; спільний
  test-utils `render` з провайдерами; без великих snapshot-ів — конкретні ассерти; reset моків/таймерів
  after each; async Server Components Vitest НЕ тестує → E2E.
- **Backend правила (в тілі):** build app один раз у `beforeAll`, `app.close()` у `afterAll`; для Zod-контрактів
  слати невалідний payload і чекати 400 (перевіряти response-shape, не 500).
- **Output format (обов'язково, final message = return value):** markdown-шаблон ~ як в `implementer.md`:
  `## Test-writer report — <scope>` → **Status** (done|blocked) → **Surface(s)** → **Test files written**
  (список шляхів, кожен з one-line що покриває) → **Test run** (команда `pnpm test`, результат
  passed/failed/skipped, coverage delta) → **Mock policy applied** (який рівень → який підхід до моків) →
  **Skills applied** → **Follow-ups / blockers** (напр. «потрібна зміна продакшн-коду поза моїм write-boundary»).
- **Reply language:** секція за правилом AGENTS.md (визначай мову запиту; code/identifiers/paths verbatim).
- **Acceptance criteria:**
  - Файл `.claude/agents/test-writer.md` існує, валідний YAML-frontmatter.
  - `tools` містить `Write, Edit` (агент пише тести) і `Bash` (запуск `pnpm test`).
  - `model: sonnet`.
  - `skills:` має ЛИШЕ `typescript-expert` (always-on), з коментарем про on-demand завантаження.
  - В `description` присутнє дослівно "Writes ONLY to test files; never modifies production source."
  - **В `description` явно розмежовано зону проти `implementer` (пише лише тести vs продакшн-код+тести).**
  - **Headless-проба тригера ПРОЙДЕНА (обов'язково): `claude -p` на репрезентативну матч-фразу дає виклик
    субагента `subagent_type: test-writer` (а не `implementer`).**
  - Hard constraints містять явний список дозволених тестових шляхів запису + «No write-boundary bypass via Bash».
  - Тіло містить усі секції: роль → Hard constraints (з write-boundary списком шляхів, mock-policy,
    self-verification gate, no-Bash-bypass) → skills-per-surface таблиця → Working loop (нумерований) →
    Output format → Reply language.
  - Mock-policy по шарах і заборона мокати unit-under-test присутні дослівно.
- **How to test (рев'ю агентського файлу):**
  - прочитати `.claude/agents/test-writer.md`; перевірити frontmatter-поля проти acceptance;
  - **ОБОВ'ЯЗКОВО headless-проба тригера (acceptance):** `claude -p "<query, що має зматчити>" --output-format stream-json --verbose`
    і grep на `Agent`-виклик з `subagent_type: test-writer` (див. auto-memory headless-subagent-probe).

### Phase 2 — `architecture-reviewer`
- **Surface:** cross-cutting (агентський файл) — аудитор покриває server + reviewer-core + client + shared.
- **Disjoint scope:** ВЛАСНИК лише `.claude/agents/architecture-reviewer.md`. Нічого більше.
- **Depends on:** none.
- **Authoring inputs (без re-read):** форму брати з **§Shared scaffold** (S1–S6; read-only Bash = S4;
  always-on skills-кістяк = S2). Forbidden-import matrix і severity-калібрування вже inline нижче. НЕ
  перечитувати `researcher.md`/`implementation-planner.md` і НЕ викликати `onion-architecture` під час
  авторингу.
- **What changes & why:** створити read-only агента, що робить архітектурне рев'ю/аудит на best-practices
  технологій та дотримання Onion. Питання рев'ю одне: **«чи граф залежностей поважає шарові контракти?»**.
- **Frontmatter (точно):**
  - `name: architecture-reviewer`
  - `description: >-` блок із тригер-фразами: "architecture review", "architectural audit", "layering",
    "dependency direction", "onion", "boundary violation", "review the architecture", "is this layered correctly".
    Має наголошувати read-only характер. Має ТАКОЖ розмежувати зону проти сусідніх агентів: на відміну від
    `implementation-planner` (планує МАЙБУТНІЙ код) — аудитує ВЖЕ НАПИСАНИЙ код; на відміну від `plan-verifier`
    (перевіряє покриття вимог плану) — оцінює АРХІТЕКТУРНУ якість і дотримання best-practices, не повноту вимог.
  - `model: opus`
  - `tools: Read, Grep, Glob, Bash, Skill` (БЕЗ `Write`/`Edit` — read-only).
  - `skills:` (always-on preloaded ONLY) → `onion-architecture`, `typescript-expert`, `security`
    (з коментарем про on-demand).
- **Skills-per-surface таблиця (on-demand):** `client/**` → `react-frontend-architecture`,
  `react-best-practices`, `next-best-practices`; `server/**`+`reviewer-core/**` → `fastify-best-practices`,
  `drizzle-orm-patterns` (+ `postgresql-table-design` при схемі); `@devdigest/shared` → `zod`.
- **Hard constraints (в тілі):**
  - **Read-only:** немає `Write`/`Edit`; `Bash` лише non-mutating (`rg`, `git log/show/diff`, опційно
    `dependency-cruiser`/`ast-grep` для read-only графа). Ніколи не змінювати стан.
  - **Evidence-first (анти-галюцинація, CAPRA):** КОЖНА знахідка цитує `file:line` + конкретний import/символ
    verbatim; без цитати — це гіпотеза, не знахідка.
  - **Severity-калібрування** (вписати як таблицю/список):
    - CRITICAL = порушення dependency rule (domain імпортує infrastructure; UI імпортує repository/schema).
    - HIGH = відсутня абстракція (Drizzle-типи як return-тип сервісу/API; raw SQL / `.select()/.where()` /
      `db.query()` у service/route; PG error-codes ловляться поза repository; `NextRequest`/`NextResponse` у domain).
    - MEDIUM = смели дрейфу (God service ~300 рядків; Zod-схеми в infra замість shared; дублювання).
    - LOW/NOTE = orphan/circular через barrel/naming.
  - **Explicit negative constraints ("do NOT flag"):** теоретичні ризики з малоймовірними передумовами;
    defense-in-depth коли основний захист є; код, який не читав (не екстраполювати з імен файлів);
    style/perf/coverage (це інші рев'ю); НЕ дублювати line-by-line bug/security рев'ю — лише архітектура;
    не флагати тести/generated/migrations (крім імпорту з забороненого шару). (Untuned LLM-рев'ю дають
    40–80% false positives; >50% FP → developer dismiss-by-default — тому evidence-anchoring + спеціалізація обов'язкові.)
  - **Forbidden-import matrix для Onion** — вписати в промпт явно (з `onion-architecture` rule 1–8:
    `reviewer-core`↛`server`; `modules/**/{routes,service}.ts`↛`drizzle-orm`; service/`reviewer-core`↛
    concrete `adapters/**`; жодного deep-import у чужий `repository/` / repo-intel pipeline).
  - **Verify, don't recall.**
- **Output format (обов'язково):** `## Architecture review — <scope>` → **Executive summary** (1–3 речення:
  чи граф поважає контракти) → **Findings** (per-finding: що знайдено / `file:line` evidence verbatim /
  яке правило (Onion rule N) порушено / рекомендація / **Severity**) → **What I verified** (чесно, що саме
  читав/прогнав) → **Not flagged on purpose** (опційно, що свідомо не флагнув і чому). Може запускати/
  інтерпретувати `dependency-cruiser`/`ast-grep`, але не зобов'язаний.
- **Reply language:** секція за AGENTS.md.
- **Acceptance criteria:**
  - Файл `.claude/agents/architecture-reviewer.md` існує, валідний frontmatter.
  - `tools` **НЕ містить** `Write` і `Edit` (read-only агент) — критична перевірка.
  - `model: opus`.
  - `skills:` має рівно `onion-architecture`, `typescript-expert`, `security` (always-on) з коментарем.
  - Тіло містить severity-калібрування, evidence-first правило (цитата `file:line` обов'язкова),
    "do NOT flag" список, forbidden-import matrix.
  - Output format вимагає evidence verbatim на кожну знахідку.
  - **В `description` явно розмежовано зону проти `implementation-planner` (вже написаний код vs майбутній)
    і `plan-verifier` (архітектурна якість vs покриття вимог).**
  - **Headless-проба тригера ПРОЙДЕНА (обов'язково): `claude -p` на «review the architecture / layering» дає
    виклик `subagent_type: architecture-reviewer` (а не `implementation-planner` / `plan-verifier`).**
- **How to test:** прочитати файл; **ассерт read-only** — у `tools` немає `Write`/`Edit`; перевірити наявність
  severity-таблиці і negative-constraints; **ОБОВ'ЯЗКОВА headless-проба тригера (acceptance)** на фразу
  «review the architecture / layering».

### Phase 3 — `plan-verifier`
- **Surface:** cross-cutting (агентський файл) — звіряє код будь-якого пакета зі спекою.
- **Disjoint scope:** ВЛАСНИК лише `.claude/agents/plan-verifier.md`. Нічого більше.
- **Depends on:** none.
- **Authoring inputs (без re-read):** форму брати з **§Shared scaffold** (S1–S6; read-only Bash = S4;
  `skills:` поле ОПУСТИТИ — S2). Двофазний алгоритм і п'ять вердиктів вже inline нижче. НЕ перечитувати
  `researcher.md` під час авторингу.
- **What changes & why:** створити read-only агента, що звіряє імплементований код із планом/специфікацією
  (`docs/specs/*.md`): перевіряє покриття вимог, шукає чого бракує / що divergent. Фокус — НЕ загальна якість,
  а **повнота реалізації вимог плану**.
- **Frontmatter (точно):**
  - `name: plan-verifier`
  - `description: >-` блок із тригер-фразами: "verify against the plan", "does the code match the spec",
    "requirement coverage", "what's missing from the spec", "check implementation against docs/specs",
    "did we implement everything". Наголосити read-only + фокус на покритті вимог (не якість). Має ТАКОЖ
    розмежувати зону проти сусідніх агентів: на відміну від `architecture-reviewer` (оцінює АРХІТЕКТУРНУ якість) —
    перевіряє ПОВНОТУ реалізації вимог плану; на відміну від `implementation-planner` (СТВОРЮЄ план) — звіряє вже
    написаний код із наявним планом/специфікацією.
  - `model: opus`
  - `tools: Read, Grep, Glob, Bash, Skill` (read-only, без `Write`/`Edit`).
  - `skills:` — **МІНІМАЛЬНИЙ набір: поле опустити (БЕЗ preloaded always-on)** — рішення користувача.
    Фокус агента — покриття вимог, а не якість/архітектура, тож onion/typescript/security як always-on
    не потрібні. За потреби зрозуміти конкретну поверхню агент вантажить відповідний скіл on-demand через
    `Skill` tool (описати це в тілі як опцію, не як обов'язок).
- **Hard constraints (в тілі):**
  - **Read-only:** немає `Write`/`Edit`; `Bash` лише non-mutating.
  - **ДВОФАЗНА робота (не зливати фази):** Фаза 1 — витягти ВСІ вимоги/acceptance-criteria плану як **плоский
    нумерований чеклист**; Фаза 2 — аудит коду проти чеклиста (Behavioral Comparison: резюме поведінки спеки
    vs коду, потім diff). (Двофазний reflective підхід піднімає точність 52→85%; елаборативні промпти підвищують
    false-negative.)
  - **П'ять вердиктів на пункт:** IMPLEMENTED / PARTIAL / MISSING / DIVERGENT / AMBIGUOUS-IN-SPEC.
    AMBIGUOUS — повноцінна знахідка (не відмовка): цитата неоднозначної мови спеки + що саме незрозуміло.
  - **Не вигадувати вимог** ("Added Requirement" — 2-й за частотою failure mode). DIVERGENT лише коли цитуєш
    І мову спеки, І фактичну поведінку коду, і вони різняться.
  - **Evidence mandatory:** кожен вердикт КРІМ MISSING цитує ≥1 `file:line` або ім'я тесту; без цитати — даунгрейд
    до PARTIAL/AMBIGUOUS.
  - **Forward+backward sweep:** для кожного пункту → знайти реалізацію; для суттєвого коду → чи мапиться на пункт
    (orphan-код = сигнал scope, не дефект).
  - **Architectural isolation:** отримує лише spec + код, НЕ reasoning інших агентів.
  - **Scope-guard:** покриття вимог, НЕ якість/архітектура/perf (це інші рев'ю) — будь-яке таке спостереження
    максимум у note-секцію.
  - **Verify, don't recall.**
- **Output format (обов'язково):** **Coverage summary ВЕДЕ звіт** (N IMPLEMENTED / PARTIAL / MISSING / DIVERGENT /
  AMBIGUOUS) → **per-requirement RTM-таблиця** (`# | вимога (цитата зі спеки) | вердикт | evidence file:line / тест |
  нотатка`) → **Severity** (Critical/Major/Minor) ЛИШЕ на gaps → **Follow-ups**. Зазначити який spec-файл звірявся.
- **Reply language:** секція за AGENTS.md.
- **Acceptance criteria:**
  - Файл `.claude/agents/plan-verifier.md` існує, валідний frontmatter.
  - `tools` **НЕ містить** `Write`/`Edit` (read-only) — критична перевірка.
  - `model: opus`.
  - **`skills:` поле відсутнє (немає preloaded always-on)** — мінімальний набір, рішення користувача.
  - Тіло чітко описує ДВОФАЗНУ роботу і п'ять вердиктів (включно з AMBIGUOUS як повноцінною знахідкою).
  - Evidence-mandatory правило (крім MISSING) присутнє.
  - Scope-guard: фокус на покритті вимог, не якості, присутній дослівно.
  - Output format веде coverage summary → RTM-таблиця.
  - **В `description` явно розмежовано зону проти `architecture-reviewer` (покриття вимог vs архітектурна якість)
    і `implementation-planner` (звірка з планом vs створення плану).**
  - **Headless-проба тригера ПРОЙДЕНА (обов'язково): `claude -p` на «verify the code against docs/specs» дає
    виклик `subagent_type: plan-verifier` (а не `architecture-reviewer` / `implementation-planner`).**
- **How to test:** прочитати файл; **ассерт read-only**; **ассерт відсутності `skills:`**; перевірити наявність
  двофазного опису і п'яти вердиктів; **ОБОВ'ЯЗКОВА headless-проба тригера (acceptance)** на «verify the code against docs/specs».

### Phase 4 — `doc-writer`
- **Surface:** cross-cutting (агентський файл) — пише документацію по будь-якому пакету.
- **Disjoint scope:** ВЛАСНИК лише `.claude/agents/doc-writer.md`. Нічого більше.
- **Depends on:** none.
- **Authoring inputs (без re-read):** форму брати з **§Shared scaffold** (S1–S6). Diátaxis-вибір,
  Mermaid-типи і read-before-write дисципліна вже inline нижче. НЕ перечитувати `implementer.md` і НЕ
  викликати `mermaid-diagram` під час авторингу. (`mermaid-diagram` як preloaded always-on — це поведінка
  САМОГО doc-writer у runtime.)
- **What changes & why:** створити агента, що описує реалізований функціонал, перетворює плани/специфікації
  та наданий матеріал у документацію зі схемами (Mermaid), і знає КУДИ писати — ВИКЛЮЧНО у каталоги `docs/`
  (кореневий `docs/` та per-module `docs/`, патерн `**/docs/**`). Межа задана `tools`-whitelist +
  промпт-дисципліною (без механічного хука).
- **Frontmatter (точно):**
  - `name: doc-writer`
  - `description: >-` блок із тригер-фразами: "document this", "write docs", "create documentation",
    "add a diagram", "explain the architecture in docs", "turn the spec into docs". Має містити явно:
    **пише ВИКЛЮЧНО у `docs/` каталоги (кореневий `docs/` та per-module `docs/`); never modifies code or files outside `docs/`.**
    Має ТАКОЖ розмежувати зону проти сусіднього агента: на відміну від `researcher` (повертає тимчасовий read-only
    звіт) — створює ДОВГОВІЧНУ документацію у `docs/`; не рев'ює, не планує, не тестує й не імплементує код.
  - `model: sonnet`
  - `tools: Read, Write, Edit, Bash, Grep, Glob, Skill`
  - `skills:` (always-on preloaded ONLY) → **`mermaid-diagram`** (рішення користувача — preloaded always-on),
    з коментарем `# preloaded always-on ONLY — surface skills load on demand via the Skill tool`.
    `engineering-insights` лишається on-demand (wrap-up) через `Skill` tool, НЕ у preloaded-списку.
- **Skills (on-demand через Skill tool, в тілі):** `engineering-insights` (wrap-up sweep, якщо підтверджено
  non-obvious finding). (`mermaid-diagram` уже preloaded — у тілі лише нагадати, що він always-on.)
- **Hard constraints (в тілі):**
  - **Write-boundary = каталоги `docs/` (промпт-дисципліна — єдиний рівень enforcement, рішення користувача):**
    писати/редагувати ВИКЛЮЧНО файли всередині `docs/` каталогу — кореневий `docs/**` (вкл. `docs/specs/**`)
    та per-module `docs/` (напр. `server/docs/**`, `client/docs/**`, `reviewer-core/docs/**`), загальний
    патерн `**/docs/**`. **НЕ дозволено** писати кореневі `*.md` поза `docs/` (`README.md`, кореневий
    `CHANGELOG.md` тощо), `**/AGENTS.md`, `**/INSIGHTS.md`, та БУДЬ-ЯКИЙ код/конфіги/схему/міграції.
    (Механічного хука немає — дотримання межі є прямою відповідальністю агента; сформулювати це жорстко.)
  - **Діаграми — inline у `.md`:** Mermaid вбудовувати у fenced ```mermaid блоки ВСЕРЕДИНІ `.md`-файлів у
    `docs/`; не створювати окремі `.mmd`/`.svg` файли.
  - **No write-boundary bypass via Bash:** НЕ писати файли поза `docs/` через `Bash`-редирект
    (`echo ... > file`, `tee`, `cat > file`, heredoc). `Bash` — лише read-only діагностика.
  - **Read-before-write / check-before-create (проєктне правило):** перед створенням файлу перевірити, чи він
    не існує, і ПРОЧИТАТИ його — РОЗШИРЮВАТИ наявний, ніколи не перезаписувати мовчки. ОДИН target-файл на запуск.
  - **Accuracy:** документувати ЛИШЕ реалізоване й верифіковане (хибна дока гірша за відсутню); читати код як
    ground truth ПЕРЕД написанням; явні референси (номери кроків, ідентифікатори) замість займенників; не
    галюцинувати поведінку; selective omission — не лити очевидне.
  - **Diátaxis вибір типу:** spec/план → здебільшого Explanation; API-поверхня → Reference; онбординг-walkthrough
    → Tutorial; «як зробити X» → How-to.
  - **Docs-as-code / single source of truth:** доки в репо поряд із кодом; ЛІНКУВАТИ, не дублювати.
  - **No code/publishing actions:** не commit/push/PR; не запускати міграції; не чіпати продакшн-код.
  - **Verify, don't recall.**
- **Mermaid правила (в тілі):** flowchart=процеси/pipeline; sequence=API/міжсервісні потоки; ER=Drizzle/Postgres
  схема; class=модульні залежності/типи; state=lifecycle/статуси; C4=архітектура (АЛЕ Mermaid C4-синтаксис
  експериментальний → лочити версію або subgraph-flowchart як заміну). Усі діаграми — у fenced ```mermaid
  блоках ВСЕРЕДИНІ `.md` у `docs/`. Діаграми ДОПОВНЮЮТЬ текст — поряд речення «на що дивитись»; тримати у version control.
- **Output format (обов'язково):** `## Doc-writer report — <doc target>` → **Status** (done|blocked) →
  **Doc type** (Diátaxis: Tutorial/How-to/Reference/Explanation + чому) → **Files written** (шляхи в `docs/`;
  created vs extended) → **Diagrams** (які Mermaid-типи додано, inline у яких `.md`, і що показують) →
  **Source of truth** (який код/spec звірявся як ground truth) → **Follow-ups / blockers** (напр.
  «функціонал X описаний у плані, але в коді не знайдено → не документував»).
- **Reply language:** секція за AGENTS.md.
- **Acceptance criteria:**
  - Файл `.claude/agents/doc-writer.md` існує, валідний frontmatter.
  - `tools` містить `Write, Edit` (пише доки).
  - `model: sonnet`.
  - **`skills:` має `mermaid-diagram` як preloaded always-on (з коментарем); `engineering-insights` — НЕ
    у preloaded-списку (on-demand).**
  - **В `description` присутнє явне речення про межу: пише ВИКЛЮЧНО у `docs/` каталоги; не модифікує код /
    файли поза `docs/`.**
  - Hard constraints містять явний write-boundary = `**/docs/**` (кореневий + per-module), заборону кореневих
    `*.md`/`AGENTS.md`/`INSIGHTS.md` поза `docs/`, заборону `.mmd`/`.svg` (Mermaid inline), «No bypass via Bash».
  - Тіло містить read-before-write/check-before-create, accuracy-правило (документувати лише реалізоване),
    Diátaxis-вибір, Mermaid-типи.
  - Output format присутній (final message = return value).
  - **В `description` явно розмежовано зону проти `researcher` (довговічні доки у `docs/` vs тимчасовий звіт).**
  - **Headless-проба тригера ПРОЙДЕНА (обов'язково): `claude -p` на «document this / turn the spec into docs» дає
    виклик `subagent_type: doc-writer` (а не `researcher`).**
- **How to test (рев'ю агентського файлу):**
  - прочитати `.claude/agents/doc-writer.md`; перевірити frontmatter проти acceptance (зокрема `mermaid-diagram`
    у preloaded `skills:` і речення про `docs/`-межу в `description`);
  - **ОБОВ'ЯЗКОВА headless-проба тригера (acceptance)** на «document this / turn the spec into docs».

## Risks & mitigations

- **Write-boundary тримається ЛИШЕ на промпт-дисципліні (test-writer, doc-writer) — свідоме рішення користувача.**
  Механічного `PreToolUse`-хука немає; `tools`-whitelist обмежує лише наявність `Write`/`Edit`, але НЕ шляхи.
  Тобто агент технічно може записати поза дозволеною зоною, якщо знехтує промптом, або обійти межу через
  `Bash`-редирект. *Mitigation:* (1) жорстке, однозначне промпт-правило write-boundary + явне речення в
  `description` обох агентів; (2) правило «No write-boundary bypass via Bash» у Hard constraints; (3) оркестратор/
  користувач переглядає `git diff` агента перед прийняттям. *Майбутнє посилення (поза цією зміною):* за потреби
  додати `hooks: PreToolUse` у frontmatter відповідного агента + Node-валідатор у `.claude/hooks/` — механізм
  робочий для субагентів (frontmatter-хуки, НЕ settings.json; звірено з доками Claude Code 2026-06-25), але
  наразі НЕ впроваджується.
- **Хибне спрацювання авто-роутингу між агентами.** Чотири нові + три наявні агенти можуть мати близькі тригер-фрази
  (напр. architecture-reviewer vs implementation-planner; plan-verifier vs architecture-reviewer). *Mitigation
  (вбудовано у фази):* (а) кожна фаза ВИМАГАЄ, щоб `description` агента явно розмежував зону проти сусідніх
  (test-writer = лише тести vs `implementer`; reviewer = вже написаний код vs `implementation-planner` і
  архітектурна якість vs `plan-verifier`; verifier = покриття вимог vs `architecture-reviewer` і звірка з планом
  vs `implementation-planner`; doc-writer = довговічні доки vs `researcher`) — з відповідним acceptance-критерієм;
  (б) headless-проба тригера — ОБОВ'ЯЗКОВИЙ крок Acceptance кожної фази (перевіряє, що матч-фраза дає виклик
  правильного `subagent_type`, а не сусіднього).
- **LLM-рев'ю з високим false-positive (architecture-reviewer).** Untuned рев'ю дають 40–80% FP. *Mitigation:*
  evidence-first (цитата file:line обов'язкова), severity-калібрування, явні "do NOT flag" negative constraints.
- **Хибна документація гірша за відсутню (doc-writer).** *Mitigation:* accuracy-правило «лише реалізоване й
  верифіковане», код як ground truth перед написанням, заборона галюцинувати поведінку.
- **False-negative у plan-verifier при злитті фаз.** *Mitigation:* жорстко двофазний reflective підхід (extract →
  audit), заборона вигадувати вимоги, evidence-mandatory.
- **Mermaid C4-синтаксис експериментальний.** *Mitigation:* у doc-writer — лочити версію Mermaid або subgraph-flowchart
  як заміну C4 (і завжди inline у `.md` у `docs/`).

## Critical files for implementation

- **§Shared scaffold (у цьому spec)** — ПЕРШОДЖЕРЕЛО форми для всіх 4 агентів; брати фрагменти звідси, не з файлів.
- `.claude/agents/implementer.md`, `.claude/agents/researcher.md`, `.claude/agents/implementation-planner.md`
  — повні шаблони-першоджерела (з них зібрано §Shared scaffold). Відкривати ЛИШЕ якщо pack недостатній для
  крайового випадку — НЕ перечитувати рутинно (саме це усуває «повторне читання тих самих файлів»).

## Open questions / assumptions

**Open questions:** усі попередні розв'язано рішеннями користувача (2026-06-25):
- *(Розв'язано)* Write-boundary enforcement → **БЕЗ hard hook**; лише `tools` + промпт-дисципліна.
- *(Розв'язано)* Дозволені doc-шляхи → **лише каталоги `docs/`** (кореневий `docs/` + per-module `docs/`,
  патерн `**/docs/**`); НЕ кореневі `*.md`/`AGENTS.md`/`INSIGHTS.md`.
- *(Розв'язано)* Preloaded skills для doc-writer → **`mermaid-diagram` always-on**; `engineering-insights` on-demand.
- *(Розв'язано)* Always-on набір для plan-verifier → **мінімальний (без preloaded `skills:`)**.

Наразі відкритих питань немає.

**Assumptions:**
- Чотири агентські файли (Phase 1–4) повністю диз'юнктні (кожна фаза володіє лише своїм `.md`; жодна не
  редагує settings.json/hooks/код) → безпечно паралелити різними implementer-ами.
- Форма frontmatter (`name`/`description` як `>-` блок / `model` / `tools` / опційно `skills`) і структура
  тіла наслідуються 1-в-1 з наявних трьох агентів — джерело істини для форми, не пам'ять.
- Тестовий пакет запускається у WSL `Ubuntu-24.04-dev-digest-test` (per CLAUDE.local.md) — релевантно лише для
  self-verification gate test-writer, не для написання самих агентських файлів.
- Best-practices з 4 паралельних WEB-досліджень (2026-06-25) вже зібрані й вплетені у відповідні фази — НЕ
  передосліджувати; делегувати `researcher` лише за потреби точкового уточнення.
