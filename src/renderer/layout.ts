export const COLS = 5;
export const MIN_DESKS = 10;
export const SPACING_X = 4.9;
export const SPACING_Z = 7.3;

/** Desks always come in full rows of five, never fewer than ten. */
export function capacityFor(sessions: number, highestIndex = -1): number {
  return Math.max(MIN_DESKS, Math.ceil(Math.max(sessions, highestIndex + 1) / COLS) * COLS);
}

export function rowsFor(desks: number): number {
  return Math.max(1, Math.ceil(desks / COLS));
}

export function deskPos(index: number, rows: number): [number, number] {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return [(col - (COLS - 1) / 2) * SPACING_X, (row - (rows - 1) / 2) * SPACING_Z];
}

export function hallSize(rows: number): { w: number; d: number } {
  return { w: COLS * SPACING_X + 6.5, d: rows * SPACING_Z + 4.2 };
}
