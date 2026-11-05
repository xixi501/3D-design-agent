import {
  freeShapes,
  freeMaterials,
  latheProfiles,
  furnitureStyles,
  openingTypes,
  kitchenRecipe,
  isKitchen,
  applyStyle,
  clone,
  newId,
  wallGeometry,
  type Plan,
  type Command,
  type Furniture,
} from "../../../../packages/scene-core/src/index.js";
import type { Selection } from "../views/plan-view.js";
import { Ko, Qu, C4, eM, $y, BM } from "../modeling/surfaces.js";
import { Gr } from "../../../../packages/scene-core/src/inherited/footprints.js";
import { Aa } from "../../../../packages/scene-core/src/inherited/catalog.js";
export const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const labels: Record<string, string> = {
  x: "X 位置",
  y: "Y 位置",
  z: "离地",
  w: "宽度",
  d: "深度",
  h: "高度",
  rot: "旋转 °",
  color: "颜色",
  name: "名称",
  t: "厚度",
  pos: "沿墙中心位置",
  width: "洞口宽度",
  sill: "窗台离地",
  head: "洞口顶高",
  depth: "下挂高度",
};
const num = (
  key: string,
  value: number,
  title = labels[key] || key,
  min = -100000,
  max = 100000,
  step = 10,
) =>
  `<label>${esc(title)}<input data-field="${key}" type="number" value="${Math.round(value * 100) / 100}" min="${min}" max="${max}" step="${step}"></label>`;
const text = (
  key: string,
  value: string,
  title = labels[key] || key,
  type = "text",
) =>
  `<label class="wide">${esc(title)}<input data-field="${key}" type="${type}" value="${esc(value)}"></label>`;
