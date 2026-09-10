# Collection sex predictions, 9 September 2026

The collection sex file contains 1,220 Sanger CAMs across 57 species. BioCLIP embeddings are extracted separately from the two ventral forewings and two dorsal hindwings. Each CAM's probability is the arithmetic mean across three outer-fold models, with seeds 1701, 314159 and 20260830. Each model excludes that CAM's identity group from training and checkpoint selection. These are stored review scores; sex prediction is not supported in AI Identifier.

Agreement with recorded sex is 89.71% on the primary cohort of 1,215 specimens and 89.67% across all 1,220, including five known damaged specimens. Recorded labels are not independently verified ground truth.

Supported requires confidence ≥0.80. A qualifying species or genus has at least 20 accepted females and 20 accepted males, balanced accuracy ≥0.95, and both sex recall Wilson lower bounds ≥0.80. Genus inheritance requires at least five accepted specimens of each sex in the species and balanced accuracy ≥0.80. A directly testable species that fails cannot inherit support. Known damaged specimens remain Uncertain. Support is an exploratory screen assessed on the same OOF records, not prospective validation.

There are 274 Supported scores in seven species, including five disagreements with recorded sex. Review candidates are sorted Supported first, then descending confidence. The UI uses only Supported and Uncertain, and demotes support when recorded species no longer matches the export. Sex sorting preserves evidence groups in both directions and places missing scores last.

Artifacts: public/data/sex_predictions.json, sex_review_candidates.csv, sex_taxon_reliability.csv. Taxonomy predictions, segmentation data and the Hugging Face API are unchanged by this release.
