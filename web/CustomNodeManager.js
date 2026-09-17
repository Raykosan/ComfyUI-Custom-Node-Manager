import { app } from "../../../scripts/app.js";

console.log("🦊 CNM JS v7 (switch version) loaded at", new Date().toLocaleTimeString());

const STORAGE_KEY = "CustomNodeManager.ShowTopbarIcon";

let _allNodes = [];
let _query = "";
let _listSource = "";

// =======================================================================
//  Регистрация
// =======================================================================

app.registerExtension({
    name: "CustomNodeManager",

    async setup() {
        app.ui.settings.addSetting({
            id: "CustomNodeManager.Open",
            name: "Custom Node Manager",
            type: () => buildSettingsEntry(),
        });

        if (localStorage.getItem(STORAGE_KEY) === "true") {
            waitForActionBar((bar) => injectTopbarButton(bar));
        }
    },
});

// =======================================================================
//  Settings entry
// =======================================================================

function buildSettingsEntry() {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";

    const toggleRow = document.createElement("label");
    toggleRow.style.display = "flex";
    toggleRow.style.alignItems = "center";
    toggleRow.style.gap = "10px";
    toggleRow.style.cursor = "pointer";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = localStorage.getItem(STORAGE_KEY) === "true";
    toggle.onchange = () => {
        localStorage.setItem(STORAGE_KEY, toggle.checked ? "true" : "false");
        const existing = document.getElementById("cnm-topbar-btn");
        if (toggle.checked) {
            waitForActionBar((bar) => injectTopbarButton(bar));
        } else if (existing) {
            existing.remove();
        }
    };

    const toggleLabel = document.createElement("span");
    toggleLabel.textContent = "Show icon in top menu";
    toggleLabel.style.color = "var(--fg-color)";

    toggleRow.appendChild(toggle);
    toggleRow.appendChild(toggleLabel);

    const openBtn = document.createElement("button");
    openBtn.className = "cnm-btn cnm-btn-primary";
    openBtn.textContent = "Open Custom Node Manager";
    openBtn.style.alignSelf = "flex-start";
    openBtn.onclick = openManagerModal;

    container.appendChild(toggleRow);
    container.appendChild(openBtn);
    return container;
}

// =======================================================================
//  Топбар
// =======================================================================

