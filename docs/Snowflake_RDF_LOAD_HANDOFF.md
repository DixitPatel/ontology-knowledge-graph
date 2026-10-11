# Handoff: Load Sephora catalog into SKINCARE_KG as RDF triples

Date: 2026-10-10. Owner: Dixit. Builds on `docs/Snowflake_HANDOFF.md` (Tasks 1–6 done).

## Current state (updated 2026-10-10, see docs/progress.md for full evidence)
All 7 tasks done and verified live: 1,260 products / 2,051 CONTAINS / 408 SUITS edges
loaded (`scripts/sephora_to_rdf.py`, `docs/kb-data/sephora_skincare.ttl`,
`docs/Snowflake_sephora_load.sql`), SHACL conforms, agent tools fixed for scale,
all SQL + proxy smoke tests pass including the hidden-retinyl-palmitate demo
moment. **Not fixed, needs a judgment call before any demo**: the salicylic
AVOID_WITH pregnancy weight (0.7) now blocks 198 real products — see "Known
risks" below and docs/progress.md.

## Goal
Load the real Sephora skincare catalog into `SKINCARE_KG.KG.KG_NODE` / `KG_EDGE`.
Load only data that `RANK_PRODUCTS`, `NEXT_QUESTION` and `ROUTINE_CONFLICTS` can use.
Go through RDF (Turtle) as the canonical format. Then query it via the proxy (port 8788).

## Source
- `docs/kb-data/product_info.csv` — Kaggle `nadyinky/sephora-products-and-skincare-reviews`,
  scraped March 2023, CC BY 4.0. 8,494 products, 27 columns.
- Reviews (`skincare_products_reviews.csv`) are out of scope for this load.
- `docs/kb-data/ingredients.py` has the INCI parser (`split_top`, `parse`). Reuse it.

## What "relevant" means
`RANK_PRODUCTS` scores a product only through
`PRODUCT -CONTAINS-> INGREDIENT -TREATS|AVOID_WITH-> X`.
An ingredient with no TREATS / AVOID_WITH / CONFLICTS_WITH edge adds nothing.
So load:

| Keep | Rule | Est. rows |
|---|---|---|
| Products | `primary_category='Skincare'`, ingredients not null, secondary NOT IN (Value & Gift Sets, Mini Size, High Tech Tools, Wellness, Self Tanners), AND contains ≥1 mapped active | 1,261 nodes |
| CONTAINS edges | Only to the 7 existing `ING:` nodes, via the INCI map below | ~2,050 edges |
| SUITS edges | `highlights` "Best for Oily…" → `SKT:oily`; "Best for Dry…" → `SKT:dry` | ~600 edges |
| Product PROPS | brand, price_usd, rating, reviews, good_for[], claims[], url-safe id | — |

Do NOT load: water, glycerin, emulsifiers, preservatives, any unmapped INCI string
(66k links → ~2k). Do NOT create new `ING:` nodes in this pass: a new node with no
TREATS/AVOID edges is inert, and it bloats `TOOL_LIST_VOCAB`.

## INCI → canonical ingredient map (case-insensitive regex on each parsed INCI item)
| NODE_ID | INCI forms | Products |
|---|---|---|
| `ING:hyaluronic` | `hyaluron` (sodium hyaluronate, hydrolyzed hyaluronic acid) | 855 |
| `ING:vitc` | `ascorbic acid`, `ascorbyl glucoside`, `tetrahexyldecyl ascorbate`, `ascorbyl phosphate`, `ethyl ascorbic` | 403 |
| `ING:niacinamide` | `niacinamide` | 290 |
| `ING:salicylic` | `\bsalicylic acid`, `betaine salicylate`, `capryloyl salicylic` | 198 |
| `ING:glycolic` | `glycolic acid` | 148 |
| `ING:retinol` | `\bretinol\b`, `retinyl`, `\bretinal\b`, `hydroxypinacolone retinoate` | 133 |
| `ING:azelaic` | `azelaic acid`, `potassium azeloyl` | 26 |

