# Tax-head candidate review gallery

This local clone keeps the upstream Ikiam Wings Gallery shell and uses only frozen
artifacts.  No inference, public deployment, or push is performed here.

## Review contract

- The default prediction payload is corrected clean-retrain candidate **D**, visual-only `equal_image`, display seed `1701` (`D_padded_guides_support1`).  Seed 1701 is the predeclared display seed; this is not a test-set seed search or a pseudo-ensemble.
- The selected seed-1701 checkpoint SHA-256 is `2e7e14103388f199b96da7a489d89e49d8942611620a2414201b31df5059813f`.
- Candidate D is the selected visual-only cell after the three-seed gate.  In the frozen report it improves effective visual-only top-1 by 12.894 percentage points (species) and 10.947 points (subspecies) over reconstructed B; geographic prior results are sensitivity-only and are not used in the gallery.
- `predictions.json` contains 3,022 candidate-D CAMIDs.  The historical 4,823-CAMID payload is retained only as `predictions_legacy.json`; 1,801 historical keys have no candidate-D row and are explicitly listed in `prediction_missing_reasons.json`.
- Recorded taxonomy is under `recorded_taxonomy.raw/canonical`.  Model calls are under `rank_predictions`; the compatibility arrays are top calls only and are never used as recorded labels.
- Canonical overlays are `Vanessa brasiliensis -> Vanessa braziliensis` and `Oleria onega jaranilla -> Oleria onega janarilla`.  Comparison, disagreement filtering, audit counts, and display apply these aliases before scoring.
- The frozen rows expose `top5_correct` membership only.  The UI truthfully shows “Top-5 contains recorded label: Yes/No” and states that ranked top-five labels are unavailable; no labels are fabricated.

## Wings-v6 geometry

`wing_boxes_v6.json` is the full-gallery normalized biological-object union-box artifact
(9,531 photo keys, SHA-256
`7c990c2619fb88fc4dfbfe525135a2ef8cc0ae001780fdb70cf48d166cac49d3`).  The gallery
uses all valid union detections, with modest configurable padding/aspect/clamping
before panzoom framing.  The frozen build already excludes envelope, label, ruler,
palette, map, and background detections.  Zero/failed detections remain full-image
views with auditable reasons in `wing_box_reasons.json`, including
`CAM070267d` and `CAM075743v3`.  Regression coverage includes four-/three-/two-/one-wing
control keys where present.

## Input/output receipts

- OOF input: `/home/franz/Documents/CodeProjs/WingsClassificator.omx-worktrees/launch-wings-v6-historical-guide-audit-20260901.omx-worktrees/launch-wings-taxhead-historical-guides-v1-20260902.omx-worktrees/launch-taxhead-label-vocabulary-audit-v1.omx-worktrees/launch-taxhead-review-gallery-v1/context/taxonomic-head-audit/clean-retrain-v2/results/output/specimen-predictions.json.gz`, SHA-256
  `5464cd24f4c923225a0f5e3908ffe8f0c3057c355371c79eca015ab5718342f7`
- Full-gallery manifest: `/home/franz/Documents/CodeProjs/WingsClassificator.omx-worktrees/launch-taxonomic-head-ood-audit-20260830/context/taxonomic-head-audit/full-gallery-native-20260831/gallery-manifest.jsonl`, SHA-256
  `18881273749b1d80c7ed688dd9f82bf10b1a72cad7139f64ec7c492b4b1322a9`
- Candidate output: `public/data/predictions.json`, SHA-256 recorded in
  `public/data/candidate_d_receipt.json` (`1a3d38d9722b560a4617081beae2acf9ccfc9f8cd71f48e4b2957af0c16dacfb`)
- Missing-reason output: `public/data/prediction_missing_reasons.json` (receipt hash recorded in `candidate_d_receipt.json`)
- Box-status output: `public/data/wing_box_reasons.json` (receipt hash recorded in `candidate_d_receipt.json`)
- Synonym ledger: `public/data/taxonomy_synonyms.json`

## Running and sharing locally

```bash
npm ci                             # or use an existing compatible node_modules
npm run validate:curation
npm test
npm run build
npm run dev -- --host 0.0.0.0 --port 4175
```

Loopback review URL:
`http://127.0.0.1:4175/Shiny_Ikiam_Wings_Gallery/collection?modelVsRecorded=Differs&reviewRank=species&sortBy=ModelConfidence&sortOrder=desc`

On this host the Tailscale address is `100.83.134.33`; the corresponding URL is
`http://100.83.134.33:4175/Shiny_Ikiam_Wings_Gallery/collection?modelVsRecorded=Differs&reviewRank=species&sortBy=ModelConfidence&sortOrder=desc`.

## Verification

- `npm test`: 8 passing regression tests for replacement, canonical aliases,
  rank-aware disagreement/missing states, confidence sorting, top-five honesty,
  box-status reasons, union geometry, and review controls.
- `npm run validate:curation`: passed; 3,022 candidate predictions, 4,823 legacy
  predictions, 1,801 historical-without-candidate reasons, 9,531 V6 box keys.
- `npm run build`: passed with Vite.
- Chromium headless desktop (`1440x900`) and mobile (`390x844`) deep-link smoke
  both rendered the direct link, rank audit, recorded/predicted labels, confidence,
  and top-five indicator.  Mobile rank columns remain available through horizontal
  overflow rather than being hidden.

The managed agent environment rejected `npm ci` because its project-scoped script
allow-list is externally locked; verification used the already-installed compatible
dependencies from the sibling gallery clone.  This does not change the committed
lockfile or application files.
