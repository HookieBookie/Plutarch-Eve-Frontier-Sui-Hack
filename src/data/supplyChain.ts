export type MissionPhase = "GATHER" | "REFINE" | "PRINT" | "ACQUIRE" | "DELIVER";

/** Tier 1 = Gather (raw), Tier 2 = Refine (single-input), Tier 3 = Print (multi-input/industry), Tier 4 = Acquire (lootable), Tier 5 = Deliver. */
export const PHASE_TIER: Record<MissionPhase, number> = {
  GATHER: 1,
  REFINE: 2,
  PRINT: 3,
  ACQUIRE: 4,
  DELIVER: 5,
};

export const DEFAULT_TIER_PERCENTS: [number, number, number] = [25, 50, 100];

/** Items that must be acquired (looted/found) rather than crafted — reward is set manually by the manager. */
const ACQUIRABLE_ITEMS = new Set([
  "Exclave Technocore", "Synod Technocore", "Fossilized Exotronics",
  "Feral Echo", "Luminalis", "Radiantium",
  "Stack Slice 5DW", "Stack Slice 5DE", "Stack Slice 5C1",
  "Stack Slice 31V", "Stack Slice 31Q", "Stack Slice 31F",
  "Stack Slice 5DZ", "Stack Slice 5DK", "Stack Slice 5C0",
  "Stack Slice 31P",
  "Eclipsite", "Gravionite", "Catalytic Dust",
]);

/**
 * EVE Frontier type_id lookup by item name (case-insensitive, singular-tolerant).
 * Raw ores from datahub /v2/types, refined/crafted items discovered on-chain.
 */
export const ITEM_TYPE_IDS: Record<string, number> = {
  // Raw ores (from datahub)
  "Feldspar Crystals": 77800,
  "Silicon Dust": 77803,
  "Tholin Aggregates": 77804,
  "Hydrated Sulfide Matrix": 77811,
  "Water Ice": 78423,
  "Nickel-Iron Veins": 77801,
  "Platinum-Palladium Matrix": 77810,
  "Methane Ice Shards": 78446,
  "Iridosmine Nodules": 78426,
  "Iron-Rich Nodules": 89260,
  "Palladium": 99001,
  // Refined materials
  "Hydrocarbon Residue": 89258,
  "Silica Grains": 89259,
  "Feldspar Crystal Shards": 88235,
  "Troilite Sulfide Grains": 88234,
  // Industry outputs (canonical API names)
  "Carbon Weave": 84210,
  "Thermal Composites": 88561,
  "Printed Circuits": 84180,
  "Building Foam": 89089,
  "Reinforced Alloys": 84182,
  // Lootable materials
  "Exclave Technocore": 89088,
  "Synod Technocore": 89087,
  "Fossilized Exotronics": 83818,
  // Field refinery materials
  "D1 Fuel": 88335,
  "D2 Fuel": 88319,
  "Salt": 83839,
  "Brine": 92422,
  "Eupraxite": 78435,
  "Sophrogon": 77728,
  "Fine Young Crude Matter": 92394,
  "Fine Old Crude Matter": 92414,
  "Mummified Clone": 88765,
  "Salvaged Materials": 88764,
  "Aromatic Carbon Veins": 78448,
  "Primitive Kerogen Matrix": 78447,
  "Rough Old Crude Matter": 77729,
  "Rough Young Crude Matter": 78434,
  "Tholin Nodules": 78449,
  // Refinery outputs
  "EU-40 Fuel": 78516,
  "SOF-40 Fuel": 84868,
  "Chitinous Organics": 88781,
  "Aromatic Carbon Weave": 88782,
  "Kerogen Tar": 88783,
  "Platinum-Group Veins": 77805,
  // Printer outputs
  "AC Gyrojet Ammo 1 (S)": 82128,
  "Afterburner II": 82681,
  "Base Autocannon (S)": 81974,
  "Bulky Armor Plates II": 82647,
  "Bulwark Shield Generator II": 82652,
  "Compressed Coolant": 88887,
  "Heat Exchanger XS": 88886,
  "Hop": 90887,
  "Nomad Program Frame": 78418,
  "Skip": 92389,
  "Small Cutting Laser": 77852,
  "Sojourn": 81846,
  "Synthetic Mining Lens": 83463,
  "Coilgun Ammo 1 (S)": 82133,
  "Rapid Plasma Ammo 1 (S)": 82130,
  "Carom Stack": 0,
  "Stride Stack": 0,
  "Stack Slice 5DW": 0,
  "Stack Slice 5DE": 0,
  "Stack Slice 5C1": 0,
  "Stack Slice 31V": 0,
  "Stack Slice 31Q": 0,
  "Stack Slice 31F": 0,
  "Stack Slice 5DZ": 0,
  "Stack Slice 5DK": 0,
  "Stack Slice 5C0": 0,
  "Stack Slice 31P": 0,
  "Luminalis": 83892,
  "Radiantium": 83894,
  "Luminalis Mining Lens": 83897,
  "Radiantium Mining Lens": 83895,
  "Still Kernel": 92483,
  "Still Knot": 88565,
  "Feral Echo": 88564,
  // Printer outputs
  "AC GyroJet Ammo 2 (S)": 82126,
  "AC GyroJet Ammo 3 (S)": 82127,
  "Apocalypse Protocol Frame": 78416,
  "Archangel Protocol Frame": 78420,
  "Bastion Program Frame": 78417,
  "Batched Carbon Weave": 88841,
  "Batched Printed Circuits": 88839,
  "Batched Reinforced Alloys": 84204,
  "Batched Thermal Composites": 88843,
  "EM Disintegrator Charge (M)": 82137,
  "EM Disintegrator Charge (S)": 81658,
  "EM Nanite Sequencer": 82411,
  "Echo Chamber": 88780,
  "Eclipsite Mining Lens": 83898,
  "Explosive Nanite Sequencer": 82410,
  "Exterminata Protocol Frame": 78421,
  "Gravionite Mining Lens": 83896,
  "Kinetic Nanite Sequencer": 82413,
  "Rapid Plasma Ammo 2 (S)": 82131,
  "SOF-80 Fuel": 78515,
  "Thermal Nanite Sequencer": 82412,
  // Heavy Printer outputs
  "Coilgun Ammo 1 (M)": 82134,
  "EU-90 Fuel": 78437,
  "Equilibrium Program Frame": 78422,
  "Howitzer Ammo 1 (M)": 82140,
  "Packaged Carbon Weave": 88842,
  "Packaged Printed Circuits": 88840,
  "Packaged Reinforced Alloys": 84206,
  "Packaged Thermal Composites": 88844,
  "Rapid Plasma Ammo 1 (M)": 82132,
  // Loot drops
  "Eclipsite": 83893,
  "Gravionite": 83891,
  "Catalytic Dust": 83899,
  // Structures — Core
  "Network Node": 88092,
  "Refuge": 91751,
  "Field Refinery": 91752,
  "Field Printer": 91753,
  "Field Storage": 91756,
  "Nursery": 92165,
  // Structures — Industry
  "Mini Printer": 91700,
  "Printer": 91701,
  "Heavy Printer": 91702,
  "Refinery": 91703,
  "Heavy Refinery": 91704,
  "Assembler": 91708,
  // Structures — Storage
  "Mini Storage": 91713,
  "Storage": 91714,
  "Heavy Storage": 91715,
  // Structures — Hangars
  "Mini Berth": 91705,
  "Berth": 91706,
  "Heavy Berth": 91707,
  "Nest": 92166,
  // Structures — Defense
  "Shelter": 91709,
  "Heavy Shelter": 91710,
  "Mini Turret": 92280,
  "Turret": 92406,
  "Heavy Turret": 92407,
  // Structures — Gates
  "Mini Gate": 91711,
  "Heavy Gate": 91712,
  "Relay": 91717,
  // Structures — Misc
  "Rainmaker": 91722,
  "Harbinger": 91724,
  "Seer": 91726,
  // Ships
  "USV": 81609,
  "Chumaq": 81611,
  "TADES": 81808,
  "MCF": 81904,
  "HAF": 82424,
  "LORHA": 82426,
  "MAUL": 82430,
  "Wend": 87698,
  "Recurve": 87846,
  "Reflex": 87847,
  "Reiver": 87848,
  "Carom": 91107,
  "Stride": 91106,
  // Assembler outputs
  "Adaptive Nanitic Armor Weave II": 83441,
  "Adaptive Nanitic Armor Weave III": 83442,
  "Adaptive Nanitic Armor Weave IV": 83443,
  "Afterburner III": 83536,
  "Afterburner IV": 82915,
  "Attuned Shield Generator II": 82653,
  "Attuned Shield Generator III": 83450,
  "Attuned Shield Generator IV": 83451,
  "Base Coilgun (M)": 82028,
  "Base Coilgun (S)": 81972,
  "Base Howitzer (M)": 82030,
  "Base Rapid Plasma (S)": 82032,
  "Bulky Armor Plates III": 83421,
  "Bulky Armor Plates V": 83423,
  "Bulwark Shield Generator III": 83448,
  "Bulwark Shield Generator IV": 83449,
  "Cargo Grid II": 83497,
  "Cargo Grid III": 83498,
  "Cargo Grid IV": 83499,
  "Cargo Grid V": 83500,
  "Cargo Grid VI": 83501,
  "Celerity CD01": 78506,
  "Celerity CD02": 78507,
  "Celerity CD03": 78508,
  "Coated Armor Plates II": 82648,
  "Coated Armor Plates III": 83425,
  "Coated Armor Plates IV": 83426,
  "Crude Extractor": 77484,
  "Cryogenic Ejector S": 87599,
  "EM Field Array II": 83768,
  "EM Field Array III": 83769,
  "EM Field Array IV": 83770,
  "Embark": 77753,
  "Explonetic-Electro Nanitic Brace II": 83618,
  "Explonetic-Electro Nanitic Brace III": 83619,
  "Explonetic-Electro Nanitic Brace IV": 83620,
  "Explosive Field Array II": 83777,
  "Explosive Field Array III": 83778,
  "Explosive Field Array IV": 83779,
  "Heat Exchanger S": 88889,
  "Hull Repairer": 72960,
  "Kinetic Field Array II": 83782,
  "Kinetic Field Array III": 83783,
  "Kinetic Field Array IV": 83784,
  "Large Cutting Laser": 0,
  "Leap": 92421,
  "Lunge": 92390,
  "Medium Cutting Laser": 83528,
  "Nimble Armor Plates II": 82650,
  "Nimble Armor Plates III": 83433,
  "Nimble Armor Plates IV": 83434,
  "Rapid Plasma (M)": 82033,
  "Reactive Armor Plates II": 82649,
  "Reactive Armor Plates III": 83429,
  "Reactive Armor Plates IV": 83430,
  "Reinforced Shield Generator II": 82654,
  "Reinforced Shield Generator III": 83456,
  "Reinforced Shield Generator IV": 83457,
  "Shield Restorer II": 82667,
  "Shield Restorer III": 83458,
  "Shield Restorer IV": 83459,
  "Stasis Net II": 82683,
  "Stasis Net III": 83520,
  "Stasis Net IV": 83521,
  "Stasis Net V": 83522,
  "Stasis Net VI": 83523,
  "Systemic Armor Restorer II": 0,
  "Systemic Armor Restorer III": 0,
  "Systemic Armor Restorer IV": 0,
  "Tempo CD42": 78510,
  "Thermal Field Array II": 83772,
  "Thermal Field Array III": 83773,
  "Thermal Field Array IV": 83774,
  "Thermal Field Array V": 0,
  "Thermal-Electro Nanitic Brace II": 83613,
  "Thermal-Electro Nanitic Brace III": 83614,
  "Thermal-Electro Nanitic Brace IV": 83615,
  "Thermalnetic Nanitic Brace II": 83628,
  "Thermalnetic Nanitic Brace III": 83629,
  "Thermalnetic Nanitic Brace IV": 83630,
  "Tier 2 Autocannon (S)": 82084,
  "Tier 2 Coilgun (M)": 82092,
  "Tier 2 Coilgun (S)": 82088,
  "Tier 2 Howitzer (M)": 82098,
  "Tier 2 Rapid Plasma (M)": 82096,
  "Tier 2 Rapid Plasma (S)": 82086,
  "Tier 3 Autocannon (S)": 82085,
  "Tier 3 Coilgun (M)": 82093,
  "Tier 3 Coilgun (S)": 82089,
  "Tier 3 Howitzer (M)": 82099,
  "Tier 3 Rapid Plasma (M)": 82097,
  "Tier 3 Rapid Plasma (S)": 82087,
  "Tuho 7": 81656,
  "Tuho 9": 82090,
  "Velocity CD81": 78490,
  "Velocity CD82": 78502,
  "Warp Entangler II": 82682,
  "Warp Entangler III": 83516,
  "Warp Entangler IV": 83517,
  "Warp Entangler V": 83518,
  "Warp Entangler VI": 83519,
  "Xoru 7": 81657,
  "Xoru 9": 82094,
  "Xoru S": 82095,
};

/** Reverse lookup: type_id → canonical name. */
export const TYPE_ID_NAMES: Map<number, string> = new Map(
  Object.entries(ITEM_TYPE_IDS)
    .filter(([, id]) => id > 0)
    .map(([name, id]) => [id, name]),
);

