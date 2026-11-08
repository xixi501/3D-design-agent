# HTTP 契约执行报告（2026-11-08T23:25:19+0800）

服务 `http://127.0.0.1:8101`（mock scene service，复用 mockscene 几何口径）；案例 44 + 系统语义 3，通过 47/47，耗时 4.1s。

| 技能 | 案例 | 类型 | check.run | 问题码 | 判定 | 平面图 |
|---|---|---|---|---|---|---|
| aging-friendly | AGE-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/aging-friendly__AGE-dev-01_v2.png) |
| aging-friendly | AGE-dev-02 | boundary | fail | DOOR-02, CIR-02 | ✅ | — |
| balcony-laundry | BAL-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/balcony-laundry__BAL-dev-01_v2.png) |
| balcony-laundry | BAL-dev-02 | boundary | fail | DOOR-01, DOOR-01 | ✅ | — |
| bathroom-standard | BAT-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/bathroom-standard__BAT-dev-01_v2.png) |
| bathroom-standard | BAT-dev-02 | boundary | fail | DOOR-02 | ✅ | — |
| dining-island | ISL-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/dining-island__ISL-dev-01_v2.png) |
| dining-island | ISL-dev-02 | boundary | fail | CIR-02 | ✅ | — |
| entry-storage | ENT-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/entry-storage__ENT-dev-01_v2.png) |
| entry-storage | ENT-dev-02 | boundary | fail | DOOR-02 | ✅ | — |
| floorplan-intake | FIN-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/floorplan-intake__FIN-dev-01_v2.png) |
| floorplan-intake | FIN-dev-02 | boundary | fail | DOOR-02, CIR-02 | ✅ | — |
| home-office | HOF-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/home-office__HOF-dev-01_v2.png) |
| home-office | HOF-dev-02 | boundary | fail | ASSET-02 | ✅ | — |
| kids-room | KID-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/kids-room__KID-dev-01_v2.png) |
| kids-room | KID-dev-02 | boundary | fail | OVER-01 | ✅ | — |
| kitchen-line-l-u | KIT-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/kitchen-line-l-u__KIT-dev-01_v2.png) |
| kitchen-line-l-u | KIT-dev-02 | boundary | fail | CIR-02 | ✅ | — |
| layout-check-repair | LCR-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/layout-check-repair__LCR-dev-01_v2.png) |
| layout-check-repair | LCR-dev-02 | boundary | fail | WIN-01 | ✅ | — |
| lighting-color | LGT-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/lighting-color__LGT-dev-01_v2.png) |
| lighting-color | LGT-dev-02 | boundary | fail | DOOR-02 | ✅ | — |
| living-dining-open | LDO-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/living-dining-open__LDO-dev-01_v2.png) |
| living-dining-open | LDO-dev-02 | boundary | fail | CIR-02 | ✅ | — |
| living-dining-small | LD-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/living-dining-small__LD-dev-01_v2.png) |
| living-dining-small | LD-dev-02 | boundary | fail | CUR-01, WIN-01 | ✅ | — |
| master-bedroom | MBR-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/master-bedroom__MBR-dev-01_v2.png) |
| master-bedroom | MBR-dev-02 | boundary | fail | DOOR-02 | ✅ | — |
| office-workstation | OFW-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/office-workstation__OFW-dev-01_v2.png) |
| office-workstation | OFW-dev-02 | boundary | fail | DOOR-02, DOOR-02, CIR-02 | ✅ | — |
| pet-friendly | PET-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/pet-friendly__PET-dev-01_v2.png) |
| pet-friendly | PET-dev-02 | boundary | fail | CUR-01 | ✅ | — |
| photo-object-import | POI-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/photo-object-import__POI-dev-01_v2.png) |
| photo-object-import | POI-dev-02 | boundary | fail | ASSET-02 | ✅ | — |
| rental-makeover | RNT-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/rental-makeover__RNT-dev-01_v2.png) |
| rental-makeover | RNT-dev-02 | boundary | fail | CUR-01, WIN-01 | ✅ | — |
| social-reading-zone | SRZ-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/social-reading-zone__SRZ-dev-01_v2.png) |
| social-reading-zone | SRZ-dev-02 | boundary | fail | CUR-01, WIN-01 | ✅ | — |
| studio-micro | STU-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/studio-micro__STU-dev-01_v2.png) |
| studio-micro | STU-dev-02 | boundary | fail | DOOR-02, CIR-02 | ✅ | — |
| style-coherence | STY-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/style-coherence__STY-dev-01_v2.png) |
| style-coherence | STY-dev-02 | boundary | fail | CUR-01, WIN-01 | ✅ | — |
| villa-ground-floor | VIL-dev-01 | positive | pass | — | ✅ | [png](../reports/mock/villa-ground-floor__VIL-dev-01_v2.png) |
| villa-ground-floor | VIL-dev-02 | boundary | fail | DOOR-02 | ✅ | — |

## 系统语义

| 检查 | 结果 | 详情 |
|---|---|---|
| 版本冲突被拒 | ✅ | E_VERSION_CONFLICT |
| 同 op_id 幂等 | ✅ | 2 |
| diff 能指出新增对象 | ✅ | ['o1'] |
