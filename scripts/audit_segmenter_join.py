#!/usr/bin/env python3
"""Audit retained segmenter output against canonical gallery photo keys."""
import json, re, hashlib
from pathlib import Path

def key(value):
    match = re.search(r'(cam\d+[a-z]*\d*)', str(value).lower())
    return match.group(1) if match else None

def main():
    results = json.load(open('/tmp/gallery-recovery-v2.json'))
    reasons = json.load(open('public/data/wing_box_reasons.json'))
    boxes = json.load(open('public/data/wing_boxes_v6.json'))
    rows=[]; projected=0; affected=0
    for result in results:
        raw=key(result['image']); canonical=next((k for k in boxes if k.lower()==(raw or '')), None)
        is_affected=raw in reasons and reasons[raw].get('status')!='eligible'
        if canonical: projected += 1
        if is_affected: affected += 1
        rows.append({'source_key':result['image'],'raw_prediction_key':raw,'canonical_gallery_key':canonical,'join_rule':'CAMID+dorsal/ventral+case-insensitive stem','detection_count':len(result['boxes_xyxy']),'terminal_outcome':result['status'],'affected_target':is_affected})
    out={'schema_version':'wings-segmenter-join-audit/v3','source_sha256':hashlib.sha256(open('/tmp/gallery-recovery-v2.json','rb').read()).hexdigest(),'raw_rows':len(results),'projected_rows':projected,'affected_targets':affected,'rejected_rows':len(results)-projected,'rows':rows}
    json.dump(out,open('public/data/segmenter-join-audit-v3.json','w'),indent=2,sort_keys=True); open('public/data/segmenter-join-audit-v3.json','a').write('\n')
    print(json.dumps({k:out[k] for k in ('raw_rows','projected_rows','affected_targets','rejected_rows')}))
if __name__=='__main__': main()
