import argparse
import hashlib
import time
import uuid
from pathlib import Path

from PIL import Image

from .backends import HunyuanBackend
from .glb import inspect_glb
from .store import atomic_json, utc_now


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a reduced real V100 vase preset")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--height-mm", type=int, default=280)
    parser.add_argument("--max-faces", type=int, default=20000)
    args = parser.parse_args()

    started = time.monotonic()
    args.output.mkdir(parents=True, exist_ok=True)
    generated = HunyuanBackend().generate(args.input, args.output, args.max_faces)
    model_path = args.output / "model.glb"
    generated["path"].replace(model_path)
    model = inspect_glb(
        model_path,
        category="vase",
        target_height_mm=args.height_mm,
        normalize=True,
    )
    input_sha256 = hashlib.sha256(args.input.read_bytes()).hexdigest()
    asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, input_sha256))
    Image.open(args.input).save(args.output / "preview.png", format="PNG")
    record = {
        "asset_id": asset_id,
        "assetId": asset_id,
        "name": "real-v100-vase",
        "status": "succeeded",
        "category": "vase",
        "placementType": "surface",
        "physicalDimensionsMm": model["physicalDimensionsMm"],
        "scaleSource": "user_confirmed",
        "pivot": "bottom_center",
        "inputSha256": input_sha256,
        "created_at": utc_now(),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "glbUrl": "model.glb",
        "previewUrl": "preview.png",
        "previewSource": "input_image",
        "generation": generated["generation"],
        "spatial": {
            "unit": "m",
            "up_axis": "Y",
            "origin": "bottom_center",
            "scale_calibrated": True,
            **{
                key: model[key]
                for key in ("bounds_min", "bounds_max", "size_m", "size_mm", "normalization")
            },
        },
        "stats": {
            "vertices": model["vertices"],
            "faces": model["faces"],
            "fileSizeBytes": model["bytes"],
            "aspectRatio": model["aspectRatio"],
        },
        "file": {
            key: model[key]
            for key in ("sha256", "bytes", "vertices", "faces", "materials")
        },
    }
    atomic_json(args.output / "record.json", record)
    print(f"Preset written to {args.output}")
    print(f"Faces: {model['faces']}; bytes: {model['bytes']}")


if __name__ == "__main__":
    main()
