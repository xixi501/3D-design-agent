"""Code-owned semantic checks for explicit furniture requests.

The asset role may choose equivalent catalogue recipes, but it cannot replace a
requested purpose or size with a different one. These checks are deliberately
small and deterministic; they are shared by asset selection and the scope
compiler so a later model retry cannot bypass them.
"""

from __future__ import annotations

import re


def _name(item: dict) -> str:
    return str(item.get("name") or "")


def _type(item: dict) -> str:
    return str(item.get("type") or "")


def _size_mm(query: str, user_text: str, key: str) -> int | None:
    text = f"{query} {user_text}"
    if "床" in query or "床" in user_text:
        if re.search(r"1[.]8\s*(?:m|米)|1800\s*(?:mm|毫米)", text, re.IGNORECASE):
            return 1800
        if re.search(r"1[.]5\s*(?:m|米)|1500\s*(?:mm|毫米)", text, re.IGNORECASE):
            return 1500
    return None


def semantic_errors(
    user_text: str, additions: list[dict], choices: list[dict], catalogue: dict
) -> list[str]:
    errors: list[str] = []
    for choice in choices:
        index = choice.get("request_index")
        key = choice.get("key")
        if not isinstance(index, int) or index < 0 or index >= len(additions):
            continue
        item = catalogue.get(key) or {}
        query = str(additions[index].get("query") or "")
        name, kind, width = (
            _name(item),
            _type(item) or str(key or ""),
            float(item.get("w") or 0),
        )

        def fail(
            message: str,
            query: str = query,
            item: dict = item,
            key: str = key,
            name: str = name,
        ) -> None:
            errors.append(f"“{query}”选择了 {item.get('key') or key}（{name}）：{message}")

        if "三人沙发" in query or ("沙发" in query and "三人" in user_text):
            if "沙发" not in name or width < 1800:
                fail("需要三人沙发（普通基础款，宽度不少于 1800 mm）")
            continue
        if "单人沙发" in query:
            if kind != "armchair":
                fail("需要单人沙发")
            continue
        if "餐椅" in query:
            if kind != "chair":
                fail("需要餐椅")
            continue
        if "办公椅" in query:
            if kind != "officeChair":
                fail("需要办公椅")
            continue
        if "电视柜" in query:
            if kind != "tvCabinet":
                fail("需要电视柜")
            continue
        if "落地灯" in query:
            if kind != "floorLamp":
                fail("需要落地灯")
            continue
        if "茶几" in query:
            if kind != "coffeeTable":
                fail("需要茶几")
            continue
        if "餐桌" in query:
            if kind != "diningTable":
                fail("需要餐桌")
            continue
        if "床头柜" in query:
            if kind != "nightstand":
                fail("需要床头柜")
            continue
        if "衣柜" in query:
            if not (kind == "wardrobe" or ("衣柜" in name and kind == "cabinet")):
                fail("需要衣柜")
            continue
        if "书桌" in query:
            if kind != "desk":
                fail("需要书桌")
            continue
        if "书柜" in query or "书架" in query:
            if not (kind == "bookshelf" or key in {"bookshelf", "cabTall"} or "书柜" in name):
                fail("需要书柜/书架")
            continue
        if "一字橱柜" in query or "一字" in query:
            if kind != "counter" or "一字" not in name:
                fail("需要一字橱柜")
            continue
        if "橱柜" in query:
            if kind not in {"counter", "lCounter", "uCounter"} or "橱柜" not in name:
                fail("需要橱柜")
            continue
        if "冰箱" in query:
            if kind != "fridge":
                fail("需要冰箱")
            continue
        if "马桶" in query:
            if kind != "toilet":
                fail("需要马桶")
            continue
        if "浴室柜" in query:
            if kind != "vanity" and "浴室柜" not in name:
                fail("需要浴室柜")
            continue
        if "淋浴房" in query:
            if kind != "shower":
                fail("需要淋浴房")
            continue
        if "鞋柜" in query:
            if key not in {"cabShoe", "shoeCabinet"} and "鞋柜" not in name:
                fail("需要鞋柜")
            continue
        if "换鞋凳" in query:
            if kind != "entryBench" and "换鞋凳" not in name:
                fail("需要换鞋凳")
            continue
        if "玄关桌" in query:
            if kind != "consoleTable" and "玄关桌" not in name:
                fail("需要玄关桌")
            continue
        if "绿植" in query:
            if kind not in {"plant", "shrub", "tree"} and "绿植" not in name:
                fail("需要绿植")
            continue
        size = _size_mm(query, user_text, key)
        if (
            size == 1800
            and ("床" in query or "床" in user_text)
            and (kind != "bed" or abs(width - 1800) > 20)
        ):
            fail("需要 1.8 m 双人床")
        elif (
            size == 1500
            and ("床" in query or "床" in user_text)
            and (kind != "bed" or abs(width - 1500) > 20)
        ):
            fail("需要 1.5 m 双人床")
    return errors
