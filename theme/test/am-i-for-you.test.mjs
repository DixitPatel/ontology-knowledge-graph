import { test } from "node:test";
import assert from "node:assert/strict";

import { getContext, buildViewModel } from "../assets/am-i-for-you-view-model.js";

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
