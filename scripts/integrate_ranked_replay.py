#!/usr/bin/env python3
"""Merge the verified fold-local ranked replay into the gallery payload."""
import gzip, json, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public/data"
RANKS = ("family", "subfamily", "tribe", "genus", "species", "subspecies")

def main():
    replay = json.load(gzip.open("/tmp/ranked-replay-v6.json.gz"))
    rows = {}
    for fold in replay["folds"].values():
        for rank, values in fold.items():
            for row in values:
                rows.setdefault(row["camid"], {})[rank] = row
    payload = json.load(open(ROOT / "predictions.json"))
    mismatch = 0
    coverage = {rank: 0 for rank in RANKS}
    for camid, item in payload.items():
        for rank, old in item.get("rank_predictions", {}).items():
            row = rows.get(camid, {}).get(rank)
            if not row:
                continue
            coverage[rank] += 1
            if old.get("prediction") != row.get("prediction") or abs(float(old.get("confidence", 0))-float(row.get("confidence", 0))) > 1e-9:
                mismatch += 1
            top5 = [[str(label), float(prob)] for label, prob in row.get("top5", [])]
            old.update({"top5": top5, "top5_labels": [x[0] for x in top5], "top5_probabilities": [x[1] for x in top5], "top5_labels_available": True, "truth_probability": row.get("truth_probability"), "recorded_probability": row.get("truth_probability")})
            if rank == "genus": item["genus"] = [[x[0], x[1], 0] for x in top5]
            elif rank == "species": item["species_all"] = [[x[0], x[1], 0] for x in top5]
            elif rank == "subspecies": item["subspecies"] = [[x[0], x[1], 0] for x in top5]
        # Preserve historical nested tree shape, attaching available subspecies.
        species = item.get("species_all", [])
        subs = item.get("subspecies", [])
        item["species"] = []
        for label, prob, *_ in species:
            nested = [[s[0], s[1], 0] for s in subs if str(s[0]).lower().startswith(str(label).lower()+" ")]
            item["species"].append([label, prob, 0, nested])
        recorded = item.get("recorded_taxonomy", {}).get("canonical", {})
        for key, rank in (("genus_p", "genus"), ("species_p", "species"), ("subsp_p", "subspecies")):
            target = str(recorded.get(rank) or "").lower()
            if not target:
                item.setdefault("rec", {})[key] = None
                continue
            found = next((p for label, p in item.get("rank_predictions", {}).get(rank, {}).get("top5", []) if str(label).lower() == target), None)
            row = rows.get(camid, {}).get(rank)
            if found is None and row and str(row.get("truth") or "").lower() == target:
                found = row.get("truth_probability")
            item.setdefault("rec", {})[key] = found
    out = ROOT / "predictions.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)+"\n")
    receipt = json.load(open(ROOT / "candidate_d_receipt.json"))
    receipt.update({"top5_status":"complete","top5_labels_available":True,"top5_contract":"fold-local replay from verified D checkpoints; equal_image visual-only values","ranked_replay_sha256":hashlib.sha256(open('/tmp/ranked-replay-v6.json.gz','rb').read()).hexdigest(),"ranked_replay_coverage":coverage,"ranked_replay_top1_mismatches":mismatch,"ranked_replay_rows":sum(coverage.values())})
    (ROOT / "candidate_d_receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True)+"\n")
    print(json.dumps({"coverage":coverage,"mismatches":mismatch}, indent=2))
if __name__ == "__main__": main()
