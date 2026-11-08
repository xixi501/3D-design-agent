# -*- coding: utf-8 -*-
"""skill_lint.py — 技能包结构与规范检查（L1）。

检查项见 skills/_framework/VERIFY.md 第 1 节。
用法：
  python tools/skill_lint.py
  python tools/skill_lint.py --json reports/lint.json
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
FRAMEWORK = os.path.join(SKILLS, "_framework")

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
JUDGE_RE = re.compile(r"\bJ-[A-Z]{2,6}-\d{2}\b")
TOOL_RE = re.compile(r"`([a-z][a-z_]*\.[a-z_]+)`")
REQUIRED_SECTIONS = ["什么时候用", "怎么做", "依赖什么", "怎么验证", "版本与来源"]
FORBIDDEN = ["analyze.py", "build.py", "check.mjs", "qa.mjs", "wallaudit", "furnoverlay",
             "cadvec.py", "cadsplit.py", "npm run", "spec.json"]
STATUS_LEVEL = {
    "pending_adaptation": {"structure"},
    "pending_validation": {"dry_run"},
    "released": {"dry_run", "real_tool"},
}


def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end < 0:
        return None, text
    raw = text[3:end].strip("\n")
    body = text[end + 4:]
    data, cur = {}, None
    for line in raw.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0 and ":" in line:
            k, v = line.split(":", 1)
            k, v = k.strip(), v.strip()
            if v == "":
                cur = k
                data[k] = {}
            else:
                data[k] = v.strip('"').strip("'")
                cur = None
        elif indent > 0 and cur:
            k, v = line.strip().split(":", 1)
            data[cur][k.strip()] = v.strip().strip('"').strip("'")
    return data, body


def load_judgements():
    p = os.path.join(FRAMEWORK, "JUDGEMENTS.md")
    return set(JUDGE_RE.findall(open(p, encoding="utf-8").read()))


def load_tools():
    p = os.path.join(FRAMEWORK, "TOOLS.md")
    text = open(p, encoding="utf-8").read()
    names = set(TOOL_RE.findall(text))
    return {n for n in names if "schema" not in n}


def lint_skill(sid: str, judgements: set, tools: set) -> list:
    errs, warns = [], []
    sdir = os.path.join(SKILLS, sid)

    def err(msg):
        errs.append(f"{sid}: {msg}")

    def warn(msg):
        warns.append(f"{sid}: {msg}")

    skill_md = os.path.join(sdir, "SKILL.md")
    if not os.path.isfile(skill_md):
        err("缺 SKILL.md")
        return errs, warns
    text = open(skill_md, encoding="utf-8").read()
    fm, body = parse_frontmatter(text)
    if fm is None:
        err("SKILL.md 缺 YAML frontmatter")
        return errs, warns

    # 1-2 frontmatter
    name = fm.get("name", "")
    if not name:
        err("frontmatter 缺 name")
    elif not NAME_RE.match(name) or len(name) > 64:
        err(f"name 不合规：{name}")
    elif name != sid:
        err(f"name({name}) 与目录名({sid}) 不一致")
    desc = fm.get("description", "")
    if not desc:
        err("frontmatter 缺 description")
    elif len(desc) > 1024:
        err(f"description 过长（{len(desc)} > 1024）")

    # 3-4 manifest
    mpath = os.path.join(sdir, "manifest.json")
    man = {}
    if not os.path.isfile(mpath):
        err("缺 manifest.json")
    else:
        try:
            man = json.load(open(mpath, encoding="utf-8"))
        except json.JSONDecodeError as exc:
            err(f"manifest.json 不是合法 JSON：{exc}")
    if man:
        for key in ("schema_version", "id", "name", "version", "status", "level", "applies_when", "depends", "cases"):
            if key not in man:
                err(f"manifest 缺字段 {key}")
        if man.get("id") != sid:
            err(f"manifest.id({man.get('id')}) 与目录名不一致")
        if man.get("version") and not re.match(r"^\d+\.\d+\.\d+$", str(man["version"])):
            err(f"version 不是 x.y.z：{man.get('version')}")
        st, lv = man.get("status"), man.get("level")
        if st not in STATUS_LEVEL:
            err(f"status 非法：{st}")
        elif lv not in STATUS_LEVEL[st]:
            err(f"status={st} 与 level={lv} 不自洽（应为 {sorted(STATUS_LEVEL[st])}）")
        prov = man.get("provenance") or {}
        if not prov.get("license"):
            err("manifest.provenance.license 缺失")

    # 5-6 判据与工具引用
    deps = (man.get("depends") or {})
    for j in deps.get("judgements", []):
        if j not in judgements:
            err(f"manifest 引用了不存在的判据 {j}")
    for t in deps.get("tools", []):
        n = t.get("name") if isinstance(t, dict) else t
        if n not in tools:
            err(f"manifest 引用了不存在的工具 {n}")

    # 7 正文判据引用
    for j in sorted(set(JUDGE_RE.findall(body))):
        if j not in judgements:
            err(f"正文引用了不存在的判据 {j}")

    # 8 禁用词
    for w in FORBIDDEN:
        if w in body:
            err(f"正文出现旧工具链词 `{w}`")

    # 9 章节
    for sec in REQUIRED_SECTIONS:
        if f"## {sec}" not in body:
            err(f"缺章节 `## {sec}`")

    # 10 案例
    cases = man.get("cases") or []
    if len(cases) < 2:
        warn("manifest.cases 少于 2 个（建议至少 1 正向 + 1 边界）")
    kinds = [c.get("kind") for c in cases]
    if "positive" not in kinds:
        err("缺正向案例")
    if not any(k in ("boundary", "failure") for k in kinds):
        err("缺边界/失败案例")
    for c in cases:
        cid = c.get("id", "")
        cdir = os.path.join(sdir, "examples", cid)
        for fn in ("case.md", "ops.json", "expected.md"):
            if not os.path.isfile(os.path.join(cdir, fn)):
                err(f"案例 {cid} 缺 {fn}")
        op = os.path.join(cdir, "ops.json")
        if os.path.isfile(op):
            try:
                data = json.load(open(op, encoding="utf-8"))
            except json.JSONDecodeError as exc:
                err(f"案例 {cid} ops.json 非法：{exc}")
                continue
            for key in ("case_id", "scene", "edits", "expect"):
                if key not in data:
                    err(f"案例 {cid} ops.json 缺 {key}")
            if data.get("case_id") != cid:
                err(f"案例 {cid} 的 ops.json case_id 不一致（{data.get('case_id')}）")
            if not isinstance(data.get("edits"), list):
                err(f"案例 {cid} edits 不是数组")
            sc = data.get("scene") or {}
            for key in ("walls", "openings", "rooms", "objects"):
                if key not in sc:
                    err(f"案例 {cid} scene 缺 {key}")
            exp = data.get("expect") or {}
            if not isinstance(exp.get("pass"), bool):
                err(f"案例 {cid} expect.pass 不是布尔")
            if c.get("kind") in ("boundary", "failure") and not (exp.get("must_trigger") or []):
                err(f"边界案例 {cid} 未声明 must_trigger")

    # 11 状态与案例互证
    if man.get("status") == "pending_validation" and not man.get("validation", {}).get("record"):
        warn("pending_validation 但 validation.record 为空（跑完 dry-run 后回填）")

    return errs, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join("reports", "lint.json"))
    args = ap.parse_args()

    judgements, tools = load_judgements(), load_tools()
    ids = [d for d in sorted(os.listdir(SKILLS))
           if os.path.isdir(os.path.join(SKILLS, d)) and not d.startswith("_")]
    all_err, all_warn, per = [], [], {}
    for sid in ids:
        e, w = lint_skill(sid, judgements, tools)
        per[sid] = {"errors": e, "warnings": w}
        all_err += e
        all_warn += w

    print(f"技能 {len(ids)} 个；判据 {len(judgements)} 条；工具 {len(tools)} 个")
    for sid in ids:
        e, w = per[sid]["errors"], per[sid]["warnings"]
        mark = "✅" if not e else "❌"
        print(f"  {mark} {sid:<28} errors={len(e)} warnings={len(w)}")
        for m in e:
            print(f"      ERROR {m.split(': ', 1)[-1]}")
        for m in w:
            print(f"      warn  {m.split(': ', 1)[-1]}")
    print(f"\n合计：errors={len(all_err)} warnings={len(all_warn)}")

    out = os.path.join(ROOT, args.json)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"skills": len(ids), "judgements": len(judgements), "tools": len(tools),
               "errors": all_err, "warnings": all_warn, "per_skill": per},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"报告：{out}")
    return 0 if not all_err else 1


if __name__ == "__main__":
    sys.exit(main())
