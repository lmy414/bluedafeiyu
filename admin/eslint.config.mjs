import nextPlugin from '@next/eslint-plugin-next'
import tseslint from 'typescript-eslint'

export default [
  ...tseslint.configs.recommended,
  nextPlugin.configs['core-web-vitals'],
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    ignores: ['.next/', 'out/', 'build/', 'next-env.d.ts', 'src/payload-types.ts'],
  },
]
