#!/usr/bin/env python3
"""Build the local review payload from the frozen candidate-D OOF artifact.

This exporter deliberately keeps the frozen contract honest.  The artifact has
one top prediction, confidence, and ``top5_correct`` per rank; it does not have
the ranked top-five labels, so this script never invents those labels or falls
back to the historical gallery prediction for a missing candidate row.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


RANKS = ("family", "subfamily", "tribe", "genus", "species", "subspecies")
SEED = "1701"
CELL = "D_padded_guides_support1"
MODE = "equal_image"
CHECKPOINT_SHA256 = "2e7e14103388f199b96da7a489d89e49d8942611620a2414201b31df5059813f"
CAM_RE = re.compile(r"^(CAM\d+)", re.IGNORECASE)

DEFAULT_ALIASES = {
    # Frozen taxonomy-canonicalization-v1 overlay.
    "vanessa brasiliensis": "Vanessa braziliensis",
    # Required spelling overlay: both records resolve to the same taxon.
    "oleria onega jaranilla": "Oleria onega janarilla",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical(value: Any, aliases: dict[str, str]) -> str:
    text = "" if value is None else " ".join(str(value).strip().split())
    if not text or text.lower() in {"na", "none", "null"}:
        return ""
    return aliases.get(text.lower(), text)


def nonempty(value_: Any) -> bool:
    return value_ is not None and str(value_).strip() not in {"", "NA", "None", "null"}


def value(item: dict[str, Any], *keys: str) -> Any:
    """Return the first non-empty value, handling the collection's `` Family`` key."""
    for key in keys:
        candidate = item.get(key)
        if nonempty(candidate):
            return candidate
    return None


def resolve_camid(item: dict[str, Any]) -> str | None:
    explicit = str(value(item, "CAM_ID", "CAM_ID_CollData") or "").strip()
    match = CAM_RE.match(explicit)
    if match:
        return match.group(1).upper()
    names = [row.get("Name") for row in item.get("all_photos") or [] if isinstance(row, dict)]
    names.extend([item.get("Photo_dorsal"), item.get("Photo_ventral"), item.get("Photo_ventral_2")])
    for name in names:
        match = CAM_RE.match(str(name or ""))
        if match:
            return match.group(1).upper()
    return None


