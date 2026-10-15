/**
 * Converts integer paise to rupees string with strict integer math.
 * 200 -> "2.00"
 * 500 -> "5.00"
 */
export function paiseToRupeesString(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  const remainderStr = remainder < 10 ? `0${remainder}` : `${remainder}`;
  return `${rupees}.${remainderStr}`;
}
