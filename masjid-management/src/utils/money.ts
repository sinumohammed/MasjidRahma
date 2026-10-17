// ₹42,300 - Indian digit grouping, paise only when there are any. One
// format for every amount on every screen.
export const money = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