def taxonomy_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Normalize collection/insectary/CRISPR records without using model truth."""
    full_species = value(item, "SPECIES", "Stock_of_origin")
    species_raw = value(item, "Species")
    subsp_raw = value(item, "Subspecies_Form")

    full_parts = str(full_species or "").split()
    if not species_raw and len(full_parts) >= 2:
        species_raw = " ".join(full_parts[:2])
    if not subsp_raw and len(full_parts) >= 3:
        subsp_raw = " ".join(full_parts[2:])
    genus_raw = value(item, "Genus")
    if not genus_raw:
        species_parts = str(species_raw or "").split()
        genus_raw = species_parts[0] if species_parts else (full_parts[0] if full_parts else None)

    return {
        "family": value(item, "Family", " Family"),
        "subfamily": value(item, "Subfamily"),
        "tribe": value(item, "Tribe"),
        "genus": genus_raw,
        "species": species_raw,
        "subspecies": subsp_raw,
    }


def recorded_taxonomy(item: dict[str, Any], aliases: dict[str, str]) -> dict[str, Any]:
    raw = taxonomy_fields(item)
    canonical_fields = {rank: canonical(raw[rank], aliases) for rank in RANKS}
    genus = canonical_fields["genus"]
    species = canonical_fields["species"]
    subsp = canonical_fields["subspecies"]
    if species and genus and species.lower().startswith(genus.lower() + " "):
        species = species[len(genus) + 1 :].strip()
        species = f"{genus} {species}"
    if subsp and species and not subsp.lower().startswith(species.lower() + " "):
        subsp = f"{species} {subsp}"
    subsp = canonical(subsp, aliases)
    if subsp and not species:
        parts = subsp.split()
        if len(parts) >= 2:
            species = " ".join(parts[:2])
            genus = parts[0]
    canonical_fields.update({"genus": genus, "species": species, "subspecies": subsp})
    return {
        "raw": {rank: ("" if raw[rank] is None else str(raw[rank])) for rank in RANKS},
        "canonical": canonical_fields,
    }


def load_aliases(path: Path | None) -> dict[str, str]:
    aliases = dict(DEFAULT_ALIASES)
    if not path or not path.exists():
        return aliases
    source = read_json(path)
    for mapping in source.get("mappings", []):
        if mapping.get("verbatim") and mapping.get("canonical"):
            aliases[str(mapping["verbatim"]).strip().lower()] = str(mapping["canonical"]).strip()
    for alias, target in source.get("aliases", {}).items():
        aliases[str(alias).strip().lower()] = str(target).strip()
    return aliases


def load_oof(path: Path) -> dict[str, dict[str, dict[str, Any]]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    try:
        mode = payload[SEED]["main"][CELL][MODE]
    except KeyError as exc:
        raise ValueError(f"candidate-D payload missing frozen path: {exc}") from exc
    output: dict[str, dict[str, dict[str, Any]]] = {}
    for rank in RANKS:
        for row in mode.get(rank, []):
            camid = str(row.get("camid") or "").upper()
            if not CAM_RE.match(camid):
                raise ValueError(f"invalid candidate-D CAMID: {camid!r}")
            if camid in output and rank in output[camid]:
                raise ValueError(f"duplicate candidate-D row: {camid}/{rank}")
            output.setdefault(camid, {})[rank] = {
                "prediction": row.get("prediction"),
                "confidence": row.get("confidence"),
                "top5_correct": row.get("top5_correct"),
                "truth": row.get("truth"),
                "truth_supported": row.get("truth_supported"),
                "fold": row.get("fold"),
            }
    return output


def model_rank(row: dict[str, Any] | None, aliases: dict[str, str]) -> dict[str, Any] | None:
    if not row or not row.get("prediction"):
        return None
    confidence = row.get("confidence")
    if not isinstance(confidence, (int, float)):
        raise ValueError(f"candidate-D confidence is not numeric: {row!r}")
    return {
        "prediction": canonical(row["prediction"], aliases),
        "confidence": float(confidence),
        "top5_correct": bool(row.get("top5_correct")),
        "top5_available": True,
        "top5_labels_available": False,
        "truth": canonical(row.get("truth"), aliases),
        "truth_supported": row.get("truth_supported"),
        "fold": row.get("fold"),
    }


def make_prediction(item: dict[str, Any], rows: dict[str, dict[str, Any]], aliases: dict[str, str]) -> dict[str, Any]:
    recorded = recorded_taxonomy(item, aliases)
    rank_predictions = {rank: model_rank(rows.get(rank), aliases) for rank in RANKS}
    rank_predictions = {rank: rank_value for rank, rank_value in rank_predictions.items() if rank_value}

    genus = rank_predictions.get("genus")
    species = rank_predictions.get("species")
    subspecies = rank_predictions.get("subspecies")
    subspecies_rows: list[list[Any]] = []
    if subspecies and species:
        subsp_species = " ".join(subspecies["prediction"].split()[:2])
        if subsp_species.lower() == species["prediction"].lower():
            subspecies_rows = [[subspecies["prediction"], subspecies["confidence"], 0]]

    photos = item.get("all_photos") or []
    n_views = len({str(row.get("Name")) for row in photos if isinstance(row, dict) and row.get("Name")})
    if not n_views:
        n_views = int(bool(item.get("URLd"))) + int(bool(item.get("URLv")))
    return {
        "source": "candidate_d",
        "cell": CELL,
        "seed": int(SEED),
        "mode": MODE,
        "side": str(item.get("Side_Andes") or ""),
        "oof": 1,
        "n_views": n_views,
        "source_tabs": item.get("_source_tabs") or [],
        "model_meta": {
            "build_identity": "wings-taxhead-clean-retrain-v2-candidate-D",
            "confidence_semantics": "frozen group-safe Sanger OOF closed-set taxonomic probability",
            "preprocessing": "frozen Wings-v6 padded features",
            "selection_rule": "three-seed visual-only gate: effective species/subspecies top-1, then top-5, then calibration",
            "display_seed_rule": "predeclared candidate-D seed 1701; no test-set seed shopping or pseudo-ensemble",
            "checkpoint_sha256": CHECKPOINT_SHA256,
        },
        "recorded_taxonomy": recorded,
        # `rec` is view-only compatibility data derived from the records. It is
        # never used as model output and remains separate from rank_predictions.
        "rec": {
            "genus": recorded["canonical"]["genus"],
            "species": recorded["canonical"]["species"],
            "subsp": recorded["canonical"]["subspecies"],
            "genus_p": None,
            "species_p": None,
            "subsp_p": None,
            "oor": 0,
        },
        "rank_predictions": rank_predictions,
        "genus": [[genus["prediction"], genus["confidence"], 0]] if genus else [],
        "species": [[species["prediction"], species["confidence"], 0, subspecies_rows]] if species else [],
        "species_all": [[species["prediction"], species["confidence"], 0]] if species else [],
        "subspecies": [[subspecies["prediction"], subspecies["confidence"], 0]] if subspecies else [],
    }


def merge_records(paths: list[tuple[str, Path | None]]) -> dict[str, dict[str, Any]]:
    """Merge all gallery tabs, retaining the first record and filling blanks."""
    merged: dict[str, dict[str, Any]] = {}
    for source, path in paths:
        if not path or not path.exists():
            continue
        rows = read_json(path)
        if not isinstance(rows, list):
            raise ValueError(f"{path} must be a JSON array")
        for original in rows:
            if not isinstance(original, dict):
                continue
            camid = resolve_camid(original)
            if not camid:
                continue
            item = merged.setdefault(camid, {"CAM_ID": camid, "_source_tabs": []})
            if source not in item["_source_tabs"]:
                item["_source_tabs"].append(source)
            for key, candidate in original.items():
                if key == "all_photos" and isinstance(candidate, list):
                    existing = item.setdefault("all_photos", [])
                    seen = {str(row.get("Name")) for row in existing if isinstance(row, dict)}
                    for photo in candidate:
                        name = str(photo.get("Name")) if isinstance(photo, dict) else ""
                        if name and name not in seen:
                            existing.append(copy.deepcopy(photo))
                            seen.add(name)
                elif not nonempty(item.get(key)) and nonempty(candidate):
                    item[key] = copy.deepcopy(candidate)
    return merged


def manifest_by_camid(path: Path | None) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    by_camid: dict[str, list[dict[str, Any]]] = {}
    by_photo: dict[str, dict[str, Any]] = {}
    if not path or not path.exists():
        return by_camid, by_photo
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        camid = str(row.get("camid") or "").upper()
        photo_key = str(row.get("photo_key") or "").lower()
        if camid:
            by_camid.setdefault(camid, []).append(row)
        if photo_key:
            by_photo[photo_key] = row
    return by_camid, by_photo


def human_box_reason(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return "No frozen Wings-v6 manifest row; full image retained"
    statuses = {str(row.get("status") or "") for row in rows}
    if "eligible" in statuses:
        return None
    if "zero_detection" in statuses:
        return "Wings-v6 zero/failed detection; full image retained"
    if "duplicate" in statuses:
        return "Conflicting duplicate Wings-v6 photo entry; full image retained"
    if "irrecoverable" in statuses:
        return "No recoverable Wings-v6 box/feature identity; full image retained"
    return "No valid Wings-v6 union box; full image retained"


def build_box_reasons(paths: list[tuple[str, Path | None]], manifest: Path | None) -> dict[str, dict[str, Any]]:
    _, by_photo = manifest_by_camid(manifest)
    reasons: dict[str, dict[str, Any]] = {}
    for _, path in paths:
        if not path or not path.exists():
            continue
        rows = read_json(path)
        for item in rows:
            photos = item.get("all_photos") or []
            names = [row.get("Name") for row in photos if isinstance(row, dict) and row.get("Name")]
            names.extend(name for name in (item.get("Photo_dorsal"), item.get("Photo_ventral")) if name)
            for name in names:
                key = str(name).rsplit(".", 1)[0].lower()
                manifest_row = by_photo.get(key)
                reasons[key] = {
                    "photo_name": name,
                    "status": manifest_row.get("status") if manifest_row else "missing",
                    "exclusion_reason": manifest_row.get("exclusion_reason") if manifest_row else "missing_manifest_row",
                    "feature_action": manifest_row.get("feature_action") if manifest_row else "none",
                    "reason": human_box_reason([manifest_row] if manifest_row else []),
                    "uses_full_image": not bool(manifest_row and manifest_row.get("status") == "eligible"),
                }
    return reasons


def build_missing_reasons(
    union_records: dict[str, dict[str, Any]],
    candidate_rows: dict[str, dict[str, Any]],
    historical_keys: set[str],
    manifest_rows: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Cover every gallery/historical CAMID, with explicit rank-level reasons."""
    all_camids = set(union_records) | set(historical_keys) | set(candidate_rows)
    reasons: dict[str, dict[str, Any]] = {}
    for camid in sorted(all_camids):
        present = candidate_rows.get(camid, {})
        missing_ranks = {
            rank: "No valid frozen candidate-D OOF row for this rank"
            for rank in RANKS
            if rank not in present
        }
        box_statuses = {str(row.get("status") or "") for row in manifest_rows.get(camid, [])}
        if present and not missing_ranks:
            reason = None
        elif "zero_detection" in box_statuses:
            reason = "Wings-v6 zero/failed detection; no candidate-D feature row"
        elif "irrecoverable" in box_statuses or "duplicate" in box_statuses:
            reason = "No recoverable Wings-v6 feature row for candidate-D"
        elif not present:
            reason = "No compatible frozen candidate-D OOF row; historical result is audit-only"
        else:
            reason = "Candidate-D OOF output has missing rank rows"
        reasons[camid] = {
            "reason": reason,
            "ranks": missing_ranks,
            "candidate_available": bool(present),
            "gallery_record": camid in union_records,
            "historical_prediction": camid in historical_keys,
        }
    return reasons


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--oof", type=Path, required=True)
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--insectary", type=Path)
    parser.add_argument("--crispr", type=Path)
    parser.add_argument("--legacy-predictions", type=Path)
    parser.add_argument("--out-predictions", type=Path, required=True)
    parser.add_argument("--out-missing", type=Path, required=True)
    parser.add_argument("--out-box-reasons", type=Path, required=True)
    parser.add_argument("--out-receipt", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--synonyms", type=Path)
    args = parser.parse_args()

    aliases = load_aliases(args.synonyms)
    paths = [("collection", args.collection), ("insectary", args.insectary), ("crispr", args.crispr)]
    union_records = merge_records(paths)
    rows = load_oof(args.oof)
    manifest_rows, _ = manifest_by_camid(args.manifest)
    historical_keys: set[str] = set()
    if args.legacy_predictions and args.legacy_predictions.exists():
        historical = read_json(args.legacy_predictions)
        historical_keys = {str(key).upper() for key in historical if CAM_RE.match(str(key))}

    predictions = {
        camid: make_prediction(union_records.get(camid, {"CAM_ID": camid, "_source_tabs": []}), rows_for_camid, aliases)
        for camid, rows_for_camid in sorted(rows.items())
    }
    missing = build_missing_reasons(union_records, rows, historical_keys, manifest_rows)
    for camid in predictions:
        entry = missing.setdefault(camid, {"reason": None, "ranks": {}, "candidate_available": True})
        if not entry.get("ranks"):
            entry["reason"] = None
    box_reasons = build_box_reasons(paths, args.manifest)

    write_json(args.out_predictions, predictions)
    write_json(args.out_missing, missing)
    write_json(args.out_box_reasons, box_reasons)
    receipt = {
        "schema_version": "wings-gallery-candidate-d-payload/2",
        "status": "complete",
        "cell": CELL,
        "seed": int(SEED),
        "candidate_checkpoint_sha256": CHECKPOINT_SHA256,
        "mode": MODE,
        "source_oof_sha256": sha256(args.oof),
        "collection_sha256": sha256(args.collection),
        "legacy_predictions_sha256": sha256(args.legacy_predictions) if args.legacy_predictions and args.legacy_predictions.exists() else None,
        "synonyms_sha256": sha256(args.synonyms) if args.synonyms and args.synonyms.exists() else None,
        "manifest_sha256": sha256(args.manifest) if args.manifest and args.manifest.exists() else None,
        "predictions_sha256": sha256(args.out_predictions),
        "missing_reasons_sha256": sha256(args.out_missing),
        "box_reasons_sha256": sha256(args.out_box_reasons),
        "candidate_oof_camids": len(rows),
        "gallery_union_camids": len(union_records),
        "gallery_candidate_camids": len(predictions),
        "gallery_missing_camids": sum(1 for entry in missing.values() if entry.get("reason")),
        "historical_prediction_camids": len(historical_keys),
        "historical_without_candidate": len(historical_keys - set(predictions)),
        "rank_rows": dict(Counter(rank for value_ in rows.values() for rank in value_)),
        "missing_rank_rows": {
            rank: sum(rank not in value_ for value_ in rows.values()) for rank in RANKS
        },
        "top5_labels_available": False,
        "top5_contract": "frozen rows expose top5_correct only; ranked labels are not fabricated",
        "aliases": aliases,
        "source_tabs": [name for name, path in paths if path and path.exists()],
    }
    write_json(args.out_receipt, receipt)
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
