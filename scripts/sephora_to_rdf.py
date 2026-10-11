#!/usr/bin/env python3
"""Build the Sephora skincare RDF graph for SKINCARE_KG.

Reads docs/kb-data/product_info.csv (Kaggle nadyinky/sephora-products-and-
skincare-reviews), keeps only products RANK_PRODUCTS/NEXT_QUESTION/
ROUTINE_CONFLICTS can use (primary_category=Skincare, has ingredients, not a
gift-set/tool/wellness/self-tanner line, and contains >=1 of the 7 mapped
actives), and writes docs/kb-data/sephora_skincare.ttl.

See docs/Snowflake_RDF_LOAD_HANDOFF.md (Task 1) for the full spec.

Also flattens the validated .ttl into nodes.csv / edges.csv for the
Snowflake stage+MERGE load (Task 3 of the handoff).

Usage:
    python3 sephora_to_rdf.py build <product_info.csv> <out.ttl>
    python3 sephora_to_rdf.py flatten <in.ttl> <nodes.csv> <edges.csv>
"""
import ast
import csv
import hashlib
import json
import re
import sys

from rdflib import Graph, Namespace, BNode, URIRef, Literal, XSD, RDF

KG = Namespace("urn:skincare-kg:schema#")
NS = "urn:skincare-kg:"

EXCLUDED_SECONDARY = {"Value & Gift Sets", "Mini Size", "High Tech Tools", "Wellness", "Self Tanners"}

# INCI -> canonical ING: node, per the handoff's map. Order matters only for
# readability; every regex is checked independently per parsed INCI item.
INGREDIENT_MAP = [
    ("ING:hyaluronic", r"hyaluron"),
    ("ING:vitc", r"ascorbic acid|ascorbyl glucoside|tetrahexyldecyl ascorbate|ascorbyl phosphate|ethyl ascorbic"),
    ("ING:niacinamide", r"niacinamide"),
    ("ING:salicylic", r"\bsalicylic acid|betaine salicylate|capryloyl salicylic"),
    ("ING:glycolic", r"glycolic acid"),
    ("ING:retinol", r"\bretinol\b|retinyl|\bretinal\b|hydroxypinacolone retinoate"),
    ("ING:azelaic", r"azelaic acid|potassium azeloyl"),
]

# Whether the active is called out by name/common term in the product's own
# name or highlights -- used for the kg:hidden flag (handoff: "the active is
# in the INCI list but not in the product name or tags"). Mirrors the labels
# ingredients.py's ACTIVES table uses for the same 7 actives.
TOLD_REGEX = {
    "ING:hyaluronic": r"hyaluron",
    "ING:vitc": r"vitamin c|ascorb",
    "ING:niacinamide": r"niacinamide|vitamin b3|\bb3\b",
    "ING:salicylic": r"salicylic|\bbha\b",
    "ING:glycolic": r"glycolic|\baha\b",
    "ING:retinol": r"retin|vitamin a",
    "ING:azelaic": r"azelaic",
}


def split_top(text):
    """Split on commas not inside parentheses/brackets. From docs/kb-data/ingredients.py."""
    parts, depth, cur = [], 0, ""
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def parse_ingredients(raw):
    """Flatten the ingredients cell into a list of lowercase INCI items. From ingredients.py."""
    try:
        items = ast.literal_eval(raw)
    except Exception:
        items = [raw]
    ings = []
    for it in items:
        it = str(it)
        if re.search(r"^\s*-?\s*[A-Z][^,]{0,60}:\s*$", it):  # variation label like "Serum:"
            continue
        for x in split_top(it):
            x = re.sub(r"\*+|\.$", "", x).strip().lower()
            x = re.sub(r"\s+", " ", x)
            if 2 < len(x) < 120 and not x.startswith(("please", "may contain", "this list", "ingredients")):
                ings.append(x)
    return ings


def parse_highlights(raw):
    if not raw:
        return []
    try:
        return [str(h) for h in ast.literal_eval(raw)]
    except Exception:
        return []


