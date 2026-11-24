import { post, toolToken } from "../api.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

export interface HybridDraftState {
  imageId: string;
  vlm: {
    scaleInfo?: { outerWidthMm?: number | null; outerDepthMm?: number | null };
    rooms: Array<{
      name: string;
      kind?: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      annotatedWidthMm?: number | null;
      annotatedDepthMm?: number | null;
      annotatedAreaM2?: number | null;
    }>;
    openings: Array<{
      type: "door" | "sliding" | "window";
      x: number;
      y: number;
      span?: number;
      orient?: "h" | "v";
    }>;
    furniture?: Array<{ key?: string; category?: string; x: number; y: number; rot?: number }>;
  };
  previewSpec?: any;
  meta?: any;
}

type ToolMode = "inspect" | "door" | "sliding" | "window" | "erase-opening";

export function openHybridFloorplanReview(
  taskId: string,
  draft: HybridDraftState,
  onConfirm: (vlm: HybridDraftState["vlm"]) => Promise<void>,
) {
  const vlm: HybridDraftState["vlm"] = JSON.parse(JSON.stringify(draft.vlm || { rooms: [], openings: [], furniture: [] }));
  vlm.scaleInfo = vlm.scaleInfo || {};
  vlm.rooms = Array.isArray(vlm.rooms) ? vlm.rooms : [];
  vlm.openings = Array.isArray(vlm.openings) ? vlm.openings : [];

  let spec = draft.previewSpec;
  let meta = draft.meta || {};
  let tool: ToolMode = "inspect";
  let previewing = false;
  let submitting = false;

  const dialog = el("dialog", undefined, "hybrid-review-dialog");
  const head = el("div", undefined, "hybrid-review-head");
  const titleWrap = el("div");
  titleWrap.append(
    el("h3", "📐 原图与识别草稿并排校对"),
    el("p", "生成 3D 前请核对总尺寸、增删门窗与房间连通性；确认后系统将自动立起 3D 墙体并布置家具。", "muted"),
  );
  const closeBtn = el("button", "✕", "quiet");
  closeBtn.type = "button";
  head.append(titleWrap, closeBtn);

  // Controls strip: outer dimensions + opening tools + connectivity status
  const bar = el("div", undefined, "hybrid-review-bar");
  const dimsGroup = el("div", undefined, "hybrid-review-group");
  const wInput = el("input");
  wInput.type = "number";
  wInput.step = "100";
  wInput.min = "2500";
  wInput.max = "35000";
  wInput.value = String(Math.round(vlm.scaleInfo.outerWidthMm || meta.totalWidthMm || 10000));
  const dInput = el("input");
  dInput.type = "number";
  dInput.step = "100";
  dInput.min = "2500";
  dInput.max = "35000";
  dInput.value = String(Math.round(vlm.scaleInfo.outerDepthMm || meta.totalDepthMm || 10000));
  const applyDimsBtn = el("button", "应用尺寸");
  applyDimsBtn.type = "button";
  dimsGroup.append(
    el("label", "总宽(mm)"),
    wInput,
    el("label", "总深(mm)"),
    dInput,
    applyDimsBtn,
  );

  const toolGroup = el("div", undefined, "hybrid-review-group");
  const toolButtons: Array<{ mode: ToolMode; btn: HTMLButtonElement }> = [];
  for (const [mode, label] of [
    ["inspect", "浏览"],
    ["door", "+ 房门"],
    ["sliding", "+ 推拉门"],
    ["window", "+ 窗户"],
    ["erase-opening", "删门窗"],
  ] as Array<[ToolMode, string]>) {
    const b = el("button", label, mode === tool ? "active" : "");
    b.type = "button";
    b.onclick = () => {
      tool = mode;
      for (const item of toolButtons) {
        item.btn.classList.toggle("active", item.mode === tool);
      }
      draftCanvas.style.cursor = tool === "inspect" ? "default" : "crosshair";
      statusTip.textContent =
        tool === "inspect"
          ? "左侧为原图叠加框，右侧为焊接后的正交草稿。点击工具栏可在右侧草稿墙体上增删门窗。"
          : tool === "erase-opening"
            ? "点击右侧草稿中的门或窗即可删除。"
            : `点击右侧草稿中任意墙体位置即可添加「${label.replace("+ ", "")}」。`;
    };
    toolButtons.push({ mode, btn: b });
    toolGroup.append(b);
  }

  const connBadge = el("span", "", "hybrid-conn-badge");
  bar.append(dimsGroup, toolGroup, connBadge);

  // Side-by-side panes: Left original image + overlay, Right compiled draft vector canvas + room list
  const panes = el("div", undefined, "hybrid-review-panes");

  const leftPane = el("div", undefined, "hybrid-pane");
  leftPane.append(el("div", "原始户型图（叠加识别房间与门窗位置）", "hybrid-pane-title"));
  const imgStage = el("div", undefined, "hybrid-img-stage");
  const img = el("img");
  const tok = toolToken();
  img.src = `/api/floorplan-images/${encodeURIComponent(draft.imageId)}/file${tok ? `?token=${encodeURIComponent(tok)}` : ""}`;
  img.alt = "上传的原始户型图";
  const overlayCanvas = el("canvas", undefined, "hybrid-overlay-canvas");
  imgStage.append(img, overlayCanvas);
  leftPane.append(imgStage);

  const rightPane = el("div", undefined, "hybrid-pane");
  rightPane.append(el("div", "正交焊接草稿预览（点击墙体可增删门窗）", "hybrid-pane-title"));
  const draftCanvas = el("canvas", undefined, "hybrid-draft-canvas");
  draftCanvas.width = 640;
  draftCanvas.height = 540;
  rightPane.append(draftCanvas);

  const roomSide = el("div", undefined, "hybrid-room-side");
  roomSide.append(el("div", "识别房间清单（可改名或删除多余空腔）", "hybrid-pane-title"));
  const roomList = el("div", undefined, "hybrid-room-list");
  roomSide.append(roomList);

  panes.append(leftPane, rightPane, roomSide);

  const statusTip = el(
    "p",
    "左侧为原图叠加框，右侧为焊接后的正交草稿。请核对总宽/总深、门窗数量与房间连通状态。",
    "muted hybrid-review-tip",
  );

  const footer = el("div", undefined, "hybrid-review-footer");
  const cancelBtn = el("button", "暂不生成");
  cancelBtn.type = "button";
  const confirmBtn = el("button", "✅ 确认结构并自动布置 3D 家具", "primary");
  confirmBtn.type = "button";
  footer.append(cancelBtn, confirmBtn);

  dialog.append(head, bar, panes, statusTip, footer);
  document.body.append(dialog);

  // Coordinate mapping for right draft canvas (mm -> canvas px)
  let transform = { minX: 0, minY: 0, spanX: 10000, spanY: 10000, scale: 0.05, ox: 40, oy: 40 };

  const updateConnBadge = () => {
    const disc: string[] = Array.isArray(meta?.disconnectedRooms) ? meta.disconnectedRooms : [];
    const totalW = ((meta?.totalWidthMm || 0) / 1000).toFixed(2);
    const totalD = ((meta?.totalDepthMm || 0) / 1000).toFixed(2);
    if (disc.length > 0) {
      connBadge.className = "hybrid-conn-badge warn";
      connBadge.textContent = `⚠️ ${disc.length} 处未连通（${disc.join("、")}） · ${totalW}m × ${totalD}m · ${meta?.openingCount || 0} 门窗`;
    } else {
      connBadge.className = "hybrid-conn-badge ok";
      connBadge.textContent = `✅ ${meta?.roomCount || vlm.rooms.length} 空间已连通 · ${totalW}m × ${totalD}m · ${meta?.openingCount || 0} 门窗`;
    }
  };

  const drawOverlay = () => {
    const w = img.clientWidth || 460;
    const h = img.clientHeight || 460;
    if (w < 10 || h < 10) return;
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    const ctx = overlayCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    for (const r of vlm.rooms) {
      const x = (r.x1 / 1000) * w;
      const y = (r.y1 / 1000) * h;
      const rw = ((r.x2 - r.x1) / 1000) * w;
      const rh = ((r.y2 - r.y1) / 1000) * h;
      ctx.fillStyle = "rgba(184, 97, 60, 0.14)";
      ctx.strokeStyle = "#b8613c";
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
      ctx.fillStyle = "#1e2724";
      ctx.font = '600 12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.name || "房间", x + rw / 2, y + rh / 2);
    }
    for (const op of vlm.openings) {
      const ox = (op.x / 1000) * w;
      const oy = (op.y / 1000) * h;
      ctx.beginPath();
      ctx.arc(ox, oy, 5, 0, Math.PI * 2);
      ctx.fillStyle = op.type === "window" ? "#0284c7" : op.type === "sliding" ? "#0d9488" : "#d97706";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  const drawDraft = () => {
    const ctx = draftCanvas.getContext("2d")!;
    const W = draftCanvas.width;
    const H = draftCanvas.height;
    ctx.fillStyle = "#f7f3eb";
    ctx.fillRect(0, 0, W, H);
    const walls = spec?.walls || [];
    if (!walls.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.a[0], w.b[0]);
      minY = Math.min(minY, w.a[1], w.b[1]);
      maxX = Math.max(maxX, w.a[0], w.b[0]);
      maxY = Math.max(maxY, w.a[1], w.b[1]);
    }
    const spanX = Math.max(1000, maxX - minX);
    const spanY = Math.max(1000, maxY - minY);
    const pad = 48;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const ox = (W - spanX * scale) / 2 - minX * scale;
    const oy = (H - spanY * scale) / 2 - minY * scale;
    transform = { minX, minY, spanX, spanY, scale, ox, oy };
    const tx = (x: number) => ox + x * scale;
    const ty = (y: number) => oy + y * scale;

    // Room fills & labels
    const discSet = new Set<string>(meta?.disconnectedRooms || []);
    const weldedRooms: any[] = meta?.weldedRooms || [];
    for (let i = 0; i < (spec?.rooms || []).length; i++) {
      const rm = spec.rooms[i];
      const wr = weldedRooms[i];
      const isDisc = discSet.has(rm.name);
      if (wr) {
        const rx = tx(rm.at[0] - wr.widthMm / 2);
        const ry = ty(rm.at[1] - wr.depthMm / 2);
        const rw = wr.widthMm * scale;
        const rh = wr.depthMm * scale;
        ctx.fillStyle = isDisc ? "rgba(239, 68, 68, 0.16)" : "rgba(209, 193, 165, 0.28)";
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.fillStyle = isDisc ? "#b91c1c" : "#1e2724";
      ctx.font = '600 12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rm.name || "房间", tx(rm.at[0]), ty(rm.at[1]) - 7);
      if (wr) {
        ctx.fillStyle = "#64748b";
        ctx.font = "11px monospace";
        ctx.fillText(`${(wr.widthMm / 1000).toFixed(1)}×${(wr.depthMm / 1000).toFixed(1)}m`, tx(rm.at[0]), ty(rm.at[1]) + 9);
      }
    }

    // Walls & openings
    for (const w of walls) {
      const x0 = tx(w.a[0]), y0 = ty(w.a[1]), x1 = tx(w.b[0]), y1 = ty(w.b[1]);
      ctx.strokeStyle = w.bearing ? "#334155" : "#475569";
      ctx.lineWidth = Math.max(3, (w.t || 180) * scale);
      ctx.lineCap = "square";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      const dx = w.b[0] - w.a[0];
      const dy = w.b[1] - w.a[1];
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      for (const op of w.openings || []) {
        const ox0 = tx(w.a[0] + ux * op.from);
        const oy0 = ty(w.a[1] + uy * op.from);
        const ox1 = tx(w.a[0] + ux * op.to);
        const oy1 = ty(w.a[1] + uy * op.to);
        ctx.strokeStyle = op.type === "window" ? "#0284c7" : op.type === "sliding" ? "#0d9488" : "#d97706";
        ctx.lineWidth = Math.max(4, (w.t || 180) * scale + 2);
        ctx.beginPath();
        ctx.moveTo(ox0, oy0);
        ctx.lineTo(ox1, oy1);
        ctx.stroke();
      }
    }

    // Outer dimension guides
    ctx.fillStyle = "#475569";
    ctx.font = "600 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`总宽 ${Math.round(spanX)} mm`, W / 2, 18);
    ctx.save();
    ctx.translate(16, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`总深 ${Math.round(spanY)} mm`, 0, 0);
    ctx.restore();
  };

  const renderRoomList = () => {
    roomList.replaceChildren();
    vlm.rooms.forEach((r, idx) => {
      const row = el("div", undefined, "hybrid-room-row");
      const nameInput = el("input");
      nameInput.value = r.name || `房间${idx + 1}`;
      nameInput.onchange = () => {
        r.name = nameInput.value.trim() || `房间${idx + 1}`;
        void refreshPreview();
      };
      const wr = meta?.weldedRooms?.[idx];
      const dimSpan = el(
        "span",
        wr ? `${(wr.widthMm / 1000).toFixed(1)}×${(wr.depthMm / 1000).toFixed(1)}m` : "",
        "muted",
      );
      const delBtn = el("button", "删", "quiet");
      delBtn.type = "button";
      delBtn.disabled = vlm.rooms.length <= 1;
      delBtn.onclick = () => {
        vlm.rooms.splice(idx, 1);
        void refreshPreview();
      };
      row.append(nameInput, dimSpan, delBtn);
      roomList.append(row);
    });
  };

  const refreshPreview = async () => {
    if (previewing) return;
    previewing = true;
    statusTip.textContent = "正在实时重新焊接墙体并检测连通性…";
    try {
      const res = await post<any>(`/agent/tasks/${taskId}/preview-hybrid-floorplan`, {
        hybridVlm: vlm,
      });
      spec = res.spec;
      meta = res.meta || {};
      updateConnBadge();
      drawOverlay();
      drawDraft();
      renderRoomList();
      statusTip.textContent = `预览已更新：${meta.roomCount || 0} 个空间，${meta.openingCount || 0} 处门窗（${meta.scaleBasis || ""}）。`;
    } catch (e) {
      statusTip.textContent = `预览更新失败：${(e as Error).message}`;
    } finally {
      previewing = false;
    }
  };

  applyDimsBtn.onclick = () => {
    const nw = Number(wInput.value);
    const nd = Number(dInput.value);
    if (Number.isFinite(nw) && nw >= 2500 && nw <= 35000) vlm.scaleInfo!.outerWidthMm = Math.round(nw);
    if (Number.isFinite(nd) && nd >= 2500 && nd <= 35000) vlm.scaleInfo!.outerDepthMm = Math.round(nd);
    void refreshPreview();
  };

  draftCanvas.onclick = (event) => {
    if (tool === "inspect" || !vlm.rooms.length) return;
    const rect = draftCanvas.getBoundingClientRect();
    const cx = ((event.clientX - rect.left) / rect.width) * draftCanvas.width;
    const cy = ((event.clientY - rect.top) / rect.height) * draftCanvas.height;
    const mmX = (cx - transform.ox) / transform.scale;
    const mmY = (cy - transform.oy) / transform.scale;

    const minRx = Math.min(...vlm.rooms.map((r) => r.x1));
    const maxRx = Math.max(...vlm.rooms.map((r) => r.x2));
    const minRy = Math.min(...vlm.rooms.map((r) => r.y1));
    const maxRy = Math.max(...vlm.rooms.map((r) => r.y2));
    const ux = minRx + ((mmX - transform.minX) / Math.max(1, transform.spanX)) * Math.max(1, maxRx - minRx);
    const uy = minRy + ((mmY - transform.minY) / Math.max(1, transform.spanY)) * Math.max(1, maxRy - minRy);

    if (tool === "erase-opening") {
      if (!vlm.openings.length) return;
      let bestIdx = -1;
      let bestDist = 70;
      vlm.openings.forEach((op, idx) => {
        const d = Math.hypot(op.x - ux, op.y - uy);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      if (bestIdx >= 0) {
        vlm.openings.splice(bestIdx, 1);
        void refreshPreview();
      } else {
        statusTip.textContent = "附近未命中门窗标记，请点在彩色门窗线段附近。";
      }
      return;
    }

    // Snap orient to nearest wall in spec
    let orient: "h" | "v" = "h";
    let bestD = Infinity;
    for (const w of spec?.walls || []) {
      const isH = Math.abs(w.a[1] - w.b[1]) < 10;
      if (isH) {
        const x0 = Math.min(w.a[0], w.b[0]), x1 = Math.max(w.a[0], w.b[0]);
        if (mmX >= x0 - 250 && mmX <= x1 + 250) {
          const d = Math.abs(mmY - w.a[1]);
          if (d < bestD) { bestD = d; orient = "h"; }
        }
      } else {
        const y0 = Math.min(w.a[1], w.b[1]), y1 = Math.max(w.a[1], w.b[1]);
        if (mmY >= y0 - 250 && mmY <= y1 + 250) {
          const d = Math.abs(mmX - w.a[0]);
          if (d < bestD) { bestD = d; orient = "v"; }
        }
      }
    }
    vlm.openings.push({
      type: tool,
      x: Math.round(Math.max(0, Math.min(1000, ux))),
      y: Math.round(Math.max(0, Math.min(1000, uy))),
      span: tool === "window" ? 130 : 85,
      orient,
    });
    void refreshPreview();
  };

  const cleanup = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  closeBtn.onclick = cleanup;
  cancelBtn.onclick = cleanup;
  dialog.oncancel = (e) => {
    e.preventDefault();
    cleanup();
  };

  confirmBtn.onclick = async () => {
    if (submitting) return;
    submitting = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "正在生成 3D 场景与布置家具…";
    try {
      const nw = Number(wInput.value);
      const nd = Number(dInput.value);
      if (Number.isFinite(nw) && nw >= 2500 && nw <= 35000) vlm.scaleInfo!.outerWidthMm = Math.round(nw);
      if (Number.isFinite(nd) && nd >= 2500 && nd <= 35000) vlm.scaleInfo!.outerDepthMm = Math.round(nd);
      await onConfirm(vlm);
      cleanup();
    } catch (e) {
      statusTip.textContent = `确认失败：${(e as Error).message}`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✅ 确认结构并自动布置 3D 家具";
      submitting = false;
    }
  };

  img.onload = () => drawOverlay();
  dialog.showModal();
  updateConnBadge();
  drawDraft();
  renderRoomList();
  requestAnimationFrame(() => drawOverlay());
}
