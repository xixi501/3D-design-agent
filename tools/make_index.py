# -*- coding: utf-8 -*-
"""make_index.py — 由 manifest + lint/dry-run 报告生成技能池索引 skills/README.md。

用法：python tools/make_index.py
先跑 skill_lint.py 与 dry_run.py --all，索引里的 L1/L2 才是最新结果。
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "skills")
REPORTS = os.path.join(ROOT, "reports")

GROUPS = [
    ("起居", ["living-dining-small", "living-dining-open", "social-reading-zone"]),
    ("卧室", ["master-bedroom", "kids-room"]),
    ("工作", ["home-office", "office-workstation"]),
    ("厨房", ["kitchen-line-l-u", "dining-island"]),
    ("卫浴", ["bathroom-standard"]),
    ("收纳", ["entry-storage"]),
    ("家政", ["balcony-laundry"]),
    ("户型", ["studio-micro"]),
    ("人群", ["aging-friendly", "pet-friendly"]),
    ("房源", ["rental-makeover"]),
    ("别墅", ["villa-ground-floor"]),
    ("横向", ["photo-object-import", "style-coherence", "lighting-color", "layout-check-repair", "floorplan-intake"]),
]


def load_manifests():
    out = {}
    for d in sorted(os.listdir(SKILLS)):
        p = os.path.join(SKILLS, d, "manifest.json")
        if os.path.isfile(p):
            try:
                out[d] = json.load(open(p, encoding="utf-8"))
            except json.JSONDecodeError:
                out[d] = {"id": d, "name": d, "summary": "（manifest 解析失败）", "cases": [], "status": "?", "level": "?"}
    return out


def load_reports():
    lint, dry = {}, {}
    lp = os.path.join(REPORTS, "lint.json")
    if os.path.isfile(lp):
        data = json.load(open(lp, encoding="utf-8"))
        lint = {k: len(v.get("errors", [])) for k, v in (data.get("per_skill") or {}).items()}
    dp = os.path.join(REPORTS, "dry_run.json")
    if os.path.isfile(dp):
        data = json.load(open(dp, encoding="utf-8"))
        for s in data.get("skills", []):
            cases = s.get("cases", [])
            dry[s["id"]] = {
                "total": len(cases),
                "ok": sum(1 for c in cases if c["evaluation"]["ok"]),
                "codes": sorted({c for c in [i for case in cases for i in case["issues"]]}),
            }
    return lint, dry


def main():
    mans = load_manifests()
    lint, dry = load_reports()
    ids = list(mans)

    lines = []
    lines.append("# Skill 池索引（自动生成，勿手改）")
    lines.append("")
    lines.append("> 由 `tools/make_index.py` 从各包 `manifest.json` + `reports/lint.json` + `reports/dry_run.json` 生成。")
    lines.append("> 重新生成：先跑 `python tools/skill_lint.py`、`python tools/dry_run.py --all`，再跑 `python tools/make_index.py`。")
    lines.append("")
    lines.append(f"共 **{len(ids)}** 个技能；判据 {sum(len(m.get('depends', {}).get('judgements', [])) for m in mans.values())} 处引用；"
                 f"L1 通过 {sum(1 for i in ids if lint.get(i, 1) == 0)}/{len(ids)}；"
                 f"L2 全绿 {sum(1 for i in ids if dry.get(i, {}).get('ok', 0) == dry.get(i, {}).get('total', 0) and dry.get(i, {}).get('total'))}/{len(ids)}。")
    lines.append("")
    lines.append("## 读数说明")
    lines.append("")
    lines.append("| 列 | 含义 |")
    lines.append("|---|---|")
    lines.append("| L1 | 结构检查（`skill_lint.py`）：字段、判据/工具引用、禁用词、案例齐备 |")
    lines.append("| L2 | 几何 dry-run（`dry_run.py`）：正向案例通过 + 边界案例按预期被拦 |")
    lines.append("| 状态 | `pending_adaptation`（依赖工具未落地）/ `pending_validation`（跑过案例待复跑）/ `released` |")
    lines.append("")

    for group, gids in GROUPS:
        present = [i for i in gids if i in mans]
        if not present:
            continue
        lines.append(f"## {group}")
        lines.append("")
        lines.append("| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |")
        lines.append("|---|---|---|---|---|---|---|")
        for sid in present:
            m = mans[sid]
            d = dry.get(sid, {})
            l1 = "✅" if lint.get(sid, 1) == 0 else f"❌{lint.get(sid)}"
            if d.get("total"):
                l2 = "✅" if d["ok"] == d["total"] else f"❌{d['ok']}/{d['total']}"
            else:
                l2 = "—"
            lines.append(f"| [`{sid}`]({sid}/SKILL.md) | {m.get('summary', '')} | {len(m.get('depends', {}).get('judgements', []))} | "
                         f"{len(m.get('cases', []))} | {l1} | {l2} | `{m.get('status', '?')}` |")
        lines.append("")

    extra = [i for i in ids if i not in {x for _, g in GROUPS for x in g}]
    if extra:
        lines.append("## 未分组")
        lines.append("")
        lines.append("| 技能 | 一句话 | L1 | L2 | 状态 |")
        lines.append("|---|---|---|---|---|")
        for sid in extra:
            m = mans[sid]
            d = dry.get(sid, {})
            l1 = "✅" if lint.get(sid, 1) == 0 else f"❌{lint.get(sid)}"
            l2 = "✅" if d.get("total") and d["ok"] == d["total"] else ("—" if not d.get("total") else f"❌{d['ok']}/{d['total']}")
            lines.append(f"| [`{sid}`]({sid}/SKILL.md) | {m.get('summary', '')} | {l1} | {l2} | `{m.get('status', '?')}` |")
        lines.append("")

    lines.append("## 怎么加载")
    lines.append("")
    lines.append("1. 读 `manifest.json`：用 `applies_when` 做选择（场景类型、面积区间、输入前置），`not_applicable` 做排除；")
    lines.append("2. 读 `SKILL.md` 正文执行；判据去 `_framework/JUDGEMENTS.md` 查；工具名去 `_framework/TOOLS.md` 查；")
    lines.append("3. 固定版本：任务开始时记录 `id + version`，更新不覆盖进行中的版本；")
    lines.append("4. 依赖工具未落地（`status=pending_adaptation`）时，按 SKILL.md 的降级路径执行，并在交付里标注。")
    lines.append("")
    lines.append("## 待办")
    lines.append("")
    lines.append("- L3 真工具验证：等成员1 的 `scene.*` / `check.run` 与成员2 的 `assets.*`；")
    lines.append("- 判据复核：`J-STA-*` 引自规范下限，需按现行版本与地方标准复核；")
    lines.append("- 案例扩充：同族场景（同一户型家族）不得跨开发/验证/最终测试集，扩案例时注意隔离。")
    lines.append("")

    out = os.path.join(SKILLS, "README.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {out}（{len(ids)} 个技能）")
    for g, gids in GROUPS:
        print(f"  {g}: {len([i for i in gids if i in mans])}")


if __name__ == "__main__":
    main()
