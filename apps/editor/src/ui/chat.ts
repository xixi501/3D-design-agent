import { api, post } from "../api.js";

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
  ) {
    this.input.placeholder =
      "例如：把这把椅子向左移动 200 毫米，再在旁边加一盏落地灯";
    this.input.setAttribute("aria-label", "对话需求");
    this.input.maxLength = 4000;
    this.input.rows = 4;
    this.brief.open = true;
    const form = node("form"),
      actions = node("div", undefined, "chat-actions");
    actions.append(this.send, this.cancel);
    this.send.type = "submit";
    this.cancel.type = "button";
    form.append(this.input, actions);
    this.root.append(
      node("h2", "设计助手"),
      this.context,
      this.connection,
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
  private mode(): "edit" | "generate_rectangular" {
    return (
      this.current()?.mode ||
      (this.getContext().blank ? "generate_rectangular" : "edit")
    );
  }
  private renderMode() {
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
    for (const task of this.tasks.slice(-40)) {
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
      reply.append(
        node(
          "p",
          (active.has(task.status) && task.status !== "waiting_input"
            ? task.phaseLabel || "正在处理已保存的任务…"
            : task.result?.message) ||
            task.error ||
            task.phaseLabel ||
            "任务已保存，正在处理。",
        ),
      );
      if (task.cancelRequested && active.has(task.status))
        reply.append(node("p", "已请求取消，正在等待安全边界。", "muted"));
      const result = task.result;
      if (result?.status === "completed") {
        if (result.generation?.dimensions) {
          const d = result.generation.dimensions;
          reply.append(
            node(
              "p",
              `已生成净尺寸 ${d.width} × ${d.depth} mm 的矩形房间，墙体、门窗和家具作为一个事务保存。`,
            ),
          );
          for (const skill of result.skillsUsed || [])
            reply.append(
              node(
                "p",
                `设计技能 ${skill.id} @ ${skill.version} · ${skill.contentHash.slice(0, 12)}`,
                "muted",
              ),
            );
        }
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
    else this.tasks[index] = { ...this.tasks[index], ...task };
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
  private async submit() {
    const input = this.input.value.trim();
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
