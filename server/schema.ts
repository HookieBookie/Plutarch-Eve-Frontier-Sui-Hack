import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// KV store — used for low-write config blobs (deployment, tribe-settings, etc.)
// ---------------------------------------------------------------------------
export const kvStore = sqliteTable(
  "kv_store",
  {
    prefix: text("prefix").notNull(),
    key: text("key").notNull(),
    data: text("data").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.prefix, table.key] })],
);

// ---------------------------------------------------------------------------
// Balances — per-tribe off-chain earned credits
// ---------------------------------------------------------------------------
export const balances = sqliteTable(
  "balances",
  {
    tribeId: text("tribe_id").notNull(),
    wallet: text("wallet").notNull(),
    amount: real("amount").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.tribeId, table.wallet] })],
);

// ---------------------------------------------------------------------------
// Ledger entries — append-only event log, scoped to SSU + tribe
// ---------------------------------------------------------------------------
export const ledgerEntries = sqliteTable("ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ssuId: text("ssu_id").notNull(),
  tribeId: text("tribe_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  eventType: text("event_type").notNull(),
  goalId: real("goal_id"),
  goalType: text("goal_type"),
  goalDescription: text("goal_description"),
  missionIdx: integer("mission_idx"),
  missionPhase: text("mission_phase"),
  missionItem: text("mission_item"),
  amount: real("amount"),
});

// ---------------------------------------------------------------------------
// Market orders
// ---------------------------------------------------------------------------
export const marketOrders = sqliteTable("market_orders", {
  id: text("id").primaryKey(),
  ssuId: text("ssu_id").notNull(),
  tribeId: text("tribe_id").notNull(),
  side: text("side").notNull(),           // "buy" | "sell"
  wallet: text("wallet").notNull(),
  playerName: text("player_name").notNull(),
  itemTypeId: integer("item_type_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  pricePerUnit: real("price_per_unit").notNull(),
  fee: real("fee").notNull(),
  escrowTotal: real("escrow_total").notNull(),
  status: text("status").notNull(),       // "active" | "filled" | "cancelled"
  createdAt: text("created_at").notNull(),
  packageId: text("package_id"),            // FK → packages.id (nullable, set for package sell orders)
  visibility: text("visibility").notNull().default("tribal"), // "tribal" | "public"
});

// ---------------------------------------------------------------------------
// Market history — completed trades
// ---------------------------------------------------------------------------
export const marketHistory = sqliteTable("market_history", {
  id: text("id").primaryKey(),
  ssuId: text("ssu_id").notNull(),
  tribeId: text("tribe_id").notNull(),
  side: text("side").notNull(),
  buyer: text("buyer").notNull(),
  seller: text("seller").notNull(),
  itemTypeId: integer("item_type_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  pricePerUnit: real("price_per_unit").notNull(),
  fee: real("fee").notNull(),
  completedAt: text("completed_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — Normalised tables
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Tribe settings — per-tribe config (tax rate, etc.)
// ---------------------------------------------------------------------------
export const tribeSettings = sqliteTable("tribe_settings", {
  tribeId: text("tribe_id").primaryKey(),
  taxBps: integer("tax_bps").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Deployment configs — per-tribe Move package / coin metadata
// ---------------------------------------------------------------------------
export const deployments = sqliteTable("deployments", {
  tribeId: text("tribe_id").primaryKey(),
  packageId: text("package_id").notNull(),
  registryId: text("registry_id").notNull(),
  creditCoinType: text("credit_coin_type").notNull().default(""),
  creditMetadataId: text("credit_metadata_id").notNull().default(""),
  coinPackageId: text("coin_package_id").notNull().default(""),
  systemManagerCapId: text("system_manager_cap_id").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// SSU registrations — one row per activated Smart Storage Unit
// ---------------------------------------------------------------------------
export const ssuRegistrations = sqliteTable(
  "ssu_registrations",
  {
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    hubName: text("hub_name").notNull().default(""),
    tribeName: text("tribe_name").notNull().default(""),
    activatedAt: text("activated_at").notNull(),
    activatedBy: text("activated_by").notNull(),
    characterName: text("character_name").notNull().default(""),
    vaultObjectId: text("vault_object_id").notNull().default(""),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.ssuId, table.tribeId] })],
);

// ---------------------------------------------------------------------------
// Members — tribe members scoped by SSU + tribe
// ---------------------------------------------------------------------------
export const members = sqliteTable(
  "members",
  {
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    address: text("address").notNull(),
    name: text("name").notNull(),
    characterId: integer("character_id"),
    joinedAt: integer("joined_at").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.ssuId, table.tribeId, table.address] }),
  ],
);

// ---------------------------------------------------------------------------
// Wings — organisational groups within an SSU/tribe
// ---------------------------------------------------------------------------
export const wings = sqliteTable(
  "wings",
  {
    id: text("id").primaryKey(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#888"),
    symbol: text("symbol").notNull().default("⬡"),
  },
  (table) => [
    index("idx_wings_scope").on(table.ssuId, table.tribeId),
  ],
);

// ---------------------------------------------------------------------------
// Wing members — join table linking wings to wallet addresses
// ---------------------------------------------------------------------------
export const wingMembers = sqliteTable(
  "wing_members",
  {
    wingId: text("wing_id").notNull(),
    address: text("address").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.wingId, table.address] }),
  ],
);

// ---------------------------------------------------------------------------
// Allocations — item allocations to wings
// ---------------------------------------------------------------------------
export const allocations = sqliteTable(
  "allocations",
  {
    id: text("id").primaryKey(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    itemTypeId: integer("item_type_id").notNull(),
    itemName: text("item_name").notNull(),
    wingId: text("wing_id").notNull(),
    quantity: integer("quantity").notNull(),
    allocatedBy: text("allocated_by").notNull(),
    allocatedAt: integer("allocated_at").notNull(),
    packageId: text("package_id"),
  },
  (table) => [
    index("idx_alloc_scope").on(table.ssuId, table.tribeId),
  ],
);

// ---------------------------------------------------------------------------
// Corporate Inventory — per-tribe claims on open storage items
// ---------------------------------------------------------------------------
export const corporateInventory = sqliteTable(
  "corporate_inventory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    typeId: integer("type_id").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_corp_inv_scope").on(table.ssuId, table.tribeId),
    index("idx_corp_inv_item").on(table.ssuId, table.tribeId, table.typeId),
  ],
);

