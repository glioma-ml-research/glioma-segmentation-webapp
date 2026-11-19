export function volumeChange(before: number, after: number) {
  return { ml: after - before, percent: before > 0 ? (after - before) / before * 100 : null };
}
