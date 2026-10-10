/* "Am I for you?" panel -- context + view model.
 * repo: src/am-i-for-you/viewModel.js
 *
 * getContext() is the one seam the rest of the module reads shopper data
 * through (contract 6.1). Today it reads the seed module directly; later
 * it calls the CDP for profile/ext and the decision engine for
 * page.candidate_slot and section order -- callers never need to change.
 *
 * buildViewModel() is PURE: (profile, ext, catalog, page) -> what the UI
 * shows. No DOM, no fetch, no text strings -- copy.js owns those.
 */

import { PROFILE, EXT, CATALOG, PAGES } from "./am-i-for-you-seed.js";

export function getContext(customerId, pageHandle) {
  const page = PAGES[pageHandle] || { sku: null, candidate_slot: null };
  return {
    profile: PROFILE,
    ext: EXT,
    catalog: CATALOG,
    page: { handle: pageHandle, sku: page.sku, candidate_slot: page.candidate_slot },
  };
}

const human = (s) => (s ? s.replace(/_/g, " ") : "");

export function buildViewModel(profile, ext, catalog, page) {
  const bp = profile.beauty_profile;
  const prov = (f) => `${human(f.source)} · ${f.observed_at} · ${f.confidence}`;

  return {
    name: ext.display_name,
    skin: {
      fields: [
        { k: "Type", v: bp.skin.type.value, prov: prov(bp.skin.type) },
        { k: "Sensitivity", v: bp.skin.sensitivity.value, prov: prov(bp.skin.sensitivity) },
        { k: "Fitzpatrick", v: bp.skin.fitzpatrick_type.value, prov: prov(bp.skin.fitzpatrick_type) },
        { k: "Age · climate", v: `${bp.skin.age_band} · ${human(bp.skin.climate)}`, prov: "" },
      ],
      concerns: bp.concerns.map((c) => ({ label: human(c.id), rank: c.rank, severity: c.severity })),
      goals: bp.goals.map((g) => human(g.id)),
    },
    constraints: {
      avoid: bp.preferences.avoid_ingredients.map((a) => ({ label: human(a.ingredient), reason: human(a.reason) })),
      reactions: bp.preferences.reported_reactions.map((r) => ({
        label: human(r.ingredient),
        product: catalog[r.product_sku]?.name ?? r.product_sku,
        effect: r.effect,
        date: r.observed_at,
      })),
      budget: bp.preferences.budget,
    },
    purchases: ext.purchases.map((o) => ({ ...o, name: catalog[o.sku]?.name ?? o.sku, price: catalog[o.sku]?.price })),
    routine: {
      observed_at: bp.routine.observed_at,
      lanes: ["am", "pm"].map((l) => ({
        id: l,
        steps: bp.routine[l].map((s) => ({ ...s, name: catalog[s.sku]?.name ?? s.sku })),
      })),
      ghost: page.candidate_slot ? { ...page.candidate_slot, name: catalog[page.sku]?.name ?? page.sku } : null,
    },
  };
}
