/** An inclusive range of numbers, e.g. a QB's completion range 1-37. */
export interface Range {
  from: number;
  to: number;
}

/** True when n lies inside the range. A null range ("Int:" left blank on the card) never matches. */
export function inRange(n: number, range: Range | null): boolean {
  return range !== null && n >= range.from && n <= range.to;
}

/** Keeps a value between min and max, e.g. a modified run number stays within 1-12 (rule 8.2.2). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatRange(range: Range | null): string {
  if (range === null) return '';
  return range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`;
}
