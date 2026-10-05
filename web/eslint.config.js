import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Dependency rule (docs/FRONTEND.md): features/ and state/ may only import
// domain/ and the interfaces in link/ and services/, never a concrete
// implementation (MockLink, WebRtcLink, MockAuthClient, ...). Only app/
// wires implementations together.
const noConcreteLinkOrServiceImpls = [
  {
    group: [
      '**/link/mock',
      '**/link/mock/**',
      '**/link/webrtc',
      '**/link/webrtc/**',
      '**/link/ws',
      '**/link/ws/**',
    ],
    message: 'features/ and state/ must depend on the VehicleLink interface, not a concrete implementation. Only app/ may wire up implementations.',
  },
  {
    group: [
      '**/services/mock',
      '**/services/mock/**',
      '**/services/http',
      '**/services/http/**',
      '**/services/local-storage',
      '**/services/local-storage/**',
    ],
    message: 'features/ and state/ must depend on service interfaces (AuthClient, MissionRepository), not a concrete implementation. Only app/ may wire up implementations.',
  },
]

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/state/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: noConcreteLinkOrServiceImpls }],
    },
  },
)