// ---------------------------------------------------------------------------
// Goals — goals scoped by SSU + tribe
// ---------------------------------------------------------------------------
export const goals = sqliteTable(
  "goals",
  {
    id: integer("id").primaryKey(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    type: text("type").notNull(),         // "Construct" | "Manufacture" | "Refine" | "Gather"
    description: text("description").notNull().default(""),
    budget: real("budget").notNull().default(0),
    tierPercents: text("tier_percents").notNull().default("[25,50,75]"),  // JSON array
    status: text("status").notNull().default("draft"),  // "draft" | "published" | "completed" | "cancelled"
    budgetAwarded: real("budget_awarded").notNull().default(0),
    startedAt: integer("started_at"),
    ongoing: integer("ongoing").notNull().default(0),
    cycleCount: integer("cycle_count").notNull().default(0),
    cycleStartedAt: integer("cycle_started_at"),
    acquireRewards: text("acquire_rewards"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_goals_scope").on(table.ssuId, table.tribeId),
  ],
);

// ---------------------------------------------------------------------------
// Missions — individual tasks within a goal
// ---------------------------------------------------------------------------
export const missions = sqliteTable(
  "missions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id").notNull(),
    idx: integer("idx").notNull(),       // Mission index within the goal
    phase: text("phase").notNull(),      // "GATHER" | "REFINE" | "INDUSTRY" | "CONSTRUCT"
    tier: integer("tier").notNull(),
    description: text("description").notNull().default(""),
    quantity: integer("quantity").notNull().default(0),
    typeId: integer("type_id"),          // EVE item type ID (nullable)
    isAlternative: integer("is_alternative", { mode: "boolean" }).notNull().default(false),
    altReason: text("alt_reason"),
    inputItem: text("input_item"),
    isPublished: integer("is_published", { mode: "boolean" }).notNull().default(false),
    completedQty: integer("completed_qty").notNull().default(0),
  },
  (table) => [
    index("idx_missions_goal").on(table.goalId),
  ],
);

