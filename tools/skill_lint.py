# -*- coding: utf-8 -*-
"""skill_lint.py — Skill 池结构检查（默认 v1 schema）。

用法：
  python tools/skill_lint.py                 # 等价 --schema v1
  python tools/skill_lint.py --schema v1 --json reports/lint.v1.json

通过标准：30/30，0 error。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "skills")
FW = os.path.join(SKILLS, "_framework")
CATALOG = os.path.join(HERE, "data", "catalog-sizes.json")

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
JUDGE_RE = re.compile(r"\bJ-[A-Z]{2,6}-\d{2}\b")
REQUIRED_SECTIONS = ["什么时候用", "怎么做", "依赖什么", "怎么验证", "版本与来源"]
FORBIDDEN_TOOLS = ["scene.get_snapshot", "scene.apply_edits", "scene.diff", "check.run", "view.capture",
                   "assets.submit", "assets.status", "assets.get", "skills.list", "skills.get", "session.echo"]
FORBIDDEN_CAPS = {"scene.write", "project.commit"}

KIND = {
    "living-dining-small": "layout", "living-dining-open": "layout", "master-bedroom": "layout",
    "kids-room": "layout", "guest-bedroom": "layout", "home-office": "layout",
    "office-workstation": "layout", "kitchen-line-l-u": "layout", "dining-island": "layout",
    "bathroom-standard": "layout", "entry-storage": "layout", "balcony-laundry": "layout",
    "studio-micro": "layout", "villa-ground-floor": "layout", "gaming-room": "layout",
    "home-gym": "layout", "media-room": "layout", "nursery": "layout",
    "tatami-multipurpose": "layout", "tea-room": "layout", "utility-storage": "layout",
    "social-reading-zone": "edit",
    "aging-friendly": "modifier", "pet-friendly": "modifier", "rental-makeover": "modifier",
    "style-coherence": "modifier", "lighting-color": "modifier",
    "floorplan-intake": "intake",
    "layout-check-repair": "repair",
    "photo-object-import": "asset",
}
ACTIVE = {"living-dining-small", "living-dining-open", "social-reading-zone", "style-coherence",
          "lighting-color", "floorplan-intake", "layout-check-repair"}

TYPE_MAP = {"object": dict, "array": list, "string": str, "number": (int, float), "integer": int, "boolean": bool}


def validate(inst, schema, path="$"):
    errs = []
    t = schema.get("type")
    if t and not isinstance(inst, TYPE_MAP[t]) or (t in ("number", "integer") and isinstance(inst, bool)):
        return [f"{path}: 期望 {t}，实际 {type(inst).__name__}"]
    if "const" in schema and inst != schema["const"]:
        errs.append(f"{path}: 必须等于 {schema['const']!r}")
    if "enum" in schema and inst not in schema["enum"]:
        errs.append(f"{path}: {inst!r} 不在枚举 {schema['enum']}")
    if t == "object":
        for req in schema.get("required", []):
            if req not in inst:
                errs.append(f"{path}: 缺字段 {req}")
        props = schema.get("properties", {})
        for k, v in inst.items():
            if k in props:
                errs += validate(v, props[k], f"{path}.{k}")
            elif schema.get("additionalProperties") is False:
                errs.append(f"{path}: 不允许的字段 {k}")
    if t == "array":
        if "minItems" in schema and len(inst) < schema["minItems"]:
            errs.append(f"{path}: 元素太少（{len(inst)} < {schema['minItems']}）")
        if "maxItems" in schema and len(inst) > schema["maxItems"]:
            errs.append(f"{path}: 元素太多（{len(inst)} > {schema['maxItems']}）")
        item_schema = schema.get("items")
        if item_schema:
            for i, v in enumerate(inst):
                errs += validate(v, item_schema, f"{path}[{i}]")
    if t in ("string", "number"):
        if "minimum" in schema and inst < schema["minimum"]:
            errs.append(f"{path}: {inst} < {schema['minimum']}")
        if "maximum" in schema and inst > schema["maximum"]:
            errs.append(f"{path}: {inst} > {schema['maximum']}")
    if t == "string":
        if "minLength" in schema and len(inst) < schema["minLength"]:
            errs.append(f"{path}: 太短")
        if "maxLength" in schema and len(inst) > schema["maxLength"]:
            errs.append(f"{path}: 太长（{len(inst)} > {schema['maxLength']}）")
        if "pattern" in schema and not re.search(schema["pattern"], inst):
            errs.append(f"{path}: 不匹配 {schema['pattern']}")
    return errs


def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end < 0:
        return None, text
    raw, body = text[3:end].strip("\n"), text[end + 4:]
    data, cur = {}, None
    for line in raw.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not line.startswith(" ") and ":" in line:
            k, v = line.split(":", 1)
            k, v = k.strip(), v.strip()
            if v == "":
                cur = k
                data[k] = {}
            else:
                data[k] = v.strip('"').strip("'")
                cur = None
        elif cur and ":" in line:
            k, v = line.strip().split(":", 1)
            data[cur][k.strip()] = v.strip().strip('"').strip("'")
    return data, body


def case_kinds(sdir: str):
    ex = os.path.join(sdir, "examples")
    out = []
    if not os.path.isdir(ex):
        return out
    for c in sorted(os.listdir(ex)):
        p = os.path.join(ex, c, "ops.json")
        if os.path.isfile(p):
            try:
                out.append(json.load(open(p, encoding="utf-8")).get("kind", "?"))
            except json.JSONDecodeError:
                out.append("bad-json")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", default="v1", choices=["v1"])
    ap.add_argument("--json", default=os.path.join("reports", "lint.v1.json"))
    args = ap.parse_args()

    skill_schema = json.load(open(os.path.join(FW, "skill.schema.json"), encoding="utf-8"))
    judge_doc = json.load(open(os.path.join(FW, "judgements.v1.json"), encoding="utf-8"))
    judge_ids = {j["id"] for j in judge_doc["judgements"]}
    catalog = set(json.load(open(CATALOG, encoding="utf-8")))

    ids = [d for d in sorted(os.listdir(SKILLS))
           if os.path.isdir(os.path.join(SKILLS, d)) and not d.startswith("_")]
    all_err, per = [], {}
    for sid in ids:
        errs, warns = [], []
        sdir = os.path.join(SKILLS, sid)
        skill_md = os.path.join(sdir, "SKILL.md")
        man_path = os.path.join(sdir, "manifest.json")
        if not os.path.isfile(skill_md):
            errs.append("缺 SKILL.md")
        if not os.path.isfile(man_path):
            errs.append("缺 manifest.json")
        if errs:
            per[sid] = {"errors": errs, "warnings": warns}
            all_err += [f"{sid}: {e}" for e in errs]
            continue

        text = open(skill_md, encoding="utf-8").read()
        fm, body = parse_frontmatter(text)
        if fm is None:
            errs.append("SKILL.md 缺 YAML frontmatter")
            fm, body = {}, text

        if fm.get("name") != sid:
            errs.append(f"frontmatter.name({fm.get('name')}) 与目录不一致")
        fm_ver = fm.get("version") or (fm.get("metadata") or {}).get("version")
        if fm_ver != "0.2.0":
            errs.append(f"frontmatter.version 应为 0.2.0，实际 {fm_ver}")

        try:
            man = json.load(open(man_path, encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errs.append(f"manifest 不是合法 JSON：{exc}")
            man = {}

        if man:
            errs += [f"schema: {e}" for e in validate(man, skill_schema)]
            if man.get("id") != sid:
                errs.append(f"manifest.id({man.get('id')}) 与目录不一致")
            if man.get("version") != "0.2.0":
                errs.append(f"manifest.version 应为 0.2.0，实际 {man.get('version')}")
            if man.get("status") != "conformant":
                errs.append(f"status 应为 conformant（真实核心未验收前不得标 verified），实际 {man.get('status')}")
            want_act = "active" if sid in ACTIVE else "reserved"
            if man.get("activation") != want_act:
                errs.append(f"activation 应为 {want_act}，实际 {man.get('activation')}")
            if KIND.get(sid) and man.get("kind") != KIND[sid]:
                errs.append(f"kind 应为 {KIND[sid]}，实际 {man.get('kind')}")

            caps = set(man.get("capabilities", []))
            if caps & FORBIDDEN_CAPS:
                errs.append(f"capabilities 含禁止项：{sorted(caps & FORBIDDEN_CAPS)}")
            need = {"layout": "candidate.propose", "edit": "candidate.propose", "repair": "candidate.propose",
                    "asset": "asset.job", "intake": "floorplan.analyze", "modifier": "candidate.review"}[man.get("kind", "layout")]
            if need not in caps:
                errs.append(f"{man.get('kind')} 缺少必需 capability {need}")
            if man.get("kind") == "modifier" and "candidate.propose" in caps:
                errs.append("modifier 不得拥有 candidate.propose（不得独立产生第二轮修改）")

            judged = set(man.get("judgements", []))
            missing = sorted(judged - judge_ids)
            if missing:
                errs.append(f"引用了判据库里没有的 ID：{missing}")
            body_refs = set(JUDGE_RE.findall(body))
            if body_refs != judged:
                errs.append(f"正文判据 {sorted(body_refs)} 与 manifest.judgements {sorted(judged)} 不一致")
            unknown_refs = sorted(body_refs - judge_ids)
            if unknown_refs:
                errs.append(f"正文引用了不存在的判据：{unknown_refs}")

        for sec in REQUIRED_SECTIONS:
            if f"## {sec}" not in body:
                errs.append(f"缺章节 `## {sec}`")
        for w in FORBIDDEN_TOOLS:
            if w in body:
                errs.append(f"正文仍引用旧工具名 `{w}`")
        if "\\" in body:
            errs.append("正文含反斜杠路径（统一用 /）")
        if "mock/" in body or "deploy/" in body:
            errs.append("正文引用了未随仓库提交的目录")

        if KIND.get(sid) == "modifier" and "不独立产生第二轮修改" not in body:
            errs.append("modifier 正文缺少“不独立产生第二轮修改”声明")
        if KIND.get(sid) == "repair" and "三轮" not in body:
            errs.append("repair 正文缺少“复用三轮预算”说明")

        kinds = case_kinds(sdir)
        if "positive" not in kinds:
            errs.append("缺正向案例")
        if "boundary" not in kinds:
            errs.append("缺边界案例")

        # 案例 key 校验
        ex = os.path.join(sdir, "examples")
        if os.path.isdir(ex):
            for c in sorted(os.listdir(ex)):
                p = os.path.join(ex, c, "ops.json")
                if not os.path.isfile(p):
                    continue
                try:
                    case = json.load(open(p, encoding="utf-8"))
                except json.JSONDecodeError as exc:
                    errs.append(f"{c}: ops.json 非法：{exc}")
                    continue
                objs = list(case.get("scene", {}).get("objects", []))
                objs += [e.get("object", {}) for e in case.get("edits", []) if e.get("op") == "add"]
                for o in objs:
                    k = o.get("key")
                    if k and k not in catalog:
                        errs.append(f"{c}: 未知 catalog key `{k}`")

        per[sid] = {"errors": errs, "warnings": warns, "kind": KIND.get(sid),
                    "activation": "active" if sid in ACTIVE else "reserved"}
        all_err += [f"{sid}: {e}" for e in errs]

    n_active = sum(1 for s in ids if s in ACTIVE)
    print(f"schema={args.schema}  技能 {len(ids)}  判据 {len(judge_ids)}  active {n_active}  reserved {len(ids)-n_active}")
    for sid in ids:
        e = per.get(sid, {}).get("errors", [])
        mark = "OK " if not e else "ERR"
        print(f"  [{mark}] {sid:<26} {KIND.get(sid, '?'):<8} {'active' if sid in ACTIVE else 'reserved':<8} errors={len(e)}")
        for m in e:
            print(f"        - {m}")
    print(f"\n合计 errors={len(all_err)}")

    out = {"schemaVersion": "actiscape.skill.v1", "schema": args.schema, "skills": len(ids),
           "judgements": len(judge_ids), "active": n_active, "reserved": len(ids) - n_active,
           "errors": all_err, "perSkill": per}
    path = os.path.join(ROOT, args.json)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
    print(f"报告：{path}")
    return 0 if not all_err else 1


if __name__ == "__main__":
    sys.exit(main())
