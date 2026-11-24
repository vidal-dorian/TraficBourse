/**
 * A close in French notation: points for an index, 4 decimals for a currency pair, the instrument's
 * currency otherwise. A currency code Intl rejects falls back to the plain number and the code.
 */
export function formatClose(close: number, type: string, currency: string): string {
  if (type === "index") return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(close)} pts`;
  const digits = type === "fx" ? 4 : 2;
  // Minor units (pence "GBp"/"GBX", South African cents "ZAc") are not ISO codes: Intl would read "GBp"
  // as pounds and show a price 100 times too high, so they keep the plain number and their code.
  const isMinorUnit = currency !== currency.toUpperCase() || currency === "GBX";
  try {
    if (isMinorUnit) throw new RangeError("minor unit");
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

/** "au 18/11" for a close dated "2026-11-18". */
export function sinceMention(date: string): string {
  return `au ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
