import io
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from asset_service.app import create_app


class ViewLabelsTest(unittest.TestCase):
    def test_invalid_labels(self):
        output = io.BytesIO()
        Image.new("RGB", (16, 16), "red").save(output, format="PNG")
        photo = output.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, ASSET_BACKEND="demo", ASSET_DATA_DIR=directory):
                with TestClient(create_app()) as client:
                    for labels in ['not-json', '{}', '[]', '["front"]', '["unknown"]', '[3]']:
                        response = client.post("/api/v1/assets/generate", files=[
                            ("image", ("front.png", photo, "image/png")),
                            ("reference_images", ("back.png", photo, "image/png")),
                        ], data={"reference_views": labels})
                        self.assertEqual(response.status_code, 400, (labels, response.text))
                    response = client.post("/api/v1/assets/generate", files=[
                        ("image", ("front.png", photo, "image/png")),
                        ("reference_images", ("back.png", photo, "image/png")),
                        ("reference_images", ("left.png", photo, "image/png")),
                    ], data={"reference_views": '["back", "back"]'})
                    self.assertEqual(response.status_code, 400)
