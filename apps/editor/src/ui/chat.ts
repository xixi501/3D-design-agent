import { api, post } from "../api.js";
import { FloorplanPanel } from "./floorplan.js";

function safeUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type Context = {
  projectId?: string;
  selectedIds: string[];
  selectionLabel?: string;
  blank?: boolean;
};

const active = new Set(["queued", "running", "waiting_input", "committing"]);

const phases: Record<string, string> = {
  reading: "读取场景",
  understanding: "理解需求",
  choosing_assets: "选择家具",
  scoping: "确定修改范围",
  designing: "生成候选",
  prechecking: "检查参数与几何",
  rendering: "生成检查视图",
  checking: "核对需求与截图",
  checking_parameters: "核对精确要求与几何",
  repairing: "修复候选",
  committing: "确认提交",
};

const statusLabels: Record<string, string> = {
  queued: "等待执行",
  running: "处理中",
  waiting_input: "需要补充说明",
  committing: "确认提交中",
  completed: "已保存",
  failed: "未完成",
  conflict: "版本冲突，已暂停",
  cancelled: "已取消",
};

const fieldLabels: Record<string, string> = {
  x: "X",
  y: "Y",
  z: "离地",
  rot: "旋转",
  w: "宽",
  d: "深",
  h: "高",
  color: "颜色",
};

const ROOM_PURPOSE_LABELS: Record<string, string> = {
  living_dining: "客餐厅",
  reading_lounge: "阅读会客间",
  master_bedroom: "主卧室",
  guest_bedroom: "次卧室",
  study: "独立书房",
  kitchen: "厨房",
  bathroom: "卫生间",
  entry: "玄关门厅",
  circulation: "走廊过道",
  dining_hall: "欧式/宴会餐厅",
  tea_room: "新中式茶室",
  media_room: "沉浸影音厅",
  kids_room: "儿童成长房",
  multipurpose: "榻榻米多功能房",
};

const STYLE_OPTIONS = [
  { id: "european", label: "🏛️ 欧式古典", hint: "欧式古典" },
  { id: "chinese", label: "🎋 新中式", hint: "新中式" },
  { id: "modern", label: "✨ 现代极简", hint: "现代极简" },
  { id: "japanese", label: "🌿 日式原木", hint: "日式原木" },
  { id: "cream", label: "🧁 法式奶油", hint: "法式奶油" },
  { id: "aging_care", label: "🛡️ 适老康养", hint: "适老康养" },
];

const MODIFIER_SKILL_IDS = new Set([
  "style-coherence",
  "lighting-color",
  "storage-ergonomics",
  "circulation-ergonomics",
  "openable-clearance",
  "furniture-clearance-repair",
  "layout-preserve-edit",
  "asset-photo-import",
]);

const CHAT_UX_CSS = `
.chat-freeplay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 9px;
  background: #f4efe6;
  border: 1px solid #e2d9c8;
  font-size: 12px;
  color: #3d372e;
}
.chat-freeplay-row[hidden] { display: none !important; }
.chat-freeplay-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 600;
}
.chat-freeplay-row small {
  color: #776f63;
  font-size: 11px;
}
.chat-floorplan-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.chat-floorplan-group[hidden] { display: none !important; }
.chat-fp-primary {
  background: linear-gradient(135deg, #1e2724 0%, #2f433c 100%) !important;
  color: #ffffff !important;
  border: 1px solid #1e2724 !important;
  font-weight: 600;
}
.chat-fp-secondary {
  font-size: 11.5px !important;
  padding: 4px 8px !important;
  opacity: 0.85;
}
.chat-style-apply {
  width: 100%;
  margin-top: 4px;
  background: #fff8f1 !important;
  border: 1px solid #d98254 !important;
  color: #9c4421 !important;
  font-size: 12px !important;
  font-weight: 600;
}
.chat-style-apply[hidden] { display: none !important; }
.skill-dispatch-card {
  margin: 8px 0;
  padding: 9px 11px;
  border-radius: 10px;
  background: #f6f3ec;
  border: 1px solid #dfd7c7;
  font-size: 11.5px;
  line-height: 1.45;
}
.skill-dispatch-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: #2b3531;
  margin-bottom: 6px;
}
.skill-dispatch-head span {
  font-size: 10.5px;
  font-weight: 600;
  color: #8c5332;
  background: #efe5d6;
  padding: 1px 7px;
  border-radius: 999px;
}
.skill-stage-track {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.skill-stage-pill {
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 5px;
  background: #ffffff;
  border: 1px solid #dcd3c3;
  color: #4a453d;
}
.skill-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.skill-chip {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 600;
}
.skill-chip.base { background: #e2e8f0; color: #334155; }
.skill-chip.primary { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.skill-chip.modifier { background: #e0f2fe; color: #075985; }
`;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function buildSkillDispatchCard(skillsUsed: any[], repairs = 0): HTMLElement {
  const card = node("div", undefined, "skill-dispatch-card");
  const head = node("div", undefined, "skill-dispatch-head");
  head.append(
    node("strong", "🧠 Skill 池五阶段动态注入"),
    node("span", `${skillsUsed.length} 项激活技能`),
  );
  const track = node("div", undefined, "skill-stage-track");
  const stages = [
    "① Intake 理解",
    "② Asset 选型",
    "③ Layout 排布",
    "④ Check 门禁",
    repairs > 0 ? `⑤ Repair 自愈(${repairs})` : "⑤ Commit 落库",
  ];
  for (const st of stages) {
    track.append(node("span", st, "skill-stage-pill"));
  }
  const chips = node("div", undefined, "skill-chip-row");
  for (const s of skillsUsed) {
    const id = String(s.id || s);
    const cls =
      id === "universal-spatial-base"
        ? "skill-chip base"
        : MODIFIER_SKILL_IDS.has(id)
          ? "skill-chip modifier"
          : "skill-chip primary";
    const roleTag =
      id === "universal-spatial-base"
        ? "底座"
        : MODIFIER_SKILL_IDS.has(id)
          ? "修饰"
          : "主技能";
    chips.append(node("span", `${roleTag} · ${id}`, cls));
  }
  card.append(head, track, chips);
  return card;
}