def classify_highlights(highlights):
    """Split a product's highlights into (suits_skin_types, good_for, claims)."""
    suits, good_for, claims = set(), [], []
    for h in highlights:
        if h.startswith("Best for"):
            if re.search(r"\boily\b", h, re.I):
                suits.add("SKT:oily")
            if re.search(r"\bdry\b", h, re.I):
                suits.add("SKT:dry")
        elif h.startswith("Good for:"):
            good_for.append(h.split(":", 1)[1].strip())
        else:
            claims.append(h)
    return suits, good_for, claims


def contains_edges_for(ings):
    """One (node_id, inci, position, hidden-input) tuple per matched active,
    deduplicated to the first (lowest-position) occurrence per node -- the
    edge id is MD5(src||dst||'CONTAINS'), so only one edge per pair can exist.
    """
    best = {}
    for pos, item in enumerate(ings, start=1):
        for node_id, pattern in INGREDIENT_MAP:
            if node_id in best:
                continue
            if re.search(pattern, item, re.I):
                best[node_id] = (item, pos)
    return best  # {node_id: (inci_form, position)}


def build(csv_path, ttl_path):
    g = Graph()
    g.bind("kg", KG)
    g.bind("xsd", XSD)

    n_products = 0
    n_contains = 0
    n_suits = 0

    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("primary_category") != "Skincare":
                continue
            if not row.get("ingredients"):
                continue
            if row.get("secondary_category") in EXCLUDED_SECONDARY:
                continue

            ings = parse_ingredients(row["ingredients"])
            matched = contains_edges_for(ings)
            if not matched:
                continue  # no mapped active -> inert for RANK_PRODUCTS, skip per spec

            pid = f"PRD:sph:{row['product_id']}"
            subj = URIRef(NS + pid)
            name = row.get("product_name") or ""
            text_for_told = (name + " " + " ".join(parse_highlights(row.get("highlights")))).lower()

            g.add((subj, RDF.type, KG.PRODUCT))
            g.add((subj, KG.name, Literal(name)))
            if row.get("brand_name"):
                g.add((subj, KG.brand, Literal(row["brand_name"])))
            if row.get("price_usd"):
                try:
                    g.add((subj, KG.price, Literal(float(row["price_usd"]), datatype=XSD.decimal)))
                except ValueError:
                    pass
            if row.get("rating"):
                try:
                    g.add((subj, KG.rating, Literal(float(row["rating"]), datatype=XSD.decimal)))
                except ValueError:
                    pass
            if row.get("reviews"):
                try:
                    g.add((subj, KG.reviews, Literal(int(float(row["reviews"])), datatype=XSD.integer)))
                except ValueError:
                    pass

            highlights = parse_highlights(row.get("highlights"))
            suits, good_for, claims = classify_highlights(highlights)
            for gf in good_for:
                g.add((subj, KG.goodFor, Literal(gf)))
            for c in claims:
                g.add((subj, KG.claim, Literal(c)))
            for skt in suits:
                g.add((subj, KG.SUITS, URIRef(NS + skt)))
                n_suits += 1

            for node_id, (inci_form, position) in matched.items():
                told = bool(re.search(TOLD_REGEX[node_id], text_for_told, re.I))
                edge = BNode()
                g.add((edge, RDF.type, KG.Edge))
                g.add((edge, KG.edgeType, Literal("CONTAINS")))
                g.add((edge, KG.src, subj))
                g.add((edge, KG.dst, URIRef(NS + node_id)))
                g.add((edge, KG.inci, Literal(inci_form)))
                g.add((edge, KG.position, Literal(position, datatype=XSD.integer)))
                g.add((edge, KG.hidden, Literal(not told, datatype=XSD.boolean)))
                g.add((edge, KG.source, Literal("SEPHORA_KAGGLE_2023")))
                n_contains += 1

            n_products += 1

    g.serialize(destination=ttl_path, format="turtle")
    print(f"products: {n_products}")
    print(f"CONTAINS edges: {n_contains}")
    print(f"SUITS edges: {n_suits}")
    return n_products, n_contains, n_suits