const select = (
  key: string,
  value: unknown,
  options: Record<string, any> | [string | number, string][],
  title: string,
) =>
  `<label>${esc(title)}<select data-field="${key}">${(Array.isArray(options) ? options : Object.entries(options).map(([k, v]) => [k, typeof v === "string" ? v : v.name])).map(([k, v]) => `<option value="${esc(k)}" ${String(value) === String(k) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
const check = (key: string, value: boolean, title: string) =>
  `<label class="check wide"><input data-field="${key}" type="checkbox" ${value ? "checked" : ""}>${esc(title)}</label>`;
const section = (title: string, body: string) =>
  `<section class="property-section"><h3>${title}</h3><div class="fields">${body}</div></section>`;
const pathPatch = (path: string, value: any) =>
  path
    .split(".")
    .reverse()
    .reduce((v, k) => ({ [k]: v }), value);
const columns: Record<string, string> = {
  door: "柜门",
  open: "开放格",
  hang: "挂衣区",
  drawer: "抽屉",
  hangOpen: "开放挂衣",
  glass: "玻璃门",
  niche: "中空",
  mixed: "上门下抽",
};
export function renderInspector(
  host: HTMLElement,
  plan: Plan,
  selection: Selection | undefined,
  commit: (c: Command[], s: string) => Promise<void>,
) {
  const object =
    selection && plan[selection.collection].find((o) => o.id === selection.id);
  const update = (patch: any, summary = "修改属性") =>
    selection
      ? commit([{ type: "update", ...selection, patch }], summary)
      : commit([{ type: "project", patch }], summary);
  if (!object) {
    host.innerHTML = `<h2>项目属性</h2><p class="muted">选择平面或三维中的对象进行编辑。长度单位为 mm。</p>${section("当前项目", text("name", plan.name) + num("height", plan.height, "层高", 100, 20000))}<p class="muted">拖动移动 · 滚轮缩放 · 右键平移<br>R 旋转 · Ctrl/Cmd D 复制<br>Ctrl/Cmd Z 撤销 · Shift Z 重做</p>`;
  } else if (selection!.collection === "furniture") {
    const f = object as Furniture;
    let body = section(
      "位置与尺寸",
      text("name", f.name) +
        ["w", "d", "h", "x", "y", "z", "rot"]
          .map((k) =>
            num(
              k,
              f[k] || 0,
              labels[k],
              ["w", "d", "h"].includes(k) ? 1 : k === "z" ? 0 : -100000,
              50000,
              k === "rot" ? 15 : 10,
            ),
          )
          .join("") +
        text(
          "color",
          f.type === "model" ? f.opt?.tint || "#ffffff" : f.color,
          f.type === "model" ? "颜色叠加" : "颜色",
          "color",
        ),
    );
    if (f.type !== "model" && f.type !== "free")
      body += section(
        "风格",
        select(
          "opt.style",
          f.opt?.style || "",
          { "": "原版默认", ...furnitureStyles },
          "家具风格",
        ),
      );
    if (f.type === "free") {
      const shape = f.opt?.shape || "box";
      body += section(
        "自由模型",
        select("opt.shape", shape, freeShapes, "造型") +
          select("opt.mat", f.opt?.mat || "paint", freeMaterials, "材质") +
          num("opt.op", f.opt?.op ?? 1, "不透明度", 0.05, 1, 0.05) +
          (["box", "roundBox", "extrude"].includes(shape)
            ? num("opt.r", f.opt?.r || 0, "圆角 / 倒角", 0, 500, 5)
            : "") +
          (["tube", "arch", "arcWall", "torus"].includes(shape)
            ? num(
                "opt.t",
                f.opt?.t || 120,
                shape === "torus" ? "管半径" : "壁厚",
                5,
                2000,
              )
            : "") +
          (shape === "arcWall"
            ? num("opt.arc", f.opt?.arc || 90, "圆心角 °", 10, 300, 5)
            : "") +
          (["slats", "steps"].includes(shape)
            ? num(
                "opt.n",
                f.opt?.n || (shape === "slats" ? 15 : 3),
                shape === "slats" ? "条数" : "级数",
                1,
                200,
                1,
              )
            : "") +
          (shape === "slats"
            ? num("opt.sw", f.opt?.sw || 40, "单条宽", 5, 500)
            : "") +
          (shape === "lathe"
            ? select(
                "opt.preset",
                f.opt?.preset || "vase",
                latheProfiles,
                "旋转轮廓",
              )
            : "") +
          check("opt.floor", f.opt?.floor || false, "可站立平台") +
          num("opt.rx", f.opt?.rx || 0, "前后倾斜 °", -89, 89, 1) +
          num("opt.ry", f.opt?.ry || 0, "左右倾斜 °", -89, 89, 1),
      );
      if (shape === "extrude")
        body +=
          '<p class="muted">二维中拖动顶点编辑轮廓；双击边添加顶点；选中顶点按 Delete 删除。</p>';
      body += section(
        "阵列复制",
        `<label>总数<input id="array-count" type="number" value="3" min="2" max="100"></label><label>间距 mm<input id="array-distance" type="number" value="${f.w + 100}" min="1"></label><label>方向<select id="array-axis"><option value="x">沿宽度</option><option value="y">沿深度</option><option value="z">向上叠放</option></select></label><button id="make-array">生成阵列</button>`,
      );
    }
    if (f.cab) {
      const c = f.cab;
      body += section(
        "定制柜",
        select(
          "cab.kind",
          c.kind,
          { tall: "高柜", base: "地柜", wall: "吊柜" },
          "类型",
        ) +
          select(
            "cab.shape",
            c.shape || "I",
            { I: "一字形", L: "L 形" },
            "造型",
          ) +
          select(
            "cab.corner",
            c.corner || "left",
            { left: "左侧", right: "右侧" },
            "转角",
          ) +
          select(
            "cab.door",
            c.door,
            { swing: "平开门", sliding: "推拉门" },
            "柜门",
          ) +
          select(
            "cab.handle",
            c.handle || "bar",
            { bar: "长拉手", hidden: "隐形", knob: "圆拉手" },
            "拉手",
          ) +
          num("cab.depth", c.depth || 600, "柜深", 300, 800) +
          num("cab.top", c.top || 0, "顶柜高", 0, 800) +
          num("cab.plinth", c.plinth ?? 80, "踢脚高", 0, 200),
      );
      body += section(
        "主段分格",
        c.cols
          .map(
            (v: string, i: number) =>
              select(`col:${i}`, v, columns, `第 ${i + 1} 列`) +
              num(
                `colWidth:${i}`,
                c.ws?.[i] || f.w / c.cols.length,
                "列宽",
                150,
                10000,
              ),
          )
          .join("") +
          '<button data-action="add-column">＋ 加一列</button><button data-action="remove-column">－ 减一列</button><button data-action="even-columns">平分列宽</button><button data-action="ceiling">做到顶</button>',
      );
      if (c.shape === "L")
        body += section(
          "侧段分格",
          (c.cols2 || ["hang", "door"])
            .map((v: string, i: number) =>
              select(`col2:${i}`, v, columns, `第 ${i + 1} 列`),
            )
            .join("") +
            '<button data-action="add-side-column">＋ 加一列</button><button data-action="remove-side-column">－ 减一列</button>',
        );
    }
    if (isKitchen(f)) {
      const k = kitchenRecipe(f);
      body += section(
        "定制橱柜",
        select(
          "kit.shape",
          k.shape,
          { I: "一字形", L: "L 形", U: "U 形" },
          "造型",
        ) +
          select(
            "kit.corner",
            k.corner,
            { left: "左侧", right: "右侧" },
            "侧边",
          ) +
          num("kit.depth", k.depth, "地柜深", 350, 900) +
          num("kit.thick", k.thick, "台面厚", 12, 100) +
          text("kit.top", k.top, "台面颜色", "color"),
      );
      const legs =
        k.shape === "I"
          ? { "0": "主段" }
          : k.shape === "L"
            ? { "0": "主段", "1": "侧段" }
            : { "0": "主段", "1": "左侧", "2": "右侧" };
      for (const name of ["sink", "hob"] as const) {
        const p = k[name];
        body += section(
          name === "sink" ? "水槽" : "灶台",
          check(`kit.${name}.off`, !!p.off, "隐藏") +
            select(`kit.${name}.leg`, p.leg, legs, "所在段") +
            num(`kit.${name}.at`, p.at, "中心位置", 0, 20000) +
            num(`kit.${name}.w`, p.w, "宽度", 100, 2000) +
            num(
              `kit.${name}.${name === "sink" ? "bowls" : "burners"}`,
              name === "sink" ? (p as any).bowls : (p as any).burners,
              name === "sink" ? "盆数" : "灶眼",
              1,
              4,
              1,
            ),
        );
      }
      body += section(
        "吊柜与高柜",
        check("kit.wall", k.wall, "显示吊柜") +
          Object.entries(legs)
            .map(([index, name]) =>
              check(
                "wallLeg:" + index,
                !k.wallLegs || k.wallLegs.includes(Number(index)),
                name + "做吊柜",
              ),
            )
            .join("") +
          num("kit.wallH", k.wallH, "吊柜高", 100, 1500) +
          num("kit.wallD", k.wallD, "吊柜深", 100, 600) +
          num("kit.wallZ", k.wallZ, "吊柜离地", 0, 4000) +
          check("kit.hood", k.hood, "显示烟机") +
          select(
            "kit.tall",
            k.tall,
            { none: "无", start: "起点", end: "终点" },
            "高柜位置",
          ) +
          num("kit.tallW", k.tallW, "高柜宽", 100, 2000) +
          num("kit.tallH", k.tallH, "高柜高", 100, 4000),
      );
    }
    if (f.type === "vanity")
      body += section(
        "浴室柜",
        num(
          "opt.basins",
          f.opt?.basins ?? (f.w >= 1200 ? 2 : 1),
          "盆数",
          1,
          2,
          1,
        ) +
          check("opt.hang", f.opt?.hang || false, "悬空安装") +
          check("opt.mirror", f.opt?.mirror !== false, "带镜子"),
      );
    if (f.type === "shower")
      body += section(
        "淋浴房",
        select(
          "opt.shape",
          f.opt?.shape || "square",
          { square: "方形", diamond: "钻石形", arc: "圆弧", line: "一字形" },
          "造型",
        ),
      );
    if (f.type === "kitchenIsland")
      body += section(
        "中岛",
        check("opt.sink", f.opt?.sink !== false, "水槽") +
          check("opt.hob", f.opt?.hob || false, "灶台") +
          num("opt.seat", f.opt?.seat || 0, "吧台出挑", 0, 600),
      );
    if (["bendSofa", "curvedSofa"].includes(f.type))
      body += section(
        "异形沙发",
        select("sofaShape", f.opt?.shape || "arc", Aa, "造型") +
          check("opt.flip", f.opt?.flip || false, "左右镜像") +
          num("opt.open", f.opt?.open || 0, "无靠背段", 0, 2000) +
          num("opt.back", f.opt?.back || 220, "靠背厚", 150, 260),
      );
    if (/lamp|light|tv|curtain/i.test(f.type))
      body += section(
        "显示状态",
        check("opt.on", f.opt?.on !== false, "开启 / 点亮"),
      );
    const defaults: Record<string, number> = {
      steps: 12,
      gap: 200,
      winders: 0,
      shelves: 4,
      n: 3,
      return: 0,
    };
    if (f.type !== "free")
      body += section(
        "其他造型参数",
        Object.entries(f.opt || {})
          .filter(
            ([k, v]) =>
              typeof v === "number" && k in defaults && !["open"].includes(k),
          )
          .map(([k, v]) =>
            num(
              `opt.${k}`,
              v as number,
              (
                {
                  steps: "踏步数",
                  gap: "间距",
                  winders: "转角踏步",
                  shelves: "层板数",
                  n: "数量",
                  return: "回转长度",
                } as any
              )[k],
              0,
              10000,
              1,
            ),
          )
          .join(""),
      );
    host.innerHTML = `<h2>${esc(f.name)}</h2><p class="muted">${f.type === "model" ? "外部模型 · 贴图保存在项目服务" : "参数化模型 · 参数随项目保存"}</p>${body}<div class="actions"><button data-action="rotate">旋转 90°</button><button data-action="duplicate">复制</button><button data-action="delete" class="danger">删除</button></div>`;
  } else {
    let body = "";
    const type = selection!.collection;
    if (type === "nodes" || type === "structs")
      body = ["x", "y", ...(type === "structs" ? ["w", "d", "h", "rot"] : [])]
        .map((k) => num(k, object[k] ?? plan.height))
        .join("");
    if (type === "walls") {
      const g = wallGeometry(plan).walls.get(object.id)!;
      body =
        num("wallLength", g.len, "中线长度", 1) +
        num("t", object.t) +
        check("bearing", object.bearing, "承重属性") +
        select(
          "status",
          object.status,
          { existing: "原有", new: "新砌", removed: "拆除" },
          "状态",
        ) +
        select(
          "align",
          object.align || 0,
          [
            [-1, "左侧齐平"],
            [0, "居中"],
            [1, "右侧齐平"],
          ],
          "对齐",
        ) +
        text("color", object.color || "#f1ede3", "墙面颜色", "color") +
        '<button data-action="split-wall">中点打断</button>';
    }
    if (type === "openings")
      body =
        select("type", object.type, openingTypes, "门窗类型") +
        ["width", "pos", "sill", "head"]
          .map((k) => num(k, object[k], labels[k], 0))
          .join("") +
        select(
          "side",
          object.side || 1,
          [
            [1, "正向"],
            [-1, "反向"],
          ],
          "开向",
        ) +
        select(
          "hinge",
          object.hinge || 0,
          [
            [0, "左侧"],
            [1, "右侧"],
          ],
          "门轴",
        ) +
        ([
          "door",
          "double",
          "unequal",
          "sliding",
          "pocket",
          "folding",
          "garage",
        ].includes(object.type)
          ? check("open", !!object.open, "打开门扇（漫游可通行）")
          : "");
    if (type === "rooms")
      body =
        text("name", object.name) +
        select("mat", object.mat, Ko, "地面材质") +
        select("wallMat", object.wallMat || "latexWhite", Qu, "墙面材质") +
        select("skirting", object.skirting || "wood", eM, "踢脚线") +
        select("ceil.type", object.ceil?.type || "none", C4, "吊顶") +
        num("ceil.drop", object.ceil?.drop || 200, "下吊高度", 0, 800) +
        num("ceil.edgeW", object.ceil?.edgeW || 400, "边吊宽", 100, 1500) +
        check("ceil.cove", object.ceil?.cove || false, "灯槽");
    if (type === "beams")
      body = num("w", object.w) + num("depth", object.depth || object.h || 400);
    if (type === "rooms") {
      body += check("customTile", !!object.tile, "自定义铺砖");
      if (object.tile) {
        const t = Gr(object.tile);
        body +=
          num("tile.w", t.w, "砖长", 20, 3200) +
          num("tile.h", t.h, "砖宽", 20, 3200) +
          num("tile.gap", t.gap, "缝宽", 0, 12, 0.5) +
          select("tile.pattern", t.pattern, $y, "铺法") +
          select("tile.tex", t.tex, BM, "砖纹理") +
          select(
            "tile.origin",
            t.origin,
            { center: "居中", corner: "左上墙角" },
            "起铺点",
          ) +
          num("tile.rot", t.rot, "角度 °", 0, 90, 90) +
          num("tile.ox", t.ox, "起铺偏移 X") +
          num("tile.oy", t.oy, "起铺偏移 Y") +
          text("tile.color", t.color, "砖色", "color") +
          text("tile.color2", t.color2, "第二色", "color") +
          text("tile.grout", t.grout, "缝色", "color");
      }
    }
    host.innerHTML = `<h2>${({ nodes: "墙角", walls: "墙体", openings: "门窗", rooms: "房间", structs: "结构构件", beams: "梁", measures: "尺寸" } as any)[type] || "对象"}</h2>${section("属性", body)}<div class="actions"><button data-action="delete" class="danger">删除</button></div>`;
  }
  host
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")
    .forEach((input) =>
      input.addEventListener("change", async () => {
        const key = input.dataset.field!;
        let value: any =
          input instanceof HTMLInputElement && input.type === "checkbox"
            ? input.checked
            : input.type === "number"
              ? Number(input.value)
              : input.value;
        if (["align", "side", "hinge"].includes(key) || /\.(leg)$/.test(key))
          value = Number(value);
        if (key === "wallLength") {
          const g = wallGeometry(plan).walls.get(object!.id)!;
          await commit(
            [
              {
                type: "update",
                collection: "nodes",
                id: object!.b,
                patch: { x: g.a.x + g.u.x * value, y: g.a.y + g.u.y * value },
              },
            ],
            "修改墙长",
          );
          return;
        }
        if (key.startsWith("col:") || key.startsWith("col2:")) {
          const field = key.startsWith("col:") ? "cols" : "cols2",
            cols = [...(object!.cab[field] || ["hang", "door"])];
          cols[Number(key.split(":")[1])] = value;
          await update({ cab: { [field]: cols } }, "修改柜体分格");
          return;
        }
        if (key.startsWith("wallLeg:")) {
          const k = kitchenRecipe(object),
            count = k.shape === "I" ? 1 : k.shape === "L" ? 2 : 3,
            legs = new Set<number>(
              k.wallLegs || Array.from({ length: count }, (_, i) => i),
            ),
            index = Number(key.split(":")[1]);
          if (value) legs.add(index);
          else legs.delete(index);
          await update({ kit: { wallLegs: [...legs].sort() } }, "修改吊柜分段");
          return;
        }
        if (key.startsWith("colWidth:")) {
          const c = object!.cab,
            index = Number(key.split(":")[1]),
            total = object!.w - (c.shape === "L" ? c.depth || 600 : 0),
            ws = c.cols.map(
              (_: any, i: number) => c.ws?.[i] || total / c.cols.length,
            ),
            rest = ws.reduce(
              (sum: number, v: number, i: number) =>
                sum + (i === index ? 0 : v),
              0,
            );
          const width = Math.max(
            150,
            Math.min(total - (ws.length - 1) * 150, value),
          );
          await update(
            {
              cab: {
                ws: ws.map((v: number, i: number) =>
                  i === index ? width : (v * (total - width)) / rest,
                ),
              },
            },
            "修改柜体列宽",
          );
          return;
        }
        let patch = pathPatch(key, value);
        if (
          key === "color" &&
          selection?.collection === "furniture" &&
          object?.type === "model"
        )
          patch = { color: value, opt: { tint: value } };
        if (key === "mat" && selection?.collection === "rooms")
          patch = { mat: value, tile: null };
        if (key === "customTile") patch = { tile: value ? Gr({}) : null };
        if (key === "sofaShape") {
          const recipe = (Aa as any)[value];
          patch = {
            w: recipe.w,
            d: recipe.d,
            opt: { shape: value, path: recipe.path, open: recipe.open },
          };
        }
        if (key === "opt.mat")
          patch = {
            ...patch,
            color: (freeMaterials as any)[value].color,
            opt: { mat: value, op: null },
          };
        if (key === "opt.style") {
          const copy = clone(object as Furniture);
          applyStyle(copy, value || null);
          patch = { color: copy.color, opt: copy.opt };
        }
        if (key === "cab.shape")
          patch = {
            ...patch,
            d:
              value === "L"
                ? Math.max(object!.d, 1800)
                : object!.cab.depth || 600,
            cab: {
              shape: value,
              depth: object!.cab.depth || 600,
              cols2: object!.cab.cols2 || ["hang", "door"],
            },
          };
        if (key === "cab.kind")
          patch = {
            ...patch,
            z: value === "wall" ? 1500 : 0,
            h: value === "wall" ? 700 : value === "base" ? 900 : 2100,
          };
        if (key === "kit.shape")
          patch = {
            kit: { shape: value, sink: null, hob: null },
            d: value === "I" ? 600 : Math.max(object!.d, 1800),
            w: value === "U" ? Math.max(object!.w, 2400) : object!.w,
          };
        if (key === "type" && selection?.collection === "openings")
          patch = {
            type: value,
            sill: (openingTypes as any)[value].sill,
            head: (openingTypes as any)[value].head,
          };
        await update(patch, "修改属性");
      }),
    );
  host.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!selection || !object) return;
      const action = button.dataset.action!;
      if (action === "delete")
        await commit([{ type: "delete", ...selection }], "删除对象");
      if (action === "duplicate")
        await commit([{ type: "duplicate", ...selection }], "复制对象");
      if (action === "rotate")
        await update({ rot: ((object.rot || 0) + 90) % 360 }, "旋转对象");
      if (action === "ceiling")
        await update({ h: plan.height - (object.z || 0) }, "柜体做到顶");
      if (action.includes("column")) {
        const field = action.includes("side") ? "cols2" : "cols",
          cols = [...(object.cab[field] || ["hang", "door"])];
        if (action.startsWith("add")) cols.push("door");
        if (action.startsWith("remove") && cols.length > 1) cols.pop();
        await update({ cab: { [field]: cols, ws: null } }, "修改柜体分格");
      }
      if (action === "split-wall") {
        const g = wallGeometry(plan).walls.get(object.id)!,
          node = newId(),
          wall = newId(),
          mid = g.len / 2;
        const commands: Command[] = [
          {
            type: "add",
            collection: "nodes",
            object: {
              id: node,
              x: (g.a.x + g.b.x) / 2,
              y: (g.a.y + g.b.y) / 2,
            },
          },
          { type: "update", ...selection, patch: { b: node } },
          {
            type: "add",
            collection: "walls",
            object: { ...object, id: wall, a: node },
          },
        ];
        for (const o of plan.openings.filter(
          (o) => o.wall === object.id && o.pos > mid,
        ))
          commands.push({
            type: "update",
            collection: "openings",
            id: o.id,
            patch: { wall, pos: o.pos - mid },
          });
        await commit(commands, "中点打断墙体");
      }
    }),
  );
  host.querySelector("#make-array")?.addEventListener("click", async () => {
    if (!object) return;
    const count = Math.min(
        100,
        Math.max(
          2,
          Number(
            (host.querySelector("#array-count") as HTMLInputElement).value,
          ),
        ),
      ),
      distance = Number(
        (host.querySelector("#array-distance") as HTMLInputElement).value,
      ),
      axis = (host.querySelector("#array-axis") as HTMLSelectElement).value,
      a = (object.rot * Math.PI) / 180;
    const commands: Command[] = [];
    for (let i = 1; i < count; i++) {
      const d = distance * i,
        offset =
          axis === "z"
            ? { x: 0, y: 0, z: d }
            : axis === "x"
              ? { x: d * Math.cos(a), y: d * Math.sin(a), z: 0 }
              : { x: -d * Math.sin(a), y: d * Math.cos(a), z: 0 };
      commands.push({
        type: "duplicate",
        collection: "furniture",
        id: object.id,
        offset,
      });
    }
    await commit(commands, "阵列复制");
  });
}
