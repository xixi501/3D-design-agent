# 真实 V100 生成资产缓存（Real-Cache First）

`apps/service` 在收到物品照片后先按 `sha256(图片)` 查询本目录，命中则 1 秒内直接登记为
`custom_<assetId>`，不再请求远端 GPU。目录结构：

```text
data/real-generated-assets/<input_sha256>/
  input.png             # 原始输入照片（可选，用于追溯）
  asset.glb             # 已减面、已做底部中心归一化的 GLB
  metadata.json
```

`metadata.json` 最小契约：

```json
{
  "input_sha256": "…",
  "name": "V100 真实花瓶",
  "category": "vase",
  "is_real_generation": true,
  "size_mm": { "w": 280, "d": 280, "h": 280 },
  "glb_sha256": "…",
  "scale_calibrated": true,
  "scale_source": "category_prior",
  "created_at": "2026-11-10T00:00:00Z"
}
```

- `is_real_generation` 为 `true` 时，前端标记为真实 GPU 产物；演示资产不写入此目录。
- `size_mm` 若存在，网关以它覆盖 GLB 原始包围盒；用户在校准接口确认高度后写回
  `scale_calibrated=true`、`scale_source="user_confirmed"`。
- 远端 GPU 成功生成后，网关会自动把输入图、GLB 和 metadata 写入本目录，下一次相同照片
  直接命中缓存。

本目录由 `ACTISCAPE_ASSET_CACHE_DIR` 覆盖；默认是 `${ACTISCAPE_DATA_DIR}/real-generated-assets`。
当前仓库尚未合入成员二 V100 的真实产物，目录先保留接口与契约；演示阶段由
`fixtures/textured-vase.glb` 作为 Demo Fallback，不会标记为真实生成。
