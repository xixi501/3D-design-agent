import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from asset_service.app import create_app
from asset_service.backends import DemoBackend


def photo(color):
    output = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(output, format="PNG")
    return output.getvalue()


class MultiviewTest(unittest.TestCase):
    def test_reference_delivery_and_cache_identity(self):
        calls = []
        original = DemoBackend.generate

        def capture(backend, image_path, output_dir, max_faces=None, reference_paths=None, reference_views=None):
            calls.append([path.read_bytes() for path in reference_paths or []])
            return original(backend, image_path, output_dir, max_faces)

        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, ASSET_BACKEND="demo", ASSET_DATA_DIR=directory):
                with patch.object(DemoBackend, "generate", capture):
                    with TestClient(create_app()) as client:
                        def submit(reference):
                            result = client.post("/api/v1/assets/generate", files=[
                                ("image", ("front.png", photo("red"), "image/png")),
                                ("reference_images", ("back.png", reference, "image/png")),
                            ])
                            self.assertEqual(result.status_code, 202, result.text)
                            return result.json()

                        first = submit(photo("blue"))
                        import time
                        deadline = time.monotonic() + 10
                        while time.monotonic() < deadline:
                            job = client.get("/api/v1/jobs/" + first["job"]["id"]).json()["job"]
                            if job["status"] not in {"queued", "running"}:
                                break
                            time.sleep(0.02)
                        self.assertEqual(job["status"], "succeeded", job.get("error"))
                        self.assertEqual(len(calls[0]), 1)
                        self.assertTrue((Path(directory) / "jobs" / job["id"] / "reference-0.png").exists())
                        self.assertTrue(submit(photo("blue"))["cached"])
                        changed = submit(photo("green"))
                        self.assertFalse(changed["cached"])
                        self.assertNotEqual(first["job"]["inputSha256"], changed["job"]["inputSha256"])
                        deadline = time.monotonic() + 10
                        while time.monotonic() < deadline:
                            finished = client.get("/api/v1/jobs/" + changed["job"]["id"]).json()["job"]
                            if finished["status"] not in {"queued", "running"}:
                                break
                            time.sleep(0.02)
                        self.assertEqual(finished["status"], "succeeded", finished.get("error"))


    def test_reference_limit_and_invalid_image(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, ASSET_BACKEND="demo", ASSET_DATA_DIR=directory):
                with TestClient(create_app()) as client:
                    front = ("image", ("front.png", photo("red"), "image/png"))
                    reference = ("reference_images", ("back.png", photo("blue"), "image/png"))
                    result = client.post("/api/v1/assets/generate", files=[front, *([reference] * 6)])
                    self.assertEqual(result.status_code, 400)
                    result = client.post("/api/v1/assets/generate", files=[
                        front, ("reference_images", ("bad.png", b"invalid", "image/png"))
                    ])
                    self.assertEqual(result.status_code, 400)