/** Look up a type_id by item name (case-insensitive, strips trailing 's'). Returns 0 if unknown. */
export function getTypeIdByName(name: string): number {
  // Exact match first
  if (name in ITEM_TYPE_IDS) return ITEM_TYPE_IDS[name];
  // Normalised match
  const norm = name.toLowerCase().replace(/s$/, "");
  for (const [key, id] of Object.entries(ITEM_TYPE_IDS)) {
    if (key.toLowerCase().replace(/s$/, "") === norm) return id;
  }
  return 0;
}

export interface Mission {
  phase: MissionPhase;
  tier: number;
  description: string;
  quantity: number;
  isAlternative?: boolean;
  /** Human-readable reason why this mission is an alternative (e.g. "Reinforced Alloys via field-printer"). */
  altReason?: string;
  /** EVE Frontier numeric item type ID for SSU inventory verification. */
  typeId?: number;
  /** For REFINE / PRINT missions: the primary input material used to produce this output. */
  inputItem?: string;
}

// --- Recipe data (defaults + dynamic custom recipes) ---

export interface ConstructionRow {
  building: string;
  component: string;
  qty: number;
}
export interface IndustryRow {
  outputItem: string;
  outputQty: number;
  inputItem: string;
  inputQty: number;
  /** Production method identifier for grouping co-inputs (e.g. "mini-printer", "field-printer"). */
  source?: string;
}
export interface RefiningRow {
  inputItem: string;
  inputQty: number;
  outputItem: string;
  outputQty: number;
  /** Refinery structure identifier (e.g. "field-refinery", "mini-refinery"). */
  source?: string;
}

export interface GatherRow {
  item: string;
}

export interface ShipbuildingRow {
  ship: string;
  component: string;
  qty: number;
  source?: string;
}

export interface AssemblyRow {
  module: string;
  component: string;
  qty: number;
  source?: string;
}

export interface RecipeData {
  construction: ConstructionRow[];
  industry: IndustryRow[];
  refining: RefiningRow[];
  gather: GatherRow[];
  shipbuilding: ShipbuildingRow[];
  assembly: AssemblyRow[];
}

const DEFAULT_CONSTRUCTION: ConstructionRow[] = [
  // --- CORE ---
  { building: "Network Node", component: "Carbon Weave", qty: 10 },
  { building: "Network Node", component: "Printed Circuits", qty: 10 },
  { building: "Network Node", component: "Thermal Composites", qty: 10 },
  { building: "Refuge", component: "Building Foam", qty: 20 },
  { building: "Field Refinery", component: "Reinforced Alloys", qty: 10 },
  { building: "Field Printer", component: "Reinforced Alloys", qty: 10 },
  { building: "Field Storage", component: "Building Foam", qty: 10 },
  { building: "Nursery", component: "Building Foam", qty: 20 },
  // --- INDUSTRY ---
  { building: "Mini Printer", component: "Reinforced Alloys", qty: 15 },
  { building: "Mini Printer", component: "Printed Circuits", qty: 15 },
  { building: "Printer", component: "Building Foam", qty: 20 },
  { building: "Printer", component: "Reinforced Alloys", qty: 15 },
  { building: "Printer", component: "Printed Circuits", qty: 15 },
  { building: "Heavy Printer", component: "Building Foam", qty: 40 },
  { building: "Heavy Printer", component: "Reinforced Alloys", qty: 30 },
  { building: "Heavy Printer", component: "Printed Circuits", qty: 30 },
  { building: "Refinery", component: "Reinforced Alloys", qty: 10 },
  { building: "Refinery", component: "Thermal Composites", qty: 10 },
  { building: "Heavy Refinery", component: "Building Foam", qty: 20 },
  { building: "Heavy Refinery", component: "Reinforced Alloys", qty: 20 },
  { building: "Heavy Refinery", component: "Thermal Composites", qty: 20 },
  { building: "Assembler", component: "Building Foam", qty: 20 },
  { building: "Assembler", component: "Reinforced Alloys", qty: 15 },
  { building: "Assembler", component: "Printed Circuits", qty: 15 },
  { building: "Assembler", component: "Exclave Technocore", qty: 1 },
  // --- STORAGE ---
  { building: "Mini Storage", component: "Building Foam", qty: 10 },
  { building: "Mini Storage", component: "Reinforced Alloys", qty: 5 },
  { building: "Storage", component: "Building Foam", qty: 20 },
  { building: "Storage", component: "Reinforced Alloys", qty: 10 },
  { building: "Heavy Storage", component: "Building Foam", qty: 40 },
  { building: "Heavy Storage", component: "Reinforced Alloys", qty: 20 },
  // --- HANGARS ---
  { building: "Mini Berth", component: "Building Foam", qty: 20 },
  { building: "Mini Berth", component: "Reinforced Alloys", qty: 10 },
  { building: "Berth", component: "Building Foam", qty: 40 },
  { building: "Berth", component: "Reinforced Alloys", qty: 20 },
  { building: "Heavy Berth", component: "Building Foam", qty: 80 },
  { building: "Heavy Berth", component: "Reinforced Alloys", qty: 40 },
  { building: "Nest", component: "Building Foam", qty: 20 },
  // --- DEFENSE ---
  { building: "Shelter", component: "Building Foam", qty: 20 },
  { building: "Shelter", component: "Reinforced Alloys", qty: 20 },
  { building: "Heavy Shelter", component: "Building Foam", qty: 40 },
  { building: "Heavy Shelter", component: "Reinforced Alloys", qty: 40 },
  { building: "Mini Turret", component: "Reinforced Alloys", qty: 10 },
  { building: "Mini Turret", component: "Printed Circuits", qty: 10 },
  { building: "Turret", component: "Building Foam", qty: 20 },
  { building: "Turret", component: "Reinforced Alloys", qty: 20 },
  { building: "Turret", component: "Printed Circuits", qty: 20 },
  { building: "Heavy Turret", component: "Building Foam", qty: 40 },
  { building: "Heavy Turret", component: "Reinforced Alloys", qty: 40 },
  { building: "Heavy Turret", component: "Printed Circuits", qty: 40 },
  // --- GATES ---
  { building: "Mini Gate", component: "Building Foam", qty: 20 },
  { building: "Mini Gate", component: "Reinforced Alloys", qty: 10 },
  { building: "Mini Gate", component: "Printed Circuits", qty: 10 },
  { building: "Heavy Gate", component: "Building Foam", qty: 40 },
  { building: "Heavy Gate", component: "Reinforced Alloys", qty: 20 },
  { building: "Heavy Gate", component: "Printed Circuits", qty: 20 },
  { building: "Relay", component: "Building Foam", qty: 20 },
  { building: "Relay", component: "Reinforced Alloys", qty: 10 },
  { building: "Relay", component: "Printed Circuits", qty: 10 },
  { building: "Relay", component: "Exclave Technocore", qty: 1 },
  // --- MISC ---
  { building: "Rainmaker", component: "Building Foam", qty: 20 },
  { building: "Rainmaker", component: "Reinforced Alloys", qty: 20 },
  { building: "Rainmaker", component: "Synod Technocore", qty: 1 },
  { building: "Harbinger", component: "Building Foam", qty: 20 },
  { building: "Harbinger", component: "Reinforced Alloys", qty: 20 },
  { building: "Harbinger", component: "Synod Technocore", qty: 1 },
  { building: "Seer", component: "Building Foam", qty: 20 },
  { building: "Seer", component: "Reinforced Alloys", qty: 20 },
  { building: "Seer", component: "Synod Technocore", qty: 1 },
  { building: "Monolith", component: "Building Foam", qty: 60 },
  { building: "Monolith", component: "Reinforced Alloys", qty: 60 },
  { building: "Monolith", component: "Synod Technocore", qty: 1 },
  { building: "Wall", component: "Building Foam", qty: 10 },
  { building: "Wall", component: "Reinforced Alloys", qty: 5 },
];

