/**
 * Multi-tenant configuration for EVE Frontier environments.
 *
 * Each tenant (Utopia, Stillness, …) shares the same Sui testnet but has
 * its own world package, EVE token, and object registry addresses.
 *
 * Switch tenants by changing VITE_EVE_TENANT in your .env file, or run:
 *   pnpm dev:utopia     / pnpm dev:stillness
 *   pnpm build:utopia   / pnpm build:stillness
 */

export interface TenantConfig {
  /** Human-readable label */
  label: string;
  /** Sui network (testnet, mainnet, devnet, localnet) */
  network: string;
  /** JSON-RPC endpoint */
  rpcUrl: string;
  /** GraphQL endpoint */
  graphqlUrl: string;
  /** World REST API (optional — used for tribe name enrichment) */
  worldApi: string;
  /** Published world package ID */
  worldPackageId: string;
  /** EVE token coin type (e.g. 0x…::EVE::EVE) */
  eveTokenType: string;
  /** Platform admin wallet (receives protocol fees, can manage vaults) */
  adminAddress: string;
  /** Storage Unit Extension package (contribute, trade, distribute, escrow, release) */
  extensionPackageId: string;
  /** Default Plutarch deployment addresses for this tenant */
  defaultDeployment: {
    packageId: string;
    registryId: string;
    systemManagerCapId: string;
  };
  /** Shared object addresses */
  objects: {
    objectRegistry: string;
    energyConfig: string;
    gateConfig: string;
    adminAcl: string;
    serverAddressRegistry: string;
    locationRegistry: string;
    killmailRegistry: string;
    fuelConfig: string;
  };
}

export const TENANTS: Record<string, TenantConfig> = {
  utopia: {
    label: "Utopia (UAT)",
    network: "testnet",
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    graphqlUrl: "https://graphql.testnet.sui.io/graphql",
    worldApi: "https://world-api-utopia.uat.pub.evefrontier.com",
    worldPackageId: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75",
    eveTokenType: "0xf0446b93345c1118f21239d7ac58fb82d005219b2016e100f074e4d17162a465::EVE::EVE",
    adminAddress: "0x6cd391f1b61aea06e092e45229b292ed1846edc3ddd5e2928830ce4624c211c1",
    extensionPackageId: "0x87ebb5cd1880079b040a389bd79bc38ded53244a53b98d5e2e8c7d877ca0e3e0",
    defaultDeployment: {
      packageId: "0x7326efaa531321cb9e4baa83846a14350d9106d81b104bda1255e841dca8e51f",
      registryId: "0x88ee1e9c6b927eb6f08731a264854ca16e49fd6f264b2d8893f6b2fa2ebdf90d",
      systemManagerCapId: "0xf592833012d794919998be5e9806259454779a8d880a047d7385c4fb72349f56",
    },
    objects: {
      objectRegistry: "0xc2b969a72046c47e24991d69472afb2216af9e91caf802684514f39706d7dc57",
      energyConfig: "0x9285364e8104c04380d9cc4a001bbdfc81a554aad441c2909c2d3bd52a0c9c62",
      gateConfig: "0x69a392c514c4ca6d771d8aa8bf296d4d7a021e244e792eb6cd7a0c61047fc62b",
      adminAcl: "",
      serverAddressRegistry: "",
      locationRegistry: "",
      killmailRegistry: "",
      fuelConfig: "",
    },
  },

  stillness: {
    label: "Stillness (Live)",
    network: "testnet",
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    graphqlUrl: "https://graphql.testnet.sui.io/graphql",
    worldApi: "https://world-api-stillness.live.tech.evefrontier.com",
    worldPackageId: "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c",
    eveTokenType: "0x2a66a89b5a735738ffa4423ac024d23571326163f324f9051557617319e59d60::EVE::EVE",
    adminAddress: "0x753ec7f71736b8c3498852833f5d0329cb524a3e667a40e3d3a16910c3a6bdea",
    extensionPackageId: "0x34df2294977352b6d6f53cf63118579fc3c45c768ca68590dc2bf394fe9e38f6",
    defaultDeployment: {
      packageId: "0x7aa4e0ee61e9fa55778755b917b3a46e5bb325da5165c04f37b93e1402b23bce",
      registryId: "0x06e012fcc823cb8c409a801f38412c6b61a4eb1b1cd80e2357876e122270452b",
      systemManagerCapId: "0xa22cdb180075b0f78736d8706edb030cb42f42be693f16415448ad4341d63136",
    },
    objects: {
      objectRegistry: "0x454a9aa3d37e1d08d3c9181239c1b683781e4087fbbbd48c935d54b6736fd05c",
      energyConfig: "0xd77693d0df5656d68b1b833e2a23cc81eb3875d8d767e7bd249adde82bdbc952",
      gateConfig: "0xd6d9230faec0230c839a534843396e97f5f79bdbd884d6d5103d0125dc135827",
      adminAcl: "0x8ca0e61465f94e60f9c2dadf9566edfe17aa272215d9c924793d2721b3477f93",
      serverAddressRegistry: "0xeb97b81668699672b1147c28dacb3d595534c48f4e177d3d80337dbde464f05f",
      locationRegistry: "0xc87dca9c6b2c95e4a0cbe1f8f9eeff50171123f176fbfdc7b49eef4824fc596b",
      killmailRegistry: "0x7fd9a32d0bbe7b1cfbb7140b1dd4312f54897de946c399edb21c3a12e52ce283",
      fuelConfig: "0x4fcf28a9be750d242bc5d2f324429e31176faecb5b84f0af7dff3a2a6e243550",
    },
  },
} as const;

/**
 * Resolve the active tenant config.
 * Reads VITE_EVE_TENANT (default: "stillness").
 */
export function getTenantConfig(): TenantConfig {
  const id = (import.meta.env.VITE_EVE_TENANT || "stillness") as string;
  const cfg = TENANTS[id];
  if (!cfg) {
    throw new Error(`Unknown tenant "${id}". Known tenants: ${Object.keys(TENANTS).join(", ")}`);
  }
  return cfg;
}
