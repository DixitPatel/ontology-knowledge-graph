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

/* Live path: Skin & Routine come from the Snowflake KG via the proxy's
 * GET /profile/{shopper} (docs/Snowflake_agent_proxy.py). Anything the KG
 * lacks (avoid list, purchases, candidate slot) stays on the seed. If the
 * proxy is down or slow, the panel uses the seed unchanged. */
const DEFAULT_PROXY_URL = "http://127.0.0.1:8788";
const PROFILE_TIMEOUT_MS = 4000;

const slug = (id) => id.split(":").pop().toLowerCase();

// PURE: proxy JSON + seed profile -> {profile, catalog} in the seed's
// CDP 1.1 shape, so buildViewModel() needs no change.
export function profileFromKg(kg, seedProfile, seedCatalog) {
  const profile = structuredClone(seedProfile);
  const catalog = { ...seedCatalog };
  const bp = profile.beauty_profile;
  const edges = kg.edges || [];
  const fact = (e) => ({ value: e.name.toLowerCase(), source: e.props.source, observed_at: e.props.observed_at, confidence: e.confidence });

  for (const e of edges.filter((x) => x.edge === "HAS")) {
    if (e.props.field === "type") bp.skin.type = fact(e);
    if (e.props.field === "sensitivity") bp.skin.sensitivity = fact(e);
    if (e.props.field === "fitzpatrick") bp.skin.fitzpatrick_type = { ...fact(e), value: e.name };
  }
  const sp = kg.shopper?.node_props || {};
  if (sp.age_band) bp.skin.age_band = sp.age_band;
  if (sp.climate) bp.skin.climate = sp.climate;

  const concerns = edges
    .filter((e) => e.edge === "HAS" && e.type === "CONCERN")
    .map((e) => ({ id: e.name.toLowerCase().replace(/ /g, "_"), rank: e.props.rank || "secondary", severity: e.props.severity || "stated", source: e.props.source || "session" }))
    .sort((a, b) => (a.rank === "primary" ? -1 : 0) - (b.rank === "primary" ? -1 : 0));
  if (concerns.length) bp.concerns = concerns;

  const goals = edges
    .filter((e) => e.edge === "WANTS")
    .sort((a, b) => (a.props.order ?? 0) - (b.props.order ?? 0))
    .map((e) => ({ id: slug(e.id) }));
  if (goals.length) bp.goals = goals;

  const steps = edges.filter((e) => e.edge === "ROUTINE_STEP");
  if (steps.length) {
    for (const e of steps) {
      const sku = e.node_props.sku || e.id;
      catalog[sku] = { name: e.name, price: e.node_props.price };
    }
    const lane = (l) =>
      steps
        .filter((e) => e.props.lane === l)
        .sort((a, b) => a.props.step - b.props.step)
        .map((e) => ({ step: e.props.step, product_type: e.props.product_type, key_ingredient: e.props.key_ingredient ?? null, sku: e.node_props.sku || e.id }));
    bp.routine = { observed_at: sp.routine_observed_at || bp.routine.observed_at, am: lane("am"), pm: lane("pm") };
  }

  return { profile, catalog };
}

export async function getLiveContext(customerId, pageHandle, proxyUrl = DEFAULT_PROXY_URL) {
  const ctx = getContext(customerId, pageHandle);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROFILE_TIMEOUT_MS);
    const res = await fetch(`${proxyUrl}/profile/${encodeURIComponent(`SHP:${customerId}`)}`, { signal: ctl.signal });
    clearTimeout(timer);
    const kg = await res.json();
    if (!kg.edges?.length) throw new Error("shopper not in KG");
    const { profile, catalog } = profileFromKg(kg, ctx.profile, ctx.catalog);
    console.log(`[aify] profile from Snowflake KG: ${kg.edges.length} edges, ${kg.ms}ms`);
    return { ...ctx, profile, catalog, source: "kg" };
  } catch (err) {
    console.warn("[aify] KG profile unavailable, using seed:", err.message);
    return { ...ctx, source: "seed" };
  }
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
