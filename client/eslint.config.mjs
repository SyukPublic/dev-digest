import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const rootDir = dirname(fileURLToPath(import.meta.url));

// eslint-config-next@15 is still an eslintrc-style shareable config, so bridge it
// into flat config via FlatCompat (the create-next-app@15 pattern). Native flat
// export only landed in eslint-config-next@16.
const compat = new FlatCompat({ baseDirectory: rootDir });

/**
 * Route features under `src/app/<feature>` are PRIVATE: a feature must not reach
 * into another feature's internals. Cross-cutting code is shared via
 * `@/components`, `@/lib`, `@/vendor` ONLY. Enforced by two complementary rules:
 *  - `import/no-restricted-paths` — a top-level route feature can't import from a
 *    sibling feature's directory (the `import` plugin is registered by next config).
 *  - `no-restricted-imports` — bans deep relative chains (reach shared code via the
 *    `@/` alias instead) and any `@/app/**` import (the alias route into a feature).
 *
 * `ROUTE_FEATURES` is DERIVED from the filesystem (every top-level `src/app/<feature>`
 * directory) rather than hand-maintained, so new features are picked up automatically
 * and the list can't drift out of sync. Excludes Next dynamic segments (`[...]`),
 * private folders (`_…`), and dotfiles — leaving only real route features.
 */
const appDir = join(rootDir, "src/app");
const ROUTE_FEATURES = readdirSync(appDir, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      !d.name.startsWith("[") &&
      !d.name.startsWith("_") &&
      !d.name.startsWith("."),
  )
  .map((d) => d.name);

const config = [
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./){3,}",
              message:
                "Deep relative import — reach shared code via the @/ alias (@/lib, @/components, @/vendor).",
            },
            {
              group: ["@/app/**"],
              message:
                "Cross-feature import — route features under src/app are private; share via @/components, @/lib, @/vendor.",
            },
          ],
        },
      ],
      "import/no-restricted-paths": [
        "error",
        {
          zones: ROUTE_FEATURES.map((feature) => ({
            target: `./src/app/${feature}`,
            from: "./src/app",
            except: [`./${feature}`],
            message:
              "Cross-feature reach-in — route features are private; share via @/components, @/lib, @/vendor.",
          })),
        },
      ],
    },
  },
  {
    // Tests legitimately import i18n fixtures from `messages/` (outside `src/`, no
    // alias covers it) — don't flag those deep relative paths.
    files: ["src/**/*.test.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
