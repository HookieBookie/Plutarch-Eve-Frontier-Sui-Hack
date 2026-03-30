/**
 * Pre-compiled bytecode for the coin_template Move module.
 *
 * Generated from move-contracts/coin_template/ via:
 *   sui move build --dump-bytecode-as-base64 --silence-warnings --path move-contracts/coin_template
 *
 * This bytecode is patched at runtime using @mysten/move-bytecode-template
 * to create unique coin types per tribe (e.g. CO86, JA14).
 *
 * Template identifiers to replace:
 *   COIN_TEMPLATE → <TICKER>  (struct/OTW name)
 *   coin_template → <ticker>  (module name, lowercase)
 *
 * Template constants to replace:
 *   index 0: "TMPL"              → ticker symbol (e.g. "CO86")
 *   index 1: "Template Credits"  → coin display name (e.g. "CO86 Credits")
 */
export const COIN_TEMPLATE_BYTECODE = "oRzrCwYAAAAKAQAMAgweAyoiBEwIBVRJB50BvwEI3AJgBrwDQQr9AwUMggQkAAcBDAIGAhACEQISAAACAAECBwEAAAIBDAEAAQIDDAEAAQQEAgAFBQcAAAoAAQABCwEEAQACCAYHAQIDDQwBAQwDDgsBAQwEDwgJAAEDAgUECgMCAggABwgEAAELAgEIAAEIBQELAQEJAAEIAAcJAAIKAgoCCgILAQEIBQcIBAILAwEJAAsCAQkAAQYIBAEFAQsDAQgAAgkABQEJAA1DT0lOX1RFTVBMQVRFDENvaW5NZXRhZGF0YQZPcHRpb24LVHJlYXN1cnlDYXAJVHhDb250ZXh0A1VybARjb2luDWNvaW5fdGVtcGxhdGUPY3JlYXRlX2N1cnJlbmN5C2R1bW15X2ZpZWxkBGluaXQEbm9uZQZvcHRpb24TcHVibGljX3NoYXJlX29iamVjdA9wdWJsaWNfdHJhbnNmZXIGc2VuZGVyCHRyYW5zZmVyCnR4X2NvbnRleHQDdXJsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCgIFBFRNUEwKAhEQVGVtcGxhdGUgQ3JlZGl0cwoCIiFUcmliZSBjcmVkaXQgdG9rZW5zIGJhY2tlZCBieSBFVkUAAgEJAQAAAAACEAsAMQkHAAcBBwI4AAoBOAEMAgsBLhEFOAILAjgDAgA=";

export const COIN_TEMPLATE_DEPENDENCIES = [
  "0x0000000000000000000000000000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000000000000000000000000000002",
];
