/**
 * Known deployment records that should survive database resets.
 *
 * When the app starts with a fresh database (e.g. after a Railway redeploy),
 * these records are seeded so tribe coins that were published on-chain
 * are immediately recognised without manual intervention.
 *
 * To add a new tribe coin, append an entry to KNOWN_DEPLOYMENTS below.
 * The seed is idempotent — existing records are never overwritten.
 */

import type Database from "better-sqlite3";

interface KnownDeployment {
  tribeId: string;
  coinPackageId: string;
  creditCoinType: string;
  creditMetadataId?: string;
  packageId?: string;
  registryId?: string;
  systemManagerCapId?: string;
}

const KNOWN_DEPLOYMENTS: KnownDeployment[] = [
  {
    tribeId: "1000167",
    coinPackageId: "0x541b479a10fc084f70e1ee55694170095ff978c0535c47abebb2f4f4324fbd44",
    creditCoinType: "0x541b479a10fc084f70e1ee55694170095ff978c0535c47abebb2f4f4324fbd44::co86::CO86",
  },
  {
    tribeId: "98000438",
    coinPackageId: "0x9b833b79371c5adc035e4be53b424fce576bf7e2a892979c0d710bdb78001ea9",
    creditCoinType: "0x9b833b79371c5adc035e4be53b424fce576bf7e2a892979c0d710bdb78001ea9::awar::AWAR",
  },
];

/**
 * Seed known deployment records into the database.
 * Uses INSERT OR IGNORE so existing records are never overwritten —
 * if a tribe later publishes a new coin, their updated record is preserved.
 */
export function seedDeployments(sqlite: Database.Database): void {
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO deployments (tribe_id, package_id, registry_id, credit_coin_type, credit_metadata_id, coin_package_id, system_manager_cap_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const d of KNOWN_DEPLOYMENTS) {
    stmt.run(
      d.tribeId,
      d.packageId ?? "",
      d.registryId ?? "",
      d.creditCoinType,
      d.creditMetadataId ?? "",
      d.coinPackageId,
      d.systemManagerCapId ?? "",
      Date.now(),
    );
  }
}