function waitForActionBar(callback) {
    const existing = document.querySelector(".actionbar-container");
    if (existing) return callback(existing);

    const observer = new MutationObserver(() => {
        const bar = document.querySelector(".actionbar-container");
        if (bar) {
            observer.disconnect();
            callback(bar);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
}

function injectTopbarButton(actionBar) {
    if (document.getElementById("cnm-topbar-btn")) return;

    const btn = document.createElement("button");
    btn.id = "cnm-topbar-btn";
    btn.className = "comfyui-button";
    btn.title = "Custom Node Manager";
    btn.innerHTML = `<span style="font-size:18px;line-height:1;">🦊</span>`;
    btn.onclick = openManagerModal;

    Object.assign(btn.style, {
        width: "38px", height: "100%", minHeight: "32px", maxHeight: "40px",
        padding: "0", margin: "0 5px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        background: "var(--comfy-input-bg)", color: "var(--fg-color)",
        border: "1px solid var(--border-color)", borderRadius: "8px",
        boxSizing: "border-box",
    });
    btn.onmouseenter = () => { btn.style.background = "var(--comfy-menu-secondary-bg)"; };
    btn.onmouseleave = () => { btn.style.background = "var(--comfy-input-bg)"; };

    const runContainer = actionBar.querySelector(".flex.h-full.items-center");
    if (runContainer) {
        actionBar.insertBefore(btn, runContainer);
    } else {
        actionBar.appendChild(btn);
    }
}

// =======================================================================
//  Модальное окно менеджера
// =======================================================================

function openManagerModal() {
    if (document.getElementById("cnm-overlay")) return;

    _allNodes = [];
    _query = "";
    _listSource = "";

    const overlay = document.createElement("div");
    overlay.id = "cnm-overlay";
    overlay.className = "cnm-overlay";
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    const modal = document.createElement("div");
    modal.className = "cnm-modal";

    const header = document.createElement("div");
    header.className = "cnm-header";
    header.innerHTML = `<div class="cnm-title">🦊 Custom Node Manager <span style="font-size:11px;color:var(--descrip-text);font-weight:400;">(js v7)</span></div>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "cnm-btn cnm-btn-small";
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    const toolbar = document.createElement("div");
    toolbar.className = "cnm-toolbar";

    const installBtn = document.createElement("button");
    installBtn.className = "cnm-btn cnm-btn-primary";
    installBtn.textContent = "➕ Install";
    installBtn.onclick = installFromUrl;

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "cnm-btn";
    refreshBtn.textContent = "🔄 Rescan";
    refreshBtn.onclick = () => loadNodes(refreshBtn, { preferCache: false });

    const searchWrap = document.createElement("div");
    searchWrap.className = "cnm-search-wrap";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "cnm-search";
    searchInput.placeholder = "🔍 filter…  (-word to exclude)";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.addEventListener("input", () => {
        _query = searchInput.value;
        applyFilterAndRender();
    });
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            searchInput.value = "";
            _query = "";
            applyFilterAndRender();
            searchInput.blur();
        }
    });
    searchWrap.appendChild(searchInput);

    const statusEl = document.createElement("span");
    statusEl.className = "cnm-status";

    toolbar.appendChild(installBtn);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(searchWrap);
    toolbar.appendChild(statusEl);

    const listEl = document.createElement("div");
    listEl.className = "cnm-list";
    listEl.id = "cnm-list";

    modal.appendChild(header);
    modal.appendChild(toolbar);
    modal.appendChild(listEl);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    injectStyles();
    loadNodes(refreshBtn, { preferCache: true });
}

// =======================================================================
//  Загрузка списка
// =======================================================================

async function loadNodes(refreshBtn, { preferCache = false } = {}) {
    const list = document.getElementById("cnm-list");
    if (!list) return;

    if (refreshBtn) refreshBtn.disabled = true;

    let nodes = null;

    if (preferCache) {
        try {
            const res = await fetch("/custom_node_manager/cache", { cache: "no-store" });
            const cached = await res.json();
            const arr = Object.values(cached.nodes || {});
            if (arr.length > 0) {
                nodes = arr;
                _listSource = `cached · ${cached.updated || ""}`;
            }
        } catch (e) { /* fallthrough */ }
    }

    if (!nodes) {
        list.innerHTML = `<div class="cnm-empty">Scanning…</div>`;
        setStatus("");
        try {
            const res = await fetch("/custom_node_manager/scan", { cache: "no-store" });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "scan failed");
            nodes = data.nodes || [];
            _listSource = `scanned · ${data.updated || ""}`;
        } catch (e) {
            list.innerHTML = `<div class="cnm-empty cnm-error">Error: ${e.message}</div>`;
            if (refreshBtn) refreshBtn.disabled = false;
            return;
        }
    }

    _allNodes = nodes;
    applyFilterAndRender();
    if (refreshBtn) refreshBtn.disabled = false;
}

// =======================================================================
//  Фильтр
// =======================================================================

function filterNodes(nodes, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return nodes;

    const tokens = q.split(/\s+/).filter(Boolean);
    const includes = tokens.filter((t) => !t.startsWith("-"));
    const excludes = tokens.filter((t) => t.startsWith("-")).map((t) => t.slice(1)).filter(Boolean);

    return nodes.filter((n) => {
        const hay = [
            n.folder || "",
            n.name || "",
            n.description || "",
            n.git_url || "",
        ].join(" ").toLowerCase();

        for (const t of excludes) if (hay.includes(t)) return false;
        for (const t of includes) if (!hay.includes(t)) return false;
        return true;
    });
}

function applyFilterAndRender() {
    const list = document.getElementById("cnm-list");
    if (!list) return;

    const filtered = filterNodes(_allNodes, _query);
    renderNodes(list, filtered);

    const total = _allNodes.length;
    const shown = filtered.length;
    const counter = _query.trim() ? `${shown} / ${total}` : `${total}`;
    setStatus(`${_listSource} · ${counter} nodes`);
}

function setStatus(text) {
    const el = document.querySelector(".cnm-status");
    if (el) el.textContent = text;
}

// =======================================================================
//  Рендер списка
// =======================================================================

function renderNodes(list, nodes) {
    list.innerHTML = "";
    if (!nodes.length) {
        const msg = _query.trim()
            ? `No nodes match “${escapeHtml(_query)}”.`
            : `No nodes found in custom_nodes.`;
        list.innerHTML = `<div class="cnm-empty">${msg}</div>`;
        return;
    }

    nodes.sort((a, b) => {
        if (a.is_node !== b.is_node) return a.is_node ? -1 : 1;
        return (a.folder || "").localeCompare(b.folder || "");
    });

    for (const node of nodes) {
        list.appendChild(renderNodeRow(node));
    }
}

function renderNodeRow(node) {
    const row = document.createElement("div");
    row.className = "cnm-row";
    if (!node.is_node) row.classList.add("cnm-row-warn");

    const head = document.createElement("div");
    head.className = "cnm-row-head";

    const title = document.createElement("div");
    title.className = "cnm-row-title";
    title.textContent = node.folder;

    const badges = document.createElement("div");
    badges.className = "cnm-badges";
    if (node.tag) badges.appendChild(badge(node.tag, "tag"));
    if (node.branch) badges.appendChild(badge(node.branch, "branch"));
    if (node.commit_short) badges.appendChild(badge(node.commit_short, "commit"));
    if (node.dirty) badges.appendChild(badge("dirty", "warn"));
    if (!node.is_node) badges.appendChild(badge("not a node", "warn"));

    head.appendChild(title);
    head.appendChild(badges);
    row.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "cnm-row-meta";
    if (node.git_url) {
        const a = document.createElement("a");
        a.href = node.git_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = node.git_url;
        a.className = "cnm-link";
        meta.appendChild(a);
    } else {
        const span = document.createElement("span");
        span.textContent = "no git remote";
        span.className = "cnm-muted";
        meta.appendChild(span);
    }
    row.appendChild(meta);

    if (node.description) {
        const desc = document.createElement("div");
        desc.className = "cnm-row-desc";
        desc.textContent = node.description;
        row.appendChild(desc);
    }

    const actions = document.createElement("div");
    actions.className = "cnm-actions";

    const switchBtn = document.createElement("button");
    switchBtn.className = "cnm-btn cnm-btn-primary";
    switchBtn.textContent = "Switch Version";
    switchBtn.disabled = !node.git_url;
    switchBtn.onclick = () => askAndSwitchVersion(node);
    actions.appendChild(switchBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "cnm-btn cnm-btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.disabled = !node.is_node;
    removeBtn.onclick = () => confirmAndRemove(node);
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    return row;
}

function badge(text, kind) {
    const b = document.createElement("span");
    b.className = `cnm-badge cnm-badge-${kind}`;
    b.textContent = text;
    return b;
}

// =======================================================================
//  Версии
// =======================================================================

async function _fetchVersions(folder) {
    try {
        const res = await fetch(
            `/custom_node_manager/versions/${encodeURIComponent(folder)}`,
            { cache: "no-store" }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.success ? data : null;
    } catch (e) {
        return null;
    }
}

// =======================================================================
//  Действия
// =======================================================================

async function installFromUrl() {
    const res = await cnmPrompt({
        title: "Install from Git URL",
        message: "Клонирует репозиторий в custom_nodes и установит зависимости из requirements.txt.",
        fields: [
            {
                id: "url",
                label: "Git URL",
                placeholder: "https://github.com/owner/repo",
                required: true,
                autofocus: true,
            },
            {
                id: "version",
                label: "Version (optional)",
                placeholder: "tag / branch / commit",
            },
        ],
        okText: "Install",
    });
    if (!res) return;

    await runTask({
        url: "/custom_node_manager/install",
        body: { git_url: res.url.trim(), version: (res.version || "").trim() || null },
        title: `Installing ${res.url.trim()}`,
    });
}

async function askAndSwitchVersion(node) {
    const versions = await _fetchVersions(node.folder);

    if (!versions || !versions.current) {
        await cnmAlert({
            title: "Failed to read versions",
            message:
                "Не удалось прочитать список версий. Проверьте, что у ноды есть .git " +
                "и она не повреждена.",
            danger: true,
        });
        return;
    }

    const choice = await cnmVersionPicker({
        title: `Switch Version — ${node.folder}`,
        branch: versions.current.branch,
        currentTag: versions.current.tag,
        tags: versions.tags || [],
    });
    if (!choice) return;

    if (choice.kind === "pull") {
        await runTask({
            url: "/custom_node_manager/update",
            body: { folder: node.folder, version: null },
            title: `Pull latest — ${node.folder}`,
        });
    } else {
        await runTask({
            url: "/custom_node_manager/update",
            body: { folder: node.folder, version: choice.ref },
            title: `Checkout ${node.folder} → ${choice.ref}`,
        });
    }
}

async function confirmAndRemove(node) {
    const ok = await cnmConfirm({
        title: `Remove ${node.folder}?`,
        message:
            "Папка будет удалена полностью, включая .git и все локальные файлы. " +
            "Это действие необратимо.",
        okText: "Remove",
        danger: true,
    });
    if (!ok) return;

    await runTask({
        url: "/custom_node_manager/remove",
        body: { folder: node.folder },
        title: `Removing ${node.folder}`,
    });
}

// =======================================================================
//  Задачи
// =======================================================================

async function runTask({ url, body, title }) {
    let taskId;
    console.log("🦊 CNM runTask →", "POST", url, body);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
        });

        const raw = await res.text();

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} — ${raw.slice(0, 200)}`);
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
        }

        if (!data.success) throw new Error(data.error || "request failed");
        taskId = data.task_id;
    } catch (e) {
        console.error("🦊 CNM runTask error:", e);
        await cnmAlert({
            title: "Task failed to start",
            message: e.message,
            danger: true,
        });
        return;
    }

    showTaskPanel(title, taskId);
}

