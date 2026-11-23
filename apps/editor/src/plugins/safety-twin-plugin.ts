import { api, post } from "../api.js";
import type { Project } from "../../../../packages/scene-core/src/index.js";
import type { ThreeView } from "../views/three-view.js";
import { SafetyTwinOverlay } from "./safety-overlay.js";
import {
  SeismicWaveDrillController,
  type SeismicDrillStatus,
} from "./seismic-drill.js";

export interface SafetyTwinHostBridge {
  three: ThreeView;
  getProject: () => Project | undefined;
  openProject: (project: Project) => Promise<void>;
  setViewMode: (mode: string) => void;
  setSelectionIds?: (ids: string[]) => void;
  notifyMessage: (msg: string) => void;
}

const PLUGIN_CSS = `
#safety-twin-btn {
  background: linear-gradient(135deg, #0f766e 0%, #0369a1 100%);
  color: #ffffff;
  border: 1px solid rgba(56, 189, 248, 0.45);
  font-weight: 600;
  border-radius: 8px;
  padding: 5px 11px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(3, 105, 161, 0.22);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
#safety-twin-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(3, 105, 161, 0.34);
}
#safety-twin-btn.active {
  outline: 2px solid #38bdf8;
}
.safety-twin-drawer {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 368px;
  max-height: calc(100% - 28px);
  overflow-y: auto;
  z-index: 45;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(14px);
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 14px;
  padding: 14px 15px;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.48);
  font-size: 12.5px;
  line-height: 1.45;
}
.safety-twin-drawer[hidden] { display: none !important; }
.st-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}
.st-head strong { font-size: 14px; letter-spacing: 0.02em; color: #f1f5f9; }
.st-badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.2);
  color: #67e8f9;
  border: 1px solid rgba(6, 182, 212, 0.4);
}
.st-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}
.st-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 10px;
}
.st-preset-btn {
  background: rgba(30, 41, 59, 0.85);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.st-preset-btn:hover {
  border-color: #38bdf8;
  background: rgba(30, 58, 138, 0.45);
}
.st-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}
.st-kpi {
  background: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 9px;
  padding: 7px 8px;
  text-align: center;
}
.st-kpi small { display: block; color: #94a3b8; font-size: 10.5px; margin-bottom: 2px; }
.st-kpi b { font-size: 13.5px; }
.st-kpi.ok { border-color: rgba(16, 185, 129, 0.5); }
.st-kpi.ok b { color: #34d399; }
.st-kpi.danger { border-color: rgba(239, 68, 68, 0.6); background: rgba(127, 29, 29, 0.28); }
.st-kpi.danger b { color: #fca5a5; }
.st-layers {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 6px 8px;
  background: rgba(15, 23, 42, 0.55);
  border-radius: 8px;
  color: #cbd5e1;
  font-size: 11.5px;
}
.st-layers label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.st-actions { display: grid; gap: 7px; margin-bottom: 10px; }
.st-btn {
  width: 100%;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s, transform 0.1s;
}
.st-btn:active { transform: scale(0.99); }
.st-btn-scan { background: #0284c7; color: #fff; }
.st-btn-quake { background: linear-gradient(135deg, #dc2626, #b45309); color: #fff; }
.st-btn-reset { background: #334155; color: #f8fafc; border-color: #64748b; }
.st-btn-anchor { background: rgba(37, 99, 235, 0.28); color: #93c5fd; border-color: rgba(96, 165, 250, 0.5); }
.st-btn-agent { background: linear-gradient(135deg, #059669, #0d9488); color: #fff; }
.st-btn-mujoco { background: rgba(51, 65, 85, 0.75); color: #e2e8f0; border-color: rgba(148, 163, 184, 0.35); }
.st-btn-quote { background: linear-gradient(135deg, #0d9488, #0284c7); color: #f8fafc; border-color: rgba(56,189,248,0.45); }
.st-budget-select {
  background: #1e293b; color: #e2e8f0; border: 1px solid rgba(148,163,184,0.35);
  border-radius: 7px; padding: 6px 8px; font-size: 11px; font-weight: 600;
}
.st-quote-panel {
  margin-top: 8px; padding: 9px 10px; border-radius: 9px;
  background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(56, 189, 248, 0.35);
  display: flex; flex-direction: column; gap: 7px; font-size: 11px;
}
.st-quote-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
.st-quote-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 700; background: rgba(14, 165, 233, 0.18); color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
.st-quote-badge.local { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; border-color: rgba(148,163,184,0.35); }
.st-quote-total { font-size: 13px; font-weight: 700; color: #fcd34d; }
.st-quote-summary { color: #cbd5e1; line-height: 1.4; }
.st-quote-items { display: flex; flex-direction: column; gap: 5px; max-height: 210px; overflow-y: auto; }
.st-quote-item {
  padding: 6px 8px; border-radius: 6px; background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.18);
}
.st-quote-item-top { display: flex; justify-content: space-between; gap: 6px; font-weight: 600; color: #f8fafc; }
.st-quote-item-meta { color: #94a3b8; font-size: 10px; margin-top: 2px; }
.st-quote-item-purpose { color: #cbd5e1; font-size: 10px; margin-top: 3px; line-height: 1.35; }
.st-quote-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.st-progress {
  height: 6px;
  background: rgba(51, 65, 85, 0.8);
  border-radius: 999px;
  overflow: hidden;
  margin: 6px 0;
}
.st-progress > i {
  display: block;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  transition: width 0.08s linear;
}
.st-issues {
  max-height: 155px;
  overflow-y: auto;
  display: grid;
  gap: 5px;
  margin-bottom: 8px;
}
.st-issue {
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 11.5px;
  background: rgba(127, 29, 29, 0.35);
  border-left: 3px solid #ef4444;
  color: #fecaca;
}
.st-issue.ok {
  background: rgba(6, 78, 59, 0.35);
  border-left-color: #10b981;
  color: #a7f3d0;
}
.st-issue.warn {
  background: rgba(120, 53, 15, 0.35);
  border-left-color: #f59e0b;
  color: #fde68a;
}
.st-citations {
  font-size: 11px;
  color: #94a3b8;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  padding-top: 7px;
}
.st-citations summary { cursor: pointer; color: #cbd5e1; font-weight: 600; }
.st-citations ul { margin: 5px 0 0; padding-left: 16px; }
`;

