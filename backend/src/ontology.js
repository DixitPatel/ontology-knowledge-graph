import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONTOLOGY_PATH = path.join(__dirname, "..", "..", "ontology", "skincare.json");

const ontologyData = JSON.parse(readFileSync(ONTOLOGY_PATH, "utf8"));

function matchesAvoidRule(rule, questionId, answerId, product) {
  const answerMatches = rule.when.answers.some(
    (a) => a.question_id === questionId && a.answer_id === answerId
  );
  if (!answerMatches) return false;

  return Object.entries(rule.when.product).every(
    ([key, value]) => product[key] === value
  );
}

// Returns only attributes with verified ("not unknown") values for the
// question's required edges, plus the standard message for any that are
// still unknown. If an AVOID_IF rule matches, no attributes are returned
// at all -- just the not-verified message, so nothing reads as a
// recommendation.
export function getOntologyResult(questionId, answerId, productHandle) {
  const product = CATALOG[productHandle];
  const edge = ontologyData.edges[questionId];

  if (!product || !edge) {
    return { verified: {}, unverified: [], avoid: false, message: null };
  }

  const avoid = ontologyData.avoid_if.some((rule) =>
    matchesAvoidRule(rule, questionId, answerId, product)
  );

  if (avoid) {
    return {
      verified: {},
      unverified: edge.requires,
      avoid: true,
      message: ontologyData.not_verified_message,
    };
  }

  const verified = {};
  const unverified = [];
  for (const attr of edge.requires) {
    const value = product[attr];
    if (value === undefined || value === "unknown") {
      unverified.push(attr);
    } else {
      verified[attr] = value;
    }
  }

  return {
    verified,
    unverified,
    avoid: false,
    message: unverified.length > 0 ? ontologyData.not_verified_message : null,
  };
}