function showTaskPanel(title, taskId) {
    let panel = document.getElementById("cnm-task-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "cnm-task-panel";
        panel.className = "cnm-task-panel";
        const modal = document.querySelector(".cnm-modal");
        if (modal) modal.appendChild(panel);
    }

    panel.innerHTML = `
        <div class="cnm-task-title">${escapeHtml(title)}</div>
        <div class="cnm-task-progress" id="cnm-task-progress">queued…</div>
        <div class="cnm-task-log" id="cnm-task-log"></div>
        <div class="cnm-task-actions">
            <button class="cnm-btn cnm-btn-small" id="cnm-task-close">Hide</button>
            <button class="cnm-btn cnm-btn-small cnm-btn-warning" id="cnm-task-restart" style="display:none">
                🔄 Restart ComfyUI
            </button>
        </div>
    `;
    panel.style.display = "flex";

    document.getElementById("cnm-task-close").onclick = () => {
        panel.style.display = "none";
    };

    let polling = true;
    const progressEl = document.getElementById("cnm-task-progress");
    const logEl = document.getElementById("cnm-task-log");

    async function poll() {
        if (!polling) return;
        try {
            const res = await fetch(`/custom_node_manager/task/${taskId}`, { cache: "no-store" });
            const t = await res.json();

            if (t.progress) progressEl.textContent = t.progress;

            if (t.log && t.log.length) {
                logEl.innerHTML = t.log
                    .slice(-8)
                    .map((l) => `<div>${escapeHtml(l)}</div>`)
                    .join("");
                logEl.scrollTop = logEl.scrollHeight;
            }

            if (t.status === "done") {
                polling = false;
                progressEl.textContent = "✅ Готово";
                progressEl.classList.add("cnm-task-ok");
                progressEl.classList.remove("cnm-task-err");

                const restartBtn = document.getElementById("cnm-task-restart");
                restartBtn.style.display = "inline-block";
                restartBtn.onclick = async () => {
                    restartBtn.disabled = true;
                    restartBtn.textContent = "Restarting…";
                    try {
                        await fetch("/custom_node_manager/restart", { method: "POST" });
                    } catch (e) {}
                    setTimeout(() => pollPing(restartBtn), 5000);
                };

                const refreshBtn = document.querySelector(".cnm-toolbar .cnm-btn:not(.cnm-btn-primary)");
                if (refreshBtn) loadNodes(refreshBtn, { preferCache: false });
                return;
            }

            if (t.status === "error") {
                polling = false;
                progressEl.textContent = `❌ Ошибка: ${t.error || "unknown"}`;
                progressEl.classList.add("cnm-task-err");
                progressEl.classList.remove("cnm-task-ok");
                return;
            }
        } catch (e) { /* продолжаем опрос */ }
        setTimeout(poll, 1500);
    }

    poll();
}

