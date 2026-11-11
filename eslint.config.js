import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Abbai Flow lint configuration (ESLint 9 flat config).
 *
 * Scope: `src/` (browser app), `server/` + `server.js` (CommonJS backend) and
 * the build scripts. `beacon/` is a legacy mirror and is linted through the
 * root copy, so it is ignored here to avoid duplicate reports.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'beacon/**',
      'android/**',
      'ios/**',
      'node_modules/**',
      'docs-site/**',
      'docs/**',
      '.tmp/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `any` shows up in a few HA payload shapes; warn instead of failing the
      // build, but never let it pass silently.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Backend + tooling: CommonJS/Node globals, and `require` is intentional
    // (the add-on image has no package.json, so the server must stay CJS).
    files: ['server/**/*.cjs', 'server.js', 'scripts/**/*.{js,mjs,cjs}', '*.config.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Build scripts are ESM (`.mjs`), where `__dirname` does not exist — the
    // scripts define it themselves, so that must not read as a redeclaration.
    files: ['scripts/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
);
