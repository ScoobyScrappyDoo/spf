/**
 * A small seeded random number generator (mulberry32).
 * Its whole state is one number, so a game can be saved, sent over the network or replayed exactly:
 * the server stores the seed, both browsers see the same cards.
 */
export class SeededRandom {
  constructor(public state: number) {}

  /** A float in [0, 1), like Math.random(). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, max). The C# equivalent is Random.Next(max). */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(items: readonly T[], rng: SeededRandom): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
