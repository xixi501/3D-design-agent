import "./style.css";
import { api, post, ApiError, type EditBase } from "./api.js";
import {
  catalogGroups,
  catalog,
  collections,
  createFurniture,
  clone,
  newId,
  type Project,
  type Command,
  type AssetRecord,
  type Plan,
  allDoorCabinetCommands,
  isSurfaceHost,
  isOpenableFurniture,
  isTogglableFurniture,
  rotatedAabb,
  detectRooms,
  wallGeometry,
} from "../../../packages/scene-core/src/index.js";
import { PlanView, type Selection } from "./views/plan-view.js";
import { ThreeView } from "./views/three-view.js";
import { renderInspector, esc } from "./ui/inspector.js";
import { ChatPanel } from "./ui/chat.js";
import { displayProjectName, displayRoomName, roomArea } from "./ui/labels.js";
import { Ov } from "./modeling/furniture-3d.js";
import { Fh } from "./modeling/furniture-2d.js";
import * as THREE from "three";
import { initSafetyTwinPlugin } from "./plugins/safety-twin-plugin.js";
const root = document.querySelector("#app")!;
root.innerHTML = `<header class="app-bar">
  <div class="brand-block">
    <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M6 8h17v5H11v19h18v-9h5v14H6z"/><path d="M23 4h11v11h-5V9h-6z"/><path d="M18 18h10v4H18z"/></svg></span>
    <div><b>演境</b><small>ACTISCAPE · AI STUDIO</small></div>
  </div>
  <div class="project-block">
    <span class="eyebrow">当前空间</span>
    <input id="project-name" aria-label="项目名称">
    <span id="save-state" role="status">连接项目服务…</span>
  </div>
  <div class="bar-actions">
    <button id="new-project" class="quiet">新建空间</button>
    <button id="open-project" class="quiet">打开项目</button>
    <details class="export-actions"><summary>导出 <span aria-hidden="true">⌄</span></summary><button id="export-image">导出当前视图 PNG</button><button id="export-pdf">打印 / 保存为 PDF</button><button id="export-project">导出项目 JSON</button></details>
    <details class="more-actions"><summary aria-label="更多项目操作">•••</summary><button id="open-structure">结构编辑（高级）</button><button id="import-project">导入 JSON</button></details>
    <button id="mobile-agent" class="mobile-only" title="打开 AI 设计搭档">AI</button>
    <button id="context-toggle" class="mobile-only" title="打开项目上下文">属性</button>
    <button id="save-project" class="primary">保存</button>
  </div>
</header>
<div class="workbench">
  <aside class="agent-rail" id="agent-rail">
    <div class="agent-rail-head">
      <span class="agent-orb">AI</span>
      <div class="agent-rail-title"><strong>AI 设计搭档</strong><span id="agent-live-status">在线 · 等你的第一个想法</span></div>
      <span class="live-dot" aria-hidden="true"></span>
    </div>
    <div id="agent-host" class="agent-host"></div>
  </aside>
  <section class="stage-shell">
    <div class="stage-toolbar">
      <div class="stage-title"><span class="eyebrow">空间画布</span><strong id="stage-room-label">未命名空间</strong></div>
      <div class="stage-space-nav" id="space-nav" hidden></div>
      <div class="stage-view"><button data-view="2d" class="active">2D</button><button data-view="split">分屏</button><button data-view="3d">3D</button></div>
      <div class="stage-actions">
        <button id="frame" title="适应视图">适应</button>
        <button id="source-image" hidden>原图</button>
        <button id="walk" title="第一人称漫游">漫游</button>
        <button id="open-all" data-testid="open-all">一键全开</button>
        <button id="undo" title="Ctrl Z">撤销</button>
        <button id="redo" title="Ctrl Shift Z">重做</button>
      </div>
    </div>
    <div id="viewport" data-mode="2d">
      <div id="plan-view"></div>
      <div id="three-view"></div>
      <div id="selection-actions" hidden><span id="selection-name"></span><button id="selection-toggle" hidden>打开柜门</button></div>
      <div id="walk-hud" hidden><div class="walk-crosshair"></div><div class="walk-tip">WASD 移动 · 方向键转向 · 拖动环顾 · E 交互 · Esc 退出</div><div id="walk-target" class="walk-target" hidden><kbd>E</kbd><span id="walk-target-text"></span></div><div id="walk-toast" class="walk-toast" hidden></div><div id="walk-map" class="walk-map"><div class="walk-map-head"><span>俯视导航</span><small>点击房间</small></div><canvas id="walk-map-canvas" width="240" height="180"></canvas></div><div class="walk-marker-hint">场景中的 <b>E</b> 标记表示可开关的门/柜门/抽屉/电器</div></div>
      <div id="stage-busy" class="stage-busy" hidden><div class="stage-busy-card"><span class="agent-orb mini">AI</span><div><strong>AI 正在构建空间</strong><span id="stage-busy-label">理解空间与需求…</span></div><i aria-hidden="true"></i></div></div>
      <div id="empty-state" class="empty-state">
        <div class="empty-kicker">A NEW SPACE · 01</div>
        <h1>把空间交给 AI，<em>从一个想法开始</em></h1>
        <p class="empty-lede">描述你想要的房间，或上传户型图让 AI 识别全屋。它会读懂空间、生成候选，并把检查结果交给你确认。</p>
        <div class="empty-choices">
          <button class="empty-card" id="empty-floorplan"><span class="empty-index">01</span><b>上传户型图</b><small>AI 识别墙体、门窗与房间<br>先核对，再生成</small><i>↗</i></button>
          <button class="empty-card" id="empty-prompt"><span class="empty-index">02</span><b>从一句话开始</b><small>描述尺寸、功能与风格<br>生成第一版空间</small><i>↗</i></button>
        </div>
        <button id="empty-example" class="text-button">或打开一个示例空间 <span>→</span></button>
      </div>
      <div class="view-caption">单层设计 · mm</div>
    </div>
    <div class="stage-footer">
      <div class="tools"><button data-tool="select" class="active">选择</button><button id="structural-toggle" title="墙体、门窗、柱梁等结构工具">结构工具</button><span id="structural-tools"><button data-tool="wall">墙体</button><button data-tool="opening:door">门</button><button data-tool="opening:window">窗</button><button data-tool="struct:column">柱</button><button data-tool="beam">梁</button><button data-tool="room">房间</button><button data-tool="measure">尺寸</button></span></div>
      <select id="openable-jump" title="定位可开启家具" aria-label="定位可开启家具"><option value="">可开启家具…</option></select>
      <button id="open-catalog" class="catalog-trigger">＋ 添加家具</button>
      <span class="stage-help">空格拖动画布 · 滚轮缩放 · E 开关柜门</span>
    </div>
  </section>
  <aside class="context-panel" id="context-panel">
    <div class="context-head"><span class="eyebrow">CONTEXT</span><span>项目上下文</span><button id="context-close" class="icon-button" aria-label="关闭上下文">×</button></div>
    <nav class="context-tabs"><button data-panel="overview" class="active">概览</button><button data-panel="properties">属性</button><button data-panel="checks">检查</button><button data-panel="history">历史</button><button data-panel="chat">AI</button></nav>
    <div id="inspector-body"></div>
  </aside>
</div>
<footer><span id="message" role="status">正在载入…</span><span class="footer-shortcuts">⌘K AI 指令 · ⌘Z 撤销 · E 开关</span><span id="revision"></span></footer>
<div id="catalog-drawer" class="drawer" hidden>
  <button class="drawer-scrim" id="close-catalog-scrim" aria-label="关闭家具目录"></button>
  <aside class="drawer-panel" aria-label="家具目录">
    <div class="drawer-head"><div><span class="eyebrow">ASSET LIBRARY</span><h2>添加家具</h2></div><button id="close-catalog" class="icon-button" aria-label="关闭">×</button></div>
    <aside class="library"><div class="side-heading">家具与模型 <span id="catalog-count"></span></div><input id="catalog-search" placeholder="搜索家具 / 造型" aria-label="搜索家具"><button id="upload-model" class="wide subtle">＋ 导入 GLB 模型</button><button id="upload-photo" class="wide subtle" data-testid="upload-photo">＋ 上传物品照片转 3D</button><div id="catalog"></div></aside>
  </aside>
</div>
<input id="json-file" type="file" accept=".json,application/json" hidden><input id="glb-file" type="file" accept=".glb" hidden><input id="photo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><dialog id="dialog"><div id="dialog-body"></div><button id="close-dialog">关闭</button></dialog><dialog id="repair-confirm" class="repair-confirm"><div id="repair-confirm-body"></div></dialog>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
document.body.dataset.mode = "ai";
let project: Project | undefined,
  selection: Selection | undefined,
  busy = false,
  panel = "overview",
  events: EventSource | undefined,
  loadSequence = 0,
  inspectorSequence = 0,
  pendingRevision = -1,
  lastFailure = false;
const message = (s: string) => {
  $("#message").textContent = s;
};
const saved = (s: string, error = false) => {
  $("#save-state").textContent = s;
  $("#save-state").classList.toggle("error", error);
};
const three = new ThreeView(
  $("#three-view"),
  (id, collection = "furniture") =>
    setSelection({ id, collection: collection as any }),
  message,
  commands,
  (on) => {
    $("#walk").textContent = on ? "退出漫游" : "漫游";
    $("#walk").classList.toggle("active", on);
    $("#walk-hud").hidden = !on;
    startWalkMap(on);
  },
  (info) => {
    const target = $("#walk-target");
    if (!info) {
      target.hidden = true;
      return;
    }
    target.hidden = false;
    $("#walk-target-text").textContent = info.label;
  },
  (text) => {
    const toast = $("#walk-toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout((toast as any)._timer);
    (toast as any)._timer = setTimeout(() => (toast.hidden = true), 1800);
  },
);
let walkMapTimer: ReturnType<typeof setInterval> | undefined;
function startWalkMap(on: boolean) {
  if (walkMapTimer) {
    clearInterval(walkMapTimer);
    walkMapTimer = undefined;
  }
  if (!on) return;
  drawWalkMap();
  walkMapTimer = setInterval(drawWalkMap, 220);
}
function walkMapTransform(plan: Plan) {
  const xs = plan.nodes.map((n) => n.x),
    ys = plan.nodes.map((n) => n.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const canvas = $("#walk-map-canvas") as HTMLCanvasElement;
  const w = canvas.width,
    h = canvas.height,
    pad = 12;
  const sx = (x: number) =>
    pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - pad * 2);
  const sy = (y: number) =>
    pad + ((y - minY) / Math.max(1, maxY - minY)) * (h - pad * 2);
  return { canvas, w, h, sx, sy, minX, minY, maxX, maxY };
}
function drawWalkMap() {
  if (!project) return;
  const plan = project.plan;
  if (!plan.nodes.length) return;
  const { canvas, w, h, sx, sy } = walkMapTransform(plan);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8e8";
  ctx.fillRect(0, 0, w, h);
  const geo = wallGeometry(plan),
    rooms = detectRooms(plan, geo).regions;
  ctx.fillStyle = "#e9e1d4";
  for (const room of rooms) {
    const bb = room.bb;
    ctx.fillRect(
      sx(bb.x),
      sy(bb.y),
      sx(bb.x + bb.w) - sx(bb.x),
      sy(bb.y + bb.h) - sy(bb.y),
    );
  }
  ctx.strokeStyle = "#5d625f";
  ctx.lineWidth = 2;
  for (const wall of geo.active) {
    ctx.beginPath();
    ctx.moveTo(sx(wall.a.x), sy(wall.a.y));
    ctx.lineTo(sx(wall.b.x), sy(wall.b.y));
    ctx.stroke();
  }
  ctx.fillStyle = "#5d625f";
  ctx.font = '500 9px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = "center";
  for (const room of rooms) {
    const label = room.labels[0];
    if (!label) continue;
    ctx.fillText(
      displayRoomName(label),
      sx(room.bb.x + room.bb.w / 2),
      sy(room.bb.y + room.bb.h / 2),
    );
  }
  const cam = three.camera.position;
  const px = sx(cam.x * 1000),
    py = sy(cam.z * 1000);
  const yaw = three.yaw;
  ctx.fillStyle = "#b8613c";
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#b8613c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - Math.sin(yaw) * 13, py - Math.cos(yaw) * 13);
  ctx.stroke();
}
($("#walk-map-canvas") as HTMLElement).onclick = (event) => {
  if (!project || !three.walking) return;
  const canvas = event.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = ((event as MouseEvent).clientX - rect.left) / rect.width;
  const y = ((event as MouseEvent).clientY - rect.top) / rect.height;
  const plan = project.plan;
  const { minX, minY, maxX, maxY } = walkMapTransform(plan);
  const p = {
    x: minX + x * (maxX - minX),
    y: minY + y * (maxY - minY),
  };
  const room = detectRooms(plan, wallGeometry(plan)).regions.find((r: any) =>
    r.rects.some(
      (rect: any) =>
        p.x >= rect.x &&
        p.x <= rect.x + rect.w &&
        p.y >= rect.y &&
        p.y <= rect.y + rect.h,
    ),
  );
  if (room) {
    three.walkTo(room.bb.x + room.bb.w / 2, room.bb.y + room.bb.h / 2);
    drawWalkMap();
  }
};

const planView = new PlanView(
  $("#plan-view"),
  setSelection,
  commands,
  (f) => three.preview(f),
  message,
);
const chat = new ChatPanel(
  () => {
    const current = selection;
    return {
      projectId: project?.id,
      blank:
        !!project &&
        collections.every((k) => project!.plan[k].length === 0) &&
        !project.roomLabelArchive.length,
      selectedIds: current?.collection === "furniture" ? [current.id] : [],
      selectionLabel:
        current?.collection === "furniture"
          ? project?.plan.furniture.find((f) => f.id === current.id)?.name
          : undefined,
    };
  },
  async (id, generated) => {
    if (project?.id === id) {
      await refresh();
      if (generated) {
        planView.frame();
        three.frame();
      }
    }
  },
  (state) => {
    $("#agent-live-status").textContent = state.label;
    $("#agent-rail").classList.toggle("is-working", state.active);
    $("#stage-busy").hidden = !state.active || !!state.waiting;
    $("#stage-busy-label").textContent = state.label;
    if (state.active || state.waiting)
      $("#empty-state").classList.add("is-hidden");
  },
);
chat.onPhotoImport = () => $<HTMLInputElement>("#photo-file").click();
for (const event of ["pointerup", "pointercancel"])
  window.addEventListener(event, () =>
    queueMicrotask(() => {
      const stale = (base?: EditBase) =>
        base &&
        project &&
        (base.projectId !== project.id || base.revision !== project.revision);
      if (!busy && project && (stale(planView.base) || stale(three.base)))
        void refresh().catch(fail);
    }),
  );
function updateSelectionActions() {
  const host = $("#selection-actions");
  const item = selection
    ? project?.plan[selection.collection].find((o) => o.id === selection!.id)
    : undefined;
  if (!selection || !item || selection.collection === "walls") {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  $("#selection-name").textContent =
    `${selection.collection === "openings" ? "门窗" : "已选"}：${(item as any).name || (item as any).type || "对象"}`;
  const button = $<HTMLButtonElement>("#selection-toggle");
  const furniture =
    selection.collection === "furniture"
      ? (item as import("../../../packages/scene-core/src/index.js").Furniture)
      : undefined;
  const openable = !!furniture && isOpenableFurniture(furniture);
  const togglable = !!furniture && !openable && isTogglableFurniture(furniture);
  const canOpen = openable || togglable;
  button.hidden = !canOpen;
  if (canOpen) {
    const isOpen = openable
      ? !!furniture!.opt?.open
      : (furniture!.opt as any)?.on !== false;
    button.textContent = openable
      ? isOpen
        ? "关闭柜门"
        : "打开柜门"
      : isOpen
        ? "关闭电器"
        : "开启电器";
    button.title = "也可以按 E";
  }
}
function setSelection(s?: Selection) {
  selection = s;
  planView.selection = s;
  planView.vertex = -1;
  planView.draw();
  three.lastSelected =
    s && (s.collection === "furniture" || s.collection === "openings")
      ? { id: s.id, collection: s.collection }
      : undefined;
  three.highlight(s?.collection === "furniture" ? s.id : undefined);
  if (s && panel === "overview") panel = "properties";
  if (!s && panel === "properties") panel = "overview";
  syncPanel();
  updateSelectionActions();
  if (project) chat.mount($("#agent-host"), project.id);
  if (s?.collection === "furniture") {
    const f = project?.plan.furniture.find((x) => x.id === s.id);
    if (f && isOpenableFurniture(f))
      message(
        `${f.name}已选中。按 E 或点上方“${f.opt?.open ? "关闭柜门" : "打开柜门"}”开关柜门。`,
      );
  }
  void inspector().catch(fail);
}
async function inspector() {
  if (!project) return;
  const sequence = ++inspectorSequence;
  const host = $("#inspector-body");
  if (panel === "chat") {
    chat.focus();
    return;
  }
  if (panel === "overview") {
    await renderOverview(host);
    return;
  }
  if (panel === "properties") {
    const snapshot = project;
    renderInspector(host, snapshot.plan, selection, (items, summary) =>
      commands(items, summary, {
        projectId: snapshot.id,
        revision: snapshot.revision,
      }),
    );
  }
  if (panel === "history") {
    const p = project.id,
      data = await api(`/projects/${p}/history`);
    if (
      project.id !== p ||
      panel !== "history" ||
      sequence !== inspectorSequence
    )
      return;
    host.innerHTML =
      '<h2>项目历史</h2><p class="muted">最近 200 个编辑事务。重开后仍可撤销和重做。</p>' +
      data.entries
        .map(
          (e: any, i: number) =>
            `<div class="history-item ${e.applied ? "" : "future"}"><b>${i + 1}. ${esc(e.summary)}</b><small>${esc(e.at)} · ${e.applied ? "已应用" : "可重做"}</small></div>`,
        )
        .join("");
  }
  if (panel === "checks") {
    const data = await api(`/projects/${project.id}/checks`);
    if (panel !== "checks" || sequence !== inspectorSequence) return;
    const issues = data.issues || [];
    const fixable = issues.filter(isFixableError);
    const structural = issues.filter(
      (issue: any) =>
        issue.level === "error" && issue.fixableByFurniture === false,
    );
    const tagFor = (issue: any) =>
      issue.category === "structure"
        ? "结构"
        : issue.category === "surface"
          ? "台面"
          : issue.category === "overlap"
            ? "重叠"
            : "家具";
    const buttonFor = (issue: any) => {
      const furnitureId = (issue.objectIds || []).find((id: string) =>
        project!.plan.furniture.some((item) => item.id === id),
      );
      const openingId = (issue.objectIds || []).find((id: string) =>
        project!.plan.openings.some((item) => item.id === id),
      );
      const wallId = (issue.objectIds || []).find((id: string) =>
        project!.plan.walls.some((item) => item.id === id),
      );
      const collection = furnitureId
        ? "furniture"
        : openingId
          ? "openings"
          : wallId
            ? "walls"
            : "";
      const id = furnitureId || openingId || wallId || "";
      return `<button class="issue ${issue.fixableByFurniture === false ? "structural" : ""}" data-id="${esc(id)}" data-collection="${collection}" data-room="${esc(issue.roomId || "")}"><span class="issue-tag">${tagFor(issue)}</span>${esc(issue.message)}</button>`;
    };
    host.innerHTML = `<h2>场景检查</h2><p class="muted">版本 ${data.revision} · ${issues.length} 项提示${structural.length ? ` · ${structural.length} 项结构问题` : ""}</p>${issues.map(buttonFor).join("") || "<p>当前检查未发现问题。</p>"}${fixable.length ? '<button id="repair-scene" class="repair-button wide">AI 尝试修复可移动家具</button>' : ""}${structural.length ? '<button id="go-structure" class="repair-button wide muted-repair">去结构编辑</button>' : ""}<h3>检查范围</h3><p class="muted">${data.coverage.map(esc).join("<br>")}</p><p class="muted">${data.limitations.map(esc).join("<br>")}</p>`;
    host.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(
      (b) =>
        (b.onclick = () => {
          const collection = b.dataset.collection as any;
          if (collection && b.dataset.id) {
            panel = "properties";
            setSelection({ collection, id: b.dataset.id });
            return;
          }
          const room = (project?.plan.rooms || []).find(
            (item) => item.id === b.dataset.room,
          );
          if (room) focusRoom(room);
        }),
    );
    const repair = host.querySelector<HTMLButtonElement>("#repair-scene");
    if (repair) repair.onclick = () => void repairScene();
    const structure = host.querySelector<HTMLButtonElement>("#go-structure");
    if (structure)
      structure.onclick = () => {
        $<HTMLDialogElement>("#dialog").close();
        $("#open-structure").click();
      };
  }
}
function openCatalog() {
  const drawer = $("#catalog-drawer");
  drawer.hidden = false;
  document.body.classList.add("catalog-open");
  requestAnimationFrame(() => $("#catalog-search").focus());
}
function closeCatalog() {
  const drawer = $("#catalog-drawer");
  drawer.hidden = true;
  document.body.classList.remove("catalog-open");
}
function issuesInRoom(plan: Plan, room: any, issues: any[]) {
  const region = roomRegion(plan, room.id);
  const ids = furnitureInRegion(plan, region);
  return issues.filter(
    (issue) =>
      issue.roomId === room.id ||
      (issue.objectIds || []).some((id: string) => ids.has(id)),
  );
}
function isFixableError(issue: any) {
  return issue.level === "error" && issue.fixableByFurniture !== false;
}
async function renderOverview(host: HTMLElement) {
  if (!project) return;
  const snapshot = project;
  const plan = snapshot.plan;
  const rooms = plan.rooms || [];
  const selectedCount = selection ? 1 : 0;
  let health: any;
  try {
    health = await api(`/projects/${snapshot.id}/checks`);
  } catch {}
  const issues = health?.issues || [];
  const issueCount = issues.length;
  const fixableErrors = issues.filter(isFixableError);
  const structuralErrors = issues.filter(
    (issue: any) =>
      issue.level === "error" && issue.fixableByFurniture === false,
  );
  const firstIssue = issues[0]?.message;
  host.innerHTML = `<div class="overview">
    <div class="overview-hero"><span class="eyebrow">PROJECT OVERVIEW</span><h2>${esc(displayProjectName(plan.name))}</h2><p>${rooms.length ? `${rooms.length} 个空间 · ${plan.furniture.length} 件家具 · 版本 ${project.revision}` : "从一个想法开始，AI 会帮你完成第一版空间。"}</p></div>
    <div class="metric-grid">
      <div><b>${rooms.length}</b><span>空间</span></div>
      <div><b>${plan.furniture.length}</b><span>家具</span></div>
      <div><b>${issueCount}</b><span>待处理</span></div>
    </div>
    ${health && rooms.length ? `<div class="health-row"><button class="health-card ${issueCount ? "has-issues" : "is-clear"}" data-overview-action="check"><span>${issueCount ? `${issueCount} 项需要处理` : "设计检查通过"}</span><small>${issueCount ? esc(firstIssue) : "没有发现结构、净空或台面问题"}</small><b>查看</b></button>${fixableErrors.length ? `<button class="repair-button" data-overview-action="repair">一键修复</button>` : structuralErrors.length ? `<button class="repair-button muted-repair" data-overview-action="check">结构问题</button>` : ""}</div>` : ""}
    ${
      rooms.length
        ? `<section class="overview-section"><div class="overview-section-head"><h3>空间导航</h3><span>点击定位</span></div><div class="overview-rooms">${rooms
            .map((r) => {
              const area = roomArea(plan, r.id);
              const roomIssues = issuesInRoom(plan, r, issues);
              const fixable = roomIssues.filter(isFixableError).length;
              const structural = roomIssues.filter(
                (issue: any) =>
                  issue.level === "error" && issue.fixableByFurniture === false,
              ).length;
              const label = fixable ? "修复" : structural ? "结构" : "无";
              return `<div class="overview-room-row"><button data-room="${esc(r.id)}"><b>${esc(displayRoomName(r))}</b><small>${area ? `${area} ㎡` : "定位"}</small></button><button class="room-repair" data-repair-room="${esc(r.id)}" ${fixable ? "" : "disabled"}>${label}</button></div>`;
            })
            .join("")}</div></section>`
        : ""
    }
    <section class="overview-section"><div class="overview-section-head"><h3>下一步</h3><span>AI 快捷入口</span></div><div class="overview-actions">${rooms.length ? `<button data-overview-action="check">全屋检查</button><button data-overview-action="catalog">添加家具</button><button data-overview-action="walk">进入漫游</button>` : `<button data-overview-action="start">从一句话开始</button><button data-overview-action="plan">上传户型图</button>`}</div></section>
    ${selectedCount ? `<p class="overview-note">当前选中的对象已在属性面板中展开。</p>` : rooms.length ? `<p class="overview-note">在画布中选择家具，或让 AI 继续帮你调整。</p>` : `<p class="overview-note">先描述一个房间，或上传一张户型图。</p>`}
  </div>`;
  host.querySelectorAll<HTMLButtonElement>("[data-room]").forEach((button) => {
    button.onclick = () => {
      const room = rooms.find((r) => r.id === button.dataset.room);
      if (room) focusRoom(room);
    };
  });
  host
    .querySelectorAll<HTMLButtonElement>("[data-repair-room]")
    .forEach((button) => {
      button.onclick = () => void repairScene(button.dataset.repairRoom);
    });
  host
    .querySelectorAll<HTMLButtonElement>("[data-overview-action]")
    .forEach((button) => {
      button.onclick = () => {
        const action = button.dataset.overviewAction;
        if (action === "check") {
          panel = "checks";
          syncPanel();
          void inspector().catch(fail);
        } else if (action === "catalog") openCatalog();
        else if (action === "walk") $("#walk").click();
        else if (action === "start") chat.focus();
        else if (action === "plan") chat.openFloorplan();
        else if (action === "repair") void repairScene();
      };
    });
}
let repairing = false;
function roomRegion(plan: Plan, roomId: string) {
  const regions = detectRooms(plan, wallGeometry(plan)).regions;
  return (
    regions.find((region: any) =>
      region.labels.some((label: any) => label.id === roomId),
    ) ||
    regions.find((region: any) => {
      const room = plan.rooms.find((r) => r.id === roomId);
      return room
        ? region.rects.some(
            (rect: any) =>
              room.x >= rect.x &&
              room.x <= rect.x + rect.w &&
              room.y >= rect.y &&
              room.y <= rect.y + rect.h,
          )
        : false;
    })
  );
}
function furnitureInRegion(plan: Plan, region: any) {
  if (!region) return new Set<string>();
  return new Set(
    plan.furniture
      .filter((f) =>
        region.rects.some(
          (rect: any) =>
            f.x >= rect.x &&
            f.x <= rect.x + rect.w &&
            f.y >= rect.y &&
            f.y <= rect.y + rect.h,
        ),
      )
      .map((f) => f.id),
  );
}
async function openRepairScope() {
  if (!project) return;
  const target = project;
  const checks = await api(`/projects/${target.id}/checks`);
  const rows = target.plan.rooms
    .map((room) => {
      const roomIssues = issuesInRoom(target.plan, room, checks.issues || []);
      const fixable = roomIssues.filter(isFixableError);
      const structural = roomIssues.filter(
        (issue: any) =>
          issue.level === "error" && issue.fixableByFurniture === false,
      );
      return { room, roomIssues, fixable, structural };
    })
    .sort((a, b) => b.roomIssues.length - a.roomIssues.length);
  const dialog = $<HTMLDialogElement>("#dialog"),
    body = $("#dialog-body");
  body.innerHTML = `<div class="dialog-kicker">REPAIR SCOPE</div><h2>选择要修复的房间</h2><p class="muted">AI 只调整该房间内可移动的家具，不改墙体门窗。结构问题需要进入结构编辑。</p><div class="repair-room-list">${rows
    .map(({ room, fixable, structural, roomIssues }) => {
      const label = fixable.length
        ? "修复"
        : structural.length
          ? "结构"
          : "通过";
      const detail = fixable.length
        ? `${fixable.length} 项可修复`
        : structural.length
          ? `${structural.length} 项结构问题`
          : roomIssues.length
            ? `${roomIssues.length} 项提示`
            : "没有硬伤";
      return `<button data-scope-room="${esc(room.id)}" ${fixable.length ? "" : "disabled"}><span><b>${esc(displayRoomName(room))}</b><small>${detail}</small></span><b>${label}</b></button>`;
    })
    .join(
      "",
    )}</div><div class="actions"><button id="repair-scope-cancel">先不修</button></div>`;
  body.querySelectorAll<HTMLButtonElement>("[data-scope-room]").forEach(
    (button) =>
      (button.onclick = () => {
        dialog.close();
        void repairScene(button.dataset.scopeRoom);
      }),
  );
  body.querySelector<HTMLButtonElement>("#repair-scope-cancel")!.onclick = () =>
    dialog.close();
  dialog.showModal();
}
function confirmRepair(
  roomName: string | undefined,
  total: number,
  targetNames: string[],
  structural: number,
) {
  const dialog = $<HTMLDialogElement>("#repair-confirm");
  const body = $("#repair-confirm-body");
  const names = [...new Set(targetNames)];
  body.innerHTML = `<div class="dialog-kicker">AI REPAIR</div>
    <h2>${roomName ? `修复「${esc(roomName)}」` : "修复当前空间"}</h2>
    <p class="muted">AI 会生成一个可检查的修复候选。只有目标问题真正消失，候选才会提交。</p>
    <div class="repair-confirm-block"><b>本次允许调整的家具</b><ul>${names.map((name) => `<li>${esc(name)}</li>`).join("")}</ul></div>
    <p class="muted">${total} 项可移动家具问题。不会移动墙体、门窗，也不会新增房间。${structural ? `另有 ${structural} 项结构问题需要进入结构编辑。` : ""}</p>
    <div class="actions"><button id="repair-confirm-cancel">取消</button><button id="repair-confirm-submit" class="primary">确认并开始修复</button></div>`;
  dialog.showModal();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    $("#repair-confirm-cancel").onclick = () => finish(false);
    $("#repair-confirm-submit").onclick = () => finish(true);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}
async function repairScene(roomId?: string) {
  if (!project || busy || repairing) return;
  const target = project;
  const checks = await api(`/projects/${target.id}/checks`);
  const region = roomId ? roomRegion(target.plan, roomId) : undefined;
  const room = roomId
    ? target.plan.rooms.find((r) => r.id === roomId)
    : undefined;
  const roomFurniture = furnitureInRegion(target.plan, region);
  const allIssues = roomId
    ? issuesInRoom(target.plan, room!, checks.issues || [])
    : checks.issues || [];
  const issues = allIssues.filter(isFixableError);
  const structural = allIssues.filter(
    (issue: any) =>
      issue.level === "error" && issue.fixableByFurniture === false,
  );
  if (!issues.length) {
    message(
      structural.length
        ? "该范围内的结构问题无法靠移动家具修复，请使用结构编辑调整墙体或门窗。"
        : room
          ? `「${displayRoomName(room)}」没有需要修复的家具问题`
          : "当前场景没有需要修复的家具问题",
    );
    return;
  }
  const total = issues.length;
  if (!roomId && total > 8) {
    await openRepairScope();
    return;
  }
  const repairIds: string[] = [
    ...new Set<string>(
      issues
        .slice(0, 8)
        .flatMap((i: any): string[] =>
          (i.objectIds || []).filter(
            (id: unknown): id is string => typeof id === "string",
          ),
        )
        .filter((id: string) => target.plan.furniture.some((f) => f.id === id))
        .filter((id: string) => !roomId || roomFurniture.has(id)),
    ),
  ].slice(0, 12);
  if (!repairIds.length) {
    message("当前问题没有可授权的家具目标，请在画布中选中家具后再试。");
    return;
  }
  const targetNames = repairIds.map((id) => {
    const item = target.plan.furniture.find((f) => f.id === id);
    return item?.name || item?.type || id;
  });
  if (
    !(await confirmRepair(
      room ? displayRoomName(room) : undefined,
      total,
      targetNames,
      structural.length,
    ))
  )
    return;
  repairing = true;
  try {
    const messages = [...new Set(issues.map((i: any) => i.message as string))];
    const MAX_REPAIR_ISSUES = 8;
    const lines = messages
      .slice(0, MAX_REPAIR_ISSUES)
      .map((message) => `- ${message}`);
    if (messages.length > MAX_REPAIR_ISSUES)
      lines.push(
        `- 本次先处理前 ${MAX_REPAIR_ISSUES} 项；其余 ${messages.length - MAX_REPAIR_ISSUES} 项完成后再点一次修复`,
      );
    const brief = `请作为布局修复 Agent，修复当前场景的以下硬伤，只做最小必要调整：
