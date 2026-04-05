import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and, or, sql, inArray } from "drizzle-orm";
import {
  kvStore, balances, ledgerEntries, marketOrders, marketHistory,
  tribeSettings, deployments, ssuRegistrations, members,
  wings, wingMembers, allocations,
  goals, missions, missionWingAssignments,
  ssuLocations, ssuNetworkSettings, locationAccessGrants,
  locationAccessRequests, locationBlocked, locationWhitelist,
  networkMapNodes, networkMapLinks, networkMapWaypoints, networkMapDataShares,
  priceSnapshots, tribeCoinOrders, externalSsus,
  contracts, contractMissions, contractItemEscrow,
  deliveries, deliveryCouriers,
  packages, packageItems,
  corporateInventory,
  overlaySubscriptions, overlaySettings,
} from "./schema";
import { initLocationKey, encryptField, decryptField } from "./crypto";
import { seedDeployments } from "./seed";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";

let _db: BetterSQLite3Database | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;
let _activeTenant: string = "";

// ═══════════════════════════════════════════════════════════════════════════
// Input sanitisation — protects against XSS and injection
// ═══════════════════════════════════════════════════════════════════════════

/** Strip HTML/script tags and trim whitespace. Use on all user-supplied strings. */
export function sanitise(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")           // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")  // strip control chars
    .trim();
}

/** Sanitise every string value in a flat object (shallow). */
export function sanitiseRecord<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "string") {
      (out as Record<string, unknown>)[key] = sanitise(out[key] as string);
    }
  }
  return out;
}

/** Recursively sanitise every string value in an object/array tree. */
export function deepSanitise<T>(obj: T): T {
  if (typeof obj === "string") return sanitise(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(deepSanitise) as unknown as T;
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = deepSanitise(val);
    }
    return out as T;
  }
  return obj;
}

/**
 * Initialise (or return the existing) database connection.
 * Each tenant gets its own database file for hard data isolation.
 * Call once at server start with the dapps root directory and tenant ID.
 */
