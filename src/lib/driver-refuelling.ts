import { ActionError } from "./action-error";

/**
 * Field receipts sometimes omit the per-litre price, but they always contain
 * litres and a total. Deriving rate from those two facts means the accounting
 * record reflects the amount the driver actually saw at the pump.
 *
 * ₹500/L is deliberately a very loose sanity ceiling: it catches a misplaced
 * decimal or malicious payload without making ordinary retail-price changes a
 * reason a driver cannot close a refuelling record.
 */
export function driverFuelDetails(quantity: number, amount: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ActionError("Fuel quantity must be greater than 0 litres.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ActionError("Enter the amount paid for this fuel fill.");
  }
  const rate = amount / quantity;
  if (!Number.isFinite(rate) || rate > 500) {
    throw new ActionError("Fuel amount does not match a plausible price per litre. Check litres and amount.");
  }
  return {
    // Store money in paise precision and retain enough rate precision that the
    // displayed amount still reconciles after a fractional-litre fill.
    amount: Math.round(amount * 100) / 100,
    rate: Math.round(rate * 10_000) / 10_000,
  };
}
