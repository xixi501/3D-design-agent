import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = ROOT / "fixtures/full-home-candidates"
SOURCES = DIRECTORY / "sources.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_full_home_candidate_pool_is_hash_bound_and_not_marked_verified():
    document = json.loads(SOURCES.read_text())
    assert document["schemaVersion"] == "actiscape.full-home-candidate.v1"
    assert document["status"] == "candidate-not-verified"
    assert len(document["candidates"]) == 4
    ids = set()
    files = set()
    for candidate in document["candidates"]:
        assert candidate["id"] not in ids
        assert candidate["workingFile"] not in files
        ids.add(candidate["id"])
        files.add(candidate["workingFile"])
        path = DIRECTORY / candidate["workingFile"]
        assert digest(path) == candidate["workingSha256"]
        with Image.open(path) as image:
            assert image.format == "JPEG"
            assert image.size == (
                candidate["workingWidth"],
                candidate["workingHeight"],
            )
        assert len(candidate["originalSha256"]) == 64
        assert candidate["sourcePage"].startswith(
            "https://commons.wikimedia.org/wiki/File:"
        )
        assert candidate["license"] in {
            "CC BY-SA 4.0",
            "Public domain",
        }
        if candidate["license"] == "CC BY-SA 4.0":
            assert candidate["licenseUrl"]
            assert candidate["author"]
    assert not list(DIRECTORY.glob("*evaluation*.json"))


def test_full_home_candidate_contact_sheet_is_an_inspection_only_artifact():
    document = json.loads(SOURCES.read_text())
    contact = document["contactSheet"]
    assert contact["purpose"] == "human inspection only"
    assert digest(DIRECTORY / contact["file"]) == contact["sha256"]
