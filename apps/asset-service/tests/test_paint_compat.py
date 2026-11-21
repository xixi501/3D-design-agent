import os
import sys
import tempfile
import unittest
from pathlib import Path

from asset_service.paint_compat import ensure_hunyuan_paint_compat


class PaintCompatTest(unittest.TestCase):
    def test_idempotent_registration_without_weights(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state = ensure_hunyuan_paint_compat(Path(tmp))
            self.assertIn("diffusers_modules", sys.modules)
            self.assertIn("diffusers_modules.local", sys.modules)
            self.assertIsInstance(state, dict)
            # Second call is a safe no-op
            state2 = ensure_hunyuan_paint_compat(Path(tmp))
            self.assertEqual(state["modules"], state2["modules"])
            self.assertFalse(os.path.exists(os.path.join(tmp, "sitecustomize.py")))


if __name__ == "__main__":
    unittest.main()
