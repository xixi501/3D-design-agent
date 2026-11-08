# -*- coding: utf-8 -*-
"""catalog key 校验：所有案例里出现的家具 key 必须存在于固定尺寸表。

用法：python tools/validate_catalog.py [--catalog tools/data/catalog-sizes.json]
输出：reports/catalog_keys.v1.json；未知 key 直接 exit 1。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "skills")


def keys_in_case(case: dict) -> list:
    out = []
    for o in case.get("scene", {}).get("objects", []):
        if o.get("key"):
            out.append(o["key"])
    for e in case.get("edits", []):
        if e.get("op") == "add":
            k = (e.get("object") or {}).get("key")
            if k:
                out.append(k)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default=os.path.join(HERE, "data", "catalog-sizes.json"))
    ap.add_argument("--report", default=os.path.join("reports", "catalog_keys.v1.json"))
    args = ap.parse_args()

    catalog = json.load(open(args.catalog, encoding="utf-8"))
    known = set(catalog)

    used, unknown, per_case = {}, [], {}
    for d in sorted(os.listdir(SKILLS)):
        ex = os.path.join(SKILLS, d, "examples")
        if not os.path.isdir(ex):
            continue
        for c in sorted(os.listdir(ex)):
            p = os.path.join(ex, c, "ops.json")
            if not os.path.isfile(p):
                continue
            case = json.load(open(p, encoding="utf-8"))
            ks = keys_in_case(case)
            per_case[f"{d}/{c}"] = sorted(set(ks))
            for k in ks:
                used[k] = used.get(k, 0) + 1
                if k not in known:
                    unknown.append({"skill": d, "case": c, "key": k})

    out = {
        "schemaVersion": "actiscape.catalog.v1",
        "catalog": os.path.relpath(args.catalog, ROOT).replace("\\", "/"),
        "catalogKeys": len(known),
        "usedKeys": len(used),
        "unknownCount": len(unknown),
        "unknown": unknown,
        "used": dict(sorted(used.items())),
        "perCase": per_case,
    }
    path = os.path.join(ROOT, args.report)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)

    print(f"catalog keys: {len(known)}；案例用到: {len(used)}；未知: {len(unknown)}")
    for u in unknown:
        print(f"  UNKNOWN {u['skill']}/{u['case']}: {u['key']}")
    print(f"报告: {path}")
    return 0 if not unknown else 1


if __name__ == "__main__":
    sys.exit(main())
