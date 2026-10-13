/** Money is kept in kobo (integer). 1 NGN = 100 kobo. */
export const toKobo = (naira: number) => Math.round(naira * 100);
export const toNaira = (kobo: number | bigint | string) => Number(kobo) / 100;

const fmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
export function formatNaira(kobo: number | bigint | string): string {
  return "₦" + fmt.format(toNaira(kobo));
}

/** USD amount for a naira amount at an admin-set rate (NGN per USD), rounded up to the cent. */
export function nairaToUsd(kobo: number, ngnPerUsd: number): number {
  if (!(ngnPerUsd > 0)) throw new Error("invalid_rate");
  return Math.ceil((toNaira(kobo) / ngnPerUsd) * 100) / 100;
}