export function initSafetyTwinPlugin(host: SafetyTwinHostBridge) {
  if (!document.getElementById("actiscape-safety-plugin-css")) {
    const style = document.createElement("style");
    style.id = "actiscape-safety-plugin-css";
    style.textContent = PLUGIN_CSS;
    document.head.appendChild(style);
  }

  const overlay = new SafetyTwinOverlay(host.three.scene);
  const drill = new SeismicWaveDrillController(host.three);
  let lastAudit: any = null;

  // 1. Add toolbar button in .stage-actions
  const stageActions = document.querySelector(".stage-actions");
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "safety-twin-btn";
  toggleBtn.dataset.testid = "safety-twin-btn";
  toggleBtn.type = "button";
  toggleBtn.textContent = "🛡️ 安全与鸿蒙推演";
  toggleBtn.title = "适老无障碍、7度地震刚体推演与鸿蒙毫米波雷达看护热力图";
  if (stageActions) {
    stageActions.prepend(toggleBtn);
  }

  // 2. Add MuJoCo export entry in .export-actions
  const exportDetails = document.querySelector(".export-actions");
  if (exportDetails) {
    const mjBtn = document.createElement("button");
    mjBtn.id = "export-mujoco-menu";
    mjBtn.type = "button";
    mjBtn.textContent = "导出 MuJoCo 具身仿真 (.xml)";
    mjBtn.onclick = () => triggerMujocoDownload();
    exportDetails.appendChild(mjBtn);
  }

  // 3. Mount floating cockpit drawer inside #viewport
  const viewport = document.getElementById("viewport") || document.body;
  const drawer = document.createElement("aside");
  drawer.className = "safety-twin-drawer";
  drawer.dataset.testid = "safety-twin-drawer";
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="st-head">
      <div>
        <strong>🛡️ 居家安全与鸿蒙康养数字孪生</strong>
        <div><span class="st-badge">Huawei Cloud AgentArts · 0.01mm 确定性门禁</span></div>
      </div>
      <button type="button" class="st-close" aria-label="关闭安全推演面板">✕</button>
    </div>

    <div class="st-presets">
      <button type="button" class="st-preset-btn" data-preset="elderly-care-hazard">
        🧓 <b>适老与看护隐患房</b><br><small>轮椅受阻 + 雷达遮挡盲区</small>
      </button>
      <button type="button" class="st-preset-btn" data-preset="seismic-bedroom-hazard">
        ⚡ <b>7度地震震害推演房</b><br><small>高柜砸床/堵门 vs 墙锚对比</small>
      </button>
    </div>

    <div class="st-kpis">
      <div class="st-kpi" id="st-kpi-wheel"><small>无障碍轮椅圆</small><b>待检测</b></div>
      <div class="st-kpi" id="st-kpi-seismic"><small>7度抗震倾覆</small><b>待检测</b></div>
      <div class="st-kpi" id="st-kpi-radar"><small>鸿蒙毫米波覆盖</small><b>待检测</b></div>
    </div>

    <div class="st-layers">
      <label><input type="checkbox" data-layer="radar" checked> 鸿蒙雷达热力图</label>
      <label><input type="checkbox" data-layer="wheelchair" checked> 1.5m轮椅圆</label>
      <label><input type="checkbox" data-layer="seismic" checked> 倾覆扫掠包络</label>
    </div>

    <div class="st-actions">
      <button type="button" class="st-btn st-btn-scan" id="st-run-audit">🔍 运行全屋安全体检与鸿蒙雷达仿真</button>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:6px;">
        <button type="button" class="st-btn st-btn-quake" id="st-run-quake">⚡ 8秒 7度地震波演练</button>
        <button type="button" class="st-btn st-btn-reset" id="st-reset-quake">↺ 无损复位</button>
      </div>
      <div id="st-quake-hud" hidden>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#fcd34d;">
          <span id="st-quake-label">地震波加载中…</span>
          <span id="st-quake-time">0.0 / 8.0s</span>
        </div>
        <div class="st-progress"><i id="st-quake-bar"></i></div>
      </div>
      <button type="button" class="st-btn st-btn-anchor" id="st-anchor-all">🔩 一键全屋高柜加装 L 型防震墙锚</button>
      <button type="button" class="st-btn st-btn-agent" id="st-ask-agent">🤖 呼叫 AgentArts 防灾适老自动改造</button>
      <div style="display:grid;grid-template-columns:1fr 1.65fr;gap:6px;">
        <select id="st-budget-select" class="st-budget-select" title="改造采购预算上限">
          <option value="2000">预算 ≤ ¥2,000</option>
          <option value="5000" selected>预算 ≤ ¥5,000</option>
          <option value="10000">预算 ≤ ¥10,000</option>
        </select>
        <button type="button" class="st-btn st-btn-quote" id="st-gen-quote">🧾 生成改造采购报价 (A2A)</button>
      </div>
      <button type="button" class="st-btn st-btn-mujoco" id="st-dl-mujoco">📦 导出 MuJoCo 具身智能仿真 (.xml)</button>
    </div>

    <div class="st-issues" id="st-issue-list">
      <div class="st-issue ok">点击上方样板间或「运行全屋安全体检」查看三维空间审计报告。</div>
    </div>

    <div class="st-quote-panel" id="st-quote-panel" hidden></div>

    <details class="st-citations" id="st-citations-box">
      <summary>📚 命中国家标准与鸿蒙康养规范条款</summary>
      <ul id="st-citations-list"><li>GB 50763-2012《无障碍设计规范》轮椅回转直径 ≥ 1500mm</li><li>GB 50011-2010《建筑抗震设计规范》§13.2 高柜防倾覆锚固</li><li>华为鸿蒙智家 60GHz 毫米波跌倒看护视距标准 ≥ 85%</li></ul>
    </details>
  `;
  viewport.appendChild(drawer);

  const renderAuditResult = (res: any) => {
    lastAudit = res;
    const sa = res.safetyAudit;
    overlay.render(sa);

    // Update KPI cards
    const kpiWheel = drawer.querySelector("#st-kpi-wheel")!;
    const minWheel = sa.wheelchairCircles?.[0];
    if (minWheel) {
      kpiWheel.className = `st-kpi ${minWheel.passed ? "ok" : "danger"}`;
      kpiWheel.querySelector("b")!.textContent = `Ø${minWheel.maxDiameterMm}mm`;
    } else {
      kpiWheel.className = "st-kpi ok";
      kpiWheel.querySelector("b")!.textContent = "达标";
    }

    const kpiSeismic = drawer.querySelector("#st-kpi-seismic")!;
    const unanchoredCrit = (sa.toppleZones || []).filter(
      (z: any) => !z.anchored && z.hazardCodes.length > 0,
    );
    const anchoredCount = (sa.toppleZones || []).filter((z: any) => z.anchored).length;
    if (unanchoredCrit.length > 0) {
      kpiSeismic.className = "st-kpi danger";
      kpiSeismic.querySelector("b")!.textContent = `${unanchoredCrit.length} 处高危`;
    } else {
      kpiSeismic.className = "st-kpi ok";
      kpiSeismic.querySelector("b")!.textContent =
        anchoredCount > 0 ? `${anchoredCount}柜已锚固` : "安全";
    }

    const kpiRadar = drawer.querySelector("#st-kpi-radar")!;
    const covPct = ((sa.radar?.coverageRatio ?? 1) * 100).toFixed(1);
    const radarOk = (sa.radar?.coverageRatio ?? 1) >= 0.85;
    kpiRadar.className = `st-kpi ${radarOk ? "ok" : "danger"}`;
    kpiRadar.querySelector("b")!.textContent = `${covPct}%`;

    // Render issue list
    const listEl = drawer.querySelector("#st-issue-list")!;
    listEl.innerHTML = "";
    const issues: any[] = res.combinedIssues || sa.issues || [];
    if (!issues.length) {
      const okDiv = document.createElement("div");
      okDiv.className = "st-issue ok";
      okDiv.textContent =
        "✅ 零安全与几何冲突！轮椅 1500mm 畅通、高柜防震稳固、鸿蒙毫米波看护覆盖达标。";
      listEl.appendChild(okDiv);
    } else {
      for (const issue of issues) {
        const item = document.createElement("div");
        item.className = `st-issue ${issue.level === "warning" ? "warn" : ""}`;
        item.textContent = `[${issue.code}] ${issue.message}`;
        listEl.appendChild(item);
      }
    }

    // Render standard citations
    if (sa.standardCitations?.length) {
      const ul = drawer.querySelector("#st-citations-list")!;
      ul.innerHTML = "";
      for (const c of sa.standardCitations) {
        const li = document.createElement("li");
        li.textContent = `${c.standard}（${c.clause}）：${c.requirement}`;
        ul.appendChild(li);
      }
      (drawer.querySelector("#st-citations-box") as HTMLDetailsElement).open = true;
    }
  };

  const runAudit = async () => {
    const proj = host.getProject();
    if (!proj) {
      host.notifyMessage("请先打开一个空间或点击上方隐患样板间");
      return;
    }
    drill.reset();
    host.setViewMode("3d");
    const res = await post(`/projects/${proj.id}/safety-audit`, {
      enabled: true,
      elderlyWheelchair: true,
      seismicIntensity: 7,
      radarCheck: true,
    });
    renderAuditResult(res);
    host.notifyMessage(
      `安全体检完成：发现 ${res.blockingCount} 项阻断性安全/几何隐患，鸿蒙雷达覆盖率 ${(res.safetyAudit.radar.coverageRatio * 100).toFixed(1)}%`,
    );
  };

  const triggerMujocoDownload = () => {
    const proj = host.getProject();
    if (!proj) {
      host.notifyMessage("请先打开一个项目再导出 MuJoCo 场景");
      return;
    }
    const a = document.createElement("a");
    a.href = `/api/projects/${proj.id}/export-mujoco`;
    a.download = `actiscape-${proj.id.slice(0, 8)}-mujoco.xml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    host.notifyMessage("已导出标准 MuJoCo MJCF (.xml) 具身智能物理仿真场景");
  };

  toggleBtn.onclick = () => {
    const nextOpen = drawer.hidden;
    drawer.hidden = !nextOpen;
    toggleBtn.classList.toggle("active", nextOpen);
    if (nextOpen && host.getProject()) {
      void runAudit().catch((e) => host.notifyMessage(e.message || String(e)));
    } else if (!nextOpen) {
      drill.reset();
      overlay.hide();
    }
  };

  drawer.querySelector(".st-close")!.addEventListener("click", () => {
    drawer.hidden = true;
    toggleBtn.classList.remove("active");
    drill.reset();
    overlay.hide();
  });

  drawer.querySelectorAll<HTMLInputElement>("[data-layer]").forEach((cb) => {
    cb.onchange = () => {
      overlay.setLayerVisibility({
        [cb.dataset.layer!]: cb.checked,
      });
    };
  });

  drawer.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        drill.reset();
        const presetName = btn.dataset.preset!;
        const planDoc = await api(`/examples/${presetName}`);
        const created = await post("/projects", { document: planDoc });
        await host.openProject(created);
        host.setViewMode("3d");
        await runAudit();
      } catch (e: any) {
        host.notifyMessage(e?.message || "加载隐患样板间失败");
      }
    };
  });

  drawer.querySelector("#st-run-audit")!.addEventListener("click", () => {
    void runAudit().catch((e) => host.notifyMessage(e.message || String(e)));
  });

  const renderDrillStatus = (st: SeismicDrillStatus) => {
    const hud = drawer.querySelector<HTMLElement>("#st-quake-hud")!;
    hud.hidden = false;
    drawer.querySelector("#st-quake-label")!.textContent = st.running
      ? `⚡ ${st.intensity}度罕遇地震波 (PGA ${st.pgaG}g) 推演中…`
      : `🛑 震后损毁定格（点“无损复位”1ms 恢复）`;
    drawer.querySelector("#st-quake-time")!.textContent =
      `${st.elapsedSec.toFixed(1)} / ${st.durationSec.toFixed(1)}s`;
    drawer.querySelector<HTMLElement>("#st-quake-bar")!.style.width =
      `${Math.min(100, (st.elapsedSec / st.durationSec) * 100)}%`;

    if (st.events.length > 0) {
      const listEl = drawer.querySelector("#st-issue-list")!;
      listEl.innerHTML = "";
      for (const ev of [...st.events].reverse()) {
        const div = document.createElement("div");
        div.className = `st-issue ${
          ev.kind === "anchored_safe"
            ? "ok"
            : ev.kind === "rocking"
              ? "warn"
              : ""
        }`;
        div.textContent = ev.message;
        listEl.appendChild(div);
      }
    }
  };

  drawer.querySelector("#st-run-quake")!.addEventListener("click", async () => {
    const proj = host.getProject();
    if (!proj) {
      host.notifyMessage("请先打开空间再启动地震波演练");
      return;
    }
    host.setViewMode("3d");
    if (!lastAudit || lastAudit.projectId !== proj.id) {
      await runAudit();
    }
    drill.start(proj.plan, {
      intensity: 7,
      toppleZones: lastAudit?.safetyAudit?.toppleZones || [],
      onUpdate: renderDrillStatus,
    });
  });

  drawer.querySelector("#st-reset-quake")!.addEventListener("click", () => {
    drill.reset();
    drawer.querySelector<HTMLElement>("#st-quake-hud")!.hidden = true;
    if (lastAudit) renderAuditResult(lastAudit);
    host.notifyMessage("已无损复位全部家具三维位姿（未改动项目正式数据）");
  });

  drawer.querySelector("#st-anchor-all")!.addEventListener("click", async () => {
    const proj = host.getProject();
    if (!proj) return;
    try {
      drill.reset();
      const res = await post(`/projects/${proj.id}/anchor-furniture`, {
        anchored: true,
        baseRevision: proj.revision,
      });
      await host.openProject(res.project);
      host.setViewMode("3d");
      await runAudit();
      host.notifyMessage(
        `已为 ${res.anchoredCount} 件高大柜体加装 L 型防震墙锚！现在可再次点击「8秒 7度地震波演练」验证稳固效果。`,
      );
    } catch (e: any) {
      host.notifyMessage(e?.message || "加装防震墙锚失败");
    }
  });

  drawer.querySelector("#st-ask-agent")!.addEventListener("click", async () => {
    const proj = host.getProject();
    if (!proj) return;
    try {
      drill.reset();
      // Ensure safety-profile is persisted on the project so Candidate/CheckScene enforces it
      const profRes = await post(`/projects/${proj.id}/safety-profile`, {
        enabled: true,
        elderlyWheelchair: true,
        seismicIntensity: 7,
        radarCheck: true,
        baseRevision: proj.revision,
      });
      const repairRes = await post<any>(`/projects/${proj.id}/auto-repair`, {
        includeSafety: true,
        baseRevision: profRes.project.revision,
      });
      await host.openProject(repairRes.project || profRes.project);
      await runAudit();
      if (repairRes.applied) {
        host.notifyMessage(`🛡️ 防灾适老自动改造完成：${repairRes.summary}`);
      } else {
        host.notifyMessage(repairRes.summary || "当前空间已通过防灾适老与鸿蒙雷达体检");
      }
    } catch (e: any) {
      host.notifyMessage(e?.message || "呼叫 AI 安全改造失败");
    }
  });

  const quotePanel = drawer.querySelector<HTMLDivElement>("#st-quote-panel")!;
  const quoteBtn = drawer.querySelector<HTMLButtonElement>("#st-gen-quote")!;
  const budgetSelect = drawer.querySelector<HTMLSelectElement>("#st-budget-select")!;
  let lastQuoteResult: any = null;

  const escHtml = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const buildQuoteMarkdown = (q: any) => {
    const items = Array.isArray(q?.lineItems) ? q.lineItems : [];
    const lines = [
      `# 演境 · 居家防灾与适老改造 BOM 采购清单`,
      `- 报价来源：${q?.provider === "agentarts-a2a-subagent" ? "华为云 AgentArts A2A 采购子智能体" : "本地参考价目表"}`,
      `- 预估总价：¥${q?.totalEstimatedCny ?? 0} 元（${q?.withinBudget ? "预算内" : "超出预算"}）`,
      `- 摘要：${q?.summary || ""}`,
      "",
      "| SKU | 产品名称 | 品牌/生态 | 渠道 | 单价(¥) | 数量 | 小计(¥) | 改造用途 |",
      "| :--- | :--- | :--- | :--- | ---: | ---: | ---: | :--- |",
      ...items.map(
        (it: any) =>
          `| ${it.skuId || "-"} | ${it.productName || "-"} | ${it.brandOrEcosystem || "-"} | ${it.channel || "-"} | ${it.unitPriceCny ?? 0} | ${it.quantity ?? 1} | ${it.subtotalCny ?? 0} | ${it.safetyPurpose || ""} |`,
      ),
    ];
    return lines.join("\n");
  };

  const downloadQuoteCsv = (q: any) => {
    const items = Array.isArray(q?.lineItems) ? q.lineItems : [];
    const csvEsc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["SKU编号", "产品名称", "品牌/生态", "采购渠道", "单价(元)", "数量", "小计(元)", "对应安全用途"];
    const rows = items.map((it: any) => [
      it.skuId || "",
      it.productName || "",
      it.brandOrEcosystem || "",
      it.channel || "",
      it.unitPriceCny ?? 0,
      it.quantity ?? 1,
      it.subtotalCny ?? 0,
      it.safetyPurpose || "",
    ]);
    rows.push(["合计", q?.summary || "", "", "", "", items.length, q?.totalEstimatedCny ?? 0, q?.withinBudget ? "预算内" : "超预算"]);
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(csvEsc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `actiscape-safety-bom-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderQuotePanel = (res: any) => {
    lastQuoteResult = res;
    const q = res?.quote;
    if (!q) {
      quotePanel.hidden = true;
      return;
    }
    const isCloud = q.provider === "agentarts-a2a-subagent";
    const items = Array.isArray(q.lineItems) ? q.lineItems : [];
    const secs = res.elapsedMs ? `${(res.elapsedMs / 1000).toFixed(1)}s` : "";
    quotePanel.innerHTML = `
      <div class="st-quote-head">
        <span class="st-quote-badge ${isCloud ? "" : "local"}">${isCloud ? "☁️ 华为云 AgentArts A2A 实时报价" : "📦 本地参考价目表兜底"}${secs ? ` · ${secs}` : ""}</span>
        <span class="st-quote-total">¥${escHtml(q.totalEstimatedCny ?? 0)} ${q.withinBudget ? "✅ 预算内" : "⚠️ 超预算"}</span>
      </div>
      <div class="st-quote-summary">${escHtml(q.summary || `共 ${items.length} 项改造设备与加固五金`)}</div>
      <div class="st-quote-items">
        ${
          items.length
            ? items
                .map(
                  (it: any) => `
          <div class="st-quote-item">
            <div class="st-quote-item-top">
              <span>${escHtml(it.productName || it.category)}</span>
              <span style="color:#fcd34d;white-space:nowrap;">¥${escHtml(it.subtotalCny ?? (it.unitPriceCny || 0) * (it.quantity || 1))}</span>
            </div>
            <div class="st-quote-item-meta">${escHtml(it.skuId || "")} · ${escHtml(it.brandOrEcosystem || "")} · ${escHtml(it.channel || "")} · ¥${escHtml(it.unitPriceCny ?? 0)} × ${escHtml(it.quantity ?? 1)}</div>
            ${it.safetyPurpose ? `<div class="st-quote-item-purpose">${escHtml(it.safetyPurpose)}</div>` : ""}
          </div>`,
                )
                .join("")
            : '<div class="st-quote-item">当前房间暂无高危硬件改造采购需求。</div>'
        }
      </div>
      <div class="st-quote-actions">
        <button type="button" class="st-btn st-btn-reset" id="st-quote-copy">📋 复制清单</button>
        <button type="button" class="st-btn st-btn-mujoco" id="st-quote-csv">⬇️ 导出 BOM (.csv)</button>
      </div>
    `;
    quotePanel.hidden = false;
    quotePanel.querySelector("#st-quote-copy")?.addEventListener("click", async () => {
      const md = buildQuoteMarkdown(q);
      try {
        await navigator.clipboard.writeText(md);
        host.notifyMessage("📋 已复制改造 BOM 采购清单（Markdown 格式）");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        host.notifyMessage("📋 已复制改造 BOM 采购清单");
      }
    });
    quotePanel.querySelector("#st-quote-csv")?.addEventListener("click", () => {
      downloadQuoteCsv(q);
      host.notifyMessage("⬇️ 已导出改造 BOM 采购报价单 (.csv)");
    });
    if (Array.isArray(res.citations) && res.citations.length) {
      const ul = drawer.querySelector("#st-citations-list")!;
      ul.innerHTML = "";
      for (const c of res.citations) {
        const li = document.createElement("li");
        const code = c.standard || c.code || "";
        const clause = c.clause ? ` ${c.clause}` : "";
        li.textContent = `${code}${clause}：${c.summary || c.excerpt || c.title || ""}`;
        ul.appendChild(li);
      }
      (drawer.querySelector("#st-citations-box") as HTMLDetailsElement).open = true;
    }
  };

  quoteBtn.addEventListener("click", async () => {
    const proj = host.getProject();
    if (!proj) return;
    const prevLabel = quoteBtn.textContent;
    quoteBtn.disabled = true;
    quoteBtn.textContent = "⏳ 呼叫华为云采购子智能体…";
    try {
      const budgetLimitCny = Number(budgetSelect.value) || 5000;
      const res = await post<any>(`/projects/${proj.id}/procurement-quote`, {
        budgetLimitCny,
      });
      renderQuotePanel(res);
      const isCloud = res?.quote?.provider === "agentarts-a2a-subagent";
      host.notifyMessage(
        `🧾 ${isCloud ? "华为云 A2A 采购子智能体" : "参考价目表"}已生成改造报价：预估 ¥${res?.quote?.totalEstimatedCny ?? 0} 元`,
      );
    } catch (e: any) {
      host.notifyMessage(e?.message || "生成改造采购报价失败");
    } finally {
      quoteBtn.disabled = false;
      quoteBtn.textContent = prevLabel;
    }
  });

  drawer.querySelector("#st-dl-mujoco")!.addEventListener("click", () => {
    triggerMujocoDownload();
  });

  return {
    overlay,
    drill,
    runAudit,
    onProjectChanged: () => {
      drill.reset();
      if (lastQuoteResult && lastQuoteResult.projectId !== host.getProject()?.id) {
        quotePanel.hidden = true;
      }
      if (!drawer.hidden && host.getProject()) {
        void runAudit().catch(() => {});
      } else {
        overlay.hide();
      }
    },
  };
}