const DEFAULT_INDUSTRY: IndustryRow[] = [
  // --- Mini Printer recipes ---
  { outputItem: "Carbon Weave", outputQty: 14, inputItem: "Tholin Aggregates", inputQty: 3150, source: "mini-printer" },
  { outputItem: "Thermal Composites", outputQty: 14, inputItem: "Silicon Dust", inputQty: 630, source: "mini-printer" },
  { outputItem: "Thermal Composites", outputQty: 14, inputItem: "Tholin Aggregates", inputQty: 1260, source: "mini-printer" },
  { outputItem: "Thermal Composites", outputQty: 14, inputItem: "Feldspar Crystal Shards", inputQty: 210, source: "mini-printer" },
  { outputItem: "Printed Circuits", outputQty: 1, inputItem: "Silicon Dust", inputQty: 37, source: "mini-printer" },
  { outputItem: "Printed Circuits", outputQty: 1, inputItem: "Tholin Aggregates", inputQty: 22, source: "mini-printer" },
  { outputItem: "Reinforced Alloys", outputQty: 14, inputItem: "Nickel-Iron Veins", inputQty: 1050, source: "mini-printer" },
  { outputItem: "Reinforced Alloys", outputQty: 14, inputItem: "Feldspar Crystal Shards", inputQty: 1050, source: "mini-printer" },
  { outputItem: "Building Foam", outputQty: 10, inputItem: "Reinforced Alloys", inputQty: 65, source: "mini-printer" },
  { outputItem: "Building Foam", outputQty: 10, inputItem: "Carbon Weave", inputQty: 65, source: "mini-printer" },
  { outputItem: "Building Foam", outputQty: 10, inputItem: "Thermal Composites", inputQty: 65, source: "mini-printer" },
  { outputItem: "AC Gyrojet Ammo 1 (S)", outputQty: 100, inputItem: "Iron-Rich Nodules", inputQty: 24, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 5DW", inputQty: 1, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 5DE", inputQty: 1, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 5C1", inputQty: 1, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 31V", inputQty: 1, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 31Q", inputQty: 1, source: "mini-printer" },
  { outputItem: "Carom Stack", outputQty: 1, inputItem: "Stack Slice 31F", inputQty: 1, source: "mini-printer" },
  { outputItem: "Coilgun Ammo 1 (S)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 230, source: "mini-printer" },
  { outputItem: "Compressed Coolant", outputQty: 10, inputItem: "D1 Fuel", inputQty: 115, source: "mini-printer" },
  { outputItem: "Compressed Coolant", outputQty: 10, inputItem: "Iron-Rich Nodules", inputQty: 1, source: "mini-printer" },
  { outputItem: "D2 Fuel", outputQty: 200, inputItem: "Salt", inputQty: 1, source: "mini-printer" },
  { outputItem: "D2 Fuel", outputQty: 200, inputItem: "D1 Fuel", inputQty: 200, source: "mini-printer" },
  { outputItem: "Luminalis Mining Lens", outputQty: 1, inputItem: "Silicon Dust", inputQty: 45, source: "mini-printer" },
  { outputItem: "Luminalis Mining Lens", outputQty: 1, inputItem: "Luminalis", inputQty: 1, source: "mini-printer" },
  { outputItem: "Nomad Program Frame", outputQty: 1, inputItem: "Fossilized Exotronics", inputQty: 5, source: "mini-printer" },
  { outputItem: "Radiantium Lens", outputQty: 1, inputItem: "Silicon Dust", inputQty: 45, source: "mini-printer" },
  { outputItem: "Radiantium Lens", outputQty: 1, inputItem: "Radiantium", inputQty: 1, source: "mini-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (S)", outputQty: 100, inputItem: "Platinum-Group Veins", inputQty: 400, source: "mini-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (S)", outputQty: 100, inputItem: "Troilite Sulfide Grains", inputQty: 400, source: "mini-printer" },
  { outputItem: "Still Kernel", outputQty: 1, inputItem: "Brine", inputQty: 50, source: "mini-printer" },
  { outputItem: "Still Kernel", outputQty: 1, inputItem: "Tholin Nodules", inputQty: 5, source: "mini-printer" },
  { outputItem: "Still Knot", outputQty: 1, inputItem: "Salt", inputQty: 5, source: "mini-printer" },
  { outputItem: "Still Knot", outputQty: 1, inputItem: "Feral Echo", inputQty: 5, source: "mini-printer" },
  { outputItem: "Stride Stack", outputQty: 1, inputItem: "Stack Slice 5DZ", inputQty: 1, source: "mini-printer" },
  { outputItem: "Stride Stack", outputQty: 1, inputItem: "Stack Slice 5DK", inputQty: 1, source: "mini-printer" },
  { outputItem: "Stride Stack", outputQty: 1, inputItem: "Stack Slice 5C0", inputQty: 1, source: "mini-printer" },
  { outputItem: "Stride Stack", outputQty: 1, inputItem: "Stack Slice 31P", inputQty: 1, source: "mini-printer" },
  { outputItem: "Synthetic Mining Lens", outputQty: 1, inputItem: "Silica Grains", inputQty: 3, source: "mini-printer" },
  // --- Field Printer recipes ---
  { outputItem: "Carbon Weave", outputQty: 14, inputItem: "Hydrocarbon Residue", inputQty: 350, source: "field-printer" },
  { outputItem: "Thermal Composites", outputQty: 14, inputItem: "Hydrocarbon Residue", inputQty: 140, source: "field-printer" },
  { outputItem: "Thermal Composites", outputQty: 14, inputItem: "Silica Grains", inputQty: 90, source: "field-printer" },
  { outputItem: "Printed Circuits", outputQty: 1, inputItem: "Hydrocarbon Residue", inputQty: 3, source: "field-printer" },
  { outputItem: "Printed Circuits", outputQty: 1, inputItem: "Silica Grains", inputQty: 5, source: "field-printer" },
  { outputItem: "Reinforced Alloys", outputQty: 8, inputItem: "Silica Grains", inputQty: 105, source: "field-printer" },
  { outputItem: "Reinforced Alloys", outputQty: 8, inputItem: "Iron-Rich Nodules", inputQty: 70, source: "field-printer" },
  { outputItem: "Reinforced Alloys", outputQty: 8, inputItem: "Palladium", inputQty: 70, source: "field-printer" },
  { outputItem: "AC Gyrojet Ammo 1 (S)", outputQty: 100, inputItem: "Iron-Rich Nodules", inputQty: 24, source: "field-printer" },
  { outputItem: "Afterburner II", outputQty: 1, inputItem: "Thermal Composites", inputQty: 1, source: "field-printer" },
  { outputItem: "Base Autocannon (S)", outputQty: 1, inputItem: "Iron-Rich Nodules", inputQty: 10, source: "field-printer" },
  { outputItem: "Base Autocannon (S)", outputQty: 1, inputItem: "Silica Grains", inputQty: 30, source: "field-printer" },
  { outputItem: "Bulky Armor Plates II", outputQty: 1, inputItem: "Reinforced Alloys", inputQty: 4, source: "field-printer" },
  { outputItem: "Bulwark Shield Generator II", outputQty: 1, inputItem: "Printed Circuits", inputQty: 4, source: "field-printer" },
  { outputItem: "Bulwark Shield Generator II", outputQty: 1, inputItem: "Carbon Weave", inputQty: 7, source: "field-printer" },
  { outputItem: "Bulwark Shield Generator II", outputQty: 1, inputItem: "Palladium", inputQty: 150, source: "field-printer" },
  { outputItem: "Compressed Coolant", outputQty: 10, inputItem: "D1 Fuel", inputQty: 115, source: "field-printer" },
  { outputItem: "Compressed Coolant", outputQty: 10, inputItem: "Iron-Rich Nodules", inputQty: 1, source: "field-printer" },
  { outputItem: "Heat Exchanger XS", outputQty: 1, inputItem: "Reinforced Alloys", inputQty: 3, source: "field-printer" },
  { outputItem: "Heat Exchanger XS", outputQty: 1, inputItem: "D1 Fuel", inputQty: 280, source: "field-printer" },
  { outputItem: "Heat Exchanger XS", outputQty: 1, inputItem: "Palladium", inputQty: 2, source: "field-printer" },
  { outputItem: "Hop", outputQty: 1, inputItem: "Thermal Composites", inputQty: 2, source: "field-printer" },
  { outputItem: "Hop", outputQty: 1, inputItem: "Printed Circuits", inputQty: 1, source: "field-printer" },
  { outputItem: "Nomad Program Frame", outputQty: 1, inputItem: "Fossilized Exotronics", inputQty: 5, source: "field-printer" },
  { outputItem: "Skip", outputQty: 1, inputItem: "Thermal Composites", inputQty: 1, source: "field-printer" },
  { outputItem: "Small Cutting Laser", outputQty: 1, inputItem: "Printed Circuits", inputQty: 2, source: "field-printer" },
  { outputItem: "Small Cutting Laser", outputQty: 1, inputItem: "Carbon Weave", inputQty: 3, source: "field-printer" },
  { outputItem: "Sojourn", outputQty: 1, inputItem: "Reinforced Alloys", inputQty: 2, source: "field-printer" },
  { outputItem: "Sojourn", outputQty: 1, inputItem: "Hydrocarbon Residue", inputQty: 10, source: "field-printer" },
  { outputItem: "Synthetic Mining Lens", outputQty: 1, inputItem: "Silica Grains", inputQty: 3, source: "field-printer" },
  // --- Printer recipes ---
  { outputItem: "AC GyroJet Ammo 2 (S)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 230, source: "printer" },
  { outputItem: "AC GyroJet Ammo 3 (S)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 230, source: "printer" },
  { outputItem: "Apocalypse Protocol Frame", outputQty: 1, inputItem: "Still Knot", inputQty: 1, source: "printer" },
  { outputItem: "Apocalypse Protocol Frame", outputQty: 1, inputItem: "Echo Chamber", inputQty: 1, source: "printer" },
  { outputItem: "Apocalypse Protocol Frame", outputQty: 1, inputItem: "Kerogen Tar", inputQty: 128, source: "printer" },
  { outputItem: "Archangel Protocol Frame", outputQty: 1, inputItem: "Still Knot", inputQty: 1, source: "printer" },
  { outputItem: "Archangel Protocol Frame", outputQty: 1, inputItem: "Echo Chamber", inputQty: 1, source: "printer" },
  { outputItem: "Archangel Protocol Frame", outputQty: 1, inputItem: "Kerogen Tar", inputQty: 38, source: "printer" },
  { outputItem: "Bastion Program Frame", outputQty: 1, inputItem: "Still Knot", inputQty: 1, source: "printer" },
  { outputItem: "Bastion Program Frame", outputQty: 1, inputItem: "Echo Chamber", inputQty: 1, source: "printer" },
  { outputItem: "Bastion Program Frame", outputQty: 1, inputItem: "Kerogen Tar", inputQty: 38, source: "printer" },
  { outputItem: "Batched Carbon Weave", outputQty: 1, inputItem: "Carbon Weave", inputQty: 10, source: "printer" },
  { outputItem: "Batched Printed Circuits", outputQty: 1, inputItem: "Printed Circuits", inputQty: 10, source: "printer" },
  { outputItem: "Batched Reinforced Alloys", outputQty: 1, inputItem: "Reinforced Alloys", inputQty: 10, source: "printer" },
  { outputItem: "Batched Thermal Composites", outputQty: 1, inputItem: "Thermal Composites", inputQty: 10, source: "printer" },
  { outputItem: "EM Disintegrator Charge (M)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 20, source: "printer" },
  { outputItem: "EM Disintegrator Charge (M)", outputQty: 100, inputItem: "Platinum-Group Veins", inputQty: 60, source: "printer" },
  { outputItem: "EM Disintegrator Charge (S)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 3, source: "printer" },
  { outputItem: "EM Disintegrator Charge (S)", outputQty: 100, inputItem: "Platinum-Group Veins", inputQty: 10, source: "printer" },
  { outputItem: "EM Nanite Sequencer", outputQty: 1, inputItem: "Printed Circuits", inputQty: 1, source: "printer" },
  { outputItem: "EM Nanite Sequencer", outputQty: 1, inputItem: "Carbon Weave", inputQty: 1, source: "printer" },
  { outputItem: "Echo Chamber", outputQty: 1, inputItem: "Nickel-Iron Veins", inputQty: 120, source: "printer" },
  { outputItem: "Echo Chamber", outputQty: 1, inputItem: "Troilite Sulfide Grains", inputQty: 45, source: "printer" },
  { outputItem: "Echo Chamber", outputQty: 1, inputItem: "Feldspar Crystal Shards", inputQty: 105, source: "printer" },
  { outputItem: "Eclipsite Mining Lens", outputQty: 1, inputItem: "Silicon Dust", inputQty: 50, source: "printer" },
  { outputItem: "Eclipsite Mining Lens", outputQty: 1, inputItem: "Eclipsite", inputQty: 1, source: "printer" },
  { outputItem: "Explosive Nanite Sequencer", outputQty: 1, inputItem: "Printed Circuits", inputQty: 1, source: "printer" },
  { outputItem: "Explosive Nanite Sequencer", outputQty: 1, inputItem: "Thermal Composites", inputQty: 1, source: "printer" },
  { outputItem: "Exterminata Protocol Frame", outputQty: 1, inputItem: "Still Knot", inputQty: 1, source: "printer" },
  { outputItem: "Exterminata Protocol Frame", outputQty: 1, inputItem: "Echo Chamber", inputQty: 1, source: "printer" },
  { outputItem: "Exterminata Protocol Frame", outputQty: 1, inputItem: "Kerogen Tar", inputQty: 38, source: "printer" },
  { outputItem: "Gravionite Mining Lens", outputQty: 1, inputItem: "Silicon Dust", inputQty: 50, source: "printer" },
  { outputItem: "Gravionite Mining Lens", outputQty: 1, inputItem: "Gravionite", inputQty: 1, source: "printer" },
  { outputItem: "Kinetic Nanite Sequencer", outputQty: 1, inputItem: "Printed Circuits", inputQty: 1, source: "printer" },
  { outputItem: "Kinetic Nanite Sequencer", outputQty: 1, inputItem: "Thermal Composites", inputQty: 1, source: "printer" },
  { outputItem: "Rapid Plasma Ammo 2 (S)", outputQty: 100, inputItem: "Platinum-Group Veins", inputQty: 400, source: "printer" },
  { outputItem: "Rapid Plasma Ammo 2 (S)", outputQty: 100, inputItem: "Troilite Sulfide Grains", inputQty: 400, source: "printer" },
  { outputItem: "SOF-80 Fuel", outputQty: 600, inputItem: "Catalytic Dust", inputQty: 44, source: "printer" },
  { outputItem: "SOF-80 Fuel", outputQty: 600, inputItem: "SOF-40 Fuel", inputQty: 600, source: "printer" },
  { outputItem: "Still Kernel", outputQty: 1, inputItem: "Brine", inputQty: 50, source: "printer" },
  { outputItem: "Still Kernel", outputQty: 1, inputItem: "Tholin Nodules", inputQty: 5, source: "printer" },
  { outputItem: "Still Knot", outputQty: 1, inputItem: "Salt", inputQty: 5, source: "printer" },
  { outputItem: "Still Knot", outputQty: 1, inputItem: "Feral Echo", inputQty: 5, source: "printer" },
  { outputItem: "Thermal Nanite Sequencer", outputQty: 1, inputItem: "Printed Circuits", inputQty: 1, source: "printer" },
  { outputItem: "Thermal Nanite Sequencer", outputQty: 1, inputItem: "Thermal Composites", inputQty: 1, source: "printer" },
  // --- Heavy Printer recipes ---
  { outputItem: "Coilgun Ammo 1 (M)", outputQty: 100, inputItem: "Reinforced Alloys", inputQty: 7, source: "heavy-printer" },
  { outputItem: "EM Disintegrator Charge (M)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 6, source: "heavy-printer" },
  { outputItem: "EM Disintegrator Charge (M)", outputQty: 100, inputItem: "Platinum-Group Veins", inputQty: 20, source: "heavy-printer" },
  { outputItem: "EU-90 Fuel", outputQty: 600, inputItem: "EU-40 Fuel", inputQty: 600, source: "heavy-printer" },
  { outputItem: "EU-90 Fuel", outputQty: 600, inputItem: "Catalytic Dust", inputQty: 60, source: "heavy-printer" },
  { outputItem: "Equilibrium Program Frame", outputQty: 1, inputItem: "Still Knot", inputQty: 1, source: "heavy-printer" },
  { outputItem: "Equilibrium Program Frame", outputQty: 1, inputItem: "Echo Chamber", inputQty: 1, source: "heavy-printer" },
  { outputItem: "Equilibrium Program Frame", outputQty: 1, inputItem: "Aromatic Carbon Weave", inputQty: 1347, source: "heavy-printer" },
  { outputItem: "Howitzer Ammo 1 (M)", outputQty: 100, inputItem: "Reinforced Alloys", inputQty: 6, source: "heavy-printer" },
  { outputItem: "Howitzer Ammo 1 (M)", outputQty: 100, inputItem: "Troilite Sulfide Grains", inputQty: 400, source: "heavy-printer" },
  { outputItem: "Packaged Carbon Weave", outputQty: 1, inputItem: "Batched Carbon Weave", inputQty: 10, source: "heavy-printer" },
  { outputItem: "Packaged Printed Circuits", outputQty: 1, inputItem: "Batched Printed Circuits", inputQty: 10, source: "heavy-printer" },
  { outputItem: "Packaged Reinforced Alloys", outputQty: 1, inputItem: "Batched Reinforced Alloys", inputQty: 10, source: "heavy-printer" },
  { outputItem: "Packaged Thermal Composites", outputQty: 1, inputItem: "Batched Thermal Composites", inputQty: 10, source: "heavy-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (M)", outputQty: 100, inputItem: "Reinforced Alloys", inputQty: 4, source: "heavy-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (M)", outputQty: 100, inputItem: "Troilite Sulfide Grains", inputQty: 400, source: "heavy-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (M)", outputQty: 100, inputItem: "Nickel-Iron Veins", inputQty: 1000, source: "heavy-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (M)", outputQty: 100, inputItem: "Palladium", inputQty: 700, source: "heavy-printer" },
  { outputItem: "Rapid Plasma Ammo 1 (M)", outputQty: 100, inputItem: "Hydrated Sulfide Matrix", inputQty: 100, source: "heavy-printer" },
];

const DEFAULT_REFINING: RefiningRow[] = [
  // --- Refinery recipes ---
  { inputItem: "Feldspar Crystals", inputQty: 40, outputItem: "Hydrocarbon Residue", outputQty: 10, source: "refinery" },
  { inputItem: "Feldspar Crystals", inputQty: 40, outputItem: "Silica Grains", outputQty: 30, source: "refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 40, outputItem: "Hydrocarbon Residue", outputQty: 20, source: "refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 40, outputItem: "Water Ice", outputQty: 200, source: "refinery" },
  { inputItem: "Hydrocarbon Residue", inputQty: 20, outputItem: "Troilite Sulfide Grains", outputQty: 20, source: "refinery" },
  { inputItem: "Hydrocarbon Residue", inputQty: 20, outputItem: "Tholin Aggregates", outputQty: 180, source: "refinery" },
  { inputItem: "Silica Grains", inputQty: 20, outputItem: "Feldspar Crystal Shards", outputQty: 50, source: "refinery" },
  { inputItem: "Silica Grains", inputQty: 20, outputItem: "Silicon Dust", outputQty: 150, source: "refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 40, outputItem: "Silica Grains", outputQty: 10, source: "refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 40, outputItem: "Iron-Rich Nodules", outputQty: 30, source: "refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 40, outputItem: "Palladium", outputQty: 8, source: "refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Aromatic Carbon Weave", outputQty: 4, source: "refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Kerogen Tar", outputQty: 8, source: "refinery" },
  { inputItem: "D2 Fuel", inputQty: 200, outputItem: "Salt", outputQty: 1, source: "refinery" },
  { inputItem: "Eupraxite", inputQty: 10, outputItem: "EU-40 Fuel", outputQty: 600, source: "refinery" },
  { inputItem: "Iridosmine Nodules", inputQty: 40, outputItem: "Iron-Rich Nodules", outputQty: 40, source: "refinery" },
  { inputItem: "Iron-Rich Nodules", inputQty: 10, outputItem: "Platinum-Group Veins", outputQty: 20, source: "refinery" },
  { inputItem: "Iron-Rich Nodules", inputQty: 10, outputItem: "Nickel-Iron Veins", outputQty: 198, source: "refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Tholin Aggregates", outputQty: 126, source: "refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Water Ice", outputQty: 349, source: "refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Aromatic Carbon Weave", outputQty: 1, source: "refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Kerogen Tar", outputQty: 1, source: "refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Water Ice", outputQty: 50, source: "refinery" },
  { inputItem: "Primitive Kerogen Matrix", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "refinery" },
  { inputItem: "Primitive Kerogen Matrix", inputQty: 100, outputItem: "Kerogen Tar", outputQty: 16, source: "refinery" },
  { inputItem: "Rough Old Crude Matter", inputQty: 30, outputItem: "Salt", outputQty: 16, source: "refinery" },
  { inputItem: "Rough Old Crude Matter", inputQty: 30, outputItem: "Sophrogon", outputQty: 28, source: "refinery" },
  { inputItem: "Rough Young Crude Matter", inputQty: 30, outputItem: "Salt", outputQty: 1, source: "refinery" },
  { inputItem: "Rough Young Crude Matter", inputQty: 30, outputItem: "Eupraxite", outputQty: 28, source: "refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Carbon Weave", outputQty: 1, source: "refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Thermal Composites", outputQty: 2, source: "refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Reinforced Alloys", outputQty: 6, source: "refinery" },
  { inputItem: "Sophrogon", inputQty: 10, outputItem: "SOF-40 Fuel", outputQty: 600, source: "refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Sophrogon", outputQty: 3, source: "refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Brine", outputQty: 26, source: "refinery" },
  { inputItem: "Tholin Nodules", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "refinery" },
  { inputItem: "Tholin Nodules", inputQty: 100, outputItem: "Aromatic Carbon Weave", outputQty: 8, source: "refinery" },
  { inputItem: "Water Ice", inputQty: 275, outputItem: "D1 Fuel", outputQty: 75, source: "refinery" },
  // --- Heavy Refinery recipes ---
  { inputItem: "Feldspar Crystals", inputQty: 120, outputItem: "Hydrocarbon Residue", outputQty: 30, source: "heavy-refinery" },
  { inputItem: "Feldspar Crystals", inputQty: 120, outputItem: "Silica Grains", outputQty: 90, source: "heavy-refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Aromatic Carbon Weave", outputQty: 4, source: "heavy-refinery" },
  { inputItem: "Aromatic Carbon Veins", inputQty: 100, outputItem: "Kerogen Tar", outputQty: 8, source: "heavy-refinery" },
  { inputItem: "D2 Fuel", inputQty: 200, outputItem: "Salt", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Eupraxite", inputQty: 10, outputItem: "EU-40 Fuel", outputQty: 600, source: "heavy-refinery" },
  { inputItem: "Fine Young Crude Matter", inputQty: 30, outputItem: "Eupraxite", outputQty: 3, source: "heavy-refinery" },
  { inputItem: "Fine Young Crude Matter", inputQty: 30, outputItem: "Brine", outputQty: 26, source: "heavy-refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 120, outputItem: "Hydrocarbon Residue", outputQty: 60, source: "heavy-refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 120, outputItem: "Water Ice", outputQty: 600, source: "heavy-refinery" },
  { inputItem: "Hydrocarbon Residue", inputQty: 60, outputItem: "Troilite Sulfide Grains", outputQty: 60, source: "heavy-refinery" },
  { inputItem: "Hydrocarbon Residue", inputQty: 60, outputItem: "Tholin Aggregates", outputQty: 540, source: "heavy-refinery" },
  { inputItem: "Iridosmine Nodules", inputQty: 120, outputItem: "Iron-Rich Nodules", outputQty: 120, source: "heavy-refinery" },
  { inputItem: "Iron-Rich Nodules", inputQty: 60, outputItem: "Platinum-Group Veins", outputQty: 60, source: "heavy-refinery" },
  { inputItem: "Iron-Rich Nodules", inputQty: 60, outputItem: "Nickel-Iron Veins", outputQty: 594, source: "heavy-refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Tholin Aggregates", outputQty: 126, source: "heavy-refinery" },
  { inputItem: "Methane Ice Shards", inputQty: 100, outputItem: "Water Ice", outputQty: 349, source: "heavy-refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Aromatic Carbon Weave", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Kerogen Tar", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Mummified Clone", inputQty: 5, outputItem: "Water Ice", outputQty: 50, source: "heavy-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 120, outputItem: "Silica Grains", outputQty: 30, source: "heavy-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 120, outputItem: "Iron-Rich Nodules", outputQty: 90, source: "heavy-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 120, outputItem: "Palladium", outputQty: 24, source: "heavy-refinery" },
  { inputItem: "Primitive Kerogen Matrix", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Primitive Kerogen Matrix", inputQty: 100, outputItem: "Kerogen Tar", outputQty: 16, source: "heavy-refinery" },
  { inputItem: "Rough Old Crude Matter", inputQty: 30, outputItem: "Salt", outputQty: 16, source: "heavy-refinery" },
  { inputItem: "Rough Old Crude Matter", inputQty: 30, outputItem: "Sophrogon", outputQty: 28, source: "heavy-refinery" },
  { inputItem: "Rough Young Crude Matter", inputQty: 30, outputItem: "Salt", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Rough Young Crude Matter", inputQty: 30, outputItem: "Eupraxite", outputQty: 28, source: "heavy-refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Carbon Weave", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Thermal Composites", outputQty: 2, source: "heavy-refinery" },
  { inputItem: "Salvaged Materials", inputQty: 10, outputItem: "Reinforced Alloys", outputQty: 6, source: "heavy-refinery" },
  { inputItem: "Silica Grains", inputQty: 60, outputItem: "Feldspar Crystal Shards", outputQty: 150, source: "heavy-refinery" },
  { inputItem: "Silica Grains", inputQty: 60, outputItem: "Silicon Dust", outputQty: 450, source: "heavy-refinery" },
  { inputItem: "Sophrogon", inputQty: 10, outputItem: "SOF-40 Fuel", outputQty: 600, source: "heavy-refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Sophrogon", outputQty: 3, source: "heavy-refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Brine", outputQty: 26, source: "heavy-refinery" },
  { inputItem: "Tholin Nodules", inputQty: 100, outputItem: "Chitinous Organics", outputQty: 1, source: "heavy-refinery" },
  { inputItem: "Tholin Nodules", inputQty: 100, outputItem: "Aromatic Carbon Weave", outputQty: 8, source: "heavy-refinery" },
  { inputItem: "Water Ice", inputQty: 275, outputItem: "D1 Fuel", outputQty: 75, source: "heavy-refinery" },
  // --- Field Refinery recipes ---
  { inputItem: "Feldspar Crystals", inputQty: 20, outputItem: "Hydrocarbon Residue", outputQty: 5, source: "field-refinery" },
  { inputItem: "Feldspar Crystals", inputQty: 20, outputItem: "Silica Grains", outputQty: 15, source: "field-refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 20, outputItem: "Hydrocarbon Residue", outputQty: 10, source: "field-refinery" },
  { inputItem: "Hydrated Sulfide Matrix", inputQty: 20, outputItem: "Water Ice", outputQty: 150, source: "field-refinery" },
  { inputItem: "Water Ice", inputQty: 275, outputItem: "D1 Fuel", outputQty: 75, source: "field-refinery" },
  { inputItem: "D2 Fuel", inputQty: 200, outputItem: "Salt", outputQty: 1, source: "field-refinery" },
  { inputItem: "Fine Young Crude Matter", inputQty: 30, outputItem: "Eupraxite", outputQty: 3, source: "field-refinery" },
  { inputItem: "Fine Young Crude Matter", inputQty: 30, outputItem: "Brine", outputQty: 26, source: "field-refinery" },
  { inputItem: "Mummified Clone", inputQty: 1, outputItem: "Water Ice", outputQty: 7, source: "field-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 20, outputItem: "Silica Grains", outputQty: 8, source: "field-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 20, outputItem: "Iron-Rich Nodules", outputQty: 15, source: "field-refinery" },
  { inputItem: "Platinum-Palladium Matrix", inputQty: 20, outputItem: "Palladium", outputQty: 4, source: "field-refinery" },
  { inputItem: "Salvaged Materials", inputQty: 3, outputItem: "Reinforced Alloys", outputQty: 1, source: "field-refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Sophrogon", outputQty: 3, source: "field-refinery" },
  { inputItem: "Fine Old Crude Matter", inputQty: 30, outputItem: "Brine", outputQty: 26, source: "field-refinery" },
];

const DEFAULT_GATHER: GatherRow[] = [
  { item: "Feldspar Crystals" },
  { item: "Hydrated Sulfide Matrix" },
  { item: "Nickel-Iron Veins" },
  { item: "Platinum-Palladium Matrix" },
  { item: "Methane Ice Shards" },
  { item: "Iridosmine Nodules" },
  { item: "Water Ice" },
  { item: "D2 Fuel" },
  { item: "Fine Young Crude Matter" },
  { item: "Fine Old Crude Matter" },
  { item: "Mummified Clone" },
  { item: "Salvaged Materials" },
  { item: "Iron-Rich Nodules" },
  { item: "Aromatic Carbon Veins" },
  { item: "Primitive Kerogen Matrix" },
  { item: "Rough Old Crude Matter" },
  { item: "Rough Young Crude Matter" },
  { item: "Tholin Nodules" },
  { item: "Eupraxite" },
  { item: "Sophrogon" },
];

const DEFAULT_SHIPBUILDING: ShipbuildingRow[] = [
  // --- Mini Berth recipes ---
  { ship: "Carom", component: "Carom Stack", qty: 1, source: "mini-berth" },
  { ship: "Carom", component: "Nomad Program Frame", qty: 2, source: "mini-berth" },
  { ship: "Carom", component: "Carbon Weave", qty: 44, source: "mini-berth" },
  { ship: "Carom", component: "Thermal Composites", qty: 44, source: "mini-berth" },
  { ship: "Carom", component: "Reinforced Alloys", qty: 88, source: "mini-berth" },
  { ship: "Recurve", component: "Nomad Program Frame", qty: 2, source: "mini-berth" },
  { ship: "Recurve", component: "Carbon Weave", qty: 25, source: "mini-berth" },
  { ship: "Recurve", component: "Thermal Composites", qty: 25, source: "mini-berth" },
  { ship: "Recurve", component: "Reinforced Alloys", qty: 45, source: "mini-berth" },
  { ship: "Recurve", component: "Still Knot", qty: 2, source: "mini-berth" },
  { ship: "Reflex", component: "Nomad Program Frame", qty: 1, source: "mini-berth" },
  { ship: "Reflex", component: "Reinforced Alloys", qty: 28, source: "mini-berth" },
  { ship: "Reflex", component: "Hydrocarbon Residue", qty: 40, source: "mini-berth" },
  { ship: "Reiver", component: "Nomad Program Frame", qty: 2, source: "mini-berth" },
  { ship: "Reiver", component: "Carbon Weave", qty: 33, source: "mini-berth" },
  { ship: "Reiver", component: "Thermal Composites", qty: 33, source: "mini-berth" },
  { ship: "Reiver", component: "Reinforced Alloys", qty: 79, source: "mini-berth" },
  { ship: "Stride", component: "Stride Stack", qty: 1, source: "mini-berth" },
  { ship: "Stride", component: "Nomad Program Frame", qty: 2, source: "mini-berth" },
  { ship: "Stride", component: "Carbon Weave", qty: 48, source: "mini-berth" },
  { ship: "Stride", component: "Thermal Composites", qty: 48, source: "mini-berth" },
  { ship: "Stride", component: "Reinforced Alloys", qty: 96, source: "mini-berth" },
  { ship: "Wend", component: "Nomad Program Frame", qty: 1, source: "mini-berth" },
  { ship: "Wend", component: "Carbon Weave", qty: 17, source: "mini-berth" },
  { ship: "Wend", component: "Thermal Composites", qty: 17, source: "mini-berth" },
  { ship: "Wend", component: "Reinforced Alloys", qty: 34, source: "mini-berth" },
  // --- Field Printer (ship builds at printer) ---
  { ship: "Reflex", component: "Nomad Program Frame", qty: 1, source: "field-printer" },
  { ship: "Reflex", component: "Reinforced Alloys", qty: 28, source: "field-printer" },
  { ship: "Reflex", component: "Hydrocarbon Residue", qty: 40, source: "field-printer" },
];

const DEFAULT_ASSEMBLY: AssemblyRow[] = [
  // --- Adaptive Nanitic Armor Weave ---
  { module: "Adaptive Nanitic Armor Weave II", component: "Thermal Composites", qty: 1, source: "assembler" },
  { module: "Adaptive Nanitic Armor Weave III", component: "Thermal Composites", qty: 1, source: "assembler" },
  { module: "Adaptive Nanitic Armor Weave III", component: "Still Kernel", qty: 1, source: "assembler" },
  { module: "Adaptive Nanitic Armor Weave IV", component: "Thermal Composites", qty: 12, source: "assembler" },
  { module: "Adaptive Nanitic Armor Weave IV", component: "Still Kernel", qty: 6, source: "assembler" },
  // --- Afterburner ---
  { module: "Afterburner II", component: "Thermal Composites", qty: 1, source: "assembler" },
  { module: "Afterburner III", component: "Thermal Composites", qty: 1, source: "assembler" },
  { module: "Afterburner III", component: "Still Kernel", qty: 1, source: "assembler" },
  { module: "Afterburner IV", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Afterburner IV", component: "Carbon Weave", qty: 4, source: "assembler" },
  { module: "Afterburner IV", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Afterburner IV", component: "Still Kernel", qty: 3, source: "assembler" },
  // --- Attuned Shield Generator ---
  { module: "Attuned Shield Generator II", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Attuned Shield Generator II", component: "Carbon Weave", qty: 8, source: "assembler" },
  { module: "Attuned Shield Generator III", component: "Printed Circuits", qty: 12, source: "assembler" },
  { module: "Attuned Shield Generator III", component: "Carbon Weave", qty: 24, source: "assembler" },
  { module: "Attuned Shield Generator IV", component: "Printed Circuits", qty: 31, source: "assembler" },
  { module: "Attuned Shield Generator IV", component: "Carbon Weave", qty: 62, source: "assembler" },
  // --- Base Autocannon ---
  { module: "Base Autocannon (S)", component: "Iron-Rich Nodules", qty: 10, source: "assembler" },
  { module: "Base Autocannon (S)", component: "Silica Grains", qty: 30, source: "assembler" },
  // --- Base Coilgun ---
  { module: "Base Coilgun (M)", component: "Platinum-Group Veins", qty: 120, source: "assembler" },
  { module: "Base Coilgun (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Base Coilgun (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Base Coilgun (M)", component: "Palladium", qty: 120, source: "assembler" },
  { module: "Base Coilgun (S)", component: "Platinum-Group Veins", qty: 60, source: "assembler" },
  { module: "Base Coilgun (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Base Coilgun (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Base Coilgun (S)", component: "Palladium", qty: 60, source: "assembler" },
  // --- Base Howitzer ---
  { module: "Base Howitzer (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Base Howitzer (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Base Howitzer (M)", component: "Feldspar Crystal Shards", qty: 120, source: "assembler" },
  // --- Base Rapid Plasma ---
  { module: "Base Rapid Plasma (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Base Rapid Plasma (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Base Rapid Plasma (S)", component: "Troilite Sulfide Grains", qty: 90, source: "assembler" },
  // --- Bulky Armor Plates ---
  { module: "Bulky Armor Plates II", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Bulky Armor Plates III", component: "Reinforced Alloys", qty: 7, source: "assembler" },
  { module: "Bulky Armor Plates V", component: "Reinforced Alloys", qty: 24, source: "assembler" },
  // --- Bulwark Shield Generator ---
  { module: "Bulwark Shield Generator II", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Bulwark Shield Generator II", component: "Carbon Weave", qty: 7, source: "assembler" },
  { module: "Bulwark Shield Generator II", component: "Palladium", qty: 150, source: "assembler" },
  { module: "Bulwark Shield Generator III", component: "Printed Circuits", qty: 12, source: "assembler" },
  { module: "Bulwark Shield Generator III", component: "Carbon Weave", qty: 21, source: "assembler" },
  { module: "Bulwark Shield Generator III", component: "Palladium", qty: 450, source: "assembler" },
  { module: "Bulwark Shield Generator IV", component: "Printed Circuits", qty: 31, source: "assembler" },
  { module: "Bulwark Shield Generator IV", component: "Carbon Weave", qty: 60, source: "assembler" },
  { module: "Bulwark Shield Generator IV", component: "Palladium", qty: 600, source: "assembler" },
  // --- Cargo Grid ---
  { module: "Cargo Grid II", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Cargo Grid II", component: "Carbon Weave", qty: 7, source: "assembler" },
  { module: "Cargo Grid III", component: "Reinforced Alloys", qty: 7, source: "assembler" },
  { module: "Cargo Grid III", component: "Carbon Weave", qty: 13, source: "assembler" },
  { module: "Cargo Grid IV", component: "Reinforced Alloys", qty: 14, source: "assembler" },
  { module: "Cargo Grid IV", component: "Carbon Weave", qty: 26, source: "assembler" },
  { module: "Cargo Grid V", component: "Reinforced Alloys", qty: 28, source: "assembler" },
  { module: "Cargo Grid V", component: "Carbon Weave", qty: 52, source: "assembler" },
  { module: "Cargo Grid VI", component: "Reinforced Alloys", qty: 56, source: "assembler" },
  { module: "Cargo Grid VI", component: "Carbon Weave", qty: 104, source: "assembler" },
  // --- Celerity ---
  { module: "Celerity CD01", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Celerity CD01", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Celerity CD01", component: "Thermal Composites", qty: 8, source: "assembler" },
  { module: "Celerity CD02", component: "Printed Circuits", qty: 8, source: "assembler" },
  { module: "Celerity CD02", component: "Reinforced Alloys", qty: 8, source: "assembler" },
  { module: "Celerity CD02", component: "Thermal Composites", qty: 16, source: "assembler" },
  { module: "Celerity CD02", component: "Still Kernel", qty: 1, source: "assembler" },
  { module: "Celerity CD03", component: "Printed Circuits", qty: 16, source: "assembler" },
  { module: "Celerity CD03", component: "Reinforced Alloys", qty: 16, source: "assembler" },
  { module: "Celerity CD03", component: "Thermal Composites", qty: 32, source: "assembler" },
  { module: "Celerity CD03", component: "Still Kernel", qty: 2, source: "assembler" },
  // --- Coated Armor Plates ---
  { module: "Coated Armor Plates II", component: "Carbon Weave", qty: 4, source: "assembler" },
  { module: "Coated Armor Plates III", component: "Carbon Weave", qty: 7, source: "assembler" },
  { module: "Coated Armor Plates IV", component: "Carbon Weave", qty: 16, source: "assembler" },
  // --- Crude Extractor ---
  { module: "Crude Extractor", component: "Printed Circuits", qty: 3, source: "assembler" },
  { module: "Crude Extractor", component: "Carbon Weave", qty: 5, source: "assembler" },
  // --- Cryogenic Ejector ---
  { module: "Cryogenic Ejector S", component: "Platinum-Group Veins", qty: 35, source: "assembler" },
  { module: "Cryogenic Ejector S", component: "Reinforced Alloys", qty: 6, source: "assembler" },
  { module: "Cryogenic Ejector S", component: "D1 Fuel", qty: 560, source: "assembler" },
  { module: "Cryogenic Ejector S", component: "Palladium", qty: 35, source: "assembler" },
  // --- EM Field Array ---
  { module: "EM Field Array II", component: "Carbon Weave", qty: 12, source: "assembler" },
  { module: "EM Field Array III", component: "Carbon Weave", qty: 16, source: "assembler" },
  { module: "EM Field Array IV", component: "Carbon Weave", qty: 19, source: "assembler" },
  // --- Embark ---
  { module: "Embark", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Embark", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Embark", component: "Thermal Composites", qty: 4, source: "assembler" },
  // --- Explonetic-Electro Nanitic Brace ---
  { module: "Explonetic-Electro Nanitic Brace II", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace II", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace II", component: "Thermal Composites", qty: 1, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace III", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace III", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace III", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace IV", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace IV", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Explonetic-Electro Nanitic Brace IV", component: "Thermal Composites", qty: 11, source: "assembler" },
  // --- Explosive Field Array ---
  { module: "Explosive Field Array II", component: "Reinforced Alloys", qty: 6, source: "assembler" },
  { module: "Explosive Field Array II", component: "Thermal Composites", qty: 6, source: "assembler" },
  { module: "Explosive Field Array III", component: "Reinforced Alloys", qty: 7, source: "assembler" },
  { module: "Explosive Field Array III", component: "Thermal Composites", qty: 7, source: "assembler" },
  { module: "Explosive Field Array IV", component: "Reinforced Alloys", qty: 9, source: "assembler" },
  { module: "Explosive Field Array IV", component: "Thermal Composites", qty: 8, source: "assembler" },
  // --- Heat Exchanger ---
  { module: "Heat Exchanger S", component: "Platinum-Group Veins", qty: 35, source: "assembler" },
  { module: "Heat Exchanger S", component: "Reinforced Alloys", qty: 6, source: "assembler" },
  { module: "Heat Exchanger S", component: "D1 Fuel", qty: 560, source: "assembler" },
  { module: "Heat Exchanger S", component: "Palladium", qty: 35, source: "assembler" },
  { module: "Heat Exchanger XS", component: "Reinforced Alloys", qty: 3, source: "assembler" },
  { module: "Heat Exchanger XS", component: "D1 Fuel", qty: 280, source: "assembler" },
  { module: "Heat Exchanger XS", component: "Palladium", qty: 2, source: "assembler" },
  // --- Hop ---
  { module: "Hop", component: "Thermal Composites", qty: 2, source: "assembler" },
  { module: "Hop", component: "Printed Circuits", qty: 1, source: "assembler" },
  // --- Hull Repairer ---
  { module: "Hull Repairer", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Hull Repairer", component: "Carbon Weave", qty: 2, source: "assembler" },
  // --- Kinetic Field Array ---
  { module: "Kinetic Field Array II", component: "Reinforced Alloys", qty: 8, source: "assembler" },
  { module: "Kinetic Field Array III", component: "Reinforced Alloys", qty: 10, source: "assembler" },
  { module: "Kinetic Field Array IV", component: "Reinforced Alloys", qty: 12, source: "assembler" },
  // --- Large Cutting Laser ---
  { module: "Large Cutting Laser", component: "Printed Circuits", qty: 7, source: "assembler" },
  { module: "Large Cutting Laser", component: "Carbon Weave", qty: 15, source: "assembler" },
  // --- Leap ---
  { module: "Leap", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Leap", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Leap", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  // --- Lunge ---
  { module: "Lunge", component: "Thermal Composites", qty: 8, source: "assembler" },
  { module: "Lunge", component: "Printed Circuits", qty: 16, source: "assembler" },
  { module: "Lunge", component: "Reinforced Alloys", qty: 16, source: "assembler" },
  // --- Medium Cutting Laser ---
  { module: "Medium Cutting Laser", component: "Printed Circuits", qty: 5, source: "assembler" },
  { module: "Medium Cutting Laser", component: "Carbon Weave", qty: 10, source: "assembler" },
  // --- Nimble Armor Plates ---
  { module: "Nimble Armor Plates II", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Nimble Armor Plates II", component: "Carbon Weave", qty: 1, source: "assembler" },
  { module: "Nimble Armor Plates III", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Nimble Armor Plates III", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Nimble Armor Plates IV", component: "Reinforced Alloys", qty: 8, source: "assembler" },
  { module: "Nimble Armor Plates IV", component: "Carbon Weave", qty: 4, source: "assembler" },
  // --- Rapid Plasma (M) ---
  { module: "Rapid Plasma (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Rapid Plasma (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Rapid Plasma (M)", component: "Troilite Sulfide Grains", qty: 180, source: "assembler" },
  // --- Reactive Armor Plates ---
  { module: "Reactive Armor Plates II", component: "Carbon Weave", qty: 3, source: "assembler" },
  { module: "Reactive Armor Plates II", component: "Thermal Composites", qty: 3, source: "assembler" },
  { module: "Reactive Armor Plates III", component: "Carbon Weave", qty: 6, source: "assembler" },
  { module: "Reactive Armor Plates III", component: "Thermal Composites", qty: 6, source: "assembler" },
  { module: "Reactive Armor Plates IV", component: "Carbon Weave", qty: 11, source: "assembler" },
  { module: "Reactive Armor Plates IV", component: "Thermal Composites", qty: 11, source: "assembler" },
  // --- Reinforced Shield Generator ---
  { module: "Reinforced Shield Generator II", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Reinforced Shield Generator II", component: "Carbon Weave", qty: 8, source: "assembler" },
  { module: "Reinforced Shield Generator III", component: "Printed Circuits", qty: 12, source: "assembler" },
  { module: "Reinforced Shield Generator III", component: "Carbon Weave", qty: 24, source: "assembler" },
  { module: "Reinforced Shield Generator IV", component: "Printed Circuits", qty: 31, source: "assembler" },
  { module: "Reinforced Shield Generator IV", component: "Carbon Weave", qty: 62, source: "assembler" },
  // --- Shield Restorer ---
  { module: "Shield Restorer II", component: "Platinum-Group Veins", qty: 13, source: "assembler" },
  { module: "Shield Restorer II", component: "Printed Circuits", qty: 17, source: "assembler" },
  { module: "Shield Restorer II", component: "Carbon Weave", qty: 17, source: "assembler" },
  { module: "Shield Restorer III", component: "Platinum-Group Veins", qty: 15, source: "assembler" },
  { module: "Shield Restorer III", component: "Printed Circuits", qty: 20, source: "assembler" },
  { module: "Shield Restorer III", component: "Carbon Weave", qty: 19, source: "assembler" },
  { module: "Shield Restorer IV", component: "Platinum-Group Veins", qty: 13, source: "assembler" },
  { module: "Shield Restorer IV", component: "Printed Circuits", qty: 17, source: "assembler" },
  { module: "Shield Restorer IV", component: "Carbon Weave", qty: 17, source: "assembler" },
  { module: "Shield Restorer IV", component: "Still Knot", qty: 3, source: "assembler" },
  // --- Small Cutting Laser ---
  { module: "Small Cutting Laser", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Small Cutting Laser", component: "Carbon Weave", qty: 3, source: "assembler" },
  // --- Sojourn ---
  { module: "Sojourn", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Sojourn", component: "Hydrocarbon Residue", qty: 10, source: "assembler" },
  // --- Stasis Net ---
  { module: "Stasis Net II", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Stasis Net II", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Stasis Net II", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Stasis Net III", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Stasis Net III", component: "Reinforced Alloys", qty: 3, source: "assembler" },
  { module: "Stasis Net III", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Stasis Net IV", component: "Printed Circuits", qty: 3, source: "assembler" },
  { module: "Stasis Net IV", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Stasis Net IV", component: "Thermal Composites", qty: 5, source: "assembler" },
  { module: "Stasis Net V", component: "Printed Circuits", qty: 3, source: "assembler" },
  { module: "Stasis Net V", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Stasis Net V", component: "Thermal Composites", qty: 5, source: "assembler" },
  { module: "Stasis Net VI", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Stasis Net VI", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Stasis Net VI", component: "Thermal Composites", qty: 6, source: "assembler" },
  // --- Systemic Armor Restorer ---
  { module: "Systemic Armor Restorer II", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Systemic Armor Restorer II", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Systemic Armor Restorer III", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Systemic Armor Restorer III", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Systemic Armor Restorer III", component: "Still Kernel", qty: 1, source: "assembler" },
  { module: "Systemic Armor Restorer IV", component: "Printed Circuits", qty: 22, source: "assembler" },
  { module: "Systemic Armor Restorer IV", component: "Reinforced Alloys", qty: 22, source: "assembler" },
  { module: "Systemic Armor Restorer IV", component: "Still Kernel", qty: 4, source: "assembler" },
  // --- Tempo CD42 ---
  { module: "Tempo CD42", component: "Printed Circuits", qty: 8, source: "assembler" },
  { module: "Tempo CD42", component: "Reinforced Alloys", qty: 8, source: "assembler" },
  { module: "Tempo CD42", component: "Thermal Composites", qty: 16, source: "assembler" },
  { module: "Tempo CD42", component: "Still Kernel", qty: 1, source: "assembler" },
  // --- Thermal Field Array ---
  { module: "Thermal Field Array II", component: "Thermal Composites", qty: 12, source: "assembler" },
  { module: "Thermal Field Array III", component: "Thermal Composites", qty: 16, source: "assembler" },
  { module: "Thermal Field Array IV", component: "Thermal Composites", qty: 19, source: "assembler" },
  { module: "Thermal Field Array V", component: "Thermal Composites", qty: 22, source: "assembler" },
  // --- Thermal-Electro Nanitic Brace ---
  { module: "Thermal-Electro Nanitic Brace II", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace II", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace II", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace III", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace III", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace III", component: "Thermal Composites", qty: 9, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace IV", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace IV", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Thermal-Electro Nanitic Brace IV", component: "Thermal Composites", qty: 20, source: "assembler" },
  // --- Thermalnetic Nanitic Brace ---
  { module: "Thermalnetic Nanitic Brace II", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace II", component: "Carbon Weave", qty: 2, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace II", component: "Thermal Composites", qty: 4, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace III", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace III", component: "Thermal Composites", qty: 12, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace IV", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Thermalnetic Nanitic Brace IV", component: "Thermal Composites", qty: 24, source: "assembler" },
  // --- Tier 2 Autocannon ---
  { module: "Tier 2 Autocannon (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Tier 2 Autocannon (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 2 Autocannon (S)", component: "Feldspar Crystal Shards", qty: 125, source: "assembler" },
  // --- Tier 2 Coilgun ---
  { module: "Tier 2 Coilgun (M)", component: "Platinum-Group Veins", qty: 70, source: "assembler" },
  { module: "Tier 2 Coilgun (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 2 Coilgun (M)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 2 Coilgun (M)", component: "Palladium", qty: 70, source: "assembler" },
  { module: "Tier 2 Coilgun (S)", component: "Platinum-Group Veins", qty: 140, source: "assembler" },
  { module: "Tier 2 Coilgun (S)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 2 Coilgun (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  // --- Tier 2 Howitzer ---
  { module: "Tier 2 Howitzer (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 2 Howitzer (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Tier 2 Howitzer (M)", component: "Feldspar Crystal Shards", qty: 250, source: "assembler" },
  // --- Tier 2 Rapid Plasma ---
  { module: "Tier 2 Rapid Plasma (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 2 Rapid Plasma (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Tier 2 Rapid Plasma (M)", component: "Troilite Sulfide Grains", qty: 300, source: "assembler" },
  { module: "Tier 2 Rapid Plasma (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Tier 2 Rapid Plasma (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 2 Rapid Plasma (S)", component: "Troilite Sulfide Grains", qty: 150, source: "assembler" },
  // --- Tier 3 Autocannon ---
  { module: "Tier 3 Autocannon (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Tier 3 Autocannon (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 3 Autocannon (S)", component: "Feldspar Crystal Shards", qty: 170, source: "assembler" },
  // --- Tier 3 Coilgun ---
  { module: "Tier 3 Coilgun (M)", component: "Platinum-Group Veins", qty: 440, source: "assembler" },
  { module: "Tier 3 Coilgun (M)", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Tier 3 Coilgun (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Tier 3 Coilgun (S)", component: "Platinum-Group Veins", qty: 110, source: "assembler" },
  { module: "Tier 3 Coilgun (S)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 3 Coilgun (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 3 Coilgun (S)", component: "Palladium", qty: 110, source: "assembler" },
  // --- Tier 3 Howitzer ---
  { module: "Tier 3 Howitzer (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 3 Howitzer (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Tier 3 Howitzer (M)", component: "Feldspar Crystal Shards", qty: 340, source: "assembler" },
  // --- Tier 3 Rapid Plasma ---
  { module: "Tier 3 Rapid Plasma (M)", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Tier 3 Rapid Plasma (M)", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Tier 3 Rapid Plasma (M)", component: "Troilite Sulfide Grains", qty: 420, source: "assembler" },
  { module: "Tier 3 Rapid Plasma (S)", component: "Printed Circuits", qty: 1, source: "assembler" },
  { module: "Tier 3 Rapid Plasma (S)", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tier 3 Rapid Plasma (S)", component: "Troilite Sulfide Grains", qty: 210, source: "assembler" },
  // --- Tuho ---
  { module: "Tuho 7", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Tuho 7", component: "Reinforced Alloys", qty: 1, source: "assembler" },
  { module: "Tuho 9", component: "Printed Circuits", qty: 5, source: "assembler" },
  { module: "Tuho 9", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  // --- Velocity ---
  { module: "Velocity CD81", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Velocity CD81", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Velocity CD81", component: "Thermal Composites", qty: 8, source: "assembler" },
  { module: "Velocity CD82", component: "Printed Circuits", qty: 8, source: "assembler" },
  { module: "Velocity CD82", component: "Reinforced Alloys", qty: 8, source: "assembler" },
  { module: "Velocity CD82", component: "Thermal Composites", qty: 16, source: "assembler" },
  { module: "Velocity CD82", component: "Still Kernel", qty: 2, source: "assembler" },
  // --- Warp Entangler ---
  { module: "Warp Entangler II", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Warp Entangler II", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Warp Entangler II", component: "Carbon Weave", qty: 3, source: "assembler" },
  { module: "Warp Entangler III", component: "Printed Circuits", qty: 2, source: "assembler" },
  { module: "Warp Entangler III", component: "Reinforced Alloys", qty: 3, source: "assembler" },
  { module: "Warp Entangler III", component: "Carbon Weave", qty: 3, source: "assembler" },
  { module: "Warp Entangler IV", component: "Printed Circuits", qty: 3, source: "assembler" },
  { module: "Warp Entangler IV", component: "Reinforced Alloys", qty: 3, source: "assembler" },
  { module: "Warp Entangler IV", component: "Carbon Weave", qty: 4, source: "assembler" },
  { module: "Warp Entangler V", component: "Printed Circuits", qty: 3, source: "assembler" },
  { module: "Warp Entangler V", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Warp Entangler V", component: "Carbon Weave", qty: 4, source: "assembler" },
  { module: "Warp Entangler VI", component: "Printed Circuits", qty: 4, source: "assembler" },
  { module: "Warp Entangler VI", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Warp Entangler VI", component: "Carbon Weave", qty: 5, source: "assembler" },
  // --- Xoru ---
  { module: "Xoru 7", component: "Printed Circuits", qty: 8, source: "assembler" },
  { module: "Xoru 7", component: "Reinforced Alloys", qty: 2, source: "assembler" },
  { module: "Xoru 9", component: "Printed Circuits", qty: 8, source: "assembler" },
  { module: "Xoru 9", component: "Reinforced Alloys", qty: 4, source: "assembler" },
  { module: "Xoru S", component: "Printed Circuits", qty: 10, source: "assembler" },
  { module: "Xoru S", component: "Reinforced Alloys", qty: 4, source: "assembler" },
];

// Mutable custom recipe overlays
let customConstruction: ConstructionRow[] = [];
let customIndustry: IndustryRow[] = [];
let customRefining: RefiningRow[] = [];
let customGather: GatherRow[] = [];
let customShipbuilding: ShipbuildingRow[] = [];
let customAssembly: AssemblyRow[] = [];

function getConstruction(): ConstructionRow[] { return [...DEFAULT_CONSTRUCTION, ...customConstruction]; }
function getIndustry(): IndustryRow[] { return [...DEFAULT_INDUSTRY, ...customIndustry]; }
function getRefining(): RefiningRow[] { return [...DEFAULT_REFINING, ...customRefining]; }
function getGather(): GatherRow[] { return [...DEFAULT_GATHER, ...customGather]; }
function getShipbuilding(): ShipbuildingRow[] { return [...DEFAULT_SHIPBUILDING, ...customShipbuilding]; }
function getAssembly(): AssemblyRow[] { return [...DEFAULT_ASSEMBLY, ...customAssembly]; }

/** Replace custom recipe overlays (merged with defaults at read-time). */
export function setCustomRecipes(data: Partial<RecipeData>) {
  if (data.construction) customConstruction = data.construction;
  if (data.industry) customIndustry = data.industry;
  if (data.refining) customRefining = data.refining;
  if (data.gather) customGather = data.gather;
  if (data.shipbuilding) customShipbuilding = data.shipbuilding;
  if (data.assembly) customAssembly = data.assembly;
}

/** Get current custom recipes (excludes defaults). */
export function getCustomRecipes(): RecipeData {
  return { construction: customConstruction, industry: customIndustry, refining: customRefining, gather: customGather, shipbuilding: customShipbuilding, assembly: customAssembly };
}

/** Get all recipes (defaults + custom). */
export function getAllRecipes(): RecipeData {
  return { construction: getConstruction(), industry: getIndustry(), refining: getRefining(), gather: getGather(), shipbuilding: getShipbuilding(), assembly: getAssembly() };
}

// --- Helpers ---

function matchName(a: string, b: string): boolean {
  if (a === b) return true;
  return a.toLowerCase().replace(/s$/, "") === b.toLowerCase().replace(/s$/, "");
}

function buildRefiningLookupFrom(refiningRows: RefiningRow[]) {
  const map = new Map<string, { inputItem: string; inputQty: number; outputQty: number }[]>();
  for (const r of refiningRows) {
    if (!map.has(r.outputItem)) map.set(r.outputItem, []);
    map.get(r.outputItem)!.push({
      inputItem: r.inputItem,
      inputQty: r.inputQty,
      outputQty: r.outputQty,
    });
  }
  return map;
}

/** Group industry recipes by source tag for a given output item. */
function groupBySource(item: string, INDUSTRY: IndustryRow[]): Map<string, IndustryRow[]> {
  const matching = INDUSTRY.filter((r) => matchName(r.outputItem, item));
  const groups = new Map<string, IndustryRow[]>();
  for (const r of matching) {
    const src = r.source ?? "default";
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src)!.push(r);
  }
  return groups;
}

/**
 * Walk the full industry + refining supply chain from a set of initial material needs.
 * Handles multi-level industry chains (e.g. Building Foam → Reinforced Alloys → ores).
 * Items are expanded in topological order: higher-level outputs before their dependencies.
 * Alternative recipe sources (e.g. field-printer vs mini-printer) are collected as separate missions.
 */
function walkSupplyChain(
  initialNeeds: Map<string, number>,
  INDUSTRY: IndustryRow[],
  REFINING: RefiningRow[],
): { needs: Map<string, number>; altMissions: Mission[] } {
  const refLookup = buildRefiningLookupFrom(REFINING);
  const industryOutputs = new Set(INDUSTRY.map((r) => r.outputItem));
  const refiningOutputs = new Set(REFINING.map((r) => r.outputItem));
  const needs = new Map(initialNeeds);
  const altNeeds = new Map<string, number>();
  const altReasons = new Map<string, string>();  // material → "OutputItem via source-tag"
  const expanded = new Set<string>();

  // --- Phase 1: Walk industry chain in topological order ---
  let changed = true;
  while (changed) {
    changed = false;
    for (const [item] of needs) {
      if (expanded.has(item)) continue;
      if (!industryOutputs.has(item)) continue;
      if (ACQUIRABLE_ITEMS.has(item)) continue;

      // Check: would any unexpanded industry parent add more to this item?
      let canExpand = true;
      for (const [parent] of needs) {
        if (expanded.has(parent) || parent === item) continue;
        if (!industryOutputs.has(parent) || ACQUIRABLE_ITEMS.has(parent)) continue;
        const pGroups = groupBySource(parent, INDUSTRY);
        if (pGroups.size === 0) continue;
        const primary = [...pGroups.values()][0];
        if (primary.some((r) => matchName(r.inputItem, item))) {
          canExpand = false;
          break;
        }
      }
      if (!canExpand) continue;

      const qty = needs.get(item)!;
      const groups = groupBySource(item, INDUSTRY);
      let isFirst = true;
      for (const [sourceTag, recipes] of groups) {
        const jobs = Math.ceil(qty / recipes[0].outputQty);
        for (const r of recipes) {
          const total = jobs * r.inputQty;
          if (isFirst) {
            needs.set(r.inputItem, (needs.get(r.inputItem) ?? 0) + total);
          } else {
            altNeeds.set(r.inputItem, (altNeeds.get(r.inputItem) ?? 0) + total);
            if (!altReasons.has(r.inputItem)) {
              altReasons.set(r.inputItem, `${item} via ${sourceTag}`);
            }
          }
        }
        isFirst = false;
      }
      expanded.add(item);
      changed = true;
    }
  }

  // --- Phase 2: Walk refining chain for primary needs ---
  let resolving = new Map<string, number>();
  for (const [mat, qty] of needs) {
    if (refiningOutputs.has(mat)) resolving.set(mat, qty);
  }
  while (resolving.size > 0) {
    const nextRound = new Map<string, number>();
    for (const [material, qty] of resolving) {
      const sources = refLookup.get(material);
      if (!sources || sources.length === 0) continue;
      const src = sources[0];
      const jobs = Math.ceil(qty / src.outputQty);
      const inputNeeded = jobs * src.inputQty;
      needs.set(src.inputItem, (needs.get(src.inputItem) ?? 0) + inputNeeded);
      nextRound.set(src.inputItem, (nextRound.get(src.inputItem) ?? 0) + inputNeeded);
    }
    resolving = new Map<string, number>();
    for (const [mat, qty] of nextRound) {
      if (refLookup.has(mat)) resolving.set(mat, qty);
    }
  }

  // --- Phase 3: Generate alternative missions ---
  const refInputLookup = new Map<string, string>();
  for (const r of REFINING) {
    if (!refInputLookup.has(r.outputItem)) refInputLookup.set(r.outputItem, r.inputItem);
  }

  // Walk refining chain for alt needs
  const fullAltNeeds = new Map(altNeeds);
  let altResolving = new Map<string, number>();
  for (const [mat, qty] of altNeeds) {
    if (refiningOutputs.has(mat)) altResolving.set(mat, qty);
  }
  while (altResolving.size > 0) {
    const nextRound = new Map<string, number>();
    for (const [material, qty] of altResolving) {
      const sources = refLookup.get(material);
      if (!sources || sources.length === 0) continue;
      const src = sources[0];
      const jobs = Math.ceil(qty / src.outputQty);
      const inputNeeded = jobs * src.inputQty;
      fullAltNeeds.set(src.inputItem, (fullAltNeeds.get(src.inputItem) ?? 0) + inputNeeded);
      nextRound.set(src.inputItem, (nextRound.get(src.inputItem) ?? 0) + inputNeeded);
      // Propagate alt reason through refining chain
      if (!altReasons.has(src.inputItem) && altReasons.has(material)) {
        altReasons.set(src.inputItem, altReasons.get(material)!);
      }
    }
    altResolving = new Map<string, number>();
    for (const [mat, qty] of nextRound) {
      if (refLookup.has(mat)) altResolving.set(mat, qty);
    }
  }

  const altMissions: Mission[] = [];
  for (const [material, qty] of fullAltNeeds) {
    let phase: MissionPhase;
    if (ACQUIRABLE_ITEMS.has(material)) {
      phase = "ACQUIRE";
    } else if (industryOutputs.has(material)) {
      phase = "PRINT";
    } else if (refiningOutputs.has(material)) {
      phase = "REFINE";
    } else {
      phase = "GATHER";
    }
    altMissions.push({
      phase,
      tier: PHASE_TIER[phase],
      description: `${qty.toLocaleString()} ${material}`,
      quantity: qty,
      isAlternative: true,
      altReason: altReasons.get(material),
      typeId: getTypeIdByName(material) || undefined,
      ...(phase === "REFINE" ? { inputItem: refInputLookup.get(material) } : {}),
    });
  }

  return { needs, altMissions };
}

/** List of buildings available for construction goals. */
export function getBuildings(): string[] {
  return [...new Set(getConstruction().map((r) => r.building))];
}

/** Ships available for build goals. */
export function getShips(): string[] {
  return [...new Set(getShipbuilding().map((r) => r.ship))];
}

/** Modules available for assemble goals. */
export function getModules(): string[] {
  return [...new Set(getAssembly().map((r) => r.module))];
}

/** Items available for Print goals (industry outputs). */
export function getPrintItems(): string[] {
  return [...new Set(getIndustry().map((r) => r.outputItem))];
}

/** Items available for Refine goals (refining outputs). */
export function getRefineItems(): string[] {
  return [...new Set(getRefining().map((r) => r.outputItem))];
}

/** Items available for Gather goals (raw ores only). */
export function getGatherItems(): string[] {
  return [...new Set(getGather().map((r) => r.item))];
}

/** Items that must be acquired (looted/found). */
export function getAcquireItems(): string[] {
  return [...ACQUIRABLE_ITEMS];
}

/** Get construction components for a building (used by market for structure trades). */
export function getStructureComponents(building: string): { component: string; qty: number }[] {
  return getConstruction()
    .filter((r) => r.building === building)
    .map((r) => ({ component: r.component, qty: r.qty }));
}

/** Check if an item name is a known building/structure. */
export function isStructure(name: string): boolean {
  return getConstruction().some((r) => matchName(r.building, name));
}

/**
 * Structure filter for narrowing recipes to specific printer/refinery tiers.
 * When a list is provided, only recipes from those sources are used.
 * When undefined or empty, all sources are included.
 */
export interface StructureFilter {
  printers?: string[];
  refineries?: string[];
  berths?: string[];
  assemblers?: string[];
}

function filterIndustry(industry: IndustryRow[], filter?: StructureFilter): IndustryRow[] {
  if (!filter?.printers || filter.printers.length === 0) return industry;
  return industry.filter((r) => r.source !== undefined && filter.printers!.includes(r.source));
}

function filterRefining(refining: RefiningRow[], filter?: StructureFilter): RefiningRow[] {
  if (!filter?.refineries || filter.refineries.length === 0) return refining;
  return refining.filter((r) => r.source !== undefined && filter.refineries!.includes(r.source));
}

function filterShipbuilding(shipbuilding: ShipbuildingRow[], filter?: StructureFilter): ShipbuildingRow[] {
  if (!filter?.berths || filter.berths.length === 0) return shipbuilding;
  return shipbuilding.filter((r) => r.source !== undefined && filter.berths!.includes(r.source));
}

function filterAssembly(assembly: AssemblyRow[], filter?: StructureFilter): AssemblyRow[] {
  if (!filter?.assemblers || filter.assemblers.length === 0) return assembly;
  return assembly.filter((r) => r.source !== undefined && filter.assemblers!.includes(r.source));
}

/** Get distinct printer source tags from industry recipes. */
export function getAvailablePrinters(): string[] {
  return [...new Set(getIndustry().map((r) => r.source).filter((s): s is string => !!s))];
}

/** Get distinct refinery source tags from refining recipes. */
export function getAvailableRefineries(): string[] {
  return [...new Set(getRefining().map((r) => r.source).filter((s): s is string => !!s))];
}

/** Get distinct berth source tags from shipbuilding recipes. */
export function getAvailableBerths(): string[] {
  return [...new Set(getShipbuilding().map((r) => r.source).filter((s): s is string => !!s))];
}

/** Get distinct assembler source tags from assembly recipes. */
export function getAvailableAssemblers(): string[] {
  return [...new Set(getAssembly().map((r) => r.source).filter((s): s is string => !!s))];
}

/** Format a source tag like "field-printer" into "Field Printer". */
export function formatSourceLabel(source: string): string {
  return source.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Decompose a Print goal into missions.
 * The target item is the industry output; walk the full supply chain backwards
 * to find all required industry, refining + gathering steps (multi-level).
 */
export function decomposePrint(item: string, amount: number, filter?: StructureFilter): Mission[] {
  const INDUSTRY = filterIndustry(getIndustry(), filter);
  const REFINING = filterRefining(getRefining(), filter);

  const initialNeeds = new Map<string, number>();
  initialNeeds.set(item, amount);

  const { needs, altMissions } = walkSupplyChain(initialNeeds, INDUSTRY, REFINING);
  return classifyAndSort(needs, INDUSTRY, REFINING, altMissions);
}

/**
 * Decompose a Refine goal — target is a refining output.
 * Creates only the target REFINE mission + bottom-level GATHER mission.
 * Intermediates are implied by the refining chain.
 */
export function decomposeRefine(item: string, amount: number, filter?: StructureFilter): Mission[] {
  const filteredRefining = filterRefining(getRefining(), filter);
  const refLookup = buildRefiningLookupFrom(filteredRefining);

  const sources = refLookup.get(item);
  if (!sources || sources.length === 0) {
    // Not a refining output — treat as a plain gather
    return decomposeGather(item, amount);
  }

  const directInput = sources[0].inputItem;
  const jobs = Math.ceil(amount / sources[0].outputQty);
  let rawMaterial = sources[0].inputItem;
  let rawAmount = jobs * sources[0].inputQty;

  // Walk down the chain until we hit a non-refined (raw) material
  while (refLookup.has(rawMaterial)) {
    const s = refLookup.get(rawMaterial)![0];
    const j = Math.ceil(rawAmount / s.outputQty);
    rawMaterial = s.inputItem;
    rawAmount = j * s.inputQty;
  }

  return [
    {
      phase: "GATHER" as MissionPhase,
      tier: PHASE_TIER.GATHER,
      description: `${rawAmount.toLocaleString()} ${rawMaterial}`,
      quantity: rawAmount,
      typeId: getTypeIdByName(rawMaterial) || undefined,
    },
    {
      phase: "REFINE" as MissionPhase,
      tier: PHASE_TIER.REFINE,
      description: `${amount.toLocaleString()} ${item}`,
      quantity: amount,
      typeId: getTypeIdByName(item) || undefined,
      inputItem: directInput,
    },
  ];
}

/** Simple gather goal — just the raw material, no sub-missions. */
export function decomposeGather(item: string, amount: number): Mission[] {
  return [{
    phase: "GATHER" as MissionPhase,
    tier: PHASE_TIER.GATHER,
    description: `${amount.toLocaleString()} ${item}`,
    quantity: amount,
    typeId: getTypeIdByName(item) || undefined,
  }];
}

/** Simple acquire goal — for lootable items with manually-set rewards. */
export function decomposeAcquire(item: string, amount: number): Mission[] {
  return [{
    phase: "ACQUIRE" as MissionPhase,
    tier: PHASE_TIER.ACQUIRE,
    description: `${amount.toLocaleString()} ${item}`,
    quantity: amount,
    typeId: getTypeIdByName(item) || undefined,
  }];
}

/** Classify materials into phases and return sorted missions. */
function classifyAndSort(
  needs: Map<string, number>,
  INDUSTRY: IndustryRow[],
  REFINING: RefiningRow[],
  altMissions?: Mission[],
): Mission[] {
  const industryOutputs = new Set(INDUSTRY.map((r) => r.outputItem));
  const constructionComps = new Set(getConstruction().map((r) => r.component));
  const refiningOutputs = new Set(REFINING.map((r) => r.outputItem));

  // Build output→input lookups for display
  const refInputLookup = new Map<string, string>();
  for (const r of REFINING) {
    if (!refInputLookup.has(r.outputItem)) refInputLookup.set(r.outputItem, r.inputItem);
  }
  const printInputLookup = new Map<string, string>();
  for (const r of INDUSTRY) {
    if (!printInputLookup.has(r.outputItem)) printInputLookup.set(r.outputItem, r.inputItem);
  }

  const missions: Mission[] = [];
  for (const [material, qty] of needs) {
    let phase: MissionPhase;
    if (ACQUIRABLE_ITEMS.has(material)) {
      phase = "ACQUIRE";
    } else if (constructionComps.has(material) || industryOutputs.has(material)) {
      phase = "PRINT";
    } else if (refiningOutputs.has(material)) {
      phase = "REFINE";
    } else {
      phase = "GATHER";
    }
    const inputItem = phase === "REFINE" ? refInputLookup.get(material)
      : phase === "PRINT" ? printInputLookup.get(material)
      : undefined;
    missions.push({
      phase,
      tier: PHASE_TIER[phase],
      description: `${qty.toLocaleString()} ${material}`,
      quantity: qty,
      typeId: getTypeIdByName(material) || undefined,
      ...(inputItem ? { inputItem } : {}),
    });
  }
  if (altMissions) missions.push(...altMissions);
  missions.sort((a, b) => a.tier - b.tier);
  return missions;
}

/**
 * Decompose a Construct goal into bundled missions.
 *
 * Classification:
 *   GATHER      — raw ores (no production recipe)
 *   REFINE      — produced from the REFINING table (single-input transformation)
 *   PRINT       — produced from the INDUSTRY table or CONSTRUCTION components
 *   ACQUIRE     — lootable items (reward set manually by manager)
 *
 * Same materials are bundled into a single mission with the total quantity.
 * Multi-level industry chains are resolved (e.g. Building Foam → Reinforced Alloys → ores).
 * Alternative recipe routes are included as isAlternative missions.
 */
export function decomposeConstruct(building: string, multiplier: number = 1, filter?: StructureFilter): Mission[] {
  const CONSTRUCTION = getConstruction();
  const INDUSTRY = filterIndustry(getIndustry(), filter);
  const REFINING = filterRefining(getRefining(), filter);
  const components = CONSTRUCTION.filter((r) => r.building === building);
  if (components.length === 0) return [];

  const initialNeeds = new Map<string, number>();
  for (const c of components) {
    const qty = c.qty * multiplier;
    initialNeeds.set(c.component, (initialNeeds.get(c.component) ?? 0) + qty);
  }

  const { needs, altMissions } = walkSupplyChain(initialNeeds, INDUSTRY, REFINING);
  return classifyAndSort(needs, INDUSTRY, REFINING, altMissions);
}

/**
 * Decompose a Build goal into bundled missions (ship construction at berths).
 * Works identically to decomposeConstruct but uses the shipbuilding recipe table.
 */
export function decomposeBuild(ship: string, multiplier: number = 1, filter?: StructureFilter): Mission[] {
  const SHIPBUILDING = filterShipbuilding(getShipbuilding(), filter);
  const INDUSTRY = filterIndustry(getIndustry(), filter);
  const REFINING = filterRefining(getRefining(), filter);
  const components = SHIPBUILDING.filter((r) => r.ship === ship);
  if (components.length === 0) return [];

  const initialNeeds = new Map<string, number>();
  for (const c of components) {
    const qty = c.qty * multiplier;
    initialNeeds.set(c.component, (initialNeeds.get(c.component) ?? 0) + qty);
  }

  const { needs, altMissions } = walkSupplyChain(initialNeeds, INDUSTRY, REFINING);
  return classifyAndSort(needs, INDUSTRY, REFINING, altMissions);
}

/**
 * Decompose an Assemble goal into bundled missions (module assembly at assemblers).
 * Works identically to decomposeBuild but uses the assembly recipe table.
 */
export function decomposeAssemble(module: string, multiplier: number = 1, filter?: StructureFilter): Mission[] {
  const ASSEMBLY = filterAssembly(getAssembly(), filter);
  const INDUSTRY = filterIndustry(getIndustry(), filter);
  const REFINING = filterRefining(getRefining(), filter);
  const components = ASSEMBLY.filter((r) => r.module === module);
  if (components.length === 0) return [];

  const initialNeeds = new Map<string, number>();
  for (const c of components) {
    const qty = c.qty * multiplier;
    initialNeeds.set(c.component, (initialNeeds.get(c.component) ?? 0) + qty);
  }

  const { needs, altMissions } = walkSupplyChain(initialNeeds, INDUSTRY, REFINING);
  return classifyAndSort(needs, INDUSTRY, REFINING, altMissions);
}

/**
 * Compute per-mission rewards using the tiered cascade model.
 *
 * Each tier claims its configured % of the remaining budget (processed tier 1→3).
 * Within a tier, rewards are split proportionally by quantity among published missions.
 * ACQUIRE missions (tier 4) use fixed rewards set via acquireRewards, deducted before the cascade.
 */
export function computeTieredRewards(
  missions: Mission[],
  published: Set<number>,
  completed: Map<number, number>,
  budget: number,
  tierPercents: [number, number, number],
  acquireRewards?: Map<number, number>,
): number[] {
  const rewards = new Array<number>(missions.length).fill(0);
  if (budget <= 0) return rewards;

  let remaining = budget;

  // Apply fixed ACQUIRE rewards first (deducted from budget before cascade)
  if (acquireRewards) {
    for (const [idx, reward] of acquireRewards) {
      const m = missions[idx];
      if (!m || !published.has(idx)) continue;
      const done = completed.get(idx) ?? 0;
      if (done < m.quantity) {
        rewards[idx] = reward;
        remaining -= reward;
      }
    }
  }

  if (remaining <= 0) return rewards;

  // Process tiers 1→3
  for (let t = 1; t <= 3; t++) {
    const tierIdx = t - 1;
    const percent = tierPercents[tierIdx] / 100;
    const tierAllocation = remaining * percent;

    const tierMissions = missions
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => m.tier === t && published.has(i));

    if (tierMissions.length === 0) continue;

    const totalQty = tierMissions.reduce((s, { m }) => s + m.quantity, 0);
    if (totalQty === 0) continue;

    let tierCompletionRatio = 0;
    for (const { m, i } of tierMissions) {
      const done = completed.get(i) ?? 0;
      tierCompletionRatio += Math.min(done, m.quantity) / totalQty;
    }
    tierCompletionRatio = Math.min(tierCompletionRatio, 1);

    const tierRemaining = tierAllocation * (1 - tierCompletionRatio);

    for (const { m, i } of tierMissions) {
      const done = completed.get(i) ?? 0;
      const remainingQty = Math.max(m.quantity - done, 0);
      const uncompleted = totalQty * (1 - tierCompletionRatio);
      if (uncompleted > 0) {
        rewards[i] = Math.round((remainingQty / uncompleted) * tierRemaining);
      }
    }

    remaining -= tierAllocation;
  }

  return rewards;
}

export interface MissionDisplay {
  title: string;
  desc: string;
  requirement: string;
  /** typeId of the input material (for rendering an input icon). */
  inputTypeId?: number;
  /** typeId of the output material (for rendering an output icon). */
  outputTypeId?: number;
  /** The input material name. */
  inputName?: string;
  /** The output material name. */
  outputName?: string;
}

/** Given a mission, return the input materials it consumes (for withdrawal / allocation matching). */
export function getMissionInputs(m: Mission): { itemName: string; typeId: number }[] {
  if (m.phase === "REFINE" && m.inputItem) {
    const tid = getTypeIdByName(m.inputItem);
    return tid ? [{ itemName: m.inputItem, typeId: tid }] : [];
  }
  if (m.phase === "PRINT") {
    const outputName = m.description.match(/^[\d,]+\s+(.+)$/)?.[1] ?? m.description;
    const recipes = getAllRecipes();
    const inputs: { itemName: string; typeId: number }[] = [];
    for (const r of recipes.industry) {
      if (matchName(r.outputItem, outputName) || (m.typeId && getTypeIdByName(r.outputItem) === m.typeId)) {
        const tid = getTypeIdByName(r.inputItem);
        if (tid) inputs.push({ itemName: r.inputItem, typeId: tid });
      }
    }
    return inputs;
  }
  return [];
}

/** Parse a Mission into 3-line display: phase title, item description, requirement quantity. */
export function parseMissionDisplay(m: Mission): MissionDisplay {
  const title = m.phase;
  // Descriptions are now "qty item_name" — extract the item name
  const match = m.description.match(/^[\d,]+\s+(.+)$/);
  const itemName = match ? match[1] : m.description;

  if (m.inputItem) {
    return {
      title,
      desc: `${m.inputItem} → ${itemName}`,
      requirement: `${m.quantity.toLocaleString()} ${itemName}`,
      inputTypeId: getTypeIdByName(m.inputItem) || undefined,
      outputTypeId: m.typeId,
      inputName: m.inputItem,
      outputName: itemName,
    };
  }

  return {
    title,
    desc: itemName,
    requirement: `${m.quantity.toLocaleString()} ${itemName}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fitting parser — parse EVE Frontier ship fitting text into structured data
// ═══════════════════════════════════════════════════════════════════════════

export type SlotType = "hull" | "low" | "med" | "high" | "engine" | "charge";

export interface FittingSlot {
  slotType: SlotType;
  itemName: string;
  quantity: number;
  typeId: number;
}

export interface ParsedFitting {
  shipType: string;
  fittingName: string;
  items: FittingSlot[];
}

/**
 * Parse an EVE Frontier fitting paste into structured data.
 *
 * Format:
 *   [ShipType, FittingName]
 *   <low slot items>
 *   (blank line)
 *   <med slot items>
 *   (blank line)
 *   <high slot items>
 *   (blank line+)
 *   <engine>
 *   (blank lines)
 *   <charges>
 *
 * Items can have quantity suffix: `Item Name x3`
 * Empty slots like `[Empty Med slot]` are ignored.
 * The ship hull is included as item with slotType "hull".
 */
export function parseFitting(text: string): ParsedFitting | null {
  const lines = text.trim().split(/\r?\n/);

  // Group contiguous non-empty lines into sections
  const sections: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        sections.push(current);
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0) sections.push(current);

  if (sections.length === 0) return null;

  // First section must start with the header line: [ShipType, FittingName]
  const headerLine = sections[0][0];
  const headerMatch = headerLine.match(/^\[(.+?),\s*(.+)\]$/);
  if (!headerMatch) return null;

  const shipType = headerMatch[1].trim();
  const fittingName = headerMatch[2].trim().replace(/^\*/, "");

  const items: FittingSlot[] = [];

  // Add ship hull
  items.push({ slotType: "hull", itemName: shipType, quantity: 1, typeId: getTypeIdByName(shipType) });

  // Parse item lines, skip empty-slot markers
  function parseItems(itemLines: string[], slotType: SlotType) {
    for (const line of itemLines) {
      if (line.startsWith("[Empty")) continue;
      const qtyMatch = line.match(/^(.+?)\s+x(\d+)$/);
      const name = qtyMatch ? qtyMatch[1].trim() : line;
      const qty = qtyMatch ? parseInt(qtyMatch[2], 10) : 1;
      items.push({ slotType, itemName: name, quantity: qty, typeId: getTypeIdByName(name) });
    }
  }

  // Low slots: remaining lines in first section after header
  parseItems(sections[0].slice(1), "low");

  // Sections 1..4 → med, high, engine, charge
  const slotOrder: SlotType[] = ["med", "high", "engine", "charge"];
  for (let i = 0; i < slotOrder.length; i++) {
    if (i + 1 < sections.length) {
      parseItems(sections[i + 1], slotOrder[i]);
    }
  }

  return { shipType, fittingName, items };
}
