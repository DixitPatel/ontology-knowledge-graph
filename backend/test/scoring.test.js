import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEvents, HYPOTHESES } from "../src/scoring.js";

function approxEqual(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`);
}

test("no events -> general_browsing with all hypotheses at 0", () => {
  const { scores, top } = scoreEvents([]);
  assert.equal(top, "general_browsing");
  assert.equal(scores.general_browsing, 1);
  for (const h of HYPOTHESES) assert.equal(scores[h], 0);
});

test("scores always sum to 1.0", () => {
  const events = [
    { event_name: "oneself:section_opened", payload: { section_id: "am_i_for_you" } },
    { event_name: "oneself:section_opened", payload: { section_id: "whats_inside" } },
    { event_name: "product_added_to_cart", payload: {} },
  ];
  const { scores } = scoreEvents(events);
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  approxEqual(sum, 1);
});

test("skin_type_fit: opening Am I For You dominates", () => {
  const events = [
    { event_name: "oneself:section_opened", payload: { section_id: "am_i_for_you" } },
    { event_name: "oneself:section_opened", payload: { section_id: "am_i_for_you" } },
  ];
  const { scores, top } = scoreEvents(events);
  assert.equal(top, "skin_type_fit");
  assert.ok(scores.skin_type_fit > 0);
});

test("irritation_risk: dwelling on What's Inside dominates", () => {
  const events = [
    { event_name: "oneself:section_opened", payload: { section_id: "whats_inside" } },
    { event_name: "oneself:section_dwell", payload: { section_id: "whats_inside", ms: 5000 } },
  ];
  const { scores, top } = scoreEvents(events);
  assert.equal(top, "irritation_risk");
  assert.ok(scores.irritation_risk > scores.skin_type_fit);
});

test("where_to_start: home views + routine product hops dominate", () => {
  const events = [
    { event_name: "page_viewed", payload: { template: "index" } },
    {
      event_name: "oneself:product_hop",
      payload: { from: "smooth-operator-aha-serum", to: "cloud-whip-moisturiser" },
    },
  ];
  const { scores, top } = scoreEvents(events);
  assert.equal(top, "where_to_start");
  assert.ok(scores.where_to_start > 0);
});

test("results_timeline: opening What to Expect dominates", () => {
  const events = [
    { event_name: "oneself:section_opened", payload: { section_id: "what_to_expect" } },
    { event_name: "oneself:section_opened", payload: { section_id: "what_to_expect" } },
  ];
  const { scores, top } = scoreEvents(events);
  assert.equal(top, "results_timeline");
  assert.ok(scores.results_timeline > 0);
});

test("value_check: duo hops + cart churn dominate", () => {
  const events = [
    { event_name: "oneself:product_hop", payload: { from: "glow-barrier-duo", to: "smooth-operator-aha-serum" } },
    { event_name: "product_added_to_cart", payload: {} },
    { event_name: "product_removed_from_cart", payload: {} },
  ];
  const { scores, top } = scoreEvents(events);
  assert.equal(top, "value_check");
  assert.ok(scores.value_check > 0);
});
