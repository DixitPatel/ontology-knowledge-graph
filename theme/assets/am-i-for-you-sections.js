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

export const SECTIONS = [SkinSection, ConstraintsSection, PurchasesSection];