function pollPing(restartBtn) {
    let attempts = 0;
    const maxAttempts = 30;
    const interval = setInterval(async () => {
        attempts++;
        try {
            const res = await fetch("/custom_node_manager/ping", { cache: "no-store" });
            if (res.ok) {
                clearInterval(interval);
                window.location.reload();
                return;
            }
        } catch (e) {}
        if (attempts >= maxAttempts) {
            clearInterval(interval);
            restartBtn.disabled = false;
            restartBtn.textContent = "🔄 Restart ComfyUI";
        }
    }, 2000);
}

// =======================================================================
//  Диалог: prompt
// =======================================================================

function cnmPrompt(opts) {
    return new Promise((resolve) => {
        const { title, message, fields = [], okText = "OK", cancelText = "Cancel", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({ title, danger });

        if (message) {
            const msg = document.createElement("div");
            msg.className = "cnm-pop-message";
            msg.textContent = message;
            body.appendChild(msg);
        }

        const inputs = {};
        for (const f of fields) {
            const wrap = document.createElement("div");
            wrap.className = "cnm-pop-field";

            const label = document.createElement("label");
            label.className = "cnm-pop-label";
            label.textContent = f.label || f.id;
            if (f.required) {
                const req = document.createElement("span");
                req.className = "cnm-pop-required";
                req.textContent = " *";
                label.appendChild(req);
            }
            wrap.appendChild(label);

            const input = document.createElement("input");
            input.type = f.type || "text";
            input.className = "cnm-pop-input";
            input.placeholder = f.placeholder || "";
            input.autocomplete = "off";
            input.spellcheck = false;
            if (f.value !== undefined) input.value = f.value;
            if (f.autofocus) input.dataset.autofocus = "1";
            wrap.appendChild(input);

            body.appendChild(wrap);
            inputs[f.id] = input;
        }

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "cnm-btn";
        cancelBtn.textContent = cancelText;

        const okBtn = document.createElement("button");
        okBtn.className = danger ? "cnm-btn cnm-btn-danger" : "cnm-btn cnm-btn-primary";
        okBtn.textContent = okText;

        footer.appendChild(cancelBtn);
        footer.appendChild(okBtn);

        const close = (result) => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(result);
        };

        const trySubmit = () => {
            const values = {};
            for (const f of fields) {
                const v = (inputs[f.id].value || "").trim();
                if (f.required && !v) {
                    inputs[f.id].classList.add("cnm-pop-input-invalid");
                    inputs[f.id].focus();
                    return;
                }
                values[f.id] = v;
            }
            close(values);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                close(null);
            } else if (e.key === "Enter") {
                if (!e.shiftKey) {
                    e.preventDefault(); e.stopPropagation();
                    trySubmit();
                }
            }
        };

        cancelBtn.onclick = () => close(null);
        okBtn.onclick = trySubmit;
        overlay.onclick = (e) => { if (e.target === overlay) close(null); };
        document.addEventListener("keydown", onKey, true);

        const first = fields.find((f) => f.autofocus) || fields[0];
        if (first) {
            requestAnimationFrame(() => inputs[first.id].focus());
        } else {
            requestAnimationFrame(() => okBtn.focus());
        }
    });
}

