# Skill 池索引（自动生成，勿手改）

> 由 `tools/make_index.py` 从各包 `manifest.json` + `reports/lint.json` + `reports/dry_run.json` 生成。
> 重新生成：先跑 `python tools/skill_lint.py`、`python tools/dry_run.py --all`，再跑 `python tools/make_index.py`。

共 **30** 个技能；判据 299 处引用；L1 通过 30/30；L2 全绿 30/30。

## 读数说明

| 列 | 含义 |
|---|---|
| L1 | 结构检查（`skill_lint.py`）：字段、判据/工具引用、禁用词、案例齐备 |
| L2 | 几何 dry-run（`dry_run.py`）：正向案例通过 + 边界案例按预期被拦 |
| 状态 | `pending_adaptation`（依赖工具未落地）/ `pending_validation`（跑过案例待复跑）/ `released` |

## 起居

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`living-dining-small`](living-dining-small/SKILL.md) | 8–25㎡ 客餐厅：一个主墙 + 一条贯穿通道，按面积取舍沙发/茶几/餐桌，保证 700 通行与门窗净空。 | 13 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`living-dining-open`](living-dining-open/SKILL.md) | 30–60㎡ LDK 一体厅：三段分区（会客/用餐/西厨或工作角）+ 一条环线，用地毯与灯位划区，分区只做半岛、不做到墙。 | 17 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`social-reading-zone`](social-reading-zone/SKILL.md) | 把客厅家具声明成会客组/阅读组，只对目标组下发编辑，新增或重排“单人椅 + 落地灯 + 边几（可加书架）”的阅读角，并守住组内通道与窗带。 | 14 | 2 | ✅ | ✅ | `pending_adaptation` |

## 卧室

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`master-bedroom`](master-bedroom/SKILL.md) | 10–20㎡ 主卧：先定床头墙与床侧通道，再按“柜前净空优先”定衣柜，最后在衣柜/梳妆/电视之间做明确取舍，并处理窗帘与窗下净空。 | 12 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`kids-room`](kids-room/SKILL.md) | 6–15㎡ 儿童房：把家具分成睡眠/学习/活动三组保证可替换，守住书桌使用区、窗前高柜、门扇与高柜安全三件。 | 11 | 2 | ✅ | ✅ | `pending_adaptation` |

## 工作

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`home-office`](home-office/SKILL.md) | 5–15㎡ 书房或居家办公位：书桌对窗但离窗墙留出窗帘与暖气，屏幕侧光不背光，椅后留出起身净空，视频背景干净，收纳分三处。 | 11 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`office-workstation`](office-workstation/SKILL.md) | 30–60㎡ 工作室：分四块后按 1200×600/1400×700 排工位，留 900 主通道，玻璃隔断围会议区，贴边放打印机，只给插座网口位置建议。 | 13 | 2 | ✅ | ✅ | `pending_adaptation` |

## 厨房

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`kitchen-line-l-u`](kitchen-line-l-u/SKILL.md) | 3–10㎡ 独立厨房：先按开间选形（单排/L/U/双排），再压操作三角与备餐顺序，吊柜避窗、冰箱留开门侧，通道按判据复核。 | 8 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`dining-island`](dining-island/SKILL.md) | 4–30㎡ 餐厨一体：先定中岛角色（操作/早餐/兼餐桌），再定岛台对橱柜的通道、桌岛是并台还是分置，最后排吧椅与吊灯。 | 7 | 2 | ✅ | ✅ | `pending_adaptation` |

## 卫浴

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`bathroom-standard`](bathroom-standard/SKILL.md) | 1.2–6㎡ 单卫：先按排水立管定马桶与淋浴位，再控马桶前后左右、淋浴区尺寸、浴室柜前净空，最后决定门内开/外开与挡水防滑。 | 9 | 2 | ✅ | ✅ | `pending_adaptation` |

## 收纳

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`entry-storage`](entry-storage/SKILL.md) | 1.5–6㎡ 玄关：按「开门→落尘→换鞋→挂衣→镜」排动线，按人数估鞋柜容量，控换鞋凳前净空与门扇开启区，并给出地方不够时的保住顺序。 | 6 | 2 | ✅ | ✅ | `pending_adaptation` |

## 家政

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`balcony-laundry`](balcony-laundry/SKILL.md) | 1.2–6㎡ 生活阳台：先定排水再定机器，决定叠放或并排，留洗衣机前操作面、定晾衣杆高度与长度、处理地漏，并与通客厅的推拉门/窗帘避让。 | 6 | 2 | ✅ | ✅ | `pending_adaptation` |

## 户型

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`studio-micro`](studio-micro/SKILL.md) | 20–40㎡ 开间：按「睡眠 > 收纳 > 会客 > 用餐/工作」排优先级，用书架/帘/地台做软隔断，留 700 连续通道，床不堵门与主区。 | 8 | 2 | ✅ | ✅ | `pending_adaptation` |

## 人群

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`aging-friendly`](aging-friendly/SKILL.md) | 长者卧室与卫浴：净宽取更严格的 800、无高差、扶手与助力、床边与马桶旁转移空间、夜间起夜照明、圆角固定家具与 450 坐高。 | 8 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`pet-friendly`](pet-friendly/SKILL.md) | 养猫养狗的起居空间：先划宠物活动区与清洁点，猫爬架靠窗但不进窗帘带，猫砂盆/狗窝避开餐厨与主动线，耐抓耐污材料 + 门挡 + 线槽。 | 6 | 2 | ✅ | ✅ | `pending_adaptation` |

