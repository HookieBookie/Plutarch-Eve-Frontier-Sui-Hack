/**
 * Plutarch dApp configuration.
 *
 * Tenant-specific values (world package, EVE token, RPC, etc.) are resolved
 * automatically from src/tenants.ts based on VITE_EVE_TENANT.
 *
 * Deployment-specific addresses (packageId, registryId, coinType, etc.)
 * are fetched dynamically per tribe via DeploymentContext.
 */

import { getTenantConfig } from "./tenants";

const tenant = getTenantConfig();

export const EVE_TENANT = (import.meta.env.VITE_EVE_TENANT || "stillness") as string;
export const TRIBE_ID = Number(import.meta.env.VITE_TRIBE_ID || "0");

/** Sui network / RPC — derived from tenant config. */
export const SUI_NETWORK = tenant.network;
export const SUI_RPC_URL = tenant.rpcUrl;

/** EVE token types — derived from tenant config. */
export const VAULT_COIN_TYPE = tenant.eveTokenType;
export const EVE_TOKEN_TYPE = tenant.eveTokenType;

/** EVE World package on the active tenant. */
export const WORLD_PACKAGE_ID = tenant.worldPackageId;

/** EVE World REST API — optional display-data enrichment (tribe names, etc.). */
export const WORLD_API = tenant.worldApi;

/** Plutarch platform admin address (receives protocol fees, can manage vault). */
export const ADMIN_ADDRESS = tenant.adminAddress;

/** 1 EVE = 100 credits (must match contract CREDIT_MULTIPLIER). */
export const CREDIT_MULTIPLIER = 100;
/** Protocol fee in basis points (100 = 1%). */
export const FEE_BPS = 100;

/** Storage Unit Extension package — provides contribute, trade, distribute, escrow, release. */
export const EXTENSION_PACKAGE_ID = tenant.extensionPackageId;

/**
 * Default deployment config — from the published Plutarch package on the active tenant.
 * With dynamic coins, each tribe gets its own creditCoinType and coinPackageId.
 * creditTreasuryId is no longer needed (TreasuryCap lives inside the vault).
 */
export const DEFAULT_DEPLOYMENT = {
  ...tenant.defaultDeployment,
  creditCoinType: "",       // Set per tribe after coin publishing (e.g. "0xabc::co86::CO86")
  creditMetadataId: "",     // Set per tribe after coin publishing
  coinPackageId: "",        // The published coin module package ID
} as const;
