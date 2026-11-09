"""Render an evaluation-only floorplan reference over its source image."""

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(size):
    return ImageFont.load_default(size=size)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    image = Image.open(args.image).convert("RGB")
    data = json.loads(args.reference.read_text())
    if (
        data["image"]["width"] != image.width
        or data["image"]["height"] != image.height
    ):
        raise ValueError("reference image dimensions do not match source image")

    draw = ImageDraw.Draw(image, "RGBA")
    wall_by_id = {}
    for wall in data["walls"]:
        a, b = wall["a"], wall["b"]
        wall_by_id[wall["id"]] = wall
        draw.line(
            (a["x"], a["y"], b["x"], b["y"]),
            fill=(20, 90, 220, 215),
            width=max(3, round(float(wall.get("thicknessPx") or 8) * 0.45)),
        )
        draw.text(
            (a["x"] + 5, a["y"] + 4),
            wall["id"],
            font=font(15),
            fill=(10, 60, 170, 255),
            stroke_width=2,
            stroke_fill=(255, 255, 255, 230),
        )

    for opening in data["openings"]:
        wall = wall_by_id[opening["wallId"]]
        a, b = wall["a"], wall["b"]
        length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        ux, uy = (b["x"] - a["x"]) / length, (b["y"] - a["y"]) / length
        start = opening["offset"] - opening["width"] / 2
        end = opening["offset"] + opening["width"] / 2
        points = [
            (a["x"] + ux * start, a["y"] + uy * start),
            (a["x"] + ux * end, a["y"] + uy * end),
        ]
        color = (220, 40, 40, 240) if opening["type"] != "window" else (0, 180, 190, 240)
        draw.line(points, fill=color, width=9)
        draw.text(
            points[0],
            opening["id"],
            font=font(13),
            fill=color,
            stroke_width=2,
            stroke_fill=(255, 255, 255, 240),
        )

    for room in data["rooms"]:
        point = room["at"]
        label = f"{room['id']} | {room['name']}"
        box = draw.textbbox((0, 0), label, font=font(14), stroke_width=1)
        width = box[2] - box[0] + 8
        height = box[3] - box[1] + 6
        draw.rounded_rectangle(
            (
                point["x"] - width / 2,
                point["y"] - height / 2,
                point["x"] + width / 2,
                point["y"] + height / 2,
            ),
            radius=3,
            fill=(255, 245, 175, 235),
            outline=(120, 90, 0, 255),
            width=1,
        )
        draw.text(
            (point["x"] - width / 2 + 4, point["y"] - height / 2 + 2),
            label,
            font=font(14),
            fill=(70, 50, 0, 255),
        )

    for symbol in data["symbols"]:
        x, y = symbol["x"], symbol["y"]
        width, depth = symbol["w"], symbol["d"]
        if symbol.get("rot", 0) % 180 == 90:
            width, depth = depth, width
        box = (x - width / 2, y - depth / 2, x + width / 2, y + depth / 2)
        draw.rectangle(box, outline=(205, 25, 120, 245), width=3)
        draw.line((x - 8, y, x + 8, y), fill=(205, 25, 120, 180), width=1)
        draw.line((x, y - 8, x, y + 8), fill=(205, 25, 120, 180), width=1)
        draw.text(
            (box[0] + 3, box[1] + 2),
            f"{symbol['id']}:{symbol['category']}",
            font=font(13),
            fill=(160, 0, 80, 255),
            stroke_width=2,
            stroke_fill=(255, 255, 255, 235),
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(
        json.dumps(
            {
                "passed": True,
                "walls": len(data["walls"]),
                "openings": len(data["openings"]),
                "rooms": len(data["rooms"]),
                "symbols": len(data["symbols"]),
                "output": str(args.output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
