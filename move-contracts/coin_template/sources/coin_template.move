/// Coin template module for dynamic tribe credit creation.
///
/// This module is compiled once and its bytecode is used as a template.
/// At runtime, the TypeScript publishing code patches the bytecode to:
///   1. Rename the module (coin_template → e.g. co86)
///   2. Rename the OTW struct (COIN_TEMPLATE → e.g. CO86)
///   3. Update the symbol constant ("TMPL" → e.g. "CO86")
///   4. Update the name constant ("Template Credits" → e.g. "CO86 Credits")
///
/// After publishing, the TreasuryCap is transferred to the publisher and then
/// passed to vault::create_vault to create the tribe's vault.
module coin_template::coin_template;

use sui::coin;

/// One-Time Witness — identifier is patched in bytecode before publishing.
public struct COIN_TEMPLATE has drop {}

fun init(witness: COIN_TEMPLATE, ctx: &mut TxContext) {
    let (cap, metadata) = coin::create_currency(
        witness,
        9,                          // decimals (same as EVE / SUI)
        b"TMPL",                    // symbol — patched to tribe ticker
        b"Template Credits",        // name   — patched to "<TICKER> Credits"
        b"Tribe credit tokens backed by EVE",
        option::none(),             // icon URL
        ctx,
    );

    // Transfer TreasuryCap to publisher — will be passed to vault::create_vault
    transfer::public_transfer(cap, ctx.sender());
    // Share metadata for public display (wallets, explorers)
    transfer::public_share_object(metadata);
}
