// Hypothesis scoring v1 (PLAN.md §5): weighted rule counts per hypothesis,
// normalized to sum 1.0. general_browsing is the implicit remainder when
// there is no signal at all -- it is never boosted by a rule.

export const HYPOTHESES = [
  "skin_type_fit",
  "irritation_risk",
  "where_to_start",
  "results_timeline",
  "value_check",
];

const ROUTINE_HANDLES = [
  "smooth-operator-aha-serum",
  "cloud-whip-moisturiser",
  "glow-barrier-duo",
];

export function scoreEvents(events) {
  const raw = {
    skin_type_fit: 0,
    irritation_risk: 0,
    where_to_start: 0,
    results_timeline: 0,
    value_check: 0,
  };

  for (const e of events) {
    const payload = e.payload || {};

    switch (e.event_name) {
      case "oneself:section_opened":
        // skin_type_fit: opens "Am I For You?"
        if (payload.section_id === "am_i_for_you") raw.skin_type_fit += 1;
        // irritation_risk: opens "What's Inside" (where AHA strength/patch-test info lives)
        if (payload.section_id === "whats_inside") raw.irritation_risk += 1;
        // results_timeline: opens "What to Expect"
        if (payload.section_id === "what_to_expect") raw.results_timeline += 1;
        break;

      case "oneself:section_dwell":
        // irritation_risk: dwelling (not just opening) on "What's Inside" is a stronger signal
        if (payload.section_id === "whats_inside") raw.irritation_risk += 2;
        break;

      case "page_viewed":
        // where_to_start: home routine views
        if (payload.template === "index") raw.where_to_start += 1;
        break;

      case "oneself:product_hop": {
        const from = payload.from;
        const to = payload.to;
        // where_to_start: hopping between serum / moisturiser / duo
        if (ROUTINE_HANDLES.includes(from) && ROUTINE_HANDLES.includes(to)) {
          raw.where_to_start += 1.5;
        }
        // value_check: duo <-> single hops
        if (from === "glow-barrier-duo" || to === "glow-barrier-duo") {
          raw.value_check += 1.5;
        }
        break;
      }

      case "product_added_to_cart":
      case "product_removed_from_cart":
        // value_check: add/remove cart churn
        raw.value_check += 1;
        break;

      default:
        break;
    }
  }

  const total = HYPOTHESES.reduce((sum, h) => sum + raw[h], 0);

  if (total === 0) {
    const scores = { general_browsing: 1 };
    for (const h of HYPOTHESES) scores[h] = 0;
    return { scores, top: "general_browsing" };
  }

  const scores = { general_browsing: 0 };
  let top = null;
  let topScore = -1;
  for (const h of HYPOTHESES) {
    scores[h] = raw[h] / total;
    if (scores[h] > topScore) {
      topScore = scores[h];
      top = h;
    }
  }

  return { scores, top };
}
