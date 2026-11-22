"""OpenTelemetry white-box span instrumentation compatible with Huawei Cloud AgentArts OTel probe."""

from __future__ import annotations

import contextlib
from typing import Any

try:
    from opentelemetry import trace as _otel_trace

    _TRACER = _otel_trace.get_tracer("actiscape.agentarts.workflow", "0.4.0")
except Exception:  # pragma: no cover - graceful no-op when OTel not installed
    _otel_trace = None
    _TRACER = None


@contextlib.contextmanager
def trace_stage(stage_name: str, attributes: dict[str, Any] | None = None):
    """Create an OpenTelemetry span for AgentArts Observatory waterfall visualization."""
    if _TRACER is None:
        yield None
        return
    with _TRACER.start_as_current_span(f"actiscape.{stage_name}") as span:
        if attributes:
            set_span_attributes(span, attributes)
        yield span


def set_span_attributes(span: Any, attributes: dict[str, Any]) -> None:
    if span is None:
        return
    with contextlib.suppress(Exception):
        for key, value in attributes.items():
            if value is None:
                continue
            attr_key = key if key.startswith("actiscape.") else f"actiscape.{key}"
            if isinstance(value, (bool, int, float, str)):
                span.set_attribute(attr_key, value)
            elif isinstance(value, (list, tuple)):
                span.set_attribute(attr_key, ",".join(str(x) for x in value[:20]))
            else:
                span.set_attribute(attr_key, str(value)[:500])


def record_current_span(attributes: dict[str, Any]) -> None:
    if _otel_trace is None:
        return
    with contextlib.suppress(Exception):
        span = _otel_trace.get_current_span()
        if span and span.is_recording():
            set_span_attributes(span, attributes)
