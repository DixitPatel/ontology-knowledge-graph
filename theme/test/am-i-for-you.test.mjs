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

  assert.equal(vm.name, "Maya");
  assert.equal(vm.skin.fields.find((f) => f.k === "Type").v, "dry");
  assert.equal(vm.skin.concerns[0].label, "rosacea");
  assert.equal(vm.constraints.avoid.length, 4);
  assert.equal(vm.constraints.reactions[0].product, "Mist Hazel Toner");
  assert.equal(vm.purchases[0].name, "Still Water Barrier Cream");
  assert.equal(vm.routine.lanes.length, 2);
  assert.deepEqual(vm.routine.ghost, { lane: "pm", before_step: 2, name: "Glow Barrier Duo" });
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
