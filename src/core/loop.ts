// Fixed-timestep driver (docs/30 §3.1–3.2). The sim advances in whole ticks at exactly
// 60/second; rendering is decoupled and interpolates with the leftover alpha. The loop is
// pausable and single-steppable — assist mode (docs/10 §9) and the tests both need that.
//
// Time is passed IN by the caller (frame delta), never read from a clock here, so the headless
// zone stays wall-clock free.

export const TICKS_PER_SECOND = 60;
export const TICK_DT = 1 / TICKS_PER_SECOND;

/** Never simulate more than this many ticks for one frame (spiral-of-death clamp). */
export const MAX_TICKS_PER_FRAME = 5;

export interface LoopOptions {
  onTick(): void;
  maxTicksPerFrame?: number;
}

export class FixedTimestepLoop {
  private accumulator = 0;
  private paused = false;
  private readonly maxTicks: number;
  private readonly onTick: () => void;
  /** total ticks simulated since construction */
  tick = 0;

  constructor(opts: LoopOptions) {
    this.onTick = opts.onTick;
    this.maxTicks = opts.maxTicksPerFrame ?? MAX_TICKS_PER_FRAME;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Advance exactly one tick regardless of pause state (assist-mode stepping, tests). */
  step(): void {
    this.onTick();
    this.tick++;
  }

  /**
   * Feed a frame delta (seconds). Runs as many whole ticks as have accumulated, clamped.
   * Returns the number of ticks run.
   */
  advance(dtSeconds: number): number {
    if (this.paused) return 0;
    this.accumulator += Math.max(0, dtSeconds);
    let ran = 0;
    while (this.accumulator >= TICK_DT && ran < this.maxTicks) {
      this.step();
      this.accumulator -= TICK_DT;
      ran++;
    }
    if (ran === this.maxTicks && this.accumulator > TICK_DT) {
      this.accumulator = 0; // drop the backlog rather than death-spiral
    }
    return ran;
  }

  /** Fraction (0..1) into the next tick — the renderer's interpolation factor. */
  alpha(): number {
    return this.accumulator / TICK_DT;
  }

  reset(): void {
    this.accumulator = 0;
    this.tick = 0;
  }
}
