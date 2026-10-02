import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        // Type-aware linting (0010 Q8). Deliberately scoped to TS files: the
        // type-checked rules throw on files that belong to no TS project.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 0010 Q9: these are the constructs most likely to hide a defect in this
      // codebase, so they are errors rather than warnings.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Money and durations are integers by design (0003 P3, P6). parseFloat is
      // the one builtin that silently produces a float, which is exactly the
      // failure mode that rule exists to prevent. parseInt is left alone: it
      // returns an integer, so banning it would be noise.
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message:
            'Money and durations are stored as integers (0003 P3, P6). Use Number() and round deliberately.',
        },
      ],
    },
  },
  {
    // Plain JS config files run in Node and belong to no TS project, so they get
    // the non-type-checked baseline only.
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },
)
