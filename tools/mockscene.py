# -*- coding: utf-8 -*-
"""mockscene.py — 最小场景引擎：只做几何与净空判定，用于技能 dry-run。

不做渲染、不生成模型；只回答"这套操作序列做出来的布置，能不能过检查"。
每个检查码对应 skills/_framework/JUDGEMENTS.md 的一个判据。

坐标：mm，x 向右、y 向下；墙坐标是墙中线；洞口 from/to 是沿墙从 a 起的距离。
"""
from __future__ import annotations

import json
import math
import os
from collections import deque
from dataclasses import dataclass, field
from typing import Iterable

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG_PATH = os.path.join(ROOT, "src_upstream", "reference", "catalog-sizes.json")

GRID = 50  # mm

RUG_KEYS = {"rug", "roundRug", "doormat", "playMat", "yogaMat", "lawn", "stepStones"}
CURTAIN_KEYS = {"curtain", "sheer"}
NON_BLOCKING_KEYS = RUG_KEYS | CURTAIN_KEYS
SEAT_KEYS = {"chair", "armDiningChair", "barStool", "stool", "diningBench", "bench", "officeChair",
             "gamingChair", "trainingChair", "ottoman", "beanbag"}
TABLE_KEYS = {"diningTable", "roundTable", "longTable", "ovalTable", "barTable", "kitchenIsland",
              "desk", "officeDesk", "lDesk", "kidsDesk", "counter", "lCounter", "uCounter", "teaTable",
              "diningTable4", "diningTable6", "roundMeeting", "conferenceTable", "trainingTable"}
SMALL_TABLE_KEYS = {"sideTable", "nestTables", "coffeeTable", "roundCoffee", "ovalCoffee"}
SOFA_KEYS = {"sofa", "lSofa", "loveseat", "armchair", "lounge", "readingChair", "uSofa", "chaise",
             "modularSofa", "fourSofa", "singleSofa", "officeSofa", "theaterSofa"}
SURFACE_KEYS = {"deskLamp", "tableVase", "bookSet", "plushToy", "microwave", "coffeeMachine"}
CABINET_KEYS = {"cabWardrobe", "cabSlide", "cabCorner", "cabShoe", "cabSideboard", "cabTall", "cabBase",
                "cabWall", "cabTV", "wardrobe", "bookshelf", "fridge", "fridgeDouble", "fridgeFrench",
                "freezer", "sideboard", "wineCabinet", "displayCabinet", "hallCabinet", "shoeCabinet"}

WALL_MOUNT = {"acWall", "hood", "wallTV", "mirrorCabinet", "towelWarmer", "wallPanel", "wallArt",
              "wallArt3", "wallClock", "projScreen", "gasHeater", "waterHeater", "evCharger",
              "wallToilet", "radiator", "louver", "wallLamp"}
CEILING_MOUNT = {"bathHeater", "clothesRack", "chandelier", "hangingPlant", "ceilingSpeaker",
                 "supplyVent", "returnVent", "fan", "pendant"}

PASSABLE_OPENINGS = {"door", "double", "unequal", "sliding", "folding", "pocket", "hole", "garage"}
WINDOW_OPENINGS = {"window", "slideWindow", "floorWindow", "highWindow", "bay", "bayInner", "glassWall"}

ROOM_MIN_AREA = [("主卧", 9.0), ("卧室", 9.0), ("儿童", 5.0), ("次卧", 5.0), ("书房", 5.0),
                 ("起居", 10.0), ("客厅", 10.0), ("客餐厅", 10.0)]


@dataclass
class Issue:
    code: str
    judgement_id: str
    severity: str
    message: str
    object_ids: list = field(default_factory=list)
    at: list | None = None

    def to_dict(self):
        return {"code": self.code, "judgement_id": self.judgement_id, "severity": self.severity,
                "message": self.message, "object_ids": self.object_ids, "at": self.at}


@dataclass
class Obj:
    id: str
    key: str
    at: tuple
    rot: int
    w: float
    d: float
    h: float
    mount: str = "floor"
    on: str | None = None
    meta: dict = field(default_factory=dict)

    @property
    def bbox(self):
        if self.rot in (90, 270):
            hw, hd = self.d / 2.0, self.w / 2.0
        else:
            hw, hd = self.w / 2.0, self.d / 2.0
        return (self.at[0] - hw, self.at[1] - hd, self.at[0] + hw, self.at[1] + hd)

    @property
    def is_floor(self):
        return self.mount == "floor"

    @property
    def blocks_floor(self):
        return self.is_floor and self.key not in NON_BLOCKING_KEYS and self.h > 100

    @property
    def length_along_wall(self):
        return self.w if self.rot in (0, 180) else self.d


