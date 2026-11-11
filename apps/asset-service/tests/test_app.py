import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import trimesh
from fastapi.testclient import TestClient

from asset_service.app import create_app
from asset_service.glb import normalize_scene_bounds


IMAGE = Path(__file__).parents[1] / "examples" / "demo-input.png"


class AssetServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.old_environment = {
            key: os.environ.get(key) for key in ("ASSET_BACKEND", "ASSET_DATA_DIR")
        }
        os.environ["ASSET_BACKEND"] = "demo"
        os.environ["ASSET_DATA_DIR"] = self.temporary.name
        self.client = TestClient(create_app())

    def tearDown(self) -> None:
        self.client.close()
        self.temporary.cleanup()
        for key, value in self.old_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def generate(self, **fields) -> dict:
        data = {"name": "测试花瓶", **fields}
        with IMAGE.open("rb") as source:
            response = self.client.post(
                "/api/v1/assets/generate",
                files={"image": ("vase.png", source.read(), "image/png")},
                data=data,
            )
        self.assertEqual(response.status_code, 202, response.text)
        payload = response.json()
        job = payload["job"]
        deadline = time.monotonic() + 10
        while job["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(0.02)
            response = self.client.get(f"/api/v1/jobs/{job['id']}")
            self.assertEqual(response.status_code, 200)
            job = response.json()["job"]
        self.assertEqual(job["status"], "succeeded", job.get("error"))
        return payload | {"job": job}

    def test_generation_contract_and_bottom_center(self) -> None:
        payload = self.generate(
            category="vase",
            placement_type="surface",
            target_height_mm="280",
            max_faces="20000",
            prompt="陶瓷花瓶",
        )
        job = payload["job"]
        asset = job["result"]
        self.assertEqual(asset["assetId"], job["id"])
        self.assertEqual(asset["category"], "vase")
        self.assertEqual(asset["placementType"], "surface")
        self.assertEqual(asset["physicalDimensionsMm"]["height"], 280)
        self.assertEqual(asset["scaleSource"], "user_confirmed")
        self.assertEqual(asset["pivot"], "bottom_center")
        self.assertAlmostEqual(asset["spatial"]["bounds_min"][1], 0.0, places=6)
        self.assertEqual(asset["spatial"]["normalization"]["center"], [0.0, 0.0, 0.0])
        self.assertAlmostEqual(asset["stats"]["aspectRatio"]["height"], 1.0)
        self.assertEqual(job["options"]["max_faces"], 20000)
        self.assertEqual(len(asset["inputSha256"]), 64)
        self.assertIn("fileSizeBytes", asset["stats"])
        self.assertIn("faces", asset["stats"])

        model = self.client.get(asset["glbUrl"])
        self.assertEqual(model.status_code, 200)
        self.assertEqual(model.content[:4], b"glTF")
        preview = self.client.get(asset["previewUrl"])
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.content[:8], b"\x89PNG\r\n\x1a\n")

    def test_category_defaults(self) -> None:
        asset = self.generate(category="vase")["job"]["result"]
        self.assertEqual(asset["placementType"], "surface")
        self.assertEqual(asset["physicalDimensionsMm"]["height"], 280)
        self.assertEqual(asset["scaleSource"], "category_default")
        self.assertFalse(asset["spatial"]["scale_calibrated"])

    def test_calibrate_without_regeneration(self) -> None:
        first = self.generate(category="vase")["job"]["result"]
        response = self.client.post(
            f"/api/v1/assets/{first['assetId']}/calibrate",
            json={
                "heightMm": 300,
                "placementType": "surface",
                "category": "vase",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        calibrated = response.json()["asset"]
        self.assertEqual(calibrated["assetId"], first["assetId"])
        self.assertEqual(calibrated["physicalDimensionsMm"]["height"], 300)
        self.assertEqual(calibrated["scaleSource"], "user_confirmed")
        self.assertTrue(calibrated["spatial"]["scale_calibrated"])
        expected_width = round(
            300
            * first["stats"]["aspectRatio"]["width"]
            / first["stats"]["aspectRatio"]["height"]
        )
        self.assertEqual(calibrated["physicalDimensionsMm"]["width"], expected_width)
        record = Path(self.temporary.name) / "jobs" / first["assetId"] / "record.json"
        self.assertEqual(json.loads(record.read_text())["physicalDimensionsMm"]["height"], 300)

    def test_sha256_cache_and_force_regenerate(self) -> None:
        first = self.generate(category="vase")
        second = self.generate(category="decor", name="相同图片")
        self.assertTrue(second["cached"])
        self.assertTrue(second["replayed"])
        self.assertEqual(second["job"]["id"], first["job"]["id"])

        forced = self.generate(category="vase", force_regenerate="true")
        self.assertFalse(forced["cached"])
        self.assertNotEqual(forced["job"]["id"], first["job"]["id"])

    def test_legacy_jobs_endpoint(self) -> None:
        with IMAGE.open("rb") as source:
            response = self.client.post(
                "/api/v1/jobs",
                files={"file": ("vase.png", source.read(), "image/png")},
                data={"name": "旧接口"},
            )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["job"]["id"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = self.client.get(f"/api/v1/jobs/{job_id}").json()["job"]
            if job["status"] == "succeeded":
                break
            time.sleep(0.02)
        self.assertEqual(job["status"], "succeeded")

    def test_normalize_scene_bounds(self) -> None:
        scene = trimesh.Scene(trimesh.creation.box(extents=[2, 4, 1]))
        result = normalize_scene_bounds(scene)
        self.assertAlmostEqual(float(scene.bounds[0][1]), 0.0, places=6)
        self.assertAlmostEqual(float(scene.bounds[1][1]), 1.0, places=6)
        self.assertAlmostEqual(float(scene.centroid[0]), 0.0, places=6)
        self.assertAlmostEqual(float(scene.centroid[2]), 0.0, places=6)
        self.assertEqual(result["aspect_ratio"], [0.5, 1.0, 0.25])


if __name__ == "__main__":
    unittest.main()
