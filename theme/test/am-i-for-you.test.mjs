import { test } from "node:test";
import assert from "node:assert/strict";

import { getContext, buildViewModel } from "../assets/am-i-for-you-view-model.js";
import { layoutRoutine, RoutineSection } from "../assets/am-i-for-you-section-routine.js";

test("getContext falls back to no candidate slot for an unmapped handle", () => {
  const ctx = getContext("customer_003", "some-other-product");
  assert.equal(ctx.page.sku, null);
  assert.equal(ctx.page.candidate_slot, null);
  assert.equal(ctx.profile.customer_id, "customer_003");
});

test("buildViewModel shapes the CDP profile into what the panel renders", () => {
  const ctx = getContext("customer_003", "glow-barrier-duo");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);

  assert.equal(vm.name, "Dixit");
  assert.equal(vm.skin.fields.find((f) => f.k === "Type").v, "dry");
  assert.equal(vm.skin.concerns[0].label, "rosacea");
  assert.equal(vm.constraints.avoid.length, 4);
  assert.equal(vm.constraints.reactions[0].product, "Mist Hazel Toner");
  assert.equal(vm.purchases[0].name, "Still Water Barrier Cream");
  assert.equal(vm.routine.lanes.length, 2);
  assert.deepEqual(vm.routine.ghost, { lane: "pm", before_step: 2, name: "Glow Barrier" });
});

test("buildViewModel has no ghost node when the page has no candidate slot", () => {
  const ctx = getContext("customer_003", "unmapped-handle");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  assert.equal(vm.routine.ghost, null);
});

test("layoutRoutine places every step left to right with no overlap and a ghost node for the candidate", () => {
  const ctx = getContext("customer_003", "glow-barrier-duo");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  const layout = layoutRoutine(vm.routine);

  const amSteps = vm.routine.lanes.find((l) => l.id === "am").steps.length;
  const pmSteps = vm.routine.lanes.find((l) => l.id === "pm").steps.length + 1; // +1 ghost
  assert.equal(layout.nodes.length, amSteps + pmSteps);

  for (const n of layout.nodes) assert.ok(n.x >= 0 && n.y >= 0);
  assert.ok(layout.W >= Math.max(...layout.nodes.map((n) => n.x + n.w)), "SVG width must cover the longest lane");

  const ghost = layout.nodes.find((n) => n.kind === "ghost");
  assert.ok(ghost, "ghost node should be present when the page has a candidate_slot");
  assert.equal(ghost.lane, "pm");
});

test("layoutRoutine has no ghost node when the routine has none", () => {
  const ctx = getContext("customer_003", "unmapped-handle");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  const layout = layoutRoutine(vm.routine);
  assert.equal(layout.nodes.some((n) => n.kind === "ghost"), false);
});

test("layoutRoutine's SVG width grows with a longer lane instead of clipping it", () => {
  const vm = {
    observed_at: "2026-01-01",
    lanes: [
      { id: "am", steps: Array.from({ length: 8 }, (_, i) => ({ step: i + 1, product_type: "step", key_ingredient: null, sku: `S${i}`, name: `Step ${i}` })) },
      { id: "pm", steps: [{ step: 1, product_type: "cleanser", key_ingredient: null, sku: "P1", name: "Cleanser" }] },
    ],
    ghost: null,
  };
  const layout = layoutRoutine(vm);
  const rightmostEdge = Math.max(...layout.nodes.map((n) => n.x + n.w));
  assert.ok(layout.W >= rightmostEdge + 4, "width must extend past the last node in the longest lane");
});

test("a 4-node AM lane (3 real steps + the candidate ghost) lays out with no overlap", () => {
  // smooth-operator-aha-serum's candidate_slot is in the AM lane, before
  // the existing azelaic acid treatment -- this is the "4 AM nodes" case
  // that used to clip/spill text before the wider panel + bigger nodes.
  const ctx = getContext("customer_003", "smooth-operator-aha-serum");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  const layout = layoutRoutine(vm.routine);

  const amNodes = layout.nodes.filter((n) => n.lane === "am").sort((a, b) => a.x - b.x);
  assert.equal(amNodes.length, 4);
  for (let i = 1; i < amNodes.length; i++) {
    assert.ok(amNodes[i].x >= amNodes[i - 1].x + amNodes[i - 1].w, "nodes in a lane must not overlap");
  }
  assert.equal(amNodes.find((n) => n.kind === "ghost").id, amNodes[1].id, "ghost sits before step 2");
});

