import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import trimesh
from PIL import Image

from asset_service.backends import HunyuanBackend


class BackendMultiviewTest(unittest.TestCase):
    def test_multiview_conditions_and_exported_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            paths = []
            for view, color in [("front", "red"), ("back", "blue"), ("left", "green")]:
                path = directory / f"{view}.png"
                Image.new("RGB", (32, 32), color).save(path)
                paths.append(path)
            mesh = trimesh.creation.box(extents=[1, 2, 1])
            mesh.visual = trimesh.visual.TextureVisuals(
                uv=np.zeros((len(mesh.vertices), 2)),
                material=trimesh.visual.material.SimpleMaterial(image=Image.new("RGB", (16, 16), "blue")),
            )
            backend = HunyuanBackend()
            backend._load = Mock()
            backend._remover = lambda image: image.convert("RGBA")
            backend._shape = Mock(return_value=[mesh])
            backend._floater_remover = lambda value: value
            backend._degenerate_face_remover = lambda value: value
            backend._face_reducer = lambda value, **kwargs: value
            backend._texture = Mock(return_value=mesh)
            generated = backend.generate(
                paths[0], directory, reference_paths=paths[1:], reference_views=["back", "left"]
            )
            backend._load.assert_called_once_with(multiview=True)
            conditions = backend._shape.call_args.kwargs["image"]
            self.assertEqual(set(conditions), {"front", "back", "left"})
            self.assertEqual(conditions["back"].getpixel((0, 0))[:3], (0, 0, 255))
            self.assertEqual(len(backend._texture.call_args.kwargs["image"]), 3)
            self.assertEqual(generated["generation"]["geometry_conditioning"], "multiview")
            restored = trimesh.load(generated["path"], force="scene")
            material = next(iter(restored.geometry.values())).visual.material
            self.assertEqual(material.metallicFactor, 0.0)
            self.assertAlmostEqual(material.roughnessFactor, 0.65)
            self.assertTrue(material.doubleSided)
            self.assertAlmostEqual(float(restored.bounds[0][1]), 0.0)

    def test_single_image_keeps_single_view_pipeline(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "front.png"
            Image.new("RGBA", (32, 32), (200, 200, 200, 0)).save(path)
            mesh = trimesh.creation.box()
            mesh.visual = trimesh.visual.TextureVisuals(
                uv=np.zeros((len(mesh.vertices), 2)),
                material=trimesh.visual.material.PBRMaterial(baseColorFactor=[200, 200, 200, 255]),
            )
            backend = HunyuanBackend()
            backend._load = Mock()
            backend._shape = Mock(return_value=[mesh])
            backend._floater_remover = lambda value: value
            backend._degenerate_face_remover = lambda value: value
            backend._face_reducer = lambda value, **kwargs: value
            backend._texture = Mock(return_value=mesh)
            generated = backend.generate(path, directory)
            backend._load.assert_called_once_with(multiview=False)
            self.assertIsInstance(backend._shape.call_args.kwargs["image"], Image.Image)
            self.assertEqual(generated["generation"]["geometry_conditioning"], "single_front_image")
