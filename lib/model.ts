// A short history of Exophase earn-rate snapshots comes with each case. Rates barely budge
// on release morning, and the house baseline simply carries forward the latest reading with a
// fixed 0.5-logit-per-square-root-day band. Our approach keeps that persistence idea but tightens
// it where the data is quiet: we carry forward the latest valid reading, nudge it with a damped
// version of the recent slope, and size the band from how noisy the history really was. A flat
// series therefore earns a narrow band, while a jumpy one gets a wider one.

// Quantile levels are the fixed 5/25/50/75/95 grid used by the scoreboard.
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
// Standard-normal z-scores matching those levels, used to step away from the mean.
const Z = [-1.644854, -0.674490, 0, 0.674490, 1.644854];

export interface Case {
  levels: number[];
  at: string;
  target: string;
  horizon_minutes: number;
  trophies: Array<{ id: number; tier?: string }>;
  history: Array<{ at: string; rates: Array<number | null> }>;
}

// Keep every percentage inside a safe interior so the logit never blows up at 0 or 100.
const clamp = (x: number): number => Math.min(99.99, Math.max(0.01, x));
// Convert a percentage into log-odds space, where the forecast math lives.
const logit = (pct: number): number => Math.log(clamp(pct) / (100 - clamp(pct)));
// Inverse of logit: logistic map back into a percentage on 0..100.
const expit = (x: number): number => 100 / (1 + Math.exp(-x));

/** Produce five rate quantiles per trophy at the case's target timestamp. */
export function forecast(c: Case): { id: number; q: number[] }[] {
  const n = c.trophies.length;
  // Only snapshots whose rate array lines up with the trophy list are usable.
  const reads = c.history.filter((h) => h.rates && h.rates.length === n);
  // Forecast horizon expressed in days, with a tiny floor to avoid division by zero.
  const d = Math.max(1 / 1440, c.horizon_minutes / 1440);
  const days = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86400000;

  return c.trophies.map((t, i) => {
    // Walk backward to the most recent snapshot that actually has a reading for this trophy.
    let li = -1;
    for (let k = reads.length - 1; k >= 0; k--) {
      if (reads[k].rates[i] !== null) { li = k; break; }
    }
    const lastRate = li >= 0 ? clamp(reads[li].rates[i]!) : 0.5;
    const l0 = logit(lastRate);

    // Estimate a recent slope in logit space from the latest reading two snapshots back,
    // cap it so a single freak move can't dominate, then halve it and scale to the horizon.
    let slope = 0;
    if (li >= 2) {
      const end = Date.parse(reads[li].at);
      const start = Date.parse(reads[li - 2].at);
      const span = (end - start) / 86400000;
      if (span > 0) {
        const earlier = logit(reads[li - 2].rates[i] ?? lastRate);
        slope = (l0 - earlier) / span;
      }
    }
    const drift = Math.max(-1.5, Math.min(1.5, slope)) * d * 0.5;

    // Volatility is the RMS distance of the last few valid logit readings from the anchor.
    let acc = 0, count = 0;
    for (let k = Math.max(0, li - 4); k <= li; k++) {
      const v = reads[k].rates[i];
      if (v === null) continue;
      const l = logit(v);
      acc += (l - l0) * (l - l0);
      count++;
    }
    const observed = count > 1 ? Math.sqrt(acc / count) : 0;

    // Spread blends a small floor with observed movement, capped at the house's fixed scale.
    const sigma = Math.max(
      0.08 * Math.sqrt(d),
      Math.min(0.5 * Math.sqrt(d), observed * 1.2 + 0.10 * Math.sqrt(d)),
    );

    // Center the band on the drifted level, then place each z-score quantile through the logistic.
    const mu = l0 + drift;
    const q = LEVELS.map((_, j) => Math.round(expit(mu + Z[j] * sigma) * 10000) / 10000);
    // Quantiles must not cross; lift any dip up to its left neighbour.
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { id: t.id, q };
  });
}