def _local(iri):
    """urn:skincare-kg:PRD:sph:P123 -> PRD:sph:P123"""
    return str(iri).replace(NS, "", 1)


def _edge_id(src, dst, edge_type):
    return hashlib.md5(f"{src}{dst}{edge_type}".encode("utf-8")).hexdigest()


def flatten(ttl_path, nodes_csv_path, edges_csv_path):
    """Parse the validated .ttl (source of truth) and write the two load
    files the stage+MERGE step (Task 4) expects. Only emits PRD:sph:* nodes
    -- ING:/SKT: nodes already exist from the seed load and must not be
    touched by this pass.
    """
    g = Graph()
    g.parse(ttl_path, format="turtle")

    n_nodes = 0
    with open(nodes_csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["NODE_ID", "NODE_TYPE", "NAME", "PROPS", "SOURCE"])
        for subj in g.subjects(RDF.type, KG.PRODUCT):
            node_id = _local(subj)
            name = g.value(subj, KG.name)
            props = {
                "brand": str(g.value(subj, KG.brand)) if g.value(subj, KG.brand) is not None else None,
                "price": float(g.value(subj, KG.price)) if g.value(subj, KG.price) is not None else None,
                "rating": float(g.value(subj, KG.rating)) if g.value(subj, KG.rating) is not None else None,
                "reviews": int(g.value(subj, KG.reviews)) if g.value(subj, KG.reviews) is not None else None,
                "good_for": sorted(str(o) for o in g.objects(subj, KG.goodFor)),
                "claims": sorted(str(o) for o in g.objects(subj, KG.claim)),
                "id": node_id.split(":")[-1],
            }
            props = {k: v for k, v in props.items() if v not in (None, [], "")}
            w.writerow([node_id, "PRODUCT", str(name) if name is not None else "", json.dumps(props), "SEPHORA_KAGGLE_2023"])
            n_nodes += 1

    n_edges = 0
    with open(edges_csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["EDGE_ID", "SRC_ID", "DST_ID", "EDGE_TYPE", "WEIGHT", "PROPS", "SOURCE", "STATUS"])

        for subj, _, obj in g.triples((None, KG.SUITS, None)):
            src, dst = _local(subj), _local(obj)
            w.writerow([_edge_id(src, dst, "SUITS"), src, dst, "SUITS", 1.0, "{}", "SEPHORA_KAGGLE_2023", "ASSERTED"])
            n_edges += 1

        for edge in g.subjects(RDF.type, KG.Edge):
            edge_type = str(g.value(edge, KG.edgeType))
            src = _local(g.value(edge, KG.src))
            dst = _local(g.value(edge, KG.dst))
            props = {
                "inci": str(g.value(edge, KG.inci)),
                "position": int(g.value(edge, KG.position)),
                "hidden": bool(g.value(edge, KG.hidden)),
            }
            w.writerow([_edge_id(src, dst, edge_type), src, dst, edge_type, 1.0, json.dumps(props), "SEPHORA_KAGGLE_2023", "ASSERTED"])
            n_edges += 1

    print(f"nodes: {n_nodes}")
    print(f"edges: {n_edges}")
    return n_nodes, n_edges


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "build"
    if mode == "flatten":
        ttl_path = sys.argv[2] if len(sys.argv) > 2 else "docs/kb-data/sephora_skincare.ttl"
        nodes_csv = sys.argv[3] if len(sys.argv) > 3 else "docs/kb-data/nodes.csv"
        edges_csv = sys.argv[4] if len(sys.argv) > 4 else "docs/kb-data/edges.csv"
        flatten(ttl_path, nodes_csv, edges_csv)
    else:
        csv_path = sys.argv[2] if len(sys.argv) > 2 else "docs/kb-data/product_info.csv"
        ttl_path = sys.argv[3] if len(sys.argv) > 3 else "docs/kb-data/sephora_skincare.ttl"
        build(csv_path, ttl_path)
