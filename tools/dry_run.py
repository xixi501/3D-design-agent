# -*- coding: utf-8 -*-
"""dry_run.py — 对 skills/*/examples/*/ops.json 跑几何 dry-run，输出报告。

用法：
  python tools/dry_run.py --all
  python tools/dry_run.py --skill living-dining-small
  python tools/dry_run.py --all --report reports/dry_run.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from mockscene import load_catalog, run_case  # noqa: E402

# GBK 控制台下直接 print emoji 会 UnicodeEncodeError；统一把 stdout 切到 UTF-8。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SKILLS_DIR = os.path.join(ROOT, "skills")
TZ = timezone(timedelta(hours=8))


def iter_cases(skill_dir: str):
    ex = os.path.join(skill_dir, "examples")
    if not os.path.isdir(ex):
        return
    for name in sorted(os.listdir(ex)):
        p = os.path.join(ex, name, "ops.json")
        if os.path.isfile(p):
            yield name, p


def evaluate(case: dict, result: dict) -> dict:
    expect = case.get("expect", {})
    got_codes = [i["code"] for i in result["issues"]]
    must = list(expect.get("must_trigger", []))
    must_not = list(expect.get("must_not_trigger", []))
    checks = []
    ok = True

    want_pass = expect.get("pass")
    if want_pass is not None:
        c = (result["pass"] == want_pass)
        checks.append({"check": "pass", "want": want_pass, "got": result["pass"], "ok": c})
        ok &= c
    for code in must:
        c = code in got_codes
        checks.append({"check": "must_trigger", "code": code, "ok": c})
        ok &= c
    for code in must_not:
        c = code not in got_codes
        checks.append({"check": "must_not_trigger", "code": code, "ok": c})
        ok &= c

    return {"ok": bool(ok), "checks": checks, "got_codes": got_codes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--skill", action="append", default=[])
    ap.add_argument("--report", default=os.path.join("reports", "dry_run.json"))
    args = ap.parse_args()

    catalog = load_catalog()
    ids = args.skill or ([d for d in sorted(os.listdir(SKILLS_DIR))
                          if os.path.isdir(os.path.join(SKILLS_DIR, d)) and not d.startswith("_")] if args.all else [])
    if not ids:
        print("没有选中任何技能：用 --all 或 --skill <id>")
        return 2

    report = {"generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
              "engine": "mockscene/0.1", "skills": [], "totals": {}}
    n_cases = n_ok = 0
    for sid in ids:
        sdir = os.path.join(SKILLS_DIR, sid)
        entry = {"id": sid, "cases": []}
        for name, path in iter_cases(sdir):
            n_cases += 1
            with open(path, encoding="utf-8") as f:
                case = json.load(f)
            try:
                result = run_case(case, catalog)
                ev = evaluate(case, result)
            except Exception as exc:  # 引擎失败也要记录，不能静默
                ev = {"ok": False, "checks": [{"check": "engine", "ok": False, "error": repr(exc)}], "got_codes": []}
                result = {"pass": None, "issues": []}
            entry["cases"].append({
                "case_id": case.get("case_id", name),
                "kind": case.get("kind", "positive"),
                "pass": result.get("pass"),
                "issues": [i["code"] for i in result.get("issues", [])],
                "evaluation": ev,
            })
            n_ok += 1 if ev["ok"] else 0
        report["skills"].append(entry)

    report["totals"] = {"skills": len(ids), "cases": n_cases, "cases_ok": n_ok,
                        "all_ok": n_ok == n_cases and n_cases > 0}
    os.makedirs(os.path.dirname(os.path.join(ROOT, args.report)) or ".", exist_ok=True)
    out = os.path.join(ROOT, args.report)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    md = [f"# dry-run 报告（{report['generated_at']}）", "",
          f"引擎 `mockscene/0.1`；案例 {n_cases}，通过 {n_ok}。", "",
          "| 技能 | 案例 | 类型 | 结果 | 问题码 | 判定 |", "|---|---|---|---|---|---|"]
    for s in report["skills"]:
        if not s["cases"]:
            md.append(f"| {s['id']} | — | — | 无案例 | — | ⚠ 未验证 |")
            continue
        for c in s["cases"]:
            got = ", ".join(c["issues"]) or "—"
            md.append(f"| {s['id']} | {c['case_id']} | {c['kind']} | {'pass' if c['pass'] else 'fail'} | {got} | {'✅' if c['evaluation']['ok'] else '❌'} |")
    md_path = out.replace(".json", ".md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")

    print("\n".join(md))
    print(f"\nJSON: {out}\nMD:   {md_path}")
    return 0 if report["totals"]["all_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
