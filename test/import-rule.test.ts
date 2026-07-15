import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// Fixture violation test for the headless-zone import rule (30 §2.1, docs/70 M0.1 AC).
// We lint in-memory source against the project's real flat config, so this test breaks the
// moment the load-bearing `no-restricted-imports` rule is weakened or removed.
const eslint = new ESLint();

async function lint(filePath: string, code: string) {
  const results = await eslint.lintText(code, { filePath });
  return results[0]?.messages ?? [];
}

describe('headless-zone import rule (30 §2.1)', () => {
  it('flags three.js imports inside the headless zone', async () => {
    const messages = await lint('src/simulation/illegal.ts', `import * as THREE from 'three';\n`);
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('flags render-side imports inside the headless zone', async () => {
    const messages = await lint(
      'src/track/illegal.ts',
      `import { scene } from '../render/scene';\nexport const s = scene;\n`,
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('flags wall-clock use inside the headless zone', async () => {
    const messages = await lint('src/core/illegal.ts', `export const t = Date.now();\n`);
    expect(messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });

  it('allows three.js imports outside the headless zone (app/)', async () => {
    const messages = await lint('src/app/legal.ts', `import * as THREE from 'three';\nexport const v = THREE.MathUtils;\n`);
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });

  it('allows a clean headless-zone module', async () => {
    const messages = await lint('src/core/legal.ts', `export const answer = 42;\n`);
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});
