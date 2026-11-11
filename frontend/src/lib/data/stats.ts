/* Small, dependency-free statistics helpers used by the aggregation and analysis engines. */

export const sum = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
};

export const mean = (xs: ArrayLike<number>) => (xs.length ? sum(xs) / xs.length : NaN);

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const sortedCopy = (xs: ArrayLike<number>) => Float64Array.from(xs).sort();

export const median = (xs: ArrayLike<number>) => quantileSorted(sortedCopy(xs), 0.5);

export function stddev(xs: ArrayLike<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) acc += (xs[i] - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1));
}

/** Pearson correlation over paired finite values. Returns { r, n }; r is NaN when undefined. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>, idx?: ArrayLike<number>): { r: number; n: number } {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  const len = idx ? idx.length : a.length;
  for (let k = 0; k < len; k++) {
    const i = idx ? idx[k] : k;
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  if (n < 3) return { r: NaN, n };
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va <= 0 || vb <= 0) return { r: NaN, n };
  return { r: Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb))), n };
}

/** Ordinary least squares over (index, value). Returns slope, intercept and r². */
export function linearTrend(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  const xs = values.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (values[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (values[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept: my - slope * mx, r2 };
}

/** Robust z-scores (median / MAD); resistant to the very outliers they detect. */
export function robustZ(values: number[]): number[] {
  const sorted = sortedCopy(values);
  const med = quantileSorted(sorted, 0.5);
  const deviations = sortedCopy(values.map((v) => Math.abs(v - med)));
  const mad = quantileSorted(deviations, 0.5);
  if (mad === 0) {
    const sd = stddev(values);
    return values.map((v) => (sd ? (v - med) / sd : 0));
  }
  return values.map((v) => (0.6745 * (v - med)) / mad);
}

/** Sample skewness (Fisher–Pearson). */
export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  return m2 ? m3 / Math.pow(m2, 1.5) : 0;
}

/** "Nice" bin edges for a histogram over [min, max]. */
export function niceBins(min: number, max: number, target: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min, max + 1];
  const raw = (max - min) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const edges: number[] = [];
  for (let e = start; e <= max + step * 0.5 && edges.length < 200; e += step) edges.push(Number(e.toPrecision(12)));
  if (edges[edges.length - 1] < max) edges.push(Number((edges[edges.length - 1] + step).toPrecision(12)));
  return edges;
}
