// ESLint flat config (ESLint 9). The plan (docs/70 M0.1) names `.eslintrc.cjs`, but ESLint 9+
// is flat-config only; the load-bearing requirement — the headless-zone import rule (30 §2.1)
// with a fixture violation test — is honored here.
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// The headless zone (30 §2.1): these directories must stay free of Three.js, render/camera/
// effects/audio/ui, and DOM/wall-clock APIs so every gameplay rule is testable in CI without a GPU.
const RENDER_SIDE = ['render', 'camera', 'effects', 'audio', 'ui', 'editor', 'app'];

const renderImportPatterns = [
  { group: ['three', 'three/*'], message: 'Headless zone (30 §2.1) must not import three.js.' },
  ...RENDER_SIDE.map((dir) => ({
    group: [`**/${dir}`, `**/${dir}/*`],
    message: `Headless zone (30 §2.1) must not import render-side module: ${dir}/.`,
  })),
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'kenney-train-kit/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    // Headless zone (30 §2.1 / determinism contract 30 §3): no render-side imports, no wall-clock,
    // no unseeded randomness. This rule is load-bearing for the whole implementation plan.
    files: [
      'src/core/**/*.ts',
      'src/simulation/**/*.ts',
      'src/track/**/*.ts',
      'src/train/**/*.ts',
      'src/data/**/*.ts',
      'src/scenarios/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: renderImportPatterns }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Headless zone (30 §3.3): use core/rng.ts (seeded PRNG).' },
        { object: 'Date', property: 'now', message: 'Headless zone (30 §3.3): no wall-clock; sim time is ticks only.' },
        { object: 'performance', property: 'now', message: 'Headless zone (30 §3.3): no wall-clock; sim time is ticks only.' },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
