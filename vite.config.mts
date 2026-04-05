import { defineConfig, loadEnv, type Plugin } from "vite";
import { TENANTS } from "./src/tenants";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  initDb, readStore, writeStore, listByPrefix,
  getBalance, getAllBalances, adjustBalance,
  getLedgerEntries, insertLedgerEntries,
  getMarketOrders, getMarketHistory, getMarketOrderById,
  insertMarketOrder, updateMarketOrderStatus, updateMarketOrderAfterPartialFill, insertMarketHistory,
  runTransaction,
  getTribeSettings, setTribeSettings,
  getDeployment, setDeployment,
  getSsu, getSsuBySsuId, getAllSsus, upsertSsu, deleteSsu,
  getMembers, setMembers,
  getTribeMemberAddresses, getSsusByActivators,
  getWings, setWings,
  getAllocations, setAllocations,
  getGoals, setGoals,
  sanitise, sanitiseRecord, deepSanitise,
  getSsuLocation, upsertSsuLocation, getTribeLocations,
  getNetworkSettings, upsertNetworkSettings, incrementDepositedBudget, transferBudget,
  hasLocationAccess, grantLocationAccess, revokeLocationAccess, getLocationGrants,
  getLocationRequests, createLocationRequest, resolveLocationRequest,
  isBlocked, blockEntity, unblockEntity, getBlockedList,
  getWhitelist, addToWhitelist, removeFromWhitelist,
  canViewSsu,
  getExternalSsus, addExternalSsu, removeExternalSsu, getAllPublicSsus,
  getSolarSystemCount, findSolarSystemByName, bulkInsertSolarSystems,
  getMapNodes, upsertMapNode, deleteMapNode, updateMapNodeLabelsBySsu,
  getMapLinks, insertMapLink, deleteMapLink,
  getMapWaypoints, getMapDataShares,
  getAllTribes, insertPriceSnapshot, getPriceHistory, getLatestPriceSnapshots,
  getTribeCoinOrders, getWalletTribeCoinOrders, insertTribeCoinOrder, updateTribeCoinOrderStatus,
  getContracts, getContractById, insertContract, updateContractStatus,
  acceptContract, progressContractMission, addContractItemEscrow,
  clearContractItemEscrow, isContractFullyCompleted,
  insertDelivery, getDelivery, getDeliveriesBySsu, getDeliveriesByDestination, getDeliveriesBySource,
  getActiveDeliveryByPackage, updateDeliveryStatus,
  addDeliveryCourier, getDeliveryCouriers, getDeliveryCouriersByWallet,
  updateCourierDeposit, updateCourierStatus, updateCourierClaimDigest, isDeliveryFullyDeposited,
  completeDeliveryGoal,
  type DeliveryItem,
  getPackages, getPackageById, insertPackage, deletePackage,
  updatePackageStatus, getPackageItemsByOrderId,
  getCorporateInventory, getAllCorporateInventory, addCorporateInventory, removeCorporateInventory,
  exportDatabase, importDatabase,
  getOverlaySubscriptions, addOverlaySubscription, removeOverlaySubscription, clearOverlaySubscriptions,
  getOverlaySettings, setOverlaySettings,
} from "./server/db";

/** Path to the coin_template Move project */
const COIN_TEMPLATE_DIR = path.resolve(__dirname, "move-contracts/coin_template");

/**
 * Compile a coin module on the server using `sui move build`.
 * Generates a temporary Move source with the given ticker/name,
 * compiles it, and returns the base64 bytecode + dependencies.
 */