test("RoutineSection.minWidth matches layoutRoutine's width plus the panel's side padding", () => {
  const ctx = getContext("customer_003", "smooth-operator-aha-serum");
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  const layout = layoutRoutine(vm.routine);
  assert.equal(RoutineSection.minWidth(vm), layout.W + 80);
});

test("profileFromKg: KG rows mirroring the seed give the same view model", async () => {
  const { profileFromKg } = await import("../assets/am-i-for-you-view-model.js");
  const ctx = getContext("customer_003", "glow-barrier-duo");
  const has = (id, type, name, conf, props) => ({ edge: "HAS", id, type, name, confidence: conf, props, node_props: {} });
  const step = (sku, name, lane, n, product_type, key_ingredient) => ({
    edge: "ROUTINE_STEP", id: `PRD:ext:${sku}`, type: "PRODUCT", name, confidence: 1,
    props: { lane, step: n, product_type, key_ingredient }, node_props: { sku },
  });
  const kg = {
    shopper: { node_props: { age_band: "35-44", climate: "coastal_mild", routine_observed_at: "2026-09-01" } },
    edges: [
      has("SKT:dry", "SKIN_TYPE", "Dry", 0.7, { field: "type", source: "self_reported_quiz", observed_at: "2026-03-02" }),
      has("SKT:sensitive", "SKIN_TYPE", "Sensitive", 0.9, { field: "sensitivity", source: "self_reported_quiz", observed_at: "2026-03-02" }),
      has("FTZ:I", "SKIN_TONE", "I", 0.95, { field: "fitzpatrick", source: "in_store_scan", observed_at: "2026-04-15" }),
      has("CON:redness", "CONCERN", "Redness", 1, { field: "concern", rank: "secondary", severity: "moderate", source: "self_reported_quiz" }),
      has("CON:rosacea", "CONCERN", "Rosacea", 1, { field: "concern", rank: "primary", severity: "moderate", source: "self_reported_quiz" }),
      has("CON:dry", "CONCERN", "Dryness", 1, { field: "concern", rank: "secondary", severity: "mild", source: "advisor_note" }),
      { edge: "WANTS", id: "GOAL:simple_routine", type: "GOAL", name: "Simple routine", props: { order: 2 }, node_props: {} },
      { edge: "WANTS", id: "GOAL:calm_redness", type: "GOAL", name: "Calm redness", props: { order: 1 }, node_props: {} },
      step("SK-SPF-330", "Shoreline Mineral SPF 30", "am", 3, "sunscreen", "zinc_oxide"),
      step("SK-CLN-201", "Daily Kit Gel Cleanser", "am", 1, "cleanser", null),
      step("SK-AZA-010", "Quiet Tone Azelaic 10%", "am", 2, "treatment", "azelaic_acid"),
      step("SK-CLN-201", "Daily Kit Gel Cleanser", "pm", 1, "cleanser", null),
      step("SK-MST-045", "Still Water Barrier Cream", "pm", 2, "moisturizer", "ceramides"),
    ],
  };
  const live = profileFromKg(kg, ctx.profile, ctx.catalog);
  const vmSeed = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  const vmKg = buildViewModel(live.profile, ctx.ext, live.catalog, ctx.page);
  assert.deepEqual(vmKg.skin, vmSeed.skin);
  assert.deepEqual(vmKg.routine, vmSeed.routine);
});

test("toAgentEvent sends only events that change the KG", async () => {
  const { toAgentEvent } = await import("../assets/am-i-for-you-cdp.js");
  const prd = "PRD:store:glow-barrier-duo";
  assert.deepEqual(toAgentEvent({ type: "profile_confirmation", answer: "yes" }, prd), ["CONFIRM", {}]);
  assert.equal(toAgentEvent({ type: "profile_confirmation", answer: "changed" }, prd), null);
  assert.deepEqual(toAgentEvent({ type: "profile_change_text", text: " my skin is oily now " }, prd), ["FREE_TEXT", { text: "my skin is oily now" }]);
  assert.deepEqual(toAgentEvent({ type: "routine_node_selected", node: "candidate" }, prd), ["INTEREST", { target: prd }]);
  assert.equal(toAgentEvent({ type: "routine_node_selected", node: "SK-CLN-201" }, prd), null);
  assert.equal(toAgentEvent({ type: "panel_opened" }, prd), null);
});

test("extractReply finds the writes JSON escaped inside an SSE text block", async () => {
  const { extractReply } = await import("../assets/am-i-for-you-cdp.js");
  const reply = { writes: [{ op: "upsert", edge: "HAS", target: "SKT:oily" }], skipped: [] };
  const sse = `event: response\ndata: ${JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(reply) + "\n```" }] })}\n`;
  assert.deepEqual(extractReply(sse), reply);
});
