import { api, post } from "../api.js";
import { FloorplanPanel } from "./floorplan.js";

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
  private floorplanUpload = node("button", "上传户型图复现客餐厅");
  private floorplanFile = node("input");
  private photoUpload = node("button", "上传物品照片转 3D");
  private quick = node("div", undefined, "chat-quick");
  private stylePicker = node("div", undefined, "chat-styles");
  private styleHint = "";
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
    this.floorplanUpload.type = "button";
    this.floorplanFile.type = "file";
    this.floorplanFile.accept = "image/png,image/jpeg,.png,.jpg,.jpeg";
    this.floorplanFile.hidden = true;
    this.floorplanUpload.onclick = () => this.floorplanFile.click();
    this.photoUpload.type = "button";
    this.photoUpload.dataset.testid = "chat-photo-import";
    this.photoUpload.onclick = () => this.onPhotoImport?.();
    this.floorplanFile.onchange = () => {
      const file = this.floorplanFile.files?.[0];
      if (file) void this.uploadFloorplan(file);
      this.floorplanFile.value = "";
    };
    this.input.placeholder =
      "例如：把这把椅子向左移动 200 毫米，再在旁边加一盏落地灯";
    this.input.setAttribute("aria-label", "对话需求");
    this.input.maxLength = 4000;
    this.input.rows = 4;
    this.brief.open = true;
    for (const style of ["暖木极简", "现代东方", "奶油自然"]) {
      const button = node("button", style, "chat-style");
      button.type = "button";
      button.onclick = () => {
        this.styleHint = this.styleHint === style ? "" : style;
        this.stylePicker
          .querySelectorAll(".chat-style")
          .forEach((b) => b.classList.toggle("active", b.textContent === this.styleHint));
        if (this.styleHint) this.input.placeholder = `描述空间，AI 会按「${style}」方向设计`;
      };
      this.stylePicker.append(button);
    }
    const form = node("form"),
      actions = node("div", undefined, "chat-actions");
    actions.append(this.send, this.cancel);
    this.send.type = "submit";
    this.cancel.type = "button";
    form.append(this.input, actions);
    this.quick.append(
      this.suggestion("试试：生成一个 6×4.2 米的客餐厅"),
      this.suggestion("试试：把茶几往左移 200 毫米"),
      this.suggestion("试试：打开电视柜检查净空"),
    );
    this.root.append(
      this.context,
      this.connection,
      this.quick,
      this.stylePicker,
      this.floorplanUpload,
      this.floorplanFile,
      this.photoUpload,
      this.brief,
      this.messages,
      this.notice,
      form,
      node(
        "p",
        "方向按二维平面图，长度为毫米。检查通过后自动保存，可用上方撤销按钮恢复。",
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
  focus() {
    this.input.focus();
    this.input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  openFloorplan() {
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
    this.floorplanUpload.hidden =
      !this.getContext().blank || !!this.current();
    this.floorplanUpload.disabled =
      this.sending || !this.getContext().blank || !!this.current();
    this.floorplanUpload.title = this.getContext().blank
      ? "上传清晰的单层 PNG/JPEG，先核对草稿再生成"
      : "请先新建空白项目";
    if (this.mode() === "reconstruct_floorplan") {
      this.context.textContent = "户型图复现 · 先核对整层结构与客餐厅原图布局";
      this.input.placeholder = "补充图中信息，或打开草稿标定尺寸、校正对象。";
      this.brief.hidden = true;
      return;
    }
    this.stylePicker.hidden = !this.getContext().blank;
    const generating = this.mode() === "generate_rectangular",
      context = this.getContext();
    this.context.textContent = generating
      ? "生成房间 · 只在空白项目中创建一个矩形空间"
      : context.selectionLabel
        ? `当前选择：${context.selectionLabel}`
        : "可先选中家具，再说“这把椅子”或“它”。";
    this.input.placeholder = generating
      ? "例如：设计一个客餐厅，室内净宽6米、净深4米，南墙入口距左侧400毫米，北墙窗居中。"
      : "例如：把这把椅子向左移动 200 毫米，再在旁边加一盏落地灯";
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
        task?.status === "completed" ? "生成时的需求摘要" : "房间需求摘要",
      ),
    );
    if (!g?.brief) {
      this.brief.append(
        node(
          "p",
          "需要：横向净宽、纵向净深、用途、入口和窗的位置。可说明没有窗。",
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
    this.brief.append(
      node(
        "p",
        `用途：${b.purpose === "living_dining" ? "客餐厅" : b.purpose === "reading_lounge" ? "阅读会客间" : "待补充"}`,
      ),
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
          `家具：${g.furniture.map((f: any) => `${f.query} × ${f.count}`).join("，")}`,
        ),
      );
    if (g.style) this.brief.append(node("p", `风格：${g.style}`));
    if (g.missing?.length)
      this.brief.append(
        node("p", `待确认：${g.missing.join("；")}`, "chat-missing"),
      );
    const used = g.skillsUsed || task.result?.skillsUsed;
    if (used?.length)
      this.brief.append(
        node(
          "p",
          `设计技能：${used.map((s: any) => `${s.id} @ ${s.version}`).join("，")}`,
          "muted",
        ),
      );
    if (g.defaults?.length) {
      const details = node("details");
      details.append(
        node("summary", "采用的默认值"),
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
            ? "描述你的矩形房间和需求，缺少的尺寸与门窗信息会一起询问。"
            : "告诉我想调整哪些家具。支持增删、摆放、尺寸和颜色修改。",
          "muted",
        ),
      );
    const visibleTasks = this.tasks.slice(-4);
    if (this.tasks.length > visibleTasks.length)
      this.messages.append(
        node("p", `更早的 ${this.tasks.length - visibleTasks.length} 条记录已收起`, "chat-older"),
      );
    for (const task of visibleTasks) {
      const entry = node("article", undefined, "chat-task");
      entry.dataset.task = task.id;
      entry.append(node("div", task.input, "chat-user"));
      const reply = node("div", undefined, "chat-assistant"),
        badge = node(
          "strong",
          statusLabels[task.status] || task.status,
          "chat-status",
        );
      badge.dataset.status = task.status;
      reply.append(badge);
      if (active.has(task.status) && task.status !== "waiting_input") {
        const rail = node("div", undefined, "chat-phase-rail");
        const label = task.phaseLabel || "";
        const currentIndex = /提交|保存/.test(label)
          ? 3
          : /检查|渲染|核对|修复/.test(label)
            ? 2
            : /生成|设计|选择|理解/.test(label)
              ? 1
              : 0;
        for (const [index, text] of ["理解", "生成", "检查", "保存"].entries()) {
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
              ? "本次空间修改已经提交，下面是摘要。"
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
          node("p", result.message || "本次空间修改已经提交。", "chat-result-copy"),
          node(
            "div",
            `${result.changes?.length || 0} 项变更 · 版本 ${result.committedRevision || task.result?.committedRevision || ""} · ${checkLabel}`,
            "chat-result-meta",
          ),
        );
        reply.append(card);
        const basis = node("details");
        basis.append(node("summary", "AI 设计依据"));
        if (result.generation?.mode === "reconstruct_floorplan") {
          reply.append(
            node(
              "p",
              `整层结构与 ${result.changes?.length || 0} 件客餐厅家具已作为一个事务保存，保留确认时的原图布局。`,
            ),
          );
          for (const skill of result.skillsUsed || [])
            basis.append(
              node("p", `复现技能 ${skill.id} @ ${skill.version}`, "muted"),
            );
        }
        if (result.generation?.dimensions) {
          const d = result.generation.dimensions;
          reply.append(
            node(
              "p",
              `已生成净尺寸 ${d.width} × ${d.depth} mm 的矩形房间，墙体、门窗和家具作为一个事务保存。`,
            ),
          );
          for (const skill of result.skillsUsed || [])
            basis.append(
              node(
                "p",
                `设计技能 ${skill.id} @ ${skill.version} · ${skill.contentHash.slice(0, 12)}`,
                "muted",
              ),
            );
        }
        if (basis.childElementCount > 1) reply.append(basis);
        const list = node("ul");
        for (const change of result.changes || []) {
          const label =
            change.action === "added"
              ? "新增"
              : change.action === "deleted"
                ? "删除"
                : "修改";
          const fields =
            change.action === "updated"
              ? change.fields
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
        reply.append(list);
        const details = node("details"),
          summary = node("summary", "检查结果与证据");
        details.append(summary);
        details.append(
          node(
            "p",
            `事务版本 ${result.committedRevision} · ${task.modelCalls} 次模型请求 · 修复 ${result.repairs || 0} 轮`,
            "muted",
          ),
        );
        details.append(
          node("p", result.review?.summary || "确定性检查与截图检查通过。"),
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
        details.append(
          node("p", "检查视图使用透明墙体并隐藏吊顶，以便观察家具。", "muted"),
        );
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
        task.status === "failed" &&
        result?.errorCode &&
        !task.cancelRequested
      ) {
        if (task.modelCalls >= 24 || task.elapsedSeconds >= 600)
          reply.append(
            node("p", "本任务预算已耗尽，请重新提交完整需求。", "muted"),
          );
        else {
          const retry = node("button", "重试此任务");
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
          ? "生成房间"
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
          phaseLabel: phases[e.data.phase] || "处理中",
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
          requestId: crypto.randomUUID(),
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
    const input = this.styleHint && typed
      ? `${typed}\n\n设计方向：${this.styleHint}`
      : typed;
    if (!input || this.sending) return;
    const context = this.getContext();
    if (context.projectId !== this.projectId) return;
    this.sending = true;
    this.notice.textContent = "";
    this.render();
    try {
      if (!this.conversationId) await this.load();
      if (!this.conversationId) throw new Error("设计助手暂不可用");
      const current = this.current();
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
              requestId: crypto.randomUUID(),
              projectId: this.projectId,
              input,
              selectedIds: context.selectedIds,
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
  private async uploadFloorplan(file: File) {
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
    this.notice.textContent = "上传并校验原图…";
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
      const input =
        this.input.value.trim() ||
        "请识别这张单层户型图，保留整层结构，并复现客餐厅原图家具布局。先提供草稿供我确认。";
      const key = `actiscape-floorplan-pending:${this.conversationId}`,
        signature = JSON.stringify({ imageId: image.id, input });
      let previous: any;
      try {
        previous = JSON.parse(localStorage.getItem(key) || "null");
      } catch {}
      const body =
        previous?.signature === signature
          ? previous.body
          : {
              requestId: crypto.randomUUID(),
              projectId: this.projectId,
              input,
              mode: "reconstruct_floorplan",
              imageId: image.id,
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
      this.notice.textContent = "原图已保存，正在识别草稿；正式项目暂未改变。";
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
          requestId: crypto.randomUUID(),
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
