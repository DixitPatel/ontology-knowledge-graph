#!/usr/bin/env node
// Removes Shopify dev-store sample data from the storefront.
// Archives (does not delete) every product not in seed/products.csv.
// Unpublishes every collection except shop-all from the Online Store.
// Idempotent: safe to re-run.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = process.env.STORE || "oneself-kczbrdsl.myshopify.com";
const KEEP_COLLECTIONS = new Set(["shop-all"]);

function run(name, variables = {}, mutate = false) {
  const args = ["store", "execute", "--store", STORE, "--json",
    "--query-file", path.join(ROOT, "scripts", "graphql", `${name}.graphql`),
    "--variables", JSON.stringify(variables)];
  if (mutate) args.push("--allow-mutations");
  const r = spawnSync("shopify", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr || r.stdout}`);
  const data = JSON.parse(r.stdout);
  if (data.errors) throw new Error(`${name}: ${JSON.stringify(data.errors)}`);
  return data;
}

function userErrors(name, payload) {
  if (payload?.userErrors?.length) throw new Error(`${name}: ${JSON.stringify(payload.userErrors)}`);
}

const keepHandles = new Set(
  readFileSync(path.join(ROOT, "seed", "products.csv"), "utf8")
    .split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(",")[0])
);

const products = run("productsList").products.nodes;
for (const p of products) {
  if (keepHandles.has(p.handle) || p.status === "ARCHIVED") continue;
  const res = run("productArchive", { product: { id: p.id, status: "ARCHIVED" } }, true);
  userErrors("productUpdate", res.productUpdate);
  console.log(`Archived ${p.handle}`);
}

const pub = run("publications").publications.nodes.find((x) => x.name === "Online Store");
if (!pub) throw new Error("Online Store publication not found");
for (const c of run("collectionsList").collections.nodes) {
  if (KEEP_COLLECTIONS.has(c.handle)) continue;
  const res = run("publishableUnpublish", { id: c.id, input: [{ publicationId: pub.id }] }, true);
  userErrors("publishableUnpublish", res.publishableUnpublish);
  console.log(`Unpublished collection ${c.handle}`);
}
console.log("Cleanup done.");