${lines.join("\n")}

要求：
1. 只移动/调整发生冲突的家具或台面物品，不移动墙体、门窗，不新增房间；
2. 对餐椅优先围绕餐桌四周布置，对台面物品优先放回宿主台面中心/安全范围；
3. 保持家具清单和风格不变，不要用“整体重做”规避问题；
4. 本次目标问题必须真正消失；若无法修复，明确告诉我原因，不要提交一个只改几毫米的候选；
5. 只能修改本次授权的 target 家具，不得把墙体/门窗 ID 当作家具。`;
    if (brief.length > 4000)
      throw new Error(
        "当前问题过多，修复说明超过任务上限；请先处理当前视图附近的问题",
      );
    const started = await chat.requestRepair(
      brief,
      repairIds,
      roomId ? [roomId] : [],
    );
    if (started)
      message(
        messages.length > 8
          ? `AI 正在处理前 ${MAX_REPAIR_ISSUES} 项（共 ${messages.length} 条唯一问题）…`
          : "AI 修复任务已提交，正在生成可检查候选…",
      );
  } catch (error) {
    fail(error);
  } finally {
    repairing = false;
  }
}
function focusRoom(room: any) {
  if (planView.centerOn) planView.centerOn(room.x, room.y);
  if (three.focusRoom) three.focusRoom(room);
}
function syncPanel() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-panel]")
    .forEach((b) => b.classList.toggle("active", b.dataset.panel === panel));
}
function updateEmptyState() {
  const blank =
    !!project &&
    collections.every((k) => project!.plan[k].length === 0) &&
    !project.roomLabelArchive.length;
  $("#empty-state").classList.toggle("is-hidden", !blank);
}
function renderSpaceNav() {
  const nav = $("#space-nav");
  if (!project) return;
  const rooms = project.plan.rooms || [];
  nav.hidden = rooms.length < 2 || rooms.length > 5;
  nav.innerHTML = rooms
    .slice(0, 8)
    .map(
      (r) =>
        `<button data-space="${esc(r.id)}">${esc(displayRoomName(r))}</button>`,
    )
    .join("");
  nav.querySelectorAll<HTMLButtonElement>("[data-space]").forEach((b) => {
    b.onclick = () => {
      const room = rooms.find((r) => r.id === b.dataset.space);
      if (room) focusRoom(room);
    };
  });
}
async function display(next: Project, frame = false) {
  project = next;
  localStorage.setItem("actiscape-project", next.id);
  const projectLabel = displayProjectName(next.plan.name);
  $("#project-name").setAttribute("value", projectLabel);
  $<HTMLInputElement>("#project-name").value = projectLabel;
  $("#revision").textContent =
    `版本 ${next.revision} · ${next.plan.furniture.length} 件家具`;
  $("#stage-room-label").textContent = projectLabel;
  $("#open-all").textContent =
    allDoorCabinetCommands(next.plan, "toggle").mode === "close"
      ? "复位门柜"
      : "一键全开检验";
  const openables = next.plan.furniture.filter(
    (f) => isOpenableFurniture(f) || isTogglableFurniture(f),
  );
  $("#openable-jump").innerHTML =
    `<option value="">可开启家具…</option>` +
    openables
      .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
      .join("");
  $("#openable-jump").hidden = openables.length === 0;
  $<HTMLButtonElement>("#undo").disabled = next.history.undo === 0;
  $<HTMLButtonElement>("#redo").disabled = next.history.redo === 0;
  if (
    selection &&
    !next.plan[selection.collection].some((o) => o.id === selection!.id)
  )
    selection = undefined;
  planView.selection = selection;
  const base = { projectId: next.id, revision: next.revision };
  planView.load(next.plan, base);
  planView.setSourceImage(next.plan.source);
  $("#source-image").hidden = next.plan.source?.kind !== "floorplan";
  if (frame) planView.frame();
  await three.rebuild(next.plan, base);
  if (frame) three.frame();
  three.highlight(
    selection?.collection === "furniture" ? selection.id : undefined,
  );
  updateSelectionActions();
  chat.mount($("#agent-host"), next.id);
  renderSpaceNav();
  updateEmptyState();
  syncPanel();
  await inspector();
  await assetLibrary();
  if (!lastFailure) saved("已保存到项目服务");
}
async function assetLibrary() {
  let host = document.querySelector("#asset-library");
  if (!host) {
    host = document.createElement("div");
    host.id = "asset-library";
    $(".library").append(host);
  }
  const assets: AssetRecord[] = await api("/assets");
  host.innerHTML = assets.length
    ? `<details open><summary>已上传模型 <small>${assets.length}</small></summary><div class="catalog-items">${assets.map((a) => `<button data-asset="${esc(a.id)}">${esc(a.name)}<small>${Math.round(a.w)} × ${Math.round(a.d)}</small></button>`).join("")}</div></details>`
    : "";
  host.querySelectorAll<HTMLButtonElement>("[data-asset]").forEach(
    (b) =>
      (b.onclick = async () => {
        const a = assets.find((a) => a.id === b.dataset.asset)!;
        if (!project) return;
        const room = project.plan.rooms[0],
          id = newId();
        await commands(
          [
            {
              type: "add",
              collection: "furniture",
              object: {
                id,
                key: `model:${a.id}`,
                type: "model",
                modelId: a.id,
                name: a.name,
                x: room?.x || 0,
                y: room?.y || 0,
                z: 0,
                rot: 0,
                w: a.w,
                d: a.d,
                h: a.h,
                color: "#ffffff",
              },
            },
          ],
          "放置已上传模型",
        );
        setSelection({ collection: "furniture", id });
      }),
  );
}
async function refresh() {
  if (!project) return;
  const seq = ++loadSequence,
    id = project.id,
    next = await api<Project>(`/projects/${id}`);
  if (seq === loadSequence && id === project?.id) await display(next);
}
let safetyTwinPlugin: ReturnType<typeof initSafetyTwinPlugin> | undefined;
async function open(next: Project) {
  events?.close();
  pendingRevision = -1;
  lastFailure = false;
  await display(next, true);
  safetyTwinPlugin?.onProjectChanged();
  const url = new URL(location.href);
  url.searchParams.set("project", next.id);
  window.history.replaceState(null, "", url);
  events = new EventSource(`/api/projects/${next.id}/events`);
  events.addEventListener("revision", (e) => {
    const rev = JSON.parse((e as MessageEvent).data).revision;
    pendingRevision = Math.max(pendingRevision, rev);
    if (!busy && project && rev > project.revision) void refresh().catch(fail);
  });
  events.onerror = () => saved("连接中断，正在重连", true);
  events.onopen = () => {
    if (!busy) void refresh().catch(fail);
  };
  message("项目已打开。选择家具开始编辑。");
}
function fail(error: unknown) {
  const e = error as Error;
  lastFailure = true;
  saved("操作未完成", true);
  message(e.message || String(error));
  console.error(error);
}
async function mutate(
  kind: "commands" | "undo" | "redo",
  items?: Command[],
  summary?: string,
  base?: EditBase,
) {
  if (!project || busy) return;
  if (base && base.projectId !== project.id) {
    await refresh().catch(fail);
    fail(new Error("项目已切换，请重新开始编辑"));
    return;
  }
  busy = true;
  lastFailure = false;
  document.body.classList.add("saving");
  saved(
    kind === "undo" ? "正在撤销…" : kind === "redo" ? "正在重做…" : "正在保存…",
  );
  const id = project.id,
    request = {
      operationId: newId(),
      baseRevision: base?.revision ?? project.revision,
      ...(items ? { commands: items } : {}),
      ...(summary ? { summary } : {}),
    };
  try {
    const result = await post<{ project?: Project }>(
      `/projects/${id}/${kind}`,
      request,
    );
    // The mutation response already contains the authoritative project. Using
    // it avoids a second GET round-trip and removes the visible undo/redo lag.
    if (result.project) await display(result.project);
    else await refresh();
    message(summary || `${kind === "undo" ? "撤销" : "重做"}完成`);
  } catch (error) {
    try {
      await refresh();
    } catch {}
    fail(error);
  } finally {
    busy = false;
    document.body.classList.remove("saving");
    if (project && pendingRevision > project.revision)
      await refresh().catch(fail);
  }
}
async function commands(items: Command[], summary: string, base?: EditBase) {
  await mutate("commands", items, summary, base);
}
function setView(mode: string, shouldFrame = true) {
  $("#viewport").dataset.mode = mode;
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  requestAnimationFrame(() => {
    planView.resize();
    planView.frame();
    three.resize();
    if (shouldFrame) three.frame();
  });
}
function renderCatalog(query = "") {
  const q = query.trim().toLowerCase();
  $("#catalog-count").textContent = String(Object.keys(catalog).length);
  $("#catalog").innerHTML = catalogGroups
    .map((group: any) => {
      const items = group.items.filter(
        (f: any) => !q || `${f.name} ${f.key}`.toLowerCase().includes(q),
      );
      return items.length
        ? `<details ${q ? "open" : ""}><summary>${esc(group.group)} <small>${items.length}</small></summary><div class="catalog-items">${items.map((f: any) => `<button data-key="${esc(f.key)}" title="${esc(f.w)} × ${esc(f.d)} × ${esc(f.h)} mm"><i style="background:${esc(f.color)}"></i><span>${esc(f.name)}</span></button>`).join("")}</div></details>`
        : "";
    })
    .join("");
  $("#catalog")
    .querySelectorAll<HTMLButtonElement>("[data-key]")
    .forEach(
      (button) =>
        (button.onclick = async () => {
          if (!project) return;
          const room = project.plan.rooms[0],
            f = createFurniture(
              button.dataset.key!,
              room?.x || 2500,
              room?.y || 2500,
            );
          await commands(
            [{ type: "add", collection: "furniture", object: f }],
            "添加 " + f.name,
          );
          setSelection({ collection: "furniture", id: f.id });
        }),
    );
}
async function upload(file: Blob, name = "model.glb"): Promise<AssetRecord> {
  const form = new FormData();
  form.append("file", file, name);
  return api("/assets", { method: "POST", body: form });
}
interface AssetGeneration {
  job: {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    provider: "real-cache" | "remote-gpu" | "demo";
    name: string;
    assetId?: string;
    cached?: boolean;
    fallback?: boolean;
    remoteError?: string;
    error?: string;
  };
  asset?: AssetRecord;
  cached?: boolean;
  pollUrl?: string;
}

async function importPhotoAsset(file: File) {
  const target = project;
  if (!target) return;
  const dialog = $<HTMLDialogElement>("#dialog"),
    body = $("#dialog-body");
  if (dialog.open) dialog.close();
  body.innerHTML = `<h2>照片转 3D</h2><p>${esc(file.name)}</p><p id="photo-progress" class="muted">正在提交照片…</p>`;
  dialog.showModal();
  saved("正在生成 3D 资产…");
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("name", file.name.replace(/\.[^.]+$/, "") || "照片物品");
    let result = await api<AssetGeneration>("/assets/generate-from-image", {
      method: "POST",
      body: form,
    });
    if (result.job.status !== "succeeded" && result.job.id)
      result = await waitPhotoJob(result.job.id);
    if (!result.asset) throw new Error("资产服务没有返回可用模型");
    showPhotoPreview(result.asset, result.job, target, file);
  } catch (error) {
    body.innerHTML = `<h2>照片转 3D 未完成</h2><p class="muted">${esc((error as Error).message)}</p><p class="muted">可继续手工编辑；没有写入正式场景。</p>`;
    saved("资产生成未完成", true);
  }
}

async function waitPhotoJob(jobId: string): Promise<AssetGeneration> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await api<AssetGeneration>(`/assets/jobs/${jobId}`);
    const progress = document.querySelector("#photo-progress");
    if (progress)
      progress.textContent =
        result.job.status === "queued"
          ? "已排队，等待 GPU…"
          : result.job.status === "running"
            ? "GPU 正在生成模型…"
            : "正在接收模型…";
    if (result.job.status === "succeeded") return result;
    if (result.job.status === "failed")
      throw new Error(result.job.error || "远端 GPU 生成失败");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("资产任务等待超时，请稍后在资产库查看");
}

function surfaceSpot(host: any, asset: AssetRecord, plan: Plan) {
  const halfW = asset.w / 2,
    halfD = asset.d / 2,
    x0 = host.x - host.w / 2 + 20,
    x1 = host.x + host.w / 2 - 20,
    y0 = host.y - host.d / 2 + 20,
    y1 = host.y + host.d / 2 - 20,
    siblings = plan.furniture.filter((f) => f.parentObjectId === host.id),
    offsets = [
      [0, 0],
      [0.35, 0],
      [-0.35, 0],
      [0, 0.28],
      [0, -0.28],
      [0.35, 0.28],
      [-0.35, 0.28],
      [0.35, -0.28],
      [-0.35, -0.28],
    ];
  for (const [ox, oy] of offsets) {
    const x = host.x + host.w * ox,
      y = host.y + host.d * oy,
      item = {
        x0: x - halfW,
        x1: x + halfW,
        y0: y - halfD,
        y1: y + halfD,
      };
    if (item.x0 < x0 || item.x1 > x1 || item.y0 < y0 || item.y1 > y1) continue;
    const overlap = siblings.some((sibling) => {
      const b = rotatedAabb(sibling);
      return (
        Math.min(item.x1, b.x1) - Math.max(item.x0, b.x0) > 20 &&
        Math.min(item.y1, b.y1) - Math.max(item.y0, b.y0) > 20
      );
    });
    if (!overlap) return { x, y };
  }
  return { x: host.x, y: host.y };
}

function showPhotoPreview(
  asset: AssetRecord,
  job: AssetGeneration["job"],
  target: Project,
  file: File,
) {
  const body = $("#dialog-body"),
    dialog = $<HTMLDialogElement>("#dialog"),
    provider =
      job.provider === "real-cache"
        ? "真实 V100 缓存，秒级命中"
        : job.provider === "remote-gpu"
          ? "远端 GPU 生成"
          : "演示资产（队友 GPU 服务接入后自动切换真实生成）",
    hosts = target.plan.furniture.filter(isSurfaceHost),
    fitting = hosts.filter(
      (host) => host.w >= asset.w + 20 && host.d >= asset.d + 20,
    ),
    selected =
      selection?.collection === "furniture" &&
      fitting.some((host) => host.id === selection!.id)
        ? selection!.id
        : fitting[0]?.id || "",
    url = URL.createObjectURL(file);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  body.innerHTML = `<h2>照片物品已生成</h2>
    <p class="muted">${esc(job.name || asset.name)} · ${esc(provider)}${job.fallback ? " · 远端失败已回退演示资产" : ""}</p>
    <div class="photo-preview"><img src="${url}" alt="物品照片预览"><div>
      <p>当前模型尺寸：<b>${Math.round(asset.w)} × ${Math.round(asset.d)} × ${Math.round(asset.h)} mm</b></p>
      <label>确认真实高度（mm）<input id="photo-height" type="number" min="10" max="5000" step="10" value="${Math.round(asset.h)}"></label>
      <label>放置位置<select id="photo-host"><option value="">地面</option>${fitting
        .map(
          (host) =>
            `<option value="${esc(host.id)}" ${host.id === selected ? "selected" : ""}>${esc(host.name)}（台面 ${Math.round(host.w)}×${Math.round(host.d)}，高 ${Math.round(host.h)}）</option>`,
        )
        .join("")}</select></label>
      <p class="muted">台面物品会自动设置 z = 台面高程 + 宿主高度；没有合适台面时放到地面。</p>
    </div></div>
    <p id="photo-error" class="muted"></p>
    <button id="place-photo" class="primary">校准并放入场景</button>`;
  $("#place-photo").onclick = async () => {
    const height = Number($<HTMLInputElement>("#photo-height").value),
      hostId = $<HTMLSelectElement>("#photo-host").value;
    if (!Number.isFinite(height) || height < 10 || height > 5000) {
      $("#photo-error").textContent = "请输入 10–5000 mm 的真实高度";
      return;
    }
    try {
      saved("正在校准尺寸…");
      const calibrated = (
        await post<{ asset: AssetRecord }>(
          `/assets/${encodeURIComponent(asset.id)}/calibrate`,
          { targetHeightMm: height },
        )
      ).asset;
      const host = hostId
          ? target.plan.furniture.find((f) => f.id === hostId)
          : undefined,
        room = target.plan.rooms[0],
        spot = host
          ? surfaceSpot(host, calibrated, target.plan)
          : { x: room?.x ?? 0, y: room?.y ?? 0 },
        id = newId(),
        object = {
          id,
          key: `model:${calibrated.id}`,
          type: "model",
          modelId: calibrated.id,
          name: calibrated.name,
          x: spot.x,
          y: spot.y,
          z: host ? (host.z || 0) + host.h : 0,
          rot: 0,
          w: calibrated.w,
          d: calibrated.d,
          h: calibrated.h,
          color: "#ffffff",
          placement: host ? "surface" : "floor",
          ...(host ? { parentObjectId: host.id } : {}),
        };
      await commands(
        [{ type: "add", collection: "furniture", object }],
        "照片物品入场",
      );
      dialog.close();
      setSelection({ id, collection: "furniture" });
      message(
        `已把 ${calibrated.name} 放到${host ? host.name + "台面" : "地面"}上，可在属性面板继续调整。`,
      );
    } catch (error) {
      $("#photo-error").textContent = (error as Error).message;
    }
  };
}

async function importDoc(document: any, assetMap: Record<string, string> = {}) {
  try {
    await open(await post("/projects", { document, assetMap }));
    $<HTMLDialogElement>("#dialog").close();
  } catch (error) {
    if (error instanceof ApiError && error.code === "MISSING_ASSETS") {
      const missing: string[] = error.details.missing;
      $("#dialog-body").innerHTML =
        `<h2>补齐模型文件</h2><p>此项目引用了 ${missing.length} 个尚未上传的模型。逐项选择对应 GLB，确认映射后完成导入。</p>${missing.map((id, i) => `<label class="mapping">${esc(id)}<input type="file" accept=".glb" data-missing="${i}"></label>`).join("")}<button id="confirm-mapping" class="primary">上传并确认映射</button><p id="mapping-error"></p>`;
      $<HTMLDialogElement>("#dialog").showModal();
      $("#confirm-mapping").onclick = async () => {
        try {
          for (let i = 0; i < missing.length; i++) {
            const file = $<HTMLInputElement>(`[data-missing="${i}"]`)
              .files?.[0];
            if (!file) throw new Error("每个缺失引用都需要对应 GLB");
            assetMap[missing[i]] = (await upload(file, file.name)).id;
          }
          await importDoc(document, assetMap);
        } catch (e) {
          $("#mapping-error").textContent = (e as Error).message;
        }
      };
    } else fail(error);
  }
}
async function examples(name: string) {
  const doc = await api(`/examples/${name}`);
  if (name === "glb-display") {
    const file = await fetch("/api/example-asset").then((r) => r.blob()),
      asset = await upload(file, "textured-vase.glb");
    await importDoc(doc, { "fixture-vase": asset.id });
  } else await importDoc(doc);
}
async function openProjectGallery(welcome = false) {
  try {
    if (!project) {
      $<HTMLInputElement>("#project-name").value = "";
      $("#save-state").textContent = "请选择或新建空间";
    }
    const projects = (await api<any[]>("/projects")).filter(
      (p) =>
        !(p.name || "").startsWith("Evaluation only:") &&
        (p.revision > 0 || p.id === project?.id),
    );
    const intro = welcome
      ? `<div class="dialog-kicker">WELCOME TO ACTISCAPE</div><h2>从一个空间开始</h2><p class="muted">选择一个已有项目，或从精修样例开始。你也可以先新建一个空白空间。</p>`
      : `<div class="dialog-kicker">YOUR SPACES</div><h2>打开项目</h2><p class="muted">继续一个空间，或从精修样例开始。</p>`;
    $("#dialog-body").innerHTML =
      `${intro}<div class="project-gallery">${projects.map((p: any, i: number) => `<button data-project="${esc(p.id)}" class="project-card"><span class="project-cover cover-${i % 4}"><span>${esc(displayProjectName(p.name).slice(0, 2))}</span><i></i></span><strong>${esc(displayProjectName(p.name))}</strong><small>版本 ${p.revision} · ${new Date(p.updatedAt).toLocaleDateString("zh-CN")}</small></button>`).join("")}</div><h3 class="gallery-heading">精修样例</h3><div class="actions"><button data-example="living-dining">客餐厅</button><button data-example="full-home-showcase">全屋样板间</button><button data-example="modeling-gallery">家具展台</button><button data-example="glb-display">GLB 展台</button></div><div class="actions"><button id="gallery-new-project" class="primary">新建空白空间</button></div>`;
    $("#dialog-body")
      .querySelectorAll<HTMLButtonElement>("[data-project]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await open(await api(`/projects/${b.dataset.project}`));
              $<HTMLDialogElement>("#dialog").close();
            } catch (e) {
              fail(e);
            }
          }),
      );
    $("#dialog-body")
      .querySelectorAll<HTMLButtonElement>("[data-example]")
      .forEach(
        (b) =>
          (b.onclick = () => void examples(b.dataset.example!).catch(fail)),
      );
    $("#gallery-new-project").onclick = () => {
      $<HTMLDialogElement>("#dialog").close();
      void newProject().catch(fail);
    };
    $<HTMLDialogElement>("#dialog").showModal();
  } catch (e) {
    fail(e);
  }
}
async function newProject() {
  const next = await post<Project>("/projects", {});
  await open(next);
  panel = "overview";
  syncPanel();
  chat.focus();
  await inspector();
}
$("#open-project").onclick = () => void openProjectGallery(false);
$("#close-dialog").onclick = () => $<HTMLDialogElement>("#dialog").close();
$("#new-project").onclick = () => void newProject().catch(fail);
$("#save-project").onclick = () => {
  lastFailure = false;
  void refresh()
    .then(() => message("场景与撤销历史已保存"))
    .catch(fail);
};
$("#export-project").onclick = () => {
  if (project) window.location.href = `/api/projects/${project.id}/export`;
};
function currentSnapshot() {
  if (!project) return undefined;
  const mode = $("#viewport").dataset.mode;
  const source =
    mode === "3d"
      ? three.renderer.domElement
      : mode === "2d"
        ? planView.canvas
        : three.renderer.domElement;
  if (!source) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f3efe7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return {
    canvas,
    name: displayProjectName(project.plan.name),
    revision: project.revision,
    mode,
  };
}
function download(name: string, url: string) {
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  link.click();
}
$("#export-image").onclick = () => {
  const shot = currentSnapshot();
  if (!shot) return;
  download(
    `${shot.name.replace(/[\\/:*?"<>|]/g, "-")}-v${shot.revision}.png`,
    shot.canvas.toDataURL("image/png"),
  );
  message("当前视图已导出为 PNG");
};
$("#export-pdf").onclick = () => {
  const shot = currentSnapshot();
  if (!shot) return;
  const win = window.open("", "_blank");
  if (!win) {
    message("浏览器拦截了打印窗口，请允许弹出窗口");
    return;
  }
  const data = shot.canvas.toDataURL("image/png");
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(shot.name)} · 演境</title><style>@page{size:A4;margin:12mm}body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1e2724;margin:0}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #d9d1c4;padding-bottom:8px;margin-bottom:14px}h1{font-size:22px;margin:0}small{color:#81796c}img{display:block;width:100%;height:auto;border:1px solid #d9d1c4;border-radius:6px}p{color:#81796c;font-size:10px;margin-top:10px}</style></head><body><header><div><small>演境 ACTISCAPE · AI DESIGN</small><h1>${esc(shot.name)}</h1></div><small>版本 ${shot.revision} · ${new Date().toLocaleDateString("zh-CN")}</small></header><img src="${data}"><p>由演境 AI Studio 生成 · 当前视图 · ${shot.mode === "3d" ? "三维" : "二维"}</p><script>window.onload=()=>window.print()</script></body></html>`,
  );
  win.document.close();
};
$("#import-project").onclick = () => $<HTMLInputElement>("#json-file").click();
$<HTMLInputElement>("#json-file").onchange = async (e) => {
  try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await importDoc(JSON.parse(await file.text()));
  } catch (e) {
    fail(e);
  }
};
$("#upload-model").onclick = () => $<HTMLInputElement>("#glb-file").click();
$("#upload-photo").onclick = () => $<HTMLInputElement>("#photo-file").click();
$<HTMLInputElement>("#photo-file").onchange = async (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (file) await importPhotoAsset(file);
};
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement)?.closest?.("[data-photo-import]"))
    $<HTMLInputElement>("#photo-file").click();
});
$<HTMLInputElement>("#glb-file").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  try {
    const file = input.files?.[0];
    if (!file || !project) return;
    const target = project;
    saved("正在保存模型…");
    const asset = await upload(file, file.name),
      room = target.plan.rooms[0],
      id = newId();
    await commands(
      [
        {
          type: "add",
          collection: "furniture",
          object: {
            id,
            key: `model:${asset.id}`,
            type: "model",
            name: file.name.replace(/\.glb$/i, ""),
            modelId: asset.id,
            x: room?.x || 0,
            y: room?.y || 0,
            z: 0,
            rot: 0,
            w: asset.w,
            d: asset.d,
            h: asset.h,
            color: "#ffffff",
          },
        },
      ],
      "导入 GLB 模型",
      { projectId: target.id, revision: target.revision },
    );
    setSelection({ collection: "furniture", id });
  } catch (e) {
    fail(e);
  } finally {
    input.value = "";
  }
};
$("#project-name").onchange = () =>
  void commands(
    [
      {
        type: "project",
        patch: { name: $<HTMLInputElement>("#project-name").value },
      },
    ],
    "修改项目名称",
  );
