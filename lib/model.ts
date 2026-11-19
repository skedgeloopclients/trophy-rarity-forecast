// Trophy-rarity forecaster. The case holds a short history of Exophase earn-rate reads. On a launch
// day rates move slowly; the house baseline persists the last read with a 0.5-logit-per-sqrt-day spread.
// We beat it by (a) persisting the most recent read, (b) adding a small drift from the recent trend,
// and (c) using a spread that adapts to how much the history actually moved: flat series get a tighter
// band (the house's fixed 0.5 is too wide for a 90-minute horizon where nothing changed).
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.674490, 0, 0.674490, 1.644854];

export interface Case {
  levels: number[];
  at: string;
  target: string;
  horizon_minutes: number;
  trophies: Array<{ id: number; tier?: string }>;
  history: Array<{ at: string; rates: Array<number | null> }>;
}

const clamp = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => Math.log(clamp(pct) / (100 - clamp(pct)));
const expit = (x: number): number => 100 / (1 + Math.exp(-x));

/** Forecast every trophy's rate at the case's target as five quantiles. */
export function forecast(c: Case): { id: number; q: number[] }[] {
  const n = c.trophies.length;
  const reads = c.history.filter((h) => h.rates && h.rates.length === n);
  const d = Math.max(1 / 1440, c.horizon_minutes / 1440); // horizon in days
  const days = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86400000;
  const last = reads[reads.length - 1];

  return c.trophies.map((t, i) => {
    // Last valid read for this trophy.
    let li = -1;
    for (let k = reads.length - 1; k >= 0; k--) if (reads[k].rates[i] !== null) { li = k; break; }
    const lastRate = li >= 0 ? clamp(reads[li].rates[i]!) : 0.5;
    const l0 = logit(lastRate);

    // Recent trend in logit space over the available history, shrunk toward zero.
    let slope = 0;
    if (li >= 2) {
      const tEnd = Date.parse(reads[li].at), tStart = Date.parse(reads[li - 2].at);
      const span = (tEnd - tStart) / 86400000;
      if (span > 0) {
        const a = logit(reads[li - 2].rates[i] ?? lastRate);
        slope = (l0 - a) / span;
      }
    }
    const drift = Math.max(-1.5, Math.min(1.5, slope)) * d * 0.5; // half-shrunk drift to horizon

    // Observed volatility across recent reads (logit units); flat histories give ~0.
    let vol = 0, cnt = 0;
    for (let k = Math.max(0, li - 4); k <= li; k++) {
      const v = reads[k].rates[i];
      if (v === null) continue;
      const l = logit(v);
      vol += (l - l0) * (l - l0); cnt++;
    }
    const observed = cnt > 1 ? Math.sqrt(vol / cnt) : 0;
    // Blend a floor for genuine launch-day uncertainty with the observed (often zero) movement.
    const base = 0.5 * Math.sqrt(d); // house scale
    const sigma = Math.max(0.08 * Math.sqrt(d), Math.min(base, observed * 1.2 + 0.10 * Math.sqrt(d)));

    const mu = l0 + drift;
    const q = LEVELS.map((_, j) => Math.round(expit(mu + Z[j] * sigma) * 10000) / 10000);
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { id: t.id, q };
  });
}
