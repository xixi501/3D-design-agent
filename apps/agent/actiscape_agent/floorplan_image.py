"""Bounded image decoding and pixel primitives. No millimetre scene geometry lives here."""

import base64
import io
import json
import sys
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 25_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode_image(content: bytes):
    if not content or len(content) > MAX_BYTES:
        raise ValueError("需要不超过 20 MB 的 PNG/JPEG")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(content)) as probe:
            if probe.format not in ("PNG", "JPEG"):
                raise ValueError("仅支持 PNG/JPEG")
            if probe.width * probe.height > MAX_PIXELS:
                raise ValueError("解码图片超过 2500 万像素")
            format_name = probe.format
            probe.verify()
        with Image.open(io.BytesIO(content)) as source:
            orientation = source.getexif().get(274, 1)
            image = ImageOps.exif_transpose(source).convert("RGB")
    return image, format_name, orientation


def png(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def inspect_image(content: bytes):
    image, format_name, orientation = decode_image(content)
    normalized = image.copy()
    normalized.thumbnail((2048, 2048))
    pixels = cv2.cvtColor(np.array(normalized), cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(pixels, 60, 180)
    found = cv2.HoughLinesP(edges, 1, np.pi / 180, 40, minLineLength=35, maxLineGap=12)
    sx, sy = image.width / normalized.width, image.height / normalized.height
    lines = []
    for entry in found if found is not None else []:
        x1, y1, x2, y2 = (int(v) for v in entry[0])
        if abs(x2 - x1) > 3 and abs(y2 - y1) > 3:
            continue
        lines.append(
            {
                "a": {"x": round(x1 * sx, 3), "y": round(y1 * sy, 3)},
                "b": {"x": round(x2 * sx, 3), "y": round(y2 * sy, 3)},
            }
        )
    lines.sort(
        key=lambda line: (
            -((line["a"]["x"] - line["b"]["x"]) ** 2 + (line["a"]["y"] - line["b"]["y"]) ** 2)
        )
    )
    return {
        "width": image.width,
        "height": image.height,
        "format": format_name,
        "orientation": orientation,
        "normalizedWidth": normalized.width,
        "normalizedHeight": normalized.height,
        "pixelSpace": "exif-oriented original pixels",
        "normalizedToPixel": {"x": sx, "y": sy},
        "lineCandidates": lines[:400],
        "normalized": base64.b64encode(png(normalized)).decode(),
    }


def crop_image(content: bytes, box: list[float]):
    image, _, _ = decode_image(content)
    if len(box) != 4 or not all(isinstance(v, (int, float)) and np.isfinite(v) for v in box):
        raise ValueError("裁剪范围无效")
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= image.width and 0 <= y0 < y1 <= image.height):
        raise ValueError("裁剪超出原图")
    crop = image.crop(tuple(int(round(v)) for v in box))
    longest = max(crop.size)
    factor = min(4, 1024 / longest) if longest < 1024 else min(1, 1600 / longest)
    if factor != 1:
        crop = crop.resize(
            (max(1, round(crop.width * factor)), max(1, round(crop.height * factor))),
            Image.Resampling.LANCZOS,
        )
    return png(crop)


def overlay_image(content: bytes, draft: dict):
    import math

    from PIL import ImageDraw

    image, _, _ = decode_image(content)
    overlay = image.copy()
    overlay.thumbnail((2048, 2048))
    sx, sy = overlay.width / image.width, overlay.height / image.height
    draw = ImageDraw.Draw(overlay)

    def xy(point):
        return (point["x"] * sx, point["y"] * sy)

    for wall in draft["walls"]:
        draw.line([xy(wall["a"]), xy(wall["b"])], fill="#dc2854", width=3)
        draw.text(xy(wall["a"]), wall["id"], fill="#dc2854")
    for opening in draft["openings"]:
        wall = next((w for w in draft["walls"] if w["id"] == opening["wallId"]), None)
        if not wall:
            continue
        a, b = wall["a"], wall["b"]
        length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        if not length:
            continue
        points = []
        for sign in [-1, 1]:
            t = (opening["offset"] + sign * opening["width"] / 2) / length
            points.append(
                xy({"x": a["x"] + (b["x"] - a["x"]) * t, "y": a["y"] + (b["y"] - a["y"]) * t})
            )
        draw.line(points, fill="#146de0", width=5)
    for room in draft["rooms"]:
        at = xy(room["at"])
        draw.ellipse((at[0] - 5, at[1] - 5, at[0] + 5, at[1] + 5), fill="#238331")
        draw.text(at, room["id"], fill="#238331")
    for symbol in draft["symbols"]:
        angle = math.radians(symbol["rot"])
        points = []
        for x, y in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            dx, dy = x * symbol["w"] / 2, y * symbol["d"] / 2
            points.append(
                xy(
                    {
                        "x": symbol["x"] + dx * math.cos(angle) - dy * math.sin(angle),
                        "y": symbol["y"] + dx * math.sin(angle) + dy * math.cos(angle),
                    }
                )
            )
        draw.line(points + [points[0]], fill="#9b42be", width=3)
        draw.text(xy(symbol), symbol["id"], fill="#9b42be")
    return png(overlay)


if __name__ == "__main__":
    try:
        mode = sys.argv[1] if len(sys.argv) > 1 else "inspect"
        content = sys.stdin.buffer.read(MAX_BYTES * 2 if mode != "inspect" else MAX_BYTES + 1)
        if mode == "inspect":
            result = inspect_image(content)
        else:
            payload = json.loads(content)
            raw = base64.b64decode(payload["image"], validate=True)
            output = (
                crop_image(raw, payload["box"])
                if mode == "crop"
                else overlay_image(raw, payload["draft"])
            )
            result = {"png": base64.b64encode(output).decode()}
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({"error": "INVALID_IMAGE", "message": str(error)[:500]}))
        sys.exit(1)