Excluded on purpose: `ascorbyl palmitate` (usually a low-level antioxidant/preservative),
willow bark (not equal to salicylic acid), lactic/mandelic acid (no curated edges yet).

## IDs and IRIs
- Node ID: `PRD:sph:<product_id>`, e.g. `PRD:sph:P503998`. Existing `ING:` / `SKT:` IDs unchanged.
- IRI = `urn:skincare-kg:` + NODE_ID. This is 1:1, so SQL ID ↔ RDF IRI never needs a lookup.
- Edge ID: `MD5(src||dst||type)` — same rule as the seed, so MERGE stays idempotent.

## RDF shape (Turtle)
```turtle
@prefix kg:  <urn:skincare-kg:schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<urn:skincare-kg:PRD:sph:P503998> a kg:PRODUCT ;
    kg:name "Algae Peptide Regenerative Moisturizer" ;
    kg:brand "Algenist" ; kg:price "88"^^xsd:decimal ; kg:rating "4.3"^^xsd:decimal ;
    kg:goodFor "Loss of firmness" ; kg:claim "Fragrance Free" ;
    kg:SUITS <urn:skincare-kg:SKT:dry> .

# Edge with properties = one edge resource (keeps INCI form, list position, hidden flag)
[] a kg:Edge ; kg:edgeType "CONTAINS" ;
   kg:src <urn:skincare-kg:PRD:sph:P503998> ; kg:dst <urn:skincare-kg:ING:hyaluronic> ;
   kg:inci "sodium hyaluronate" ; kg:position 14 ; kg:hidden true ;
   kg:source "SEPHORA_KAGGLE_2023" .
```
- `kg:hidden true` = the active is in the INCI list but not in the product name or tags.
- No `pct`: Sephora lists no percentages. `position` (1 = first in list) is a rough proxy only.
- Rule: a predicate equal to an edge type (`kg:SUITS`) with no properties is a plain triple;
  any edge with properties uses a `kg:Edge` resource.

## Tasks (do in order; stop and report on first failure)

1. **Build RDF.** New `scripts/sephora_to_rdf.py` (Python, `rdflib`, `pyshacl`).
   Reads `docs/kb-data/product_info.csv`, applies the filters and map above,
   writes `docs/kb-data/sephora_skincare.ttl`.
   Pass: 1,261 ± 5 products, 2,050 ± 20 CONTAINS edges, every CONTAINS target is one of the 7 `ING:` IDs.

2. **Validate (SHACL).** `docs/kb-data/sephora_shapes.ttl`:
   - every `kg:PRODUCT` has a name and ≥1 CONTAINS edge;
   - every CONTAINS `kg:dst` is in the 7-ID list;
   - every `kg:Edge` has exactly one src, dst, edgeType, source.
   Pass: `pyshacl` reports `Conforms: True`.

3. **Flatten RDF → load files.** Same script parses the `.ttl` (not the CSV) and writes
   `nodes.csv` (NODE_ID, NODE_TYPE, NAME, PROPS json, SOURCE) and
   `edges.csv` (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT=1.0, PROPS json, SOURCE, STATUS='ASSERTED').
   SOURCE = `SEPHORA_KAGGLE_2023` on every row.
   Pass: row counts equal Task 1 counts.

