export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function ymdRange(from: string, to: string) {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function pickSubset<T>(rng: () => number, arr: T[], probability = 0.5) {
  return arr.filter(() => rng() < probability);
}

export async function withConcurrencyCap<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<{ results: T[]; maxInFlight: number }> {
  let inFlight = 0;
  let maxInFlight = 0;
  const results: T[] = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        results[idx] = await tasks[idx]();
      } finally {
        inFlight--;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return { results, maxInFlight };
}
