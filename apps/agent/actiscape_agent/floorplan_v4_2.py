"""V4-2: dedicated structure role and code-controlled agent handoffs."""

from .floorplan_schemas import StructureSelectionV42
from .floorplan_v4 import (
    CHECK,
    MEASURE,
    V4_COMMON,
    VISION_ACTIVITY,
    FloorplanV4,
)

VERSION = "s2c-floorplan-v4-2"

STRUCTURE = (
    V4_COMMON
    + """\n你是专职结构 Agent。你不负责家具，也不拥有正式场景写入权限。
walls 只选择 structureSkeleton.candidateWalls 中的真实 candidateWallId；一个候选墙最多被一面业务墙引用。
openings 只引用 openingCandidates.candidateId 和类型；所属墙、偏移、宽度、墙厚和几何范围由代码根据断口两侧候选唯一决定。
rooms 为全部可见封闭空间，每个房间一个内部标签点；functionalArea 和 roomType 只能使用输入枚举。
targetRoomIds 必须覆盖用户 scope 选中的全部可见住宅房间，不得只因房间用途不同而省略。
dimensionReads 只选择 dimensionCandidates 并逐字抄录图中数字与单位。不要返回 anchors、毫米几何或自由像素坐标。
墙端点、中线、墙厚、锚点和门窗偏移全部由固定 geometry 层计算；你只能选择候选并解释不确定项。
所有 ID 使用输入中的真实 ID。未知候选、无证据补墙、无法确定断口所属墙或混合方向必须进入固定错误或阻断不确定项。
只返回 StructureSelectionV42，不输出 chain-of-thought 或说明性正文。
"""
)

STRUCTURE_REPAIR = (
    V4_COMMON
    + """\n上一轮结构结果未能由固定代码组装。你是同一个专职结构 Agent，只做一次有界修复。
只能使用 allowedCandidateWallIds、allowedOpeningCandidateIds 和 allowedDimensionCandidateIds。
禁止新增自由坐标、自由锚点、家具框或候选范围外对象。
逐项处理 errorCode、objectIds 和 message，保持无关墙、房间和尺寸身份不变。
若现有候选仍不足，保留 blocking 不确定项并返回无法安全组装；不得用近似候选伪装成功。
只返回 StructureSelectionV42。
"""
)


class FloorplanV42(FloorplanV4):
    def recognition_role(self, task):
        return "structure"

    def measurement_role(self, task):
        return "structure"

    def structure_schema(self, task):
        return StructureSelectionV42

    def prompt(self, name, task):
        if name == "STRUCTURE":
            return STRUCTURE
        if name == "STRUCTURE_REPAIR":
            return STRUCTURE_REPAIR
        return {
            "VISION_ACTIVITY": VISION_ACTIVITY,
            "MEASURE": MEASURE,
            "CHECK": CHECK,
        }.get(name) or super().prompt(name, task)
