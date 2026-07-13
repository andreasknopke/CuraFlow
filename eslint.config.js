import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

// Extract rules from typescript-eslint presets.
const tsRecommendedRules = Object.fromEntries(
  tseslint.configs.recommended.flatMap((b) => Object.entries(b.rules ?? {})),
);
const tsTypeCheckedRules = Object.fromEntries(
  tseslint.configs.recommendedTypeChecked.flatMap((b) => Object.entries(b.rules ?? {})),
);

export default [
  {
    ignores: [
      'server/**',
      'PHP/**',
      'src/components/**/*.md.jsx',
      '.copilot-logs/**',
      'pr22-finalize.log',
      '.vite/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      // Config files — JS files, exclude from TS linting
      'tailwind.config.js',
      'postcss.config.js',
      // Build tooling — `as any` for vitest coverage typing
      'vite.config.ts',
      'playwright.config.ts',
      'e2e/**',
      // Deferred pages from TypeScript conversion — @ts-nocheck, tracked in
      // docs/typescript_conversion_plan.md (Part 1, 5 pages blocked on TanStack
      // Query v5 API migration).  Remove entries as pages are converted.
      'src/pages/MyDashboard.tsx',
      'src/pages/WishList.tsx',
      'src/pages/ServiceStaffing.tsx',
      'src/pages/Vacation.tsx',
      'src/pages/Training.tsx',
    ],
  },

  // ─── JavaScript (.js / .jsx) — kept for legacy / non-src files ────────────────
  {
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn", { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": ["error", { ignore: ["cmdk-input-wrapper", "toast-close"] }],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  // ─── TypeScript (.ts / .tsx in src/) — ALL rules scoped here ─────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: "./jsconfig.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // ── Base eslint:recommended (via typescript-eslint recommended) ──────
      ...tsRecommendedRules,

      // ── Type-checked rules ──────────────────────────────────────────────
      ...tsTypeCheckedRules,

      // ── Custom overrides ────────────────────────────────────────────────

      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn", { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn", { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],

      // Allow @ts-expect-error with a description (needed for third-party libs)
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],

      // ── @typescript-eslint/no-explicit-any — THE key enforcement rule ───
      // ERROR globally.  The allowlist below exempts known offenders.
      // New `any` in any non-allowlisted file fails CI.
      "@typescript-eslint/no-explicit-any": "error",

      // ── All other strict rules: warn only (not blocking) ────────────────
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
      "@typescript-eslint/no-unsafe-declaration-merging": "warn",
      "@typescript-eslint/no-unsafe-type-assertion": "warn",
      "@typescript-eslint/no-unsafe-unary-minus": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/consistent-type-assertions": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-for-in-array": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-array-delete": "off",
      "@typescript-eslint/no-implied-eval": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/no-extra-non-null-assertion": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-duplicate-enum-values": "warn",
      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/prefer-as-const": "warn",
      "@typescript-eslint/prefer-namespace-keyword": "warn",
      "@typescript-eslint/triple-slash-reference": "warn",
      "@typescript-eslint/no-array-constructor": "warn",
      "@typescript-eslint/no-misused-new": "warn",
      "@typescript-eslint/no-unnecessary-type-constraint": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/await-thenable": "warn",

      // React rules
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": ["error", { ignore: ["cmdk-input-wrapper", "toast-close"] }],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  // ─── Allowlist: files with existing `any` usage ─────────────────────────────
  // Each file here has known `: any` / `as any` that predates this rule.
  // Remove the entry after fixing all `any` in that file.
  {
    files: [
      // --- Core schedule (HIGH RISK — keep allowlisted until DnD coverage) ---
      "src/components/schedule/ScheduleBoard.tsx",

      // --- Test files (any is expected in mocks/fixtures/step definitions) ---
      "src/**/__tests__/**",
      "src/**/__component_tests__/**",
      "src/**/*.test.*",
      "src/**/*.spec.*",
      "src/test-utils/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
