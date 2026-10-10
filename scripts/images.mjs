#!/usr/bin/env node
// Uploads local product images (seed/images.json) to Shopify and attaches them.
// 1. Removes FAILED media left by earlier attempts.
// 2. Skips a product that already has READY media (FORCE=1 to add anyway).
// 3. stagedUploadsCreate -> POST file -> productCreateMedia -> wait for READY.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = process.env.STORE || "oneself-kczbrdsl.myshopify.com";

function run(name, variables, mutate = false) {
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

const getProduct = (handle) =>
  run("productMediaByHandle", { query: `handle:${handle}` }).products.nodes[0];

async function upload(file) {
  const abs = path.join(ROOT, file);
  const filename = path.basename(abs);
  const res = run("stagedUploadsCreate", { input: [{
    filename, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST",
    fileSize: String(statSync(abs).size),
  }] }, true).stagedUploadsCreate;
  if (res.userErrors.length) throw new Error(JSON.stringify(res.userErrors));
  const t = res.stagedTargets[0];
  const form = new FormData();
  for (const p of t.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([readFileSync(abs)], { type: "image/jpeg" }), filename);
  const put = await fetch(t.url, { method: "POST", body: form });
  if (!put.ok) throw new Error(`upload ${filename}: HTTP ${put.status} ${await put.text()}`);
  return t.resourceUrl;
}

const images = JSON.parse(readFileSync(path.join(ROOT, "seed", "images.json"), "utf8"));
for (const [handle, files] of Object.entries(images)) {
  if (handle.startsWith("_")) continue;
  let p = getProduct(handle);
  if (!p) { console.warn(`No product ${handle}`); continue; }

  const failed = p.media.nodes.filter((m) => m.status === "FAILED").map((m) => m.id);
  if (failed.length) {
    run("productDeleteMedia", { productId: p.id, mediaIds: failed }, true);
    console.log(`${handle}: removed ${failed.length} failed media`);
  }
  if (p.media.nodes.some((m) => m.status === "READY") && !process.env.FORCE) {
    console.log(`${handle}: already has images, skip`); continue;
  }

  const media = [];
  for (const [i, f] of files.entries()) {
    media.push({ originalSource: await upload(f), mediaContentType: "IMAGE", alt: `${p.title} ${i + 1}` });
  }
  const res = run("productCreateMedia", { productId: p.id, media }, true).productCreateMedia;
  if (res.mediaUserErrors?.length) throw new Error(`${handle}: ${JSON.stringify(res.mediaUserErrors)}`);

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = getProduct(handle).media.nodes.map((m) => m.status);
    if (st.every((s) => s === "READY")) { console.log(`${handle}: READY`); break; }
    if (st.includes("FAILED")) throw new Error(`${handle}: media FAILED`);
    if (i === 14) console.warn(`${handle}: still ${st.join(",")}`);
  }
}
console.log("Images done.");
