/* "Am I for you?" panel -- copy.
 * repo: src/am-i-for-you/copy.js
 *
 * Every visible string in the panel has a key here. Components never
 * hardcode text -- they call t(key, ...args). Coframe experiments vary
 * these keys without touching render logic.
 */

const COPY = {
  "trigger.label": "Who is this product for?",
  "head.greeting": (name) => `Hi ${name}, welcome back`,
  "head.sub": "Here is what we know about your skin.",
  "loading.message": "Loading your personal skincare knowledge graph...",
  "tab.skin": "Skin",
  "tab.skin_routine": "Skin & Routine",
  "tab.constraints": "Skin Care Budget",
  "tab.purchases": "Purchases",
  "tab.routine": "Routine",
  "skin.title": "Skin profile",
  "skin.concerns": "Concerns",
  "skin.goals": "Goals",
  "skin.confirm": "Is this still right?",
  "skin.yes": "Yes",
  "skin.changed": "Something changed",
  "skin.change_placeholder": "What changed? e.g. my skin feels oilier lately",
  "skin.save": "Update",
  "skin.saving": "Updating your skin graph...",
  "skin.save_failed": "Could not reach your profile. Try again.",
  "skin.no_change": "Nothing to update from that.",
  "con.avoid": "You avoid",
  "con.reactions": "Past reactions",
  "con.budget": "Skin Care Budget",
  "pur.title": "Recent purchases",
  "rt.title": "Your routine",
  "rt.hint": "Tap a step for details.",
  "rt.ghost": "This product?",
  "fit.title": "Is this right for you?",
  "fit.loading": "Checking this product against your skin graph…",
  "fit.error": "We couldn't check this right now.",
  "fit.retry": "Retry",
  "fit.try": "If you try it",
  "fit.sources": "Sources",
  "fit.verdict.good_fit": "Good fit",
  "fit.verdict.caution": "Use with caution",
  "fit.verdict.not_for_you": "Not for you",
  "fit.verdict.need_more_info": "Need more info",
};

export const t = (k, ...a) => {
  const v = COPY[k];
  return typeof v === "function" ? v(...a) : v ?? k;
};
