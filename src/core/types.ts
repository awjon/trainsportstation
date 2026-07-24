// Core headless types shared across the whole sim (docs/30 §3.1, §4; docs/70 M4.2). Zero
// imports — core/ is the base of the headless-zone import DAG (docs/30 §2.1): everything may
// import core, core imports nothing.

/** A count of fixed simulation steps, integer >= 0. */
export type Tick = number;

/** The only dt ever used in sim math (docs/30 §3.1): fixed 60 ticks per sim-second. */
export const TICK_DT = 1 / 60;
