/**
 * dsh-calibration-tier — 客户端半边
 *
 * 一根框、两个模式：
 *   思考模式：关 | 严 | 极   ‖ 循环
 *   循环模式：轻 | 交付 | 极致 ‖ 循环（亮起）
 * 右侧「循环」用一条隔离线与三档分开，它是模式开关，不是第四档。
 * 切到循环模式后，前面三格的含义从「问多深」变为「磨几轮」，配色由紫转绿；
 * 循环与对抗同开时，前三级条再转橙（红 + 绿 中和），一眼看出这一轮是「边磨边审」。
 *
 * ── 四条纪律 ───────────────────────────────────────────────────────────
 *  1. **fail-open**：插槽注册失败、桥接不可达，只让控件消失/只读，不连累输入框。
 *  2. **不碰官方 DOM**：不找、不改、不重排官方元素。
 *  3. **不注入消息**：状态只走宿主文件 + `clarify_tier` / `forge_level` 工具。
 *  4. **一格一义**：同一格在两种模式下含义不同，标签与提示必须同步切换，不能留旧标签。
 *
 * ── 右键设默认（v3.9.0）────────────────────────────────────────────────
 *  「检索」「代理」「对抗」三格右键弹小菜单，改的是**新会话默认**：写宿主 default 条目
 *  （`sessions.default`，没有自身条目的会话按它继承），再写本地兜底键给桥不可达时用。
 *  左键行为不变；已单独设过档的会话不受影响。对抗只有关/开两档（用户口径），检索/代理可带档。
 */
/*
 * id 必须是**包名**（含 @scope），因为 dsh-client-modules 用 package name 当浏览器模块身份。
 * 写成短名会 duplicate factory registration → web boot 失败 → 恢复模式。
 */
