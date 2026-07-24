// Canonical train/carriage state (docs/30 §4 verbatim + one authorized additive field, docs/70
// M4.2). HEADLESS — no three.js, no render/camera/ui/effects/audio, no DOM (docs/30 §2.1).

/** One trailing carriage: who (if anyone) rides it, and how far behind the loco it sits. */
export interface CarriageState {
  personaId: string | null;
  offset: number; // arc-length behind the locomotive, world units
}

export interface TrainState {
  id: string;
  edgeId: string | null; // null while airborne or crashed
  s: number; // arc-length along edgeId, 0..edge.length
  facing: 1 | -1; // which direction to read the edge's compiled path (movement.ts); derived from
  // edgeId's ':f'/':r' suffix — never set this independently of edgeId (see movement.ts's
  // facingOf). It is recomputed every time edgeId changes, not an independently mutable field.
  v: number; // scalar speed, world units / second
  airborne: null | { pos: [number, number, number]; vel: [number, number, number] };
  crashed: boolean;
  carriages: CarriageState[];

  // --- additive field beyond docs/30 §4's sketch (docs/70 M4.2 explicitly authorizes this) ---
  //
  // docs/30 §6 says carriage trailing is "resolved by walking backward along the edge chain" —
  // but a TrainState with only a single current (edgeId, s) has no memory of what came before,
  // so there is no way to know *which* edge chain the loco actually walked (a junction/converging
  // track can have multiple graph-valid predecessors for the same node; only the loco's actual
  // travel history disambiguates it). `history` is that memory: edge ids the loco has occupied,
  // oldest -> newest, with the current `edgeId` always the last entry. movement.ts trims it from
  // the front once it safely covers the longest `carriages[].offset`, so it never grows
  // unbounded. This is additive per docs/30 §4 ("Field lists may grow additively; renames/
  // removals may not") — none of the doc's existing fields are renamed or dropped.
  history: string[];

  // --- additive fields beyond docs/30 §4's sketch (docs/70 M4.3 explicitly authorizes these,
  // same "additive" clause as `history` above) ---
  //
  // §7.3's derail rule ("exceeding [the curveClass max speed] for more than derailGraceTicks
  // consecutive ticks") needs a counter of CONSECUTIVE overspeed ticks — there is nowhere else to
  // keep that memory between ticks. Reset to 0 on a straight edge or whenever v drops back to/
  // under the threshold; train/physics.ts (M4.3) is the only reader/writer.
  overspeedTicks: number;
  // §7.2's Airtime event needs `durationTicks`, i.e. how long the train was airborne — again,
  // memory that must live somewhere between ticks. Set to 1 at launch, incremented once per
  // airborne tick, read (as the event's durationTicks) and reset to 0 on landing or bad-landing
  // crash. 0 whenever the train is on rails or crashed. train/physics.ts (M4.3) is the only
  // reader/writer.
  airborneTicks: number;
}