// =======================================================================
//  Диалог: confirm
// =======================================================================

function cnmConfirm(opts) {
    return new Promise((resolve) => {
        const { title, message, okText = "OK", cancelText = "Cancel", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({ title, danger });

        const msg = document.createElement("div");
        msg.className = "cnm-pop-message";
        msg.textContent = message || "";
        body.appendChild(msg);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "cnm-btn";
        cancelBtn.textContent = cancelText;

        const okBtn = document.createElement("button");
        okBtn.className = danger ? "cnm-btn cnm-btn-danger" : "cnm-btn cnm-btn-primary";
        okBtn.textContent = okText;

        footer.appendChild(cancelBtn);
        footer.appendChild(okBtn);

        const close = (result) => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(result);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                close(false);
            } else if (e.key === "Enter") {
                e.preventDefault(); e.stopPropagation();
                close(true);
            }
        };

        cancelBtn.onclick = () => close(false);
        okBtn.onclick = () => close(true);
        overlay.onclick = (e) => { if (e.target === overlay) close(false); };
        document.addEventListener("keydown", onKey, true);

        requestAnimationFrame(() => okBtn.focus());
    });
}

// =======================================================================
//  Диалог: alert
// =======================================================================

function cnmAlert(opts) {
    return new Promise((resolve) => {
        const { title, message, okText = "OK", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({ title, danger });

        const msg = document.createElement("div");
        msg.className = "cnm-pop-message";
        msg.textContent = message || "";
        body.appendChild(msg);

        const okBtn = document.createElement("button");
        okBtn.className = danger ? "cnm-btn cnm-btn-danger" : "cnm-btn cnm-btn-primary";
        okBtn.textContent = okText;
        footer.appendChild(okBtn);

        const close = () => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve();
        };

        const onKey = (e) => {
            if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault(); e.stopPropagation();
                close();
            }
        };

        okBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        document.addEventListener("keydown", onKey, true);

        requestAnimationFrame(() => okBtn.focus());
    });
}

