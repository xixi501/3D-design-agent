import { api, post } from "../api.js";
import type { Project } from "../../../../packages/scene-core/src/index.js";

export interface SceneGalleryHostBridge {
  getProject: () => Project | undefined;
  openProject: (project: Project) => Promise<void>;
  setViewMode: (mode: string) => void;
  notifyMessage: (msg: string) => void;
}

interface TemplateMeta {
  id: string;
  name: string;
  tier: "edu_lab" | "single" | "suite" | "full_home" | "safety_lab";
  tierLabel: string;
  styleId: string;
  styleLabel: string;
  roomCount: number;
  areaSummary: string;
  highlights: string[];
}

interface StylePackMeta {
  id: string;
  label: string;
  description?: string;
}

const GALLERY_CSS = `
#scene-gallery-btn {
  background: linear-gradient(135deg, #7c583c 0%, #b8613c 100%);
  color: #ffffff;
  border: 1px solid rgba(251, 191, 36, 0.42);
  font-weight: 600;
  border-radius: 8px;
  padding: 5px 11px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(184, 97, 60, 0.22);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
#scene-gallery-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(184, 97, 60, 0.34);
}
#scene-gallery-btn.active {
  outline: 2px solid #f59e0b;
}
.sg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(15, 23, 42, 0.56);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.sg-backdrop[hidden] {
  display: none !important;
}
.sg-modal {
  width: min(980px, 95vw);
  max-height: 88vh;
  overflow-y: auto;
  background: #fbf9f5;
  color: #1e2724;
  border: 1px solid #dfd7c9;
  border-radius: 16px;
  padding: 20px 22px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.32);
}
.sg-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e6dfd3;
  margin-bottom: 14px;
}
.sg-head h2 {
  margin: 2px 0 4px;
  font-size: 19px;
}
.sg-kicker {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9c5b3b;
  font-weight: 700;
}
.sg-sub {
  margin: 0;
  font-size: 12.5px;
  color: #6b665d;
}
.sg-close {
  background: #efeae0;
  border: 1px solid #dcd3c4;
  border-radius: 8px;
  font-size: 16px;
  padding: 4px 10px;
  cursor: pointer;
}
.sg-style-bar {
  background: #f3eee4;
  border: 1px solid #e2d9c8;
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sg-style-bar strong {
  font-size: 12.5px;
  color: #3d362d;
  margin-right: 4px;
}
.sg-style-pill {
  background: #ffffff;
  border: 1px solid #d6ccb9;
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.sg-style-pill:hover {
  border-color: #b8613c;
  color: #9c4421;
  background: #fffaf5;
}
.sg-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 14px;
}
.sg-tab {
  background: #f1ece2;
  border: 1px solid #dcd3c2;
  border-radius: 999px;
  padding: 5px 13px;
  font-size: 12.5px;
  cursor: pointer;
  color: #4f4a41;
}
.sg-tab.active {
  background: #1e2724;
  color: #ffffff;
  border-color: #1e2724;
  font-weight: 600;
}
.sg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(285px, 1fr));
  gap: 12px;
}
.sg-card {
  background: #ffffff;
  border: 1px solid #e4dccd;
  border-radius: 13px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sg-card:hover {
  border-color: #b8613c;
  box-shadow: 0 8px 22px rgba(30, 39, 36, 0.08);
}
.sg-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.sg-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3ede2;
  color: #5a5246;
  font-weight: 600;
}
.sg-badge.tier-edu_lab { background: #dcfce7; color: #166534; }
.sg-badge.tier-suite { background: #e0f2fe; color: #0369a1; }
.sg-badge.tier-full_home { background: #fef3c7; color: #b45309; }
.sg-badge.tier-safety_lab { background: #fee2e2; color: #b91c1c; }
.sg-card h3 {
  margin: 0 0 4px;
  font-size: 14.5px;
  line-height: 1.35;
}
.sg-area {
  font-size: 12px;
  color: #777064;
  margin: 0 0 6px;
}
.sg-highlights {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: #4c4840;
  line-height: 1.5;
}
.sg-open-btn {
  width: 100%;
  background: #1e2724;
  color: #ffffff;
  border: none;
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.sg-open-btn:hover {
  background: #b8613c;
}
.sg-open-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}
`;

