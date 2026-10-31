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

