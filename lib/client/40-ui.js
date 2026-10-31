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

