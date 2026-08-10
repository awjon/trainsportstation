// Crash gags (docs/30 §7.6, tone docs/10 §1 "failure must always be funnier than success is
// satisfying").
//
// The split matters: the SIM decides *that* a train crashed and why, deterministically. This
// module decides only how funny it looks and what the card says. Picking a variant may use
// unseeded randomness precisely because nothing here can reach sim state — a replay of the same
// inputs still produces the same run, just possibly a different pratfall.
//
// Failure copy is never blaming (docs/20 §8), and the retry button always says
// "Once more, with feeling".

import type { CrashCause } from '../train/types';

export const RETRY_ON_CRASH = 'Once more, with feeling';
export const RETRY_ON_SUCCESS = 'Again!';

export interface Gag {
  cause: CrashCause;
  /** the slapstick the renderer plays (docs/30 §7.6) */
  animation: 'cartwheel' | 'accordion' | 'teeter' | 'faceplant' | 'skid';
  /** headline on the resolve card */
  headline: string;
  /** particle flavour, presentation-only */
  confetti: 'popcorn' | 'parachutes' | 'dust' | 'sparks';
  durationTicks: number;
}

/** Every gag written for a cause. The first entry is the canonical one (used when unshuffled). */
export const GAGS: Record<CrashCause, Gag[]> = {
  'speeding-curve': [
    {
      cause: 'speeding-curve',
      animation: 'cartwheel',
      headline: 'Well. That’s one way to arrive.',
      confetti: 'popcorn',
      durationTicks: 150,
    },
    {
      cause: 'speeding-curve',
      animation: 'cartwheel',
      headline: 'The curve had opinions.',
      confetti: 'popcorn',
      durationTicks: 150,
    },
  ],
  collision: [
    {
      cause: 'collision',
      animation: 'accordion',
      headline: 'Both trains agree: that was the other one’s fault.',
      confetti: 'parachutes',
      durationTicks: 165,
    },
    {
      cause: 'collision',
      animation: 'accordion',
      headline: 'A meeting of minds. And buffers.',
      confetti: 'parachutes',
      durationTicks: 165,
    },
  ],
  gap: [
    {
      cause: 'gap',
      animation: 'teeter',
      headline: 'The track ended. The train did not.',
      confetti: 'dust',
      durationTicks: 180,
    },
    {
      cause: 'gap',
      animation: 'teeter',
      headline: 'Ambitious. Briefly.',
      confetti: 'dust',
      durationTicks: 180,
    },
  ],
  'bad-landing': [
    {
      cause: 'bad-landing',
      animation: 'faceplant',
      headline: 'Great air. Notes on the landing.',
      confetti: 'dust',
      durationTicks: 150,
    },
    {
      cause: 'bad-landing',
      animation: 'faceplant',
      headline: 'Ten for style, nought for arrival.',
      confetti: 'dust',
      durationTicks: 150,
    },
  ],
  hazard: [
    {
      cause: 'hazard',
      animation: 'skid',
      headline: 'The mountain got there first.',
      confetti: 'sparks',
      durationTicks: 150,
    },
    {
      cause: 'hazard',
      animation: 'skid',
      headline: 'Nobody told the rocks about the timetable.',
      confetti: 'sparks',
      durationTicks: 150,
    },
  ],
};

/**
 * A gag for a cause. `pick` defaults to `Math.random` — deliberately unseeded, because this is
 * presentation only. Pass a chooser in tests (or to make a gag reproducible in a capture).
 */
export function gagFor(
  cause: CrashCause,
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): Gag {
  const options = GAGS[cause];
  const i = Math.min(Math.max(pick(options.length), 0), options.length - 1);
  return options[i];
}

/** Retry copy: crashes get the gentle line, wins get the eager one (docs/20 §8). */
export function retryLabel(crashed: boolean): string {
  return crashed ? RETRY_ON_CRASH : RETRY_ON_SUCCESS;
}
