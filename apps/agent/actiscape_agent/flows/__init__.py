"""Mode-specific layout task handlers decoupling LangGraph orchestration from domain logic."""

from .base import LayoutTaskHandler
from .edit_handler import EditTaskHandler
from .floorplan_handler import FloorplanTaskHandler
from .rectangular_handler import RectangularTaskHandler

_HANDLERS: dict[str, LayoutTaskHandler] = {
    "reconstruct_floorplan": FloorplanTaskHandler(),
    "generate_rectangular": RectangularTaskHandler(),
    "edit": EditTaskHandler(),
    "repair_layout": EditTaskHandler(),
    "interactive_action": EditTaskHandler(),
    "photo_to_scene": EditTaskHandler(),
}
_DEFAULT_HANDLER = EditTaskHandler()


def resolve_task_handler(mode: str | None) -> LayoutTaskHandler:
    return _HANDLERS.get(mode or "edit", _DEFAULT_HANDLER)


__all__ = [
    "EditTaskHandler",
    "FloorplanTaskHandler",
    "LayoutTaskHandler",
    "RectangularTaskHandler",
    "resolve_task_handler",
]