// ---------------------------------------------------------------------------
// Mission wing assignments — which wings are assigned to which missions
// ---------------------------------------------------------------------------
export const missionWingAssignments = sqliteTable(
  "mission_wing_assignments",
  {
    missionId: integer("mission_id").notNull(),
    wingId: text("wing_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.missionId, table.wingId] }),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — Network & Territory tables
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// SSU locations — stores the solar-system location for each SSU
// ---------------------------------------------------------------------------
export const ssuLocations = sqliteTable(
  "ssu_locations",
  {
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    solarSystemId: text("solar_system_id").notNull(),        // encrypted
    solarSystemName: text("solar_system_name").notNull().default(""),  // encrypted
    locationX: text("location_x").notNull().default(""),    // encrypted (was real)
    locationY: text("location_y").notNull().default(""),    // encrypted (was real)
    locationZ: text("location_z").notNull().default(""),    // encrypted (was real)
    pNum: text("p_num").notNull().default(""),              // encrypted
    lNum: text("l_num").notNull().default(""),              // encrypted
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.ssuId, table.tribeId] })],
);

// ---------------------------------------------------------------------------
// SSU network settings — visibility and access control per SSU
// ---------------------------------------------------------------------------
export const ssuNetworkSettings = sqliteTable(
  "ssu_network_settings",
  {
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    visibility: text("visibility").notNull().default("tribal"),  // "private" | "public" | "tribal"
    locationPolicy: text("location_policy").notNull().default("manual"), // "manual" | "auto-accept" | "auto-deny" | "whitelist"
    budgetMode: text("budget_mode").notNull().default("shared"), // "shared" | "local"
    localBudget: integer("local_budget").notNull().default(0),   // credits allocated to this SSU (when mode=local)
    networkNodeId: text("network_node_id"),                     // linked network-node assembly ID (0x…)
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.ssuId, table.tribeId] })],
);

// ---------------------------------------------------------------------------
// Location access grants — who can see detailed coords of which SSU
// ---------------------------------------------------------------------------
export const locationAccessGrants = sqliteTable(
  "location_access_grants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    grantedTo: text("granted_to").notNull(),    // wallet address
    grantedAt: integer("granted_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_grants_scope").on(table.ssuId, table.tribeId),
    index("idx_grants_wallet").on(table.grantedTo),
  ],
);

// ---------------------------------------------------------------------------
// Location access requests — users requesting to see an SSU's location
// ---------------------------------------------------------------------------
export const locationAccessRequests = sqliteTable(
  "location_access_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ssuId: text("ssu_id").notNull(),             // the SSU whose location is requested
    tribeId: text("tribe_id").notNull(),
    requesterAddress: text("requester_address").notNull(),
    requesterName: text("requester_name").notNull().default(""),
    requesterSsuId: text("requester_ssu_id").notNull().default(""), // which SSU they're requesting from
    status: text("status").notNull().default("pending"),  // "pending" | "approved" | "denied"
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("idx_requests_scope").on(table.ssuId, table.tribeId),
    index("idx_requests_requester").on(table.requesterAddress),
  ],
);

// ---------------------------------------------------------------------------
// Location blocked — blocked users/SSUs from making location requests
// ---------------------------------------------------------------------------
export const locationBlocked = sqliteTable(
  "location_blocked",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    blockedAddress: text("blocked_address"),      // null = block by SSU
    blockedSsuId: text("blocked_ssu_id"),         // null = block by address
    blockedAt: integer("blocked_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_blocked_scope").on(table.ssuId, table.tribeId),
  ],
);

