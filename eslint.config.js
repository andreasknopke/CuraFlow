import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginUnusedImports from 'eslint-plugin-unused-imports';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['src/components/docs/*.md.jsx', 'src/components/manual.md.jsx'],
  },
  {
    files: [
      'src/components/**/*.{js,mjs,cjs,jsx,ts,tsx}',
      'src/pages/**/*.{js,mjs,cjs,jsx,ts,tsx}',
      'src/hooks/**/*.{js,jsx,ts,tsx}',
      'src/api/**/*.{js,ts}',
      'src/constants/**/*.{js,ts}',
      'src/types/**/*.{ts,tsx}',
      'src/Layout.jsx',
    ],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      'unused-imports': pluginUnusedImports,
    },
    rules: {
      'no-unused-vars': 'off',
      'react/jsx-uses-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unknown-property': ['error', { ignore: ['cmdk-input-wrapper', 'toast-close'] }],
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  // TypeScript files: apply TS parser so ESLint understands interfaces, type imports, etc.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  eslintConfigPrettier,
];