// =======================================================================
//  Диалог: version picker
// =======================================================================

function cnmVersionPicker({ title, branch, currentTag, tags }) {
    return new Promise((resolve) => {
        const { overlay, body, footer } = _buildDialogShell({ title });

        const listWrap = document.createElement("div");
        listWrap.className = "cnm-ver-list";

        // --- Latest on <branch> ---
        const branchName = (branch && branch !== "HEAD") ? branch : null;
        const latestLabel = branchName ? `Latest on ${branchName}` : "Pull latest";
        const latestRow = _makeVersionRow({
            star: "⭐",
            ref: latestLabel,
            refIsCode: false,
            date: "",
            current: false,
            disabled: false,
            onClick: () => close({ kind: "pull" }),
        });
        listWrap.appendChild(latestRow);

        // --- Теги (только если есть) ---
        if (tags && tags.length) {
            for (const t of tags) {
                const isCurrent = !!(currentTag && t.ref === currentTag);
                const row = _makeVersionRow({
                    star: "",
                    ref: t.ref,
                    refIsCode: true,
                    date: t.date || "",
                    current: isCurrent,
                    disabled: isCurrent,
                    onClick: isCurrent ? null : () => close({ kind: "checkout", ref: t.ref }),
                });
                listWrap.appendChild(row);
            }
        }

        body.appendChild(listWrap);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "cnm-btn";
        cancelBtn.textContent = "Cancel";
        footer.appendChild(cancelBtn);

        const close = (result) => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(result);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                close(null);
            }
        };

        cancelBtn.onclick = () => close(null);
        overlay.onclick = (e) => { if (e.target === overlay) close(null); };
        document.addEventListener("keydown", onKey, true);

        requestAnimationFrame(() => cancelBtn.focus());
    });
}

function _makeVersionRow({ star, ref, refIsCode, date, current, disabled, onClick }) {
    const row = document.createElement("div");
    row.className = "cnm-ver-row";
    if (disabled) row.classList.add("cnm-ver-row-disabled");
    if (current) row.classList.add("cnm-ver-row-current");

    const starEl = document.createElement("span");
    starEl.className = "cnm-ver-star";
    starEl.textContent = star || "";
    row.appendChild(starEl);

    const refEl = document.createElement("span");
    refEl.className = "cnm-ver-ref" + (refIsCode ? " cnm-ver-ref-code" : "");
    refEl.textContent = ref;
    row.appendChild(refEl);

    if (date) {
        const arrow = document.createElement("span");
        arrow.className = "cnm-ver-arrow";
        arrow.textContent = "→";
        row.appendChild(arrow);

        const dateEl = document.createElement("span");
        dateEl.className = "cnm-ver-date";
        dateEl.textContent = date;
        row.appendChild(dateEl);
    }

    if (current) {
        const mark = document.createElement("span");
        mark.className = "cnm-ver-current-mark";
        mark.textContent = "✓ current";
        row.appendChild(mark);
    }

    if (onClick && !disabled) {
        row.addEventListener("click", onClick);
    }

    return row;
}

// =======================================================================
//  Общий каркас диалога
// =======================================================================

function _buildDialogShell({ title, danger }) {
    const overlay = document.createElement("div");
    overlay.className = "cnm-pop-overlay";

    const pop = document.createElement("div");
    pop.className = "cnm-pop";
    if (danger) pop.classList.add("cnm-pop-danger");

    const header = document.createElement("div");
    header.className = "cnm-pop-header";

    const titleEl = document.createElement("div");
    titleEl.className = "cnm-pop-title";
    titleEl.textContent = title || "";
    header.appendChild(titleEl);

    const body = document.createElement("div");
    body.className = "cnm-pop-body";

    const footer = document.createElement("div");
    footer.className = "cnm-pop-footer";

    pop.appendChild(header);
    pop.appendChild(body);
    pop.appendChild(footer);
    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    return { overlay, pop, body, footer };
}

