export function formatCompactScore(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) {
    return `${Math.round(rounded / 100_000) / 10}M`;
  }
  if (Math.abs(rounded) >= 10_000) {
    return `${Math.round(rounded / 1_000)}K`;
  }
  return rounded.toLocaleString("en-US");
}