export class ChatPanel {
  private root = node("section", undefined, "chat-panel");
  private context = node("p", undefined, "chat-context muted");
  private messages = node("div", undefined, "chat-messages");
  private input = node("textarea");
  private send = node("button", "发送", "primary");
  private cancel = node("button", "取消任务");
  private notice = node("p", undefined, "chat-notice muted");
  private connection = node("p", undefined, "chat-connection muted");
  private brief = node("details", undefined, "chat-brief");
  private briefTask?: string;
  private floorplanGroup = node("div", undefined, "chat-floorplan-group");
  private floorplanUpload = node(
    "button",
    "📐 上传户型图 · AI 全屋高精度直出 3D",
    "chat-fp-primary",
  );
  private floorplanDraftUpload = node(
    "button",
    "📝 上传户型图（分步草稿核对模式）",
    "chat-fp-secondary",
  );
  private floorplanFile = node("input");
  private floorplanHybridMode = true;
  private photoUpload = node("button", "上传物品照片转 3D");
  private quick = node("div", undefined, "chat-quick");
  private stylePicker = node("div", undefined, "chat-styles");
  private styleApplyBtn = node("button", "", "chat-style-apply");
  private freePlayRow = node("div", undefined, "chat-freeplay-row");
  private freePlayCheckbox = node("input");
  private freePlay = true;
  private styleHint = "";
  private selectedStyleId = "";
  onPhotoImport?: () => void;
  private projectId?: string;
  private conversationId?: string;
  private tasks: any[] = [];
  private events?: EventSource;
  private watched?: string;
  private sequence = 0;
  private sending = false;
  private lastRefresh?: string;

