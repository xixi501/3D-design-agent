import json
import shutil
import subprocess
from pathlib import Path

from pygltflib import BufferView, GLTF2

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/editor/public/hero-assets"
WORK = OUT / ".work"
ASSETS = [
    ("Sofa_01", "sofa-01", ["sofa", "fourSofa", "singleSofa", "officeSofa"]),
    ("sofa_02", "sofa-02", ["modularSofa", "theaterSofa"]),
    ("ArmChair_01", "armchair-01", ["armchair", "readingChair"]),
    ("modern_arm_chair_01", "armchair-02", ["rockingChair"]),
    ("dining_chair_02", "chair-01", ["chair", "armDiningChair", "trainingChair"]),
    ("WoodenChair_01", "chair-02", ["officeChair"]),
    ("CoffeeTable_01", "coffee-table-01", ["coffeeTable", "teaTable"]),
    ("modern_coffee_table_01", "coffee-table-02", ["consoleTable"]),
    ("dining_table", "dining-table-01", ["diningTable", "diningTable4", "diningTable6", "longTable", "conferenceTable"]),
    ("WoodenTable_01", "dining-table-02", ["trainingTable", "curveTrainingTable"]),
    ("metal_office_desk", "desk-01", ["desk", "officeDesk", "kidsDesk", "standingDesk"]),
    ("side_table_01", "side-table-01", ["sideTable"]),
    ("old_bed_frame", "bed-01", ["bed", "bed12", "bed15", "bed18", "bed20", "kingBed", "kidsBed"]),
    ("vintage_day_bed", "bed-02", ["dayBed"]),
    ("modern_wooden_cabinet", "cabinet-01", []),
    ("Shelf_01", "shelf-01", ["bookshelf", "bookshelfLow"]),
    ("potted_plant_01", "plant-01", ["plant", "bigPlant"]),
    ("potted_plant_02", "plant-02", ["smallPlant"]),
    ("desk_lamp_arm_01", "desk-lamp-01", ["deskLamp"]),
    ("modern_ceiling_lamp_01", "ceiling-lamp-01", []),
]


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return
    subprocess.run(
        ["curl", "-sS", "-f", "-A", "Mozilla", "--retry", "3", "--max-time", "120", "-o", str(destination), url],
        check=True,
    )


def pack_glb(source: Path, output: Path) -> None:
    document = GLTF2().load(str(source))
    document.animations = []
    document.skins = []
    for node in document.nodes:
        node.skin = None
    if len(document.buffers) != 1:
        raise RuntimeError(f"Expected one buffer in {source}")
    binary = bytearray((source.parent / document.buffers[0].uri).read_bytes())
    for image in document.images:
        if not image.uri:
            continue
        data = (source.parent / image.uri).read_bytes()
        while len(binary) % 4:
            binary.append(0)
        document.bufferViews.append(
            BufferView(buffer=0, byteOffset=len(binary), byteLength=len(data))
        )
        image.bufferView = len(document.bufferViews) - 1
        image.uri = None
        binary.extend(data)
    document.buffers[0].uri = None
    document.buffers[0].byteLength = len(binary)
    document.set_binary_blob(bytes(binary))
    document.save_binary(str(output))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = []
    for asset_id, slug, keys in ASSETS:
        print(f"Preparing {asset_id}", flush=True)
        metadata_path = WORK / f"{slug}.json"
        download(f"https://api.polyhaven.com/files/{asset_id}", metadata_path)
        metadata = json.loads(metadata_path.read_text())
        gltf_info = metadata["gltf"]["1k"]["gltf"]
        source = WORK / slug / gltf_info["url"].rsplit("/", 1)[-1]
        download(gltf_info["url"], source)
        for relative, resource in gltf_info.get("include", {}).items():
            download(resource["url"], source.parent / relative)
        output = OUT / f"{slug}.glb"
        pack_glb(source, output)
        manifest.append({
            "id": slug,
            "source": f"https://polyhaven.com/a/{asset_id}",
            "license": "CC0",
            "file": f"/hero-assets/{slug}.glb",
            "bytes": output.stat().st_size,
            "catalogKeys": keys,
        })
        (WORK / f"{slug}.json").unlink(missing_ok=True)
    (OUT / "manifest.json").write_text(json.dumps({
        "version": 1,
        "sourceLicense": "https://polyhaven.com/license",
        "assets": manifest,
    }, ensure_ascii=False, indent=2) + "\n")
    shutil.rmtree(WORK)
    print(f"Prepared {len(manifest)} hero assets", flush=True)


if __name__ == "__main__":
    main()
