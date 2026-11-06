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
        if abs(x2-x1) > 3 and abs(y2-y1) > 3:
            continue
        lines.append({"a": {"x": round(x1*sx, 3), "y": round(y1*sy, 3)}, "b": {"x": round(x2*sx, 3), "y": round(y2*sy, 3)}})
    lines.sort(key=lambda line: -((line["a"]["x"]-line["b"]["x"])**2+(line["a"]["y"]-line["b"]["y"])**2))
    return {"width": image.width, "height": image.height, "format": format_name,
            "orientation": orientation, "normalizedWidth": normalized.width,
            "normalizedHeight": normalized.height, "pixelSpace": "exif-oriented original pixels",
            "normalizedToPixel": {"x": sx, "y": sy}, "lineCandidates": lines[:400],
            "normalized": base64.b64encode(png(normalized)).decode()}


def crop_image(content: bytes, box: list[float]):
    image, _, _ = decode_image(content)
    if len(box) != 4 or not all(isinstance(v, (int, float)) and np.isfinite(v) for v in box):
        raise ValueError("裁剪范围无效")
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= image.width and 0 <= y0 < y1 <= image.height):
        raise ValueError("裁剪超出原图")
    crop = image.crop(tuple(int(round(v)) for v in box))
    crop.thumbnail((1600, 1600))
    return png(crop)


if __name__ == "__main__":
    try:
        print(json.dumps(inspect_image(sys.stdin.buffer.read(MAX_BYTES + 1))))
    except Exception as error:
        print(json.dumps({"error": "INVALID_IMAGE", "message": str(error)[:500]}))
        sys.exit(1)
