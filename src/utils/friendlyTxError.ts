/**
 * Parse raw Sui RPC / wallet errors and return a human-friendly message.
 */
export function friendlyTxError(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);

  // Try parsing JSON-wrapped RPC errors
  let msg = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message) msg = parsed.message;
  } catch {
    /* not JSON */
  }

  // Insufficient SUI for gas
  if (/insufficient SUI balance|gas selection/i.test(msg)) {
    return "Not enough SUI to pay for transaction gas. Use the \u26FD Faucet button in the toolbar to get your address and visit faucet.sui.io for free testnet SUI.";
  }

  // User rejected / cancelled
  if (/user rejected|rejected by user|denied|cancelled/i.test(msg)) {
    return "Transaction cancelled by user.";
  }

  // Insufficient budget (pay_reward)
  if (/EInsufficientBudget|insufficient budget/i.test(msg)) {
    return "The tribe\u2019s reward budget doesn\u2019t have enough credits for this withdrawal.";
  }

  // Empty vault
  if (/EEmptyVault|empty vault/i.test(msg)) {
    return "The tribe vault has no EVE backing \u2014 nothing to redeem.";
  }

  // Zero deposit / redeem
  if (/EZeroDeposit|EZeroRedeem/i.test(msg)) {
    return "Amount must be greater than zero.";
  }

  // Storage unit not online (out of fuel)
  if (/ENotOnline/i.test(msg)) {
    return "The storage unit is offline — it may be out of fuel. Ask the SSU owner to refuel it in-game.";
  }

  // Extension not authorized
  if (/EExtensionNotAuthorized/i.test(msg)) {
    return "The SSU extension is not authorized. The SSU owner needs to click \"Authorize Extension\" first.";
  }

  // Item not found / insufficient quantity
  if (/EItemNotFound|EInsufficientQuantity/i.test(msg)) {
    return "The requested items are not available in the inventory (not found or insufficient quantity).";
  }

  // Stale object version — previous transaction changed the object
  if (/not available for consumption|current version/i.test(msg)) {
    return "A previous transaction is still being processed. Please wait a few seconds and try again.";
  }

  // Generic MoveAbort — extract the human-readable error name
  const moveAbort = msg.match(/'(E[A-Z][A-Za-z]+)'/);
  if (moveAbort) {
    const name = moveAbort[1].replace(/([a-z])([A-Z])/g, "$1 $2");
    return `Transaction failed: ${name}.`;
  }

  // Truncate overly long messages
  return msg.length > 200 ? msg.slice(0, 200) + "\u2026" : msg;
}
