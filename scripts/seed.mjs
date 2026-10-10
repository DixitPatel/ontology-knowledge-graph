#!/usr/bin/env node
// Seeds the catalog in seed/products.csv into the Shopify dev store via
// `shopify store execute` (Admin GraphQL). Idempotent: safe to re-run.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STORE = process.env.STORE || "oneself-kczbrdsl.myshopify.com";
const SHOP_ALL_HANDLE = "shop-all";

function graphqlFile(name) {
  return path.join(ROOT, "scripts", "graphql", `${name}.graphql`);
}

function run(name, variables, { mutate = false } = {}) {
  const args = [
    "store",
    "execute",
    "--store",
    STORE,
    "--json",
    "--query-file",
    graphqlFile(name),
    "--variables",
    JSON.stringify(variables),
  ];
  if (mutate) args.push("--allow-mutations");

  const result = spawnSync("shopify", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `shopify store execute (${name}) failed: ${result.stderr || result.stdout}`
    );
  }
  const data = JSON.parse(result.stdout);
  if (data.errors) {
    throw new Error(`${name} GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

function checkUserErrors(name, payload) {
  const userErrors = payload?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`${name} userErrors: ${JSON.stringify(userErrors)}`);
  }
}

// Minimal CSV parser: handles quoted fields containing commas ("a, b").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
    return obj;
  });
}

function loadProducts() {
  const csvPath = path.join(ROOT, "seed", "products.csv");
  const text = readFileSync(csvPath, "utf8");
  return parseCsv(text);
}

function findOrCreateShopAllCollection() {
  const found = run("collectionFind", { query: `handle:${SHOP_ALL_HANDLE}` });
  const existing = found.collections.nodes[0];
  if (existing) {
    console.log(`Shop All collection exists: ${existing.id}`);
    return existing.id;
  }
  const created = run(
    "collectionCreate",
    { collection: { title: "Shop All", handle: SHOP_ALL_HANDLE } },
    { mutate: true }
  );
  checkUserErrors("collectionCreate", created.collectionCreate);
  const collection = created.collectionCreate.collection;
  console.log(`Created Shop All collection: ${collection.id}`);
  return collection.id;
}

function findOnlineStorePublicationId() {
  const data = run("publications", {});
  const onlineStore = data.publications.nodes.find(
    (p) => p.name === "Online Store"
  );
  if (!onlineStore) throw new Error("Online Store publication not found");
  return onlineStore.id;
}

function seedProduct(row, shopAllCollectionId) {
  const tags = row["Tags"]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const input = {
    handle: row["Handle"],
    title: row["Title"],
    descriptionHtml: row["Body (HTML)"],
    vendor: row["Vendor"],
    productType: row["Type"],
    tags,
    status: "ACTIVE",
    collections: [shopAllCollectionId],
    productOptions: [
      { name: row["Option1 Name"], values: [{ name: row["Option1 Value"] }] },
    ],
    variants: [
      {
        price: row["Variant Price"],
        compareAtPrice: row["Variant Compare At Price"] || null,
        sku: row["Variant SKU"],
        inventoryPolicy: row["Variant Inventory Policy"] === "continue" ? "CONTINUE" : "DENY",
        taxable: row["Variant Taxable"] === "TRUE",
        optionValues: [
          { name: row["Option1 Value"], optionName: row["Option1 Name"] },
        ],
      },
    ],
  };

  const result = run(
    "productSet",
    { input, identifier: { handle: row["Handle"] } },
    { mutate: true }
  );
  checkUserErrors("productSet", result.productSet);
  const product = result.productSet.product;
  console.log(`Seeded product ${product.handle} -> ${product.id} (${product.status})`);
  return product;
}

function publishProduct(productId, publicationId) {
  const result = run(
    "publishablePublish",
    { id: productId, input: [{ publicationId }] },
    { mutate: true }
  );
  checkUserErrors("publishablePublish", result.publishablePublish);
}

function main() {
  console.log(`Seeding store ${STORE}`);
  const rows = loadProducts();
  const shopAllCollectionId = findOrCreateShopAllCollection();
  const onlineStorePublicationId = findOnlineStorePublicationId();

  for (const row of rows) {
    const product = seedProduct(row, shopAllCollectionId);
    publishProduct(product.id, onlineStorePublicationId);
    console.log(`Published ${product.handle} to Online Store`);
  }

  console.log(`Done. Seeded ${rows.length} products.`);
}

main();