// ---------------------------------------------------------------------------
// Location whitelist — SSUs auto-approved for location access
// ---------------------------------------------------------------------------
export const locationWhitelist = sqliteTable(
  "location_whitelist",
  {
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    whitelistedSsuId: text("whitelisted_ssu_id").notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.ssuId, table.tribeId, table.whitelistedSsuId] }),
  ],
);

// ---------------------------------------------------------------------------
// Network map nodes — SSUs placed on the interactive map
// ---------------------------------------------------------------------------
export const networkMapNodes = sqliteTable(
  "network_map_nodes",
  {
    id: text("id").primaryKey(),                              // UUID
    ssuId: text("ssu_id").notNull(),                          // which SSU this represents
    tribeId: text("tribe_id").notNull(),
    label: text("label").notNull().default(""),                // display name
    mapX: real("map_x").notNull().default(0),                 // position on the 2D map canvas
    mapY: real("map_y").notNull().default(0),
    visibility: text("visibility").notNull().default("tribal"),// "tribal" | "public"
    addedBy: text("added_by").notNull(),                      // wallet that added it
    solarSystemName: text("solar_system_name").default(""),   // cached system name
    solarSystemId: text("solar_system_id").default(""),       // numeric CCP system ID
    pNum: text("p_num").default(""),                           // L-Point planet number
    lNum: text("l_num").default(""),                           // L-Point location number
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_map_nodes_tribe").on(table.tribeId),
    index("idx_map_nodes_ssu").on(table.ssuId, table.tribeId),
  ],
);

// ---------------------------------------------------------------------------
// Network map links — connections between two map nodes
// ---------------------------------------------------------------------------
export const networkMapLinks = sqliteTable(
  "network_map_links",
  {
    id: text("id").primaryKey(),                              // UUID
    tribeId: text("tribe_id").notNull(),
    fromNodeId: text("from_node_id").notNull(),               // FK → network_map_nodes.id
    toNodeId: text("to_node_id").notNull(),                   // FK → network_map_nodes.id
    linkType: text("link_type").notNull(),                    // "route" | "data"
    createdBy: text("created_by").notNull(),                  // wallet
    rawRoute: text("raw_route").default(""),                   // original EF-Map paste text
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_map_links_tribe").on(table.tribeId),
    index("idx_map_links_from").on(table.fromNodeId),
    index("idx_map_links_to").on(table.toNodeId),
  ],
);

// ---------------------------------------------------------------------------
// Network map waypoints — ordered steps within a route link
// ---------------------------------------------------------------------------
export const networkMapWaypoints = sqliteTable(
  "network_map_waypoints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linkId: text("link_id").notNull(),                        // FK → network_map_links.id
    stepOrder: integer("step_order").notNull(),                // 0-based order in the route
    waypointType: text("waypoint_type").notNull(),            // "warp" | "smart_gate" | "jump_gate" | "ship_jump"
    fromSystem: text("from_system").notNull().default(""),    // solar system name
    toSystem: text("to_system").notNull().default(""),        // solar system name
    fromSystemId: text("from_system_id").notNull().default(""), // numeric CCP system ID
    toSystemId: text("to_system_id").notNull().default(""),     // numeric CCP system ID
    fromLpoint: text("from_lpoint").notNull().default(""),    // e.g. "P4L3" — for warps
    toLpoint: text("to_lpoint").notNull().default(""),        // e.g. "P2L1" — for warps
    distance: text("distance").default(""),                    // e.g. "76.10" — from EF-Map
  },
  (table) => [
    index("idx_waypoints_link").on(table.linkId),
  ],
);

// ---------------------------------------------------------------------------
// Network map data-link sharing — what data categories a data link shares
// ---------------------------------------------------------------------------
export const networkMapDataShares = sqliteTable(
  "network_map_data_shares",
  {
    linkId: text("link_id").notNull(),                        // FK → network_map_links.id
    category: text("category").notNull(),                     // "goals" | "market" | "inventory" | etc.
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.category] }),
  ],
);