$("#catalog-search").oninput = () =>
  renderCatalog($<HTMLInputElement>("#catalog-search").value);
$("#undo").onclick = () => void mutate("undo");
$("#redo").onclick = () => void mutate("redo");
$("#source-image").onclick = () => {
  planView.sourceImageVisible = !planView.sourceImageVisible;
  $("#source-image").textContent = planView.sourceImageVisible
    ? "隐藏原图"
    : "显示原图";
  planView.draw();
};
$("#frame").onclick = () => {
  planView.frame();
  three.frame();
};
$("#open-structure").onclick = () => {
  const open = document.body.classList.toggle("structure-open");
  $("#open-structure").textContent = open ? "收起结构工具" : "结构编辑（高级）";
};
$("#open-catalog").onclick = openCatalog;
$("#close-catalog").onclick = closeCatalog;
$("#close-catalog-scrim").onclick = closeCatalog;
$("#mobile-agent").onclick = () => {
  $("#context-panel").classList.remove("open");
  $("#agent-rail").classList.toggle("mobile-open");
};
$("#context-toggle").onclick = () => {
  $("#agent-rail").classList.remove("mobile-open");
  $("#context-panel").classList.toggle("open");
};
$("#context-close").onclick = () =>
  $("#context-panel").classList.remove("open");
