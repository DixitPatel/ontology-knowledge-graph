// Verified product attributes for the ontology lookup. Mirrors
// seed/products.csv's tags/prices exactly -- this is not a second source
// of truth, just that same data in a shape the backend can read without
// a live Admin API call. Unknown stays "unknown", never guessed.
export const CATALOG = {
  "cloud-whip-moisturiser": {
    suitable_skin_types: "unknown",
    active_ingredients: "none",
    active_strength: "unknown",
    patch_test_note: "unknown",
    routine_step: "moisturise",
    expected_timeline: "unknown",
    price: "28.00",
    size_ml: "150",
    bundle_contents: "n/a",
  },
  "smooth-operator-aha-serum": {
    suitable_skin_types: "unknown",
    active_ingredients: "aha",
    active_strength: "unknown",
    patch_test_note: "patch test before first use",
    routine_step: "treat",
    expected_timeline: "unknown",
    price: "24.00",
    size_ml: "30",
    bundle_contents: "n/a",
  },
  "glow-barrier-duo": {
    suitable_skin_types: "unknown",
    active_ingredients: "aha",
    active_strength: "unknown",
    patch_test_note: "patch test before first use",
    routine_step: "2-step: treat then moisturise",
    expected_timeline: "unknown",
    price: "45.00",
    size_ml: "unknown",
    bundle_contents: "Smooth Operator AHA Serum (30 ml) + Cloud Whip Barrier Restore Moisturiser (150 ml)",
  },
};