## 房源

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`rental-makeover`](rental-makeover/SKILL.md) | 3.2×4.6m 出租单间：不拆改、可逆、可复原；0/500/2000 元三档预算，先摆位再换软装，灯光分层 + 60/30/10 配色 + 一个视觉焦点，退租能全部搬走。 | 9 | 2 | ✅ | ✅ | `pending_adaptation` |

## 别墅

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`villa-ground-floor`](villa-ground-floor/SKILL.md) | 8.0×12.0m 首层：公共动线与服务动线分开，楼梯/电梯靠边不占采光面，家政设备间贴服务核，玄关柜按人数算量，客厅与餐厨共享庭院视线。 | 9 | 2 | ✅ | ✅ | `pending_adaptation` |

## 横向

| 技能 | 一句话 | 判据 | 案例 | L1 | L2 | 状态 |
|---|---|---|---|---|---|---|
| [`photo-object-import`](photo-object-import/SKILL.md) | 单件照片 → 异步资产作业 → 外观与尺寸确认 → 落到点选或语言指定的支撑面 → 检查与留证。 | 6 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`style-coherence`](style-coherence/SKILL.md) | 把口头风格翻成硬装—软装—材质—五金四件套，用 60-30-10、主材 ≤3、焦点 ≤1 把整屋拉齐；硬装不可改时只换软装。 | 12 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`lighting-color`](lighting-color/SKILL.md) | 按环境/任务/重点三层定比例，按房间给照度与色温，再把灯位落到家具上（餐桌吊灯对中、阅读角落地灯、镜前灯垂直照面），配色落到可采购的材质。 | 12 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`layout-check-repair`](layout-check-repair/SKILL.md) | 对已有布置跑 check.run，按严重度与影响对象数排序，一次只修一类，每轮重跑，3 轮预算用完即停，修不动的写进未解决清单并如实报告。 | 9 | 2 | ✅ | ✅ | `pending_adaptation` |
| [`floorplan-intake`](floorplan-intake/SKILL.md) | 把户型图或文字需求整理成要素表、假设表与待确认清单；先判断「放不放得下」，再交给具体房间技能。 | 4 | 2 | ✅ | ✅ | `pending_adaptation` |

## 未分组

| 技能 | 一句话 | L1 | L2 | 状态 |
|---|---|---|---|---|
| [`gaming-room`](gaming-room/SKILL.md) | 6–15㎡ 电竞房：桌面 700 深、双屏视距 60–80cm、屏幕与窗成 90° 侧光，椅子后推 900，主机进风与走线，暗环境三层照明，共用墙隔音。 | ✅ | ✅ | `pending_adaptation` |
| [`guest-bedroom`](guest-bedroom/SKILL.md) | 6–14㎡ 次卧：先分临时住/长期住，再取舍床靠墙与床居中，排衣柜与（折叠）书桌，守住门扇、窗帘与 700 通行。 | ✅ | ✅ | `pending_adaptation` |
| [`home-gym`](home-gym/SKILL.md) | 4–15㎡ 健身角：器械靠墙、镜面正对空地、瑜伽垫可收，保器械后 1m/侧 0.5m 安全距、器械不挡门、连续 700 通道，并核层高通风与减震吸音。 | ✅ | ✅ | `pending_adaptation` |
| [`media-room`](media-room/SKILL.md) | 10–25㎡ 影音室：按屏幕对角线 × 1.2–1.6 定观看距离，排沙发侧向通道、音箱位、遮光与设备柜散热。 | ✅ | ✅ | `pending_adaptation` |
| [`nursery`](nursery/SKILL.md) | 6–12㎡ 婴儿房：婴儿床两侧各 600 双通道、床不压窗与风口、尿布台 750 高不靠窗可单手操作、哺乳椅配暖光夜灯、玩具收纳低位并把电线与小件管住。 | ✅ | ✅ | `pending_adaptation` |
| [`tatami-multipurpose`](tatami-multipurpose/SKILL.md) | 5–12㎡ 榻榻米房：先定地台占多少与上翻/侧抽，再让开门扇与窗帘、留出台阶与 700 通道。 | ✅ | ✅ | `pending_adaptation` |
| [`tea-room`](tea-room/SKILL.md) | 4–10㎡ 茶室：远离主动线、坐席不对门不背窗，用一桌两椅一柜的最小配置守住 700 通行与茶台间距。 | ✅ | ✅ | `pending_adaptation` |
| [`utility-storage`](utility-storage/SKILL.md) | 2–6㎡ 家政间：洗烘/清洁工具/囤货三区分行，400 浅柜或 600 标准柜按净宽选，洗烘前 700、长柜一端留 600 绕行，洞洞板挂实墙，门后只挂薄具，扫地机基站留 500 进出与同侧电源。 | ✅ | ✅ | `pending_adaptation` |

## 怎么加载

1. 读 `manifest.json`：用 `applies_when` 做选择（场景类型、面积区间、输入前置），`not_applicable` 做排除；
2. 读 `SKILL.md` 正文执行；判据去 `_framework/JUDGEMENTS.md` 查；工具名去 `_framework/TOOLS.md` 查；
3. 固定版本：任务开始时记录 `id + version`，更新不覆盖进行中的版本；
4. 依赖工具未落地（`status=pending_adaptation`）时，按 SKILL.md 的降级路径执行，并在交付里标注。

## 待办

- L3 真工具验证：等成员1 的 `scene.*` / `check.run` 与成员2 的 `assets.*`；
- 判据复核：`J-STA-*` 引自规范下限，需按现行版本与地方标准复核；
- 案例扩充：同族场景（同一户型家族）不得跨开发/验证/最终测试集，扩案例时注意隔离。
