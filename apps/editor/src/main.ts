import "./style.css";
import { api, post, ApiError, type EditBase } from "./api.js";
import {
  catalogGroups,
  catalog,
  createFurniture,
  clone,
  newId,
  type Project,
  type Command,
  type AssetRecord,
  type Plan,
} from "../../../packages/scene-core/src/index.js";
import { PlanView, type Selection } from "./views/plan-view.js";
import { ThreeView } from "./views/three-view.js";
import { renderInspector, esc } from "./ui/inspector.js";
import { ChatPanel } from "./ui/chat.js";
import { Ov } from "./modeling/furniture-3d.js";
import { Fh } from "./modeling/furniture-2d.js";
import * as THREE from "three";
const root = document.querySelector("#app")!;
root.innerHTML = `<header><div class="brand">演境 <span>ActiScape</span></div><input id="project-name" aria-label="项目名称"><span id="save-state" role="status">连接项目服务…</span><div class="header-actions"><button id="new-project">新建</button><button id="open-project">打开项目</button><button id="import-project">导入 JSON</button><button id="export-project">导出</button><button id="save-project" class="primary">保存</button></div></header>
<div class="toolbar"><div class="tools"><button data-tool="select" class="active">选择</button><button data-tool="wall">墙体</button><button data-tool="opening:door">门</button><button data-tool="opening:window">窗</button><button data-tool="struct:column">柱</button><button data-tool="beam">梁</button><button data-tool="room">房间</button><button data-tool="measure">尺寸</button></div><div class="view-switch"><button data-view="2d" class="active">二维</button><button data-view="split">分屏</button><button data-view="3d">三维</button></div><button id="frame">适应视图</button><button id="walk">漫游</button><button id="undo" title="Ctrl Z">撤销</button><button id="redo" title="Ctrl Shift Z">重做</button></div>
<main><aside class="library"><div class="side-heading">家具与模型 <span id="catalog-count"></span></div><input id="catalog-search" placeholder="搜索家具 / 造型" aria-label="搜索家具"><button id="upload-model" class="wide primary subtle">＋ 导入 GLB 模型</button><div id="catalog"></div></aside><div id="viewport" data-mode="2d"><div id="plan-view"></div><div id="three-view"></div><div class="view-caption">单层设计 · mm</div></div><aside class="inspector"><nav><button data-panel="properties" class="active">属性</button><button data-panel="history">历史</button><button data-panel="checks">检查</button><button data-panel="chat">对话</button></nav><div id="inspector-body"></div></aside></main><footer><span id="message" role="status">正在载入…</span><span id="revision"></span></footer><input id="json-file" type="file" accept=".json,application/json" hidden><input id="glb-file" type="file" accept=".glb" hidden><dialog id="dialog"><div id="dialog-body"></div><button id="close-dialog">关闭</button></dialog>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let project: Project | undefined,
  selection: Selection | undefined,
  busy = false,
  panel = "properties",
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
);
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
      selectedIds: current?.collection === "furniture" ? [current.id] : [],
      selectionLabel:
        current?.collection === "furniture"
          ? project?.plan.furniture.find((f) => f.id === current.id)?.name
          : undefined,
    };
  },
  async (id) => {
    if (project?.id === id) await refresh();
  },
);
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
function setSelection(s?: Selection) {
  selection = s;
  planView.selection = s;
  planView.vertex = -1;
  planView.draw();
  three.highlight(s?.collection === "furniture" ? s.id : undefined);
  void inspector().catch(fail);
}
async function inspector() {
  if (!project) return;
  const sequence = ++inspectorSequence;
  const host = $("#inspector-body");
  if (panel === "chat") {
    chat.mount(host, project.id);
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
    host.innerHTML = `<h2>场景检查</h2><p class="muted">版本 ${data.revision} · ${data.issues.length} 项提示</p>${data.issues.map((i: any) => `<button class="issue" data-id="${esc(i.objectIds[0])}">${esc(i.message)}</button>`).join("") || "<p>当前检查未发现问题。</p>"}<h3>检查范围</h3><p class="muted">${data.coverage.map(esc).join("<br>")}</p><p class="muted">${data.limitations.map(esc).join("<br>")}</p>`;
    host.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(
      (b) =>
        (b.onclick = () => {
          panel = "properties";
          setSelection({ collection: "furniture", id: b.dataset.id! });
        }),
    );
  }
}
async function display(next: Project, frame = false) {
  project = next;
  localStorage.setItem("actiscape-project", next.id);
  $("#project-name").setAttribute("value", next.plan.name);
  $<HTMLInputElement>("#project-name").value = next.plan.name;
  $("#revision").textContent =
    `版本 ${next.revision} · ${next.plan.furniture.length} 件家具`;
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
  if (frame) planView.frame();
  await three.rebuild(next.plan, base);
  if (frame) three.frame();
  three.highlight(
    selection?.collection === "furniture" ? selection.id : undefined,
  );
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
async function open(next: Project) {
  events?.close();
  pendingRevision = -1;
  lastFailure = false;
  await display(next, true);
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
  saved("正在保存…");
  const id = project.id,
    request = {
      operationId: newId(),
      baseRevision: base?.revision ?? project.revision,
      ...(items ? { commands: items } : {}),
      ...(summary ? { summary } : {}),
    };
  try {
    await post(`/projects/${id}/${kind}`, request);
    await refresh();
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
function setView(mode: string) {
  $("#viewport").dataset.mode = mode;
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  requestAnimationFrame(() => {
    planView.resize();
    planView.frame();
    three.resize();
    three.frame();
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
$("#open-project").onclick = async () => {
  try {
    const projects = await api("/projects");
    $("#dialog-body").innerHTML =
      `<h2>打开项目</h2><div class="project-list">${projects.map((p: any) => `<button data-project="${esc(p.id)}">${esc(p.name)} <small>版本 ${p.revision}</small></button>`).join("")}</div><h3>从固定样例开始</h3><div class="actions"><button data-example="living-dining">客餐厅</button><button data-example="modeling-gallery">家具与建模展台</button><button data-example="glb-display">GLB 展台</button></div>`;
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
    $<HTMLDialogElement>("#dialog").showModal();
  } catch (e) {
    fail(e);
  }
};
$("#close-dialog").onclick = () => $<HTMLDialogElement>("#dialog").close();
$("#new-project").onclick = () =>
  void post("/projects", {}).then(open).catch(fail);
$("#save-project").onclick = () => {
  lastFailure = false;
  void refresh()
    .then(() => message("场景与撤销历史已保存"))
    .catch(fail);
};
$("#export-project").onclick = () => {
  if (project) window.location.href = `/api/projects/${project.id}/export`;
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
$("#frame").onclick = () => {
  planView.frame();
  three.frame();
};
$("#walk").onclick = () => {
  setView("3d");
  three.setWalking(!three.walking);
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
      panel = b.dataset.panel!;
      document
        .querySelectorAll("[data-panel]")
        .forEach((t) => t.classList.toggle("active", t === b));
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
renderCatalog();
try {
  const requestedProject = new URLSearchParams(location.search).get("project");
  const id = requestedProject || localStorage.getItem("actiscape-project");
  if (id) {
    try {
      await open(await api(`/projects/${id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && !requestedProject)
        await examples("living-dining");
      else throw e;
    }
  } else await examples("living-dining");
} catch (e) {
  fail(e);
}