4. **Stage and MERGE** (`docs/Snowflake_sephora_load.sql`):
   ```sql
   USE SCHEMA SKINCARE_KG.KG;
   CREATE STAGE IF NOT EXISTS KG_STAGE FILE_FORMAT=(TYPE=CSV SKIP_HEADER=1 FIELD_OPTIONALLY_ENCLOSED_BY='"');
   -- snow stage copy docs/kb-data/nodes.csv @KG_STAGE -c kg   (same for edges.csv)
   CREATE OR REPLACE TEMP TABLE NODE_STG LIKE KG_NODE;  -- COPY INTO NODE_STG(...) FROM @KG_STAGE/nodes.csv
   CREATE OR REPLACE TEMP TABLE EDGE_STG LIKE KG_EDGE;  -- COPY INTO EDGE_STG(...) FROM @KG_STAGE/edges.csv
   MERGE INTO KG_NODE t USING NODE_STG s ON t.NODE_ID=s.NODE_ID
     WHEN MATCHED THEN UPDATE SET NAME=s.NAME, PROPS=s.PROPS, TS_INGESTED=CURRENT_TIMESTAMP()
     WHEN NOT MATCHED THEN INSERT (NODE_ID,NODE_TYPE,NAME,PROPS,SOURCE) VALUES (s.NODE_ID,s.NODE_TYPE,s.NAME,s.PROPS,s.SOURCE);
   MERGE INTO KG_EDGE t USING EDGE_STG s ON t.EDGE_ID=s.EDGE_ID
     WHEN MATCHED THEN UPDATE SET PROPS=s.PROPS, TS_INGESTED=CURRENT_TIMESTAMP()
     WHEN NOT MATCHED THEN INSERT (EDGE_ID,SRC_ID,DST_ID,EDGE_TYPE,WEIGHT,PROPS,SOURCE,STATUS)
       VALUES (s.EDGE_ID,s.SRC_ID,s.DST_ID,s.EDGE_TYPE,s.WEIGHT,s.PROPS,s.SOURCE,s.STATUS);
   ```
   PROPS column: load as STRING in the stage tables, then `PARSE_JSON` in the MERGE.
   Pass: `SELECT SOURCE, NODE_TYPE, COUNT(*) FROM KG_NODE GROUP BY 1,2` shows 1,261 Sephora products;
   seed rows unchanged. Re-running Task 4 changes no counts.
   Rollback: `DELETE FROM KG_EDGE WHERE SOURCE='SEPHORA_KAGGLE_2023'; DELETE FROM KG_NODE WHERE SOURCE='SEPHORA_KAGGLE_2023';`

5. **Fix agent tools before testing (required).** With 1,265 products:
   - `TOOL_RANK_PRODUCTS` returns every product to the LLM. Change it to take `PRODUCT`
     and return that product's row plus the top 10 unblocked. Update the agent `input_schema`.
   - `NEXT_QUESTION` scans all products each call. Check latency on XS; it should stay < 2 s.
   Pass: tool output < 5 KB; `CALL TOOL_RANK_PRODUCTS('SHP:demo2','PRD:sph:<id>')` < 2 s.

6. **SQL smoke test.**
   - A retinol product (`PRD:sph:` + any product with CONTAINS ING:retinol) for `SHP:demo` (pregnant) → `BLOCKED=TRUE`.
   - An azelaic product for an acne shopper → ranks above a hyaluronic-only product.
   - `ROUTINE_CONFLICTS('SHP:demo2', <glycolic+retinol product>)` returns the conflict.
   Pass: all three hold.

7. **Proxy test (port 8788).**
   ```bash
   curl -N localhost:8788/event -d '{"shopper_id":"SHP:demo5","product_id":"PRD:sph:<retinol id>","event_type":"FREE_TEXT","payload":{"text":"I am pregnant"}}'
   ```
   Pass: SSE ends with `verdict: not_for_you` and a reason naming retinol.
   Then the same with a hidden-retinol product (`retinyl palmitate`, `kg:hidden true`):
   the verdict must still be `not_for_you`. This is the demo moment: the label never says retinol.

## Known risks / check first
- `AVOID_WITH ING:salicylic → CND:pregnant` has WEIGHT 0.7, which blocks at ≥ 0.7.
  With 198 salicylic products this rule now blocks many real products. Review the weight
  before the demo. Do not present it as medical advice.
- Tab ↔ KG ID mapping is still missing (`PRD:<page_handle>`). For the demo, pick 2–3
  `PRD:sph:` IDs and send them from the tab explicitly.
- Data is from March 2023. Formulas may have changed. Say so in the demo.
- Product names contain quotes and commas. Use a real CSV writer, not string joins.
- Keep the Turtle file in git. It is the source of truth; the tables are a projection of it.

## Next pass (out of scope now)
Claim-conflict edges (Fragrance Free + linalool), new actives (ceramides, peptides,
bakuchiol, centella, lactic/mandelic) once their TREATS/AVOID edges are curated, and
reviewer skin-type evidence from the reviews file.
