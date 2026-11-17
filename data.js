// Master data for the NRO tracker. Edit here to change the activity template, phases or mappings.
export const PHASES = [["Site preparation", 15], ["Structures", 15], ["Tank and pipeline", 25], ["Electrical and automation", 15], ["Drainage and driveway", 20], ["Branding and commissioning", 10]];
export const OWN = { P: "Consultant", D: "Dealer", C: "Contractor", CD: "Contractor / Dealer", S: "Signage vendor" };
// [activity, phase index, owner in CC, owner in DC]
export const ACTS = [["Marking / line out for dealer", 0, "P", "P"], ["Demolition", 0, "D", "D"], ["Site cutting", 0, "D", "D"], ["Filling", 0, "D", "D"], ["Levelling", 0, "D", "D"], ["Compaction", 0, "D", "D"], ["Retaining wall", 0, "D", "D"], ["Compound wall", 0, "D", "D"], ["Water connection", 0, "D", "D"], ["Electrical connection / transformer", 0, "D", "D"], ["Marking for contractor", 0, "P", "P"], ["Canopy foundation (4 nos)", 1, "C", "D"], ["Sales building", 1, "C", "D"], ["Tank installation", 2, "C", "C"], ["Tank testing", 2, "C", "C"], ["ID signage foundation", 1, "C", "C"], ["Pipeline work", 2, "C", "C"], ["Pipeline testing", 2, "C", "C"], ["Pump installation", 2, "C", "C"], ["STP installation", 2, "C", "C"], ["MLD fixing", 2, "C", "C"], ["Pump island", 2, "C", "C"], ["Nosing / tiling", 2, "C", "C"], ["Pipe for electrical & chambers", 3, "C", "C"], ["Pipe for automation cables & chambers", 3, "C", "C"], ["Pipe for canopy drain & chambers", 4, "C", "D"], ["Main drain - culvert RCC", 4, "C", "D"], ["Open drain", 4, "C", "D"], ["Septic tank & soak pit", 4, "C", "D"], ["GSB / WMM", 4, "C", "D"], ["Driveway pavers", 4, "C", "D"], ["Approach pavers", 4, "D", "D"], ["Buffer", 4, "C", "D"], ["Kerb wall - BBM / kerb stone", 4, "D", "D"], ["Panel", 3, "C", "C"], ["Electrical cabling and finishing", 3, "CD", "CD"], ["Earthing", 3, "CD", "CD"], ["GI strips", 3, "CD", "CD"], ["UPS", 3, "C", "C"], ["Stabilizers", 3, "C", "C"], ["Light poles", 3, "D", "D"], ["ID signage installation", 5, "S", "S"], ["Canopy", 5, "D", "D"], ["RVI", 5, "D", "D"], ["DU stamping", 5, "D", "D"], ["Nozzle sales", 5, "D", "D"], ["Landscaping / gardening", 5, "D", "D"], ["Compressor & air tower", 5, "D", "D"], ["FE & EN buckets", 5, "D", "D"], ["DG", 5, "D", "D"], ["Misc items", 5, "D", "D"], ["All finishing / handover to company", 5, "CD", "CD"]];
export const SALES_GROUPS = ["236", "960", "235", "573", "953"];
export const DISTRICTS = ["Belagavi", "Dharwad", "Haveri", "Gadag", "Bagalkot"];
export const DRAW_SLOTS = [["ro", "RO layout"], ["elec", "Electrical layout"], ["found", "Foundation layout"]];
export const TERRITORY = "Belgaum Retail Territory";
export const LETTER_PREFIX = "BRT/ENG/NRO";
export const TARGET_DAYS = 60;      // default completion target per NRO
export const STALL_DAYS = 5;        // an in-progress activity with no change for this many days is flagged
export const UPDATE_DAYS_PER_WEEK = 3;
export const UPDATE_DAY_NEEDS_PHOTO = true; // true: only an update with a photo counts as an update day; false: any saved update counts
export const SITE_RADIUS_M = 300;   // check-in within this distance of the site counts as "at site"
export const ID_DOMAIN = "nro-tracker.local"; // User IDs are stored in Firebase Auth as <id>@<this domain>; do not change after users exist
export const APP_VERSION = "2.5"; // shown on the sign-in page and in the account menu, so you can tell which version a device is running
// Bar chart (Gantt) for NRO construction: [work, standard days, standard start day counted from the work start date, enclosures]
// Standard 60-day plan as per the BPCL bar chart. Each site can change its own dates on the Timeline tab.
export const GANTT = [
  ["Initial levels & finalisation of FDL", 1, 1, "Level layout"],
  ["Earth pit (HD) tank works", 10, 2, "Photos"],
  ["Canopy foundation", 7, 2, "Photos, cube test report"],
  ["Culvert (drain)", 18, 2, "Photos, test report"],
  ["Sales building", 55, 2, "Photos, test report"],
  ["Construction of pump island", 4, 31, ""],
  ["PVC pipe laying (electrical & rain water)", 4, 31, "Testing certificate"],
  ["MPD & STP installation", 3, 34, ""],
  ["Product pipeline works", 5, 36, "Photos, testing certificate"],
  ["Yard light", 4, 16, "Photos"],
  ["BM inspection chambers", 4, 36, ""],
  ["Driveway WBM / WMM", 15, 15, "Photos"],
  ["Kerb wall, buffer & monolith foundation", 7, 31, "Photos"],
  ["Laying cables", 3, 39, "Testing certificate"],
  ["Approach cutting & WBM / WMM", 8, 42, ""],
  ["Pump island finishing", 3, 42, ""],
  ["Panel board commissioning", 4, 45, ""],
  ["Driveway CC pavers", 10, 40, ""],
  ["Approach finishing", 8, 46, ""],
  ["Painting work", 8, 50, ""],
  ["Site clean", 2, 59, ""]
];
export const GANTT_DAYS = 60;
