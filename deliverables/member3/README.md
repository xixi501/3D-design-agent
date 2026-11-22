# ActiScape（演境）· 成员三任务交付汇总说明

> **归属账号与区域**：华为云共享账号 **`GT-zhhqing`** · **西南-贵阳一（`cn-southwest-2`）**  
> **交付状态**：任务一（居住安全国标与鸿蒙智家 RAG 知识库）与任务二（独立安全辅材与鸿蒙智家采购报价子智能体）均已在华为云 AgentArts 正式上线并通过实测校验。  
> **安全合规声明**：本目录下全部文件已完成脱敏自检，**不含任何明文密钥、访问凭据或鉴权令牌**（真实密钥仅通过环境变量注入运行环境）。

---

## 一、 华为云 AgentArts 线上资源 ID 与环境变量映射总表

| 模块 | 华为云资源名称 | 真实云端资源 ID / 地址 | 对应主系统环境变量 | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| **任务一：RAG 规范知识库** | `actiscape-safety-standards` | `5498b33119c8456f9bbe20404191cf2a` | `AGENTARTS_KB_ID` | 已开启（`41` 切片，`pangu_embedding` + `pangu_rerank`） |
| **任务一：知识库检索入口** | 平台内部绑定 / 控制台检索 | `console-internal` | `AGENTARTS_KB_RETRIEVE_URL` | 5/5 命中测试得分 `0.90 ~ 0.99` |
| **任务二：采购报价单智能体** | `actiscape-procurement-advisor` | `577d5ae6-74a6-4947-965a-830cfee94f10` | — | 已发布（版本 `v20261122151454`，模型 `DeepSeek-V4.1-Flash-1017`） |
| **任务二：子智能体托管实例** | `agent-arts-9d7f9d5f1c0c493f821b962952bf69c0` | `ef8a0ec5-5a7d-4b46-9840-0ed2e5611e43` | — | 运行正常（`API Key 认证`） |
| **任务二：HTTPS 调用端点** | `defaultgw` 网关入口 | `https://defaultgw-gu2wkyrzha.cn-southwest-2.huaweicloud-agentarts.com/runtimes/agent-arts-9d7f9d5f1c0c493f821b962952bf69c0/invocations` | `PROCUREMENT_AGENT_URL` | 已上线就绪 |
| **任务二：入站鉴权凭据** | Agent Identity API Key | `<REDACTED>`（通过环境变量注入） | `PROCUREMENT_AGENT_API_KEY` | 已签发 |

---

## 二、 交付目录结构清单

```text
deliverables/member3/
├── README.md                          # 本交付说明与云端资源 ID 汇总表
├── task1-kb-corpus/                   # 任务一：居住安全国标与鸿蒙智家 RAG 知识库语料
│   ├── 01_gb50763_accessibility.md    # 《无障碍设计规范》GB 50763-2012 与居家适老化切片（12 条，KB-ACC-001~012）
│   ├── 02_gb50096_residential.md      # 《住宅设计规范》GB 50096-2011 空间间距与防干涉切片（10 条，KB-RES-001~010）
│   ├── 03_seismic_nonstructural.md    # 《建筑抗震设计规范》GB 50011 第13章非结构防倾覆切片（10 条，KB-SEI-001~010）
│   ├── 04_harmony_smart_sensors.md    # 华为鸿蒙智家毫米波康养/超感传感器与 PLC 照明切片（10 条，KB-HMS-001~010）
│   └── kb_manifest.json               # 华为云知识库真实 ID 与 5 组典型检索命中测试记录
└── task2-procurement-agent/           # 任务二：独立「安全辅材与鸿蒙智家采购报价子 Agent」
    ├── SYSTEM_PROMPT.md               # 子智能体完整系统提示词（锁定纯 JSON 输出与预算智能降级策略）
    ├── reference_catalog_prices.json  # 9 大类 30 项适老五金、抗震墙锚与华为鸿蒙智家真实市场参考价目表
    ├── input_output_examples.json     # 华为云控制台实测通过的 3 组输入/输出 JSON 报价样例
    └── agent_endpoint_info.json       # 华为云 AgentArts 独立子智能体部署元数据（不含任何明文密钥）
```

---

## 三、 核心验收指标核查摘要

1. **国标与鸿蒙传感器语料覆盖度**：本地 4 个 Markdown 文件共 **42 个标准知识块**（云端入库切分为 41 个高密检索块），100% 关联主系统安全引擎错误码（`WHEELCHAIR_TURNING_BLOCKED`、`DOORWAY_BLOCKED`、`DOOR_CABINET_CONFLICT`、`OPENABLE_FRONT_BLOCKED`、`SEISMIC_TOPPLE_BED_HAZARD`、`SEISMIC_TOPPLE_EXIT_BLOCKED`、`SEISMIC_UNANCHORED_CABINET`、`SURFACE_ITEM_OVERHANG`、`SENSOR_BLIND_SPOT`），5 组典型检索测试 Top-1 相似度达 **`0.90 ~ 0.99`**。
2. **采购报价算术与预算控制精度**：价目表包含 **30 项**真实京东自营 / 华为商城 VMALL 日常公开售价商品，完整覆盖全部 9 个标准枚举品类；子智能体在充足预算（3000元 -> 1593元）、紧凑预算自动优选高性价比款（1350元 -> 1306元）、全屋鸿蒙照明与无障碍多品类组合（2500元 -> 1312元）3 组实测中均返回合法 `actiscape.procurement.v1` 纯 JSON，行小计与总价算术 **100% 精确无误**。
