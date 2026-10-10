/* "Am I for you?" panel -- seed data.
 * repo: src/am-i-for-you/seed/*.json (flattened: theme assets have no subfolders)
 *
 * Single seed shopper for the hackathon MVP -- there is no demo-controls
 * bar in this repo to pick a shopper, so customer_003 is the only one.
 * CDP schema 1.1, exactly as given by the prototype. Do not change its
 * shape; put anything the schema lacks in EXT instead.
 */

export const PROFILE = {
  schema_version: "1.1",
  customer_id: "customer_003",
  beauty_profile: {
    skin: {
      type: { value: "dry", source: "self_reported_quiz", observed_at: "2026-03-02", confidence: 0.7 },
      sensitivity: { value: "sensitive", source: "self_reported_quiz", observed_at: "2026-03-02", confidence: 0.9 },
      fitzpatrick_type: { value: "I", source: "in_store_scan", observed_at: "2026-04-15", confidence: 0.95 },
      age_band: "35-44",
      climate: "coastal_mild",
    },
    concerns: [
      { id: "rosacea", rank: "primary", severity: "moderate", source: "self_reported_quiz" },
      { id: "redness", rank: "secondary", severity: "moderate", source: "self_reported_quiz" },
      { id: "dryness", rank: "secondary", severity: "mild", source: "advisor_note" },
    ],
    goals: [{ id: "calm_redness" }, { id: "simple_routine" }],
    preferences: {
      avoid_ingredients: [
        { ingredient: "fragrance", reason: "preference" },
        { ingredient: "essential_oils", reason: "preference" },
        { ingredient: "glycolic_acid", reason: "advisor_recommendation" },
        { ingredient: "witch_hazel", reason: "reaction" },
      ],
      reported_reactions: [
        { ingredient: "witch_hazel", product_sku: "SK-TONER-112", effect: "stinging", severity: "mild", observed_at: "2026-05-20", source: "return_reason" },
      ],
      budget: { tier: "mid", currency: "USD", max_per_product: 60 },
    },
    routine: {
      observed_at: "2026-09-01",
      am: [
        { step: 1, product_type: "cleanser", key_ingredient: null, sku: "SK-CLN-201" },
        { step: 2, product_type: "treatment", key_ingredient: "azelaic_acid", sku: "SK-AZA-010" },
        { step: 3, product_type: "sunscreen", key_ingredient: "zinc_oxide", sku: "SK-SPF-330" },
      ],
      pm: [
        { step: 1, product_type: "cleanser", key_ingredient: null, sku: "SK-CLN-201" },
        { step: 2, product_type: "moisturizer", key_ingredient: "ceramides", sku: "SK-MST-045" },
      ],
    },
  },
};

/* Extensions the 1.1 schema lacks (display name, order history). Kept
 * separate so the CDP schema itself stays untouched. */
export const EXT = {
  display_name: "Dixit",
  purchases: [
    { order_id: "FH-1042", date: "2026-09-01", sku: "SK-MST-045", qty: 1, status: "delivered" },
    { order_id: "FH-1042", date: "2026-09-01", sku: "SK-AZA-010", qty: 1, status: "delivered" },
    { order_id: "FH-0988", date: "2026-07-12", sku: "SK-SPF-330", qty: 2, status: "delivered" },
    { order_id: "FH-0921", date: "2026-05-09", sku: "SK-TONER-112", qty: 1, status: "returned", return_reason: "stinging" },
    { order_id: "FH-0870", date: "2026-03-02", sku: "SK-CLN-201", qty: 1, status: "delivered" },
  ],
};

/* sku -> {name, price}. The fictional SK-* entries are customer_003's
 * existing routine/order history from other brands, carried over from the
 * UX-spec prototype as-is. The real-handle entries are this store's own
 * products (name/price mirror backend/src/catalog.js's retail pricing),
 * used only when one of them is the candidate slotting into the routine. */
export const CATALOG = {
  "SK-CLN-201": { name: "Daily Kit Gel Cleanser", price: 14 },
  "SK-AZA-010": { name: "Quiet Tone Azelaic 10%", price: 32 },
  "SK-SPF-330": { name: "Shoreline Mineral SPF 30", price: 28 },
  "SK-MST-045": { name: "Still Water Barrier Cream", price: 34 },
  "SK-TONER-112": { name: "Mist Hazel Toner", price: 22 },
  "smooth-operator-aha-serum": { name: "Smooth Operator AHA Serum", price: 24 },
  "cloud-whip-moisturiser": { name: "Cloud Whip Barrier Restore Moisturiser", price: 28 },
  "glow-barrier-duo": { name: "Glow Barrier Duo", price: 45 },
};

/* handle -> {sku, candidate_slot}. Later: the decision engine supplies
 * this per shopper/product instead of a static map. candidate_slot is
 * null for any handle not listed here -- the panel still opens, it just
 * has no ghost node in the routine tab. */
export const PAGES = {
  "smooth-operator-aha-serum": {
    sku: "smooth-operator-aha-serum",
    candidate_slot: { lane: "am", before_step: 2 },
  },
  "cloud-whip-moisturiser": {
    sku: "cloud-whip-moisturiser",
    candidate_slot: { lane: "pm", before_step: 2 },
  },
  "glow-barrier-duo": {
    sku: "glow-barrier-duo",
    candidate_slot: { lane: "pm", before_step: 2 },
  },
};
