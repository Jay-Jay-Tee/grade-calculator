export function fmtPct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n.toFixed(d)}%`;
}

export function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number(n.toFixed(d)).toString();
}