window.__ModuleLoader__.load({
  id: "dsh-calibration-tier",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var hooks = React;

    var PACKAGE_ID = "dsh-calibration";
    var SLOT_NAME = "conversation.input.right";
    var ENTRY_ORDER = 10;
    var LEVELS = ["off", "high", "max"];
    var MODES = ["think", "loop"];
    // 「检索」一个轮换格（v3.5.0）：本地 = 不检索（= 原开关的关），增量/全量 = 开着的两档
    var ROUTE_LEVELS = ["high", "max"];
    var ROUTE_CYCLE = ["off"].concat(ROUTE_LEVELS);
    var DEFAULT_ROUTE_LEVEL = "high";
    // 「代理」一个轮换格（v3.5.0）：默认 = 不派子代理（= 原开关的关），效率/性能 = 开着的两档
    var AGENT_PROFILES = ["efficiency", "performance"];
    var AGENT_CYCLE = ["off"].concat(AGENT_PROFILES);
    var DEFAULT_AGENT_PROFILE = "efficiency";
    // 「默认」键（v3.9.0）：与当前会话键分开存；本地只是宿主 default 条目的缓存/兜底
    var DEFAULTS_KEY = "dsh-tier-defaults";
    var BUILTIN_DEFAULTS = { counter: false, route: { on: false, level: DEFAULT_ROUTE_LEVEL }, agent: { on: false, profile: DEFAULT_AGENT_PROFILE } };

    /*
     * 文案的唯一事实源在宿主（lib/index.js 的 LABELS / TITLES），客户端通过 GET /state 取。
     * 下面这份只在桥不可达时兜底，保证控件仍可用——不参与“改档名”的维护。
     */
    var FALLBACK_LABELS = {
      think: { off: "常规", high: "严格", max: "极致" },
      loop: { off: "轻量", high: "交付", max: "极致" },
      route: { off: "本地", high: "增量", max: "全量" },
      agent: { off: "默认", efficiency: "效率", performance: "性能" },
    };
    var FALLBACK_TITLES = {
      think: {
        off: "常规：按平时标准直接做，不锚定、不复述、不提问",
        high: "严格：5 步清单——复述 → 歧义点 → 假设≤3 → 回勾验收 → 思考回执；不强制落盘",
        max: "极致：7 步清单 + 方案/反例落 tmp\\tier-plan-<日期>.md + 对抗自检 + 止损线",
      },
      loop: {
        off: "轻量：3 轮纯自检，出循环回执，不落盘",
        high: "交付：5 轮，第 2 轮独立评审 + 收敛复核；清单落 tmp\\forge-<日期>.md，出循环回执",
        max: "极致：8 轮，第 2 轮起每轮独立评审；落 tmp\\forge-full-<日期>.md，出循环回执",
      },
      route: {
        off: "本地：不联网检索，只用已装技能（命中隐藏技能会先 read 说明）",
        high: "增量：本地盘点 → 3 组查询 → 候选表落 tmp\\skill-scan-<日期>.md，给装/不装一句结论；回复末尾带检索回执",
        max: "全量：≥5 组查询、候选 ≥20、同组差异 → 判别卡落 tmp\\skill-scan-full-<日期>.md；回复末尾带检索回执",
      },
      agent: {
        off: "默认：不派子代理、不强化，派活沿用主模型",
        efficiency: "效率：强化一档——比主模型强、同档取便宜的；派活 4 步 + 代理回执（真派了才写）",
        performance: "性能：绝对质量——最强模型 + 最高推理等级；派活 5 步 + 代理回执（真派了才写，含隔离说明）",
      },
    };

    var STORAGE_KEY = "dsh-tier-mode";
    var DEFAULT_MODE = "think";
    var DEFAULT_LEVEL = "high";
    var DEFAULT_SESSION = "default";
    var PORT_BASE = 43871;
    var PORT_SPAN = 10; // 与宿主一致：43871..43880
    var PORT_KEY = "dsh-tier-port";
    var DEBUG_KEY = "dsh-tier-debug";
    var bridgePort = null;

    /*
     * 可调项（测试会改，也别有洞天）：
     * - portMissTtl：一轮 11 个端口全探空后，多久内不再重扫（避免每次点击都打 11 个 fetch）
     * - reconnectDelay / maxReconnects：SSE 判定断开后，隔多久重建、最多重建几次
     * - ownerCheckTtl：发现当前桥不认识本会话时，复核实例的最小间隔
     * - ownerPollMs / ownerPollTries：一直没认领上时，多久重试一次、最多几轮（约 1 分钟）
     * - debug：默认关。开着时每次启动会往宿主写 jsonl，文件没有轮转，别长期开
     */
    var CONFIG = {
      portMissTtl: 3000,
      reconnectDelay: 2000,
      maxReconnects: 3,
      ownerCheckTtl: 3000,
      ownerPollMs: 5000,
      ownerPollTries: 12,
      debug: false,
    };

    function readPortLocal() {
      try {
        var v = parseInt(localStorage.getItem(PORT_KEY) || "", 10);
        return v > 0 ? v : null;
      } catch (e) {
        return null;
      }
    }

    function writePortLocal(port) {
      try {
        localStorage.setItem(PORT_KEY, String(port));
      } catch (e) {
        /* 忽略 */
      }
    }

    function portUrl(port, sessionId, path) {
      return "http://127.0.0.1:" + port + (path || "/state") + "?session=" + encodeURIComponent(sessionId);
    }

    function probePort(port) {
      return fetch(portUrl(port, "probe", "/state"), { method: "GET", credentials: "omit", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (json) {
          return json && json.plugin === "dsh-calibration" ? port : null;
        })
        .catch(function () {
          return null;
        });
    }

    /** 依次探测端口，认 `plugin` 标记，避免两套 DSH 抢 43871。 */
    function discoverPort() {
      return candidates()
        .reduce(function (chain, port) {
          return chain.then(function (found) {
            if (found) return found;
            return probePort(port);
          });
        }, Promise.resolve(null))
        .then(function (found) {
          if (found) adoptPort(found);
          return found;
        });
    }

    function candidates() {
      var list = [];
      var cached = readPortLocal();
      if (cached) list.push(cached);
      for (var i = 0; i < PORT_SPAN; i += 1) {
        var port = PORT_BASE + i;
        if (list.indexOf(port) < 0) list.push(port);
      }
      return list;
    }

    /** 读某端口的完整状态（认 `plugin` 标记）。只读，不写任何东西。 */
    function probeState(port, sessionId) {
      return fetch(portUrl(port, sessionId, "/state"), { method: "GET", credentials: "omit", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (json) {
          return json && json.plugin === "dsh-calibration" ? json : null;
        })
        .catch(function () {
          return null;
        });
    }

    function adoptPort(port) {
      bridgePort = port;
      portMissAt = 0;
      writePortLocal(port);
    }

    /**
     * 扫一遍端口，把「有没有本插件、认不认识本会话」全收回来。
     * 两套 DSH 都跑本插件时，`plugin` 标记分不出谁是谁（端口都认），
     * 只有「认识这个会话」（owner=tool）的那个才算本实例。
     */
    function scanInstances(sessionId) {
      var found = [];
      return candidates()
        .reduce(function (chain, port) {
          return chain.then(function () {
            return probeState(port, sessionId).then(function (json) {
              if (json) found.push({ port: port, known: json.knownSession === true, state: json });
            });
          });
        }, Promise.resolve())
        .then(function () {
          return found;
        });
    }

    /** 本窗口是否已认准实例：未认准前不读不写任何桥，只用本地值。 */
    var ownership = { claimed: false };

    /** 探空一次就记住时间：TTL 内不再重扫，别让每次点击都变成 11 个 fetch。 */
    var portMissAt = 0;

    /** 同一时刻只允许一轮发现（挂载时 pull 与 SSE 会同时要端口）。 */
    var discovering = null;

    /** 端口失效（宿主重启换了端口、或连接被拒）：丢掉缓存，下次重新发现。 */
    function invalidatePort() {
      bridgePort = null;
    }

    function ensurePort() {
      if (bridgePort) return Promise.resolve(bridgePort);
      if (portMissAt && Date.now() - portMissAt < CONFIG.portMissTtl) return Promise.resolve(null);
      if (!discovering) {
        discovering = discoverPort().then(function (found) {
          portMissAt = found ? 0 : Date.now();
          discovering = null;
          return found;
        });
      }
      return discovering;
    }

    /** 会话键：优先插槽给的 sessionId；退回 URL 里的 id；再退回 default。 */
    function resolveSession(props) {
      try {
        if (props && typeof props.sessionId === "string" && props.sessionId) return props.sessionId;
      } catch (e) {
        /* 忽略 */
      }
      try {
        if (typeof location !== "undefined" && location && typeof location.href === "string") {
          var match = location.href.match(/session[-/]([0-9a-zA-Z-]{8,})/);
          if (match) return match[1];
        }
      } catch (e) {
        /* 忽略 */
      }
      return DEFAULT_SESSION;
    }

    function storageKey(sessionId) {
      return STORAGE_KEY + ":" + sessionId;
    }

    function bridgeUrl(sessionId, path) {
      return portUrl(bridgePort || readPortLocal() || PORT_BASE, sessionId, path);
    }

    /** 容器 title：离线与「下轮生效」是两件事，同时成立时都要说清楚。 */
    function barTitle(isPending, isDegraded, loop, counter, routeOn, routeLabel, agentOn, agentLabel) {
      var parts = [];
      if (isDegraded) parts.push("离线：改动只存本地，没有同步到宿主");
      if (isPending) parts.push("本轮仍用开工时的设置，这次改动下一轮生效");
      if (!parts.length) parts.push(loop ? "循环模式" : "思考模式");
      if (counter) parts.push("对抗审开");
      if (routeOn) parts.push("检索开：" + routeLabel);
      if (agentOn) parts.push("代理开：" + agentLabel);
      return parts.join("；");
    }

    /** 文案优先用 /state 下发的表，桥挂掉才用本地兜底。 */
    function resolveLabels(meta, mode) {
      if (meta && meta.labels && meta.labels[mode]) return meta.labels[mode];
      return FALLBACK_LABELS[mode] || FALLBACK_LABELS.think;
    }

    function resolveTitles(meta, mode) {
      if (meta && meta.titles && meta.titles[mode]) return meta.titles[mode];
      return FALLBACK_TITLES[mode] || FALLBACK_TITLES.think;
    }

    /**
     * 逐键合并兜底：宿主是旧版时可能少发 v3.5.0 新加的 off 显示名（本地 / 默认），
     * 少哪一档就补哪一档，免得轮换格那一下变成空白（客户端先于宿主更新时也会遇到）。
     */
    function withFallback(table, fallback) {
      var out = {};
      for (var k in fallback) out[k] = table && table[k] ? table[k] : fallback[k];
      return out;
    }

    function normalizeRoute(value) {
      // 只认 value.route：整份状态里的 level 是思考档，不能漏进检索档（SSE 只推 mode/level 时最容易踩）
      var src = value && value.route && typeof value.route === "object" ? value.route : {};
      return {
        on: src.on === true,
        level: ROUTE_LEVELS.indexOf(src.level) >= 0 ? src.level : DEFAULT_ROUTE_LEVEL,
      };
    }

    function normalizeAgent(value) {
      var src = value && value.agent && typeof value.agent === "object" ? value.agent : {};
      return {
        on: src.on === true,
        profile: AGENT_PROFILES.indexOf(src.profile) >= 0 ? src.profile : DEFAULT_AGENT_PROFILE,
      };
    }

    function normalize(value) {
      var mode = value && MODES.indexOf(value.mode) >= 0 ? value.mode : DEFAULT_MODE;
      var level = value && LEVELS.indexOf(value.level) >= 0 ? value.level : DEFAULT_LEVEL;
      return {
        mode: mode,
        level: level,
        counter: Boolean(value && value.counter === true),
        route: normalizeRoute(value),
        agent: normalizeAgent(value),
      };
    }

    function readLocal(sessionId) {
      try {
        var raw = localStorage.getItem(storageKey(sessionId));
        if (raw) {
          var parsed = JSON.parse(raw);
          if (
            parsed &&
            (MODES.indexOf(parsed.mode) >= 0 ||
              LEVELS.indexOf(parsed.level) >= 0 ||
              parsed.route ||
              parsed.agent)
          ) {
            return normalize(parsed);
          }
        }
      } catch (e) {
        /* 忽略 */
      }
      // 本会话还没落过值：用「右键设的默认」播种，桥不可达时也跟默认一致
      var seed = readDefaultsLocal();
      return normalize({
        mode: DEFAULT_MODE,
        level: DEFAULT_LEVEL,
        counter: seed.counter,
        route: seed.route,
        agent: seed.agent,
      });
    }

    function writeLocal(sessionId, state) {
      try {
        localStorage.setItem(storageKey(sessionId), JSON.stringify(state));
      } catch (e) {
        /* 忽略 */
      }
    }

    /*
     * ── 右键默认（v3.9.0） ────────────────────────────────────────────────
     * 默认值的语义：**新会话 / 没单独设过档的会话**从它起步。宿主侧就是 `sessions.default`
     * 条目（`state.js:sessionState` 的回落分支），所以写默认 = 写 `session=default`。
     * 本地键只是「宿主不可达时的兜底 + 首屏先有值」，不另立事实源。
     */
    function normalizeDefaults(value) {
      var src = value && typeof value === "object" ? value : {};
      var route = src.route && typeof src.route === "object" ? src.route : {};
      var agent = src.agent && typeof src.agent === "object" ? src.agent : {};
      return {
        counter: src.counter === true,
        route: {
          on: route.on === true,
          level: ROUTE_LEVELS.indexOf(route.level) >= 0 ? route.level : DEFAULT_ROUTE_LEVEL,
        },
        agent: {
          on: agent.on === true,
          profile: AGENT_PROFILES.indexOf(agent.profile) >= 0 ? agent.profile : DEFAULT_AGENT_PROFILE,
        },
      };
    }

    function readDefaultsLocal() {
      try {
        var raw = localStorage.getItem(DEFAULTS_KEY);
        if (raw) return normalizeDefaults(JSON.parse(raw));
      } catch (e) {
        /* 忽略 */
      }
      return normalizeDefaults(BUILTIN_DEFAULTS);
    }

    function writeDefaultsLocal(next) {
      try {
        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(normalizeDefaults(next)));
      } catch (e) {
        /* 忽略 */
      }
    }

    function sameDefaults(a, b) {
      var left = normalizeDefaults(a);
      var right = normalizeDefaults(b);
      return (
        left.counter === right.counter &&
        left.route.on === right.route.on &&
        left.route.level === right.route.level &&
        left.agent.on === right.agent.on &&
        left.agent.profile === right.agent.profile
      );
    }

    /** 菜单项：只列显式选项。对抗只有关/开（v3.9.0 用户口径：别再加对抗分级）。 */
    function defaultOptions(kind) {
      if (kind === "route") {
        return [
          { id: "off", label: "默认关（本地）" },
          { id: "high", label: "默认开 · 增量" },
          { id: "max", label: "默认开 · 全量" },
        ];
      }
      if (kind === "agent") {
        return [
          { id: "off", label: "默认关（默认）" },
          { id: "efficiency", label: "默认开 · 效率" },
          { id: "performance", label: "默认开 · 性能" },
        ];
      }
      return [
        { id: "off", label: "默认关" },
        { id: "on", label: "默认开" },
      ];
    }

    function currentDefaultId(kind, defaults) {
      var d = normalizeDefaults(defaults);
      if (kind === "route") return d.route.on ? d.route.level : "off";
      if (kind === "agent") return d.agent.on ? d.agent.profile : "off";
      return d.counter === true ? "on" : "off";
    }

    /** 一个菜单项 → 宿主 patch（只带这一维，别顺手改别的开关）。 */
    function defaultPatch(kind, id) {
      if (kind === "route") {
        return id === "off" ? { route: { on: false } } : { route: { on: true, level: id } };
      }
      if (kind === "agent") {
        return id === "off" ? { agent: { on: false } } : { agent: { on: true, profile: id } };
      }
      return { counter: id === "on" };
    }

    function mergeDefaults(defaults, patch) {
      var next = normalizeDefaults(defaults);
      if (patch && patch.route) {
        next.route = {
          on: patch.route.on === true,
          level: ROUTE_LEVELS.indexOf(patch.route.level) >= 0 ? patch.route.level : next.route.level,
        };
      }
      if (patch && patch.agent) {
        next.agent = {
          on: patch.agent.on === true,
          profile: AGENT_PROFILES.indexOf(patch.agent.profile) >= 0 ? patch.agent.profile : next.agent.profile,
        };
      }
      if (patch && typeof patch.counter === "boolean") next.counter = patch.counter;
      return next;
    }

    /** 默认值整包 → 宿主 patch（认领补写、恢复内置默认都用它）。 */
    function defaultsPatchOf(defaults) {
      var d = normalizeDefaults(defaults);
      return {
        counter: d.counter,
        route: { on: d.route.on, level: d.route.level },
        agent: { on: d.agent.on, profile: d.agent.profile },
      };
    }

    /** 右键菜单坐标：视口内夹取；放不下就翻到指针上方。 */
    function menuPosition(event, size) {
      var vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
      var vh = (typeof window !== "undefined" && window.innerHeight) || 768;
      var w = size && size.width ? size.width : 150;
      var h = size && size.height ? size.height : 140;
      var x = event && typeof event.clientX === "number" ? event.clientX : 0;
      var y = event && typeof event.clientY === "number" ? event.clientY : 0;
      var left = Math.max(8, Math.min(x, vw - w - 8));
      var top = y + h + 16 > vh ? Math.max(8, y - h - 8) : y + 8;
      return { x: left, y: top };
    }

    /*
     * 配色只在这里定义一次（2026-10-24 v1.8.1 起）：三色统一降饱和的「柔雾」调。
     * 思考=雾紫 #877be3 / 循环=雾绿 #66ae7c / 对抗=雾红 #da7f7f；
     * 循环 + 对抗 同开（data-mix='1'）时三级条的选中格用雾橙 #cf8a4a：红绿之间的橙不是取色值平均
     * （平均出来是土黄 #a0967d），而是取同一亮度、同一饱和度的暖橙。
     */
    var CSS = [
      ".dct-root{--dct-think:#877be3;--dct-loop:#66ae7c;--dct-counter:#da7f7f;--dct-mix:#cf8a4a;--dct-route:#3a9ad9;--dct-agent:#24543f;",
      "display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;",
      "border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.08);",
      "font-size:11px;line-height:1;user-select:none;flex:none;margin-inline-end:6px;",
      "font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".dct-cell{appearance:none;border:0;background:transparent;color:inherit;opacity:.55;",
      "font:inherit;padding:4px 7px;border-radius:999px;cursor:pointer;transition:opacity .12s,background .12s}",
      ".dct-cell:hover{opacity:.9}",
      ".dct-root .dct-cell[data-on='1']{background:var(--dct-think);color:#fff;opacity:1;font-weight:600}",
      // 循环只换「三级条」的选中格（2.2.1 起）：原先写通用 .dct-cell[data-on='1']，特异性 0,5,0
      // 压过检索的 0,3,0，循环一开检索格也被染绿。检索常驻天蓝、对抗恒红，同 2.1.0 的橙只落在等级格。
      ".dct-root[data-mode='loop'] .dct-cell[data-level][data-on='1']{background:var(--dct-loop)}",
      ".dct-root .dct-counter[data-on='1']{background:var(--dct-counter);color:#fff;opacity:1;font-weight:600}",
      // 循环 + 对抗 同开：三级条的选中格由绿转橙；循环/对抗两个开关各留原色（绿 / 红）
      ".dct-root[data-mix='1'] .dct-cell[data-level][data-on='1']{background:var(--dct-mix)}",
      // 检索：末尾的轮换格（v3.5.0）「本地 → 增量 → 全量」，天蓝 #3a9ad9（与三色同亮度带，白字对比 3.09）。
      // 用户口径 2026-10-29：本地也要保持颜色渲染——所以不看 data-on，三档恒亮；
      // 写法用 .dct-cell.dct-routecell（0,4,0），稳压上面通用 .dct-cell[data-on='1'] 的 0,3,0，不依赖源序
      ".dct-root .dct-cell.dct-routecell{background:var(--dct-route);color:#fff;opacity:1;font-weight:600;",
      "box-shadow:0 0 0 1px rgba(58,154,217,.45) inset}",
      // 代理：末尾轮换格「默认 → 效率 → 性能」，墨绿 #24543f——白字对比 ≈8.7，比三档更深，
      // 靠明度差跟循环雾绿 #66ae7c 分开；同样恒亮，「默认」也保持墨绿
      ".dct-root .dct-cell.dct-agentcell{background:var(--dct-agent);color:#fff;opacity:1;font-weight:600;",
      "font-variant-numeric:tabular-nums;box-shadow:0 0 0 1px rgba(36,84,63,.45) inset}",
      ".dct-sep{width:1px;height:14px;background:rgba(127,127,127,.38);margin:0 3px;border-radius:1px}",
      ".dct-mode{border-left:0;letter-spacing:.5px}",
      // 循环格要写满 .dct-root .dct-cell.dct-mode（0,4,0）：只写 .dct-mode[data-on='1']（0,2,0）会输给
      // 上面 .dct-cell[data-on='1'] 的紫（0,3,0）；写成 0,3,0 又能赢但依赖源序，升到 0,4,0 才与顺序无关
      ".dct-root .dct-cell.dct-mode[data-on='1']{background:var(--dct-loop);color:#fff;opacity:1;font-weight:600;",
      "box-shadow:0 0 0 1px rgba(102,174,124,.45) inset}",
      ".dct-cell:focus-visible{outline:2px solid var(--dct-think);outline-offset:1px}",
      ".dct-root[data-degraded='1']{border-style:dashed}",
      ".dct-root[data-pending='1']::after{content:'·';opacity:.85;color:var(--dct-loop);font-size:16px;",
      "padding-inline:3px;line-height:1;font-weight:700}",
      ".dct-root[data-mix='1'][data-pending='1']::after{color:var(--dct-mix)}",
      ".dct-root[data-degraded='1']::after{content:'!';opacity:.5;font-size:10px;padding-inline:3px}",
      // 右键默认菜单（v3.9.0）：fixed + 视口夹取（坐标由 menuPosition 算），深色面板不吃三色档位配色
      ".dct-menu{position:fixed;z-index:2147483000;min-width:156px;padding:6px;border-radius:10px;",
      "border:1px solid rgba(127,127,127,.32);background:rgba(30,32,36,.97);color:#e9e9ec;",
      "box-shadow:0 10px 26px rgba(0,0,0,.38);backdrop-filter:blur(6px);",
      "font-size:12px;line-height:1.35;text-align:left;white-space:nowrap}",
      ".dct-menu-title{font-size:11px;opacity:.6;padding:2px 8px 5px;letter-spacing:.3px}",
      ".dct-menu-item{appearance:none;border:0;background:transparent;color:inherit;font:inherit;",
      "display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border-radius:7px;",
      "cursor:pointer;text-align:left}",
      ".dct-menu-item:hover{background:rgba(127,127,127,.16)}",
      ".dct-menu-item[data-on='1']{font-weight:600}",
      ".dct-menu-check{display:inline-block;width:1em;color:var(--dct-route);font-weight:700}",
      ".dct-menu-reset{opacity:.72;margin-top:2px;border-top:1px solid rgba(127,127,127,.16);border-radius:7px}",
      ".dct-menu-hint{padding:5px 8px 1px;font-size:10px;opacity:.5;white-space:normal;max-width:172px}",
    ].join("");

    function installStyles() {
      try {
        if (typeof document === "undefined") return;
        if (document.getElementById("dct-style")) return;
        var el = document.createElement("style");
        el.id = "dct-style";
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (e) {
        /* 忽略 */
      }
    }

    function fetchRemote(sessionId) {
      return ensurePort()
        .then(function (port) {
          if (!port) return null;
          return fetch(portUrl(port, sessionId, "/state"), { method: "GET", credentials: "omit", cache: "no-store" })
            .then(function (res) {
              // 端口上有东西但不是本插件（旧实例 / 别人的 404）：丢掉缓存，下次重新发现
              if (!res.ok) {
                invalidatePort();
                return null;
              }
              return res.json();
            })
            .then(function (json) {
              return json && typeof json === "object" ? json : null;
            })
            .catch(function () {
              invalidatePort();
              return null;
            });
        })
        .catch(function () {
          return null;
        });
    }

    /**
     * 写回宿主。返回 `{ status, body }`：宿主 1.2.1 起在 POST 响应里直接带档位与 pending，
     * 客户端能省掉一次 GET（老宿主回 `{ok,session,mode,level}`，那就按没有 pending 处理）。
     */
    function pushRemote(sessionId, patch) {
      return ensurePort()
        .then(function (port) {
          if (!port) return { status: 0, body: null };
          return fetch(portUrl(port, sessionId, "/state"), {
            method: "POST",
            credentials: "omit",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          })
            .then(function (res) {
              var code = typeof res.status === "number" ? res.status : res.ok === false ? 0 : 200;
              var body = null;
              try {
                body = res.json ? res.json() : null;
              } catch (e) {
                body = null;
              }
              return Promise.resolve(body)
                .then(function (json) {
                  return { status: code, body: json && typeof json === "object" ? json : null };
                })
                .catch(function () {
                  return { status: code, body: null };
                });
            })
            .catch(function () {
              invalidatePort();
              return { status: 0, body: null };
            });
        })
        .catch(function () {
          return { status: 0, body: null };
        });
    }

    function TierBar(props) {
      var sessionId = resolveSession(props);
      var initial = readLocal(sessionId);
      var state = hooks.useState(initial);
      var value = state[0];
      var setValue = state[1];
      var degraded = hooks.useState(false);
      var isDegraded = degraded[0];
      var setDegraded = degraded[1];
      var meta = hooks.useState(null);
      var remoteMeta = meta[0];
      var setMeta = meta[1];
      var pend = hooks.useState(false);
      var isPending = pend[0];
      var setPending = pend[1];
      // 右键设默认（v3.9.0）：defaults = 当前默认值；menu = 打开中的菜单（null = 关）
      var defaultsState = hooks.useState(readDefaultsLocal());
      var defaults = defaultsState[0];
      var setDefaults = defaultsState[1];
      var menuState = hooks.useState(null);
      var menu = menuState[0];
      var setMenu = menuState[1];

      /** 统一落值入口：本地缓存、pending、降级标记都从这一条走。 */
      function applyState(json) {
        if (!json || (MODES.indexOf(json.mode) < 0 && LEVELS.indexOf(json.level) < 0 && !json.route && !json.agent))
          return false;
        var remote = normalize(json);
        setValue(remote);
        writeLocal(sessionId, remote);
        if (json.labels) setMeta({ labels: json.labels, titles: json.titles || null });
        // 宿主回带的默认值：刷新菜单勾选，同时刷新本地兜底缓存（只缓存，不算用户改过）
        if (json.defaults) {
          var remoteDefaults = normalizeDefaults(json.defaults);
          setDefaults(remoteDefaults);
          writeDefaultsLocal(remoteDefaults);
        }
        setPending(Boolean(json.pending));
        setDegraded(false);
        return true;
      }

      /**
       * 拉一次真值。三种情形：
       * 1) 老宿主没有 knownSession / 或明确认识本会话 → 认领，正常同步
       * 2) 不认识 → 扫端口找认识它的那个；只有一套在跑时直接认（没得选）
       * 3) 两套以上、谁都不认识 → **不认领**：不读不写任何桥，只用本地值（本地值天然属于本应用）
       */
      function pull() {
        return fetchRemote(sessionId).then(function (json) {
          if (!json) {
            ownership.claimed = false;
            setDegraded(true);
            return;
          }
          if (json.knownSession !== false) {
            claim(json);
            return;
          }
          return resolveOwner();
        });
      }

      /** 未认领期间的改动：先记账，认领成功再补写，避免写进别人的状态文件。 */
      var pendingPatch = null;

      /** 默认值只在认领后补写一次：避免同一挂载内反复写，也避免别的窗口刚改过就被本地旧值盖掉。 */
      var defaultsPushed = false;

      /** 认领后落值；顺带把降级标记清掉，并把「未认领期间攒下的改动」补写上去。 */
      function claim(json) {
        ownership.claimed = true;
        var ok = applyState(json);
        // 离线时设过的默认（本地与宿主不一致）在认领后补一次；一致就不写
        if (ok && json.defaults && !defaultsPushed && !sameDefaults(readDefaultsLocal(), json.defaults)) {
          defaultsPushed = true;
          var localDefaults = readDefaultsLocal();
          pushRemote(DEFAULT_SESSION, defaultsPatchOf(localDefaults)).then(function (res) {
            if (res.status === 200) writeDefaultsLocal(localDefaults);
          });
        }
        if (ok && pendingPatch) {
          var patch = pendingPatch;
          pendingPatch = null;
          pushRemote(sessionId, patch).then(function (res) {
            if (res.status === 200 && res.body && "pending" in res.body) {
              applyState(res.body);
              return;
            }
            pull();
          });
        }
        if (!ok) {
          ownership.claimed = false;
          setDegraded(true);
        }
        return ok;
      }

      /**
       * 谁都不认识这个会话：扫一遍端口。
       * - 有 owner（本实例工具写过）→ 切过去
       * - 只有一套 DSH → 它就是我的
       * - 两套以上 → 认不了，降级为「只存本地」，并按 ownerPollMs 轮询等工具落盘
       */
      var pollTimer = null;
      var disposed = false;
      var pollRound = 0;
      var resolving = null;

      function resolveOwner() {
        // 同一时刻只跑一轮扫描（挂载、聚焦、轮询可能同时触发）
        if (resolving) return resolving;
        resolving = scanInstances(sessionId)
          .then(function (list) {
            var owner = null;
            for (var i = 0; i < list.length; i += 1) {
              if (list[i].known) {
                owner = list[i];
                break;
              }
            }
            if (owner) {
              adoptPort(owner.port);
              pollRound = 0;
              resolving = null;
              return claim(owner.state);
            }
            if (list.length === 1) {
              // 机器上只有一套在跑：不存在「连错实例」，直接认
              adoptPort(list[0].port);
              resolving = null;
              return claim(list[0].state);
            }
            // 两套以上且都没认领：只用本地值，别去碰别人的文件
            ownership.claimed = false;
            setDegraded(true);
            resolving = null;
            if (pollRound < CONFIG.ownerPollTries && !disposed) {
              pollRound += 1;
              pollTimer = setTimeout(function () {
                resolveOwner();
              }, CONFIG.ownerPollMs);
            }
            return null;
          })
          .catch(function () {
            resolving = null;
            return null;
          });
        return resolving;
      }

      hooks.useEffect(function () {
        var alive = true;
        var stream = null;
        var retryTimer = null;
        var tries = 0;
        disposed = false;

        // 服务端推送：别的窗口改档后立刻跟上，不用等切窗口
        function connect() {
          ensurePort()
            .then(function (port) {
              if (!alive || !port || typeof EventSource === "undefined") return;
              try {
                if (stream) stream.close();
              } catch (e) {
                /* 忽略 */
              }
              stream = new EventSource(portUrl(port, sessionId, "/events"));
              stream.onmessage = function (event) {
                if (!alive) return;
                try {
                  if (applyState(JSON.parse(event.data))) tries = 0;
                } catch (e) {
                  /* 坏帧忽略 */
                }
              };
              stream.onerror = function () {
                if (!alive) return;
                // readyState=2：连接被彻底关掉，浏览器不会自己重连，得重建一条。
                // 端口也可能换了（宿主重启），顺手作废缓存。
                if (!stream || stream.readyState !== 2) return;
                setDegraded(true);
                invalidatePort();
                if (tries >= CONFIG.maxReconnects) return;
                tries += 1;
                try {
                  stream.close();
                } catch (e) {
                  /* 忽略 */
                }
                retryTimer = setTimeout(connect, CONFIG.reconnectDelay);
              };
            })
            .catch(function () {
              stream = null;
            });
        }
        // 先认准实例再连 SSE：没认准之前不连，免得收到另一套实例的推送
        pull().then(function () {
          if (alive && ownership.claimed) connect();
        });

        // 兜底：SSE 不可用时，切回窗口重新对齐，避免旧值覆盖新值
        var onFocus = function () {
          if (!stream) pull();
          else if (!ownership.claimed) pull();
        };
        try {
          if (typeof window !== "undefined" && window.addEventListener) {
            window.addEventListener("focus", onFocus);
          }
        } catch (e) {
          /* 忽略 */
        }
        return function () {
          alive = false;
          disposed = true;
          if (pollTimer) {
            try {
              clearTimeout(pollTimer);
            } catch (e) {
              /* 忽略 */
            }
          }
          if (retryTimer) {
            try {
              clearTimeout(retryTimer);
            } catch (e) {
              /* 忽略 */
            }
          }
          try {
            if (stream) stream.close();
          } catch (e) {
            /* 忽略 */
          }
          try {
            if (typeof window !== "undefined" && window.removeEventListener) {
              window.removeEventListener("focus", onFocus);
            }
          } catch (e) {
            /* 忽略 */
          }
        };
      }, [sessionId]);

      var mode = value.mode;
      var level = value.level;
      var loop = mode === "loop";
      var counter = value.counter === true;
      var routeOn = Boolean(value.route && value.route.on === true);
      var routeLevel =
        value.route && ROUTE_LEVELS.indexOf(value.route.level) >= 0 ? value.route.level : DEFAULT_ROUTE_LEVEL;
      var labels = resolveLabels(remoteMeta, mode);
      var titles = resolveTitles(remoteMeta, mode);
      var routeLabels = withFallback(resolveLabels(remoteMeta, "route"), FALLBACK_LABELS.route);
      var agentLabels = withFallback(resolveLabels(remoteMeta, "agent"), FALLBACK_LABELS.agent);
      var agentTitles = withFallback(resolveTitles(remoteMeta, "agent"), FALLBACK_TITLES.agent);
      var agentOn = Boolean(value.agent && value.agent.on === true);
      var agentProfile =
        value.agent && AGENT_PROFILES.indexOf(value.agent.profile) >= 0 ? value.agent.profile : DEFAULT_AGENT_PROFILE;
      // 两个轮换格的显示值（v3.5.0）：关 = 本地 / 默认，不再是「开关 + 两档」两段
      var routeDisplay = routeOn ? routeLevel : "off";
      var agentDisplay = agentOn ? agentProfile : "off";
      var routeTitles = withFallback(resolveTitles(remoteMeta, "route"), FALLBACK_TITLES.route);
      var routeNext = ROUTE_CYCLE[(ROUTE_CYCLE.indexOf(routeDisplay) + 1) % ROUTE_CYCLE.length];
      var agentNext = AGENT_CYCLE[(AGENT_CYCLE.indexOf(agentDisplay) + 1) % AGENT_CYCLE.length];

      /** 只提交变化的那一维：换档不动模式/对抗，切模式不动档位/对抗，切对抗不动前两者。 */
      function commit(patch) {
        var nextRoute = value.route;
        if (patch.route) {
          nextRoute = {
            on: typeof patch.route.on === "boolean" ? patch.route.on : value.route.on,
            level: ROUTE_LEVELS.indexOf(patch.route.level) >= 0 ? patch.route.level : value.route.level,
          };
        }
        var nextAgent = value.agent;
        if (patch.agent) {
          nextAgent = {
            on: typeof patch.agent.on === "boolean" ? patch.agent.on : value.agent.on,
            profile:
              AGENT_PROFILES.indexOf(patch.agent.profile) >= 0 ? patch.agent.profile : value.agent.profile,
          };
        }
        var normalized = normalize({
          mode: patch.mode || mode,
          level: patch.level || level,
          counter: typeof patch.counter === "boolean" ? patch.counter : counter,
          route: nextRoute,
          agent: nextAgent,
        });
        setValue(normalized);
        writeLocal(sessionId, normalized);
        // 没认准实例：先只存本地，记账等认领后再补写（绝不先写别人的状态文件）
        if (!ownership.claimed) {
          pendingPatch = patch;
          setDegraded(true);
          return;
        }
        pushRemote(sessionId, patch).then(function (res) {
          if (res.status !== 200) {
            setDegraded(true);
            pull(); // 写失败：以宿主里的值为准
            return;
          }
          // 宿主 1.2.1 起在 POST 响应里直接带 pending / turnLocked：省掉这次点击后的第二次 GET。
          // 老宿主不回 pending，就退回拉一次。
          if (res.body && "pending" in res.body && applyState(res.body)) return;
          pull();
        });
      }

      function pickLevel(next) {
        if (LEVELS.indexOf(next) < 0) return;
        commit({ level: next });
      }

      function toggleCounter() {
        commit({ counter: !counter });
      }

      function toggleMode() {
        commit({ mode: loop ? "think" : "loop" });
      }

      /**
       * 检索格轮换（v3.5.0）：本地 → 增量 → 全量 → 本地。
       * 只提交变的那一维：已在增量档时开检索不必再写 level。
       */
      function cycleRoute() {
        if (!routeOn) {
          commit(
            routeLevel === DEFAULT_ROUTE_LEVEL ? { route: { on: true } } : { route: { on: true, level: DEFAULT_ROUTE_LEVEL } },
          );
          return;
        }
        if (routeLevel === "high") {
          commit({ route: { level: "max" } });
          return;
        }
        commit({ route: { on: false } });
      }

      /** 代理格轮换（v3.5.0）：默认 → 效率 → 性能 → 默认。同样只提交变的一维。 */
      function cycleAgent() {
        if (!agentOn) {
          commit(
            agentProfile === DEFAULT_AGENT_PROFILE
              ? { agent: { on: true } }
              : { agent: { on: true, profile: DEFAULT_AGENT_PROFILE } },
          );
          return;
        }
        if (agentProfile === "efficiency") {
          commit({ agent: { profile: "performance" } });
          return;
        }
        commit({ agent: { on: false } });
      }

      /** 打开右键菜单：只认三格（检索 / 代理 / 对抗）。 */
      function openMenu(kind, event) {
        try {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
        } catch (e) {
          /* 忽略 */
        }
        var pos = menuPosition(event, { width: 156, height: 148 });
        setMenu({ kind: kind, x: pos.x, y: pos.y });
      }

      /** 选一个默认项：本地先落（离线也生效），再写宿主 default 条目；随后拉一次，让继承默认的会话跟上。 */
      function applyDefault(kind, id) {
        var patch = defaultPatch(kind, id);
        var next = mergeDefaults(defaults, patch);
        setDefaults(next);
        writeDefaultsLocal(next);
        setMenu(null);
        if (!ownership.claimed) {
          setDegraded(true);
          return;
        }
        pushRemote(DEFAULT_SESSION, patch).then(function (res) {
          if (res.status !== 200) {
            setDegraded(true);
            return;
          }
          pull();
        });
      }

      /** 恢复内置默认（关 / 增量 / 关 / 效率 / 关）：一次写全三维。 */
      function resetDefaults() {
        var next = normalizeDefaults(BUILTIN_DEFAULTS);
        setDefaults(next);
        writeDefaultsLocal(next);
        setMenu(null);
        if (!ownership.claimed) {
          setDegraded(true);
          return;
        }
        pushRemote(DEFAULT_SESSION, defaultsPatchOf(next)).then(function (res) {
          if (res.status !== 200) {
            setDegraded(true);
            return;
          }
          pull();
        });
      }

      // 点空白处 / Esc 关菜单。用 click 而不是 mousedown：mousedown 会在菜单项被点之前就把它拆掉
      hooks.useEffect(function () {
        if (!menu) return undefined;
        var doc = typeof document !== "undefined" ? document : null;
        if (!doc || typeof doc.addEventListener !== "function") return undefined;
        var onDown = function () {
          setMenu(null);
        };
        var onKey = function (event) {
          if (event && event.key === "Escape") setMenu(null);
        };
        doc.addEventListener("click", onDown);
        doc.addEventListener("keydown", onKey);
        return function () {
          if (typeof doc.removeEventListener !== "function") return;
          doc.removeEventListener("click", onDown);
          doc.removeEventListener("keydown", onKey);
        };
      }, [menu]);

      var cells = [];
      LEVELS.forEach(function (l) {
        cells.push(
          React.createElement(
            "button",
            {
              key: l,
              type: "button",
              className: "dct-cell",
              "data-on": l === level ? "1" : "0",
              "data-level": l,
              "aria-pressed": l === level ? "true" : "false",
              onClick: function () {
                pickLevel(l);
              },
            },
            labels[l],
          ),
        );
      });

      cells.push(
        React.createElement("span", { key: "sep", className: "dct-sep", "aria-hidden": "true" }),
        React.createElement(
          "button",
          {
            key: "mode",
            type: "button",
            className: "dct-cell dct-mode",
            "data-on": loop ? "1" : "0",
            "data-mode-toggle": loop ? "loop" : "think",
            "aria-pressed": loop ? "true" : "false",
            onClick: toggleMode,
          },
          "循环",
        ),
        React.createElement("span", { key: "sep2", className: "dct-sep", "aria-hidden": "true" }),
        React.createElement(
          "button",
          {
            key: "counter",
            type: "button",
            className: "dct-cell dct-counter",
            "data-on": counter ? "1" : "0",
            "data-counter-toggle": counter ? "on" : "off",
            "aria-pressed": counter ? "true" : "false",
            title: "对抗审；右键设默认（开 / 关）",
            onContextMenu: function (event) {
              openMenu("counter", event);
            },
            onClick: toggleCounter,
          },
          "对抗",
        ),
        React.createElement("span", { key: "sep3", className: "dct-sep", "aria-hidden": "true" }),
        // 检索格（v3.5.0）：排在选项条末尾，点一下 本地 → 增量 → 全量 → 本地
        React.createElement(
          "button",
          {
            key: "route",
            type: "button",
            className: "dct-cell dct-routecell",
            "data-on": routeOn ? "1" : "0",
            "data-route-cycle": routeDisplay,
            "data-route-level": routeLevel,
            "data-route-toggle": routeOn ? "on" : "off",
            "aria-pressed": routeOn ? "true" : "false",
            title: routeTitles[routeDisplay] + "；点击切到" + routeLabels[routeNext] + "；右键设默认",
            onContextMenu: function (event) {
              openMenu("route", event);
            },
            onClick: cycleRoute,
          },
          routeLabels[routeDisplay],
        ),
        React.createElement("span", { key: "sep4", className: "dct-sep", "aria-hidden": "true" }),
        // 代理格（v3.5.0）：末尾第二格，一个格子轮换 默认 → 效率 → 性能 → 默认
        React.createElement(
          "button",
          {
            key: "agent",
            type: "button",
            className: "dct-cell dct-agentcell",
            "data-on": agentOn ? "1" : "0",
            "data-agent-cycle": agentDisplay,
            "data-agent-profile": agentProfile,
            "data-agent-toggle": agentOn ? "on" : "off",
            "aria-pressed": agentOn ? "true" : "false",
            title: agentTitles[agentDisplay] + "；点击切到" + agentLabels[agentNext] + "；右键设默认",
            onContextMenu: function (event) {
              openMenu("agent", event);
            },
            onClick: cycleAgent,
          },
          agentLabels[agentDisplay],
        ),
      );

      // 右键默认菜单：fixed 定位（视口坐标），画在根节点里，不做 portal（ReactDOM 不在依赖里）
      if (menu) {
        var menuTitle = menu.kind === "route" ? "检索 · 默认" : menu.kind === "agent" ? "代理 · 默认" : "对抗 · 默认";
        var optionNodes = defaultOptions(menu.kind).map(function (opt) {
          var on = currentDefaultId(menu.kind, defaults) === opt.id;
          return React.createElement(
            "button",
            {
              key: opt.id,
              type: "button",
              className: "dct-menu-item",
              role: "menuitemradio",
              "aria-checked": on ? "true" : "false",
              "data-on": on ? "1" : "0",
              "data-default-option": opt.id,
              onClick: function () {
                applyDefault(menu.kind, opt.id);
              },
            },
            React.createElement("span", { key: "check", className: "dct-menu-check", "aria-hidden": "true" }, on ? "✓" : ""),
            opt.label,
          );
        });
        cells.push(
          React.createElement(
            "div",
            {
              key: "menu",
              className: "dct-menu",
              role: "menu",
              "aria-label": menuTitle,
              style: { left: menu.x + "px", top: menu.y + "px" },
              onContextMenu: function (event) {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
              },
            },
            React.createElement("div", { key: "title", className: "dct-menu-title" }, menuTitle),
            optionNodes,
            React.createElement(
              "button",
              {
                key: "reset",
                type: "button",
                className: "dct-menu-item dct-menu-reset",
                onClick: resetDefaults,
              },
              React.createElement("span", { key: "check", className: "dct-menu-check", "aria-hidden": "true" }, ""),
              "恢复内置默认",
            ),
            React.createElement(
              "div",
              { key: "hint", className: "dct-menu-hint" },
              "只影响新会话；已单独设过档的会话不变",
            ),
          ),
        );
      }

      return React.createElement(
        "div",
        {
          className: "dct-root",
          role: "group",
          "aria-label":
            (loop ? "循环档位" : "思考档位") +
            "（含检索·" +
            routeLabels[routeDisplay] +
            "；代理·" +
            agentLabels[agentDisplay] +
            "）",
          "data-dsh-tier": "1",
          "data-mode": mode,
          "data-degraded": isDegraded ? "1" : "0",
          "data-pending": isPending ? "1" : "0",
          "data-counter": counter ? "1" : "0",
          "data-route": routeOn ? "1" : "0",
          "data-route-level": routeLevel,
          "data-route-cycle": routeDisplay,
          "data-agent": agentOn ? "1" : "0",
          "data-agent-profile": agentProfile,
          "data-agent-cycle": agentDisplay,
          // 循环 + 对抗 同开：CSS 靠这一位把前三级条染橙
          "data-mix": loop && counter ? "1" : "0",
        },
        cells,
      );
    }

    var inject = ["slots", "sessions"];

    /** 诊断开着吗：默认关，`localStorage.setItem("dsh-tier-debug","1")` 后才往宿主写 jsonl（那个文件没有轮转）。 */
    function debugOn() {
      if (CONFIG.debug) return true;
      try {
        return localStorage.getItem(DEBUG_KEY) === "1";
      } catch (e) {
        return false;
      }
    }

    /** 诊断：把注册过程中的事件回报宿主（定位插槽问题用，默认关闭）。 */
    function report(event, extra) {
      if (!debugOn()) return;
      try {
        fetch(bridgeUrl("client", "/debug"), {
          method: "POST",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: event,
            extra: extra || null,
            href: typeof location !== "undefined" ? String(location.href).slice(0, 160) : null,
          }),
        }).catch(function () {});
      } catch (e) {
        /* 忽略 */
      }
    }

    var registered = false;

    /** 依次尝试候选插槽：新版本改过槽名，谁在就用谁。 */
    function trySlot(ctx, name, label) {
      if (registered) return;
      try {
        report("inject-call", { slot: name });
        ctx.slots.inject(name, function () {
          report("inject-fired", { slot: name });
          if (registered) return;
          try {
            ctx.slots.register(
              {
                name: name,
                id: "tier-bar",
                order: 10,
                label: function () {
                  return label;
                },
                inject: function (sessionId) {
                  return { sessionId: sessionId };
                },
              },
              function SlotComponent(props) {
                return React.createElement(TierBar, { sessionId: props && props.sessionId });
              },
            );
            registered = true;
            report("registered", { slot: name });
          } catch (error) {
            report("register-error", { slot: name, message: String((error && error.message) || error) });
          }
        });
      } catch (error) {
        report("inject-error", { slot: name, message: String((error && error.message) || error) });
      }
    }

    function apply(ctx) {
      installStyles();
      if (debugOn()) {
        report("apply", {
          slotsApi: (function () {
            try {
              return ctx && ctx.slots ? Object.keys(ctx.slots).slice(0, 40) : null;
            } catch (e) {
              return null;
            }
          })(),
          sessionsApi: (function () {
            try {
              return ctx && ctx.sessions ? Object.keys(ctx.sessions).slice(0, 40) : null;
            } catch (e) {
              return null;
            }
          })(),
        });
      }
      var candidates = ["conversation.input.right", "conversation.input.dock", "conversation.input.left"];
      trySlot(ctx, candidates[0], "档位（思考 / 循环）");
      try {
        setTimeout(function () {
          trySlot(ctx, candidates[1], "档位（思考 / 循环）");
        }, 900);
        setTimeout(function () {
          trySlot(ctx, candidates[2], "档位（思考 / 循环）");
        }, 1800);
      } catch (e) {
        /* 忽略 */
      }
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      LEVELS: LEVELS,
      MODES: MODES,
      ROUTE_LEVELS: ROUTE_LEVELS,
      ROUTE_CYCLE: ROUTE_CYCLE,
      AGENT_PROFILES: AGENT_PROFILES,
      AGENT_CYCLE: AGENT_CYCLE,
      DEFAULT_AGENT_PROFILE: DEFAULT_AGENT_PROFILE,
      DEFAULT_ROUTE_LEVEL: DEFAULT_ROUTE_LEVEL,
      FALLBACK_LABELS: FALLBACK_LABELS,
      FALLBACK_TITLES: FALLBACK_TITLES,
      SLOT_NAME: SLOT_NAME,
      ENTRY_ORDER: ENTRY_ORDER,
      DEFAULT_MODE: DEFAULT_MODE,
      DEFAULT_LEVEL: DEFAULT_LEVEL,
      DEFAULTS_KEY: DEFAULTS_KEY,
      BUILTIN_DEFAULTS: BUILTIN_DEFAULTS,
      readDefaultsLocal: readDefaultsLocal,
      writeDefaultsLocal: writeDefaultsLocal,
      normalizeDefaults: normalizeDefaults,
      sameDefaults: sameDefaults,
      defaultOptions: defaultOptions,
      currentDefaultId: currentDefaultId,
      defaultPatch: defaultPatch,
      mergeDefaults: mergeDefaults,
      defaultsPatchOf: defaultsPatchOf,
      menuPosition: menuPosition,
      CONFIG: CONFIG,
      CSS: CSS,
      TierBar: TierBar,
      barTitle: barTitle,
      debugOn: debugOn,
      invalidatePort: invalidatePort,
      resolveLabels: resolveLabels,
      resolveTitles: resolveTitles,
      withFallback: withFallback,
      resolveSession: resolveSession,
      bridgeUrl: bridgeUrl,
      scanInstances: scanInstances,
      ownership: ownership,
    };

    return module.exports;
  },
});
