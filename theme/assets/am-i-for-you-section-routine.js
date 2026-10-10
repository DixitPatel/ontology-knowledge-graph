/* "Am I for you?" panel -- routine DAG.
 * repo: src/am-i-for-you/sections/routine.js
 *
 * layoutRoutine() is PURE -- no graph library, just coordinates. render()
 * draws the SVG from that layout. SVG width grows with the longest lane
 * so nothing clips (the prototype had this bug; the fix -- W tracks the
 * actual rightmost node, not a fixed constant -- is carried over as-is).
 */

import { t } from "./am-i-for-you-copy.js";
import { emit } from "./am-i-for-you-events.js";

const human = (s) => (s ? s.replace(/_/g, " ") : "");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function layoutRoutine(r) {
  const W = 400,
    NW = 104,
    NH = 46,
    GAP = 28,
    LANE_H = 86,
    TOP = 26,
    LEFT = 34;
  const nodes = [];
  const edges = [];

  r.lanes.forEach((lane, li) => {
    const steps = lane.steps.map((s) => ({ ...s, kind: "step" }));
    if (r.ghost && r.ghost.lane === lane.id) {
      const i = steps.findIndex((s) => s.step === r.ghost.before_step);
      steps.splice(i < 0 ? steps.length : i, 0, { kind: "ghost", name: r.ghost.name, product_type: t("rt.ghost") });
    }
    const y = TOP + li * LANE_H;
    steps.forEach((s, i) => {
      const n = { ...s, id: `${lane.id}-${i}`, lane: lane.id, x: LEFT + i * (NW + GAP), y, w: NW, h: NH };
      nodes.push(n);
      if (i > 0) {
        const p = nodes[nodes.length - 2];
        edges.push({ from: p, to: n, ghost: s.kind === "ghost" || p.kind === "ghost" });
      }
    });
  });

  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  return { W: Math.max(W, maxX + 4), H: TOP + r.lanes.length * LANE_H - 20, nodes, edges };
}

export const RoutineSection = {
  id: "routine",
  tabKey: "tab.routine",
  render: (vm) => {
    const L = layoutRoutine(vm.routine);
    const lanes = vm.routine.lanes.map((l, i) => `<text class="aify-lane" x="0" y="${26 + i * 86 + 28}">${l.id.toUpperCase()}</text>`).join("");
    const edges = L.edges
      .map((e, i) => {
        const x1 = e.from.x + e.from.w;
        const y = e.from.y + e.from.h / 2;
        const x2 = e.to.x;
        return `<path class="aify-edge ${e.ghost ? "aify-ghost-edge" : ""}" style="animation-delay:${i * 90}ms" d="M${x1} ${y} H${x2 - 4}" marker-end="url(#aify-arr)"/>`;
      })
      .join("");
    const nodes = L.nodes
      .map(
        (n) => `
      <g class="aify-node ${n.kind === "ghost" ? "aify-ghost" : ""}" data-id="${n.id}" tabindex="0" data-cf-slot="routine.node.${n.kind}">
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"/>
        <text class="aify-t" x="${n.x + 10}" y="${n.y + 19}">${clip(human(n.product_type), 15)}</text>
        <text class="aify-s" x="${n.x + 10}" y="${n.y + 34}">${clip(n.key_ingredient ? human(n.key_ingredient) : n.name, 17)}</text>
      </g>`
      )
      .join("");
    return `
      <div class="aify-card aify-dag" data-cf-slot="routine.dag">
        <h3>${t("rt.title")}</h3>
        <svg viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="AM and PM routine">
          <defs><marker id="aify-arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8z" fill="#bdb6aa"/></marker></defs>
          ${lanes}${edges}${nodes}
        </svg>
        <div class="aify-dag-detail" aria-live="polite">${t("rt.hint")}</div>
        <div class="aify-prov">observed ${vm.routine.observed_at}</div>
      </div>`;
  },
  mount: (el, vm) => {
    const L = layoutRoutine(vm.routine);
    const detail = el.querySelector(".aify-dag-detail");
    el.querySelectorAll(".aify-node").forEach((g) => {
      const pick = () => {
        el.querySelectorAll(".aify-node").forEach((x) => x.classList.toggle("aify-sel", x === g));
        const idx = L.nodes.findIndex((x) => x.id === g.dataset.id);
        const n = L.nodes[idx];
        if (n.kind === "ghost") {
          const next = L.nodes[idx + 1];
          const before = next && next.lane === n.lane ? human(next.product_type) : null;
          detail.innerHTML = before
            ? `<b>${n.name}</b> could slot in here, before your ${before}.`
            : `<b>${n.name}</b> could slot in here, as the next step in your ${n.lane.toUpperCase()} routine.`;
        } else {
          detail.innerHTML = `<b>${n.lane.toUpperCase()} step ${n.step}:</b> ${n.name}${n.key_ingredient ? ` — ${human(n.key_ingredient)}` : ""}`;
        }
        emit("routine_node_selected", { node: n.kind === "ghost" ? "candidate" : n.sku, lane: n.lane });
      };
      g.onclick = pick;
      g.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      };
    });
  },
};