function compileCoinModule(ticker: string, coinName?: string): {
  modules: string[];
  dependencies: string[];
} {
  const modName = ticker.toLowerCase();
  const otwName = ticker.toUpperCase();
  const symbol = ticker.toUpperCase();
  const name = coinName ?? `${symbol} Credits`;

  // Create a temporary copy of the coin template with patched source
  const tmpDir = path.resolve(__dirname, `.coin-build-${modName}-${Date.now()}`);
  const srcDir = path.join(tmpDir, "sources");
  fs.mkdirSync(srcDir, { recursive: true });

  // Write Move.toml (copy from template but with renamed package)
  const origToml = fs.readFileSync(path.join(COIN_TEMPLATE_DIR, "Move.toml"), "utf-8");
  const newToml = origToml
    .replace(/name\s*=\s*"coin_template"/, `name = "${modName}"`)
    .replace(/\[addresses\][\s\S]*$/, `[addresses]\n${modName} = "0x0"\n`);
  fs.writeFileSync(path.join(tmpDir, "Move.toml"), newToml);

  // Copy Move.lock if present
  const lockFile = path.join(COIN_TEMPLATE_DIR, "Move.lock");
  if (fs.existsSync(lockFile)) {
    fs.cpSync(lockFile, path.join(tmpDir, "Move.lock"));
  }

  // Generate patched Move source
  const moveSource = `module ${modName}::${modName};

use sui::coin;

public struct ${otwName} has drop {}

fun init(witness: ${otwName}, ctx: &mut TxContext) {
    let (cap, metadata) = coin::create_currency(
        witness,
        9,
        b"${symbol}",
        b"${name}",
        b"Tribe credit tokens backed by EVE",
        option::none(),
        ctx,
    );
    transfer::public_transfer(cap, ctx.sender());
    transfer::public_share_object(metadata);
}
`;
  fs.writeFileSync(path.join(srcDir, `${modName}.move`), moveSource);

  try {
    // Run sui move build
    const stdout = execSync(
      "sui move build --dump-bytecode-as-base64 --silence-warnings",
      { cwd: tmpDir, encoding: "utf-8", timeout: 60_000 },
    );
    const result = JSON.parse(stdout.trim());
    return { modules: result.modules, dependencies: result.dependencies };
  } finally {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Persistence API served by the Vite dev server, backed by SQLite + Drizzle.
 * Replaces the old per-file JSON storage with a single `tribe.db` database.
 */
function tribeApiPlugin(tenantId: string): Plugin {
  function handleJsonApi(
    req: import("http").IncomingMessage,
    res: import("http").ServerResponse,
    prefix: string,
    paramName: string,
    defaultValue: unknown,
  ) {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    const id = url.searchParams.get(paramName) ?? "default";

    // Sanitise key the same way the old file-based system did
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "") || "default";

    if (req.method === "GET") {
      const data = readStore(prefix, safeId);
      res.end(JSON.stringify(data ?? defaultValue));
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          writeStore(prefix, safeId, parsed);
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  function setupApiRoutes(server: { middlewares: { use: (...args: any[]) => void }; httpServer?: import("http").Server | null }) {
      // Initialise a tenant-scoped SQLite database.
      // Each tenant (utopia, stillness, …) gets its own DB file for hard data isolation.
      initDb(__dirname, tenantId);

      // ── Sync map node labels from hubName ──
      // On startup, ensure map node labels reflect the current hubName
      // (which is synced from on-chain Metadata by the poller).
      {
        const ssus = getAllSsus();
        for (const ssu of ssus) {
          if (ssu.hubName && !/^SSU[-\s]/.test(ssu.hubName) && !/^0x[0-9a-fA-F]{20,}$/.test(ssu.hubName)) {
            updateMapNodeLabelsBySsu(ssu.ssuId, ssu.hubName);
          }
        }
      }

      // ── SSU destruction poller ──
      // Periodically verify registered SSUs still exist on-chain.
      // If an SSU object is no longer found (dismantled / destroyed),
      // cascade-delete all its data from the local database.
      const rpcUrl = TENANTS[tenantId]?.rpcUrl ?? "https://fullnode.testnet.sui.io:443";
      const SSU_POLL_INTERVAL = 30_000; // 30 seconds

      async function checkSsuHealth() {
        const ssus = getAllSsus();
        if (ssus.length === 0) return;

        for (const ssu of ssus) {
          try {
            const resp = await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "sui_getObject",
                params: [ssu.ssuId, { showType: true, showContent: true }],
              }),
            });
            const json = await resp.json() as { result?: { data?: { content?: { fields?: Record<string, unknown> } }; error?: { code: string } } };
            const objData = json.result?.data;
            const objError = json.result?.error;

            // Object deleted/not found → cascade delete
            if (!objData || (objError && objError.code === "notExists")) {
              console.log(`[ssu-poller] SSU ${ssu.ssuId} no longer exists on-chain — cascade deleting`);
              deleteSsu(ssu.ssuId, ssu.tribeId);
              continue;
            }

            // Sync on-chain name → hubName
            // The name lives at content.fields.metadata.fields.name (Metadata struct)
            const metaFields = (objData.content?.fields as Record<string, unknown>)?.metadata as
              { fields?: { name?: string } } | undefined;
            const onChainName = metaFields?.fields?.name;
            if (
              typeof onChainName === "string" &&
              onChainName.trim() &&
              onChainName.trim() !== ssu.hubName &&
              !/^0x[0-9a-fA-F]{20,}$/.test(onChainName.trim())
            ) {
              upsertSsu({ ...ssu, hubName: onChainName.trim() });
              updateMapNodeLabelsBySsu(ssu.ssuId, onChainName.trim());
              console.log(`[ssu-poller] Updated hubName for ${ssu.ssuId}: "${onChainName.trim()}"`);
            }
          } catch (err) {
            // Network errors are non-fatal — skip this cycle
            console.warn(`[ssu-poller] Failed to check SSU ${ssu.ssuId}:`, (err as Error).message);
          }
        }
      }

      // Start polling after a short delay to let the server boot
      let ssuPollTimer: ReturnType<typeof setInterval> | null = null;
      setTimeout(() => {
        checkSsuHealth(); // initial check
        ssuPollTimer = setInterval(checkSsuHealth, SSU_POLL_INTERVAL);
      }, 5_000);

      // Clean up on server close
      server.httpServer?.on("close", () => {
        if (ssuPollTimer) clearInterval(ssuPollTimer);
      });

      // ── Security headers for all API responses ──
      server.middlewares.use("/api", (_req, res, next) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        next();
      });

      // ── SSU list (normalised) ──
      server.middlewares.use("/api/ssu-list", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(getAllSsus()));
      });
      // ── SSU registration (normalised) ──
      server.middlewares.use("/api/ssu", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          // Support lookup by ssuId only (no tribeId) to find the SSU's owning tribe
          const result = tribeId ? getSsu(ssuId, tribeId) : getSsuBySsuId(ssuId);
          res.end(JSON.stringify(result));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              upsertSsu({
                ssuId: data.ssuId ?? ssuId,
                tribeId: String(data.tribeId ?? tribeId),
                hubName: data.hubName ?? "",
                tribeName: data.tribeName ?? "",
                activatedAt: data.activatedAt ?? new Date().toISOString(),
                activatedBy: data.activatedBy ?? "",
                characterName: data.characterName ?? "",
                vaultObjectId: data.vaultObjectId ?? "",
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        if (req.method === "DELETE") {
          deleteSsu(ssuId, tribeId);
          console.log(`[api/ssu] Cascade-deleted SSU ${ssuId} (tribe ${tribeId})`);
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Plutarch SSU deletion (owner-verified) ──
      // Preview: returns members with positive balances before deletion
      server.middlewares.use("/api/ssu-delete-preview", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const targetSsuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const wallet = url.searchParams.get("wallet") ?? "";
        if (!targetSsuId || !tribeId || !wallet) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing ssuId, tribeId, or wallet" }));
          return;
        }
        const ssu = getSsu(targetSsuId, tribeId);
        if (!ssu) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "SSU not found in database" }));
          return;
        }
        if (ssu.activatedBy.toLowerCase() !== wallet.toLowerCase()) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "You are not the owner of this SSU" }));
          return;
        }
        // Get members of the target SSU and their tribe-wide balances
        const memberRows = getMembers(targetSsuId, tribeId);
        const membersWithBalances = memberRows
          .map((m) => ({ address: m.address, name: m.name, balance: getBalance(tribeId, m.address) }))
          .filter((m) => m.balance > 0);
        res.end(JSON.stringify({ ssu, members: membersWithBalances }));
      });

      server.middlewares.use("/api/ssu-delete", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const data = deepSanitise(JSON.parse(body));
            const targetSsuId = data.ssuId;
            const tribeId = data.tribeId;
            const wallet = data.wallet;
            if (!targetSsuId || !tribeId || !wallet) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing ssuId, tribeId, or wallet" }));
              return;
            }
            const ssu = getSsu(targetSsuId, tribeId);
            if (!ssu) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "SSU not found in database" }));
              return;
            }
            if (ssu.activatedBy.toLowerCase() !== wallet.toLowerCase()) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: "You are not the owner of this SSU" }));
              return;
            }
            deleteSsu(targetSsuId, tribeId);
            // Zero out balances for members whose credits were transferred on-chain
            const settledWallets: string[] = Array.isArray(data.settledWallets) ? data.settledWallets : [];
            for (const w of settledWallets) {
              const current = getBalance(tribeId, String(w));
              if (current > 0) adjustBalance(tribeId, String(w), -current);
            }
            console.log(`[api/ssu-delete] Owner-verified cascade-delete SSU ${targetSsuId} (tribe ${tribeId}) by ${wallet}, settled ${settledWallets.length} wallets`);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      });
      // ── Goals (normalised) ──
      server.middlewares.use("/api/goals", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          const rows = getGoals(ssuId, tribeId);
          // Map to the serialised shape the client expects
          const serialised = rows.map((g) => ({
            id: g.id, type: g.type, description: g.description,
            budget: g.budget, tierPercents: g.tierPercents,
            status: g.status, budgetAwarded: g.budgetAwarded,
            startedAt: g.startedAt,
            ongoing: g.ongoing,
            cycleCount: g.cycleCount,
            cycleStartedAt: g.cycleStartedAt,
            acquireRewards: g.acquireRewards,
            missions: g.missions.map((m) => ({
              phase: m.phase, tier: m.tier, description: m.description,
              quantity: m.quantity, typeId: m.typeId,
              isAlternative: m.isAlternative,
              altReason: m.altReason,
              inputItem: m.inputItem,
            })),
            publishedMissions: g.missions.filter((m) => m.isPublished).map((m) => m.idx),
            completed: g.missions
              .filter((m) => m.completedQty > 0)
              .map((m) => [m.idx, m.completedQty]),
            missionWings: Object.fromEntries(
              g.missions
                .filter((m) => m.wingIds.length > 0)
                .map((m) => [String(m.idx), m.wingIds]),
            ),
          }));
          res.end(JSON.stringify({ goals: serialised }));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { goals: clientGoals } = deepSanitise(JSON.parse(body));
              if (!Array.isArray(clientGoals)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need goals array" }));
                return;
              }
              // Convert client serialised format → GoalRow[]
              const goalRows = clientGoals.map((g: Record<string, unknown>) => {
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
                  ongoing: Boolean(g.ongoing),
                  cycleCount: Number(g.cycleCount) || 0,
                  cycleStartedAt: g.cycleStartedAt != null ? Number(g.cycleStartedAt) : null,
                  acquireRewards: Array.isArray(g.acquireRewards) ? g.acquireRewards as [number, number][] : null,
                  missions: rawMissions.map((m: Record<string, unknown>, idx: number) => ({
                    idx,
                    phase: String(m.phase ?? "GATHER"),
                    tier: Number(m.tier) || 1,
                    description: String(m.description ?? ""),
                    quantity: Number(m.quantity) || 0,
                    typeId: m.typeId != null ? Number(m.typeId) : null,
                    isAlternative: Boolean(m.isAlternative),
                    altReason: m.altReason != null ? String(m.altReason) : null,
                    inputItem: m.inputItem != null ? String(m.inputItem) : null,
                    isPublished: publishedSet.has(idx),
                    completedQty: completedMap.get(idx) ?? 0,
                    wingIds: missionWingsRaw[String(idx)] ?? [],
                  })),
                };
              });
              setGoals(ssuId, tribeId, goalRows);
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Deployment config (normalised) ──
      server.middlewares.use("/api/deployment", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const tribeId = url.searchParams.get("tribeId") ?? "default";
        if (req.method === "GET") {
          res.end(JSON.stringify(getDeployment(tribeId)));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              setDeployment(tribeId, {
                packageId: data.packageId ?? "",
                registryId: data.registryId ?? "",
                creditCoinType: data.creditCoinType ?? "",
                creditMetadataId: data.creditMetadataId ?? "",
                coinPackageId: data.coinPackageId ?? "",
                systemManagerCapId: data.systemManagerCapId ?? "",
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Database backup / restore ──
      server.middlewares.use("/api/backup", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET") {
          const data = exportDatabase();
          res.end(JSON.stringify(data));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              if (typeof data !== "object" || data === null) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Expected JSON object" }));
                return;
              }
              const result = importDatabase(data);
              res.end(JSON.stringify({ ok: true, ...result }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── All tribes listing ──
      server.middlewares.use("/api/tribes", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET") {
          res.end(JSON.stringify(getAllTribes()));
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Price history snapshots ──
      server.middlewares.use("/api/price-history", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          if (tribeId) {
            res.end(JSON.stringify(getPriceHistory(tribeId)));
          } else {
            res.end(JSON.stringify(getLatestPriceSnapshots()));
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              if (!data.tribeId || typeof data.eveBacking !== "number") {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need tribeId, eveBacking, creditSupply, backingRatio" }));
                return;
              }
              insertPriceSnapshot({
                tribeId: data.tribeId,
                eveBacking: data.eveBacking,
                creditSupply: data.creditSupply,
                backingRatio: data.backingRatio,
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Tribe coin limit orders ──
      server.middlewares.use("/api/tribe-orders", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const action = url.searchParams.get("action"); // place | cancel
        const wallet = url.searchParams.get("wallet");
        const sourceTribeId = url.searchParams.get("sourceTribeId") ?? "";
        const targetTribeId = url.searchParams.get("targetTribeId") ?? "";
        if (req.method === "GET") {
          if (wallet) {
            res.end(JSON.stringify(getWalletTribeCoinOrders(wallet)));
          } else if (sourceTribeId && targetTribeId) {
            res.end(JSON.stringify(getTribeCoinOrders(sourceTribeId, targetTribeId)));
          } else {
            res.end(JSON.stringify([]));
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              if (action === "place") {
                insertTribeCoinOrder({
                  id: data.id ?? `tco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  wallet: data.wallet ?? "",
                  playerName: data.playerName ?? "",
                  sourceTribeId: data.sourceTribeId ?? "",
                  targetTribeId: data.targetTribeId ?? "",
                  side: data.side ?? "buy",
                  quantity: Number(data.quantity) || 0,
                  limitRate: Number(data.limitRate) || 0,
                  status: "open",
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "cancel") {
                updateTribeCoinOrderStatus(data.id, "cancelled");
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Unknown action" }));
              }
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Per-tribe off-chain earned balances (normalised) ──
      server.middlewares.use("/api/balance", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const tribeId = url.searchParams.get("tribeId") ?? "default";
        const wallet = url.searchParams.get("wallet");

        if (req.method === "GET") {
          if (wallet) {
            res.end(JSON.stringify({ balance: getBalance(tribeId, wallet) }));
          } else {
            res.end(JSON.stringify(getAllBalances(tribeId)));
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { wallet: w, delta } = deepSanitise(JSON.parse(body));
              if (!w || typeof delta !== "number") {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need wallet and delta" }));
                return;
              }
              const newBal = adjustBalance(tribeId, w, delta);
              res.end(JSON.stringify({ balance: newBal }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Marketplace (normalised) ──
      server.middlewares.use("/api/market", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const action = url.searchParams.get("action"); // place | cancel | fill

        if (req.method === "GET") {
          const orders = getMarketOrders(ssuId, tribeId).map((o) => {
            const base = {
              id: o.id, side: o.side, wallet: o.wallet, playerName: o.playerName,
              itemTypeId: o.itemTypeId, itemName: o.itemName, quantity: o.quantity,
              pricePerUnit: o.pricePerUnit, fee: o.fee, escrowTotal: o.escrowTotal,
              status: o.status, createdAt: o.createdAt,
              tribeId: o.tribeId,
              visibility: (o as Record<string, unknown>).visibility as string ?? "tribal",
              packageId: (o as Record<string, unknown>).packageId as string | null ?? null,
              packageItems: undefined as { itemTypeId: number; itemName: string; quantity: number }[] | undefined,
            };
            if (base.packageId) {
              base.packageItems = getPackageItemsByOrderId(o.id).map((pi) => ({
                itemTypeId: pi.itemTypeId,
                itemName: pi.itemName,
                quantity: pi.quantity,
              }));
            }
            return base;
          });
          const history = getMarketHistory(ssuId, tribeId).map((h) => ({
            id: h.id, side: h.side, buyer: h.buyer, seller: h.seller,
            itemTypeId: h.itemTypeId, itemName: h.itemName, quantity: h.quantity,
            pricePerUnit: h.pricePerUnit, fee: h.fee, completedAt: h.completedAt,
          }));
          res.end(JSON.stringify({ orders, history }));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              if (action === "place") {
                const visibility = String(data.visibility ?? "tribal");
                insertMarketOrder({ ...data, ssuId, tribeId, visibility });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "cancel") {
                const { orderId, wallet: w, refund } = data;
                runTransaction(() => {
                  // If this order was for a package, reset the package back to "created"
                  const cancelledOrder = getMarketOrderById(orderId);
                  const cancelledPkgId = (cancelledOrder as Record<string, unknown> | undefined)?.packageId as string | undefined;
                  if (cancelledPkgId) {
                    updatePackageStatus(cancelledPkgId, "created", null);
                  }
                  updateMarketOrderStatus(orderId, "cancelled");
                  if (refund && w) adjustBalance(tribeId, w, refund);
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "fill") {
                runTransaction(() => {
                  updateMarketOrderStatus(data.orderId, "filled");
                  if (data.balanceOps) {
                    for (const op of data.balanceOps) {
                      adjustBalance(op.tribeId ?? tribeId, op.wallet, op.delta);
                    }
                  }
                  insertMarketHistory({ ...data.historyEntry, ssuId, tribeId });
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "partial-fill") {
                runTransaction(() => {
                  updateMarketOrderAfterPartialFill(
                    data.orderId,
                    data.remainingQuantity,
                    data.remainingFee,
                    data.remainingEscrow,
                  );
                  if (data.balanceOps) {
                    for (const op of data.balanceOps) {
                      adjustBalance(op.tribeId ?? tribeId, op.wallet, op.delta);
                    }
                  }
                  insertMarketHistory({ ...data.historyEntry, ssuId, tribeId });
                });
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Unknown action. Use ?action=place|cancel|fill" }));
              }
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Contracts (bounties) ──
      server.middlewares.use("/api/contracts", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const action = url.searchParams.get("action");

        if (req.method === "GET") {
          const rows = getContracts(ssuId, tribeId);
          // Enrich contracts with creator's coin type + delivery metadata
          const enriched = rows.map((c: any) => {
            const creatorDep = getDeployment(c.tribeId);
            const result: any = { ...c, creatorCoinType: creatorDep?.creditCoinType ?? "" };
            if (c.type === "Deliver") {
              const dels = getDeliveriesBySource("contract", c.id);
              result.delivery = dels[0] ?? null;
              result.couriers = dels[0] ? getDeliveryCouriers(dels[0].id) : [];
            }
            return result;
          });
          res.end(JSON.stringify({ contracts: enriched }));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              if (action === "create") {
                runTransaction(() => {
                  const total = Number(data.budget) + Number(data.taxPaid);
                  const fromOnChain = Math.max(0, Math.min(total, Number(data.fromOnChain) || 0));
                  const offChainDebit = total - fromOnChain;
                  if (offChainDebit > 0) adjustBalance(tribeId, data.creatorWallet, -offChainDebit);
                  insertContract({ ...data, ssuId, tribeId });

                  // If this is a Deliver contract, also create a delivery record
                  if (data.type === "Deliver" && data.deliveryItems && data.destinationSsuId) {
                    // Prevent assigning a package to multiple deliveries
                    if (data.packageId) {
                      const existing = getActiveDeliveryByPackage(data.packageId);
                      if (existing) throw new Error("This package is already assigned to an active delivery");
                    }
                    const deliveryId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    // Snapshot package metadata so we can recreate at destination after source is deleted
                    const srcPkg = data.packageId ? getPackageById(data.packageId) : null;
                    insertDelivery({
                      id: deliveryId,
                      sourceType: "contract",
                      sourceId: data.id,
                      ssuId,
                      tribeId,
                      destinationSsuId: data.destinationSsuId,
                      destinationTribeId: data.destinationTribeId ?? tribeId,
                      destinationLabel: data.destinationLabel ?? "",
                      packageId: data.packageId ?? undefined,
                      packageName: srcPkg?.name,
                      packageShipType: srcPkg?.shipType,
                      packageFittingText: srcPkg?.fittingText,
                      packageCreatedBy: srcPkg?.createdBy,
                      items: data.deliveryItems,
                      collateral: Number(data.collateral) || 0,
                      timerMs: Number(data.missionDurationMs) || 86_400_000,
                      status: "pending",
                    });
                  }
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "cancel") {
                runTransaction(() => {
                  const c = getContractById(data.contractId);
                  if (!c || c.status !== "open") throw new Error("Cannot cancel");
                  updateContractStatus(data.contractId, "cancelled");
                  // refund budget (tax already deducted)
                  adjustBalance(tribeId, c.creatorWallet, c.budget);
                  // Cancel linked delivery records
                  if (c.type === "Deliver") {
                    const dels = getDeliveriesBySource("contract", c.id);
                    for (const d of dels) {
                      if (d.status === "pending") updateDeliveryStatus(d.id, "cancelled");
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "accept") {
                runTransaction(() => {
                  const c = getContractById(data.contractId);
                  if (!c || c.status !== "open") throw new Error("Cannot accept");
                  if (c.creatorWallet === data.wallet) throw new Error("Cannot accept own contract");
                  const deposit = Number(data.deposit);
                  adjustBalance(tribeId, data.wallet, -deposit);
                  acceptContract(data.contractId, data.wallet, data.playerName, deposit);

                  // If this is a Deliver contract, also accept the linked delivery
                  if (c.type === "Deliver") {
                    const dels = getDeliveriesBySource("contract", c.id);
                    for (const d of dels) {
                      if (d.status === "pending") {
                        addDeliveryCourier({
                          deliveryId: d.id,
                          courierWallet: data.wallet,
                          courierName: data.playerName ?? "",
                          itemsDistributed: d.items,
                        });
                        updateDeliveryStatus(d.id, "in-transit");
                      }
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "progress") {
                runTransaction(() => {
                  const c = getContractById(data.contractId);
                  if (!c || c.status !== "accepted") throw new Error("Cannot progress");
                  progressContractMission(data.contractId, data.missionIdx, data.quantity);
                  if (data.typeId && data.itemName) {
                    addContractItemEscrow(data.contractId, data.missionIdx, data.typeId, data.itemName, data.quantity);
                  }
                  // check auto-complete
                  if (isContractFullyCompleted(data.contractId)) {
                    updateContractStatus(data.contractId, "completed", { completedAt: Date.now() });
                    // acceptor gets budget + their deposit back
                    adjustBalance(tribeId, c.acceptorWallet!, c.budget + c.acceptorDeposit);
                    clearContractItemEscrow(data.contractId);
                  }
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "fail") {
                runTransaction(() => {
                  const c = getContractById(data.contractId);
                  if (!c || c.status !== "accepted") throw new Error("Cannot fail");
                  updateContractStatus(data.contractId, "failed");
                  // creator gets budget + acceptor's deposit (compensation)
                  adjustBalance(tribeId, c.creatorWallet, c.budget + c.acceptorDeposit);
                  clearContractItemEscrow(data.contractId);
                  // Fail linked delivery records for Deliver contracts
                  if (c.type === "Deliver") {
                    const dels = getDeliveriesBySource("contract", c.id);
                    for (const d of dels) {
                      if (d.status !== "completed" && d.status !== "failed") {
                        updateDeliveryStatus(d.id, "failed");
                        const couriers = getDeliveryCouriers(d.id);
                        for (const cr of couriers) {
                          if (cr.status === "in-transit") updateCourierStatus(cr.id, "failed");
                        }
                      }
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "expire") {
                runTransaction(() => {
                  const c = getContractById(data.contractId);
                  if (!c || c.status !== "open") throw new Error("Cannot expire");
                  updateContractStatus(data.contractId, "expired");
                  // refund budget (tax already deducted)
                  adjustBalance(tribeId, c.creatorWallet, c.budget);
                });
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Unknown action" }));
              }
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ═══════════════════════════════════════════════════════════════════
      // Delivery API — delivery mission creation, courier tracking, progress
      // ═══════════════════════════════════════════════════════════════════
      server.middlewares.use("/api/deliveries", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const action = url.searchParams.get("action");

        if (req.method === "GET") {
          try {
            const mode = url.searchParams.get("mode");
            if (mode === "destination") {
              // Get deliveries targeting this SSU
              const rows = getDeliveriesByDestination(ssuId);
              const enriched = rows.map((d) => ({ ...d, couriers: getDeliveryCouriers(d.id) }));
              res.end(JSON.stringify({ deliveries: enriched }));
            } else if (mode === "courier") {
              // Get deliveries this wallet is courier for
              const wallet = url.searchParams.get("wallet") ?? "";
              const courierJobs = getDeliveryCouriersByWallet(wallet);
              const enriched = courierJobs.map((c) => ({ ...c, delivery: getDelivery(c.deliveryId) }));
              res.end(JSON.stringify({ courierJobs: enriched }));
            } else {
              // Get deliveries from this SSU
              const rows = getDeliveriesBySsu(ssuId, tribeId);
              const enriched = rows.map((d) => ({ ...d, couriers: getDeliveryCouriers(d.id) }));
              res.end(JSON.stringify({ deliveries: enriched }));
            }
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              if (action === "create") {
                // Create a delivery record linked to a goal or contract
                const items: DeliveryItem[] = data.items;
                if (!items || items.length === 0) throw new Error("No items specified");
                if (!data.destinationSsuId) throw new Error("No destination SSU specified");
                // Prevent assigning a package to multiple deliveries
                if (data.packageId) {
                  const existing = getActiveDeliveryByPackage(data.packageId);
                  if (existing) throw new Error("This package is already assigned to an active delivery");
                }
                const id = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                // Snapshot package metadata so we can recreate at destination after source is deleted
                const srcPkg = data.packageId ? getPackageById(data.packageId) : null;
                insertDelivery({
                  id,
                  sourceType: data.sourceType ?? "goal",
                  sourceId: String(data.sourceId ?? ""),
                  ssuId,
                  tribeId,
                  destinationSsuId: data.destinationSsuId,
                  destinationTribeId: data.destinationTribeId ?? tribeId,
                  destinationLabel: data.destinationLabel ?? "",
                  packageId: data.packageId ?? undefined,
                  packageName: srcPkg?.name,
                  packageShipType: srcPkg?.shipType,
                  packageFittingText: srcPkg?.fittingText,
                  packageCreatedBy: srcPkg?.createdBy,
                  items,
                  collateral: Number(data.collateral) || 0,
                  timerMs: Number(data.timerMs) || 86_400_000,
                  status: "pending",
                });
                res.end(JSON.stringify({ ok: true, deliveryId: id }));

              } else if (action === "accept") {
                // Courier accepts a delivery — items distributed to their ephemeral
                runTransaction(() => {
                  const d = getDelivery(data.deliveryId);
                  if (!d) throw new Error("Delivery not found");
                  if (d.status !== "pending" && d.status !== "in-transit") throw new Error("Delivery not available");

                  // For contract deliveries: only one courier allowed
                  if (d.sourceType === "contract") {
                    const existing = getDeliveryCouriers(d.id);
                    if (existing.length > 0) throw new Error("Contract delivery already accepted");
                    // Deduct collateral from courier
                    if (d.collateral > 0) {
                      adjustBalance(tribeId, data.wallet, -d.collateral);
                    }
                  }

                  addDeliveryCourier({
                    deliveryId: d.id,
                    courierWallet: data.wallet,
                    courierName: data.playerName ?? "",
                    itemsDistributed: d.items, // Full item list distributed
                    claimDigest: data.claimDigest ?? undefined,
                  });

                  if (d.status === "pending") {
                    updateDeliveryStatus(d.id, "in-transit");
                  }

                  // Delete source package immediately — it's been picked up
                  if (d.packageId) {
                    const srcPkg = getPackageById(d.packageId);
                    if (srcPkg) {
                      deletePackage(d.packageId);
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));

              } else if (action === "claim") {
                // Courier records a claim TX digest after picking up items at source SSU
                runTransaction(() => {
                  const d = getDelivery(data.deliveryId);
                  if (!d) throw new Error("Delivery not found");
                  if (d.status !== "in-transit") throw new Error("Delivery not in transit");

                  const couriers = getDeliveryCouriers(d.id);
                  const courier = couriers.find((c) => c.courierWallet === data.wallet && c.status === "in-transit");
                  if (!courier) throw new Error("You are not an active courier for this delivery");
                  if (!data.claimDigest) throw new Error("Missing claim digest");

                  updateCourierClaimDigest(courier.id, data.claimDigest);

                  // Delete source package immediately — it's been picked up
                  if (d.packageId) {
                    const srcPkg = getPackageById(d.packageId);
                    if (srcPkg) {
                      deletePackage(d.packageId);
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));

              } else if (action === "progress") {
                // Courier deposits items at destination SSU
                runTransaction(() => {
                  const d = getDelivery(data.deliveryId);
                  if (!d) throw new Error("Delivery not found");
                  if (d.status !== "in-transit") throw new Error("Delivery not in transit");

                  const couriers = getDeliveryCouriers(d.id);
                  const courier = couriers.find((c) => c.courierWallet === data.wallet && c.status === "in-transit");
                  if (!courier) throw new Error("You are not an active courier for this delivery");

                  // Merge deposited items
                  const deposited = [...courier.itemsDeposited];
                  for (const item of (data.items as DeliveryItem[])) {
                    const existing = deposited.find((i) => i.typeId === item.typeId);
                    if (existing) {
                      existing.quantity += item.quantity;
                    } else {
                      deposited.push({ ...item });
                    }
                  }
                  updateCourierDeposit(courier.id, deposited);

                  // Check if this courier has delivered everything
                  const distributed = courier.itemsDistributed;
                  const courierDone = distributed.every((di) => {
                    const dep = deposited.find((d) => d.typeId === di.typeId);
                    return dep && dep.quantity >= di.quantity;
                  });
                  if (courierDone) {
                    updateCourierStatus(courier.id, "delivered");
                  }
                  console.log(`[delivery-progress] Delivery ${d.id}: courierDone=${courierDone}, deposited=${JSON.stringify(deposited)}`);

                  // Check if the entire delivery is complete
                  const fullyDeposited = isDeliveryFullyDeposited(d.id);
                  console.log(`[delivery-progress] fullyDeposited=${fullyDeposited}`);
                  if (fullyDeposited) {
                    // Verify all delivery items are fully deposited across all couriers
                    console.log(`[delivery-progress] Delivery ${d.id} fully deposited. packageId=${d.packageId ?? "none"}, destSSU=${d.destinationSsuId}`);
                    if (d.packageId) {
                      const allCouriers = getDeliveryCouriers(d.id);
                      const totalDeposited = new Map<number, number>();
                      for (const c of allCouriers) {
                        for (const item of c.itemsDeposited) {
                          totalDeposited.set(item.typeId, (totalDeposited.get(item.typeId) ?? 0) + item.quantity);
                        }
                      }
                      const manifestMet = d.items.every((it) =>
                        (totalDeposited.get(it.typeId) ?? 0) >= it.quantity,
                      );
                      console.log(`[delivery-progress] Manifest check: ${manifestMet ? "MET" : "NOT MET"}`, Object.fromEntries(totalDeposited), d.items.map((it) => ({ typeId: it.typeId, need: it.quantity })));
                      if (!manifestMet) {
                        return;
                      }
                    }

                    updateDeliveryStatus(d.id, "delivered");

                    // Recreate package at destination owned by the receiving tribe
                    if (d.packageId && d.destinationSsuId) {
                      // Look up the actual tribe that owns the destination SSU
                      const destSsuReg = getSsuBySsuId(d.destinationSsuId);
                      const destTribe = destSsuReg?.tribeId ?? d.destinationTribeId;
                      const destPkgId = `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                      insertPackage(
                        {
                          id: destPkgId,
                          ssuId: d.destinationSsuId,
                          tribeId: destTribe,
                          name: d.packageName ?? "Delivered Package",
                          shipType: d.packageShipType ?? "",
                          fittingText: d.packageFittingText ?? "",
                          createdBy: d.packageCreatedBy ?? "",
                          status: "created",
                          marketOrderId: null,
                        },
                        d.items.map((it) => ({
                          itemTypeId: it.typeId,
                          itemName: it.itemName,
                          quantity: it.quantity,
                          slotType: "",
                        })),
                      );
                      // Claim delivered items into destination corporate storage
                      for (const item of d.items) {
                        addCorporateInventory(d.destinationSsuId, destTribe, item.typeId, item.itemName, item.quantity);
                      }
                      console.log(`[delivery-progress] ✓ Recreated package as ${destPkgId} at SSU=${d.destinationSsuId} tribe=${destTribe}`);
                    } else {
                      console.log(`[delivery-progress] Skipped package recreation: packageId=${d.packageId ?? "none"}, destSSU=${d.destinationSsuId ?? "none"}`);
                    }

                    // Handle rewards
                    if (d.sourceType === "contract") {
                      const c = getContractById(d.sourceId);
                      if (c && c.status === "accepted") {
                        updateContractStatus(d.sourceId, "completed", { completedAt: Date.now() });
                        // Return collateral + reward to courier in the SOURCE tribe's currency
                        adjustBalance(d.tribeId, c.acceptorWallet!, c.budget + c.acceptorDeposit);
                        clearContractItemEscrow(d.sourceId);
                      }
                    }

                    // For goal deliveries: complete missions and reward all couriers proportionally
                    if (d.sourceType === "goal") {
                      completeDeliveryGoal(d);
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));

              } else if (action === "fail") {
                runTransaction(() => {
                  const d = getDelivery(data.deliveryId);
                  if (!d) throw new Error("Delivery not found");
                  updateDeliveryStatus(d.id, "failed");

                  // Fail all active couriers
                  const couriers = getDeliveryCouriers(d.id);
                  for (const c of couriers) {
                    if (c.status === "in-transit") updateCourierStatus(c.id, "failed");
                  }

                  // For contracts: collateral goes to creator
                  if (d.sourceType === "contract") {
                    const contract = getContractById(d.sourceId);
                    if (contract && contract.status === "accepted") {
                      updateContractStatus(d.sourceId, "failed");
                      adjustBalance(tribeId, contract.creatorWallet, contract.budget + contract.acceptorDeposit);
                      clearContractItemEscrow(d.sourceId);
                    }
                  }
                });
                res.end(JSON.stringify({ ok: true }));

              } else if (action === "cancel") {
                runTransaction(() => {
                  const d = getDelivery(data.deliveryId);
                  if (!d) throw new Error("Delivery not found");
                  if (d.status !== "pending") throw new Error("Can only cancel pending deliveries");
                  updateDeliveryStatus(d.id, "cancelled");
                });
                res.end(JSON.stringify({ ok: true }));

              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Unknown action" }));
              }
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // Recipe database (global, not tribe-scoped)
      server.middlewares.use("/api/recipes", (req, res) => {
        handleJsonApi(req, res, "recipes-store", "id", { construction: [], industry: [], refining: [] });
      });
      // ── Tribe settings (normalised) ──
      server.middlewares.use("/api/tribe-settings", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const tribeId = url.searchParams.get("tribeId") ?? "default";
        if (req.method === "GET") {
          res.end(JSON.stringify(getTribeSettings(tribeId)));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              setTribeSettings(tribeId, Number(data.taxBps) || 0);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Wings (normalised) ──
      server.middlewares.use("/api/wings", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          res.end(JSON.stringify({ wings: getWings(ssuId, tribeId) }));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { wings: wList } = deepSanitise(JSON.parse(body));
              if (!Array.isArray(wList)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need wings array" }));
                return;
              }
              setWings(ssuId, tribeId, wList);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Members (normalised) ──
      server.middlewares.use("/api/members", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          res.end(JSON.stringify({ members: getMembers(ssuId, tribeId) }));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { members: mList } = deepSanitise(JSON.parse(body));
              if (!Array.isArray(mList)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need members array" }));
                return;
              }
              setMembers(ssuId, tribeId, mList);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Ledger (normalised, append-only) ──
      server.middlewares.use("/api/ledger", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";

        if (req.method === "GET") {
          const rows = getLedgerEntries(ssuId, tribeId);
          const entries = rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : r.timestamp,
            eventType: r.eventType,
            goalId: r.goalId ?? undefined,
            goalType: r.goalType ?? undefined,
            goalDescription: r.goalDescription ?? undefined,
            missionIdx: r.missionIdx ?? undefined,
            missionPhase: r.missionPhase ?? undefined,
            missionItem: r.missionItem ?? undefined,
            amount: r.amount ?? undefined,
          }));
          res.end(JSON.stringify({ entries }));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { entries } = deepSanitise(JSON.parse(body));
              if (!Array.isArray(entries)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need entries array" }));
                return;
              }
              insertLedgerEntries(ssuId, tribeId, entries);
              res.end(JSON.stringify({ ok: true, inserted: entries.length }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
      // ── Allocations (normalised) ──
      server.middlewares.use("/api/corporate-inventory", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          const mode = url.searchParams.get("mode");
          if (mode === "all") {
            res.end(JSON.stringify({ items: getAllCorporateInventory(ssuId) }));
          } else {
            res.end(JSON.stringify({ items: getCorporateInventory(ssuId, tribeId) }));
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const action = data.action as string;
              if (action === "claim") {
                addCorporateInventory(ssuId, tribeId, data.typeId, data.itemName, data.quantity);
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "release") {
                removeCorporateInventory(ssuId, tribeId, data.typeId, data.quantity);
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Unknown action" }));
              }
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      server.middlewares.use("/api/allocations", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          res.end(JSON.stringify({ allocations: getAllocations(ssuId, tribeId) }));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const { allocations: aList } = deepSanitise(JSON.parse(body));
              if (!Array.isArray(aList)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Need allocations array" }));
                return;
              }
              setAllocations(ssuId, tribeId, aList);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Solar System Lookup (DB-cached from World API) ──
      async function ensureSolarSystemsLoaded(): Promise<void> {
        const count = getSolarSystemCount();
        if (count > 0) return; // already populated
        console.log("[solar-systems] Table empty — fetching from World API…");
        const worldApi = TENANTS[tenantId].worldApi;
        type ApiSystem = { id: number; name: string; constellationId: number; regionId: number; location: { x: number; y: number; z: number } };
        const allSystems: ApiSystem[] = [];
        let offset = 0;
        const pageSize = 1000;
        while (true) {
          const apiRes = await fetch(`${worldApi}/v2/solarsystems?limit=${pageSize}&offset=${offset}`);
          if (!apiRes.ok) throw new Error(`World API returned ${apiRes.status}`);
          const body = await apiRes.json() as { data: ApiSystem[]; metadata: { total: number } };
          allSystems.push(...body.data);
          if (allSystems.length >= body.metadata.total || body.data.length < pageSize) break;
          offset += pageSize;
        }
        bulkInsertSolarSystems(allSystems.map((s) => ({
          id: s.id,
          name: s.name,
          locationX: s.location.x,
          locationY: s.location.y,
          locationZ: s.location.z,
          constellationId: s.constellationId,
          regionId: s.regionId,
        })));
        console.log(`[solar-systems] Stored ${allSystems.length} solar systems in DB`);
      }

      server.middlewares.use("/api/solar-system-lookup", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const name = (url.searchParams.get("name") ?? "").trim();
        if (!name) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing 'name' query parameter" }));
          return;
        }
        try {
          await ensureSolarSystemsLoaded();
          const match = findSolarSystemByName(name);
          if (!match) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `Solar system "${name}" not found` }));
            return;
          }
          res.end(JSON.stringify({
            solarSystemId: String(match.id),
            solarSystemName: match.name,
            locationX: match.locationX,
            locationY: match.locationY,
            locationZ: match.locationZ,
          }));
        } catch (err) {
          console.error("[api/solar-system-lookup] error:", err);
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "Failed to look up solar system" }));
        }
      });

      // ── SSU Location ──
      server.middlewares.use("/api/ssu-location", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          try {
            res.end(JSON.stringify(getSsuLocation(ssuId, tribeId) ?? null));
          } catch (err) {
            console.error("[api/ssu-location] GET error:", err);
            res.end(JSON.stringify(null));
          }
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              upsertSsuLocation({
                ssuId: data.ssuId ?? ssuId,
                tribeId: String(data.tribeId ?? tribeId),
                solarSystemId: String(data.solarSystemId ?? ""),
                solarSystemName: String(data.solarSystemName ?? ""),
                locationX: Number(data.locationX) || 0,
                locationY: Number(data.locationY) || 0,
                locationZ: Number(data.locationZ) || 0,
                pNum: String(data.pNum ?? ""),
                lNum: String(data.lNum ?? ""),
                createdBy: String(data.createdBy ?? ""),
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Tribe Locations (territory) ──
      server.middlewares.use("/api/tribe-locations", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const wallet = url.searchParams.get("wallet") ?? "";
        const localSsuId = url.searchParams.get("ssuId") ?? "";

        const result: Record<string, unknown>[] = [];
        const seenIds = new Set<string>();

        // 1. Same-tribe SSUs (registered to this tribe)
        const tribeLocations = getTribeLocations(tribeId);
        const tribeSsus = getAllSsus().filter((s) => s.tribeId === tribeId);
        for (const ssu of tribeSsus) {
          const loc = tribeLocations.find((l) => l.ssuId === ssu.ssuId);
          const settings = getNetworkSettings(ssu.ssuId, tribeId);
          const granted = wallet ? hasLocationAccess(ssu.ssuId, tribeId, wallet) : false;
          const isOwner = wallet === ssu.activatedBy;
          const canSeeLocation = isOwner || granted || settings.visibility === "public";

          seenIds.add(ssu.ssuId);
          result.push({
            ssuId: ssu.ssuId,
            hubName: ssu.hubName,
            activatedBy: ssu.activatedBy,
            characterName: ssu.characterName,
            visibility: settings.visibility,
            hasLocation: !!loc,
            locationGranted: canSeeLocation,
            solarSystemId: canSeeLocation && loc ? loc.solarSystemId : null,
            solarSystemName: canSeeLocation && loc ? loc.solarSystemName : null,
            locationX: canSeeLocation && loc ? loc.locationX : null,
            locationY: canSeeLocation && loc ? loc.locationY : null,
            locationZ: canSeeLocation && loc ? loc.locationZ : null,
            pNum: canSeeLocation && loc ? (loc.pNum ?? "") : "",
            lNum: canSeeLocation && loc ? (loc.lNum ?? "") : "",
            isExternal: false,
            isTribeMember: true,
            networkNodeId: canSeeLocation ? (settings.networkNodeId ?? null) : null,
          });
        }

        // 2. Member-owned SSUs in OTHER tribes — auto-discover SSUs activated
        //    by any tribe member wallet, even if registered under a different tribe.
        const memberAddresses = getTribeMemberAddresses(tribeId);
        // Also include activators of same-tribe SSUs (they may not be in the members table)
        const activatorSet = new Set(memberAddresses);
        for (const ssu of tribeSsus) {
          activatorSet.add(ssu.activatedBy);
        }
        const memberSsus = getSsusByActivators([...activatorSet]);
        for (const ssu of memberSsus) {
          if (seenIds.has(ssu.ssuId)) continue;
          seenIds.add(ssu.ssuId);
          const loc = getTribeLocations(ssu.tribeId).find((l) => l.ssuId === ssu.ssuId);
          const settings = getNetworkSettings(ssu.ssuId, ssu.tribeId);
          const granted = wallet ? hasLocationAccess(ssu.ssuId, ssu.tribeId, wallet) : false;
          const isOwner = wallet === ssu.activatedBy;
          // Tribe member SSUs: location is available but encrypted/restricted
          // Owner always sees; others need a grant or location request
          const canSeeLocation = isOwner || granted;

          result.push({
            ssuId: ssu.ssuId,
            hubName: ssu.hubName,
            activatedBy: ssu.activatedBy,
            characterName: ssu.characterName,
            visibility: settings.visibility,
            hasLocation: !!loc,
            locationGranted: canSeeLocation,
            solarSystemId: canSeeLocation && loc ? loc.solarSystemId : null,
            solarSystemName: canSeeLocation && loc ? loc.solarSystemName : null,
            locationX: canSeeLocation && loc ? loc.locationX : null,
            locationY: canSeeLocation && loc ? loc.locationY : null,
            locationZ: canSeeLocation && loc ? loc.locationZ : null,
            pNum: canSeeLocation && loc ? (loc.pNum ?? "") : "",
            lNum: canSeeLocation && loc ? (loc.lNum ?? "") : "",
            isExternal: false,
            isTribeMember: true,
            networkNodeId: canSeeLocation ? (settings.networkNodeId ?? null) : null,
          });
        }

        // 3. Cross-tribe public SSUs (universal discovery)
        const publicSsus = getAllPublicSsus().filter((s) => !seenIds.has(s.ssuId));
        for (const pub of publicSsus) {
          const loc = getTribeLocations(pub.tribeId).find((l) => l.ssuId === pub.ssuId);
          const granted = wallet ? hasLocationAccess(pub.ssuId, pub.tribeId, wallet) : false;
          const canSeeLocation = granted;
          seenIds.add(pub.ssuId);
          const pubSettings = getNetworkSettings(pub.ssuId, pub.tribeId);
          result.push({
            ssuId: pub.ssuId,
            hubName: pub.hubName,
            activatedBy: pub.activatedBy,
            characterName: pub.characterName,
            visibility: "public",
            hasLocation: !!loc,
            locationGranted: canSeeLocation,
            solarSystemId: canSeeLocation && loc ? loc.solarSystemId : null,
            solarSystemName: canSeeLocation && loc ? loc.solarSystemName : null,
            locationX: canSeeLocation && loc ? loc.locationX : null,
            locationY: canSeeLocation && loc ? loc.locationY : null,
            locationZ: canSeeLocation && loc ? loc.locationZ : null,
            pNum: canSeeLocation && loc ? (loc.pNum ?? "") : "",
            lNum: canSeeLocation && loc ? (loc.lNum ?? "") : "",
            isExternal: true,
            isTribeMember: false,
            networkNodeId: canSeeLocation ? (pubSettings.networkNodeId ?? null) : null,
          });
        }

        // 4. Manually-added external SSUs (may overlap with public — dedupe)
        if (localSsuId) {
          const externals = getExternalSsus(localSsuId, tribeId);
          for (const ext of externals) {
            if (seenIds.has(ext.externalSsuId)) continue;
            const foreignSsu = getAllSsus().find((s) => s.ssuId === ext.externalSsuId);
            const foreignTribe = foreignSsu?.tribeId ?? "";
            const loc = foreignTribe ? getTribeLocations(foreignTribe).find((l) => l.ssuId === ext.externalSsuId) : undefined;
            const granted = wallet && foreignTribe ? hasLocationAccess(ext.externalSsuId, foreignTribe, wallet) : false;
            seenIds.add(ext.externalSsuId);
            const extSettings = foreignTribe ? getNetworkSettings(ext.externalSsuId, foreignTribe) : null;
            result.push({
              ssuId: ext.externalSsuId,
              hubName: foreignSsu?.hubName ?? "",
              activatedBy: foreignSsu?.activatedBy ?? "",
              characterName: foreignSsu?.characterName ?? "",
              visibility: "external",
              hasLocation: !!loc,
              locationGranted: granted,
              solarSystemId: granted && loc ? loc.solarSystemId : null,
              solarSystemName: granted && loc ? loc.solarSystemName : null,
              locationX: granted && loc ? loc.locationX : null,
              locationY: granted && loc ? loc.locationY : null,
              locationZ: granted && loc ? loc.locationZ : null,
              pNum: granted && loc ? (loc.pNum ?? "") : "",
              lNum: granted && loc ? (loc.lNum ?? "") : "",
              isExternal: true,
              isTribeMember: false,
              networkNodeId: granted ? (extSettings?.networkNodeId ?? null) : null,
            });
          }
        }

        res.end(JSON.stringify(result));
        } catch (err) {
          console.error("[api/tribe-locations] Error:", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Failed to load territory data" }));
        }
      });

      // ── External SSUs (manual cross-tribe references) ──
      server.middlewares.use("/api/external-ssus", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";

        if (req.method === "GET") {
          res.end(JSON.stringify(getExternalSsus(ssuId, tribeId)));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const externalSsuId = sanitise(String(data.externalSsuId ?? ""));
              const addedBy = sanitise(String(data.addedBy ?? ""));
              if (!externalSsuId || !addedBy) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Missing externalSsuId or addedBy" }));
                return;
              }
              addExternalSsu(ssuId, tribeId, externalSsuId, addedBy);
              console.log(`[api/external-ssus] Added external SSU ${externalSsuId} to ${ssuId} (tribe ${tribeId})`);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        if (req.method === "DELETE") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const externalSsuId = sanitise(String(data.externalSsuId ?? ""));
              if (!externalSsuId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Missing externalSsuId" }));
                return;
              }
              removeExternalSsu(ssuId, tribeId, externalSsuId);
              console.log(`[api/external-ssus] Removed external SSU ${externalSsuId} from ${ssuId} (tribe ${tribeId})`);
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Network Settings ──
      server.middlewares.use("/api/network-settings", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (req.method === "GET") {
          const settings = getNetworkSettings(ssuId, tribeId);
          const blocked = getBlockedList(ssuId, tribeId);
          const whitelist = getWhitelist(ssuId, tribeId);
          const grants = getLocationGrants(ssuId, tribeId);
          res.end(JSON.stringify({ ...settings, blocked, whitelist, grants }));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              // Preserve networkNodeId if not explicitly in this request
              const existing = getNetworkSettings(data.ssuId ?? ssuId, String(data.tribeId ?? tribeId));
              upsertNetworkSettings({
                ssuId: data.ssuId ?? ssuId,
                tribeId: String(data.tribeId ?? tribeId),
                visibility: data.visibility ?? "tribal",
                locationPolicy: data.locationPolicy ?? "manual",
                budgetMode: data.budgetMode ?? "shared",
                localBudget: Number(data.localBudget) || 0,
                networkNodeId: data.networkNodeId !== undefined ? (data.networkNodeId || null) : (existing.networkNodeId ?? null),
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Record Deposit (per-SSU budget tracking) ──
      server.middlewares.use("/api/record-deposit", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const data = deepSanitise(JSON.parse(body));
            const ssuId = String(data.ssuId ?? "");
            const tribeId = String(data.tribeId ?? "");
            const creditAmount = Math.max(0, Math.floor(Number(data.creditAmount) || 0));
            if (!ssuId || !tribeId || creditAmount <= 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "ssuId, tribeId and creditAmount > 0 required" }));
              return;
            }
            incrementDepositedBudget(ssuId, tribeId, creditAmount);
            res.end(JSON.stringify({ ok: true, credited: creditAmount }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      });

      // ── Transfer Budget between SSUs ──
      server.middlewares.use("/api/transfer-budget", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const data = deepSanitise(JSON.parse(body));
            const fromSsuId = String(data.fromSsuId ?? "");
            const toSsuId = String(data.toSsuId ?? "");
            const tribeId = String(data.tribeId ?? "");
            const amount = Math.max(0, Math.floor(Number(data.amount) || 0));
            if (!fromSsuId || !toSsuId || !tribeId || amount <= 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "fromSsuId, toSsuId, tribeId and amount > 0 required" }));
              return;
            }
            if (fromSsuId === toSsuId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Cannot transfer to the same SSU" }));
              return;
            }
            const ok = transferBudget(fromSsuId, toSsuId, tribeId, amount);
            if (!ok) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Insufficient budget" }));
              return;
            }
            res.end(JSON.stringify({ ok: true, transferred: amount }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      });

      // ── Location Access Requests ──
      server.middlewares.use("/api/location-requests", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const status = url.searchParams.get("status") ?? undefined;

        if (req.method === "GET") {
          res.end(JSON.stringify(getLocationRequests(ssuId, tribeId, status)));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const action = data.action as string;

              if (action === "create") {
                // Resolve the target SSU's actual tribeId so cross-tribe requests
                // are stored under the correct tribe and visible to the owner.
                const targetSsu = getSsuBySsuId(ssuId);
                const ownerTribeId = targetSsu?.tribeId ?? tribeId;

                // Check if requester is blocked
                if (isBlocked(ssuId, ownerTribeId, data.requesterAddress, data.requesterSsuId)) {
                  res.statusCode = 403;
                  res.end(JSON.stringify({ error: "Request blocked" }));
                  return;
                }

                // Check location policy for auto-handling
                const settings = getNetworkSettings(ssuId, ownerTribeId);
                if (settings.locationPolicy === "auto-deny") {
                  res.end(JSON.stringify({ status: "auto-denied" }));
                  return;
                }
                if (settings.locationPolicy === "auto-accept") {
                  grantLocationAccess(ssuId, ownerTribeId, data.requesterAddress);
                  // Bidirectional: also grant reverse access
                  if (data.requesterSsuId) {
                    const approvingSsu = getSsu(ssuId, ownerTribeId);
                    const reqSsu = getSsuBySsuId(String(data.requesterSsuId));
                    const reqTribe = reqSsu?.tribeId ?? ownerTribeId;
                    if (approvingSsu) grantLocationAccess(String(data.requesterSsuId), reqTribe, approvingSsu.activatedBy);
                  }
                  res.end(JSON.stringify({ status: "auto-approved" }));
                  return;
                }
                if (settings.locationPolicy === "whitelist") {
                  const wl = getWhitelist(ssuId, ownerTribeId);
                  if (wl.includes(data.requesterSsuId)) {
                    grantLocationAccess(ssuId, ownerTribeId, data.requesterAddress);
                    // Bidirectional: also grant reverse access
                    const approvingSsu = getSsu(ssuId, ownerTribeId);
                    const reqSsu = getSsuBySsuId(String(data.requesterSsuId));
                    const reqTribe = reqSsu?.tribeId ?? ownerTribeId;
                    if (approvingSsu) grantLocationAccess(String(data.requesterSsuId), reqTribe, approvingSsu.activatedBy);
                    res.end(JSON.stringify({ status: "auto-approved" }));
                    return;
                  }
                  // Not whitelisted — fall through to create pending request
                }

                const id = createLocationRequest({
                  ssuId,
                  tribeId: ownerTribeId,
                  requesterAddress: String(data.requesterAddress ?? ""),
                  requesterName: String(data.requesterName ?? ""),
                  requesterSsuId: String(data.requesterSsuId ?? ""),
                });
                res.end(JSON.stringify({ id, status: "pending" }));
                return;
              }

              if (action === "resolve") {
                resolveLocationRequest(Number(data.requestId), data.status);
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "block") {
                blockEntity(ssuId, tribeId, data.address, data.blockedSsuId);
                // Also deny any pending request from this entity
                if (data.requestId) {
                  resolveLocationRequest(Number(data.requestId), "denied");
                }
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "unblock") {
                unblockEntity(ssuId, tribeId, data.address, data.blockedSsuId);
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "grant") {
                grantLocationAccess(ssuId, tribeId, String(data.wallet));
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "revoke") {
                revokeLocationAccess(ssuId, tribeId, String(data.wallet));
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "whitelist-add") {
                addToWhitelist(ssuId, tribeId, String(data.whitelistedSsuId));
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "whitelist-remove") {
                removeFromWhitelist(ssuId, tribeId, String(data.whitelistedSsuId));
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Unknown action" }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // Compile coin module — server-side (needs `sui` CLI)
      // ── Network Map API ──
      server.middlewares.use("/api/network-map", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const u = new URL(req.url ?? "/", "http://localhost");
        const tribeId = String(u.searchParams.get("tribeId") ?? "");
        if (!tribeId) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing tribeId" })); return; }

        if (req.method === "GET") {
          try {
            const nodes = getMapNodes(tribeId);
            const links = getMapLinks(tribeId);
            // Enrich links with waypoints and data-shares
            const enrichedLinks = links.map((link) => ({
              ...link,
              waypoints: getMapWaypoints(link.id),
              dataShares: getMapDataShares(link.id),
            }));
            res.end(JSON.stringify({ nodes, links: enrichedLinks }));
          } catch (e: unknown) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const action = String(data.action ?? "");

              if (action === "upsert-node") {
                const { id, ssuId, label, mapX, mapY, visibility, addedBy, solarSystemName, solarSystemId, pNum, lNum } = data;
                if (!id || !ssuId || !addedBy) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing required fields" }));
                  return;
                }
                upsertMapNode({
                  id: String(id), ssuId: String(ssuId), tribeId,
                  label: String(label ?? ""), mapX: Number(mapX ?? 0), mapY: Number(mapY ?? 0),
                  visibility: String(visibility ?? "tribal"), addedBy: String(addedBy),
                  solarSystemName: String(solarSystemName ?? ""),
                  solarSystemId: String(solarSystemId ?? ""),
                  pNum: String(pNum ?? ""),
                  lNum: String(lNum ?? ""),
                });
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "delete-node") {
                const { nodeId } = data;
                if (!nodeId) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing nodeId" })); return; }
                deleteMapNode(String(nodeId));
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "create-link") {
                const { id, fromNodeId, toNodeId, linkType, createdBy, waypoints, dataShares } = data;
                if (!id || !fromNodeId || !toNodeId || !linkType || !createdBy) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing required fields" }));
                  return;
                }
                insertMapLink(
                  { id: String(id), tribeId, fromNodeId: String(fromNodeId), toNodeId: String(toNodeId), linkType: String(linkType), createdBy: String(createdBy), rawRoute: String(data.rawRoute ?? "") },
                  (Array.isArray(waypoints) ? waypoints : []).map((wp: any, i: number) => ({
                    linkId: String(id), stepOrder: i,
                    waypointType: String(wp.waypointType ?? "warp"),
                    fromSystem: String(wp.fromSystem ?? ""), toSystem: String(wp.toSystem ?? ""),
                    fromSystemId: String(wp.fromSystemId ?? ""), toSystemId: String(wp.toSystemId ?? ""),
                    fromLpoint: String(wp.fromLpoint ?? ""), toLpoint: String(wp.toLpoint ?? ""),
                    distance: String(wp.distance ?? ""),
                  })),
                  Array.isArray(dataShares) ? dataShares.map(String) : [],
                );
                res.end(JSON.stringify({ ok: true }));
              } else if (action === "delete-link") {
                const { linkId } = data;
                if (!linkId) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing linkId" })); return; }
                deleteMapLink(String(linkId));
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
              }
            } catch (e: unknown) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      server.middlewares.use("/api/compile-coin", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const { ticker, coinName } = JSON.parse(body);
            if (!ticker || !/^[A-Za-z][A-Za-z0-9_]*$/.test(ticker)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid ticker" }));
              return;
            }
            // coinName is interpolated into Move source — strict validation required
            if (coinName != null && !/^[A-Za-z0-9 _-]{1,64}$/.test(coinName)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid coin name (alphanumeric, spaces, hyphens, max 64 chars)" }));
              return;
            }
            const result = compileCoinModule(ticker, coinName);
            res.end(JSON.stringify(result));
          } catch (e: unknown) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });

      // ── Packages (ship fittings / bundles) ──
      server.middlewares.use("/api/packages", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const ssuId = url.searchParams.get("ssuId") ?? "default";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        const action = url.searchParams.get("action");

        if (req.method === "GET") {
          const pkgs = getPackages(ssuId, tribeId);
          // For market orders that reference packages, include package items
          const orderId = url.searchParams.get("orderId");
          if (orderId) {
            const items = getPackageItemsByOrderId(orderId);
            res.end(JSON.stringify({ packageItems: items }));
            return;
          }
          res.end(JSON.stringify({ packages: pkgs }));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));

              if (action === "create") {
                const { id, name, shipType, fittingText, createdBy, items } = data;
                if (!id || !name || !createdBy || !Array.isArray(items) || items.length === 0) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing required fields" }));
                  return;
                }
                insertPackage(
                  { id, ssuId, tribeId, name, shipType: shipType ?? "", fittingText: fittingText ?? "", createdBy, status: "created", marketOrderId: null },
                  items.map((it: { itemTypeId: number; itemName: string; quantity: number; slotType?: string }) => ({
                    itemTypeId: it.itemTypeId,
                    itemName: it.itemName,
                    quantity: it.quantity,
                    slotType: it.slotType ?? "",
                  })),
                );
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "delete") {
                const { packageId } = data;
                if (!packageId) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing packageId" }));
                  return;
                }
                const pkg = getPackageById(packageId);
                if (!pkg) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: "Package not found" }));
                  return;
                }
                // If listed on market, cancel the market order too
                if (pkg.marketOrderId) {
                  updateMarketOrderStatus(pkg.marketOrderId, "cancelled");
                }
                deletePackage(packageId);
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "update-status") {
                const { packageId, status, marketOrderId } = data;
                if (!packageId || !status) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing packageId or status" }));
                  return;
                }
                updatePackageStatus(packageId, status, marketOrderId);
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              if (action === "purge") {
                // Remove packages with terminal statuses
                const purgeStatuses = new Set(["sold", "cancelled", "allocated", "dispatched", "delivered"]);
                const pkgs = getPackages(ssuId, tribeId);
                let count = 0;
                for (const pkg of pkgs) {
                  if (purgeStatuses.has(pkg.status)) {
                    deletePackage(pkg.id);
                    count++;
                  }
                }
                res.end(JSON.stringify({ ok: true, purged: count }));
                return;
              }

              if (action === "list-market") {
                const { packageId, wallet, playerName, price } = data;
                if (!packageId || !wallet || !price) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Missing required fields" }));
                  return;
                }
                const pkg = getPackageById(packageId);
                if (!pkg) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: "Package not found" }));
                  return;
                }
                if (pkg.status !== "created") {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: "Package is not in \"created\" state" }));
                  return;
                }
                const orderId = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const { taxBps } = getTribeSettings(tribeId);
                const fee = Math.round(price * (taxBps / 10000) * 100) / 100;
                runTransaction(() => {
                  insertMarketOrder({
                    id: orderId,
                    ssuId,
                    tribeId,
                    side: "sell",
                    wallet,
                    playerName: playerName ?? "Unknown",
                    itemTypeId: 0,
                    itemName: `\uD83D\uDCE6 ${pkg.name}`,
                    quantity: 1,
                    pricePerUnit: price,
                    fee,
                    escrowTotal: 0,
                    status: "active",
                    createdAt: new Date().toISOString(),
                    packageId,
                  });
                  updatePackageStatus(packageId, "listed", orderId);
                });
                res.end(JSON.stringify({ ok: true, orderId }));
                return;
              }

              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Unknown action" }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Overlay subscriptions ──
      server.middlewares.use("/api/overlay-subscriptions", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const wallet = url.searchParams.get("wallet") ?? "";
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";

        if (req.method === "GET") {
          if (!wallet || !ssuId || !tribeId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing wallet, ssuId, or tribeId" }));
            return;
          }
          res.end(JSON.stringify(getOverlaySubscriptions(wallet, ssuId, tribeId)));
          return;
        }

        if (req.method === "POST" || req.method === "DELETE") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const w = String(data.wallet ?? wallet);
              const s = String(data.ssuId ?? ssuId);
              const t = String(data.tribeId ?? tribeId);
              const goalId = Number(data.goalId);
              const missionIdx = Number(data.missionIdx);
              if (!w || !s || !t || isNaN(goalId) || isNaN(missionIdx)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Missing wallet, ssuId, tribeId, goalId, or missionIdx" }));
                return;
              }
              if (req.method === "POST") {
                addOverlaySubscription(w, s, t, goalId, missionIdx);
              } else {
                removeOverlaySubscription(w, s, t, goalId, missionIdx);
              }
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Overlay settings ──
      server.middlewares.use("/api/overlay-settings", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        const wallet = url.searchParams.get("wallet") ?? "";

        if (req.method === "GET") {
          if (!wallet) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing wallet" }));
            return;
          }
          res.end(JSON.stringify(getOverlaySettings(wallet)));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          req.on("end", () => {
            try {
              const data = deepSanitise(JSON.parse(body));
              const w = String(data.wallet ?? wallet);
              if (!w) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Missing wallet" }));
                return;
              }
              setOverlaySettings(w, {
                opacity: data.opacity !== undefined ? Number(data.opacity) : undefined,
                position: data.position !== undefined ? String(data.position) : undefined,
                showAlerts: data.showAlerts !== undefined ? Boolean(data.showAlerts) : undefined,
                showMissions: data.showMissions !== undefined ? Boolean(data.showMissions) : undefined,
                showFuel: data.showFuel !== undefined ? Boolean(data.showFuel) : undefined,
              });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });

      // ── Overlay data — combines subscribed missions + system alerts ──
      server.middlewares.use("/api/overlay-data", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const wallet = url.searchParams.get("wallet") ?? "";
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (!wallet || !ssuId || !tribeId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing wallet, ssuId, or tribeId" }));
          return;
        }

        const subs = getOverlaySubscriptions(wallet, ssuId, tribeId);
        const allGoals = getGoals(ssuId, tribeId);
        const settings = getOverlaySettings(wallet);

        // Build subscribed mission cards
        const missions = subs.map((sub) => {
          const goal = allGoals.find((g: { id: number }) => g.id === sub.goalId);
          if (!goal) return null;
          const rawMissions: Array<{ idx: number; phase: string; description: string; quantity: number; completedQty: number; isPublished: boolean }> = (goal as { missions?: Array<{ idx: number; phase: string; description: string; quantity: number; completedQty: number; isPublished: boolean }> }).missions ?? [];
          const mission = rawMissions.find((m) => m.idx === sub.missionIdx);
          if (!mission) return null;
          return {
            goalId: goal.id,
            goalDescription: (goal as { description: string }).description,
            goalStatus: (goal as { status: string }).status,
            missionIdx: mission.idx,
            phase: mission.phase,
            description: mission.description,
            quantity: mission.quantity,
            completedQty: mission.completedQty,
            progressPct: mission.quantity > 0 ? Math.min(100, Math.round((mission.completedQty / mission.quantity) * 100)) : 0,
            isPublished: mission.isPublished,
          };
        }).filter(Boolean);

        // Build alerts — highlight goals nearing completion or needing attention
        const alerts: Array<{ type: string; message: string; severity: string }> = [];
        for (const goal of allGoals) {
          const g = goal as { id: number; status: string; description: string; ongoing: boolean; missions?: Array<{ isPublished: boolean; quantity: number; completedQty: number }> };
          if (g.status !== "published") continue;
          const pubMissions = (g.missions ?? []).filter((m) => m.isPublished);
          if (pubMissions.length === 0) continue;
          const totalQty = pubMissions.reduce((s: number, m: { quantity: number }) => s + m.quantity, 0);
          const doneQty = pubMissions.reduce((s: number, m: { completedQty: number }) => s + m.completedQty, 0);
          const pct = totalQty > 0 ? (doneQty / totalQty) * 100 : 0;
          if (pct >= 90 && pct < 100) {
            alerts.push({ type: "goal_near_complete", message: `Goal "${g.description}" is ${Math.round(pct)}% complete`, severity: "info" });
          }
          if (pct >= 100 && !g.ongoing) {
            alerts.push({ type: "goal_complete", message: `Goal "${g.description}" is ready to complete`, severity: "success" });
          }
        }

        res.end(JSON.stringify({ missions, alerts, settings, timestamp: Date.now() }));
      });

      // ── Overlay stream — Server-Sent Events for real-time overlay updates ──
      server.middlewares.use("/api/overlay-stream", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const wallet = url.searchParams.get("wallet") ?? "";
        const ssuId = url.searchParams.get("ssuId") ?? "";
        const tribeId = url.searchParams.get("tribeId") ?? "";
        if (!wallet || !ssuId || !tribeId) {
          res.statusCode = 400;
          res.end("Missing wallet, ssuId, or tribeId");
          return;
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const sendData = () => {
          try {
            const subs = getOverlaySubscriptions(wallet, ssuId, tribeId);
            const allGoals = getGoals(ssuId, tribeId);
            const settings = getOverlaySettings(wallet);

            const missions = subs.map((sub) => {
              const goal = allGoals.find((g: { id: number }) => g.id === sub.goalId);
              if (!goal) return null;
              const rawMissions: Array<{ idx: number; phase: string; description: string; quantity: number; completedQty: number; isPublished: boolean }> = (goal as { missions?: Array<{ idx: number; phase: string; description: string; quantity: number; completedQty: number; isPublished: boolean }> }).missions ?? [];
              const mission = rawMissions.find((m) => m.idx === sub.missionIdx);
              if (!mission) return null;
              return {
                goalId: (goal as { id: number }).id,
                goalDescription: (goal as { description: string }).description,
                goalStatus: (goal as { status: string }).status,
                missionIdx: mission.idx,
                phase: mission.phase,
                description: mission.description,
                quantity: mission.quantity,
                completedQty: mission.completedQty,
                progressPct: mission.quantity > 0 ? Math.min(100, Math.round((mission.completedQty / mission.quantity) * 100)) : 0,
                isPublished: mission.isPublished,
              };
            }).filter(Boolean);

            const alerts: Array<{ type: string; message: string; severity: string }> = [];
            for (const goal of allGoals) {
              const g = goal as { id: number; status: string; description: string; ongoing: boolean; missions?: Array<{ isPublished: boolean; quantity: number; completedQty: number }> };
              if (g.status !== "published") continue;
              const pubMissions = (g.missions ?? []).filter((m) => m.isPublished);
              if (pubMissions.length === 0) continue;
              const totalQty = pubMissions.reduce((s: number, m: { quantity: number }) => s + m.quantity, 0);
              const doneQty = pubMissions.reduce((s: number, m: { completedQty: number }) => s + m.completedQty, 0);
              const pct = totalQty > 0 ? (doneQty / totalQty) * 100 : 0;
              if (pct >= 90 && pct < 100) {
                alerts.push({ type: "goal_near_complete", message: `Goal "${g.description}" is ${Math.round(pct)}% complete`, severity: "info" });
              }
              if (pct >= 100 && !g.ongoing) {
                alerts.push({ type: "goal_complete", message: `Goal "${g.description}" is ready to complete`, severity: "success" });
              }
            }

            const payload = JSON.stringify({ missions, alerts, settings, timestamp: Date.now() });
            res.write(`data: ${payload}\n\n`);
          } catch {
            // SSE errors are non-fatal — client will reconnect
          }
        };

        // Send initial snapshot immediately
        sendData();

        // Push updates every 10 seconds
        const interval = setInterval(sendData, 10_000);

        // Send a keepalive comment every 30 seconds to prevent proxy timeouts
        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 30_000);

        req.on("close", () => {
          clearInterval(interval);
          clearInterval(keepalive);
        });
      });
  }

  return {
    name: "tribe-api",
    configureServer(server) {
      setupApiRoutes(server);
    },
    configurePreviewServer(server) {
      setupApiRoutes(server);
    },
    // Add Content-Security-Policy meta tag to HTML pages
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://artifacts.evefrontier.com",
        "font-src 'self' https://artifacts.evefrontier.com",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://*.sui.io https://*.mystenlabs.com https://*.suiscan.xyz wss://*.mystenlabs.com https://api.slush.app https://*.evefrontier.com",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read VITE_EVE_TENANT from CLI env (cross-env) or .env file
  const env = loadEnv(mode, process.cwd());
  const tenantId = process.env.VITE_EVE_TENANT || env.VITE_EVE_TENANT || "stillness";
  const tenant = TENANTS[tenantId];
  if (!tenant) {
    throw new Error(`Unknown tenant "${tenantId}". Known: ${Object.keys(TENANTS).join(", ")}`);
  }

  return {
    plugins: [react(), tribeApiPlugin(tenantId)],
    // Inject the two env vars that @evefrontier/dapp-kit reads via getEnvVar()
    define: {
      "import.meta.env.VITE_EVE_WORLD_PACKAGE_ID": JSON.stringify(tenant.worldPackageId),
      "import.meta.env.VITE_SUI_GRAPHQL_ENDPOINT": JSON.stringify(tenant.graphqlUrl),
    },
    server: {
      port: Number(process.env.PORT) || 5174,
      host: true,
      allowedHosts: true,
    },
    preview: {
      port: Number(process.env.PORT) || 5174,
      host: true,
      allowedHosts: true,
    },
  };
});
