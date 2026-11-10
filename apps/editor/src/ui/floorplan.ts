import { api, post } from "../api.js";
import { clone } from "../../../../packages/scene-core/src/index.js";
import {
  imageCategoryCodes,
  type FloorplanData,
} from "../../../../packages/scene-core/src/floorplan.js";
import type { Point } from "../../../../packages/scene-core/src/index.js";
const imageCategoryOptions = imageCategoryCodes.map((value) => ({
  value,
  text: value,
}));
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
const labels: Record<string, string> = {
  walls: "墙体",
  openings: "门窗",
  rooms: "房间",
  symbols: "家具",
  uncertainties: "待确认项",
};
/** Draft-only controller. It has no scene command callback or project mutation capability. */
export class FloorplanPanel {
  private dialog = el("dialog");
  private canvas = el("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tools = el("div");
  private properties = el("form");
  private checks = el("div");
  private summary = el("div");
  private notice = el("p");
  private recheck = el("button", "重新审核当前草稿");
  private confirm = el("button", "确认结构与原图布局");
  private select = el("select");
  private collection = el("select");
  private draft: any;
  private preview: any;
  private image = new Image();
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private opacity = 0.65;
  private layers = new Set(["walls", "openings", "rooms", "symbols"]);
  private selected?: { collection: string; id: string };
  private calibration: Point[] | undefined;
  private calibrationText = el("p");
  private drag?: {
    point: Point;
    original: FloorplanData;
    selection?: { collection: string; id: string };
    pan?: { ox: number; oy: number };
  };
  private basis = el("select");
  private distance = el("input");
  private busy = false;
  private closed = false;
  constructor(
    private projectId: string,
    private taskId: string,
    private draftId: string,
    private onConfirm: (body: any) => Promise<void>,
    private onRecheck: (body: any) => Promise<void>,
    private readOnly = false,
  ) {
    this.dialog.className = "floorplan-dialog";
    this.dialog.setAttribute("aria-label", "户型图草稿确认");
    this.canvas.dataset.testid = "floorplan-canvas";
    const heading = el("div"),
      close = el("button", "关闭"),
      title = el("h2", "核对户型图"),
      titleBlock = el("div"),
      steps = el("div");
    heading.className = "floorplan-heading";
    titleBlock.className = "floorplan-title";
    steps.className = "floorplan-steps";
    for (const [index, label] of ["识别", "核对", "生成"].entries()) {
      const step = el("span", `${String(index + 1).padStart(2, "0")}  ${label}`);
      if (index === 1) step.className = "active";
      steps.append(step);
    }
    titleBlock.append(
      el("span", "AI FLOORPLAN RECONSTRUCTION"),
      title,
      steps,
    );
    heading.append(titleBlock, close);
    close.onclick = () => this.dialog.close();
    const body = el("div"),
      drawing = el("div"),
      side = el("section");
    body.className = "floorplan-body";
    drawing.className = "floorplan-drawing";
    side.className = "floorplan-controls";
    const opacity = el("input");
    opacity.type = "range";
    opacity.min = "0";
    opacity.max = "1";
    opacity.step = ".05";
    opacity.value = String(this.opacity);
    opacity.setAttribute("aria-label", "原图透明度");
    opacity.oninput = () => {
      this.opacity = Number(opacity.value);
      this.draw();
    };
    const fit = el("button", "适应原图");
    fit.onclick = () => this.fit();
    this.tools.append(el("span", "原图"), opacity, fit);
    for (const key of ["walls", "openings", "rooms", "symbols"]) {
      const label = el("label"),
        input = el("input");
      input.type = "checkbox";
      input.checked = true;
      input.onchange = () => {
        input.checked ? this.layers.add(key) : this.layers.delete(key);
        this.draw();
      };
      label.append(input, document.createTextNode(labels[key]));
      this.tools.append(label);
    }
    drawing.append(
      this.tools,
      this.canvas,
      el(
        "p",
        "点击选择对象；拖动家具、门窗和房间标签。拖动墙线沿垂直方向校正，共用端点一起更新。空白处拖动可平移，滚轮可缩放。",
      ),
    );
    const calibrate = el("button", "在图上选两点标定");
    calibrate.onclick = () => {
      this.calibration = [];
      this.calibrationText.textContent =
        "请在原图上依次点击已知距离的两个端点。";
    };
    this.distance.type = "number";
    this.distance.min = "1";
    this.distance.placeholder = "实际距离（mm）";
    this.distance.setAttribute("aria-label", "标定实际距离毫米");
    for (const [value, text] of [
      ["", "选择标注基准"],
      ["interior", "室内净尺寸"],
      ["centerline", "墙中线尺寸"],
      ["exterior", "外轮廓尺寸"],
    ]) {
      const option = el("option", text);
      option.value = value;
      this.basis.append(option);
    }
    const saveScale = el("button", "保存比例尺");
    saveScale.onclick = () => {
      if (
        !this.calibration ||
        this.calibration.length !== 2 ||
        !this.basis.value ||
        Number(this.distance.value) <= 0
      ) {
        this.notice.textContent = "先选两个点，并填写实际距离和尺寸基准。";
        return;
      }
      void this.change([
        {
          type: "calibrate",
          anchors: [
            {
              a: this.calibration[0],
              b: this.calibration[1],
              distance: { value: Number(this.distance.value), unit: "mm" },
              basis: this.basis.value,
              evidence: "用户在原图两点标定",
            },
          ],
        },
      ]).then(() => {
        this.calibration = undefined;
        this.calibrationText.textContent = "";
        this.draw();
      });
    };
    for (const [key, text] of Object.entries(labels)) {
      const option = el("option", text);
      option.value = key;
      this.collection.append(option);
    }
    this.collection.onchange = () => {
      this.selected = undefined;
      this.renderObjects();
    };
    this.select.onchange = () => {
      this.selected = {
        collection: this.collection.value,
        id: this.select.value,
      };
      this.renderProperties();
      this.draw();
    };
    const add = el("button", "新增所选类型"),
      remove = el("button", "删除所选对象");
    add.onclick = () => void this.add();
    remove.onclick = () => void this.remove();
    this.confirm.disabled = true;
    this.confirm.className = "primary";
    this.confirm.dataset.testid = "confirm-floorplan";
    this.confirm.onclick = () => void this.confirmDraft();
    this.recheck.disabled = true;
    this.recheck.dataset.testid = "recheck-floorplan";
    this.recheck.onclick = () => void this.recheckDraft();
    side.append(
      this.summary,
      el("h3", "比例尺"),
      calibrate,
      this.calibrationText,
      this.distance,
      this.basis,
      saveScale,
      el("h3", "草稿对象"),
      this.collection,
      this.select,
      add,
      remove,
      this.properties,
      el("h3", "结构检查"),
      this.checks,
      this.notice,
      this.recheck,
      this.confirm,
      el(
        "p",
        "确认前只保存草稿。确认后按原图布局生成，检查通过才保存正式项目。",
      ),
    );
    body.append(drawing, side);
    this.dialog.append(heading, body);
    document.body.append(this.dialog);
    this.dialog.onclose = () => {
      this.closed = true;
      this.dialog.remove();
    };
    this.dialog.showModal();
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = this.point(e),
          s = Math.max(
            0.08,
            Math.min(8, this.scale * Math.exp(-e.deltaY * 0.001)),
          );
        this.ox += (this.scale - s) * p.x;
        this.oy += (this.scale - s) * p.y;
        this.scale = s;
        this.draw();
      },
      { passive: false },
    );
    this.canvas.onpointerdown = (e) => this.down(e);
    this.canvas.onpointermove = (e) => this.move(e);
    this.canvas.onpointerup = (e) => void this.up(e);
    this.canvas.onpointercancel = () => {
      if (this.drag) {
        this.draft.data = this.drag.original;
        this.drag = undefined;
        this.draw();
      }
    };
    const observer = new ResizeObserver(() => {
      if (!this.closed) this.resize();
    });
    observer.observe(drawing);
    this.dialog.addEventListener("close", () => observer.disconnect());
    void this.load()
      .then(() => this.fit())
      .catch((e) => {
        this.notice.textContent = e.message;
      });
  }
  private path() {
    return `/projects/${this.projectId}/floorplan-drafts/${this.draftId}`;
  }
  private ready() {
    return (
      this.preview?.checks.passed &&
      (this.draft?.data.measurementVersion !== 2 ||
        (this.draft.sourceReview?.hash === this.draft.hash &&
          this.draft.sourceReview?.review?.passed === true))
    );
  }
  private async load() {
    this.draft = await api(this.path());
    this.preview = await post(this.path() + "/preview", {
      taskId: this.taskId,
    });
    const id = this.draft.data.image.id;
    if (!this.image.src.includes(id)) {
      await new Promise<void>((resolve, reject) => {
        this.image.onload = () => resolve();
        this.image.onerror = () => reject(new Error("原图加载失败"));
        this.image.src = `/api/floorplan-images/${id}/file`;
      });
    }
    if (this.closed) return;
    this.renderObjects();
    this.renderSummary();
    this.draw();
    this.recheck.disabled = this.busy || !this.preview.checks.passed;
    this.confirm.disabled = this.busy || !this.ready();
    if (this.readOnly) {
      this.dialog
        .querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          ".floorplan-controls input,.floorplan-controls select,.floorplan-controls button",
        )
        .forEach((n) => (n.disabled = true));
      this.confirm.hidden = true;
      this.recheck.hidden = true;
    }
  }
  private resize() {
    const host = this.canvas.parentElement!,
      r = host.getBoundingClientRect();
    this.canvas.width = Math.max(400, Math.floor(r.width * devicePixelRatio));
    this.canvas.height = Math.max(
      300,
      Math.floor((r.height - 100) * devicePixelRatio),
    );
    this.canvas.style.width = r.width + "px";
    this.canvas.style.height = Math.max(300, r.height - 100) + "px";
    this.draw();
  }
  private fit() {
    if (!this.draft) return;
    const { width, height } = this.draft.data.image,
      w = this.canvas.width / devicePixelRatio,
      h = this.canvas.height / devicePixelRatio;
    this.scale = Math.min((w - 40) / width, (h - 40) / height);
    this.ox = (w - width * this.scale) / 2;
    this.oy = (h - height * this.scale) / 2;
    this.draw();
  }
  private point(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left - this.ox) / this.scale) * 10) / 10,
      y: Math.round(((e.clientY - r.top - this.oy) / this.scale) * 10) / 10,
    };
  }
  private renderSummary() {
    const d = this.draft.data as FloorplanData;
    this.summary.replaceChildren(
      el("h3", "识别草稿"),
      el(
        "p",
        `${d.walls.length} 段墙 · ${d.openings.length} 个门窗 · ${d.rooms.length} 个房间`,
      ),
      el(
        "p",
        `目标家具 ${d.symbols.filter((s) => d.targetRoomIds.includes(s.roomId) && s.included !== false).length} 件 · 累计对象校正 ${this.draft.corrections} 项`,
      ),
    );
    if (d.measurementVersion === 2) {
      const dims = this.preview.measurement?.dimensions || [];
      const readDimensions =
        d.dimensionObservations?.length || d.anchors.length;
      const reviewIssues = this.draft.sourceReview?.review?.issues || [];
      const advisory = reviewIssues.filter(
        (issue: any) => issue.severity === "advisory",
      ).length;
      this.summary.append(
        el(
          "p",
          `已读标注 ${readDimensions} 项 · 解算尺寸 ${dims.length} 项 · ${
            this.draft.sourceReview?.review?.passed
              ? "原图审核通过"
              : "原图审核待通过"
          }${advisory ? ` · ${advisory} 项建议` : ""}`,
        ),
      );
      for (const f of this.preview.measurement?.features || [])
        if (Math.abs(f.adjustmentMm) > 0.01)
          this.summary.append(
            el("p", `${f.id} 校准 ${f.adjustmentMm.toFixed(1)} mm`),
          );
    }
    const name = el("input");
    name.value = d.name;
    name.setAttribute("aria-label", "户型名称");
    const height = el("input");
    height.type = "number";
    height.value = String(d.height ?? 2800);
    height.setAttribute("aria-label", "层高毫米");
    const thickness = el("input");
    thickness.type = "number";
    thickness.value = String(d.wallThickness ?? 200);
    thickness.setAttribute("aria-label", "默认墙厚毫米");
    const save = el("button", "保存名称与高度");
    save.onclick = () =>
      void this.change([
        {
          type: "defaults",
          values: {
            name: name.value,
            height: Number(height.value),
            wallThickness: Number(thickness.value),
          },
        },
      ]);
    this.summary.append(
      name,
      el("label", "层高（mm）"),
      height,
      el("label", "无图示墙厚时采用（mm）"),
      thickness,
      save,
    );
    const target = el("div");
    target.append(el("strong", "复现家具的区域"));
    const quick = el("div");
    const selectAll = el("button", "全选全屋");
    selectAll.onclick = () =>
      void this.change([
        { type: "targets", roomIds: d.rooms.map((room) => room.id) },
      ]);
    const selectLiving = el("button", "仅选客餐厅");
    selectLiving.onclick = () =>
      void this.change([
        {
          type: "targets",
          roomIds: d.rooms
            .filter(
              (room) =>
                ["living", "dining"].includes(room.functionalArea ?? "") ||
                ["living_dining", "reading_lounge"].includes(
                  room.roomType ?? "",
                ),
            )
            .map((room) => room.id),
        },
      ]);
    const clear = el("button", "清空");
    clear.onclick = () =>
      void this.change([{ type: "targets", roomIds: [] }]);
    quick.append(selectAll, selectLiving, clear);
    target.append(quick);
    for (const room of d.rooms) {
      const label = el("label"),
        box = el("input");
      box.type = "checkbox";
      box.checked = d.targetRoomIds.includes(room.id);
      box.dataset.roomId = room.id;
      box.onchange = () => {
        const ids = [
          ...target.querySelectorAll<HTMLInputElement>("input:checked"),
        ].map((n) => n.dataset.roomId);
        void this.change([{ type: "targets", roomIds: ids }]);
      };
      label.append(box, document.createTextNode(room.name));
      target.append(label);
    }
    this.summary.append(target);
    this.checks.replaceChildren();
    if (this.preview.checks.passed)
      this.checks.append(el("p", "结构、比例与待确认项检查通过。"));
    for (const issue of this.preview.checks.issues)
      this.checks.append(el("p", issue.message));
    const defaults = this.preview.defaults || [];
    if (defaults.length) {
      const detail = el("details");
      detail.append(
        el("summary", "采用的默认值"),
        el("p", defaults.join("；")),
      );
      this.checks.append(detail);
    }
    this.confirm.disabled = this.busy || !this.ready();
  }
  private renderObjects() {
    if (!this.draft) return;
    const col = this.collection.value,
      list = this.draft.data[col] as any[];
    this.select.replaceChildren();
    for (const o of list) {
      const option = el(
        "option",
        `${o.name || o.category || o.type || o.id} · ${o.id}`,
      );
      option.value = o.id;
      this.select.append(option);
    }
    if (
      this.selected?.collection === col &&
      list.some((o) => o.id === this.selected!.id)
    )
      this.select.value = this.selected.id;
    else
      this.selected = list[0] ? { collection: col, id: list[0].id } : undefined;
    this.renderProperties();
  }
  private renderProperties() {
    this.properties.replaceChildren();
    const selected = this.selected;
    if (!selected) return;
    const item = this.draft.data[selected.collection].find(
      (o: any) => o.id === selected.id,
    );
    if (!item) return;
    const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const field = (
      name: string,
      label: string,
      value: any,
      type = "number",
      choices?: { value: string; text: string }[],
    ) => {
      const wrap = el("label", label);
      let input: HTMLInputElement | HTMLSelectElement;
      if (choices) {
        input = el("select");
        for (const choice of choices) {
          const option = el("option", choice.text);
          option.value = choice.value;
          input.append(option);
        }
      } else {
        input = el("input");
        input.type = type;
        if (type === "number") input.step = "any";
      }
      input.value = String(value ?? "");
      input.setAttribute("aria-label", label);
      fields[name] = input;
      wrap.append(input);
      this.properties.append(wrap);
    };
    const col = selected.collection;
    if (col === "walls") {
      for (const endpoint of ["a", "b"])
        for (const axis of ["x", "y"])
          field(
            endpoint + "." + axis,
            `${endpoint.toUpperCase()} ${axis}（px）`,
            item[endpoint][axis],
          );
      field(
        "thicknessPx",
        "图上墙厚（px，空白用默认值）",
        item.thicknessPx ?? "",
      );
    }
    if (col === "openings") {
      field(
        "wallId",
        "所属墙",
        item.wallId,
        "text",
        this.draft.data.walls.map((w: any) => ({ value: w.id, text: w.id })),
      );
      field("side", "朝向墙的哪一侧", item.side ?? 1, "text", [
        { value: "1", text: "墙正侧" },
        { value: "-1", text: "墙反侧" },
      ]);
      field("hinge", "门铰方向", item.hinge ?? 0, "text", [
        { value: "0", text: "起点侧" },
        { value: "1", text: "终点侧" },
      ]);
      field("type", "开口类型", item.type, "text", [
        { value: "door", text: "门" },
        { value: "window", text: "窗" },
        { value: "hole", text: "门洞" },
        { value: "sliding", text: "推拉门" },
      ]);
      for (const [key, label] of [
        ["offset", "沿墙距 A 点的中心距离（px）"],
        ["width", "开口宽度（px）"],
        ["sill", "离地（mm）"],
        ["head", "顶高（mm）"],
      ])
        field(key, label, item[key] ?? "");
    }
    if (col === "rooms") {
      field("name", "房间名称", item.name, "text");
      field("x", "标签 X（px）", item.at.x);
      field("y", "标签 Y（px）", item.at.y);
    }
    if (col === "symbols") {
      field(
        "categoryCode",
        "家具类别",
        item.categoryCode || item.category,
        "text",
        imageCategoryOptions,
      );
      field("sourceLabel", "原图名称", item.sourceLabel || "", "text");
      field(
        "roomId",
        "所属房间",
        item.roomId,
        "text",
        this.draft.data.rooms.map((r: any) => ({ value: r.id, text: r.name })),
      );
      for (const [key, label] of [
        ["x", "中心 X（px）"],
        ["y", "中心 Y（px）"],
        ["w", "旋转前宽（px）"],
        ["d", "旋转前深（px）"],
        ["rot", "朝向（度）"],
      ])
        field(key, label, item[key]);
      field(
        "catalogKey",
        "指定目录类型（可留空）",
        item.catalogKey ?? "",
        "text",
      );
    }
    if (col === "uncertainties") {
      field("message", "待确认说明", item.message, "text");
      field(
        "blocking",
        "是否待处理",
        item.blocking ? "true" : "false",
        "text",
        [
          { value: "true", text: "尚未解决，阻止生成" },
          { value: "false", text: "用户已核对解决" },
        ],
      );
    }
    const save = el("button", "保存对象校正");
    save.type = "submit";
    this.properties.append(save);
    this.properties.onsubmit = (e) => {
      e.preventDefault();
      const next = clone(item);
      for (const [key, input] of Object.entries(fields)) {
        let value: any = input.value;
        if (key === "blocking") value = value === "true";
        else if (key === "side" || key === "hinge") value = Number(value);
        else if ((input as HTMLInputElement).type === "number") {
          if (!value.trim()) {
            delete next[key];
            continue;
          }
          value = Number(value);
        }
        if (key.includes(".")) {
          const [a, b] = key.split(".");
          next[a][b] = value;
        } else if (col === "rooms" && (key === "x" || key === "y"))
          next.at[key] = value;
        else if (key === "catalogKey" && !value) delete next.catalogKey;
        else next[key] = value;
      }
      if (col === "symbols") {
        if (next.categoryCode) next.category = next.categoryCode;
        if (!next.sourceLabel?.trim())
          next.sourceLabel = next.category || next.categoryCode;
      }
      void this.change([{ type: "upsert", collection: col, object: next }]);
    };
  }
  private async change(commands: any[]) {
    if (this.busy || this.readOnly) return;
    this.busy = true;
    this.confirm.disabled = true;
    this.recheck.disabled = true;
    this.notice.textContent = "保存草稿…";
    try {
      await post(this.path() + "/commands", {
        requestId: crypto.randomUUID(),
        draftRevision: this.draft.revision,
        commands,
      });
      await this.load();
      this.notice.textContent = "草稿已保存，正式项目未改变。";
    } catch (e) {
      this.notice.textContent = (e as Error).message;
      await this.load().catch(() => {});
    } finally {
      this.busy = false;
      this.recheck.disabled = !this.preview?.checks.passed;
      this.confirm.disabled = !this.ready();
    }
  }
  private async recheckDraft() {
    if (this.busy || !this.preview?.checks.passed) return;
    this.busy = true;
    this.confirm.disabled = true;
    this.recheck.disabled = true;
    this.notice.textContent = "正在重新审核当前草稿…";
    try {
      await this.onRecheck({
        requestId: crypto.randomUUID(),
        draftId: this.draft.id,
        draftRevision: this.draft.revision,
        draftHash: this.draft.hash,
      });
      await this.load();
      this.notice.textContent = this.ready()
        ? "当前草稿审核通过，可以确认。"
        : "审核完成，仍有阻断问题或审核未通过。";
    } catch (e) {
      this.notice.textContent = (e as Error).message;
      await this.load().catch(() => {});
    } finally {
      this.busy = false;
      this.recheck.disabled = !this.preview?.checks.passed;
      this.confirm.disabled = !this.ready();
    }
  }
  private async confirmDraft() {
    if (this.busy || !this.ready()) return;
    this.busy = true;
    this.confirm.disabled = true;
    this.recheck.disabled = true;
    const key = `actiscape-floorplan-confirm:${this.taskId}`,
      signature = `${this.draft.id}:${this.draft.revision}:${this.draft.hash}`;
    let old: any;
    try {
      old = JSON.parse(localStorage.getItem(key) || "null");
    } catch {}
    const body =
      old?.signature === signature
        ? old.body
        : {
            requestId: crypto.randomUUID(),
            draftId: this.draft.id,
            draftRevision: this.draft.revision,
            draftHash: this.draft.hash,
          };
    localStorage.setItem(key, JSON.stringify({ signature, body }));
    try {
      await this.onConfirm(body);
      localStorage.removeItem(key);
      this.dialog.close();
    } catch (e) {
      this.notice.textContent = (e as Error).message;
      await this.load().catch(() => {});
    } finally {
      this.busy = false;
      this.recheck.disabled = !this.preview?.checks.passed;
      this.confirm.disabled = !this.ready();
    }
  }
  private async add() {
    const col = this.collection.value,
      id = col.slice(0, 1) + "-" + crypto.randomUUID(),
      d = this.draft.data;
    let object: any;
    if (col === "walls")
      object = {
        id,
        a: {
          x: Math.round(d.image.width * 0.25),
          y: Math.round(d.image.height * 0.25),
        },
        b: {
          x: Math.round(d.image.width * 0.75),
          y: Math.round(d.image.height * 0.25),
        },
      };
    if (col === "openings") {
      const w = d.walls[0];
      if (!w) {
        this.notice.textContent = "请先添加所属墙。";
        return;
      }
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      object = {
        id,
        wallId: w.id,
        type: "door",
        offset: len / 2,
        width: Math.min(90, len / 2),
      };
    }
    if (col === "rooms")
      object = {
        id,
        at: {
          x: Math.round(d.image.width / 2),
          y: Math.round(d.image.height / 2),
        },
        name: "待确认房间",
      };
    if (col === "symbols") {
      if (!d.rooms.length) {
        this.notice.textContent = "请先添加房间。";
        return;
      }
      object = {
        id,
        roomId: d.targetRoomIds[0] || d.rooms[0].id,
        category: "待确认家具",
        categoryCode: "other",
        sourceLabel: "待确认家具",
        x: Math.round(d.image.width / 2),
        y: Math.round(d.image.height / 2),
        w: 80,
        d: 80,
        rot: 0,
      };
    }
    if (col === "uncertainties")
      object = { id, message: "请核对图中位置", blocking: true };
    this.selected = { collection: col, id };
    await this.change([{ type: "upsert", collection: col, object }]);
  }
  private async remove() {
    if (!this.selected) return;
    const { collection, id } = this.selected,
      d = this.draft.data,
      commands: any[] = [];
    if (collection === "walls")
      commands.push(
        ...d.openings
          .filter((o: any) => o.wallId === id)
          .map((o: any) => ({
            type: "delete",
            collection: "openings",
            id: o.id,
          })),
      );
    if (collection === "rooms") {
      commands.push(
        ...d.symbols
          .filter((s: any) => s.roomId === id)
          .map((s: any) => ({
            type: "delete",
            collection: "symbols",
            id: s.id,
          })),
        {
          type: "targets",
          roomIds: d.targetRoomIds.filter((r: string) => r !== id),
        },
      );
    }
    commands.push({ type: "delete", collection, id });
    await this.change(commands);
  }
  private hit(p: Point) {
    const d = this.draft.data,
      t = 14 / this.scale;
    for (const s of d.symbols) {
      if (!this.layers.has("symbols")) break;
      const a = (-s.rot * Math.PI) / 180,
        dx = p.x - s.x,
        dy = p.y - s.y;
      if (
        Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= s.w / 2 &&
        Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= s.d / 2
      )
        return { collection: "symbols", id: s.id };
    }
    for (const o of d.openings) {
      if (!this.layers.has("openings")) break;
      const w = d.walls.find((w: any) => w.id === o.wallId);
      if (!w) continue;
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
        x = w.a.x + ((w.b.x - w.a.x) * o.offset) / len,
        y = w.a.y + ((w.b.y - w.a.y) * o.offset) / len;
      if (Math.hypot(p.x - x, p.y - y) < Math.max(t, o.width / 2))
        return { collection: "openings", id: o.id };
    }
    for (const r of d.rooms) {
      if (
        this.layers.has("rooms") &&
        Math.hypot(p.x - r.at.x, p.y - r.at.y) < t
      )
        return { collection: "rooms", id: r.id };
    }
    for (const w of d.walls) {
      if (!this.layers.has("walls")) break;
      const dx = w.b.x - w.a.x,
        dy = w.b.y - w.a.y,
        len = dx * dx + dy * dy,
        u = Math.max(
          0,
          Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len),
        );
      if (Math.hypot(p.x - w.a.x - u * dx, p.y - w.a.y - u * dy) < t)
        return { collection: "walls", id: w.id };
    }
    return undefined;
  }
  private down(e: PointerEvent) {
    if (!this.draft || this.busy || this.readOnly) return;
    const p = this.point(e);
    if (this.calibration) {
      if (this.calibration.length >= 2) this.calibration = [];
      this.calibration.push(p);
      this.calibrationText.textContent = `已选择 ${this.calibration.length}/2 点，请填实际距离和尺寸基准。`;
      this.draw();
      return;
    }
    const hit = this.hit(p);
    if (hit) {
      this.selected = hit;
      this.collection.value = hit.collection;
      this.renderObjects();
    }
    this.drag = {
      point: p,
      original: clone(this.draft.data),
      selection: hit,
      ...(!hit ? { pan: { ox: this.ox, oy: this.oy } } : {}),
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  }
  private move(e: PointerEvent) {
    if (!this.drag) return;
    const p = this.point(e),
      drag = this.drag;
    if (drag.pan) {
      this.ox += (p.x - drag.point.x) * this.scale;
      this.oy += (p.y - drag.point.y) * this.scale;
      this.draw();
      return;
    }
    this.draft.data = clone(drag.original);
    const sel = drag.selection!,
      item = this.draft.data[sel.collection].find((o: any) => o.id === sel.id),
      dx = p.x - drag.point.x,
      dy = p.y - drag.point.y,
      d = this.draft.data;
    if (sel.collection === "symbols") {
      item.x = Math.max(0, Math.min(d.image.width, item.x + dx));
      item.y = Math.max(0, Math.min(d.image.height, item.y + dy));
    }
    if (sel.collection === "rooms") {
      item.at.x = Math.max(0, Math.min(d.image.width, item.at.x + dx));
      item.at.y = Math.max(0, Math.min(d.image.height, item.at.y + dy));
    }
    if (sel.collection === "openings") {
      const wall = d.walls.find((w: any) => w.id === item.wallId),
        len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      item.offset = Math.max(
        item.width / 2,
        Math.min(
          len - item.width / 2,
          item.offset +
            (dx * (wall.b.x - wall.a.x) + dy * (wall.b.y - wall.a.y)) / len,
        ),
      );
    }
    if (sel.collection === "walls") {
      const vertical = Math.abs(item.a.x - item.b.x) <= 1,
        axis = vertical ? "x" : "y",
        delta = vertical ? dx : dy,
        old = drag.original.walls.find((w) => w.id === item.id)!;
      for (const wall of d.walls)
        for (const end of ["a", "b"]) {
          if (
            [old.a, old.b].some(
              (q) => Math.hypot(wall[end].x - q.x, wall[end].y - q.y) < 0.1,
            )
          )
            wall[end][axis] += delta;
        }
      for (const end of ["a", "b"])
        item[end][axis] = old[end as "a" | "b"][axis] + delta;
    }
    this.draw();
  }
  private async up(e: PointerEvent) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    if (this.canvas.hasPointerCapture(e.pointerId))
      this.canvas.releasePointerCapture(e.pointerId);
    if (drag.pan || !drag.selection) return;
    const current = clone(this.draft.data),
      commands: any[] = [];
    for (const col of ["walls", "openings", "rooms", "symbols"])
      for (const item of current[col]) {
        const original = (drag.original as any)[col].find(
          (o: any) => o.id === item.id,
        );
        if (JSON.stringify(original) !== JSON.stringify(item))
          commands.push({ type: "upsert", collection: col, object: item });
      }
    this.draft.data = drag.original;
    if (commands.length) await this.change(commands);
  }
  private draw() {
    const c = this.ctx,
      dpr = devicePixelRatio;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#eeeae5";
    c.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    if (!this.draft || !this.image.complete) return;
    const d = this.draft.data;
    c.save();
    c.translate(this.ox, this.oy);
    c.scale(this.scale, this.scale);
    c.globalAlpha = this.opacity;
    c.drawImage(this.image, 0, 0, d.image.width, d.image.height);
    c.globalAlpha = 1;
    c.font = `${12 / this.scale}px sans-serif`;
    const selected = (col: string, id: string) =>
      this.selected?.collection === col && this.selected.id === id;
    if (this.layers.has("walls"))
      for (const w of d.walls) {
        c.lineWidth = (selected("walls", w.id) ? 5 : 2) / this.scale;
        c.strokeStyle = selected("walls", w.id) ? "#f58220" : "#d22b56";
        c.beginPath();
        c.moveTo(w.a.x, w.a.y);
        c.lineTo(w.b.x, w.b.y);
        c.stroke();
        for (const p of [w.a, w.b]) {
          c.beginPath();
          c.arc(p.x, p.y, 3 / this.scale, 0, Math.PI * 2);
          c.fillStyle = c.strokeStyle;
          c.fill();
        }
      }
    if (this.layers.has("openings"))
      for (const o of d.openings) {
        const w = d.walls.find((w: any) => w.id === o.wallId);
        if (!w) continue;
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        c.strokeStyle = selected("openings", o.id) ? "#f58220" : "#146de0";
        c.lineWidth = 5 / this.scale;
        c.beginPath();
        for (const [i, sign] of [-1, 1].entries()) {
          const t = (o.offset + (sign * o.width) / 2) / len,
            x = w.a.x + (w.b.x - w.a.x) * t,
            y = w.a.y + (w.b.y - w.a.y) * t;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }
    if (this.layers.has("rooms"))
      for (const r of d.rooms) {
        c.fillStyle = d.targetRoomIds.includes(r.id) ? "#238331" : "#646464";
        c.beginPath();
        c.arc(r.at.x, r.at.y, 5 / this.scale, 0, Math.PI * 2);
        c.fill();
        c.fillText(r.name, r.at.x + 8 / this.scale, r.at.y);
      }
    if (this.layers.has("symbols"))
      for (const f of d.symbols) {
        c.save();
        c.translate(f.x, f.y);
        c.rotate((f.rot * Math.PI) / 180);
        c.strokeStyle = selected("symbols", f.id) ? "#f58220" : "#9b42be";
        c.lineWidth = (selected("symbols", f.id) ? 4 : 2) / this.scale;
        c.strokeRect(-f.w / 2, -f.d / 2, f.w, f.d);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -f.d / 2);
        c.stroke();
        c.restore();
        c.fillStyle = "#7a278f";
        c.fillText(f.sourceLabel || f.categoryCode || f.category, f.x, f.y);
      }
    if (this.calibration?.length) {
      c.fillStyle = "#009ea5";
      for (const p of this.calibration) {
        c.beginPath();
        c.arc(p.x, p.y, 5 / this.scale, 0, Math.PI * 2);
        c.fill();
      }
      if (this.calibration.length === 2) {
        c.strokeStyle = "#009ea5";
        c.lineWidth = 3 / this.scale;
        c.beginPath();
        c.moveTo(this.calibration[0].x, this.calibration[0].y);
        c.lineTo(this.calibration[1].x, this.calibration[1].y);
        c.stroke();
      }
    }
    c.restore();
  }
}