  constructor(
    private getContext: () => Context,
    private onCommit: (projectId: string, generated?: boolean) => Promise<void>,
    private onActivity?: (state: {
      active: boolean;
      waiting?: boolean;
      label: string;
    }) => void,
  ) {
    if (!document.querySelector("#chat-rich-ux-style")) {
      const st = document.createElement("style");
      st.id = "chat-rich-ux-style";
      st.textContent = CHAT_UX_CSS;
      document.head.appendChild(st);
    }

    this.floorplanUpload.type = "button";
    this.floorplanDraftUpload.type = "button";
    this.floorplanFile.type = "file";
    this.floorplanFile.accept = "image/png,image/jpeg,.png,.jpg,.jpeg";
    this.floorplanFile.hidden = true;
    this.floorplanUpload.onclick = () => {
      this.floorplanHybridMode = true;
      this.floorplanFile.click();
    };
    this.floorplanDraftUpload.onclick = () => {
      this.floorplanHybridMode = false;
      this.floorplanFile.click();
    };
    this.floorplanGroup.append(this.floorplanUpload, this.floorplanDraftUpload);

    this.photoUpload.type = "button";
    this.photoUpload.dataset.testid = "chat-photo-import";
    this.photoUpload.onclick = () => this.onPhotoImport?.();
    this.floorplanFile.onchange = () => {
      const file = this.floorplanFile.files?.[0];
      if (file) void this.uploadFloorplan(file, this.floorplanHybridMode);
      this.floorplanFile.value = "";
    };

    this.freePlayCheckbox.type = "checkbox";
    this.freePlayCheckbox.checked = true;
    this.freePlayCheckbox.onchange = () => {
      this.freePlay = this.freePlayCheckbox.checked;
      this.renderMode();
    };
    const fpLabel = node("label");
    fpLabel.append(this.freePlayCheckbox, node("span", "🪄 自由发挥补全细节"));
    this.freePlayRow.append(fpLabel, node("small", "免追问直出单间/套间/全屋"));

    this.input.placeholder =
      "例如：把这把椅子向左移动 200 毫米，再在旁边加一盏落地灯";
    this.input.setAttribute("aria-label", "对话需求");
    this.input.maxLength = 4000;
    this.input.rows = 4;
    this.brief.open = true;

    this.styleApplyBtn.type = "button";
    this.styleApplyBtn.hidden = true;
    this.styleApplyBtn.onclick = () => void this.applySelectedStylePack();

    for (const opt of STYLE_OPTIONS) {
      const button = node("button", opt.label, "chat-style");
      button.type = "button";
      button.dataset.styleId = opt.id;
      button.onclick = () => {
        if (this.selectedStyleId === opt.id) {
          this.selectedStyleId = "";
          this.styleHint = "";
        } else {
          this.selectedStyleId = opt.id;
          this.styleHint = opt.hint;
        }
        this.stylePicker
          .querySelectorAll<HTMLButtonElement>(".chat-style")
          .forEach((b) =>
            b.classList.toggle("active", b.dataset.styleId === this.selectedStyleId),
          );
        this.renderMode();
      };
      this.stylePicker.append(button);
    }

    const form = node("form"),
      actions = node("div", undefined, "chat-actions");
    actions.append(this.send, this.cancel);
    this.send.type = "submit";
    this.cancel.type = "button";
    form.append(this.freePlayRow, this.input, actions);

    this.quick.append(
      this.suggestion("试试：生成一个有几张桌子的餐厅，风格为欧式，剩余你自由发挥"),
      this.suggestion("试试：生成一套新中式两室两厅一厨一卫全屋方案，自由发挥"),
      this.suggestion("试试：生成一个适老康养主卧带衣帽间和无障碍独卫套间"),
      this.suggestion("试试：把餐桌往右移 300 毫米"),
    );

    this.root.append(
      this.context,
      this.connection,
      this.quick,
      this.stylePicker,
      this.styleApplyBtn,
      this.floorplanGroup,
      this.floorplanFile,
      this.photoUpload,
      this.brief,
      this.messages,
      this.notice,
      form,
      node(
        "p",
        "支持宽泛描述自由发挥、多房套间生成、六大风格换装与户型图高精度 3D 重建。可用上方撤销按钮随时恢复。",
        "muted chat-help",
      ),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      void this.submit();
    };
    this.cancel.onclick = () => void this.cancelTask();
    this.input.onkeydown = (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.submit();
      }
    };
  }

  private suggestion(text: string) {
    const button = node("button", text, "chat-suggestion");
    button.type = "button";
    button.onclick = () => {
      this.input.value = text.replace(/^试试：/, "");
      this.input.focus();
    };
    return button;
  }

  private async applySelectedStylePack() {
    if (!this.projectId || !this.selectedStyleId || this.sending) return;
    this.sending = true;
    this.notice.textContent = `正在应用「${this.styleHint}」主题材质与3D家具造型…`;
    this.render();
    try {
      await post(`/projects/${this.projectId}/apply-style-pack`, {
        styleId: this.selectedStyleId,
      });
      await this.onCommit(this.projectId, false);
      this.notice.textContent = `已将当前空间切换为「${this.styleHint}」风格主题。`;
    } catch (error) {
      this.notice.textContent = (error as Error).message;
    } finally {
      this.sending = false;
      this.render();
    }
  }

  focus() {
    this.input.focus();
    this.input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  openFloorplan() {
    this.floorplanHybridMode = true;
    this.floorplanFile.click();
  }

  mount(host: HTMLElement, projectId: string) {
    if (this.root.parentElement !== host) host.replaceChildren(this.root);
    const context = this.getContext();
    this.context.textContent = context.selectionLabel
      ? `当前选择：${context.selectionLabel}`
      : "可先选中家具，再说“这把椅子”或“它”。";
    if (this.projectId !== projectId) {
      this.events?.close();
      this.events = undefined;
      this.watched = undefined;
      this.projectId = projectId;
      this.conversationId = undefined;
      this.tasks = [];
      this.input.value = "";
      this.briefTask = undefined;
      this.sequence++;
      void this.load();
    }
    this.renderMode();
  }

  private mode(): "edit" | "generate_rectangular" | "reconstruct_floorplan" {
    return (
      this.current()?.mode ||
      (this.getContext().blank ? "generate_rectangular" : "edit")
    );
  }

  private renderMode() {
    const isBlank = !!this.getContext().blank;
    const hasActive = !!this.current();
    this.floorplanGroup.hidden = !isBlank || hasActive;
    this.floorplanUpload.disabled = this.sending || !isBlank || hasActive;
    this.floorplanDraftUpload.disabled = this.sending || !isBlank || hasActive;
    this.floorplanUpload.title = isBlank
      ? "VLM + OpenCV 联合识别房间、门窗、家具并三级自动标尺，一步生成可编辑 3D 全屋"
      : "请先新建空白项目";

    if (this.mode() === "reconstruct_floorplan") {
      this.freePlayRow.hidden = true;
      this.styleApplyBtn.hidden = true;
      this.context.textContent = "户型图三维重建 · VLM 语义理解 + OpenCV 墙轴对齐";
      this.input.placeholder = "可补充风格偏好（如：新中式 / 日式原木）或标定说明。";
      this.brief.hidden = true;
      return;
    }

    this.stylePicker.hidden = false;
    const generating = this.mode() === "generate_rectangular";
    this.freePlayRow.hidden = !generating;
    this.styleApplyBtn.hidden = isBlank || !this.selectedStyleId;
    if (!this.styleApplyBtn.hidden) {
      this.styleApplyBtn.disabled = this.sending;
      this.styleApplyBtn.textContent = `🎨 一键将当前空间换装为「${this.styleHint}」`;
    }

    const context = this.getContext();
    this.context.textContent = generating
      ? this.freePlay
        ? "生成空间 · 支持一句话自由发挥、连通套间与全屋多房生成"
        : "精确生成 · 未指定的净宽、净深与门窗信息将逐项向你确认"
      : context.selectionLabel
        ? `当前选择：${context.selectionLabel}`
        : "可先选中家具，或点选上方风格标签一键换装当前空间。";

    if (this.styleHint && generating) {
      this.input.placeholder = `描述空间想法，AI 将按「${this.styleHint}」自动搭配材质与成套家具`;
    } else {
      this.input.placeholder = generating
        ? this.freePlay
          ? "例如：生成一个有几张桌子的欧式餐厅，剩余自由发挥；或生成一套两室两厅全屋方案"
          : "例如：设计一个客餐厅，室内净宽6米、净深4米，南墙入口距左侧400毫米，北墙窗居中。"
        : "例如：把这把椅子向左移动 200 毫米，再在旁边加一盏落地灯";
    }

    const task =
      this.current()?.mode === "generate_rectangular"
        ? this.current()
        : this.tasks
            .slice()
            .reverse()
            .find((t) => t.mode === "generate_rectangular");
    const g = task?.generation || task?.result?.generation;
    this.brief.hidden = !generating && !g?.brief;
    this.brief.replaceChildren(
      node(
        "summary",
        task?.status === "completed" ? "生成时的空间与技能摘要" : "空间需求与技能调度",
      ),
    );
    if (!g?.brief) {
      this.brief.append(
        node(
          "p",
          this.freePlay
            ? "已开启「自由发挥」：只需说出房间类型、风格或大致家具想法，未指定的建筑尺寸、门窗与软装由建筑先验自动补全。"
            : "精确模式需要：横向净宽、纵向净深、用途、入口和窗的位置。",
          "muted",
        ),
      );
      return;
    }
    if (this.briefTask !== task.id) {
      this.briefTask = task.id;
      this.brief.open = task.status !== "completed";
    }
    const dimension = (v: any) => (v ? `${v.value} ${v.unit}` : "待补充");
    const b = g.brief,
      sides: Record<string, string> = {
        north: "北／上墙",
        east: "东／右墙",
        south: "南／下墙",
        west: "西／左墙",
      };
    const purposeKey = b.roomType || b.purpose || "";
    const purposeLabel =
      b.roomName || ROOM_PURPOSE_LABELS[purposeKey] || purposeKey || "待补充";
    this.brief.append(
      node("p", `空间类型：${purposeLabel}`),
      node("p", `室内净宽 ${dimension(b.width)} × 净深 ${dimension(b.depth)}`),
    );
    for (const [kind, label] of [
      ["doors", "入口"],
      ["windows", "窗"],
    ]) {
      const openings = b[kind];
      if (!openings) this.brief.append(node("p", `${label}：待补充`));
      else if (!openings.length) this.brief.append(node("p", `${label}：无`));
      else
        for (const [i, o] of openings.entries())
          this.brief.append(
            node(
              "p",
              `${label}${i + 1}：${sides[o.side] || "墙面待补充"}，${o.position === "center" ? "居中" : o.position === "offset" ? `距左／上侧 ${dimension(o.offset)}` : "位置待补充"}`,
            ),
          );
    }
    if (g.furniture?.length)
      this.brief.append(
        node(
          "p",
          `资产配置：${g.furniture.map((f: any) => `${f.query} × ${f.count}`).join("，")}`,
        ),
      );
    if (g.style) this.brief.append(node("p", `风格主题：${g.style}`));
    if (g.missing?.length)
      this.brief.append(
        node("p", `待确认：${g.missing.join("；")}`, "chat-missing"),
      );
    const used = g.skillsUsed || task.result?.skillsUsed;
    if (used?.length) {
      this.brief.append(buildSkillDispatchCard(used, task.result?.repairs || 0));
    }
    if (g.defaults?.length) {
      const details = node("details");
      details.append(
        node("summary", "AI 自动补全的建筑与软装先验"),
        node("p", g.defaults.join("；")),
      );
      this.brief.append(details);
    }
  }

  private async load() {
    const project = this.projectId,
      seq = this.sequence;
    if (!project) return;
    this.connection.textContent = "连接设计助手…";
    try {
      const health = await api<any>("/agent/health");
      const conversations = await api<any[]>(
        `/agent/conversations?projectId=${encodeURIComponent(project)}`,
      );
      const saved = localStorage.getItem(`actiscape-conversation:${project}`);
      const conversation =
        conversations.find((c) => c.id === saved) ||
        conversations[0] ||
        (await post<any>("/agent/conversations", { projectId: project }));
      if (project !== this.projectId || seq !== this.sequence) return;
      this.conversationId = conversation.id;
      localStorage.setItem(
        `actiscape-conversation:${project}`,
        conversation.id,
      );
      this.tasks = await api<any[]>(
        `/agent/conversations/${conversation.id}/tasks`,
      );
      if (project !== this.projectId || seq !== this.sequence) return;
      this.connection.textContent = health.modelConfigured
        ? "设计助手已连接"
        : "模型尚未配置，暂不能执行对话修改";
      this.render();
      this.watchActive();
    } catch (error) {
      if (seq === this.sequence) {
        this.connection.textContent = (error as Error).message;
        this.notice.textContent = "连接恢复后再次发送即可重试。";
        this.render();
      }
    }
  }

  private current() {
    return this.tasks
      .slice()
      .reverse()
      .find((t) => active.has(t.status));
  }

  private render() {
    this.renderMode();
    const currentTask = this.current();
    this.onActivity?.({
      active: !!currentTask,
      waiting: currentTask?.status === "waiting_input",
      label: currentTask
        ? currentTask.status === "waiting_input"
          ? currentTask.mode === "reconstruct_floorplan"
            ? "等待你核对户型草稿"
            : "需要补充说明"
          : currentTask.phaseLabel || "AI 正在处理你的空间…"
        : "在线 · 等你的下一个想法",
    });
    const nearBottom =
      this.messages.scrollHeight -
        this.messages.scrollTop -
        this.messages.clientHeight <
      80;
    this.messages.replaceChildren();
    if (!this.tasks.length)
      this.messages.append(
        node(
          "p",
          this.mode() === "generate_rectangular"
            ? "描述你的房间、套间或全屋想法（支持欧式/新中式/现代/日式/奶油/适老），AI 会自动匹配 Skill 并直出 3D 空间。"
            : "告诉我想调整哪些家具，支持增删、摆放、尺寸和颜色修改。",
          "muted",
        ),
      );
    const visibleTasks = this.tasks.slice(-4);
    if (this.tasks.length > visibleTasks.length)
      this.messages.append(
        node(
          "p",
          `更早的 ${this.tasks.length - visibleTasks.length} 条记录已收起`,
          "chat-older",
        ),
      );
    for (const task of visibleTasks) {
      const entry = node("article", undefined, "chat-task");
      entry.dataset.task = task.id;
      const cleanUserText = String(task.input || "")
        .replace(/\n*\[自主发挥\]/g, "")
        .replace(/\n*\[混合高精度重建\]/g, "")
        .trim();
      entry.append(node("div", cleanUserText || task.input, "chat-user"));
      const reply = node("div", undefined, "chat-assistant"),
        badge = node(
          "strong",
          (task.result?.noChange
            ? "无需修改"
            : task.result?.reason === "check_failed"
              ? "检查未通过，等待调整"
              : statusLabels[task.status]) || task.status,
          "chat-status",
        );
      badge.dataset.status = task.status;
      reply.append(badge);
      if (active.has(task.status) && task.status !== "waiting_input") {
        const rail = node("div", undefined, "chat-phase-rail");
        const label = task.phaseLabel || "";
        const currentIndex = /提交|保存/.test(label)
          ? 3
          : /检查|渲染|核对|修复|标尺/.test(label)
            ? 2
            : /生成|设计|选择|理解|识别|对齐/.test(label)
              ? 1
              : 0;
        for (const [index, text] of [
          "理解",
          "生成",
          "检查",
          "保存",
        ].entries()) {
          const step = node("span", text);
          if (index === currentIndex) step.className = "current";
          rail.append(step);
        }
        reply.append(rail);
      }
      reply.append(
        node(
          "p",
          (active.has(task.status) && task.status !== "waiting_input"
            ? task.phaseLabel || "正在处理已保存的任务…"
            : task.status === "completed"
              ? task.result?.message || "本次空间修改已经提交，下面是摘要。"
              : task.result?.message) ||
            task.error ||
            task.phaseLabel ||
            "任务已保存，正在处理。",
        ),
      );
      if (task.cancelRequested && active.has(task.status))
        reply.append(node("p", "已请求取消，正在等待安全边界。", "muted"));
      if (task.mode === "reconstruct_floorplan" && task.generation?.draftId) {
        const review = node(
          "button",
          task.status === "completed" ? "查看生成时的原图草稿" : "核对户型草稿",
        );
        review.dataset.testid = "review-floorplan";
        review.onclick = () => this.reviewFloorplan(task);
        reply.append(review);
      }
      if (
        task.mode === "reconstruct_floorplan" &&
        task.generation?.upstreamTools?.length
      ) {
        const details = node("details"),
          latest = new Map<string, any>();
        details.dataset.testid = "floorplan-tool-evidence";
        details.append(node("summary", "识别与测量证据"));
        const roleLabels: Record<string, string> = {
          main: "主控识别",
          design: "空间测量",
          check: "独立检查",
        };
        const toolLabels: Record<string, string> = {
          analyze_floorplan: "墙线与尺寸刻度",
          furniture_contours: "家具线稿轮廓",
          fit_wall_faces: "墙面及厚度测量",
          measure_dimension_chain: "尺寸标注核对",
          preview_floorplan: "结构预检",
          audit_floorplan_source: "原图对账",
        };
        const fileLabels: Record<string, string> = {
          "analysis.png": "墙线识别图",
          "candidates.png": "墙体、洞口与尺寸候选",
          "contours.png": "家具轮廓候选",
          "target_contours.png": "目标客餐厅轮廓放大图",
          "objects.png": "稳定家具对象候选",
          "groups.png": "主辅活动组候选",
          "mask.png": "墙体像素掩膜",
          "furn_all.png": "家具位置与朝向核对",
          "sheet_0.png": "墙体差异放大",
        };
        for (const record of task.generation.upstreamTools)
          latest.set(record.role + ":" + record.tool, record);
        for (const { role, tool, record } of latest.values()) {
          details.append(
            node(
              "p",
              `${roleLabels[role] || role} · ${toolLabels[tool] || tool}`,
            ),
          );
          if (typeof record.result?.issueCount === "number")
            details.append(
              node(
                "p",
                `原图对账发现 ${record.result.issueCount} 处待核对差异。`,
                "muted",
              ),
            );
          if (record.result?.inconsistent)
            details.append(
              node("p", "尺寸链存在比例差异，需要核对标注基准。", "muted"),
            );
          for (const file of record.files || []) {
            if (
              typeof file.path !== "string" ||
              !/^\/floorplan-images\/fp-[a-f0-9]{64}\/tools\/[a-f0-9]{64}\/files\/[a-z0-9_]+\.png$/.test(
                file.path,
              )
            )
              continue;
            const link = node("a"),
              img = node("img");
            link.href = "/api" + file.path;
            link.target = "_blank";
            link.rel = "noopener";
            img.src = link.href;
            img.alt = fileLabels[file.name] || "原图识别证据";
            img.loading = "lazy";
            link.append(img);
            details.append(link);
          }
        }
        details.append(
          node(
            "p",
            "识别与测量结果供核对，正式保存仍需结构确认和候选检查。",
            "muted",
          ),
        );
        reply.append(details);
      }
      const result = task.result;
      if (result?.status === "completed") {
        const checks = result.checks || result.report?.codeChecks;
        const remaining =
          checks && Number.isFinite(checks.remainingIssues)
            ? checks.remainingIssues
            : Array.isArray(checks?.issues)
              ? checks.issues.filter((issue: any) => issue.level === "error")
                  .length
              : undefined;
        const checkLabel =
          remaining === undefined
            ? "已保存"
            : remaining > 0
              ? `仍有 ${remaining} 项问题`
              : checks?.passed === false
                ? "检查未通过"
                : "检查通过";
        const card = node("div", undefined, "chat-result-card");
        card.append(
          node("span", "AI 设计完成", "chat-result-kicker"),
          node(
            "p",
            result.message || "本次空间修改已经提交。",
            "chat-result-copy",
          ),
          node(
            "div",
            `${result.changes?.length || 0} 项变更 · 版本 ${result.committedRevision || task.result?.committedRevision || ""} · ${checkLabel}`,
            "chat-result-meta",
          ),
        );
        reply.append(card);

        if (result.skillsUsed?.length) {
          reply.append(
            buildSkillDispatchCard(result.skillsUsed, result.repairs || 0),
          );
        }

        const basis = node("details");
        basis.append(node("summary", "AI 设计依据"));
        if (result.generation?.mode === "reconstruct_floorplan_hybrid") {
          const hm = result.generation;
          reply.append(
            node(
              "p",
              `混合高精度重建已完成：共焊接 ${hm.roomCount || 0} 个连通房间、布置 ${result.changes?.length || 0} 件 3D 家具（${hm.scaleBasis || "自动标尺"}）。`,
            ),
          );
        } else if (result.generation?.mode === "generate_multiroom") {
          const gm = result.generation;
          reply.append(
            node(
              "p",
              `已生成 ${gm.roomCount || 0} 空间连通方案（风格：${gm.styleLabel || "现代"}），共配置 ${result.changes?.length || 0} 件成套家具并完成墙体与软装对齐。`,
            ),
          );
        } else if (result.generation?.mode === "reconstruct_floorplan") {
          reply.append(
            node(
              "p",
              `整层结构与 ${result.changes?.length || 0} 件客餐厅家具已作为一个事务保存，保留确认时的原图布局。`,
            ),
          );
        }
        if (result.generation?.dimensions) {
          const d = result.generation.dimensions;
          reply.append(
            node(
              "p",
              `已生成净尺寸 ${d.width} × ${d.depth} mm 的空间，墙体、门窗、材质和家具作为一个事务保存。`,
            ),
          );
        }
        for (const skill of result.skillsUsed || []) {
          basis.append(
            node(
              "p",
              `激活技能 ${skill.id} @ ${skill.version}${skill.contentHash ? ` · ${String(skill.contentHash).slice(0, 12)}` : ""}`,
              "muted",
            ),
          );
        }
        if (basis.childElementCount > 1) reply.append(basis);

        const list = node("ul");
        for (const change of (result.changes || []).slice(0, 24)) {
          const label =
            change.action === "added"
              ? "新增"
              : change.action === "deleted"
                ? "删除"
                : "修改";
          const fields =
            change.action === "updated"
              ? (change.fields || [])
                  .map(
                    (f: any) =>
                      `${fieldLabels[f.field] || f.field} ${f.before ?? 0} → ${f.after ?? 0}`,
                  )
                  .join("，")
              : "";
          list.append(
            node("li", `${label} ${change.name}${fields ? `：${fields}` : ""}`),
          );
        }
        if ((result.changes || []).length > 24) {
          list.append(
            node("li", `…其余 ${(result.changes || []).length - 24} 项资产已同步落库`, "muted"),
          );
        }
        reply.append(list);

        const details = node("details"),
          summary = node("summary", "检查结果与证据");
        details.append(summary);
        details.append(
          node(
            "p",
            `事务版本 ${result.committedRevision} · ${task.modelCalls ?? 0} 次模型请求 · 修复 ${result.repairs || 0} 轮`,
            "muted",
          ),
        );
        details.append(
          node("p", result.review?.summary || "确定性几何门禁检查通过。"),
        );
        for (const item of result.evidence || []) {
          if (
            typeof item.url !== "string" ||
            !item.url.startsWith("/api/projects/")
          )
            continue;
          const link = node("a"),
            img = node("img");
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noopener";
          img.src = item.url;
          img.alt = item.view === "top" ? "候选俯视检查图" : "候选斜视检查图";
          img.loading = "lazy";
          link.append(img);
          details.append(link);
        }
        if (result.checks?.limitations)
          details.append(
            node("p", result.checks.limitations.join("；"), "muted"),
          );
        reply.append(details);
      }
      if (result?.candidateId && task.status !== "completed")
        reply.append(
          node("p", "候选和检查记录已保留，正式场景尚未确认修改。", "muted"),
        );
      if (
        task.status !== "completed" &&
        result?.report?.issues?.some((i: any) => i.blocking)
      ) {
        const problems = node("details"),
          list = node("ul");
        problems.append(node("summary", "尚未解决的问题"));
        for (const issue of result.report.issues.filter((i: any) => i.blocking))
          list.append(node("li", issue.message || issue.description));
        problems.append(list);
        reply.append(problems);
      }
      if (
        ["failed", "conflict"].includes(task.status) &&
        !task.cancelRequested
      ) {
        if (task.modelCalls >= 24 || task.elapsedSeconds >= 600)
          reply.append(
            node("p", "本任务预算已耗尽，请重新提交完整需求。", "muted"),
          );
        else {
          const retry = node(
            "button",
            task.status === "conflict" ? "读取最新场景后重试" : "重试此任务",
          );
          retry.onclick = () => void this.retry(task.id);
          reply.append(retry);
        }
      }
      entry.append(reply);
      this.messages.append(entry);
    }
    const current = this.current();
    this.cancel.hidden = !current;
    this.cancel.disabled =
      current?.status === "committing" ||
      current?.cancelRequested ||
      this.sending;
    this.send.disabled =
      this.sending || !!(current && current.status !== "waiting_input");
    this.send.textContent =
      current?.status === "waiting_input"
        ? "补充说明"
        : this.mode() === "generate_rectangular"
          ? "生成空间"
          : "发送";
    if (nearBottom) this.messages.scrollTop = this.messages.scrollHeight;
  }

  private update(task: any) {
    const index = this.tasks.findIndex((t) => t.id === task.id);
    if (index < 0) this.tasks.push(task);
    else {
      const next = { ...this.tasks[index], ...task };
      if (JSON.stringify(next) === JSON.stringify(this.tasks[index])) return;
      this.tasks[index] = next;
    }
    this.render();
    if (task.status === "completed" && this.lastRefresh !== task.id) {
      this.lastRefresh = task.id;
      void this.onCommit(task.projectId, !!task.result?.generation).catch(
        (error) => {
          this.notice.textContent = (error as Error).message;
        },
      );
    }
  }

  private watchActive() {
    const task = this.current();
    if (!task) {
      this.events?.close();
      this.events = undefined;
      this.watched = undefined;
      return;
    }
    if (task.cloud === true) {
      this.events?.close();
      this.events = undefined;
      this.watched = undefined;
      return;
    }
    if (this.watched === task.id && this.events) return;
    this.events?.close();
    this.watched = task.id;
    const seq = this.sequence,
      events = new EventSource(`/api/agent/tasks/${task.id}/events`);
    this.events = events;
    events.addEventListener("progress", (event) => {
      if (seq !== this.sequence) return;
      const e = JSON.parse((event as MessageEvent).data);
      if (e.kind === "phase")
        this.update({
          id: task.id,
          phaseLabel: e.data?.label || phases[e.data?.phase] || "处理中",
        });
      if (e.kind === "brief" || e.kind === "brief_frozen")
        this.update({ id: task.id, generation: e.data });
    });
    events.addEventListener("snapshot", (event) => {
      if (seq !== this.sequence) return;
      const snapshot = JSON.parse((event as MessageEvent).data);
      this.update(snapshot);
      this.connection.textContent = "设计助手已连接";
      if (!active.has(snapshot.status)) {
        events.close();
        this.events = undefined;
        this.watched = undefined;
      }
    });
    events.onerror = () => {
      if (seq === this.sequence)
        this.connection.textContent = "任务连接中断，正在重新读取状态…";
    };
  }

  async requestRepair(
    brief: string,
    selectedIds: string[] = [],
    allowedRoomIds: string[] = [],
  ) {
    if (this.sending) {
      this.notice.textContent = "当前还有任务在处理，请稍后再试";
      this.render();
      return false;
    }
    const context = this.getContext();
    if (!context.projectId) return false;
    this.sending = true;
    this.notice.textContent = "";
    try {
      if (!this.conversationId) await this.load();
      if (!this.conversationId) throw new Error("设计助手暂不可用");
      const task = await post<any>(
        `/agent/conversations/${this.conversationId}/tasks`,
        {
          requestId: safeUuid(),
          projectId: context.projectId,
          input: brief,
          selectedIds,
          allowedRoomIds,
          mode: "repair_layout",
        },
      );
      this.update(task);
      this.watchActive();
      this.input.value = "";
      return true;
    } catch (error) {
      this.notice.textContent = (error as Error).message;
      this.render();
      return false;
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private async submit() {
    const typed = this.input.value.trim();
    if (!typed || this.sending) return;
    const context = this.getContext();
    if (context.projectId !== this.projectId) return;
    const current = this.current();
    const isBlankGen = !current && this.mode() === "generate_rectangular";
    let input =
      this.styleHint && typed
        ? `${typed}\n\n设计方向：${this.styleHint}`
        : typed;
    if (isBlankGen && this.freePlay && !input.includes("[自主发挥]")) {
      input = `${input}\n[自主发挥]`;
    }

    this.sending = true;
    this.notice.textContent = "";
    this.render();
    try {
      if (!this.conversationId) await this.load();
      if (!this.conversationId) throw new Error("设计助手暂不可用");
      if (current && current.status !== "waiting_input")
        throw new Error("请等待当前任务完成或先取消任务");
      const route = current
        ? `/agent/tasks/${current.id}/resume`
        : `/agent/conversations/${this.conversationId}/tasks`;
      const pendingKey = `actiscape-pending:${this.conversationId}`;
      const signature = JSON.stringify({
        route,
        input,
        selectedIds: context.selectedIds,
        ...(!current && this.mode() !== "edit" ? { mode: this.mode() } : {}),
      });
      let previous: any;
      try {
        previous = JSON.parse(localStorage.getItem(pendingKey) || "null");
      } catch {}
      const body =
        previous?.signature === signature
          ? previous.body
          : {
              requestId: safeUuid(),
              projectId: this.projectId,
              input,
              selectedIds: context.selectedIds,
              ...(isBlankGen ? { preferLocal: true } : {}),
              ...(!current && this.mode() !== "edit"
                ? { mode: this.mode() }
                : {}),
            };
      localStorage.setItem(pendingKey, JSON.stringify({ signature, body }));
      const task = await post<any>(route, body);
      localStorage.removeItem(pendingKey);
      if (context.projectId !== this.projectId) return;
      this.input.value = "";
      this.update(task);
      this.watchActive();
    } catch (error) {
      this.notice.textContent = (error as Error).message;
      await this.load();
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private reviewFloorplan(task: any) {
    new FloorplanPanel(
      task.projectId,
      task.id,
      task.generation.draftId,
      async (body) => {
        const next = await post(
          `/agent/tasks/${task.id}/confirm-floorplan`,
          body,
        );
        this.update(next);
        this.watchActive();
      },
      async (body) => {
        const next = await post(
          `/agent/tasks/${task.id}/recheck-floorplan`,
          body,
        );
        this.update(next);
      },
      task.status === "completed",
    );
  }

  private async uploadFloorplan(file: File, hybridMode = true) {
    if (this.sending) return;
    if (!this.getContext().blank) {
      this.notice.textContent = "请先新建空白项目，再上传户型图。";
      return;
    }
    if (this.current()) {
      this.notice.textContent = "请先完成或取消当前任务。";
      return;
    }
    this.sending = true;
    this.notice.textContent = hybridMode
      ? "正在上传户型图并启动 VLM + OpenCV 全屋高精度直出…"
      : "上传并校验原图…";
    this.render();
    const project = this.projectId;
    try {
      if (!this.conversationId) await this.load();
      if (!this.conversationId || project !== this.projectId)
        throw new Error("当前项目已切换，请重新上传");
      const form = new FormData();
      form.append("file", file);
      const image = await api<any>("/floorplan-images", {
        method: "POST",
        body: form,
      });
      if (project !== this.projectId)
        throw new Error("当前项目已切换，原图已保存，请在目标项目重新选择");
      const userTyped = this.input.value.trim();
      const styleSuffix = this.styleHint ? `\n设计方向：${this.styleHint}` : "";
      const input = hybridMode
        ? `${userTyped || "请识别这张单层户型图的全屋房间、门窗与家具，自动标定比例尺并直出可编辑 3D 全屋空间。"}${styleSuffix}\n[混合高精度重建]`
        : userTyped ||
          "请识别这张单层户型图，保留整层结构，并复现客餐厅原图家具布局。先提供草稿供我确认。";
      const key = `actiscape-floorplan-pending:${this.conversationId}`,
        signature = JSON.stringify({ imageId: image.id, input, hybridMode });
      let previous: any;
      try {
        previous = JSON.parse(localStorage.getItem(key) || "null");
      } catch {}
      const body =
        previous?.signature === signature
          ? previous.body
          : {
              requestId: safeUuid(),
              projectId: this.projectId,
              input,
              mode: "reconstruct_floorplan",
              imageId: image.id,
              preferLocal: true,
              selectedIds: [],
            };
      localStorage.setItem(key, JSON.stringify({ signature, body }));
      const task = await post<any>(
        `/agent/conversations/${this.conversationId}/tasks`,
        body,
      );
      localStorage.removeItem(key);
      if (project !== this.projectId) return;
      this.input.value = "";
      this.notice.textContent = hybridMode
        ? "原图已上传，AI 正在执行多模态语义识别、墙轴焊接与三级标尺校准…"
        : "原图已保存，正在识别草稿；正式项目暂未改变。";
      this.update(task);
      this.watchActive();
    } catch (error) {
      this.notice.textContent = (error as Error).message;
      await this.load();
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private async cancelTask() {
    const current = this.current();
    if (!current) return;
    try {
      this.update(await post(`/agent/tasks/${current.id}/cancel`, {}));
      this.watchActive();
    } catch (error) {
      this.notice.textContent = (error as Error).message;
    }
  }

  private async retry(id: string) {
    try {
      this.update(
        await post(`/agent/tasks/${id}/resume`, {
          requestId: safeUuid(),
          input: "",
          selectedIds: this.getContext().selectedIds,
        }),
      );
      this.watchActive();
    } catch (error) {
      this.notice.textContent = (error as Error).message;
    }
  }
}
