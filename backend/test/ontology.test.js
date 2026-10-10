import { test } from "node:test";
import assert from "node:assert/strict";
import { getOntologyResult } from "../src/ontology.js";
import { CATALOG } from "../src/catalog.js";

test("unknown product handle returns no attributes, no message", () => {
  const result = getOntologyResult("skin_type_fit", "dry", "not-a-real-product");
  assert.deepEqual(result.verified, {});
  assert.equal(result.message, null);
  assert.equal(result.avoid, false);
});

test("value_check on the duo returns verified price/bundle_contents (known values)", () => {
  const result = getOntologyResult("value_check", "bundle_savings", "glow-barrier-duo");
  assert.equal(result.verified.price, CATALOG["glow-barrier-duo"].price);
  assert.ok(result.verified.bundle_contents.includes("AHA Serum"));
  // size_ml is unknown for the bundle -- stays unverified, not guessed.
  assert.ok(result.unverified.includes("size_ml"));
  assert.ok(result.message); // some required attrs still unknown
});

test("where_to_start returns the verified routine_step", () => {
  const result = getOntologyResult("where_to_start", "starting_a_routine", "cloud-whip-moisturiser");
  assert.equal(result.verified.routine_step, "moisturise");
  assert.equal(result.message, null);
});

test("Sensitive AVOID_IF: skin_type_fit=sensitive + unknown AHA strength -> not-verified message, no attributes", () => {
  const result = getOntologyResult("skin_type_fit", "sensitive", "smooth-operator-aha-serum");
  assert.equal(result.avoid, true);
  assert.deepEqual(result.verified, {});
  assert.equal(result.message, "We don't have verified information to confirm this.");
});

test("Sensitive AVOID_IF also triggers from irritation_risk=yes on the AHA duo", () => {
  const result = getOntologyResult("irritation_risk", "yes", "glow-barrier-duo");
  assert.equal(result.avoid, true);
  assert.deepEqual(result.verified, {});
});

test("AVOID_IF does not trigger for a product with no AHA (the moisturiser)", () => {
  const result = getOntologyResult("skin_type_fit", "sensitive", "cloud-whip-moisturiser");
  assert.equal(result.avoid, false);
});

test("AVOID_IF does not trigger for a non-matching answer", () => {
  const result = getOntologyResult("skin_type_fit", "dry", "smooth-operator-aha-serum");
  assert.equal(result.avoid, false);
});