def load_catalog(path: str = CATALOG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return {k: {"w": v[0], "d": v[1], "h": v[2]} for k, v in raw.items()}


def mount_of(key: str) -> str:
    if key in WALL_MOUNT:
        return "wall"
    if key in CEILING_MOUNT:
        return "ceiling"
    return "floor"


def polygon_area_m2(poly) -> float:
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0 / 1e6


def point_in_poly(pt, poly) -> bool:
    x, y = pt
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1):
            inside = not inside
    return inside


class Scene:
    def __init__(self, data: dict, catalog: dict | None = None):
        self.data = data
        self.catalog = catalog or load_catalog()
        self.walls = data.get("walls", [])
        self.openings = data.get("openings", [])
        self.rooms = data.get("rooms", [])
        self.min_passage = float(data.get("min_passage", 700))
        self.objects: list[Obj] = [self._make_obj(o) for o in data.get("objects", [])]

    # ---------- 构造与编辑 ----------
    def _make_obj(self, raw: dict) -> Obj:
        key = raw.get("key", "")
        cat = self.catalog.get(key, {})
        rot = int(raw.get("rot", 0)) % 360
        if rot % 90:
            raise ValueError(f"rot 只支持 90 的倍数：{raw}")
        return Obj(id=raw.get("id") or f"auto_{len(self.objects)}_{key}", key=key,
                   at=tuple(raw.get("at", (0, 0))), rot=rot,
                   w=raw.get("w", cat.get("w", 600)), d=raw.get("d", cat.get("d", 600)),
                   h=raw.get("h", cat.get("h", 600)),
                   mount=raw.get("mount", mount_of(key)), on=raw.get("on"), meta=dict(raw))

    def apply(self, edits: Iterable[dict]) -> list[dict]:
        applied = []
        for i, e in enumerate(edits):
            op = e.get("op")
            try:
                if op == "add":
                    o = dict(e.get("object", {}))
                    o.setdefault("id", f"obj_{len(self.objects)}_{i}")
                    self.objects.append(self._make_obj(o))
                    applied.append({"index": i, "id": o["id"], "op": op})
                elif op == "remove":
                    self._require(e["id"])
                    self.objects = [x for x in self.objects if x.id != e["id"]]
                    applied.append({"index": i, "id": e["id"], "op": op})
                elif op == "move":
                    o = self._require(e["id"])
                    o.at = tuple(e["to"])
                    applied.append({"index": i, "id": o.id, "op": op})
                elif op == "rotate":
                    o = self._require(e["id"])
                    o.rot = int(e["rot"]) % 360
                    applied.append({"index": i, "id": o.id, "op": op})
                elif op == "resize":
                    o = self._require(e["id"])
                    o.w, o.d, o.h = e.get("w", o.w), e.get("d", o.d), e.get("h", o.h)
                    applied.append({"index": i, "id": o.id, "op": op})
                elif op == "material":
                    o = self._require(e["id"])
                    o.meta["mat"] = e.get("mat")
                    applied.append({"index": i, "id": o.id, "op": op})
                elif op == "group":
                    applied.append({"index": i, "ids": e.get("ids", []), "op": op})
                else:
                    raise ValueError(f"未知 op：{op}")
            except (KeyError, ValueError) as exc:
                applied.append({"index": i, "error": str(exc)})
        return applied

    def _require(self, oid: str) -> Obj:
        for o in self.objects:
            if o.id == oid:
                return o
        raise KeyError(f"对象不存在：{oid}")

    # ---------- 几何 ----------
    def _wall(self, wid):
        for w in self.walls:
            if w["id"] == wid:
                return w
        return None

    def _openings_on(self, wid):
        return [o for o in self.openings if o["wall"] == wid]

    @staticmethod
    def _wall_geom(w):
        ax, ay = w["a"]
        bx, by = w["b"]
        L = math.hypot(bx - ax, by - ay) or 1e-9
        return ax, ay, (bx - ax) / L, (by - ay) / L, L

    @staticmethod
    def _overlap(a, b, tol=20.0) -> bool:
        return not (a[2] <= b[0] + tol or b[2] <= a[0] + tol or a[3] <= b[1] + tol or b[3] <= a[1] + tol)

    def _room_of(self, pt):
        for r in self.rooms:
            if point_in_poly(pt, r["polygon"]):
                return r
        return None

    def _inside_normal(self, w, op):
        ax, ay, ux, uy, _ = self._wall_geom(w)
        nx, ny = -uy, ux
        mid = (ax + ux * (op["from"] + op["to"]) / 2.0, ay + uy * (op["from"] + op["to"]) / 2.0)
        for sign in (1, -1):
            if self._room_of((mid[0] + nx * sign * 200, mid[1] + ny * sign * 200)):
                return (nx * sign, ny * sign), mid
        return (nx, ny), mid

    def _strip_rect(self, w, op, depth):
        ax, ay, ux, uy, _ = self._wall_geom(w)
        (nx, ny), mid = self._inside_normal(w, op)
        x1, y1 = ax + ux * op["from"], ay + uy * op["from"]
        x2, y2 = ax + ux * op["to"], ay + uy * op["to"]
        pts = [(x1, y1), (x2, y2), (x2 + nx * depth, y2 + ny * depth), (x1 + nx * depth, y1 + ny * depth)]
        return (min(p[0] for p in pts), min(p[1] for p in pts),
                max(p[0] for p in pts), max(p[1] for p in pts)), mid

    # ---------- 检查 ----------
    def check(self) -> dict:
        issues = []
        issues += self._check_overlap()
        issues += self._check_doors()
        issues += self._check_curtain()
        issues += self._check_sliding()
        issues += self._check_window_cabinet()
        issues += self._check_wall_mount()
        issues += self._check_support()
        issues += self._check_room_area()
        issues += self._check_proportion()
        issues += self._check_circulation()
        errors = [i for i in issues if i.severity == "error"]
        return {"pass": not errors, "issues": [i.to_dict() for i in issues],
                "summary": {"errors": len(errors),
                            "warns": len([i for i in issues if i.severity == "warn"]),
                            "objects": len(self.objects)}}

    def _check_overlap(self):
        out = []
        floor = [o for o in self.objects if o.is_floor and o.h > 100 and o.key not in NON_BLOCKING_KEYS]
        for i, a in enumerate(floor):
            for b in floor[i + 1:]:
                if a.on == b.id or b.on == a.id:
                    continue
                if not self._overlap(a.bbox, b.bbox):
                    continue
                if (a.key in SEAT_KEYS and b.key in TABLE_KEYS) or (b.key in SEAT_KEYS and a.key in TABLE_KEYS):
                    continue
                if (a.key in SMALL_TABLE_KEYS and b.key in SOFA_KEYS) or (b.key in SMALL_TABLE_KEYS and a.key in SOFA_KEYS):
                    continue
                if a.key in SURFACE_KEYS or b.key in SURFACE_KEYS:
                    continue
                out.append(Issue("OVER-01", "J-OVER-01", "error",
                                 f"{a.id}({a.key}) 与 {b.id}({b.key}) 重叠", [a.id, b.id], list(a.at)))
        return out

    def _check_doors(self):
        out = []
        for op in self.openings:
            if op.get("type") not in {"door", "double", "unequal"}:
                continue
            w = self._wall(op["wall"])
            if not w:
                continue
            rect, mid = self._strip_rect(w, op, float(op["to"] - op["from"]))
            for o in self.objects:
                if o.blocks_floor and self._overlap(rect, o.bbox):
                    out.append(Issue("DOOR-02", "J-DOOR-02", "error",
                                     f"门 {op['id']} 开启范围内有 {o.id}({o.key})", [o.id], list(o.at)))
        return out

    def _check_curtain(self):
        out = []
        for op in self.openings:
            if op.get("type") not in WINDOW_OPENINGS:
                continue
            w = self._wall(op["wall"])
            if not w:
                continue
            rect, mid = self._strip_rect(w, op, 150)
            for o in self.objects:
                if o.blocks_floor and o.key not in CURTAIN_KEYS and o.h > 600 and self._overlap(rect, o.bbox):
                    out.append(Issue("CUR-01", "J-CUR-01", "error",
                                     f"窗 {op['id']} 前 150mm 内有 h>{600} 的家具 {o.id}({o.key})",
                                     [o.id], list(o.at)))
        return out

    def _check_sliding(self):
        out = []
        for op in self.openings:
            if op.get("type") not in {"sliding", "folding", "pocket"}:
                continue
            w = self._wall(op["wall"])
            if not w:
                continue
            rect, mid = self._strip_rect(w, op, 400)
            for o in self.objects:
                if o.blocks_floor and self._overlap(rect, o.bbox):
                    out.append(Issue("DOOR-01", "J-DOOR-01", "error",
                                     f"推拉门 {op['id']} 前 400mm 内有 {o.id}({o.key})", [o.id], list(o.at)))
        return out

    def _check_window_cabinet(self):
        out = []
        for op in self.openings:
            if op.get("type") not in WINDOW_OPENINGS:
                continue
            w = self._wall(op["wall"])
            if not w:
                continue
            sill = float(op.get("sill", 900))
            rect, _ = self._strip_rect(w, op, 400)
            for o in self.objects:
                if o.blocks_floor and o.key in CABINET_KEYS and o.h > sill and self._overlap(rect, o.bbox):
                    out.append(Issue("WIN-01", "J-WIN-01", "error",
                                     f"窗 {op['id']} 前 400mm 内有高柜 {o.id}({o.key}, h={o.h})",
                                     [o.id], list(o.at)))
        return out

    def _check_wall_mount(self):
        out = []
        for o in self.objects:
            if o.is_floor:
                continue
            if o.mount == "ceiling":
                continue  # 吸顶件不要求贴墙，也不压洞口（高于门头）
            best = None
            for w in self.walls:
                ax, ay, ux, uy, L = self._wall_geom(w)
                px, py = o.at[0] - ax, o.at[1] - ay
                t = max(0.0, min(L, px * ux + py * uy))
                dist = math.hypot(o.at[0] - (ax + ux * t), o.at[1] - (ay + uy * t))
                if best is None or dist < best[0]:
                    best = (dist, w, t)
            if best is None:
                out.append(Issue("WALL-01", "J-WALL-01", "error", f"{o.id} 没有可依附的墙", [o.id], list(o.at)))
                continue
            dist, w, t = best
            if dist > w["t"] / 2.0 + 80:
                out.append(Issue("WALL-01", "J-WALL-01", "error",
                                 f"挂墙件 {o.id}({o.key}) 离墙 {dist:.0f}mm（容差 80）", [o.id], list(o.at)))
                continue
            for op in self._openings_on(w["id"]):
                if op["from"] - 50 <= t <= op["to"] + 50:
                    out.append(Issue("WALL-01", "J-WALL-01", "error",
                                     f"挂墙件 {o.id}({o.key}) 压在洞口 {op['id']} 上", [o.id], list(o.at)))
                    break
        return out

    def _check_support(self):
        out = []
        by_id = {o.id: o for o in self.objects}
        for o in self.objects:
            if not o.on:
                continue
            sup = by_id.get(o.on)
            if sup is None:
                out.append(Issue("ASSET-02", "J-ASSET-02", "error", f"{o.id} 的支撑物 {o.on} 不存在", [o.id], list(o.at)))
                continue
            a, b = o.bbox, sup.bbox
            if a[0] < b[0] - 10 or a[1] < b[1] - 10 or a[2] > b[2] + 10 or a[3] > b[3] + 10:
                out.append(Issue("ASSET-02", "J-ASSET-02", "error",
                                 f"{o.id}({o.key}) 超出支撑物 {sup.id}({sup.key})", [o.id, sup.id], list(o.at)))
        return out

    def _check_room_area(self):
        out = []
        for r in self.rooms:
            area = polygon_area_m2(r["polygon"])
            for kw, mn in ROOM_MIN_AREA:
                if kw in r.get("name", "") and area < mn - 1e-6:
                    out.append(Issue("STA-01", "J-STA-01", "warn",
                                     f"房间 {r['name']} 面积 {area:.1f}㎡ 低于 {mn}㎡", [], None))
                    break
        return out

    def _check_proportion(self):
        out = []
        for o in self.objects:
            wid = o.meta.get("wall_ref")
            if not wid:
                continue
            w = self._wall(wid)
            if not w:
                continue
            L = self._wall_geom(w)[4]
            if o.length_along_wall > L * 2 / 3 + 20:
                out.append(Issue("PROP-01", "J-PROP-01", "warn",
                                 f"{o.id}({o.key}) 长 {o.length_along_wall:.0f} 超过墙 {wid} 的 2/3（{L * 2 / 3:.0f}）",
                                 [o.id], list(o.at)))
        return out

    # ---------- 通行（clearance 场） ----------
    @staticmethod
    def _clearance(blocked, nx, ny):
        """近似欧氏距离场（3-4 chamfer，单位：1/3 格）。

        不用曼哈顿：走廊拐角处曼哈顿会把 500 的缝算成 700，导致"没有通道"漏判。
        返回值为 dist_cells*3，调用方按 /3*GRID 换算成 mm。
        """
        INF = 10 ** 9
        d = [[0 if blocked[i][j] else INF for j in range(ny)] for i in range(nx)]
        for i in range(nx):
            for j in range(ny):
                best = d[i][j]
                if i > 0:
                    best = min(best, d[i - 1][j] + 3)
                    if j > 0:
                        best = min(best, d[i - 1][j - 1] + 4)
                    if j + 1 < ny:
                        best = min(best, d[i - 1][j + 1] + 4)
                if j > 0:
                    best = min(best, d[i][j - 1] + 3)
                d[i][j] = best
        for i in range(nx - 1, -1, -1):
            for j in range(ny - 1, -1, -1):
                best = d[i][j]
                if i + 1 < nx:
                    best = min(best, d[i + 1][j] + 3)
                    if j > 0:
                        best = min(best, d[i + 1][j - 1] + 4)
                    if j + 1 < ny:
                        best = min(best, d[i + 1][j + 1] + 4)
                if j + 1 < ny:
                    best = min(best, d[i][j + 1] + 3)
                d[i][j] = best
        return d

    @staticmethod
    def _flood(free, seeds, nx, ny):
        seen = set()
        stack = [c for c in seeds if free[c[0]][c[1]]]
        while stack:
            i, j = stack.pop()
            if (i, j) in seen:
                continue
            seen.add((i, j))
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if 0 <= ii < nx and 0 <= jj < ny and free[ii][jj] and (ii, jj) not in seen:
                    stack.append((ii, jj))
        return seen

    def _blocked_grid(self, room, x0, y0, nx, ny):
        blocked = [[False] * ny for _ in range(nx)]
        for i in range(nx):
            for j in range(ny):
                if not point_in_poly((x0 + (i + 0.5) * GRID, y0 + (j + 0.5) * GRID), room["polygon"]):
                    blocked[i][j] = True
        for w in self.walls:
            ax, ay, ux, uy, L = self._wall_geom(w)
            ops = [o for o in self._openings_on(w["id"]) if o.get("type") in PASSABLE_OPENINGS]
            for i in range(nx):
                for j in range(ny):
                    if blocked[i][j]:
                        continue
                    cx, cy = x0 + (i + 0.5) * GRID, y0 + (j + 0.5) * GRID
                    px, py = cx - ax, cy - ay
                    t = px * ux + py * uy
                    if t < -GRID or t > L + GRID:
                        continue
                    if abs(-px * uy + py * ux) <= w["t"] / 2.0:
                        if not any(o["from"] - 30 <= t <= o["to"] + 30 for o in ops):
                            blocked[i][j] = True
        for o in self.objects:
            if not o.blocks_floor:
                continue
            b = o.bbox
            for i in range(nx):
                for j in range(ny):
                    if blocked[i][j]:
                        continue
                    cx, cy = x0 + (i + 0.5) * GRID, y0 + (j + 0.5) * GRID
                    if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]:
                        blocked[i][j] = True
        return blocked

    def _wall_band(self, room, x0, y0, nx, ny):
        """墙内侧一段"门槛带"：离墙中线 ≤ t/2+250 且落在墙的投影范围内。

        这段区域在门洞处是"洞腔"，几何上可行走但不是房间的可用通行区，
        计算"有没有 ≥min_passage 的通行区"时要排除，否则门洞本身会被算成宽通道。
        """
        band = [[False] * ny for _ in range(nx)]
        for w in self.walls:
            ax, ay, ux, uy, L = self._wall_geom(w)
            lim = w["t"] / 2.0 + 250
            for i in range(nx):
                for j in range(ny):
                    cx, cy = x0 + (i + 0.5) * GRID, y0 + (j + 0.5) * GRID
                    px, py = cx - ax, cy - ay
                    t = px * ux + py * uy
                    if t < -GRID or t > L + GRID:
                        continue
                    if abs(-px * uy + py * ux) <= lim:
                        band[i][j] = True
        return band

    @staticmethod
    def _widest_path(free, clearance_mm, seeds, nx, ny):
        """最大化"路径最窄处"（瓶颈宽度）：返回每个格子的 best_capacity(mm)。"""
        import heapq
        best = [[-1.0] * ny for _ in range(nx)]
        heap = []
        for (i, j) in seeds:
            if free[i][j] and clearance_mm[i][j] > best[i][j]:
                best[i][j] = clearance_mm[i][j]
                heapq.heappush(heap, (-best[i][j], i, j))
        while heap:
            neg, i, j = heapq.heappop(heap)
            cap = -neg
            if cap < best[i][j] - 1e-9:
                continue
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if not (0 <= ii < nx and 0 <= jj < ny) or not free[ii][jj]:
                    continue
                ncap = min(cap, clearance_mm[ii][jj])
                if ncap > best[ii][jj] + 1e-9:
                    best[ii][jj] = ncap
                    heapq.heappush(heap, (-ncap, ii, jj))
        return best

    def _check_circulation(self):
        out = []
        for room in self.rooms:
            xs = [p[0] for p in room["polygon"]]
            ys = [p[1] for p in room["polygon"]]
            x0, y0 = min(xs), min(ys)
            nx = int(math.ceil((max(xs) - x0) / GRID))
            ny = int(math.ceil((max(ys) - y0) / GRID))
            if nx * ny > 400000:
                continue
            blocked = self._blocked_grid(room, x0, y0, nx, ny)
            free = [[not blocked[i][j] for j in range(ny)] for i in range(nx)]
            if not any(any(row) for row in free):
                continue
            area = polygon_area_m2(room["polygon"])
            dist = self._clearance(blocked, nx, ny)
            band = self._wall_band(room, x0, y0, nx, ny)
            half = self.min_passage / 2.0
            wide = [[free[i][j] and not band[i][j] and dist[i][j] / 3.0 * GRID >= half
                     for j in range(ny)] for i in range(nx)]
            wide_total = sum(1 for i in range(nx) for j in range(ny) if wide[i][j])

            seeds, labels = [], []
            for op in self.openings:
                w = self._wall(op["wall"])
                if not w or op.get("type") not in PASSABLE_OPENINGS:
                    continue
                rect, mid = self._strip_rect(w, op, 300)
                cells = [(i, j) for i in range(nx) for j in range(ny) if free[i][j]
                         and rect[0] <= x0 + (i + 0.5) * GRID <= rect[2]
                         and rect[1] <= y0 + (j + 0.5) * GRID <= rect[3]]
                if not cells:
                    out.append(Issue("CIR-02", "J-CIR-02", "error",
                                     f"门 {op['id']} 前被家具堵住，没有可通行落脚点", [], list(mid)))
                seeds += cells
                labels.append((op["id"], set(cells)))
            if not seeds:
                continue
            comp = self._flood(free, seeds, nx, ny)
            wide_reached = sum(1 for (i, j) in comp if wide[i][j])
            # 可达性口径（已知局限见 VERIFY.md）：从门口能走到的"宽区"要占宽区的大部分。
            # 它抓得住"家具把房间切成两半""门口被堵""根本没有 ≥min_passage 的通道"，
            # 但抓不住"两片宽区之间只有一道窄口"（窄口仍可自由穿行）——那要等 L3 真工具做瓶颈宽度。
            if area >= 6 and wide_total > 0 and wide_reached / wide_total < 0.6:
                out.append(Issue("CIR-02", "J-CIR-01", "error",
                                 f"房间 {room.get('name', room['id'])} 从门口只能到达 "
                                 f"{wide_reached / wide_total * 100:.0f}% 的通行区域", [], None))
            elif area >= 6 and wide_total == 0:
                out.append(Issue("CIR-02", "J-CIR-01", "error",
                                 f"房间 {room.get('name', room['id'])} 内没有 ≥{self.min_passage:.0f}mm 的通行区",
                                 [], None))
            for k in range(1, len(labels)):
                if labels[k][1] and labels[0][1] and not (labels[k][1] & comp):
                    out.append(Issue("CIR-02", "J-CIR-02", "error",
                                     f"门 {labels[k][0]} 与门 {labels[0][0]} 之间不连通", [], None))
        return out


def run_case(case: dict, catalog: dict | None = None) -> dict:
    scene = Scene(case["scene"], catalog)
    applied = scene.apply(case.get("edits", []))
    result = scene.check()
    result["applied"] = applied
    result["case_id"] = case.get("case_id")
    return result


if __name__ == "__main__":
    import sys
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(run_case(json.load(f)), ensure_ascii=False, indent=2))
