# -*- coding: utf-8 -*-
"""make_index.py — 生成 skills/index.v1.json（机读）与 skills/README.md（人读）。

用法：python tools/make_index.py --schema v1
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "skills")
FW = os.path.join(SKILLS, "_framework")

GROUPS = [
    ("起居", ["living-dining-small", "living-dining-open", "social-reading-zone"]),
    ("卧室与儿童", ["master-bedroom", "kids-room", "guest-bedroom", "nursery", "tatami-multipurpose"]),
    ("工作与娱乐", ["home-office", "office-workstation", "gaming-room", "media-room", "tea-room"]),
    ("厨房与餐区", ["kitchen-line-l-u", "dining-island"]),
    ("卫浴、玄关、家政", ["bathroom-standard", "entry-storage", "balcony-laundry", "utility-storage"]),
    ("户型与人群", ["studio-micro", "aging-friendly", "pet-friendly", "rental-makeover"]),
    ("别墅与健身", ["villa-ground-floor", "home-gym"]),
    ("横向能力", ["floorplan-intake", "photo-object-import", "style-coherence", "lighting-color", "layout-check-repair"]),
]


def case_stats(sdir):
    ex = os.path.join(sdir, "examples")
    pos = bnd = 0
    if os.path.isdir(ex):
        for c in os.listdir(ex):
            p = os.path.join(ex, c, "ops.json")
            if os.path.isfile(p):
                k = json.load(open(p, encoding="utf-8")).get("kind")
                pos += 1 if k == "positive" else 0
                bnd += 1 if k == "boundary" else 0
    return pos, bnd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", default="v1", choices=["v1"])
    args = ap.parse_args()

    mans = {}
    for d in sorted(os.listdir(SKILLS)):
        p = os.path.join(SKILLS, d, "manifest.json")
        if os.path.isfile(p):
            mans[d] = json.load(open(p, encoding="utf-8"))
    judge_n = len(json.load(open(os.path.join(FW, "judgements.v1.json"), encoding="utf-8"))["judgements"])

    items, n_cases = [], 0
    for sid, m in mans.items():
        pos, bnd = case_stats(os.path.join(SKILLS, sid))
        n_cases += pos + bnd
        items.append({
            "id": sid, "name": m["name"], "version": m["version"], "kind": m["kind"],
            "activation": m["activation"], "status": m["status"], "summary": m["summary"],
            "capabilities": m["capabilities"], "judgements": m["judgements"],
            "cases": {"positive": pos, "boundary": bnd},
            "conflictsWith": m["composition"]["conflictsWith"],
        })

    index = {
        "schemaVersion": "actiscape.skill-pool.v1",
        "poolVersion": time.strftime("%Y-%m-%d"),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "counts": {
            "skills": len(items),
            "active": sum(1 for i in items if i["activation"] == "active"),
            "reserved": sum(1 for i in items if i["activation"] == "reserved"),
            "cases": n_cases,
            "judgements": judge_n,
        },
        "active": [i["id"] for i in items if i["activation"] == "active"],
        "reserved": [i["id"] for i in items if i["activation"] == "reserved"],
        "skills": items,
    }
    out = os.path.join(SKILLS, "index.v1.json")
    json.dump(index, open(out, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)

    L = ["# Skill 池索引（v1，自动生成）", "",
         f"> schema `actiscape.skill-pool.v1`（池）/ `actiscape.skill.v1`（包）；"
         f"{index['counts']['skills']} 个技能、"
         f"{index['counts']['active']} active / {index['counts']['reserved']} reserved、"
         f"{index['counts']['cases']} 个案例、{index['counts']['judgements']} 条判据。",
         "> 重新生成：`python tools/make_index.py --schema v1`。", ""]
    L += ["## 读数", "",
          "| 列 | 含义 |", "|---|---|",
          "| kind | `layout / edit / modifier / intake / repair / asset` |",
          "| activation | `active` 首批启用；`reserved` 预留，等核心能力就绪 |",
          "| 案例 | 正向 / 边界数量（每个包至少各 1 个） |",
          "| modes | `generate_rectangular / edit / reconstruct_floorplan / asset_import` |", ""]
    for g, ids in GROUPS:
        present = [i for i in ids if i in mans]
        if not present:
            continue
        L.append(f"## {g}")
        L.append("")
        L.append("| 技能 | 一句话 | kind | activation | 案例 |")
        L.append("|---|---|---|---|---|")
        for sid in present:
            m = mans[sid]
            pos, bnd = case_stats(os.path.join(SKILLS, sid))
            L.append(f"| [`{sid}`]({sid}/SKILL.md) | {m['summary']} | `{m['kind']}` | "
                     f"`{m['activation']}` | {pos}/{bnd} |")
        L.append("")
    extra = [i for i in mans if i not in {x for _, g in GROUPS for x in g}]
    if extra:
        L += ["## 未分组", "", "| 技能 | kind | activation |", "|---|---|---|"]
        L += [f"| [`{i}`]({i}/SKILL.md) | `{mans[i]['kind']}` | `{mans[i]['activation']}` |" for i in extra]
        L.append("")
    L += ["## 怎么用", "",
          "1. 选择器读 `index.v1.json` 或各包 `manifest.json`：按 `appliesTo` 匹配，按 `activation` 过滤；",
          "2. 执行器读 `SKILL.md` 正文；判据从 `_framework/judgements.v1.json` 注入（只注入本包引用的 ID）；",
          "3. 技能只使用 `capabilities` 里的语义能力，不持有写场景权限；",
          "4. `status` 一律为 `conformant`：结构 + 案例已过，真实核心（`validation.realCore`）仍为 false。", ""]
    open(os.path.join(SKILLS, "README.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L))

    print(f"wrote {out}: skills={len(items)} active={index['counts']['active']} "
          f"cases={n_cases} judgements={judge_n}")
    print(f"wrote {os.path.join(SKILLS, 'README.md')}")


if __name__ == "__main__":
    main()
