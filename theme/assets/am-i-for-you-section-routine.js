/* "Am I for you?" panel -- routine DAG.
 * repo: src/am-i-for-you/sections/routine.js
 *
 * layoutRoutine() is PURE -- no graph library, just coordinates. render()
 * draws the SVG from that layout, at its own natural size (width/height
 * attributes, not a responsive 100% that rescales node text into
 * clipping/spilling). A 4-node lane no longer fits the panel's default
 * width, so minWidth() tells the panel shell (am-i-for-you-panel.js) how
 * wide to grow, and `.dag-scroll` scrolls sideways on narrower viewports
 * instead of squeezing the drawing.
 */

import { t } from "./am-i-for-you-copy.js";
import { emit } from "./am-i-for-you-events.js";

const human = (s) => (s ? s.replace(/_/g, " ") : "");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Shared with render() below so the lane-label math and the layout math
// never drift apart.
const MIN_W = 440;
const NW = 132;
const NH = 52;
const GAP = 30;
const LANE_H = 92;
const TOP = 26;
const LEFT = 36;

export function layoutRoutine(r) {
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
  return { W: Math.max(MIN_W, maxX + 4), H: TOP + r.lanes.length * LANE_H - 20, nodes, edges };
}

export const RoutineSection = {
  id: "routine",
  tabKey: "tab.routine",
  minWidth: (vm) => layoutRoutine(vm.routine).W + 80,
  render: (vm) => {
    const L = layoutRoutine(vm.routine);
    const lanes = vm.routine.lanes
      .map((l, i) => `<text class="aify-lane" x="0" y="${TOP + i * LANE_H + 31}">${l.id.toUpperCase()}</text>`)
      .join("");
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
        <title>${n.name}</title>
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"/>
        <text class="aify-t" x="${n.x + 12}" y="${n.y + 22}">${clip(human(n.product_type), 16)}</text>
        <text class="aify-s" x="${n.x + 12}" y="${n.y + 38}">${clip(n.key_ingredient ? human(n.key_ingredient) : n.name, 18)}</text>
      </g>`
      )
      .join("");
    return `
      <div class="aify-card aify-dag" data-cf-slot="routine.dag">
        <h3>${t("rt.title")}</h3>
        <div class="dag-scroll">
          <svg width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="AM and PM routine">
            <defs><marker id="aify-arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8z" fill="#bdb6aa"/></marker></defs>
            ${lanes}${edges}${nodes}
          </svg>
        </div>
        <div class="aify-dag-detail" aria-live="polite">${t("rt.hint")}</div>
        <div class="aify-prov">observed ${vm.routine.observed_at}</div>
      </div>`;
  },
  mount: (el, vm) => {
    const L = layoutRoutine(vm.routine);
    const detail = el.querySelector(".aify-dag-detail");

    // The 16/18-char clip keeps very long names from running away, but a
    // bold 12px label can still measure wider than that budget in this
    // store's actual font (vs. whatever font the character counts were
    // tuned against) -- clamp with SVG textLength only when a label
    // actually overflows its node, so short labels stay untouched.
    el.querySelectorAll(".aify-node").forEach((g) => {
      const available = NW - 24; // 12px inset each side
      g.querySelectorAll("text").forEach((text) => {
        if (text.getBBox().width > available) {
          text.setAttribute("textLength", available);
          text.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
      });
    });

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
            : `<b>${n.name}</b> could slot in here.`;
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