const FALLBACK_STYLES: StylePackMeta[] = [
  { id: "european", label: "🏛️ 欧式古典" },
  { id: "chinese", label: "🎋 新中式" },
  { id: "modern", label: "✨ 现代极简" },
  { id: "japanese", label: "🌿 日式原木" },
  { id: "cream", label: "🧁 法式奶油" },
  { id: "aging_care", label: "🛡️ 适老康养" },
];

export function initSceneGalleryPlugin(host: SceneGalleryHostBridge) {
  if (!document.querySelector("#scene-gallery-style")) {
    const style = document.createElement("style");
    style.id = "scene-gallery-style";
    style.textContent = GALLERY_CSS;
    document.head.appendChild(style);
  }

  const barActions = document.querySelector(".bar-actions");
  const triggerBtn = document.createElement("button");
  triggerBtn.id = "scene-gallery-btn";
  triggerBtn.type = "button";
  triggerBtn.textContent = "🏛️ 样板与多房画廊";
  triggerBtn.title = "一键体验精品单间、连通套间、单层复杂全屋及六大风格换装";
  if (barActions) {
    barActions.insertBefore(triggerBtn, barActions.firstChild);
  }

  const backdrop = document.createElement("div");
  backdrop.className = "sg-backdrop";
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  let templates: TemplateMeta[] = [];
  let styles: StylePackMeta[] = FALLBACK_STYLES;
  let activeTier = "all";
  let busy = false;

  async function ensureLoaded() {
    if (templates.length) return;
    try {
      const [tplRes, styleRes] = await Promise.all([
        api<{ templates: TemplateMeta[] }>("/templates"),
        api<{ stylePacks?: StylePackMeta[]; styles?: StylePackMeta[] }>("/style-packs").catch(() => ({
          stylePacks: FALLBACK_STYLES,
        })),
      ]);
      templates = tplRes.templates || [];
      const rawStyles: StylePackMeta[] =
        (styleRes as any).stylePacks || (styleRes as any).styles || [];
      if (rawStyles.length) {
        const iconMap: Record<string, string> = {
          european: "🏛️ ",
          chinese: "🎋 ",
          modern: "✨ ",
          japanese: "🌿 ",
          cream: "🧁 ",
          aging_care: "🛡️ ",
        };
        styles = rawStyles.map((s) => ({
          id: s.id,
          label: s.label.startsWith("🏛️") || s.label.startsWith("🎋")
            ? s.label
            : `${iconMap[s.id] || ""}${s.label}`,
        }));
      }
    } catch (err) {
      host.notifyMessage(`加载样板画廊失败：${(err as Error).message}`);
    }
  }

  async function applyStyleToCurrent(styleId: string, label: string) {
    const cur = host.getProject();
    if (!cur || !cur.plan.rooms.length) {
      host.notifyMessage("请先打开或生成一个有房间的空间，再一键套用风格主题");
      return;
    }
    if (busy) return;
    busy = true;
    render();
    try {
      const res = await post<{ project: Project }>(
        `/projects/${cur.id}/apply-style-pack`,
        { styleId },
      );
      await host.openProject(res.project);
      host.setViewMode("split");
      backdrop.hidden = true;
      triggerBtn.classList.remove("active");
      host.notifyMessage(`已将当前空间一键换装为「${label}」主题（墙地材质 + 吊顶灯槽 + 3D家具造型）`);
    } catch (err) {
      host.notifyMessage(`风格换装失败：${(err as Error).message}`);
    } finally {
      busy = false;
      render();
    }
  }

  async function launchTemplate(tpl: TemplateMeta) {
    if (busy) return;
    busy = true;
    render();
    try {
      document.querySelector<HTMLDialogElement>("#dialog")?.close();
      const created = await post<Project>("/projects", {});
      const res = await post<{ project: Project }>(
        `/projects/${created.id}/apply-template`,
        { templateId: tpl.id },
      );
      await host.openProject(res.project);
      host.setViewMode("split");
      backdrop.hidden = true;
      triggerBtn.classList.remove("active");
      host.notifyMessage(
        `已载入「${tpl.name}」（${tpl.roomCount} 空间 · ${res.project.plan.furniture.length} 件资产）`,
      );
    } catch (err) {
      host.notifyMessage(`载入样板失败：${(err as Error).message}`);
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    const cur = host.getProject();
    const hasRooms = !!cur?.plan.rooms.length;
    const tiers: Array<[string, string]> = [
      ["all", `全部 (${templates.length})`],
      ["edu_lab", "教学实验样板"],
      ["single", "精品单间"],
      ["suite", "连通套间"],
      ["full_home", "单层复杂全屋"],
      ["safety_lab", "安全推演样板"],
    ];
    const filtered =
      activeTier === "all"
        ? templates
        : templates.filter((t) => t.tier === activeTier);

    backdrop.innerHTML = `
      <div class="sg-modal" role="dialog" aria-label="精品样板与多房画廊">
        <div class="sg-head">
          <div>
            <div class="sg-kicker">ACTISCAPE CURATED GALLERY · MULTI-TIER SCENES</div>
            <h2>🏛️ 精品样板与多房空间画廊</h2>
            <p class="sg-sub">涵盖高密度精品单间、无障碍连通套间、130㎡三室两厅复杂全屋及安全推演靶场，全部经双重几何与净空门禁验收。</p>
          </div>
          <button type="button" class="sg-close" aria-label="关闭">✕</button>
        </div>
        <div class="sg-style-bar">
          <strong>🎨 当前空间一键换装：</strong>
          ${styles
            .map(
              (s) =>
                `<button type="button" class="sg-style-pill" data-style-id="${s.id}" ${
                  !hasRooms || busy ? "disabled" : ""
                } title="${
                  hasRooms
                    ? "将当前打开项目的地面、墙面、吊顶与3D家具造型切换为此风格"
                    : "请先打开一个非空空间"
                }">${s.label}</button>`,
            )
            .join("")}
        </div>
        <div class="sg-tabs">
          ${tiers
            .map(
              ([id, label]) =>
                `<button type="button" class="sg-tab ${
                  activeTier === id ? "active" : ""
                }" data-tier="${id}">${label}</button>`,
            )
            .join("")}
        </div>
        <div class="sg-grid">
          ${filtered
            .map(
              (t) => `
            <article class="sg-card">
              <div>
                <div class="sg-badges">
                  <span class="sg-badge tier-${t.tier}">${t.tierLabel}</span>
                  <span class="sg-badge">${t.styleLabel}</span>
                </div>
                <h3>${t.name}</h3>
                <p class="sg-area">${t.areaSummary}</p>
                <ul class="sg-highlights">
                  ${(t.highlights || []).map((h) => `<li>${h}</li>`).join("")}
                </ul>
              </div>
              <button type="button" class="sg-open-btn" data-tpl-id="${t.id}" ${
                busy ? "disabled" : ""
              }>${busy ? "正在构建 3D 空间…" : "✨ 新建并打开此样板"}</button>
            </article>
          `,
            )
            .join("")}
        </div>
      </div>
    `;

    backdrop.querySelector<HTMLButtonElement>(".sg-close")!.onclick = () => {
      backdrop.hidden = true;
      triggerBtn.classList.remove("active");
    };
    backdrop.onclick = (e) => {
      if (e.target === backdrop) {
        backdrop.hidden = true;
        triggerBtn.classList.remove("active");
      }
    };
    backdrop.querySelectorAll<HTMLButtonElement>("[data-tier]").forEach((btn) => {
      btn.onclick = () => {
        activeTier = btn.dataset.tier || "all";
        render();
      };
    });
    backdrop
      .querySelectorAll<HTMLButtonElement>("[data-style-id]")
      .forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.styleId!;
          const found = styles.find((s) => s.id === id);
          void applyStyleToCurrent(id, found?.label || id);
        };
      });
    backdrop
      .querySelectorAll<HTMLButtonElement>("[data-tpl-id]")
      .forEach((btn) => {
        btn.onclick = () => {
          const tpl = templates.find((t) => t.id === btn.dataset.tplId);
          if (tpl) void launchTemplate(tpl);
        };
      });
  }

  async function toggleGallery(forceOpen?: boolean) {
    const nextOpen = forceOpen !== undefined ? forceOpen : backdrop.hidden;
    if (!nextOpen) {
      backdrop.hidden = true;
      triggerBtn.classList.remove("active");
      return;
    }
    backdrop.hidden = false;
    triggerBtn.classList.add("active");
    await ensureLoaded();
    render();
  }

  triggerBtn.onclick = () => void toggleGallery();

  const emptyExampleBtn = document.querySelector<HTMLButtonElement>("#empty-example");
  if (emptyExampleBtn) {
    emptyExampleBtn.textContent = "或打开精品单间 / 套间 / 全屋样板画廊 →";
    emptyExampleBtn.onclick = (e) => {
      e.preventDefault();
      void toggleGallery(true);
    };
  }

  return { open: () => toggleGallery(true) };
}
