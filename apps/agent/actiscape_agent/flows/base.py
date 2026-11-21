"""Protocol / base contract for mode-specific workflow handlers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..workflow import Workflow


class LayoutTaskHandler(ABC):
    """Encapsulates mode-specific behavior across the shared LangGraph pipeline."""

    @abstractmethod
    async def ground(self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def assets(self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def scope(self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def design(self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def create_candidate(
        self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def inspect_visual(
        self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        raise NotImplementedError

    @abstractmethod
    def exhausted_repair(
        self, wf: Workflow, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        raise NotImplementedError

    @abstractmethod
    def route_repair(
        self, wf: Workflow, state: dict[str, Any], task: dict[str, Any], count: int
    ) -> dict:
        raise NotImplementedError