// ---------------------------------------------------------------------------
// Price snapshots — periodic backing-ratio records for all known tribes
// ---------------------------------------------------------------------------
export const priceSnapshots = sqliteTable(
  "price_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tribeId: text("tribe_id").notNull(),
    eveBacking: real("eve_backing").notNull(),       // vault EVE backing (base units)
    creditSupply: real("credit_supply").notNull(),    // total credit supply (base units)
    backingRatio: real("backing_ratio").notNull(),    // eveBacking / creditSupply
    timestamp: integer("timestamp", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_price_tribe").on(table.tribeId),
    index("idx_price_time").on(table.tribeId, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// Tribe coin limit orders — cross-tribe exchange orders
// ---------------------------------------------------------------------------
export const tribeCoinOrders = sqliteTable(
  "tribe_coin_orders",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),                         // order creator
    playerName: text("player_name").notNull().default(""),
    sourceTribeId: text("source_tribe_id").notNull(),         // tribe whose coin they're offering
    targetTribeId: text("target_tribe_id").notNull(),         // tribe whose coin they want
    side: text("side").notNull(),                             // "buy" = buying target w/ source, "sell" = selling source for target
    quantity: real("quantity").notNull(),                      // amount of source coin
    limitRate: real("limit_rate").notNull(),                   // max/min exchange rate (target per source)
    status: text("status").notNull().default("open"),         // "open" | "filled" | "cancelled"
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_tco_tribes").on(table.sourceTribeId, table.targetTribeId),
    index("idx_tco_wallet").on(table.wallet),
    index("idx_tco_status").on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// External SSUs — manually-added SSUs from other tribes (trade alliances, etc.)
// ---------------------------------------------------------------------------
export const externalSsus = sqliteTable(
  "external_ssus",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ssuId: text("ssu_id").notNull(),                          // local SSU that added this external
    tribeId: text("tribe_id").notNull(),                      // local tribe
    externalSsuId: text("external_ssu_id").notNull(),         // the foreign SSU address (assembly ID)
    addedBy: text("added_by").notNull(),                      // wallet that added it
    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_ext_ssu_local").on(table.ssuId, table.tribeId),
    index("idx_ext_ssu_external").on(table.externalSsuId),
  ],
);

// ---------------------------------------------------------------------------
// Contracts — user-created bounties at SSUs
// ---------------------------------------------------------------------------
export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    creatorName: text("creator_name").notNull().default(""),
    type: text("type").notNull(),                   // "Construct" | "Manufacture" | "Refine" | "Gather" | "Acquire"
    description: text("description").notNull().default(""),
    budget: real("budget").notNull(),                // full reward amount (escrowed)
    taxPaid: real("tax_paid").notNull().default(0),  // tribe tax paid at creation (non-refundable)
    visibility: text("visibility").notNull().default("tribe"), // "tribe" | "public"
    postDurationMs: integer("post_duration_ms").notNull(),     // how long before it expires
    missionDurationMs: integer("mission_duration_ms").notNull(), // how long acceptor has to complete
    status: text("status").notNull().default("open"),  // "open" | "accepted" | "completed" | "failed" | "expired" | "cancelled"
    acceptorWallet: text("acceptor_wallet"),
    acceptorName: text("acceptor_name"),
    acceptorDeposit: real("acceptor_deposit").notNull().default(0), // deposit held from acceptor
    acceptedAt: integer("accepted_at"),              // timestamp when accepted
    completedAt: integer("completed_at"),             // timestamp when completed/failed/expired
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_contracts_scope").on(table.ssuId, table.tribeId),
    index("idx_contracts_creator").on(table.creatorWallet),
    index("idx_contracts_status").on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// Contract missions — individual tasks within a contract
// ---------------------------------------------------------------------------
export const contractMissions = sqliteTable(
  "contract_missions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contractId: text("contract_id").notNull(),
    idx: integer("idx").notNull(),
    phase: text("phase").notNull(),
    tier: integer("tier").notNull(),
    description: text("description").notNull().default(""),
    quantity: integer("quantity").notNull().default(0),
    typeId: integer("type_id"),
    isAlternative: integer("is_alternative", { mode: "boolean" }).notNull().default(false),
    altReason: text("alt_reason"),
    inputItem: text("input_item"),
    completedQty: integer("completed_qty").notNull().default(0),
  },
  (table) => [
    index("idx_cmissions_contract").on(table.contractId),
  ],
);

// ---------------------------------------------------------------------------
// Contract item escrow — items deposited by acceptor toward contract progress
// ---------------------------------------------------------------------------
export const contractItemEscrow = sqliteTable(
  "contract_item_escrow",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contractId: text("contract_id").notNull(),
    missionIdx: integer("mission_idx").notNull(),
    typeId: integer("type_id").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull(),
    depositedAt: integer("deposited_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_cescrow_contract").on(table.contractId),
  ],
);

