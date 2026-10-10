/* "Am I for you?" panel -- section registry.
 * repo: src/am-i-for-you/sections/index.js
 *
 * Order = default tab order. Coframe experiments edit this array (or
 * getContext's page.sections can override it later). The panel shell
 * knows nothing about what's in here. Filled in one section at a time
 * across commits 3-6.
 */

import { SkinSection } from "./am-i-for-you-section-skin.js";
import { ConstraintsSection } from "./am-i-for-you-section-constraints.js";
import { PurchasesSection } from "./am-i-for-you-section-purchases.js";
import { RoutineSection } from "./am-i-for-you-section-routine.js";

/* The first view: skin profile and the routine DAG stacked vertically in
 * one tab, so both are visible without a tab switch. A pure composition
 * of the two existing sections (neither is changed, and both still work
 * standalone if some other getContext().page.sections wants them split
 * again) -- id stays "skin" so initialTab/Coframe overrides don't break. */
const SkinRoutineSection = {
  id: "skin",
  tabKey: "tab.skin_routine",
  minWidth: RoutineSection.minWidth,
  render: (vm) => SkinSection.render(vm) + RoutineSection.render(vm),
  mount: (el, vm) => {
    SkinSection.mount?.(el, vm);
    RoutineSection.mount?.(el, vm);
  },
};

export const SECTIONS = [SkinRoutineSection, ConstraintsSection, PurchasesSection];
