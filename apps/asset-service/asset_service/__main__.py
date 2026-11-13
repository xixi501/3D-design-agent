import os

import uvicorn


if __name__ == "__main__":
    root_path = os.getenv("ASSET_ROOT_PATH", "").strip().rstrip("/")
    uvicorn.run(
        "asset_service.app:app",
        host=os.getenv("ASSET_HOST", "127.0.0.1"),
        port=int(os.getenv("ASSET_PORT", "8000")),
        root_path=root_path,
        reload=False,
    )