// ---------------------------------------------------------------------------
// Delivery metadata — stores delivery-specific info for goals/contracts
// ---------------------------------------------------------------------------
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    /** "goal" or "contract" */
    sourceType: text("source_type").notNull(),
    /** goal id (as string) or contract id */
    sourceId: text("source_id").notNull(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    /** The destination SSU assembly ID */
    destinationSsuId: text("destination_ssu_id").notNull(),
    destinationTribeId: text("destination_tribe_id").notNull(),
    destinationLabel: text("destination_label").notNull().default(""),
    /** Optional reference to a package whose manifest must be fully delivered */
    packageId: text("package_id"),
    /** JSON array of {typeId, itemName, quantity} */
    items: text("items").notNull(),
    /** Collateral required (contracts only, 0 for goals) */
    collateral: real("collateral").notNull().default(0),
    /** Per-courier timer in ms (starts on acceptance) */
    timerMs: integer("timer_ms").notNull().default(86_400_000),
    status: text("status").notNull().default("pending"),  // "pending"|"in-transit"|"delivered"|"failed"|"cancelled"
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_delivery_source").on(table.sourceType, table.sourceId),
    index("idx_delivery_scope").on(table.ssuId, table.tribeId),
    index("idx_delivery_dest").on(table.destinationSsuId),
  ],
);

// ---------------------------------------------------------------------------
// Delivery couriers — per-courier tracking for each delivery
// ---------------------------------------------------------------------------
export const deliveryCouriers = sqliteTable(
  "delivery_couriers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deliveryId: text("delivery_id").notNull(),
    courierWallet: text("courier_wallet").notNull(),
    courierName: text("courier_name").notNull().default(""),
    /** JSON array of {typeId, itemName, quantity} distributed to this courier */
    itemsDistributed: text("items_distributed").notNull().default("[]"),
    /** JSON array of {typeId, itemName, quantity} deposited at destination so far */
    itemsDeposited: text("items_deposited").notNull().default("[]"),
    status: text("status").notNull().default("in-transit"),  // "in-transit"|"delivered"|"failed"|"expired"
    acceptedAt: integer("accepted_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("idx_dcourier_delivery").on(table.deliveryId),
    index("idx_dcourier_wallet").on(table.courierWallet),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// Packages — bundled item sets (ship fittings, custom bundles)
// ═══════════════════════════════════════════════════════════════════════════

export const packages = sqliteTable(
  "packages",
  {
    id: text("id").primaryKey(),
    ssuId: text("ssu_id").notNull(),
    tribeId: text("tribe_id").notNull(),
    name: text("name").notNull(),
    shipType: text("ship_type").notNull().default(""),
    fittingText: text("fitting_text").notNull().default(""),
    createdBy: text("created_by").notNull(),
    status: text("status").notNull().default("created"),  // "created" | "allocated" | "listed" | "sold" | "cancelled"
    marketOrderId: text("market_order_id"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_packages_scope").on(table.ssuId, table.tribeId),
  ],
);

export const packageItems = sqliteTable(
  "package_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: text("package_id").notNull(),
    itemTypeId: integer("item_type_id").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull(),
    slotType: text("slot_type").notNull().default(""),  // "hull" | "low" | "med" | "high" | "engine" | "charge" | ""
  },
  (table) => [
    index("idx_pkg_items_package").on(table.packageId),
  ],
);