export function initDb(dappsDir: string, tenant?: string): BetterSQLite3Database {
  if (_db) return _db;

  const safeTenant = (tenant ?? "default").replace(/[^a-zA-Z0-9_-]/g, "");
  _activeTenant = safeTenant;
  const dbPath = path.join(dappsDir, `tribe-${safeTenant}.db`);
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");

  // Create all tables on first run
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      prefix  TEXT NOT NULL,
      key     TEXT NOT NULL,
      data    TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (prefix, key)
    );

    CREATE TABLE IF NOT EXISTS balances (
      tribe_id   TEXT NOT NULL,
      wallet     TEXT NOT NULL,
      amount     REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (tribe_id, wallet)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id           TEXT NOT NULL,
      tribe_id         TEXT NOT NULL,
      timestamp        INTEGER NOT NULL,
      event_type       TEXT NOT NULL,
      goal_id          REAL,
      goal_type        TEXT,
      goal_description TEXT,
      mission_idx      INTEGER,
      mission_phase    TEXT,
      mission_item     TEXT,
      amount           REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_scope ON ledger_entries(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS market_orders (
      id             TEXT PRIMARY KEY,
      ssu_id         TEXT NOT NULL,
      tribe_id       TEXT NOT NULL,
      side           TEXT NOT NULL,
      wallet         TEXT NOT NULL,
      player_name    TEXT NOT NULL,
      item_type_id   INTEGER NOT NULL,
      item_name      TEXT NOT NULL,
      quantity       INTEGER NOT NULL,
      price_per_unit REAL NOT NULL,
      fee            REAL NOT NULL,
      escrow_total   REAL NOT NULL,
      status         TEXT NOT NULL,
      created_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_scope ON market_orders(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS market_history (
      id             TEXT PRIMARY KEY,
      ssu_id         TEXT NOT NULL,
      tribe_id       TEXT NOT NULL,
      side           TEXT NOT NULL,
      buyer          TEXT NOT NULL,
      seller         TEXT NOT NULL,
      item_type_id   INTEGER NOT NULL,
      item_name      TEXT NOT NULL,
      quantity       INTEGER NOT NULL,
      price_per_unit REAL NOT NULL,
      fee            REAL NOT NULL,
      completed_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_scope ON market_history(ssu_id, tribe_id);

    -- Phase 2 tables
    CREATE TABLE IF NOT EXISTS tribe_settings (
      tribe_id   TEXT PRIMARY KEY,
      tax_bps    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS deployments (
      tribe_id              TEXT PRIMARY KEY,
      package_id            TEXT NOT NULL,
      registry_id           TEXT NOT NULL,
      credit_coin_type      TEXT NOT NULL DEFAULT '',
      credit_metadata_id    TEXT NOT NULL DEFAULT '',
      coin_package_id       TEXT NOT NULL DEFAULT '',
      system_manager_cap_id TEXT NOT NULL DEFAULT '',
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS ssu_registrations (
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      hub_name        TEXT NOT NULL DEFAULT '',
      tribe_name      TEXT NOT NULL DEFAULT '',
      activated_at    TEXT NOT NULL,
      activated_by    TEXT NOT NULL,
      character_name  TEXT NOT NULL DEFAULT '',
      vault_object_id TEXT NOT NULL DEFAULT '',
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (ssu_id, tribe_id)
    );

    CREATE TABLE IF NOT EXISTS members (
      ssu_id       TEXT NOT NULL,
      tribe_id     TEXT NOT NULL,
      address      TEXT NOT NULL,
      name         TEXT NOT NULL,
      character_id INTEGER,
      joined_at    INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (ssu_id, tribe_id, address)
    );

    CREATE TABLE IF NOT EXISTS wings (
      id       TEXT PRIMARY KEY,
      ssu_id   TEXT NOT NULL,
      tribe_id TEXT NOT NULL,
      name     TEXT NOT NULL,
      color    TEXT NOT NULL DEFAULT '#888',
      symbol   TEXT NOT NULL DEFAULT '⬡'
    );
    CREATE INDEX IF NOT EXISTS idx_wings_scope ON wings(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS wing_members (
      wing_id TEXT NOT NULL,
      address TEXT NOT NULL,
      PRIMARY KEY (wing_id, address)
    );

    CREATE TABLE IF NOT EXISTS allocations (
      id           TEXT PRIMARY KEY,
      ssu_id       TEXT NOT NULL,
      tribe_id     TEXT NOT NULL,
      item_type_id INTEGER NOT NULL,
      item_name    TEXT NOT NULL,
      wing_id      TEXT NOT NULL,
      quantity     INTEGER NOT NULL,
      allocated_by TEXT NOT NULL,
      allocated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alloc_scope ON allocations(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS goals (
      id              INTEGER PRIMARY KEY,
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      type            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      budget          REAL NOT NULL DEFAULT 0,
      tier_percents   TEXT NOT NULL DEFAULT '[25,50,75]',
      status          TEXT NOT NULL DEFAULT 'draft',
      budget_awarded  REAL NOT NULL DEFAULT 0,
      started_at      INTEGER,
      ongoing         INTEGER NOT NULL DEFAULT 0,
      cycle_count     INTEGER NOT NULL DEFAULT 0,
      cycle_started_at INTEGER,
      acquire_rewards TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_goals_scope ON goals(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS missions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id        INTEGER NOT NULL,
      idx            INTEGER NOT NULL,
      phase          TEXT NOT NULL,
      tier           INTEGER NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      quantity       INTEGER NOT NULL DEFAULT 0,
      type_id        INTEGER,
      is_alternative INTEGER NOT NULL DEFAULT 0,
      alt_reason     TEXT,
      input_item     TEXT,
      is_published   INTEGER NOT NULL DEFAULT 0,
      completed_qty  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_missions_goal ON missions(goal_id);

    CREATE TABLE IF NOT EXISTS mission_wing_assignments (
      mission_id INTEGER NOT NULL,
      wing_id    TEXT NOT NULL,
      PRIMARY KEY (mission_id, wing_id)
    );

    -- Phase 3: Network & Territory tables
    CREATE TABLE IF NOT EXISTS ssu_locations (
      ssu_id              TEXT NOT NULL,
      tribe_id            TEXT NOT NULL,
      solar_system_id     TEXT NOT NULL,
      solar_system_name   TEXT NOT NULL DEFAULT '',
      location_x          TEXT NOT NULL DEFAULT '',
      location_y          TEXT NOT NULL DEFAULT '',
      location_z          TEXT NOT NULL DEFAULT '',
      created_by          TEXT NOT NULL,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (ssu_id, tribe_id)
    );

    CREATE TABLE IF NOT EXISTS ssu_network_settings (
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      visibility      TEXT NOT NULL DEFAULT 'tribal',
      location_policy TEXT NOT NULL DEFAULT 'manual',
      budget_mode     TEXT NOT NULL DEFAULT 'shared',
      local_budget    INTEGER NOT NULL DEFAULT 0,
      network_node_id TEXT,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (ssu_id, tribe_id)
    );

    CREATE TABLE IF NOT EXISTS location_access_grants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id     TEXT NOT NULL,
      tribe_id   TEXT NOT NULL,
      granted_to TEXT NOT NULL,
      granted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_grants_scope ON location_access_grants(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_grants_wallet ON location_access_grants(granted_to);

    CREATE TABLE IF NOT EXISTS location_access_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id            TEXT NOT NULL,
      tribe_id          TEXT NOT NULL,
      requester_address TEXT NOT NULL,
      requester_name    TEXT NOT NULL DEFAULT '',
      requester_ssu_id  TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      resolved_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_requests_scope ON location_access_requests(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_requests_requester ON location_access_requests(requester_address);

    CREATE TABLE IF NOT EXISTS location_blocked (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      blocked_address TEXT,
      blocked_ssu_id  TEXT,
      blocked_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_scope ON location_blocked(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS location_whitelist (
      ssu_id             TEXT NOT NULL,
      tribe_id           TEXT NOT NULL,
      whitelisted_ssu_id TEXT NOT NULL,
      added_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (ssu_id, tribe_id, whitelisted_ssu_id)
    );

    -- Universe data (cached from World API)
    CREATE TABLE IF NOT EXISTS solar_systems (
      id                INTEGER PRIMARY KEY,
      name              TEXT NOT NULL,
      location_x        REAL NOT NULL DEFAULT 0,
      location_y        REAL NOT NULL DEFAULT 0,
      location_z        REAL NOT NULL DEFAULT 0,
      constellation_id  INTEGER NOT NULL DEFAULT 0,
      region_id         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_solar_systems_name ON solar_systems(name COLLATE NOCASE);

    -- Phase 4: Network Map tables
    CREATE TABLE IF NOT EXISTS network_map_nodes (
      id              TEXT PRIMARY KEY,
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      label           TEXT NOT NULL DEFAULT '',
      map_x           REAL NOT NULL DEFAULT 0,
      map_y           REAL NOT NULL DEFAULT 0,
      visibility      TEXT NOT NULL DEFAULT 'tribal',
      added_by        TEXT NOT NULL,
      solar_system_name TEXT NOT NULL DEFAULT '',
      solar_system_id TEXT NOT NULL DEFAULT '',
      p_num           TEXT NOT NULL DEFAULT '',
      l_num           TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_map_nodes_tribe ON network_map_nodes(tribe_id);
    CREATE INDEX IF NOT EXISTS idx_map_nodes_ssu ON network_map_nodes(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS network_map_links (
      id              TEXT PRIMARY KEY,
      tribe_id        TEXT NOT NULL,
      from_node_id    TEXT NOT NULL,
      to_node_id      TEXT NOT NULL,
      link_type       TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      raw_route       TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_map_links_tribe ON network_map_links(tribe_id);
    CREATE INDEX IF NOT EXISTS idx_map_links_from ON network_map_links(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_map_links_to ON network_map_links(to_node_id);

    CREATE TABLE IF NOT EXISTS network_map_waypoints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id         TEXT NOT NULL,
      step_order      INTEGER NOT NULL,
      waypoint_type   TEXT NOT NULL,
      from_system     TEXT NOT NULL DEFAULT '',
      to_system       TEXT NOT NULL DEFAULT '',
      from_system_id  TEXT NOT NULL DEFAULT '',
      to_system_id    TEXT NOT NULL DEFAULT '',
      from_lpoint     TEXT NOT NULL DEFAULT '',
      to_lpoint       TEXT NOT NULL DEFAULT '',
      distance        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_waypoints_link ON network_map_waypoints(link_id);

    CREATE TABLE IF NOT EXISTS network_map_data_shares (
      link_id         TEXT NOT NULL,
      category        TEXT NOT NULL,
      PRIMARY KEY (link_id, category)
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tribe_id        TEXT NOT NULL,
      eve_backing     REAL NOT NULL,
      credit_supply   REAL NOT NULL,
      backing_ratio   REAL NOT NULL,
      timestamp       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_price_tribe ON price_snapshots(tribe_id);
    CREATE INDEX IF NOT EXISTS idx_price_time ON price_snapshots(tribe_id, timestamp);

    CREATE TABLE IF NOT EXISTS tribe_coin_orders (
      id                TEXT PRIMARY KEY,
      wallet            TEXT NOT NULL,
      player_name       TEXT NOT NULL DEFAULT '',
      source_tribe_id   TEXT NOT NULL,
      target_tribe_id   TEXT NOT NULL,
      side              TEXT NOT NULL,
      quantity          REAL NOT NULL,
      limit_rate        REAL NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_tco_tribes ON tribe_coin_orders(source_tribe_id, target_tribe_id);
    CREATE INDEX IF NOT EXISTS idx_tco_wallet ON tribe_coin_orders(wallet);
    CREATE INDEX IF NOT EXISTS idx_tco_status ON tribe_coin_orders(status);

    CREATE TABLE IF NOT EXISTS contracts (
      id                TEXT PRIMARY KEY,
      ssu_id            TEXT NOT NULL,
      tribe_id          TEXT NOT NULL,
      creator_wallet    TEXT NOT NULL,
      creator_name      TEXT NOT NULL DEFAULT '',
      type              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      budget            REAL NOT NULL,
      tax_paid          REAL NOT NULL DEFAULT 0,
      visibility        TEXT NOT NULL DEFAULT 'tribe',
      post_duration_ms  INTEGER NOT NULL,
      mission_duration_ms INTEGER NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      acceptor_wallet   TEXT,
      acceptor_name     TEXT,
      acceptor_deposit  REAL NOT NULL DEFAULT 0,
      accepted_at       INTEGER,
      completed_at      INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_scope ON contracts(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_wallet);
    CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

    CREATE TABLE IF NOT EXISTS contract_missions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id    TEXT NOT NULL,
      idx            INTEGER NOT NULL,
      phase          TEXT NOT NULL,
      tier           INTEGER NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      quantity       INTEGER NOT NULL DEFAULT 0,
      type_id        INTEGER,
      is_alternative INTEGER NOT NULL DEFAULT 0,
      alt_reason     TEXT,
      input_item     TEXT,
      completed_qty  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cmissions_contract ON contract_missions(contract_id);

    CREATE TABLE IF NOT EXISTS contract_item_escrow (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id    TEXT NOT NULL,
      mission_idx    INTEGER NOT NULL,
      type_id        INTEGER NOT NULL,
      item_name      TEXT NOT NULL,
      quantity       INTEGER NOT NULL,
      deposited_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_cescrow_contract ON contract_item_escrow(contract_id);

    CREATE TABLE IF NOT EXISTS external_ssus (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id          TEXT NOT NULL,
      tribe_id        TEXT NOT NULL,
      external_ssu_id TEXT NOT NULL,
      added_by        TEXT NOT NULL,
      added_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_ext_ssu_local ON external_ssus(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_ext_ssu_external ON external_ssus(external_ssu_id);

    CREATE TABLE IF NOT EXISTS deliveries (
      id                   TEXT PRIMARY KEY,
      source_type          TEXT NOT NULL,
      source_id            TEXT NOT NULL,
      ssu_id               TEXT NOT NULL,
      tribe_id             TEXT NOT NULL,
      destination_ssu_id   TEXT NOT NULL,
      destination_tribe_id TEXT NOT NULL,
      destination_label    TEXT NOT NULL DEFAULT '',
      items                TEXT NOT NULL,
      collateral           REAL NOT NULL DEFAULT 0,
      timer_ms             INTEGER NOT NULL DEFAULT 86400000,
      status               TEXT NOT NULL DEFAULT 'pending',
      created_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_source ON deliveries(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_scope ON deliveries(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_dest ON deliveries(destination_ssu_id);

    CREATE TABLE IF NOT EXISTS delivery_couriers (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id        TEXT NOT NULL,
      courier_wallet     TEXT NOT NULL,
      courier_name       TEXT NOT NULL DEFAULT '',
      items_distributed  TEXT NOT NULL DEFAULT '[]',
      items_deposited    TEXT NOT NULL DEFAULT '[]',
      status             TEXT NOT NULL DEFAULT 'in-transit',
      accepted_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      completed_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_dcourier_delivery ON delivery_couriers(delivery_id);
    CREATE INDEX IF NOT EXISTS idx_dcourier_wallet ON delivery_couriers(courier_wallet);

    CREATE TABLE IF NOT EXISTS packages (
      id               TEXT PRIMARY KEY,
      ssu_id           TEXT NOT NULL,
      tribe_id         TEXT NOT NULL,
      name             TEXT NOT NULL,
      ship_type        TEXT NOT NULL DEFAULT '',
      fitting_text     TEXT NOT NULL DEFAULT '',
      created_by       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'created',
      market_order_id  TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_packages_scope ON packages(ssu_id, tribe_id);

    CREATE TABLE IF NOT EXISTS package_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id    TEXT NOT NULL,
      item_type_id  INTEGER NOT NULL,
      item_name     TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      slot_type     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pkg_items_package ON package_items(package_id);

    CREATE TABLE IF NOT EXISTS corporate_inventory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ssu_id      TEXT NOT NULL,
      tribe_id    TEXT NOT NULL,
      type_id     INTEGER NOT NULL,
      item_name   TEXT NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_corp_inv_scope ON corporate_inventory(ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_corp_inv_item ON corporate_inventory(ssu_id, tribe_id, type_id);

    -- Overlay: mission subscriptions and display settings
    CREATE TABLE IF NOT EXISTS overlay_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet      TEXT NOT NULL,
      ssu_id      TEXT NOT NULL,
      tribe_id    TEXT NOT NULL,
      goal_id     INTEGER NOT NULL,
      mission_idx INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_overlay_wallet ON overlay_subscriptions(wallet, ssu_id, tribe_id);
    CREATE INDEX IF NOT EXISTS idx_overlay_goal ON overlay_subscriptions(goal_id);

    CREATE TABLE IF NOT EXISTS overlay_settings (
      wallet         TEXT PRIMARY KEY,
      opacity        REAL NOT NULL DEFAULT 0.85,
      position       TEXT NOT NULL DEFAULT 'top-right',
      show_alerts    INTEGER NOT NULL DEFAULT 1,
      show_missions  INTEGER NOT NULL DEFAULT 1,
      show_fuel      INTEGER NOT NULL DEFAULT 1,
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Incremental migrations — add columns that may not exist in older DBs
  try {
    _sqlite.exec(`ALTER TABLE ssu_locations ADD COLUMN solar_system_name TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_nodes ADD COLUMN solar_system_name TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_nodes ADD COLUMN p_num TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_nodes ADD COLUMN l_num TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_links ADD COLUMN raw_route TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_nodes ADD COLUMN solar_system_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_waypoints ADD COLUMN distance TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_waypoints ADD COLUMN from_system_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE network_map_waypoints ADD COLUMN to_system_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE ssu_network_settings ADD COLUMN budget_mode TEXT NOT NULL DEFAULT 'shared'`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE ssu_network_settings ADD COLUMN local_budget INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE ssu_locations ADD COLUMN p_num TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE ssu_locations ADD COLUMN l_num TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE goals ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE goals ADD COLUMN cycle_count INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE goals ADD COLUMN cycle_started_at INTEGER`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE goals ADD COLUMN acquire_rewards TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE missions ADD COLUMN alt_reason TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE missions ADD COLUMN input_item TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE delivery_couriers ADD COLUMN claim_digest TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE market_orders ADD COLUMN package_id TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE market_orders ADD COLUMN visibility TEXT NOT NULL DEFAULT 'tribal'`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE contract_missions ADD COLUMN input_item TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE allocations ADD COLUMN package_id TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE deliveries ADD COLUMN package_id TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE deliveries ADD COLUMN package_name TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE deliveries ADD COLUMN package_ship_type TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE deliveries ADD COLUMN package_fitting_text TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE deliveries ADD COLUMN package_created_by TEXT`);
  } catch { /* column already exists */ }
  try {
    _sqlite.exec(`ALTER TABLE ssu_network_settings ADD COLUMN network_node_id TEXT`);
  } catch { /* column already exists */ }

  _db = drizzle(_sqlite);

  // Initialise location encryption key
  initLocationKey(dappsDir);

  // Auto-migrate existing JSON files on first run
  migrateJsonFiles(dappsDir);

  // Migrate KV blobs → normalised tables (idempotent)
  migrateKvToTables();

  // Clean up old "SSU 0x..." names in ssu_registrations and network_map_nodes
  migrateOldSsuNames();

  // Seed known tribe deployment records so they survive DB resets
  seedDeployments(_sqlite!);

  // Auto-restore: prefer volume backup file, then fall back to DB_BACKUP env var
  const ssuCount = _sqlite!.prepare("SELECT COUNT(*) as cnt FROM ssu_registrations").get() as { cnt: number };
  if (ssuCount.cnt === 0) {
    const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    const backupFile = volumePath ? path.join(volumePath, "db-backup.json") : null;
    let restored = false;

    // Try volume file first
    if (backupFile && fs.existsSync(backupFile)) {
      try {
        const raw = fs.readFileSync(backupFile, "utf-8");
        const data = JSON.parse(raw);
        const result = importDatabase(data);
        console.log(`[DB] Auto-restored from volume backup: ${result.tablesRestored} tables, ${result.rowsRestored} rows`);
        restored = true;
      } catch (err) {
        console.error("[DB] Failed to restore from volume backup:", err);
      }
    }

    // Fall back to DB_BACKUP env var (one-time seed)
    if (!restored && process.env.DB_BACKUP) {
      try {
        const data = JSON.parse(Buffer.from(process.env.DB_BACKUP, "base64").toString("utf-8"));
        const result = importDatabase(data);
        console.log(`[DB] Auto-restored from DB_BACKUP env: ${result.tablesRestored} tables, ${result.rowsRestored} rows`);
      } catch (err) {
        console.error("[DB] Failed to restore from DB_BACKUP:", err);
      }
    }
  }

  // Start periodic auto-backup to volume file (no redeploy triggered)
  startAutoBackup();

  return _db;
}

// ═══════════════════════════════════════════════════════════════════════════
// KV store helpers (still used for non-Phase-1 endpoints)
// ═══════════════════════════════════════════════════════════════════════════

/** Read a JSON blob from the store. Returns null if not found. */
export function readStore(prefix: string, id: string): unknown {
  const result = _db!
    .select({ data: kvStore.data })
    .from(kvStore)
    .where(and(eq(kvStore.prefix, prefix), eq(kvStore.key, id)))
    .get();
  if (!result) return null;
  try {
    return JSON.parse(result.data);
  } catch {
    return null;
  }
}

/** Write (upsert) a JSON blob into the store. */
export function writeStore(prefix: string, id: string, data: unknown): void {
  _db!
    .insert(kvStore)
    .values({
      prefix,
      key: id,
      data: JSON.stringify(data),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [kvStore.prefix, kvStore.key],
      set: {
        data: JSON.stringify(data),
        updatedAt: new Date(),
      },
    })
    .run();
}

/** Return all parsed values whose prefix matches. */
export function listByPrefix(prefix: string): unknown[] {
  const results = _db!
    .select({ data: kvStore.data })
    .from(kvStore)
    .where(eq(kvStore.prefix, prefix))
    .all();
  return results
    .map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// Balance operations — atomic, no read-modify-write
// ═══════════════════════════════════════════════════════════════════════════

export function getBalance(tribeId: string, wallet: string): number {
  const row = _db!
    .select({ amount: balances.amount })
    .from(balances)
    .where(and(eq(balances.tribeId, tribeId), eq(balances.wallet, wallet)))
    .get();
  return row?.amount ?? 0;
}

export function getAllBalances(tribeId: string): Record<string, number> {
  const rows = _db!
    .select({ wallet: balances.wallet, amount: balances.amount })
    .from(balances)
    .where(eq(balances.tribeId, tribeId))
    .all();
  const result: Record<string, number> = {};
  for (const r of rows) result[r.wallet] = r.amount;
  return result;
}

/** Atomically adjust a balance by delta (positive to credit, negative to debit). */
export function adjustBalance(tribeId: string, wallet: string, delta: number): number {
  // Use a raw SQL upsert with atomic increment to avoid races
  _sqlite!.prepare(`
    INSERT INTO balances (tribe_id, wallet, amount, updated_at)
    VALUES (?, ?, MAX(0, ?), ?)
    ON CONFLICT(tribe_id, wallet)
    DO UPDATE SET amount = MAX(0, amount + ?), updated_at = ?
  `).run(tribeId, wallet, delta, Date.now(), delta, Date.now());

  return getBalance(tribeId, wallet);
}

/** Set a balance to an exact value. */
export function setBalance(tribeId: string, wallet: string, amount: number): void {
  _db!
    .insert(balances)
    .values({ tribeId, wallet, amount, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [balances.tribeId, balances.wallet],
      set: { amount, updatedAt: new Date() },
    })
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Ledger operations — append-only
// ═══════════════════════════════════════════════════════════════════════════

export interface LedgerInsert {
  eventType: string;
  goalId?: number;
  goalType?: string;
  goalDescription?: string;
  missionIdx?: number;
  missionPhase?: string;
  missionItem?: string;
  amount?: number;
}

export function getLedgerEntries(ssuId: string, tribeId: string) {
  return _db!
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.ssuId, ssuId), eq(ledgerEntries.tribeId, tribeId)))
    .all();
}

export function insertLedgerEntries(
  ssuId: string,
  tribeId: string,
  entries: LedgerInsert[],
): void {
  if (entries.length === 0) return;
  const now = new Date();
  _db!.insert(ledgerEntries).values(
    entries.map((e) => ({
      ssuId,
      tribeId,
      timestamp: now,
      eventType: e.eventType,
      goalId: e.goalId,
      goalType: e.goalType,
      goalDescription: e.goalDescription,
      missionIdx: e.missionIdx,
      missionPhase: e.missionPhase,
      missionItem: e.missionItem,
      amount: e.amount,
    })),
  ).run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Market operations
// ═══════════════════════════════════════════════════════════════════════════

export function getMarketOrders(ssuId: string, tribeId: string) {
  return _db!
    .select()
    .from(marketOrders)
    .where(
      and(
        eq(marketOrders.ssuId, ssuId),
        or(
          eq(marketOrders.tribeId, tribeId),
          eq(marketOrders.visibility, "public"),
        ),
      ),
    )
    .all();
}

export function getMarketHistory(ssuId: string, tribeId: string) {
  return _db!
    .select()
    .from(marketHistory)
    .where(and(eq(marketHistory.ssuId, ssuId), eq(marketHistory.tribeId, tribeId)))
    .all();
}

export function getMarketOrderById(orderId: string) {
  return _db!
    .select()
    .from(marketOrders)
    .where(eq(marketOrders.id, orderId))
    .get();
}

export function insertMarketOrder(order: typeof marketOrders.$inferInsert): void {
  _db!.insert(marketOrders).values(order).run();
}

export function updateMarketOrderStatus(orderId: string, status: string): void {
  _db!
    .update(marketOrders)
    .set({ status })
    .where(eq(marketOrders.id, orderId))
    .run();
}

export function updateMarketOrderAfterPartialFill(
  orderId: string,
  newQuantity: number,
  newFee: number,
  newEscrowTotal: number,
): void {
  _db!
    .update(marketOrders)
    .set({ quantity: newQuantity, fee: newFee, escrowTotal: newEscrowTotal })
    .where(eq(marketOrders.id, orderId))
    .run();
}

export function insertMarketHistory(entry: typeof marketHistory.$inferInsert): void {
  _db!.insert(marketHistory).values(entry).run();
}

/** Run a function inside a SQLite transaction. */
export function runTransaction<T>(fn: () => T): T {
  return _sqlite!.transaction(fn)();
}

// ═══════════════════════════════════════════════════════════════════════════
// Tribe Settings operations
// ═══════════════════════════════════════════════════════════════════════════

export function getTribeSettings(tribeId: string): { taxBps: number } {
  const row = _db!
    .select({ taxBps: tribeSettings.taxBps })
    .from(tribeSettings)
    .where(eq(tribeSettings.tribeId, tribeId))
    .get();
  return { taxBps: row?.taxBps ?? 0 };
}

export function setTribeSettings(tribeId: string, taxBps: number): void {
  _db!
    .insert(tribeSettings)
    .values({ tribeId, taxBps, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tribeSettings.tribeId,
      set: { taxBps, updatedAt: new Date() },
    })
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Deployment Config operations
// ═══════════════════════════════════════════════════════════════════════════

export interface DeploymentRow {
  packageId: string;
  registryId: string;
  creditCoinType: string;
  creditMetadataId: string;
  coinPackageId: string;
  systemManagerCapId: string;
}

export function getDeployment(tribeId: string): DeploymentRow | null {
  const row = _db!
    .select({
      packageId: deployments.packageId,
      registryId: deployments.registryId,
      creditCoinType: deployments.creditCoinType,
      creditMetadataId: deployments.creditMetadataId,
      coinPackageId: deployments.coinPackageId,
      systemManagerCapId: deployments.systemManagerCapId,
    })
    .from(deployments)
    .where(eq(deployments.tribeId, tribeId))
    .get();
  return row ?? null;
}

export function setDeployment(tribeId: string, cfg: DeploymentRow): void {
  _db!
    .insert(deployments)
    .values({ tribeId, ...cfg, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: deployments.tribeId,
      set: { ...cfg, updatedAt: new Date() },
    })
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// SSU Registration operations
// ═══════════════════════════════════════════════════════════════════════════

export interface SsuRow {
  ssuId: string;
  tribeId: string;
  hubName: string;
  tribeName: string;
  activatedAt: string;
  activatedBy: string;
  characterName: string;
  vaultObjectId: string;
}

export function getSsu(ssuId: string, tribeId: string): SsuRow | null {
  const row = _db!
    .select({
      ssuId: ssuRegistrations.ssuId,
      tribeId: ssuRegistrations.tribeId,
      hubName: ssuRegistrations.hubName,
      tribeName: ssuRegistrations.tribeName,
      activatedAt: ssuRegistrations.activatedAt,
      activatedBy: ssuRegistrations.activatedBy,
      characterName: ssuRegistrations.characterName,
      vaultObjectId: ssuRegistrations.vaultObjectId,
    })
    .from(ssuRegistrations)
    .where(and(eq(ssuRegistrations.ssuId, ssuId), eq(ssuRegistrations.tribeId, tribeId)))
    .get();
  return row ?? null;
}

export function getSsuBySsuId(ssuId: string): SsuRow | null {
  const row = _db!
    .select({
      ssuId: ssuRegistrations.ssuId,
      tribeId: ssuRegistrations.tribeId,
      hubName: ssuRegistrations.hubName,
      tribeName: ssuRegistrations.tribeName,
      activatedAt: ssuRegistrations.activatedAt,
      activatedBy: ssuRegistrations.activatedBy,
      characterName: ssuRegistrations.characterName,
      vaultObjectId: ssuRegistrations.vaultObjectId,
    })
    .from(ssuRegistrations)
    .where(eq(ssuRegistrations.ssuId, ssuId))
    .get();
  return row ?? null;
}

export function getAllSsus(): SsuRow[] {
  return _db!
    .select({
      ssuId: ssuRegistrations.ssuId,
      tribeId: ssuRegistrations.tribeId,
      hubName: ssuRegistrations.hubName,
      tribeName: ssuRegistrations.tribeName,
      activatedAt: ssuRegistrations.activatedAt,
      activatedBy: ssuRegistrations.activatedBy,
      characterName: ssuRegistrations.characterName,
      vaultObjectId: ssuRegistrations.vaultObjectId,
    })
    .from(ssuRegistrations)
    .all();
}

export function upsertSsu(ssu: SsuRow): void {
  _db!
    .insert(ssuRegistrations)
    .values({ ...ssu, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [ssuRegistrations.ssuId, ssuRegistrations.tribeId],
      set: {
        hubName: ssu.hubName,
        tribeName: ssu.tribeName,
        activatedAt: ssu.activatedAt,
        activatedBy: ssu.activatedBy,
        characterName: ssu.characterName,
        vaultObjectId: ssu.vaultObjectId,
        updatedAt: new Date(),
      },
    })
    .run();
}

/** Cascade-delete ALL data associated with an SSU. */
export function deleteSsu(ssuId: string, tribeId: string): void {
  runTransaction(() => {
    // Wing members (child of wings)
    const wingRows = _db!.select({ id: wings.id }).from(wings)
      .where(and(eq(wings.ssuId, ssuId), eq(wings.tribeId, tribeId))).all();
    for (const w of wingRows) {
      _db!.delete(wingMembers).where(eq(wingMembers.wingId, w.id)).run();
    }
    // Mission wing assignments (child of missions via goals)
    const goalRows = _db!.select({ id: goals.id }).from(goals)
      .where(and(eq(goals.ssuId, ssuId), eq(goals.tribeId, tribeId))).all();
    const goalIds = goalRows.map((g) => g.id);
    if (goalIds.length > 0) {
      const missionRows = _db!.select({ id: missions.id }).from(missions)
        .where(inArray(missions.goalId, goalIds)).all();
      for (const m of missionRows) {
        _db!.delete(missionWingAssignments).where(eq(missionWingAssignments.missionId, m.id)).run();
      }
    }
    // Contract missions & escrow (child of contracts)
    const contractRows = _db!.select({ id: contracts.id }).from(contracts)
      .where(and(eq(contracts.ssuId, ssuId), eq(contracts.tribeId, tribeId))).all();
    for (const c of contractRows) {
      _db!.delete(contractMissions).where(eq(contractMissions.contractId, c.id)).run();
      _db!.delete(contractItemEscrow).where(eq(contractItemEscrow.contractId, c.id)).run();
    }
    // Delivery couriers & deliveries (source SSU + destination SSU)
    const deliveryRows = _sqlite!.prepare(
      `SELECT id FROM deliveries WHERE (ssu_id = ? AND tribe_id = ?) OR destination_ssu_id = ?`
    ).all(ssuId, tribeId, ssuId) as { id: string }[];
    for (const d of deliveryRows) {
      _db!.delete(deliveryCouriers).where(eq(deliveryCouriers.deliveryId, d.id)).run();
    }
    _sqlite!.prepare(
      `DELETE FROM deliveries WHERE (ssu_id = ? AND tribe_id = ?) OR destination_ssu_id = ?`
    ).run(ssuId, tribeId, ssuId);
    // Network map links, waypoints, data shares (child of nodes for this SSU)
    const nodeRows = _db!.select({ id: networkMapNodes.id }).from(networkMapNodes)
      .where(eq(networkMapNodes.ssuId, ssuId)).all();
    if (nodeRows.length > 0) {
      const nodeIds = nodeRows.map((n) => n.id);
      const linkRows = _db!.select({ id: networkMapLinks.id }).from(networkMapLinks)
        .where(sql`${networkMapLinks.fromNodeId} IN (${sql.join(nodeIds.map(id => sql`${id}`), sql`, `)}) OR ${networkMapLinks.toNodeId} IN (${sql.join(nodeIds.map(id => sql`${id}`), sql`, `)})`)
        .all();
      for (const l of linkRows) {
        _db!.delete(networkMapWaypoints).where(eq(networkMapWaypoints.linkId, l.id)).run();
        _db!.delete(networkMapDataShares).where(eq(networkMapDataShares.linkId, l.id)).run();
      }
      if (linkRows.length > 0) {
        const linkIds = linkRows.map((l) => l.id);
        _db!.delete(networkMapLinks).where(inArray(networkMapLinks.id, linkIds)).run();
      }
    }
    // Direct ssuId-keyed tables
    _db!.delete(contracts).where(and(eq(contracts.ssuId, ssuId), eq(contracts.tribeId, tribeId))).run();
    if (goalIds.length > 0) {
      _db!.delete(missions).where(inArray(missions.goalId, goalIds)).run();
    }
    _db!.delete(goals).where(and(eq(goals.ssuId, ssuId), eq(goals.tribeId, tribeId))).run();
    _db!.delete(allocations).where(and(eq(allocations.ssuId, ssuId), eq(allocations.tribeId, tribeId))).run();
    _db!.delete(wings).where(and(eq(wings.ssuId, ssuId), eq(wings.tribeId, tribeId))).run();
    _db!.delete(members).where(and(eq(members.ssuId, ssuId), eq(members.tribeId, tribeId))).run();
    _db!.delete(ledgerEntries).where(and(eq(ledgerEntries.ssuId, ssuId), eq(ledgerEntries.tribeId, tribeId))).run();
    _db!.delete(marketOrders).where(and(eq(marketOrders.ssuId, ssuId), eq(marketOrders.tribeId, tribeId))).run();
    _db!.delete(marketHistory).where(and(eq(marketHistory.ssuId, ssuId), eq(marketHistory.tribeId, tribeId))).run();
    _db!.delete(locationAccessGrants).where(and(eq(locationAccessGrants.ssuId, ssuId), eq(locationAccessGrants.tribeId, tribeId))).run();
    _db!.delete(locationAccessRequests).where(and(eq(locationAccessRequests.ssuId, ssuId), eq(locationAccessRequests.tribeId, tribeId))).run();
    _db!.delete(locationBlocked).where(and(eq(locationBlocked.ssuId, ssuId), eq(locationBlocked.tribeId, tribeId))).run();
    _db!.delete(locationWhitelist).where(and(eq(locationWhitelist.ssuId, ssuId), eq(locationWhitelist.tribeId, tribeId))).run();
    // Cross-references: clean up OTHER SSUs that reference the deleted SSU
    _sqlite!.prepare(`DELETE FROM location_access_requests WHERE requester_ssu_id = ?`).run(ssuId);
    _sqlite!.prepare(`DELETE FROM location_blocked WHERE blocked_ssu_id = ?`).run(ssuId);
    _sqlite!.prepare(`DELETE FROM location_whitelist WHERE whitelisted_ssu_id = ?`).run(ssuId);
    _sqlite!.prepare(`DELETE FROM external_ssus WHERE external_ssu_id = ?`).run(ssuId);
    _db!.delete(networkMapNodes).where(eq(networkMapNodes.ssuId, ssuId)).run();
    _db!.delete(ssuNetworkSettings).where(and(eq(ssuNetworkSettings.ssuId, ssuId), eq(ssuNetworkSettings.tribeId, tribeId))).run();
    _db!.delete(ssuLocations).where(and(eq(ssuLocations.ssuId, ssuId), eq(ssuLocations.tribeId, tribeId))).run();
    _db!.delete(externalSsus).where(and(eq(externalSsus.ssuId, ssuId), eq(externalSsus.tribeId, tribeId))).run();
    _db!.delete(ssuRegistrations).where(and(eq(ssuRegistrations.ssuId, ssuId), eq(ssuRegistrations.tribeId, tribeId))).run();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Members operations
// ═══════════════════════════════════════════════════════════════════════════

export interface MemberRow {
  address: string;
  name: string;
  characterId: number | null;
  joinedAt: number;
}

export function getMembers(ssuId: string, tribeId: string): MemberRow[] {
  return _db!
    .select({
      address: members.address,
      name: members.name,
      characterId: members.characterId,
      joinedAt: members.joinedAt,
    })
    .from(members)
    .where(and(eq(members.ssuId, ssuId), eq(members.tribeId, tribeId)))
    .all();
}

export function setMembers(ssuId: string, tribeId: string, list: MemberRow[]): void {
  runTransaction(() => {
    _db!.delete(members)
      .where(and(eq(members.ssuId, ssuId), eq(members.tribeId, tribeId)))
      .run();
    if (list.length > 0) {
      _db!.insert(members).values(
        list.map((m) => ({
          ssuId,
          tribeId,
          address: m.address,
          name: m.name,
          characterId: m.characterId,
          joinedAt: m.joinedAt,
          updatedAt: new Date(),
        })),
      ).run();
    }
  });
}

/** Get all unique member wallet addresses for a tribe (across all SSUs). */
export function getTribeMemberAddresses(tribeId: string): string[] {
  const rows = _db!
    .selectDistinct({ address: members.address })
    .from(members)
    .where(eq(members.tribeId, tribeId))
    .all();
  return rows.map((r) => r.address);
}

/** Get all SSUs activated by any of the given wallet addresses (across all tribes). */
export function getSsusByActivators(wallets: string[]): SsuRow[] {
  if (wallets.length === 0) return [];
  return _db!
    .select({
      ssuId: ssuRegistrations.ssuId,
      tribeId: ssuRegistrations.tribeId,
      hubName: ssuRegistrations.hubName,
      tribeName: ssuRegistrations.tribeName,
      activatedAt: ssuRegistrations.activatedAt,
      activatedBy: ssuRegistrations.activatedBy,
      characterName: ssuRegistrations.characterName,
      vaultObjectId: ssuRegistrations.vaultObjectId,
    })
    .from(ssuRegistrations)
    .where(inArray(ssuRegistrations.activatedBy, wallets))
    .all();
}

// ═══════════════════════════════════════════════════════════════════════════
// Wings operations
// ═══════════════════════════════════════════════════════════════════════════

export interface WingRow {
  id: string;
  name: string;
  color: string;
  symbol: string;
  memberAddresses: string[];
}

export function getWings(ssuId: string, tribeId: string): WingRow[] {
  const wingRows = _db!
    .select()
    .from(wings)
    .where(and(eq(wings.ssuId, ssuId), eq(wings.tribeId, tribeId)))
    .all();

  return wingRows.map((w) => {
    const addrs = _db!
      .select({ address: wingMembers.address })
      .from(wingMembers)
      .where(eq(wingMembers.wingId, w.id))
      .all()
      .map((r) => r.address);
    return { id: w.id, name: w.name, color: w.color, symbol: w.symbol, memberAddresses: addrs };
  });
}

export function setWings(ssuId: string, tribeId: string, list: WingRow[]): void {
  runTransaction(() => {
    // Get existing wing IDs for this scope to delete their members
    const existing = _db!
      .select({ id: wings.id })
      .from(wings)
      .where(and(eq(wings.ssuId, ssuId), eq(wings.tribeId, tribeId)))
      .all();
    for (const w of existing) {
      _db!.delete(wingMembers).where(eq(wingMembers.wingId, w.id)).run();
    }
    _db!.delete(wings)
      .where(and(eq(wings.ssuId, ssuId), eq(wings.tribeId, tribeId)))
      .run();

    for (const w of list) {
      _db!.insert(wings).values({
        id: w.id, ssuId, tribeId, name: w.name, color: w.color, symbol: w.symbol,
      }).run();
      if (w.memberAddresses.length > 0) {
        _db!.insert(wingMembers).values(
          w.memberAddresses.map((addr) => ({ wingId: w.id, address: addr })),
        ).run();
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Allocations operations
// ═══════════════════════════════════════════════════════════════════════════

export interface AllocationRow {
  id: string;
  itemTypeId: number;
  itemName: string;
  wingId: string;
  quantity: number;
  allocatedBy: string;
  allocatedAt: number;
  packageId?: string | null;
}

export function getAllocations(ssuId: string, tribeId: string): AllocationRow[] {
  return _db!
    .select({
      id: allocations.id,
      itemTypeId: allocations.itemTypeId,
      itemName: allocations.itemName,
      wingId: allocations.wingId,
      quantity: allocations.quantity,
      allocatedBy: allocations.allocatedBy,
      allocatedAt: allocations.allocatedAt,
      packageId: allocations.packageId,
    })
    .from(allocations)
    .where(and(eq(allocations.ssuId, ssuId), eq(allocations.tribeId, tribeId)))
    .all();
}

export function setAllocations(ssuId: string, tribeId: string, list: AllocationRow[]): void {
  runTransaction(() => {
    _db!.delete(allocations)
      .where(and(eq(allocations.ssuId, ssuId), eq(allocations.tribeId, tribeId)))
      .run();
    if (list.length > 0) {
      _db!.insert(allocations).values(
        list.map((a) => ({ ssuId, tribeId, ...a })),
      ).run();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Corporate Inventory — per-tribe claims on open storage items
// ═══════════════════════════════════════════════════════════════════════════

export interface CorporateInventoryRow {
  typeId: number;
  itemName: string;
  quantity: number;
}

export function getCorporateInventory(ssuId: string, tribeId: string): CorporateInventoryRow[] {
  return _db!
    .select({
      typeId: corporateInventory.typeId,
      itemName: corporateInventory.itemName,
      quantity: corporateInventory.quantity,
    })
    .from(corporateInventory)
    .where(and(eq(corporateInventory.ssuId, ssuId), eq(corporateInventory.tribeId, tribeId)))
    .all()
    .filter((r) => r.quantity > 0);
}

export function getAllCorporateInventory(ssuId: string): { tribeId: string; typeId: number; quantity: number }[] {
  return _db!
    .select({
      tribeId: corporateInventory.tribeId,
      typeId: corporateInventory.typeId,
      quantity: corporateInventory.quantity,
    })
    .from(corporateInventory)
    .where(eq(corporateInventory.ssuId, ssuId))
    .all()
    .filter((r) => r.quantity > 0);
}

export function addCorporateInventory(
  ssuId: string, tribeId: string, typeId: number, itemName: string, quantity: number,
): void {
  const existing = _db!
    .select()
    .from(corporateInventory)
    .where(
      and(
        eq(corporateInventory.ssuId, ssuId),
        eq(corporateInventory.tribeId, tribeId),
        eq(corporateInventory.typeId, typeId),
      ),
    )
    .get();
  if (existing) {
    _sqlite!.prepare(
      `UPDATE corporate_inventory SET quantity = quantity + ?, item_name = ?, updated_at = ? WHERE id = ?`
    ).run(quantity, itemName, Date.now(), existing.id);
  } else {
    _db!.insert(corporateInventory).values({
      ssuId, tribeId, typeId, itemName, quantity, updatedAt: Date.now(),
    }).run();
  }
}

export function removeCorporateInventory(
  ssuId: string, tribeId: string, typeId: number, quantity: number,
): void {
  const existing = _db!
    .select()
    .from(corporateInventory)
    .where(
      and(
        eq(corporateInventory.ssuId, ssuId),
        eq(corporateInventory.tribeId, tribeId),
        eq(corporateInventory.typeId, typeId),
      ),
    )
    .get();
  if (existing) {
    const newQty = Math.max(0, existing.quantity - quantity);
    _sqlite!.prepare(
      `UPDATE corporate_inventory SET quantity = ?, updated_at = ? WHERE id = ?`
    ).run(newQty, Date.now(), existing.id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Goals + Missions operations
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionRow {
  idx: number;
  phase: string;
  tier: number;
  description: string;
  quantity: number;
  typeId: number | null;
  isAlternative: boolean;
  altReason: string | null;
  inputItem: string | null;
  isPublished: boolean;
  completedQty: number;
  wingIds: string[];
}

export interface GoalRow {
  id: number;
  type: string;
  description: string;
  budget: number;
  tierPercents: number[];
  status: string;
  budgetAwarded: number;
  startedAt: number | null;
  ongoing: boolean;
  cycleCount: number;
  cycleStartedAt: number | null;
  acquireRewards: [number, number][] | null;
  missions: MissionRow[];
}

export function getGoals(ssuId: string, tribeId: string): GoalRow[] {
  const goalRows = _db!
    .select()
    .from(goals)
    .where(and(eq(goals.ssuId, ssuId), eq(goals.tribeId, tribeId)))
    .all();

  return goalRows.map((g) => {
    const missionRows = _db!
      .select()
      .from(missions)
      .where(eq(missions.goalId, g.id))
      .all();

    const missionList: MissionRow[] = missionRows.map((m) => {
      const wIds = _db!
        .select({ wingId: missionWingAssignments.wingId })
        .from(missionWingAssignments)
        .where(eq(missionWingAssignments.missionId, m.id))
        .all()
        .map((r) => r.wingId);
      return {
        idx: m.idx,
        phase: m.phase,
        tier: m.tier,
        description: m.description,
        quantity: m.quantity,
        typeId: m.typeId,
        isAlternative: m.isAlternative,
        altReason: m.altReason ?? null,
        inputItem: m.inputItem ?? null,
        isPublished: m.isPublished,
        completedQty: m.completedQty,
        wingIds: wIds,
      };
    });

    let tierPercents: number[];
    try { tierPercents = JSON.parse(g.tierPercents); } catch { tierPercents = [25, 50, 75]; }

    let acquireRewards: [number, number][] | null = null;
    try { if (g.acquireRewards) acquireRewards = JSON.parse(g.acquireRewards); } catch { /* ignore */ }

    return {
      id: g.id,
      type: g.type,
      description: g.description,
      budget: g.budget,
      tierPercents,
      status: g.status,
      budgetAwarded: g.budgetAwarded,
      startedAt: g.startedAt,
      ongoing: g.ongoing === 1,
      cycleCount: g.cycleCount ?? 0,
      cycleStartedAt: g.cycleStartedAt ?? null,
      acquireRewards,
      missions: missionList,
    };
  });
}

export function setGoals(ssuId: string, tribeId: string, goalList: GoalRow[]): void {
  runTransaction(() => {
    // Get existing goals for this scope
    const existing = _db!
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.ssuId, ssuId), eq(goals.tribeId, tribeId)))
      .all();

    // Delete existing missions, wing assignments, and goals
    for (const g of existing) {
      const existingMissions = _db!
        .select({ id: missions.id })
        .from(missions)
        .where(eq(missions.goalId, g.id))
        .all();
      for (const m of existingMissions) {
        _db!.delete(missionWingAssignments).where(eq(missionWingAssignments.missionId, m.id)).run();
      }
      _db!.delete(missions).where(eq(missions.goalId, g.id)).run();
    }
    _db!.delete(goals)
      .where(and(eq(goals.ssuId, ssuId), eq(goals.tribeId, tribeId)))
      .run();

    // Insert new goals + missions
    for (const g of goalList) {
      _db!.insert(goals).values({
        id: g.id,
        ssuId,
        tribeId,
        type: g.type,
        description: g.description,
        budget: g.budget,
        tierPercents: JSON.stringify(g.tierPercents),
        status: g.status,
        budgetAwarded: g.budgetAwarded,
        startedAt: g.startedAt,
        ongoing: g.ongoing ? 1 : 0,
        cycleCount: g.cycleCount ?? 0,
        cycleStartedAt: g.cycleStartedAt ?? null,
        acquireRewards: g.acquireRewards ? JSON.stringify(g.acquireRewards) : null,
        createdAt: Date.now(),
      }).run();

      for (const m of g.missions) {
        const result = _sqlite!.prepare(`
          INSERT INTO missions (goal_id, idx, phase, tier, description, quantity, type_id, is_alternative, alt_reason, input_item, is_published, completed_qty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          g.id, m.idx, m.phase, m.tier, m.description, m.quantity,
          m.typeId, m.isAlternative ? 1 : 0, m.altReason ?? null, m.inputItem ?? null, m.isPublished ? 1 : 0, m.completedQty,
        );
        const missionId = result.lastInsertRowid as number;
        if (m.wingIds.length > 0) {
          _db!.insert(missionWingAssignments).values(
            m.wingIds.map((wid) => ({ missionId, wingId: wid })),
          ).run();
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Migration: JSON files → KV store (unchanged from before)
// ═══════════════════════════════════════════════════════════════════════════

const KNOWN_PREFIXES = [
  "tribe-store",
  "ssu-store",
  "goals-store",
  "deployment-store",
  "balance-store",
  "market-store",
  "recipes-store",
  "wings-store",
  "members-store",
  "ledger-store",
  "allocations-store",
  "tribe-settings",
  "last-ssu",
];

function migrateJsonFiles(dappsDir: string): void {
  // JSON files in dapps/ are legacy Utopia data — only import for that tenant
  if (_activeTenant !== "utopia") return;

  // Skip if DB already has data
  const count = _db!.select({ data: kvStore.data }).from(kvStore).all().length;
  if (count > 0) return;

  let files: string[];
  try {
    files = fs.readdirSync(dappsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }

  let migrated = 0;
  for (const file of files) {
    const basename = file.replace(/\.json$/, "");

    // Match against known prefixes to split prefix from key
    const matched = KNOWN_PREFIXES.find((p) => basename.startsWith(p + "-"));
    if (!matched) continue;

    const key = basename.slice(matched.length + 1); // +1 for the separator hyphen
    if (!key) continue;

    try {
      const content = fs.readFileSync(path.join(dappsDir, file), "utf-8");
      const data = JSON.parse(content);
      writeStore(matched, key, data);
      migrated++;
    } catch {
      // Skip malformed files
    }
  }

  if (migrated > 0) {
    console.log(`[db] Migrated ${migrated} JSON files into tribe.db`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Migration: KV blobs → normalised tables (run once, idempotent)
// ═══════════════════════════════════════════════════════════════════════════

function migrateKvToTables(): void {
  // Only migrate if normalised tables are empty
  const balanceCount = _db!.select({ id: balances.wallet }).from(balances).all().length;
  if (balanceCount > 0) return;

  let migrated = 0;

  // --- Balances ---
  const balanceRows = _db!
    .select({ key: kvStore.key, data: kvStore.data })
    .from(kvStore)
    .where(eq(kvStore.prefix, "balance-store"))
    .all();
  for (const row of balanceRows) {
    try {
      const store: Record<string, number> = JSON.parse(row.data);
      for (const [wallet, amount] of Object.entries(store)) {
        setBalance(row.key, wallet, amount);
        migrated++;
      }
    } catch { /* skip */ }
  }

  // --- Ledger ---
  const ledgerRows = _db!
    .select({ key: kvStore.key, data: kvStore.data })
    .from(kvStore)
    .where(eq(kvStore.prefix, "ledger-store"))
    .all();
  for (const row of ledgerRows) {
    try {
      const blob: { entries: Array<Record<string, unknown>> } = JSON.parse(row.data);
      if (!Array.isArray(blob?.entries)) continue;
      // key format: "ssuId__tTribeId"
      const parts = row.key.split("__t");
      const ssuId = parts[0];
      const tribeId = parts[1] ?? "";
      for (const e of blob.entries) {
        _db!.insert(ledgerEntries).values({
          ssuId,
          tribeId,
          timestamp: new Date(e.timestamp as number),
          eventType: e.eventType as string,
          goalId: e.goalId as number | undefined,
          goalType: e.goalType as string | undefined,
          goalDescription: e.goalDescription as string | undefined,
          missionIdx: e.missionIdx as number | undefined,
          missionPhase: e.missionPhase as string | undefined,
          missionItem: e.missionItem as string | undefined,
          amount: e.amount as number | undefined,
        }).run();
        migrated++;
      }
    } catch { /* skip */ }
  }

  // --- Market orders + history ---
  const marketRows = _db!
    .select({ key: kvStore.key, data: kvStore.data })
    .from(kvStore)
    .where(eq(kvStore.prefix, "market-store"))
    .all();
  for (const row of marketRows) {
    try {
      const blob: { orders: Array<Record<string, unknown>>; history: Array<Record<string, unknown>> } = JSON.parse(row.data);
      const parts = row.key.split("__t");
      const ssuId = parts[0];
      const tribeId = parts[1] ?? "";
      for (const o of blob.orders ?? []) {
        _db!.insert(marketOrders).values({
          id: o.id as string,
          ssuId,
          tribeId,
          side: o.side as string,
          wallet: o.wallet as string,
          playerName: o.playerName as string,
          itemTypeId: Number(o.itemTypeId),
          itemName: o.itemName as string,
          quantity: o.quantity as number,
          pricePerUnit: o.pricePerUnit as number,
          fee: o.fee as number,
          escrowTotal: o.escrowTotal as number,
          status: o.status as string,
          createdAt: o.createdAt as string,
        }).run();
        migrated++;
      }
      for (const h of blob.history ?? []) {
        _db!.insert(marketHistory).values({
          id: h.id as string,
          ssuId,
          tribeId,
          side: h.side as string,
          buyer: h.buyer as string,
          seller: h.seller as string,
          itemTypeId: Number(h.itemTypeId),
          itemName: h.itemName as string,
          quantity: h.quantity as number,
          pricePerUnit: h.pricePerUnit as number,
          fee: h.fee as number,
          completedAt: h.completedAt as string,
        }).run();
        migrated++;
      }
    } catch { /* skip */ }
  }

  if (migrated > 0) {
    console.log(`[db] Migrated ${migrated} records from KV blobs into normalised tables`);
  }

  // --- Phase 2 migration ---
  migrateKvToPhase2Tables();
}

/**
 * Phase 2 KV → normalised tables migration (idempotent).
 * Each section checks if the normalised table already has data before migrating.
 */
function migrateKvToPhase2Tables(): void {
  let migrated = 0;

  // --- Tribe Settings ---
  const settingsCount = _db!.select({ id: tribeSettings.tribeId }).from(tribeSettings).all().length;
  if (settingsCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "tribe-settings"))
      .all();
    for (const row of rows) {
      try {
        const blob: { taxBps?: number } = JSON.parse(row.data);
        setTribeSettings(row.key, Number(blob.taxBps) || 0);
        migrated++;
      } catch { /* skip */ }
    }
  }

  // --- Deployments ---
  const deployCount = _db!.select({ id: deployments.tribeId }).from(deployments).all().length;
  if (deployCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "deployment-store"))
      .all();
    for (const row of rows) {
      try {
        const blob = JSON.parse(row.data) as Record<string, string>;
        setDeployment(row.key, {
          packageId: blob.packageId ?? "",
          registryId: blob.registryId ?? "",
          creditCoinType: blob.creditCoinType ?? "",
          creditMetadataId: blob.creditMetadataId ?? "",
          coinPackageId: blob.coinPackageId ?? "",
          systemManagerCapId: blob.systemManagerCapId ?? "",
        });
        migrated++;
      } catch { /* skip */ }
    }
  }

  // --- SSU Registrations ---
  const ssuCount = _db!.select({ id: ssuRegistrations.ssuId }).from(ssuRegistrations).all().length;
  if (ssuCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "ssu-store"))
      .all();
    for (const row of rows) {
      try {
        const blob = JSON.parse(row.data) as Record<string, string>;
        // Key is "ssuId__tTribeId" or just "ssuId"
        const parts = row.key.split("__t");
        const ssuId = blob.ssuId ?? parts[0];
        const tribeId = String(blob.tribeId ?? parts[1] ?? "");
        upsertSsu({
          ssuId,
          tribeId,
          hubName: blob.hubName ?? "",
          tribeName: blob.tribeName ?? "",
          activatedAt: blob.activatedAt ?? new Date().toISOString(),
          activatedBy: blob.activatedBy ?? "",
          characterName: blob.characterName ?? "",
          vaultObjectId: blob.vaultObjectId ?? "",
        });
        migrated++;
      } catch { /* skip */ }
    }
  }

  // --- Members ---
  const memCount = _db!.select({ id: members.address }).from(members).all().length;
  if (memCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "members-store"))
      .all();
    for (const row of rows) {
      try {
        const blob: { members?: Array<Record<string, unknown>> } = JSON.parse(row.data);
        if (!Array.isArray(blob?.members)) continue;
        const parts = row.key.split("__t");
        const ssuId = parts[0];
        const tribeId = parts[1] ?? "";
        setMembers(ssuId, tribeId, blob.members.map((m) => ({
          address: String(m.address ?? ""),
          name: String(m.name ?? ""),
          characterId: m.characterId != null ? Number(m.characterId) : null,
          joinedAt: Number(m.joinedAt) || Date.now(),
        })));
        migrated += blob.members.length;
      } catch { /* skip */ }
    }
  }

  // --- Wings ---
  const wingCount = _db!.select({ id: wings.id }).from(wings).all().length;
  if (wingCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "wings-store"))
      .all();
    for (const row of rows) {
      try {
        const blob: { wings?: Array<Record<string, unknown>> } = JSON.parse(row.data);
        if (!Array.isArray(blob?.wings)) continue;
        const parts = row.key.split("__t");
        const ssuId = parts[0];
        const tribeId = parts[1] ?? "";
        setWings(ssuId, tribeId, blob.wings.map((w) => ({
          id: String(w.id ?? `wing_${Date.now()}`),
          name: String(w.name ?? ""),
          color: String(w.color ?? "#888"),
          symbol: String(w.symbol ?? "⬡"),
          memberAddresses: Array.isArray(w.memberAddresses)
            ? (w.memberAddresses as string[])
            : [],
        })));
        migrated += blob.wings.length;
      } catch { /* skip */ }
    }
  }

  // --- Allocations ---
  const allocCount = _db!.select({ id: allocations.id }).from(allocations).all().length;
  if (allocCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "allocations-store"))
      .all();
    for (const row of rows) {
      try {
        const blob: { allocations?: Array<Record<string, unknown>> } = JSON.parse(row.data);
        if (!Array.isArray(blob?.allocations)) continue;
        const parts = row.key.split("__t");
        const ssuId = parts[0];
        const tribeId = parts[1] ?? "";
        setAllocations(ssuId, tribeId, blob.allocations.map((a) => ({
          id: String(a.id ?? `alloc_${Date.now()}`),
          itemTypeId: Number(a.itemTypeId) || 0,
          itemName: String(a.itemName ?? ""),
          wingId: String(a.wingId ?? ""),
          quantity: Number(a.quantity) || 0,
          allocatedBy: String(a.allocatedBy ?? ""),
          allocatedAt: Number(a.allocatedAt) || Date.now(),
        })));
        migrated += blob.allocations.length;
      } catch { /* skip */ }
    }
  }

  // --- Goals ---
  const goalCount = _db!.select({ id: goals.id }).from(goals).all().length;
  if (goalCount === 0) {
    const rows = _db!
      .select({ key: kvStore.key, data: kvStore.data })
      .from(kvStore)
      .where(eq(kvStore.prefix, "goals-store"))
      .all();
    for (const row of rows) {
      try {
        const blob: { goals?: Array<Record<string, unknown>> } = JSON.parse(row.data);
        if (!Array.isArray(blob?.goals)) continue;
        const parts = row.key.split("__t");
        const ssuId = parts[0];
        const tribeId = parts[1] ?? "";
        const goalList: GoalRow[] = blob.goals.map((g) => {
          const rawMissions = Array.isArray(g.missions) ? g.missions as Array<Record<string, unknown>> : [];
          const publishedSet = new Set(
            Array.isArray(g.publishedMissions) ? g.publishedMissions as number[] : [],
          );
          const completedMap = new Map<number, number>(
            Array.isArray(g.completed) ? g.completed as [number, number][] : [],
          );
          const missionWingsRaw = (g.missionWings ?? {}) as Record<string, string[]>;

          return {
            id: Number(g.id),
            type: String(g.type ?? "Gather"),
            description: String(g.description ?? ""),
            budget: Number(g.budget) || 0,
            tierPercents: Array.isArray(g.tierPercents) ? g.tierPercents as number[] : [25, 50, 75],
            status: String(g.status ?? "draft"),
            budgetAwarded: Number(g.budgetAwarded) || 0,
            startedAt: g.startedAt != null ? Number(g.startedAt) : null,
            missions: rawMissions.map((m, idx) => ({
              idx,
              phase: String(m.phase ?? "GATHER"),
              tier: Number(m.tier) || 1,
              description: String(m.description ?? ""),
              quantity: Number(m.quantity) || 0,
              typeId: m.typeId != null ? Number(m.typeId) : null,
              isAlternative: Boolean(m.isAlternative),
              isPublished: publishedSet.has(idx),
              completedQty: completedMap.get(idx) ?? 0,
              wingIds: missionWingsRaw[String(idx)] ?? [],
            })),
          };
        });
        setGoals(ssuId, tribeId, goalList);
        migrated += goalList.length;
      } catch { /* skip */ }
    }
  }

  if (migrated > 0) {
    console.log(`[db] Phase 2: Migrated ${migrated} records from KV blobs into normalised tables`);
  }
}

/**
 * Clean up old "SSU 0x..." hub names and map node labels.
 * Replaces them with short "SSU-XXXX" anon names (idempotent).
 */
function migrateOldSsuNames(): void {
  // Simple hash function matching the client-side anonSsuName
  function anonName(ssuId: string): string {
    let h = 0x9E3779B9;
    for (let i = 0; i < ssuId.length; i++) {
      h = Math.imul(h ^ ssuId.charCodeAt(i), 0x5BD1E995);
      h ^= h >>> 15;
    }
    const code = (Math.abs(h) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    return `SSU-${code}`;
  }

  function looksLikeAddress(s: string): boolean {
    if (s.length >= 20 && /^0x[0-9a-fA-F]+$/.test(s)) return true;
    if (s.length >= 30 && /^[0-9a-fA-F]+$/.test(s)) return true;
    const stripped = s.replace(/^\S+\s+/, "");
    if (stripped !== s && stripped.length >= 20 && /^0x[0-9a-fA-F]+$/.test(stripped)) return true;
    return false;
  }

  let fixed = 0;

  // Fix ssu_registrations.hub_name
  const ssus = _db!.select({
    ssuId: ssuRegistrations.ssuId,
    tribeId: ssuRegistrations.tribeId,
    hubName: ssuRegistrations.hubName,
  }).from(ssuRegistrations).all();
  for (const ssu of ssus) {
    if (ssu.hubName && looksLikeAddress(ssu.hubName)) {
      _db!.update(ssuRegistrations)
        .set({ hubName: anonName(ssu.ssuId) })
        .where(and(eq(ssuRegistrations.ssuId, ssu.ssuId), eq(ssuRegistrations.tribeId, ssu.tribeId)))
        .run();
      fixed++;
    }
  }

  // Fix network_map_nodes.label
  const mapNodes = _db!.select({
    id: networkMapNodes.id,
    ssuId: networkMapNodes.ssuId,
    label: networkMapNodes.label,
  }).from(networkMapNodes).all();
  for (const node of mapNodes) {
    if (node.label && looksLikeAddress(node.label)) {
      _db!.update(networkMapNodes)
        .set({ label: anonName(node.ssuId) })
        .where(eq(networkMapNodes.id, node.id))
        .run();
      fixed++;
    }
  }

  if (fixed > 0) {
    console.log(`[db] Cleaned up ${fixed} old address-based SSU names`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSU Locations
// ═══════════════════════════════════════════════════════════════════════════

export interface SsuLocationRow {
  ssuId: string;
  tribeId: string;
  solarSystemId: string;
  solarSystemName: string;
  locationX: number;
  locationY: number;
  locationZ: number;
  pNum?: string;
  lNum?: string;
  createdBy: string;
}

/** Decrypt an encrypted location row from the database back to plaintext. */
function decryptLocationRow(raw: {
  ssuId: string; tribeId: string;
  solarSystemId: string; solarSystemName: string;
  locationX: string; locationY: string; locationZ: string;
  pNum: string; lNum: string; createdBy: string;
}): SsuLocationRow {
  return {
    ssuId: raw.ssuId,
    tribeId: raw.tribeId,
    solarSystemId: decryptField(raw.solarSystemId),
    solarSystemName: decryptField(raw.solarSystemName),
    locationX: parseFloat(decryptField(raw.locationX)) || 0,
    locationY: parseFloat(decryptField(raw.locationY)) || 0,
    locationZ: parseFloat(decryptField(raw.locationZ)) || 0,
    pNum: decryptField(raw.pNum),
    lNum: decryptField(raw.lNum),
    createdBy: raw.createdBy,
  };
}

/** Encrypt location fields before writing to the database. */
function encryptLocationFields(loc: SsuLocationRow) {
  return {
    ssuId: loc.ssuId,
    tribeId: loc.tribeId,
    solarSystemId: encryptField(loc.solarSystemId),
    solarSystemName: encryptField(loc.solarSystemName),
    locationX: encryptField(String(loc.locationX)),
    locationY: encryptField(String(loc.locationY)),
    locationZ: encryptField(String(loc.locationZ)),
    pNum: encryptField(loc.pNum ?? ""),
    lNum: encryptField(loc.lNum ?? ""),
    createdBy: loc.createdBy,
  };
}

export function getSsuLocation(ssuId: string, tribeId: string): SsuLocationRow | null {
  const row = _db!
    .select({
      ssuId: ssuLocations.ssuId,
      tribeId: ssuLocations.tribeId,
      solarSystemId: ssuLocations.solarSystemId,
      solarSystemName: ssuLocations.solarSystemName,
      locationX: ssuLocations.locationX,
      locationY: ssuLocations.locationY,
      locationZ: ssuLocations.locationZ,
      pNum: ssuLocations.pNum,
      lNum: ssuLocations.lNum,
      createdBy: ssuLocations.createdBy,
    })
    .from(ssuLocations)
    .where(and(eq(ssuLocations.ssuId, ssuId), eq(ssuLocations.tribeId, tribeId)))
    .get();
  if (!row) return null;
  return decryptLocationRow(row);
}

export function upsertSsuLocation(loc: SsuLocationRow): void {
  const enc = encryptLocationFields(loc);
  _db!
    .insert(ssuLocations)
    .values({ ...enc, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [ssuLocations.ssuId, ssuLocations.tribeId],
      set: {
        solarSystemId: enc.solarSystemId,
        solarSystemName: enc.solarSystemName,
        locationX: enc.locationX,
        locationY: enc.locationY,
        locationZ: enc.locationZ,
        pNum: enc.pNum,
        lNum: enc.lNum,
        createdBy: enc.createdBy,
        createdAt: new Date(),
      },
    })
    .run();
}

/** Get all SSU locations for a tribe (for territory page). */
export function getTribeLocations(tribeId: string): SsuLocationRow[] {
  const rows = _db!
    .select({
      ssuId: ssuLocations.ssuId,
      tribeId: ssuLocations.tribeId,
      solarSystemId: ssuLocations.solarSystemId,
      solarSystemName: ssuLocations.solarSystemName,
      locationX: ssuLocations.locationX,
      locationY: ssuLocations.locationY,
      locationZ: ssuLocations.locationZ,
      pNum: ssuLocations.pNum,
      lNum: ssuLocations.lNum,
      createdBy: ssuLocations.createdBy,
    })
    .from(ssuLocations)
    .where(eq(ssuLocations.tribeId, tribeId))
    .all();
  return rows.map(decryptLocationRow);
}

// ═══════════════════════════════════════════════════════════════════════════
// SSU Network Settings
// ═══════════════════════════════════════════════════════════════════════════

export interface NetworkSettingsRow {
  ssuId: string;
  tribeId: string;
  visibility: string;
  locationPolicy: string;
  budgetMode: string;
  localBudget: number;
  networkNodeId?: string | null;
}

export function getNetworkSettings(ssuId: string, tribeId: string): NetworkSettingsRow {
  const row = _db!
    .select({
      ssuId: ssuNetworkSettings.ssuId,
      tribeId: ssuNetworkSettings.tribeId,
      visibility: ssuNetworkSettings.visibility,
      locationPolicy: ssuNetworkSettings.locationPolicy,
      budgetMode: ssuNetworkSettings.budgetMode,
      localBudget: ssuNetworkSettings.localBudget,
      networkNodeId: ssuNetworkSettings.networkNodeId,
    })
    .from(ssuNetworkSettings)
    .where(and(eq(ssuNetworkSettings.ssuId, ssuId), eq(ssuNetworkSettings.tribeId, tribeId)))
    .get();
  return row ?? { ssuId, tribeId, visibility: "tribal", locationPolicy: "manual", budgetMode: "shared", localBudget: 0, networkNodeId: null };
}

export function upsertNetworkSettings(s: NetworkSettingsRow): void {
  _db!
    .insert(ssuNetworkSettings)
    .values({ ...s, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [ssuNetworkSettings.ssuId, ssuNetworkSettings.tribeId],
      set: {
        visibility: s.visibility,
        locationPolicy: s.locationPolicy,
        budgetMode: s.budgetMode,
        localBudget: s.localBudget,
        networkNodeId: s.networkNodeId ?? null,
        updatedAt: new Date(),
      },
    })
    .run();
}

/**
 * Atomically increment the deposited budget for an SSU.
 * Called after a successful on-chain fund_budget transaction.
 */
export function incrementDepositedBudget(ssuId: string, tribeId: string, creditAmount: number): void {
  _sqlite!.prepare(`
    INSERT INTO ssu_network_settings (ssu_id, tribe_id, visibility, location_policy, budget_mode, local_budget, updated_at)
    VALUES (?, ?, 'tribal', 'manual', 'local', MAX(0, ?), ?)
    ON CONFLICT(ssu_id, tribe_id)
    DO UPDATE SET local_budget = MAX(0, local_budget + ?), updated_at = ?
  `).run(ssuId, tribeId, creditAmount, Date.now(), creditAmount, Date.now());
}

/**
 * Transfer budget between two SSUs atomically.
 * Deducts from the source and adds to the target within a transaction.
 * Returns true on success, false if the source has insufficient budget.
 */
export function transferBudget(fromSsuId: string, toSsuId: string, tribeId: string, amount: number): boolean {
  const txn = _sqlite!.transaction(() => {
    // Read current deposited budget for source
    const row = _sqlite!.prepare(
      `SELECT local_budget FROM ssu_network_settings WHERE ssu_id = ? AND tribe_id = ?`
    ).get(fromSsuId, tribeId) as { local_budget: number } | undefined;
    const currentBudget = row?.local_budget ?? 0;
    if (currentBudget < amount) return false;

    // Deduct from source
    _sqlite!.prepare(
      `UPDATE ssu_network_settings SET local_budget = local_budget - ?, updated_at = ? WHERE ssu_id = ? AND tribe_id = ?`
    ).run(amount, Date.now(), fromSsuId, tribeId);

    // Add to target (upsert)
    _sqlite!.prepare(`
      INSERT INTO ssu_network_settings (ssu_id, tribe_id, visibility, location_policy, budget_mode, local_budget, updated_at)
      VALUES (?, ?, 'tribal', 'manual', 'local', MAX(0, ?), ?)
      ON CONFLICT(ssu_id, tribe_id)
      DO UPDATE SET local_budget = MAX(0, local_budget + ?), updated_at = ?
    `).run(toSsuId, tribeId, amount, Date.now(), amount, Date.now());

    return true;
  });
  return txn();
}

// ═══════════════════════════════════════════════════════════════════════════
// Location Access Grants
// ═══════════════════════════════════════════════════════════════════════════

export function hasLocationAccess(ssuId: string, tribeId: string, wallet: string): boolean {
  const row = _db!
    .select({ id: locationAccessGrants.id })
    .from(locationAccessGrants)
    .where(
      and(
        eq(locationAccessGrants.ssuId, ssuId),
        eq(locationAccessGrants.tribeId, tribeId),
        eq(locationAccessGrants.grantedTo, wallet),
      ),
    )
    .get();
  return !!row;
}

export function grantLocationAccess(ssuId: string, tribeId: string, wallet: string): void {
  if (hasLocationAccess(ssuId, tribeId, wallet)) return;
  _db!.insert(locationAccessGrants).values({
    ssuId,
    tribeId,
    grantedTo: wallet,
    grantedAt: new Date(),
  }).run();
}

export function revokeLocationAccess(ssuId: string, tribeId: string, wallet: string): void {
  _db!.delete(locationAccessGrants)
    .where(
      and(
        eq(locationAccessGrants.ssuId, ssuId),
        eq(locationAccessGrants.tribeId, tribeId),
        eq(locationAccessGrants.grantedTo, wallet),
      ),
    )
    .run();
}

export function getLocationGrants(ssuId: string, tribeId: string): string[] {
  return _db!
    .select({ wallet: locationAccessGrants.grantedTo })
    .from(locationAccessGrants)
    .where(and(eq(locationAccessGrants.ssuId, ssuId), eq(locationAccessGrants.tribeId, tribeId)))
    .all()
    .map((r) => r.wallet);
}

// ═══════════════════════════════════════════════════════════════════════════
// Location Access Requests
// ═══════════════════════════════════════════════════════════════════════════

export interface LocationRequestRow {
  id: number;
  ssuId: string;
  tribeId: string;
  requesterAddress: string;
  requesterName: string;
  requesterSsuId: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export function getLocationRequests(ssuId: string, tribeId: string, status?: string): LocationRequestRow[] {
  const base = _db!
    .select()
    .from(locationAccessRequests)
    .where(
      status
        ? and(
            eq(locationAccessRequests.ssuId, ssuId),
            eq(locationAccessRequests.tribeId, tribeId),
            eq(locationAccessRequests.status, status),
          )
        : and(
            eq(locationAccessRequests.ssuId, ssuId),
            eq(locationAccessRequests.tribeId, tribeId),
          ),
    )
    .all();
  return base as LocationRequestRow[];
}

export function createLocationRequest(req: {
  ssuId: string;
  tribeId: string;
  requesterAddress: string;
  requesterName: string;
  requesterSsuId: string;
}): number {
  // Check for existing pending request
  const existing = _db!
    .select({ id: locationAccessRequests.id })
    .from(locationAccessRequests)
    .where(
      and(
        eq(locationAccessRequests.ssuId, req.ssuId),
        eq(locationAccessRequests.tribeId, req.tribeId),
        eq(locationAccessRequests.requesterAddress, req.requesterAddress),
        eq(locationAccessRequests.status, "pending"),
      ),
    )
    .get();
  if (existing) return existing.id;

  const result = _sqlite!.prepare(`
    INSERT INTO location_access_requests (ssu_id, tribe_id, requester_address, requester_name, requester_ssu_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(req.ssuId, req.tribeId, req.requesterAddress, req.requesterName, req.requesterSsuId, Date.now());
  return result.lastInsertRowid as number;
}

export function resolveLocationRequest(requestId: number, status: "approved" | "denied"): void {
  _db!.update(locationAccessRequests)
    .set({ status, resolvedAt: new Date() })
    .where(eq(locationAccessRequests.id, requestId))
    .run();

  // If approved, grant access in BOTH directions (bidirectional)
  if (status === "approved") {
    const req = _db!
      .select()
      .from(locationAccessRequests)
      .where(eq(locationAccessRequests.id, requestId))
      .get();
    if (req) {
      // Forward: requester can see the approver's SSU location
      grantLocationAccess(req.ssuId, req.tribeId, req.requesterAddress);

      // Reverse: approver can see the requester's SSU location
      if (req.requesterSsuId) {
        const approvingSsu = getSsu(req.ssuId, req.tribeId);
        // Look up the requester's SSU to get the correct tribeId for cross-tribe grants
        const requesterSsu = getSsuBySsuId(req.requesterSsuId);
        const requesterTribeId = requesterSsu?.tribeId ?? req.tribeId;
        if (approvingSsu) {
          grantLocationAccess(req.requesterSsuId, requesterTribeId, approvingSsu.activatedBy);
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Location Blocked
// ═══════════════════════════════════════════════════════════════════════════

export function isBlocked(ssuId: string, tribeId: string, address?: string, fromSsuId?: string): boolean {
  if (address) {
    const row = _db!.select({ id: locationBlocked.id }).from(locationBlocked)
      .where(and(
        eq(locationBlocked.ssuId, ssuId),
        eq(locationBlocked.tribeId, tribeId),
        eq(locationBlocked.blockedAddress, address),
      )).get();
    if (row) return true;
  }
  if (fromSsuId) {
    const row = _db!.select({ id: locationBlocked.id }).from(locationBlocked)
      .where(and(
        eq(locationBlocked.ssuId, ssuId),
        eq(locationBlocked.tribeId, tribeId),
        eq(locationBlocked.blockedSsuId, fromSsuId),
      )).get();
    if (row) return true;
  }
  return false;
}

export function blockEntity(ssuId: string, tribeId: string, address?: string, blockedSsuId?: string): void {
  _db!.insert(locationBlocked).values({
    ssuId,
    tribeId,
    blockedAddress: address ?? null,
    blockedSsuId: blockedSsuId ?? null,
    blockedAt: new Date(),
  }).run();
}

export function unblockEntity(ssuId: string, tribeId: string, address?: string, blockedSsuId?: string): void {
  if (address) {
    _db!.delete(locationBlocked).where(and(
      eq(locationBlocked.ssuId, ssuId),
      eq(locationBlocked.tribeId, tribeId),
      eq(locationBlocked.blockedAddress, address),
    )).run();
  }
  if (blockedSsuId) {
    _db!.delete(locationBlocked).where(and(
      eq(locationBlocked.ssuId, ssuId),
      eq(locationBlocked.tribeId, tribeId),
      eq(locationBlocked.blockedSsuId, blockedSsuId),
    )).run();
  }
}

export function getBlockedList(ssuId: string, tribeId: string): Array<{ address?: string; blockedSsuId?: string }> {
  return _db!.select({
    address: locationBlocked.blockedAddress,
    blockedSsuId: locationBlocked.blockedSsuId,
  }).from(locationBlocked)
    .where(and(eq(locationBlocked.ssuId, ssuId), eq(locationBlocked.tribeId, tribeId)))
    .all()
    .map((r) => ({
      address: r.address ?? undefined,
      blockedSsuId: r.blockedSsuId ?? undefined,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Location Whitelist
// ═══════════════════════════════════════════════════════════════════════════

export function getWhitelist(ssuId: string, tribeId: string): string[] {
  return _db!
    .select({ whitelistedSsuId: locationWhitelist.whitelistedSsuId })
    .from(locationWhitelist)
    .where(and(eq(locationWhitelist.ssuId, ssuId), eq(locationWhitelist.tribeId, tribeId)))
    .all()
    .map((r) => r.whitelistedSsuId);
}

export function addToWhitelist(ssuId: string, tribeId: string, whitelistedSsuId: string): void {
  _db!.insert(locationWhitelist)
    .values({ ssuId, tribeId, whitelistedSsuId, addedAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function removeFromWhitelist(ssuId: string, tribeId: string, whitelistedSsuId: string): void {
  _db!.delete(locationWhitelist)
    .where(and(
      eq(locationWhitelist.ssuId, ssuId),
      eq(locationWhitelist.tribeId, tribeId),
      eq(locationWhitelist.whitelistedSsuId, whitelistedSsuId),
    ))
    .run();
}

/** Check if user can view an SSU's full details based on visibility settings. */
export function canViewSsu(
  ssuId: string,
  tribeId: string,
  requesterAddress: string,
  requesterTribeId: string,
  ownerAddress: string,
): boolean {
  const settings = getNetworkSettings(ssuId, tribeId);
  if (settings.visibility === "public") return true;
  if (settings.visibility === "private") return requesterAddress === ownerAddress;
  // "tribal" — must be same tribe
  return requesterTribeId === tribeId;
}

// ═══════════════════════════════════════════════════════════════════════════
// External SSUs — manually-added cross-tribe SSU references
// ═══════════════════════════════════════════════════════════════════════════

export interface ExternalSsuRow {
  id: number;
  ssuId: string;
  tribeId: string;
  externalSsuId: string;
  addedBy: string;
  addedAt: Date;
}

export function getExternalSsus(ssuId: string, tribeId: string): ExternalSsuRow[] {
  return _db!
    .select({
      id: externalSsus.id,
      ssuId: externalSsus.ssuId,
      tribeId: externalSsus.tribeId,
      externalSsuId: externalSsus.externalSsuId,
      addedBy: externalSsus.addedBy,
      addedAt: externalSsus.addedAt,
    })
    .from(externalSsus)
    .where(and(eq(externalSsus.ssuId, ssuId), eq(externalSsus.tribeId, tribeId)))
    .all();
}

export function addExternalSsu(ssuId: string, tribeId: string, externalSsuId: string, addedBy: string): void {
  // Don't add duplicates
  const existing = _db!
    .select({ id: externalSsus.id })
    .from(externalSsus)
    .where(
      and(
        eq(externalSsus.ssuId, ssuId),
        eq(externalSsus.tribeId, tribeId),
        eq(externalSsus.externalSsuId, externalSsuId),
      ),
    )
    .get();
  if (existing) return;
  _db!.insert(externalSsus).values({
    ssuId,
    tribeId,
    externalSsuId,
    addedBy,
    addedAt: new Date(),
  }).run();
}

export function removeExternalSsu(ssuId: string, tribeId: string, externalSsuId: string): void {
  _db!.delete(externalSsus)
    .where(
      and(
        eq(externalSsus.ssuId, ssuId),
        eq(externalSsus.tribeId, tribeId),
        eq(externalSsus.externalSsuId, externalSsuId),
      ),
    )
    .run();
  // Also revoke any location grants this external SSU might have given us
  // and remove any pending requests to it
  _db!.delete(locationAccessGrants)
    .where(
      and(
        eq(locationAccessGrants.ssuId, externalSsuId),
        eq(locationAccessGrants.tribeId, tribeId),
      ),
    )
    .run();
  _db!.delete(locationAccessRequests)
    .where(
      and(
        eq(locationAccessRequests.ssuId, externalSsuId),
        eq(locationAccessRequests.tribeId, tribeId),
      ),
    )
    .run();
  // Remove map node if it matches the external SSU
  _db!.delete(networkMapNodes).where(eq(networkMapNodes.ssuId, externalSsuId)).run();
}

/** Get all public SSUs across ALL tribes (for universal cross-tribe discovery). */
export function getAllPublicSsus(): Array<{ ssuId: string; tribeId: string; hubName: string; activatedBy: string; characterName: string }> {
  return _db!
    .select({
      ssuId: ssuRegistrations.ssuId,
      tribeId: ssuRegistrations.tribeId,
      hubName: ssuRegistrations.hubName,
      activatedBy: ssuRegistrations.activatedBy,
      characterName: ssuRegistrations.characterName,
    })
    .from(ssuRegistrations)
    .innerJoin(
      ssuNetworkSettings,
      and(
        eq(ssuRegistrations.ssuId, ssuNetworkSettings.ssuId),
        eq(ssuRegistrations.tribeId, ssuNetworkSettings.tribeId),
      ),
    )
    .where(eq(ssuNetworkSettings.visibility, "public"))
    .all();
}

// ═══════════════════════════════════════════════════════════════════════════
// Solar Systems (universe data cached from World API)
// ═══════════════════════════════════════════════════════════════════════════

export function getSolarSystemCount(): number {
  const row = _sqlite!.prepare("SELECT COUNT(*) AS cnt FROM solar_systems").get() as { cnt: number };
  return row.cnt;
}

export interface SolarSystemRow {
  id: number;
  name: string;
  locationX: number;
  locationY: number;
  locationZ: number;
  constellationId: number;
  regionId: number;
}

export function findSolarSystemByName(name: string): SolarSystemRow | null {
  const row = _sqlite!
    .prepare("SELECT id, name, location_x, location_y, location_z, constellation_id, region_id FROM solar_systems WHERE name = ? COLLATE NOCASE")
    .get(name) as { id: number; name: string; location_x: number; location_y: number; location_z: number; constellation_id: number; region_id: number } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    locationX: row.location_x,
    locationY: row.location_y,
    locationZ: row.location_z,
    constellationId: row.constellation_id,
    regionId: row.region_id,
  };
}

export function bulkInsertSolarSystems(systems: SolarSystemRow[]): void {
  const insert = _sqlite!.prepare(
    "INSERT OR IGNORE INTO solar_systems (id, name, location_x, location_y, location_z, constellation_id, region_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const tx = _sqlite!.transaction((rows: SolarSystemRow[]) => {
    for (const s of rows) {
      insert.run(s.id, s.name, s.locationX, s.locationY, s.locationZ, s.constellationId, s.regionId);
    }
  });
  tx(systems);
}

// ═══════════════════════════════════════════════════════════════════════════
// Network Map — nodes, links, waypoints, data-shares
// ═══════════════════════════════════════════════════════════════════════════

export interface MapNodeRow {
  id: string;
  ssuId: string;
  tribeId: string;
  label: string;
  mapX: number;
  mapY: number;
  visibility: string;
  addedBy: string;
  solarSystemName?: string;
  solarSystemId?: string;
  pNum?: string;
  lNum?: string;
}

export interface MapLinkRow {
  id: string;
  tribeId: string;
  fromNodeId: string;
  toNodeId: string;
  linkType: string;
  createdBy: string;
  rawRoute?: string;
}

export interface MapWaypointRow {
  id?: number;
  linkId: string;
  stepOrder: number;
  waypointType: string;
  fromSystem: string;
  toSystem: string;
  fromSystemId?: string;
  toSystemId?: string;
  fromLpoint: string;
  toLpoint: string;
  distance?: string;
}

export interface MapDataShareRow {
  linkId: string;
  category: string;
}

/** Get all map nodes for a tribe. */
export function getMapNodes(tribeId: string): MapNodeRow[] {
  const rows = _db!
    .select({
      id: networkMapNodes.id,
      ssuId: networkMapNodes.ssuId,
      tribeId: networkMapNodes.tribeId,
      label: networkMapNodes.label,
      mapX: networkMapNodes.mapX,
      mapY: networkMapNodes.mapY,
      visibility: networkMapNodes.visibility,
      addedBy: networkMapNodes.addedBy,
      solarSystemName: networkMapNodes.solarSystemName,
      solarSystemId: networkMapNodes.solarSystemId,
      pNum: networkMapNodes.pNum,
      lNum: networkMapNodes.lNum,
    })
    .from(networkMapNodes)
    .where(eq(networkMapNodes.tribeId, tribeId))
    .all();
  return rows.map((r) => ({
    ...r,
    solarSystemName: r.solarSystemName ? decryptField(r.solarSystemName) : "",
    solarSystemId: r.solarSystemId ? decryptField(r.solarSystemId) : "",
    pNum: r.pNum ? decryptField(r.pNum) : "",
    lNum: r.lNum ? decryptField(r.lNum) : "",
  }));
}

/** Upsert a map node. */
export function upsertMapNode(node: MapNodeRow): void {
  const encSysName = encryptField(node.solarSystemName ?? "");
  const encSysId = encryptField(node.solarSystemId ?? "");
  const encPNum = encryptField(node.pNum ?? "");
  const encLNum = encryptField(node.lNum ?? "");
  _db!.insert(networkMapNodes).values({
    id: node.id,
    ssuId: node.ssuId,
    tribeId: node.tribeId,
    label: node.label,
    mapX: node.mapX,
    mapY: node.mapY,
    visibility: node.visibility,
    addedBy: node.addedBy,
    solarSystemName: encSysName,
    solarSystemId: encSysId,
    pNum: encPNum,
    lNum: encLNum,
  }).onConflictDoUpdate({
    target: [networkMapNodes.id],
    set: {
      label: sql`excluded.label`,
      mapX: sql`excluded.map_x`,
      mapY: sql`excluded.map_y`,
      visibility: sql`excluded.visibility`,
      solarSystemName: sql`excluded.solar_system_name`,
      solarSystemId: sql`excluded.solar_system_id`,
      pNum: sql`excluded.p_num`,
      lNum: sql`excluded.l_num`,
    },
  }).run();
}

/** Update map node labels for all nodes matching an SSU ID. */
export function updateMapNodeLabelsBySsu(ssuId: string, label: string): void {
  _db!.update(networkMapNodes)
    .set({ label })
    .where(eq(networkMapNodes.ssuId, ssuId))
    .run();
}

/** Delete a map node and all its links/waypoints/data-shares. */
export function deleteMapNode(nodeId: string): void {
  // Find links referencing this node
  const links = _db!
    .select({ id: networkMapLinks.id })
    .from(networkMapLinks)
    .where(sql`${networkMapLinks.fromNodeId} = ${nodeId} OR ${networkMapLinks.toNodeId} = ${nodeId}`)
    .all();
  for (const link of links) {
    deleteMapLink(link.id);
  }
  _db!.delete(networkMapNodes).where(eq(networkMapNodes.id, nodeId)).run();
}

/** Get all map links for a tribe. */
export function getMapLinks(tribeId: string): MapLinkRow[] {
  return _db!
    .select({
      id: networkMapLinks.id,
      tribeId: networkMapLinks.tribeId,
      fromNodeId: networkMapLinks.fromNodeId,
      toNodeId: networkMapLinks.toNodeId,
      linkType: networkMapLinks.linkType,
      createdBy: networkMapLinks.createdBy,
      rawRoute: networkMapLinks.rawRoute,
    })
    .from(networkMapLinks)
    .where(eq(networkMapLinks.tribeId, tribeId))
    .all()
    .map((r) => ({ ...r, rawRoute: r.rawRoute ? decryptField(r.rawRoute) : "" }));
}

/** Insert a link with its waypoints and data-shares. */
export function insertMapLink(
  link: MapLinkRow,
  waypoints: Omit<MapWaypointRow, "id">[],
  dataShares: string[],
): void {
  _db!.insert(networkMapLinks).values({
    id: link.id,
    tribeId: link.tribeId,
    fromNodeId: link.fromNodeId,
    toNodeId: link.toNodeId,
    linkType: link.linkType,
    createdBy: link.createdBy,
    rawRoute: encryptField(link.rawRoute ?? ""),
  }).run();

  for (const wp of waypoints) {
    _db!.insert(networkMapWaypoints).values({
      linkId: link.id,
      stepOrder: wp.stepOrder,
      waypointType: wp.waypointType,
      fromSystem: encryptField(wp.fromSystem),
      toSystem: encryptField(wp.toSystem),
      fromSystemId: encryptField(wp.fromSystemId ?? ""),
      toSystemId: encryptField(wp.toSystemId ?? ""),
      fromLpoint: encryptField(wp.fromLpoint),
      toLpoint: encryptField(wp.toLpoint),
      distance: wp.distance ?? "",
    }).run();
  }

  for (const cat of dataShares) {
    _db!.insert(networkMapDataShares).values({
      linkId: link.id,
      category: cat,
    }).run();
  }
}

/** Delete a link and its associated waypoints + data-shares. */
export function deleteMapLink(linkId: string): void {
  _db!.delete(networkMapWaypoints).where(eq(networkMapWaypoints.linkId, linkId)).run();
  _db!.delete(networkMapDataShares).where(eq(networkMapDataShares.linkId, linkId)).run();
  _db!.delete(networkMapLinks).where(eq(networkMapLinks.id, linkId)).run();
}

/** Get waypoints for a link, ordered. */
export function getMapWaypoints(linkId: string): MapWaypointRow[] {
  return _sqlite!
    .prepare("SELECT id, link_id, step_order, waypoint_type, from_system, to_system, from_system_id, to_system_id, from_lpoint, to_lpoint, distance FROM network_map_waypoints WHERE link_id = ? ORDER BY step_order")
    .all(linkId)
    .map((r: any) => ({
      id: r.id,
      linkId: r.link_id,
      stepOrder: r.step_order,
      waypointType: r.waypoint_type,
      fromSystem: decryptField(r.from_system || ""),
      toSystem: decryptField(r.to_system || ""),
      fromSystemId: decryptField(r.from_system_id || "") || undefined,
      toSystemId: decryptField(r.to_system_id || "") || undefined,
      fromLpoint: decryptField(r.from_lpoint || ""),
      toLpoint: decryptField(r.to_lpoint || ""),
      distance: r.distance || undefined,
    }));
}

/** Get data-share categories for a link. */
export function getMapDataShares(linkId: string): string[] {
  return _db!
    .select({ category: networkMapDataShares.category })
    .from(networkMapDataShares)
    .where(eq(networkMapDataShares.linkId, linkId))
    .all()
    .map((r) => r.category);
}

// ═══════════════════════════════════════════════════════════════════════════
// Price Snapshots — historical backing ratios for tribes
// ═══════════════════════════════════════════════════════════════════════════

export interface PriceSnapshotRow {
  tribeId: string;
  eveBacking: number;
  creditSupply: number;
  backingRatio: number;
  timestamp: number;
}

/** Insert a price snapshot for a tribe. */
export function insertPriceSnapshot(snap: Omit<PriceSnapshotRow, "timestamp">): void {
  _db!
    .insert(priceSnapshots)
    .values({
      tribeId: snap.tribeId,
      eveBacking: snap.eveBacking,
      creditSupply: snap.creditSupply,
      backingRatio: snap.backingRatio,
      timestamp: new Date(),
    })
    .run();
}

/** Get price history for a tribe, newest first. */
export function getPriceHistory(tribeId: string, limit = 200): PriceSnapshotRow[] {
  return _db!
    .select({
      tribeId: priceSnapshots.tribeId,
      eveBacking: priceSnapshots.eveBacking,
      creditSupply: priceSnapshots.creditSupply,
      backingRatio: priceSnapshots.backingRatio,
      timestamp: priceSnapshots.timestamp,
    })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.tribeId, tribeId))
    .orderBy(sql`timestamp DESC`)
    .limit(limit)
    .all()
    .map((r) => ({
      ...r,
      timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp),
    }));
}

/** Get latest snapshot for each tribe. */
export function getLatestPriceSnapshots(): PriceSnapshotRow[] {
  return _sqlite!
    .prepare(`
      SELECT p.tribe_id, p.eve_backing, p.credit_supply, p.backing_ratio, p.timestamp
      FROM price_snapshots p
      INNER JOIN (SELECT tribe_id, MAX(timestamp) AS max_ts FROM price_snapshots GROUP BY tribe_id) latest
        ON p.tribe_id = latest.tribe_id AND p.timestamp = latest.max_ts
      ORDER BY p.backing_ratio DESC
    `)
    .all()
    .map((r: any) => ({
      tribeId: r.tribe_id,
      eveBacking: r.eve_backing,
      creditSupply: r.credit_supply,
      backingRatio: r.backing_ratio,
      timestamp: Number(r.timestamp),
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Tribe Discovery — list all known deployments
// ═══════════════════════════════════════════════════════════════════════════

export interface TribeListEntry {
  tribeId: string;
  packageId: string;
  registryId: string;
  creditCoinType: string;
  coinPackageId: string;
}

/** Get all deployed tribes with valid creditCoinType. */
export function getAllTribes(): TribeListEntry[] {
  return _db!
    .select({
      tribeId: deployments.tribeId,
      packageId: deployments.packageId,
      registryId: deployments.registryId,
      creditCoinType: deployments.creditCoinType,
      coinPackageId: deployments.coinPackageId,
    })
    .from(deployments)
    .all()
    .filter((r) => r.creditCoinType.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tribe Coin Orders — cross-tribe exchange limit orders
// ═══════════════════════════════════════════════════════════════════════════

export interface TribeCoinOrderRow {
  id: string;
  wallet: string;
  playerName: string;
  sourceTribeId: string;
  targetTribeId: string;
  side: string;
  quantity: number;
  limitRate: number;
  status: string;
  createdAt: number;
}

/** Get open orders for a tribe pair. */
export function getTribeCoinOrders(sourceTribeId: string, targetTribeId: string): TribeCoinOrderRow[] {
  return _sqlite!
    .prepare(`
      SELECT id, wallet, player_name, source_tribe_id, target_tribe_id,
             side, quantity, limit_rate, status, created_at
      FROM tribe_coin_orders
      WHERE source_tribe_id = ? AND target_tribe_id = ? AND status = 'open'
      ORDER BY limit_rate DESC
    `)
    .all(sourceTribeId, targetTribeId)
    .map((r: any) => ({
      id: r.id,
      wallet: r.wallet,
      playerName: r.player_name,
      sourceTribeId: r.source_tribe_id,
      targetTribeId: r.target_tribe_id,
      side: r.side,
      quantity: r.quantity,
      limitRate: r.limit_rate,
      status: r.status,
      createdAt: Number(r.created_at),
    }));
}

/** Get open orders for a specific wallet. */
export function getWalletTribeCoinOrders(wallet: string): TribeCoinOrderRow[] {
  return _sqlite!
    .prepare(`
      SELECT id, wallet, player_name, source_tribe_id, target_tribe_id,
             side, quantity, limit_rate, status, created_at
      FROM tribe_coin_orders
      WHERE wallet = ? AND status = 'open'
      ORDER BY created_at DESC
    `)
    .all(wallet)
    .map((r: any) => ({
      id: r.id,
      wallet: r.wallet,
      playerName: r.player_name,
      sourceTribeId: r.source_tribe_id,
      targetTribeId: r.target_tribe_id,
      side: r.side,
      quantity: r.quantity,
      limitRate: r.limit_rate,
      status: r.status,
      createdAt: Number(r.created_at),
    }));
}

/** Insert a new tribe coin limit order. */
export function insertTribeCoinOrder(order: Omit<TribeCoinOrderRow, "createdAt">): void {
  _db!
    .insert(tribeCoinOrders)
    .values({
      id: order.id,
      wallet: order.wallet,
      playerName: order.playerName,
      sourceTribeId: order.sourceTribeId,
      targetTribeId: order.targetTribeId,
      side: order.side,
      quantity: order.quantity,
      limitRate: order.limitRate,
      status: order.status,
      createdAt: new Date(),
    })
    .run();
}

/** Update order status (e.g. "filled" or "cancelled"). */
export function updateTribeCoinOrderStatus(id: string, status: string): void {
  _db!
    .update(tribeCoinOrders)
    .set({ status })
    .where(eq(tribeCoinOrders.id, id))
    .run();
}

// ═══════════════════════════════════════════════════════════════════════════
// Contracts — user-created bounties
// ═══════════════════════════════════════════════════════════════════════════

export interface ContractMissionRow {
  idx: number;
  phase: string;
  tier: number;
  description: string;
  quantity: number;
  typeId: number | null;
  isAlternative: boolean;
  altReason: string | null;
  inputItem: string | null;
  completedQty: number;
}

export interface ContractRow {
  id: string;
  ssuId: string;
  tribeId: string;
  creatorWallet: string;
  creatorName: string;
  type: string;
  description: string;
  budget: number;
  taxPaid: number;
  visibility: string;
  postDurationMs: number;
  missionDurationMs: number;
  status: string;
  acceptorWallet: string | null;
  acceptorName: string | null;
  acceptorDeposit: number;
  acceptedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  missions: ContractMissionRow[];
}

export function getContracts(ssuId: string, tribeId: string): ContractRow[] {
  const rows = _db!
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.ssuId, ssuId),
        or(
          eq(contracts.tribeId, tribeId),
          eq(contracts.visibility, "public"),
        ),
      ),
    )
    .all();

  return rows.map((c) => {
    const mRows = _db!.select().from(contractMissions)
      .where(eq(contractMissions.contractId, c.id)).all();
    return {
      id: c.id,
      ssuId: c.ssuId,
      tribeId: c.tribeId,
      creatorWallet: c.creatorWallet,
      creatorName: c.creatorName,
      type: c.type,
      description: c.description,
      budget: c.budget,
      taxPaid: c.taxPaid,
      visibility: c.visibility,
      postDurationMs: c.postDurationMs,
      missionDurationMs: c.missionDurationMs,
      status: c.status,
      acceptorWallet: c.acceptorWallet,
      acceptorName: c.acceptorName,
      acceptorDeposit: c.acceptorDeposit,
      acceptedAt: c.acceptedAt,
      completedAt: c.completedAt,
      createdAt: c.createdAt as unknown as number,
      missions: mRows.map((m) => ({
        idx: m.idx,
        phase: m.phase,
        tier: m.tier,
        description: m.description,
        quantity: m.quantity,
        typeId: m.typeId,
        isAlternative: m.isAlternative,
        altReason: m.altReason ?? null,
        inputItem: m.inputItem ?? null,
        completedQty: m.completedQty,
      })),
    };
  });
}

export function getContractById(id: string): ContractRow | null {
  const c = _db!.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!c) return null;
  const mRows = _db!.select().from(contractMissions)
    .where(eq(contractMissions.contractId, c.id)).all();
  return {
    id: c.id, ssuId: c.ssuId, tribeId: c.tribeId,
    creatorWallet: c.creatorWallet, creatorName: c.creatorName,
    type: c.type, description: c.description,
    budget: c.budget, taxPaid: c.taxPaid,
    visibility: c.visibility,
    postDurationMs: c.postDurationMs, missionDurationMs: c.missionDurationMs,
    status: c.status,
    acceptorWallet: c.acceptorWallet, acceptorName: c.acceptorName,
    acceptorDeposit: c.acceptorDeposit,
    acceptedAt: c.acceptedAt, completedAt: c.completedAt,
    createdAt: c.createdAt as unknown as number,
    missions: mRows.map((m) => ({
      idx: m.idx, phase: m.phase, tier: m.tier,
      description: m.description, quantity: m.quantity,
      typeId: m.typeId, isAlternative: m.isAlternative,
      altReason: m.altReason ?? null, inputItem: m.inputItem ?? null, completedQty: m.completedQty,
    })),
  };
}

export function insertContract(data: {
  id: string; ssuId: string; tribeId: string;
  creatorWallet: string; creatorName: string;
  type: string; description: string;
  budget: number; taxPaid: number; visibility: string;
  postDurationMs: number; missionDurationMs: number;
  missions: ContractMissionRow[];
}): void {
  runTransaction(() => {
    _db!.insert(contracts).values({
      id: data.id, ssuId: data.ssuId, tribeId: data.tribeId,
      creatorWallet: data.creatorWallet, creatorName: data.creatorName,
      type: data.type, description: data.description,
      budget: data.budget, taxPaid: data.taxPaid, visibility: data.visibility,
      postDurationMs: data.postDurationMs, missionDurationMs: data.missionDurationMs,
      status: "open",
      createdAt: Date.now(),
    }).run();

    for (const m of data.missions) {
      _sqlite!.prepare(`
        INSERT INTO contract_missions (contract_id, idx, phase, tier, description, quantity, type_id, is_alternative, alt_reason, input_item, completed_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.id, m.idx, m.phase, m.tier, m.description, m.quantity,
        m.typeId, m.isAlternative ? 1 : 0, m.altReason ?? null, m.inputItem ?? null, 0,
      );
    }
  });
}

export function updateContractStatus(id: string, status: string, extra?: Record<string, unknown>): void {
  const set: Record<string, unknown> = { status };
  if (extra) Object.assign(set, extra);
  _db!.update(contracts).set(set).where(eq(contracts.id, id)).run();
}

export function acceptContract(
  id: string, acceptorWallet: string, acceptorName: string, deposit: number,
): void {
  _db!.update(contracts).set({
    status: "accepted",
    acceptorWallet,
    acceptorName,
    acceptorDeposit: deposit,
    acceptedAt: Date.now(),
  }).where(eq(contracts.id, id)).run();
}

export function progressContractMission(contractId: string, missionIdx: number, qty: number): void {
  _sqlite!.prepare(`
    UPDATE contract_missions
    SET completed_qty = MIN(quantity, completed_qty + ?)
    WHERE contract_id = ? AND idx = ?
  `).run(qty, contractId, missionIdx);
}

export function addContractItemEscrow(contractId: string, missionIdx: number, typeId: number, itemName: string, quantity: number): void {
  _db!.insert(contractItemEscrow).values({
    contractId, missionIdx, typeId, itemName, quantity, depositedAt: Date.now(),
  }).run();
}

export function getContractItemEscrow(contractId: string): Array<{ missionIdx: number; typeId: number; itemName: string; quantity: number }> {
  return _db!.select({
    missionIdx: contractItemEscrow.missionIdx,
    typeId: contractItemEscrow.typeId,
    itemName: contractItemEscrow.itemName,
    quantity: contractItemEscrow.quantity,
  }).from(contractItemEscrow).where(eq(contractItemEscrow.contractId, contractId)).all();
}

export function clearContractItemEscrow(contractId: string): void {
  _db!.delete(contractItemEscrow).where(eq(contractItemEscrow.contractId, contractId)).run();
}

/** Check if all missions for a contract are fully completed. */
export function isContractFullyCompleted(contractId: string): boolean {
  const missions = _db!.select().from(contractMissions)
    .where(eq(contractMissions.contractId, contractId)).all();
  return missions.length > 0 && missions.every((m) => m.completedQty >= m.quantity);
}

// ═══════════════════════════════════════════════════════════════════════════
// Deliveries — delivery mission metadata + courier tracking
// ═══════════════════════════════════════════════════════════════════════════

export interface DeliveryItem {
  typeId: number;
  itemName: string;
  quantity: number;
}

export interface DeliveryRow {
  id: string;
  sourceType: string;
  sourceId: string;
  ssuId: string;
  tribeId: string;
  destinationSsuId: string;
  destinationTribeId: string;
  destinationLabel: string;
  packageId?: string;
  packageName?: string;
  packageShipType?: string;
  packageFittingText?: string;
  packageCreatedBy?: string;
  items: DeliveryItem[];
  collateral: number;
  timerMs: number;
  status: string;
  createdAt: number;
}

export interface DeliveryCourierRow {
  id: number;
  deliveryId: string;
  courierWallet: string;
  courierName: string;
  itemsDistributed: DeliveryItem[];
  itemsDeposited: DeliveryItem[];
  status: string;
  acceptedAt: number;
  completedAt: number | null;
  claimDigest: string | null;
}

function mapDeliveryRow(r: any): DeliveryRow {
  return {
    id: r.id,
    sourceType: r.source_type ?? r.sourceType,
    sourceId: r.source_id ?? r.sourceId,
    ssuId: r.ssu_id ?? r.ssuId,
    tribeId: r.tribe_id ?? r.tribeId,
    destinationSsuId: r.destination_ssu_id ?? r.destinationSsuId,
    destinationTribeId: r.destination_tribe_id ?? r.destinationTribeId,
    destinationLabel: r.destination_label ?? r.destinationLabel ?? "",
    packageId: r.package_id ?? r.packageId ?? undefined,
    packageName: r.package_name ?? r.packageName ?? undefined,
    packageShipType: r.package_ship_type ?? r.packageShipType ?? undefined,
    packageFittingText: r.package_fitting_text ?? r.packageFittingText ?? undefined,
    packageCreatedBy: r.package_created_by ?? r.packageCreatedBy ?? undefined,
    items: JSON.parse(typeof r.items === "string" ? r.items : "[]"),
    collateral: Number(r.collateral ?? 0),
    timerMs: Number(r.timer_ms ?? r.timerMs ?? 86400000),
    status: r.status,
    createdAt: Number(r.created_at ?? r.createdAt),
  };
}

function mapCourierRow(r: any): DeliveryCourierRow {
  return {
    id: Number(r.id),
    deliveryId: r.delivery_id ?? r.deliveryId,
    courierWallet: r.courier_wallet ?? r.courierWallet,
    courierName: r.courier_name ?? r.courierName ?? "",
    itemsDistributed: JSON.parse(typeof r.items_distributed === "string" ? r.items_distributed : (typeof r.itemsDistributed === "string" ? r.itemsDistributed : "[]")),
    itemsDeposited: JSON.parse(typeof r.items_deposited === "string" ? r.items_deposited : (typeof r.itemsDeposited === "string" ? r.itemsDeposited : "[]")),
    status: r.status,
    acceptedAt: Number(r.accepted_at ?? r.acceptedAt),
    completedAt: r.completed_at != null ? Number(r.completed_at) : (r.completedAt != null ? Number(r.completedAt) : null),
    claimDigest: r.claim_digest ?? r.claimDigest ?? null,
  };
}

export function insertDelivery(d: Omit<DeliveryRow, "createdAt">): void {
  _db!.insert(deliveries).values({
    id: d.id,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    ssuId: d.ssuId,
    tribeId: d.tribeId,
    destinationSsuId: d.destinationSsuId,
    destinationTribeId: d.destinationTribeId,
    destinationLabel: d.destinationLabel,
    packageId: d.packageId ?? null,
    packageName: d.packageName ?? null,
    packageShipType: d.packageShipType ?? null,
    packageFittingText: d.packageFittingText ?? null,
    packageCreatedBy: d.packageCreatedBy ?? null,
    items: JSON.stringify(d.items),
    collateral: d.collateral,
    timerMs: d.timerMs,
    status: d.status,
    createdAt: Date.now(),
  }).run();
}

export function getDelivery(id: string): DeliveryRow | null {
  const r = _sqlite!.prepare(`SELECT * FROM deliveries WHERE id = ?`).get(id) as any;
  return r ? mapDeliveryRow(r) : null;
}

export function getDeliveriesBySource(sourceType: string, sourceId: string): DeliveryRow[] {
  return _sqlite!.prepare(`SELECT * FROM deliveries WHERE source_type = ? AND source_id = ?`)
    .all(sourceType, sourceId).map(mapDeliveryRow);
}

export function getDeliveriesBySsu(ssuId: string, tribeId: string): DeliveryRow[] {
  return _sqlite!.prepare(`SELECT * FROM deliveries WHERE ssu_id = ? AND tribe_id = ?`)
    .all(ssuId, tribeId).map(mapDeliveryRow);
}

export function getDeliveriesByDestination(destinationSsuId: string): DeliveryRow[] {
  return _sqlite!.prepare(`SELECT * FROM deliveries WHERE destination_ssu_id = ? AND status IN ('pending', 'in-transit')`)
    .all(destinationSsuId).map(mapDeliveryRow);
}

export function getActiveDeliveryByPackage(packageId: string): DeliveryRow | null {
  const r = _sqlite!.prepare(
    `SELECT * FROM deliveries WHERE package_id = ? AND status IN ('pending', 'in-transit')`,
  ).get(packageId) as any;
  return r ? mapDeliveryRow(r) : null;
}

export function updateDeliveryStatus(id: string, status: string): void {
  _db!.update(deliveries).set({ status }).where(eq(deliveries.id, id)).run();
}

export function addDeliveryCourier(c: { deliveryId: string; courierWallet: string; courierName: string; itemsDistributed: DeliveryItem[]; claimDigest?: string }): number {
  const result = _sqlite!.prepare(`
    INSERT INTO delivery_couriers (delivery_id, courier_wallet, courier_name, items_distributed, items_deposited, status, accepted_at, claim_digest)
    VALUES (?, ?, ?, ?, '[]', 'in-transit', ?, ?)
  `).run(c.deliveryId, c.courierWallet, c.courierName, JSON.stringify(c.itemsDistributed), Date.now(), c.claimDigest ?? null);
  return Number(result.lastInsertRowid);
}

export function getDeliveryCouriers(deliveryId: string): DeliveryCourierRow[] {
  return _sqlite!.prepare(`SELECT * FROM delivery_couriers WHERE delivery_id = ?`)
    .all(deliveryId).map(mapCourierRow);
}

export function getDeliveryCouriersByWallet(wallet: string): DeliveryCourierRow[] {
  return _sqlite!.prepare(`SELECT * FROM delivery_couriers WHERE courier_wallet = ? AND status = 'in-transit'`)
    .all(wallet).map(mapCourierRow);
}

export function updateCourierDeposit(courierId: number, deposited: DeliveryItem[]): void {
  _sqlite!.prepare(`UPDATE delivery_couriers SET items_deposited = ? WHERE id = ?`)
    .run(JSON.stringify(deposited), courierId);
}

export function updateCourierStatus(courierId: number, status: string): void {
  _sqlite!.prepare(`UPDATE delivery_couriers SET status = ?, completed_at = ? WHERE id = ?`)
    .run(status, status === "in-transit" ? null : Date.now(), courierId);
}

export function updateCourierClaimDigest(courierId: number, claimDigest: string): void {
  _sqlite!.prepare(`UPDATE delivery_couriers SET claim_digest = ? WHERE id = ?`)
    .run(claimDigest, courierId);
}

/** Check if all items for a delivery have been deposited across all couriers. */
export function isDeliveryFullyDeposited(deliveryId: string): boolean {
  const delivery = getDelivery(deliveryId);
  if (!delivery) return false;
  const couriers = getDeliveryCouriers(deliveryId);
  const totalDeposited = new Map<number, number>();
  for (const c of couriers) {
    for (const item of c.itemsDeposited) {
      totalDeposited.set(item.typeId, (totalDeposited.get(item.typeId) ?? 0) + item.quantity);
    }
  }
  return delivery.items.every((item) => (totalDeposited.get(item.typeId) ?? 0) >= item.quantity);
}

/**
 * Complete a goal-linked delivery: mark deliver missions as completed in the
 * source SSU's goals, and credit each courier proportionally to items delivered.
 * Returns a map of courierWallet → reward amount.
 */
export function completeDeliveryGoal(
  delivery: DeliveryRow,
): Map<string, number> {
  const rewardMap = new Map<string, number>();
  if (delivery.sourceType !== "goal") return rewardMap;

  const ssuId = delivery.ssuId;
  const tribeId = delivery.tribeId;
  const goalId = Number(delivery.sourceId);
  if (!goalId) return rewardMap;

  const goalRows = getGoals(ssuId, tribeId);
  const goal = goalRows.find((g) => g.id === goalId);
  if (!goal || goal.status !== "published") return rewardMap;

  // Calculate budget remaining for reward distribution
  let budgetRemaining = goal.budget - (goal.budgetAwarded ?? 0);

  // Build courier contribution totals: wallet → total items deposited
  const couriers = getDeliveryCouriers(delivery.id);
  let totalItemsDelivered = 0;
  const courierItemTotals = new Map<string, number>();
  for (const c of couriers) {
    let courierTotal = 0;
    for (const item of c.itemsDeposited) {
      courierTotal += item.quantity;
    }
    courierItemTotals.set(c.courierWallet, (courierItemTotals.get(c.courierWallet) ?? 0) + courierTotal);
    totalItemsDelivered += courierTotal;
  }

  // Complete DELIVER missions and compute reward per mission
  let totalReward = 0;
  for (const m of goal.missions) {
    if (m.phase !== "DELIVER" || !m.isPublished) continue;
    if (m.completedQty >= m.quantity) continue; // already done
    // Mark as fully completed
    _sqlite!.prepare(`
      UPDATE missions SET completed_qty = quantity
      WHERE goal_id = ? AND idx = ?
    `).run(goalId, m.idx);
    // Add reward for this mission's full quantity
    const missionBudgetShare = goal.budget > 0
      ? (m.quantity / goal.missions.filter((mm) => mm.isPublished).reduce((s, mm) => s + mm.quantity, 0)) * budgetRemaining
      : 0;
    totalReward += missionBudgetShare;
  }

  // Distribute reward proportionally to each courier based on items they delivered
  if (totalReward > 0 && totalItemsDelivered > 0) {
    courierItemTotals.forEach((itemCount, wallet) => {
      const share = Math.round((itemCount / totalItemsDelivered) * totalReward);
      if (share > 0) {
        adjustBalance(tribeId, wallet, share);
        rewardMap.set(wallet, share);
      }
    });
  }

  // Update goal budget awarded
  let actualRewarded = 0;
  rewardMap.forEach((v) => { actualRewarded += v; });
  if (actualRewarded > 0) {
    _sqlite!.prepare(`
      UPDATE goals SET budget_awarded = budget_awarded + ?
      WHERE id = ? AND ssu_id = ? AND tribe_id = ?
    `).run(actualRewarded, goalId, ssuId, tribeId);
  }

  // Check if all published missions are now complete → mark goal completed
  const updatedGoal = getGoals(ssuId, tribeId).find((g) => g.id === goalId);
  if (updatedGoal) {
    const allDone = updatedGoal.missions
      .filter((m) => m.isPublished)
      .every((m) => m.completedQty >= m.quantity);
    if (allDone && updatedGoal.status === "published") {
      _sqlite!.prepare(`
        UPDATE goals SET status = 'completed'
        WHERE id = ? AND ssu_id = ? AND tribe_id = ?
      `).run(goalId, ssuId, tribeId);
    }
  }

  return rewardMap;
}

// ═══════════════════════════════════════════════════════════════════════════
// Package operations
// ═══════════════════════════════════════════════════════════════════════════

export interface PackageItemRow {
  id?: number;
  packageId: string;
  itemTypeId: number;
  itemName: string;
  quantity: number;
  slotType: string;
}

export interface PackageRow {
  id: string;
  ssuId: string;
  tribeId: string;
  name: string;
  shipType: string;
  fittingText: string;
  createdBy: string;
  status: string;
  marketOrderId: string | null;
  createdAt: number;
  items: PackageItemRow[];
}

export function getPackages(ssuId: string, tribeId: string): PackageRow[] {
  const rows = _db!
    .select()
    .from(packages)
    .where(and(eq(packages.ssuId, ssuId), eq(packages.tribeId, tribeId)))
    .all();
  return rows.map((r) => {
    const items = _db!
      .select()
      .from(packageItems)
      .where(eq(packageItems.packageId, r.id))
      .all()
      .map((pi) => ({
        id: pi.id,
        packageId: pi.packageId,
        itemTypeId: pi.itemTypeId,
        itemName: pi.itemName,
        quantity: pi.quantity,
        slotType: pi.slotType,
      }));
    return {
      id: r.id,
      ssuId: r.ssuId,
      tribeId: r.tribeId,
      name: r.name,
      shipType: r.shipType,
      fittingText: r.fittingText,
      createdBy: r.createdBy,
      status: r.status,
      marketOrderId: r.marketOrderId,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Number(r.createdAt),
      items,
    };
  });
}

export function getPackageById(pkgId: string): PackageRow | null {
  const r = _db!
    .select()
    .from(packages)
    .where(eq(packages.id, pkgId))
    .get();
  if (!r) return null;
  const items = _db!
    .select()
    .from(packageItems)
    .where(eq(packageItems.packageId, r.id))
    .all()
    .map((pi) => ({
      id: pi.id,
      packageId: pi.packageId,
      itemTypeId: pi.itemTypeId,
      itemName: pi.itemName,
      quantity: pi.quantity,
      slotType: pi.slotType,
    }));
  return {
    id: r.id,
    ssuId: r.ssuId,
    tribeId: r.tribeId,
    name: r.name,
    shipType: r.shipType,
    fittingText: r.fittingText,
    createdBy: r.createdBy,
    status: r.status,
    marketOrderId: r.marketOrderId,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Number(r.createdAt),
    items,
  };
}

export function insertPackage(
  pkg: Omit<PackageRow, "items" | "createdAt">,
  items: Omit<PackageItemRow, "id" | "packageId">[],
): void {
  _db!.insert(packages).values({
    id: pkg.id,
    ssuId: pkg.ssuId,
    tribeId: pkg.tribeId,
    name: pkg.name,
    shipType: pkg.shipType,
    fittingText: pkg.fittingText,
    createdBy: pkg.createdBy,
    status: pkg.status,
    marketOrderId: pkg.marketOrderId,
  }).run();
  for (const item of items) {
    _db!.insert(packageItems).values({
      packageId: pkg.id,
      itemTypeId: item.itemTypeId,
      itemName: item.itemName,
      quantity: item.quantity,
      slotType: item.slotType,
    }).run();
  }
}

export function updatePackageStatus(pkgId: string, status: string, marketOrderId?: string | null): void {
  const updates: Record<string, unknown> = { status };
  if (marketOrderId !== undefined) updates.marketOrderId = marketOrderId;
  _db!.update(packages).set(updates).where(eq(packages.id, pkgId)).run();
}

export function deletePackage(pkgId: string): void {
  _db!.delete(packageItems).where(eq(packageItems.packageId, pkgId)).run();
  _db!.delete(packages).where(eq(packages.id, pkgId)).run();
}

export function getPackageItemsByOrderId(orderId: string): PackageItemRow[] {
  const pkg = _db!
    .select()
    .from(packages)
    .where(eq(packages.marketOrderId, orderId))
    .get();
  if (!pkg) return [];
  return _db!
    .select()
    .from(packageItems)
    .where(eq(packageItems.packageId, pkg.id))
    .all()
    .map((pi) => ({
      id: pi.id,
      packageId: pi.packageId,
      itemTypeId: pi.itemTypeId,
      itemName: pi.itemName,
      quantity: pi.quantity,
      slotType: pi.slotType,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Full database backup / restore
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tables to include in backups. Excludes large ephemeral caches
 * like solar_systems (re-fetched from chain) and kv_store (migrated on boot).
 */
const BACKUP_TABLES = [
  "deployments",
  "ssu_registrations",
  "members",
  "wings",
  "wing_members",
  "allocations",
  "goals",
  "missions",
  "mission_wing_assignments",
  "ssu_locations",
  "ssu_network_settings",
  "location_access_grants",
  "location_access_requests",
  "location_blocked",
  "location_whitelist",
  "network_map_nodes",
  "network_map_links",
  "network_map_waypoints",
  "network_map_data_shares",
  "tribe_settings",
  "balances",
  "ledger_entries",
  "market_orders",
  "market_history",
  "price_snapshots",
  "tribe_coin_orders",
  "external_ssus",
  "contracts",
  "contract_missions",
  "contract_item_escrow",
  "deliveries",
  "delivery_couriers",
  "packages",
  "package_items",
  "corporate_inventory",
] as const;

/** Export the entire database as a JSON object keyed by table name. */
export function exportDatabase(): Record<string, unknown[]> {
  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    try {
      data[table] = _sqlite!.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      // Table may not exist yet
      data[table] = [];
    }
  }
  return data;
}

/** Import a full database backup. Clears existing data in each table first. */
export function importDatabase(data: Record<string, unknown[]>): { tablesRestored: number; rowsRestored: number } {
  let tablesRestored = 0;
  let rowsRestored = 0;

  const tx = _sqlite!.transaction(() => {
    for (const table of BACKUP_TABLES) {
      const rows = data[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Get column names from the first row
      const columns = Object.keys(rows[0] as Record<string, unknown>);
      if (columns.length === 0) continue;

      // Verify these columns exist in the table
      const tableInfo = _sqlite!.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const validColumns = new Set(tableInfo.map((c) => c.name));
      const usableColumns = columns.filter((c) => validColumns.has(c));
      if (usableColumns.length === 0) continue;

      // Clear existing data
      _sqlite!.prepare(`DELETE FROM ${table}`).run();

      // Insert rows
      const placeholders = usableColumns.map(() => "?").join(", ");
      const colList = usableColumns.join(", ");
      const stmt = _sqlite!.prepare(`INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`);

      for (const row of rows) {
        const r = row as Record<string, unknown>;
        stmt.run(...usableColumns.map((c) => r[c] ?? null));
        rowsRestored++;
      }
      tablesRestored++;
    }
  });

  tx();
  return { tablesRestored, rowsRestored };
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-backup: periodically write DB snapshot to Railway volume
// ═══════════════════════════════════════════════════════════════════════════

const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
let _backupTimer: ReturnType<typeof setInterval> | null = null;
let _lastBackupHash = "";

function writeBackupToVolume(): void {
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!volumePath) return;

  try {
    const data = exportDatabase();
    const json = JSON.stringify(data);

    // Skip if nothing changed since last backup
    const hash = createHash("md5").update(json).digest("hex");
    if (hash === _lastBackupHash) return;

    fs.mkdirSync(volumePath, { recursive: true });
    const backupFile = path.join(volumePath, "db-backup.json");
    fs.writeFileSync(backupFile, json, "utf-8");
    _lastBackupHash = hash;
    const sizeKB = Math.round(json.length / 1024);
    console.log(`[auto-backup] ✓ ${backupFile} (${sizeKB} KB)`);
  } catch (err) {
    console.error("[auto-backup] Failed:", err);
  }
}

function startAutoBackup(): void {
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!volumePath) {
    console.log("[auto-backup] Skipped — RAILWAY_VOLUME_MOUNT_PATH not set");
    return;
  }
  if (_backupTimer) return;

  // Initial backup after 30s to let the DB stabilise
  setTimeout(() => {
    writeBackupToVolume();
    _backupTimer = setInterval(writeBackupToVolume, BACKUP_INTERVAL_MS);
  }, 30_000);
  console.log(`[auto-backup] Scheduled every ${BACKUP_INTERVAL_MS / 1000}s → ${volumePath}/db-backup.json`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Overlay — mission subscriptions & display settings
// ═══════════════════════════════════════════════════════════════════════════

export interface OverlaySubscription {
  id: number;
  wallet: string;
  ssuId: string;
  tribeId: string;
  goalId: number;
  missionIdx: number;
  createdAt: Date;
}

export interface OverlaySettingsRow {
  wallet: string;
  opacity: number;
  position: string;
  showAlerts: boolean;
  showMissions: boolean;
  showFuel: boolean;
  updatedAt: Date;
}

/** List all overlay subscriptions for a wallet scoped to an SSU/tribe. */
export function getOverlaySubscriptions(wallet: string, ssuId: string, tribeId: string): OverlaySubscription[] {
  const db = _db!;
  return db
    .select()
    .from(overlaySubscriptions)
    .where(
      and(
        eq(overlaySubscriptions.wallet, wallet.toLowerCase()),
        eq(overlaySubscriptions.ssuId, ssuId),
        eq(overlaySubscriptions.tribeId, tribeId),
      ),
    )
    .all() as unknown as OverlaySubscription[];
}

/** Add a mission subscription for the overlay (idempotent). */
export function addOverlaySubscription(wallet: string, ssuId: string, tribeId: string, goalId: number, missionIdx: number): void {
  const db = _db!;
  const safeWallet = wallet.toLowerCase();
  // Check for existing subscription to keep it idempotent
  const existing = db
    .select()
    .from(overlaySubscriptions)
    .where(
      and(
        eq(overlaySubscriptions.wallet, safeWallet),
        eq(overlaySubscriptions.ssuId, ssuId),
        eq(overlaySubscriptions.tribeId, tribeId),
        eq(overlaySubscriptions.goalId, goalId),
        eq(overlaySubscriptions.missionIdx, missionIdx),
      ),
    )
    .get();
  if (existing) return;
  db.insert(overlaySubscriptions).values({
    wallet: safeWallet,
    ssuId,
    tribeId,
    goalId,
    missionIdx,
    createdAt: new Date(),
  }).run();
}

/** Remove a mission subscription. */
export function removeOverlaySubscription(wallet: string, ssuId: string, tribeId: string, goalId: number, missionIdx: number): void {
  const db = _db!;
  db.delete(overlaySubscriptions)
    .where(
      and(
        eq(overlaySubscriptions.wallet, wallet.toLowerCase()),
        eq(overlaySubscriptions.ssuId, ssuId),
        eq(overlaySubscriptions.tribeId, tribeId),
        eq(overlaySubscriptions.goalId, goalId),
        eq(overlaySubscriptions.missionIdx, missionIdx),
      ),
    )
    .run();
}

/** Remove all overlay subscriptions for a wallet+ssu (e.g. on SSU change). */
export function clearOverlaySubscriptions(wallet: string, ssuId: string, tribeId: string): void {
  const db = _db!;
  db.delete(overlaySubscriptions)
    .where(
      and(
        eq(overlaySubscriptions.wallet, wallet.toLowerCase()),
        eq(overlaySubscriptions.ssuId, ssuId),
        eq(overlaySubscriptions.tribeId, tribeId),
      ),
    )
    .run();
}

/** Get overlay display settings for a wallet (creates defaults if not present). */
export function getOverlaySettings(wallet: string): OverlaySettingsRow {
  const db = _db!;
  const row = db
    .select()
    .from(overlaySettings)
    .where(eq(overlaySettings.wallet, wallet.toLowerCase()))
    .get() as unknown as OverlaySettingsRow | undefined;
  if (row) return row;
  return { wallet, opacity: 0.85, position: "top-right", showAlerts: true, showMissions: true, showFuel: true, updatedAt: new Date() };
}

/** Upsert overlay display settings. */
export function setOverlaySettings(wallet: string, patch: Partial<Omit<OverlaySettingsRow, "wallet" | "updatedAt">>): void {
  const db = _db!;
  const existing = getOverlaySettings(wallet);
  db.insert(overlaySettings)
    .values({
      wallet: wallet.toLowerCase(),
      opacity: patch.opacity ?? existing.opacity,
      position: patch.position ?? existing.position,
      showAlerts: patch.showAlerts ?? existing.showAlerts,
      showMissions: patch.showMissions ?? existing.showMissions,
      showFuel: patch.showFuel ?? existing.showFuel,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: overlaySettings.wallet,
      set: {
        opacity: patch.opacity ?? existing.opacity,
        position: patch.position ?? existing.position,
        showAlerts: patch.showAlerts ?? existing.showAlerts,
        showMissions: patch.showMissions ?? existing.showMissions,
        showFuel: patch.showFuel ?? existing.showFuel,
        updatedAt: new Date(),
      },
    })
    .run();
}