$("#empty-prompt").onclick = () => {
  if (!project)
    void newProject()
      .then(() => chat.focus())
      .catch(fail);
  else chat.focus();
};
$("#empty-floorplan").onclick = () => {
  if (!project)
    void newProject()
      .then(() => chat.openFloorplan())
      .catch(fail);
  else chat.openFloorplan();
};
$("#empty-example").onclick = () => $("#open-project").click();
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
    e.preventDefault();
    chat.focus();
  }
  if (e.code === "Escape" && !$("#catalog-drawer").hidden) {
    e.preventDefault();
    closeCatalog();
  }
});
$("#structural-toggle").onclick = () => {
  const tools = $(".tools");
  const open = tools.classList.toggle("open");
  $("#structural-toggle").textContent = open ? "收起工具" : "结构工具";
  $("#structural-toggle").classList.toggle("active", open);
};
$("#openable-jump").onchange = () => {
  const id = $<HTMLSelectElement>("#openable-jump").value;
  if (!id || !project) return;
  const f = project.plan.furniture.find((x) => x.id === id);
  if (!f) return;
  setView("3d", false);
  setSelection({ id, collection: "furniture" });
  three.focusFurniture(id);
  message(`已定位 ${f.name}；按 E 或点“打开柜门”即可操作。`);
};
$("#selection-toggle").onclick = () => {
  if (
    !selection ||
    (selection.collection !== "furniture" &&
      selection.collection !== "openings")
  )
    return;
  const ok = three.toggleInteractive(selection.id, selection.collection);
  if (!ok) message("该对象没有可开启的柜门、抽屉或电器状态");
};
$("#walk").onclick = () => {
  const entering = !three.walking;
  // Do not let the normal view framing overwrite the walk camera on the next
  // animation frame; that made the button look unresponsive.
  setView("3d", false);
  three.setWalking(entering);
};
$("#open-all").onclick = async () => {
  if (!project || busy) return;
  const next = allDoorCabinetCommands(project.plan, "toggle");
  if (!next.commands.length) {
    message(next.mode === "open" ? "所有门/柜门已打开" : "所有门/柜门已复位");
    return;
  }
  panel = "checks";
  document
    .querySelectorAll<HTMLButtonElement>("[data-panel]")
    .forEach((b) => b.classList.toggle("active", b.dataset.panel === "checks"));
  await commands(
    next.commands,
    next.mode === "open"
      ? "一键开启全部门与柜门，检验开启净空"
      : "复位全部门与柜门",
  );
  message(
    next.mode === "open"
      ? "已打开全部门/柜门，检查面板列出开启净空问题"
      : "已复位全部门/柜门",
  );
};
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(
  (b) =>
    (b.onclick = () => {
      planView.setTool(b.dataset.tool!);
      document
        .querySelectorAll("[data-tool]")
        .forEach((t) => t.classList.toggle("active", t === b));
    }),
);
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach(
  (b) =>
    (b.onclick = () => {
      if (b.dataset.panel === "chat") {
        chat.focus();
        return;
      }
      panel = b.dataset.panel!;
      syncPanel();
      void inspector().catch(fail);
    }),
);
window.addEventListener("keydown", async (e) => {
  if (
    /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) ||
    three.walking
  )
    return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    await mutate(e.shiftKey ? "redo" : "undo");
    return;
  }
  if (e.code === "Escape") {
    planView.setTool("select");
    setSelection();
    return;
  }
  if (!selection || !project) return;
  if (e.code === "Delete" || e.code === "Backspace") {
    e.preventDefault();
    if (!(await planView.deleteVertex()))
      await commands([{ type: "delete", ...selection }], "删除对象");
  }
  if (mod && e.code === "KeyD") {
    e.preventDefault();
    await commands([{ type: "duplicate", ...selection }], "复制对象");
  }
  if (e.code === "KeyR" && selection.collection === "furniture") {
    const f = project.plan.furniture.find((f) => f.id === selection!.id)!;
    await commands(
      [{ type: "update", ...selection, patch: { rot: (f.rot + 90) % 360 } }],
      "旋转对象",
    );
  }
});
// Read-only instrumentation for acceptance and integrations; edits still use HTTP commands.
if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug"))
  (window as any).__actiscape = {
    get project() {
      return clone(project);
    },
    get busy() {
      return busy;
    },
    planView,
    three,
    select: setSelection,
    createFurniture,
    catalog,
    buildFurniture: (f: any, p?: Plan) => Ov(f, p),
    drawFurniture: Fh,
    THREE,
  };
safetyTwinPlugin = initSafetyTwinPlugin({
  three,
  getProject: () => project,
  openProject: open,
  setViewMode: (m) => setView(m, false),
  setSelectionIds: (ids) => {
    if (ids[0]) setSelection({ id: ids[0], collection: "furniture" });
  },
  notifyMessage: message,
});
renderCatalog();
try {
  const params = new URLSearchParams(location.search);
  const requestedProject = params.get("project");
  const requestedExample = params.get("example");
  const id = requestedProject || localStorage.getItem("actiscape-project");
  if (id) {
    try {
      await open(await api(`/projects/${id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && !requestedProject) {
        localStorage.removeItem("actiscape-project");
        await openProjectGallery(true);
      } else throw e;
    }
  } else if (requestedExample) await examples(requestedExample);
  else await openProjectGallery(true);
} catch (e) {
  fail(e);
}
