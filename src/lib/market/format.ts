/**
 * A close in French notation: points for an index, 4 decimals for a currency pair, the instrument's
 * currency otherwise. A currency code Intl rejects falls back to the plain number and the code.
 */
export function formatClose(close: number, type: string, currency: string): string {
  if (type === "index") return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(close)} pts`;
  const digits = type === "fx" ? 4 : 2;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(close);
  } catch {
    const plain = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${plain.format(close)} ${currency}`;
  }
}