// =======================================================================
//  Стили
// =======================================================================

function injectStyles() {
    if (document.getElementById("cnm-styles")) return;
    const style = document.createElement("style");
    style.id = "cnm-styles";
    style.textContent = `
        .cnm-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.65);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000;
        }
        .cnm-modal {
            background: var(--comfy-menu-bg);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            width: min(900px, 92vw);
            height: min(80vh, 900px);
            display: flex; flex-direction: column;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            overflow: hidden;
        }
        .cnm-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-title { font-size: 16px; font-weight: 600; color: var(--fg-color); }
        .cnm-toolbar {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 18px;
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-search-wrap { flex: 1; display: flex; min-width: 120px; }
        .cnm-search {
            width: 100%;
            padding: 6px 12px;
            font-size: 13px;
            background: var(--comfy-input-bg);
            color: var(--fg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            box-sizing: border-box;
        }
        .cnm-search:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59,130,246,0.25);
        }
        .cnm-status { font-size: 12px; color: var(--descrip-text); white-space: nowrap; }
        .cnm-list {
            flex: 1; overflow-y: auto;
            padding: 10px 18px 18px;
            display: flex; flex-direction: column; gap: 8px;
        }
        .cnm-empty {
            text-align: center; color: var(--descrip-text);
            padding: 40px 0; font-size: 13px;
        }
        .cnm-error { color: #ef4444; }

        .cnm-row {
            background: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 10px 12px;
            display: flex; flex-direction: column; gap: 6px;
        }
        .cnm-row-warn { border-color: #f59e0b; }
        .cnm-row-head {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        .cnm-row-title {
            font-size: 14px; font-weight: 600; color: var(--fg-color);
            word-break: break-all;
        }
        .cnm-badges { display: flex; gap: 6px; flex-wrap: wrap; }
        .cnm-badge {
            font-size: 11px; padding: 2px 7px; border-radius: 10px;
            background: var(--bg-color); color: var(--fg-color);
            border: 1px solid var(--border-color);
        }
        .cnm-badge-tag { background: #3b82f6; color: white; border-color: #3b82f6; }
        .cnm-badge-branch { background: #6366f1; color: white; border-color: #6366f1; }
        .cnm-badge-commit { font-family: monospace; }
        .cnm-badge-warn { background: #f59e0b; color: white; border-color: #f59e0b; }

        .cnm-row-meta { font-size: 12px; }
        .cnm-link { color: var(--primary-color, #4a9eff); text-decoration: none; }
        .cnm-link:hover { text-decoration: underline; }
        .cnm-muted { color: var(--descrip-text); font-style: italic; }
        .cnm-row-desc { font-size: 12px; color: var(--descrip-text); }

        .cnm-actions { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }

        .cnm-btn {
            padding: 6px 12px; font-size: 12px;
            background: var(--comfy-menu-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px; color: var(--fg-color);
            cursor: pointer; transition: background 0.15s;
        }
        .cnm-btn:hover:not(:disabled) { background: var(--comfy-menu-secondary-bg); }
        .cnm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .cnm-btn-small { padding: 4px 10px; }
        .cnm-btn-primary { background: #3b82f6; border-color: #3b82f6; color: white; }
        .cnm-btn-primary:hover:not(:disabled) { background: #2563eb; }
        .cnm-btn-danger { background: #dc2626; border-color: #dc2626; color: white; }
        .cnm-btn-danger:hover:not(:disabled) { background: #b91c1c; }
        .cnm-btn-warning { background: #f59e0b; border-color: #f59e0b; color: white; }
        .cnm-btn-warning:hover:not(:disabled) { background: #d97706; }

        .cnm-task-panel {
            border-top: 1px solid var(--border-color);
            background: var(--comfy-menu-bg);
            padding: 10px 18px;
            display: none;
            flex-direction: column; gap: 6px;
            max-height: 240px; overflow: hidden;
        }
        .cnm-task-title { font-size: 13px; font-weight: 600; color: var(--fg-color); word-break: break-all; }
        .cnm-task-progress { font-size: 12px; color: var(--descrip-text); }
        .cnm-task-progress.cnm-task-ok { color: #10b981; }
        .cnm-task-progress.cnm-task-err { color: #ef4444; }
        .cnm-task-log {
            font-family: monospace; font-size: 11px;
            color: var(--descrip-text);
            max-height: 110px; overflow-y: auto;
            background: var(--bg-color); border: 1px solid var(--border-color);
            border-radius: 4px; padding: 6px 8px;
        }
        .cnm-task-log:empty { display: none; }
        .cnm-task-actions { display: flex; gap: 6px; }

        /* ---------- Кастомные диалоги ---------- */
        .cnm-pop-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.7);
            display: flex; align-items: center; justify-content: center;
            z-index: 11000;
            animation: cnmPopFadeIn 0.12s ease-out;
        }
        @keyframes cnmPopFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .cnm-pop {
            background: var(--comfy-menu-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            width: min(520px, 92vw);
            max-height: 85vh;
            display: flex; flex-direction: column;
            box-shadow: 0 12px 32px rgba(0,0,0,0.5);
            animation: cnmPopScaleIn 0.14s ease-out;
        }
        @keyframes cnmPopScaleIn {
            from { transform: scale(0.96); opacity: 0; }
            to   { transform: scale(1);    opacity: 1; }
        }
        .cnm-pop-danger { border-color: #7f1d1d; }
        .cnm-pop-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-pop-title {
            font-size: 15px; font-weight: 600;
            color: var(--fg-color);
            word-break: break-word;
        }
        .cnm-pop-body {
            padding: 14px 16px;
            overflow-y: auto;
            display: flex; flex-direction: column; gap: 12px;
        }
        .cnm-pop-message {
            font-size: 13px; line-height: 1.45;
            color: var(--descrip-text);
            white-space: pre-wrap;
        }
        .cnm-pop-field { display: flex; flex-direction: column; gap: 4px; }
        .cnm-pop-label {
            font-size: 12px; color: var(--fg-color);
            font-weight: 500;
        }
        .cnm-pop-required { color: #ef4444; }
        .cnm-pop-input {
            padding: 8px 10px;
            font-size: 13px;
            background: var(--bg-color);
            color: var(--fg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            box-sizing: border-box;
            font-family: inherit;
        }
        .cnm-pop-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59,130,246,0.25);
        }
        .cnm-pop-input-invalid {
            border-color: #ef4444;
            box-shadow: 0 0 0 2px rgba(239,68,68,0.25);
        }
        .cnm-pop-footer {
            padding: 12px 16px;
            border-top: 1px solid var(--border-color);
            display: flex; justify-content: flex-end; gap: 8px;
        }

        /* ---------- Version picker ---------- */
        .cnm-ver-list {
            display: flex; flex-direction: column;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            overflow: hidden;
            background: var(--bg-color);
        }
        .cnm-ver-row {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 12px;
            cursor: pointer;
            transition: background 0.1s;
            user-select: none;
        }
        .cnm-ver-row + .cnm-ver-row {
            border-top: 1px solid var(--border-color);
        }
        .cnm-ver-row:hover:not(.cnm-ver-row-disabled) {
            background: var(--comfy-menu-secondary-bg);
        }
        .cnm-ver-row-disabled {
            cursor: default;
        }
        .cnm-ver-row-current {
            background: rgba(59,130,246,0.08);
        }
        .cnm-ver-row-current:hover {
            background: rgba(59,130,246,0.08);
        }
        .cnm-ver-star {
            flex: 0 0 20px;
            font-size: 14px;
            text-align: center;
        }
        .cnm-ver-ref {
            flex: 1 1 auto;
            font-size: 13px;
            font-weight: 600;
            color: var(--fg-color);
            word-break: break-all;
        }
        .cnm-ver-ref-code {
            font-family: monospace;
            font-weight: 500;
        }
        .cnm-ver-arrow {
            flex: 0 0 auto;
            font-size: 12px;
            color: var(--descrip-text);
            opacity: 0.7;
        }
        .cnm-ver-date {
            flex: 0 0 auto;
            font-size: 12px;
            font-family: monospace;
            color: var(--descrip-text);
        }
        .cnm-ver-current-mark {
            flex: 0 0 auto;
            font-size: 11px;
            color: #10b981;
            font-weight: 600;
            margin-left: 6px;
        }
        .cnm-ver-row-disabled .cnm-ver-ref {
            color: var(--descrip-text);
        }
    `;
    document.head.appendChild(style);
}

// =======================================================================
//  Утилиты
// =======================================================================

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;",
    })[c]);
}