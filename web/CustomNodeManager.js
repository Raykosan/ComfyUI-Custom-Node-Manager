import { app } from "../../../scripts/app.js";

console.log("🦊 CNM JS v18 (attach remote) loaded at", new Date().toLocaleTimeString());

const STORAGE_KEY = "CustomNodeManager.ShowTopbarIcon";

let _allNodes = [];
let _query = "";
let _listSource = "";
let _serverRestarting = false;
let _updates = {};
let _updatesCheckedAt = null;
let _updatesChecking = false;
let _filterHasUpdate = false;
let _updatesPollTimer = null;
let _selected = new Set();

const I18N = {
    latest_version: {
        en: "Latest version",
        zh: "最新版本",
        ru: "Последняя версия",
    },
    latest_version_tip: {
        en: "Pull the latest commit from the current branch",
        zh: "从当前分支拉取最新提交",
        ru: "Подтянуть последний коммит текущей ветки",
    },
    switch_version_tip: {
        en: "Switch this node to a specific version",
        zh: "将此节点切换到指定版本",
        ru: "Переключить ноду на конкретную версию",
    },
    version_picker_hint: {
        en: "Click a version to switch the node.",
        zh: "点击版本以切换节点。",
        ru: "Кликните версию, чтобы переключить ноду.",
    },
    versions_failed_title: {
        en: "Failed to read versions",
        zh: "无法读取版本",
        ru: "Не удалось прочитать версии",
    },
    versions_failed_msg: {
        en: "Could not read the version list. Make sure the node has a valid .git directory.",
        zh: "无法读取版本列表。请确认该节点具有有效的 .git 目录。",
        ru: "Не удалось прочитать список версий. Убедитесь, что у ноды есть валидная папка .git.",
    },
    task_failed_title: {
        en: "Task failed to start",
        zh: "任务启动失败",
        ru: "Не удалось запустить задачу",
    },
    restarting_msg: {
        en: "⏳ ComfyUI is restarting… please wait",
        zh: "⏳ ComfyUI 正在重启… 请稍候",
        ru: "⏳ ComfyUI перезагружается… подождите",
    },
    install_message: {
        en: "Clones the repository into custom_nodes and installs requirements.txt.",
        zh: "将仓库克隆到 custom_nodes 并安装 requirements.txt。",
        ru: "Клонирует репозиторий в custom_nodes и установит зависимости из requirements.txt.",
    },
    remove_message: {
        en: "The folder will be deleted completely, including .git and all local files. This action cannot be undone.",
        zh: "该文件夹将被彻底删除，包括 .git 和所有本地文件。此操作不可撤销。",
        ru: "Папка будет удалена полностью, включая .git и все локальные файлы. Это действие необратимо.",
    },
    stash_tip: {
        en: "Stashed changes — click to manage",
        zh: "已暂存的更改 — 点击管理",
        ru: "Отложенные изменения — клик для управления",
    },
    stash_picker_title: {
        en: "Stashed changes",
        zh: "已暂存的更改",
        ru: "Отложенные изменения",
    },
    stash_picker_hint: {
        en: "Restore applies the changes back to the working tree. Drop deletes them permanently.",
        zh: "恢复会将更改应用回工作区。丢弃将永久删除它们。",
        ru: "Restore вернёт изменения в файлы ноды. Drop удалит их навсегда.",
    },
    stash_empty: {
        en: "No stashed changes.",
        zh: "没有已暂存的更改。",
        ru: "Отложенных изменений нет.",
    },
    stash_fetch_failed_title: {
        en: "Failed to read stashes",
        zh: "无法读取暂存",
        ru: "Не удалось прочитать stash'и",
    },
    stash_fetch_failed_msg: {
        en: "Could not read the stash list for this node.",
        zh: "无法读取该节点的暂存列表。",
        ru: "Не удалось прочитать список stash'ей для этой ноды.",
    },
    stash_pop_failed_title: {
        en: "Restore failed",
        zh: "恢复失败",
        ru: "Не удалось восстановить",
    },
    stash_drop_failed_title: {
        en: "Drop failed",
        zh: "丢弃失败",
        ru: "Не удалось удалить",
    },
    stash_restore_btn: {
        en: "Restore",
        zh: "恢复",
        ru: "Восстановить",
    },
    stash_drop_btn: {
        en: "Drop",
        zh: "丢弃",
        ru: "Удалить",
    },
    stash_was_at: {
        en: "Was stashed at {ref}",
        zh: "暂存于 {ref}",
        ru: "Было отложено на {ref}",
    },
    stash_files_changed: {
        en: "{n} files changed",
        zh: "{n} 个文件已更改",
        ru: "Изменено файлов: {n}",
    },
    stash_show_all: {
        en: "Show all",
        zh: "显示全部",
        ru: "Показать все",
    },
    stash_show_less: {
        en: "Show less",
        zh: "收起",
        ru: "Свернуть",
    },
    stash_and_more: {
        en: "… and {n} more",
        zh: "… 还有 {n} 个",
        ru: "… и ещё {n}",
    },
    check_updates_btn: {
        en: "Check updates",
        zh: "检查更新",
        ru: "Проверить обновления",
    },
    check_updates_btn_tip: {
        en: "Compare local commits with remote branches",
        zh: "将本地提交与远程分支比较",
        ru: "Сравнить локальные коммиты с удалёнными ветками",
    },
    updates_chip_tip: {
        en: "Click to show only nodes with updates",
        zh: "点击仅显示有更新的节点",
        ru: "Кликните, чтобы показать только ноды с обновлением",
    },
    updates_checking: {
        en: "checking…",
        zh: "检查中…",
        ru: "проверка…",
    },
    update_available_tip: {
        en: "Update available — remote: {ref}",
        zh: "有可用更新 — 远程: {ref}",
        ru: "Доступно обновление — удалённый: {ref}",
    },
    badge_not_a_node: {
        en: "not a node",
        zh: "不是节点",
        ru: "не нода",
    },
    badge_no_git: {
        en: "no git remote",
        zh: "无 git 远程",
        ru: "нет git",
    },
    attach_remote_btn: {
        en: "Attach Git Remote",
        zh: "关联 Git 远程",
        ru: "Привязать Git",
    },
    attach_remote_tip: {
        en: "Turn this folder into a git repository linked to a remote. Existing files are not touched.",
        zh: "将此文件夹转换为链接到远程的 git 仓库。不会修改现有文件。",
        ru: "Превратить папку в git-репозиторий. Существующие файлы не перезаписываются.",
    },
    attach_remote_title: {
        en: "Attach Git Remote",
        zh: "关联 Git 远程",
        ru: "Привязать Git Remote",
    },
    attach_remote_msg: {
        en: "Enter the Git URL. Files in the folder will NOT be overwritten.",
        zh: "输入 Git URL。文件夹中的文件不会被覆盖。",
        ru: "Введите Git URL. Файлы в папке НЕ будут перезаписаны.",
    },
    attach_remote_ok: {
        en: "Attach",
        zh: "关联",
        ru: "Привязать",
    },
    attach_remote_success_title: {
        en: "Git remote attached",
        zh: "已关联 Git 远程",
        ru: "Git remote привязан",
    },
    attach_remote_success_msg: {
        en: "Branch: {branch}\nFiles differing from remote: {changed}",
        zh: "分支: {branch}\n与远程不同的文件数: {changed}",
        ru: "Ветка: {branch}\nОтличается от remote файлов: {changed}",
    },
    attach_remote_failed_title: {
        en: "Attach failed",
        zh: "关联失败",
        ru: "Не удалось привязать",
    },
    version_source_github: {
        en: "listed from GitHub API",
        zh: "来自 GitHub API",
        ru: "список получен через GitHub API",
    },
    version_source_local: {
        en: "listed from local git",
        zh: "来自本地 git",
        ru: "список получен из локального git",
    },
    select_all: {
        en: "Select all",
        zh: "全选",
        ru: "Выбрать все",
    },
    deselect_all: {
        en: "Deselect all",
        zh: "取消全选",
        ru: "Снять выделение",
    },
    clear_selection: {
        en: "Clear",
        zh: "清除",
        ru: "Сбросить",
    },
    selected_count: {
        en: "{n} selected",
        zh: "已选 {n}",
        ru: "Выбрано: {n}",
    },
    update_selected: {
        en: "Update {n} selected",
        zh: "更新 {n} 个",
        ru: "Обновить выбранные ({n})",
    },
    batch_update_confirm_title: {
        en: "Update {n} nodes?",
        zh: "更新 {n} 个节点？",
        ru: "Обновить {n} нод?",
    },
    batch_update_confirm_msg: {
        en: "Each node will run: git fetch + git pull --ff-only. Local changes (if any) will be auto-stashed.",
        zh: "每个节点将执行：git fetch + git pull --ff-only。本地更改将自动暂存。",
        ru: "Для каждой ноды будет выполнен git fetch + git pull --ff-only. Локальные изменения автосохранятся в stash.",
    },
    batch_update_ok: {
        en: "Update",
        zh: "更新",
        ru: "Обновить",
    },
};

function _detectLocale() {
    try {
        const v = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
        if (typeof v === "string" && v) {
            const low = v.toLowerCase();
            if (low.startsWith("zh")) return "zh";
            if (low.startsWith("ru")) return "ru";
            return "en";
        }
    } catch (e) { /* fallback */ }

    const nav = (navigator.language || "en").toLowerCase();
    if (nav.startsWith("zh")) return "zh";
    if (nav.startsWith("ru")) return "ru";
    return "en";
}

(function _installGlobalEscape() {
    if (window.__cnmGlobalEscapeInstalled) return;
    window.__cnmGlobalEscapeInstalled = true;

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const popups = document.querySelectorAll(".cnm-pop-overlay");
        if (!popups.length) return;

        e.preventDefault();
        e.stopPropagation();

        const top = popups[popups.length - 1];
        const closeFn = top.__cnmClose;
        if (typeof closeFn === "function") {
            try { closeFn(); } catch (err) {
                console.error("🦊 popup close error:", err);
                try { top.remove(); } catch (e) {}
            }
        } else {
            try { top.remove(); } catch (e) {}
        }
    }, true);
})();

function _t(key) {
    const entry = I18N[key];
    if (!entry) return key;
    const loc = _detectLocale();
    return entry[loc] || entry.en;
}

function _tf(key, vars) {
    let s = _t(key);
    for (const [k, v] of Object.entries(vars || {})) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return s;
}

app.registerExtension({
    name: "CustomNodeManager",

    async setup() {
        app.ui.settings.addSetting({
            id: "CustomNodeManager.Open",
            name: "Custom Node Manager",
            type: () => buildSettingsEntry(),
        });

        app.ui.settings.addSetting({
            id: "CustomNodeManager.GitHubToken",
            name: "GitHub Token (optional, not used yet)",
            type: "text",
            defaultValue: "",
        });

        if (localStorage.getItem(STORAGE_KEY) === "true") {
            waitForActionBar((bar) => injectTopbarButton(bar));
        }
    },
});

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
    openBtn.onclick = () => {
        closeComfySettingsDialog();
        setTimeout(openManagerModal, 80);
    };

    container.appendChild(toggleRow);
    container.appendChild(openBtn);
    return container;
}

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

function closeComfySettingsDialog() {
    try {
        const cmd = app?.extensionManager?.command;
        if (cmd?.executeCommand) {
            try {
                cmd.executeCommand("Comfy.CloseSettingsDialog");
                return;
            } catch (e) { /* команда может отсутствовать */ }
        }
    } catch (e) {}

    try {
        const dlg = app?.ui?.settings?.dialog;
        if (dlg && typeof dlg.close === "function") {
            dlg.close();
            return;
        }
    } catch (e) {}

    const selectors = [
        ".p-dialog.p-component .p-dialog-header-close",
        ".p-dialog .p-dialog-header-close",
        "[role='dialog'] .p-dialog-header-close",
        "[role='dialog'] [aria-label='Close']",
        "[role='dialog'] [aria-label='close']",
    ];
    for (const sel of selectors) {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
            if (btn.offsetParent !== null) {
                btn.click();
                return;
            }
        }
    }
}

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
    header.innerHTML = `<div class="cnm-title">🦊 Custom Node Manager <span style="font-size:11px;color:var(--descrip-text);font-weight:400;">(js v18)</span></div>`;

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

    const checkBtn = document.createElement("button");
    checkBtn.className = "cnm-btn";
    checkBtn.id = "cnm-check-btn";
    checkBtn.textContent = "⬆ " + _t("check_updates_btn");
    checkBtn.title = _t("check_updates_btn_tip");
    checkBtn.onclick = () => triggerCheckUpdates();

    // --- search input ---
    const searchWrap = document.createElement("div");
    searchWrap.className = "cnm-search-wrap";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cnm-search";
    searchInput.placeholder = "🔍 filter…  (-word to exclude)";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;

    const searchClear = document.createElement("button");
    searchClear.type = "button";
    searchClear.className = "cnm-search-clear";
    searchClear.textContent = "✕";
    searchClear.title = "Clear filter";
    searchClear.style.display = "none";
    searchClear.onclick = () => {
        searchInput.value = "";
        _query = "";
        searchClear.style.display = "none";
        applyFilterAndRender();
        searchInput.focus();
    };

    searchInput.addEventListener("input", () => {
        _query = searchInput.value;
        searchClear.style.display = _query ? "flex" : "none";
        applyFilterAndRender();
    });
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            searchInput.value = "";
            _query = "";
            searchClear.style.display = "none";
            applyFilterAndRender();
            searchInput.blur();
        }
    });

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchClear);

    const updatesChip = document.createElement("button");
    updatesChip.className = "cnm-updates-chip";
    updatesChip.id = "cnm-updates-chip";
    updatesChip.style.display = "none";
    updatesChip.onclick = () => {
        _filterHasUpdate = !_filterHasUpdate;
        if (!_filterHasUpdate) _selected.clear();
        applyFilterAndRender();
    };

    const statusEl = document.createElement("span");
    statusEl.className = "cnm-status";

    toolbar.appendChild(installBtn);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(checkBtn);
    toolbar.appendChild(searchWrap);
    toolbar.appendChild(updatesChip);
    toolbar.appendChild(statusEl);

    const selectBar = document.createElement("div");
    selectBar.className = "cnm-select-bar";
    selectBar.id = "cnm-select-bar";
    selectBar.style.display = "none";

    const listEl = document.createElement("div");
    listEl.className = "cnm-list";
    listEl.id = "cnm-list";

    modal.appendChild(header);
    modal.appendChild(toolbar);
    modal.appendChild(selectBar);
    modal.appendChild(listEl);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    injectStyles();

    (async () => {
        await loadUpdates();
        await loadNodes(refreshBtn, { preferCache: true });
        maybeAutoCheckUpdates();
    })();
}

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
            if (_serverRestarting || _isNetworkError(e)) {
                list.innerHTML = `<div class="cnm-empty cnm-empty-info">${escapeHtml(_t("restarting_msg"))}</div>`;
            } else {
                list.innerHTML = `<div class="cnm-empty cnm-error">Error: ${escapeHtml(e.message)}</div>`;
            }
            if (refreshBtn) refreshBtn.disabled = false;
            return;
        }
    }

    _allNodes = nodes;
    applyFilterAndRender();
    if (refreshBtn) refreshBtn.disabled = false;
}

async function loadUpdates() {
    try {
        const res = await fetch("/custom_node_manager/updates", { cache: "no-store" });
        const data = await res.json();
        if (!data.success) return;
        _updates = data.updates || {};
        _updatesCheckedAt = data.checked_at;
        _updatesChecking = !!data.checking;
    } catch (e) { /* сеть отвалилась — оставляем как есть */ }
}

async function triggerCheckUpdates() {
    const btn = document.getElementById("cnm-check-btn");
    if (btn) btn.disabled = true;
    try {
        const res = await fetch("/custom_node_manager/check_updates", {
            method: "POST",
            cache: "no-store",
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "check failed");
        _updatesChecking = true;
        renderUpdatesChip();
        startUpdatesPolling();
    } catch (e) {
        console.error("🦊 check_updates failed:", e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function maybeAutoCheckUpdates() {
    const TTL_MS = 6 * 60 * 60 * 1000;
    const ts = _updatesCheckedAt ? Date.parse(_updatesCheckedAt) : 0;
    const stale = !ts || (Date.now() - ts > TTL_MS);

    if (_updatesChecking) {
        startUpdatesPolling();
        return;
    }
    if (stale && _allNodes.length) {
        triggerCheckUpdates();
    }
}

function startUpdatesPolling() {
    if (_updatesPollTimer) return;

    let attempts = 0;
    const maxAttempts = 300;

    _updatesPollTimer = setInterval(async () => {
        attempts++;
        await loadUpdates();
        applyFilterAndRender();
        renderUpdatesChip();

        const done = !_updatesChecking || attempts >= maxAttempts;
        if (done) {
            clearInterval(_updatesPollTimer);
            _updatesPollTimer = null;
            applyFilterAndRender();
            renderUpdatesChip();
        }
    }, 1000);
}

function renderUpdatesChip() {
    const chip = document.getElementById("cnm-updates-chip");
    if (!chip) return;

    if (_updatesChecking) {
        chip.style.display = "inline-flex";
        chip.textContent = "⏳ " + _t("updates_checking");
        chip.classList.add("cnm-updates-chip-checking");
        chip.classList.remove("cnm-updates-chip-active");
        return;
    }

    const count = Object.values(_updates).filter((u) => u && u.has_update).length;
    if (count === 0) {
        chip.style.display = "none";
        return;
    }

    chip.style.display = "inline-flex";
    chip.textContent = `⬆ ${count} update${count === 1 ? "" : "s"}`;
    chip.title = _t("updates_chip_tip");
    chip.classList.remove("cnm-updates-chip-checking");
    if (_filterHasUpdate) {
        chip.classList.add("cnm-updates-chip-active");
    } else {
        chip.classList.remove("cnm-updates-chip-active");
    }
}

function renderSelectBar() {
    const bar = document.getElementById("cnm-select-bar");
    if (!bar) return;

    if (!_filterHasUpdate) {
        bar.style.display = "none";
        bar.innerHTML = "";
        return;
    }

    bar.style.display = "flex";
    bar.innerHTML = "";

    const visible = filterNodes(_allNodes, _query);
    const visibleFolders = visible.map((n) => n.folder);
    const allSelected =
        visibleFolders.length > 0 &&
        visibleFolders.every((f) => _selected.has(f));

    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "cnm-btn cnm-btn-small";
    const label = allSelected ? _t("deselect_all") : _t("select_all");
    selectAllBtn.textContent = `${label} (${visibleFolders.length})`;
    selectAllBtn.disabled = visibleFolders.length === 0;
    selectAllBtn.onclick = () => {
        if (allSelected) {
            for (const f of visibleFolders) _selected.delete(f);
        } else {
            for (const f of visibleFolders) _selected.add(f);
        }
        applyFilterAndRender();
    };
    bar.appendChild(selectAllBtn);

    const counter = document.createElement("span");
    counter.className = "cnm-select-counter";
    counter.textContent = _tf("selected_count", { n: _selected.size });
    bar.appendChild(counter);

    const spacer = document.createElement("div");
    spacer.style.flex = "1 1 auto";
    bar.appendChild(spacer);

    const updateBtn = document.createElement("button");
    updateBtn.className = "cnm-btn cnm-btn-primary cnm-btn-small";
    updateBtn.textContent = _tf("update_selected", { n: _selected.size });
    updateBtn.disabled = _selected.size === 0;
    updateBtn.onclick = runBatchUpdate;
    bar.appendChild(updateBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "cnm-btn cnm-btn-small";
    clearBtn.textContent = _t("clear_selection");
    clearBtn.disabled = _selected.size === 0;
    clearBtn.onclick = () => {
        _selected.clear();
        applyFilterAndRender();
    };
    bar.appendChild(clearBtn);
}

function filterNodes(nodes, query) {
    let result = nodes;

    if (_filterHasUpdate) {
        result = result.filter((n) => {
            const u = _updates[n.folder];
            return u && u.has_update;
        });
    }

    const q = (query || "").trim().toLowerCase();
    if (!q) return result;

    const tokens = q.split(/\s+/).filter(Boolean);
    const includes = tokens.filter((t) => !t.startsWith("-"));
    const excludes = tokens.filter((t) => t.startsWith("-")).map((t) => t.slice(1)).filter(Boolean);

    return result.filter((n) => {
        const hay = [
            n.folder || "", n.name || "", n.description || "", n.git_url || "",
        ].join(" ").toLowerCase();

        for (const t of excludes) if (hay.includes(t)) return false;
        for (const t of includes) if (!hay.includes(t)) return false;
        return true;
    });
}

function applyFilterAndRender() {
    const list = document.getElementById("cnm-list");
    if (!list) return;

    const updCount = Object.values(_updates).filter((u) => u && u.has_update).length;
    if (_filterHasUpdate && updCount === 0) {
        _filterHasUpdate = false;
        _selected.clear();
    }

    const filtered = filterNodes(_allNodes, _query);
    renderNodes(list, filtered);
    renderUpdatesChip();
    renderSelectBar();

    const total = _allNodes.length;
    const shown = filtered.length;
    const counter = (_query.trim() || _filterHasUpdate) ? `${shown} / ${total}` : `${total}`;
    setStatus(`${_listSource} · ${counter} nodes`);
}

function setStatus(text) {
    const el = document.querySelector(".cnm-status");
    if (el) el.textContent = text;
}

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

    const upd = _updates[node.folder];
    if (upd && upd.has_update) row.classList.add("cnm-row-has-update");

    const head = document.createElement("div");
    head.className = "cnm-row-head";

    if (_filterHasUpdate) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "cnm-row-check";
        checkbox.checked = _selected.has(node.folder);
        checkbox.onclick = (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                _selected.add(node.folder);
            } else {
                _selected.delete(node.folder);
            }
            renderSelectBar();
        };
        head.appendChild(checkbox);
    }

    const title = document.createElement("div");
    title.className = "cnm-row-title";
    title.textContent = node.folder;

    const badges = document.createElement("div");
    badges.className = "cnm-badges";

    if (node.version) {
        badges.appendChild(versionBadge(
            node.version,
            node.version_source,
            node.version_conflicts
        ));
    }
    if (node.branch) badges.appendChild(badge(node.branch, "branch"));
    if (node.commit_short) badges.appendChild(badge(node.commit_short, "commit"));

    if (upd && upd.has_update) {
        const updBadge = badge("↑ update", "update");
        updBadge.title = upd.remote_commit_short
            ? _tf("update_available_tip", { ref: upd.remote_commit_short })
            : "Update available";
        badges.appendChild(updBadge);
    }
    if (node.dirty) badges.appendChild(badge("dirty", "warn"));
    if (node.stash_count > 0) {
        const stashBadge = badge(`stashed ×${node.stash_count}`, "warn");
        stashBadge.classList.add("cnm-badge-clickable");
        stashBadge.title = _t("stash_tip");
        stashBadge.onclick = (e) => {
            e.stopPropagation();
            openStashPicker(node);
        };
        badges.appendChild(stashBadge);
    }
    if (!node.is_node && !node.git_url) {
        const nnBadge = badge(_t("badge_not_a_node"), "error");
        nnBadge.title = "Folder does not look like a ComfyUI node and has no git remote";
        badges.appendChild(nnBadge);
    }
    if (!node.git_url) {
        const ngBadge = badge(_t("badge_no_git"), "error");
        ngBadge.title = "Node has no git remote — install was not done via git clone";
        badges.appendChild(ngBadge);
    }

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

        if (node.detected_git_url) {
            const br = document.createElement("div");
            br.style.marginTop = "2px";

            const label = document.createElement("span");
            label.className = "cnm-muted";
            label.textContent = "detected: ";
            br.appendChild(label);

            const a = document.createElement("a");
            a.href = node.detected_git_url;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = node.detected_git_url;
            a.className = "cnm-link";
            br.appendChild(a);

            meta.appendChild(br);
        }
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

    if (node.git_url) {
        const switchBtn = document.createElement("button");
        switchBtn.className = "cnm-btn cnm-btn-primary";
        switchBtn.textContent = "Switch Version";
        switchBtn.title = _t("switch_version_tip");
        switchBtn.onclick = () => askAndSwitchVersion(node);
        actions.appendChild(switchBtn);
    } else if (node.is_node) {
        const attachBtn = document.createElement("button");
        attachBtn.className = "cnm-btn cnm-btn-primary";
        attachBtn.textContent = _t("attach_remote_btn");
        attachBtn.title = _t("attach_remote_tip");
        attachBtn.onclick = () => askAttachRemote(node);
        actions.appendChild(attachBtn);
    }

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

function versionBadge(version, source, conflicts) {
    const b = document.createElement("span");
    b.className = "cnm-badge cnm-badge-version";

    const verEl = document.createElement("span");
    verEl.className = "cnm-badge-version-text";
    verEl.textContent = version;
    b.appendChild(verEl);

    if (source) {
        const sep = document.createElement("span");
        sep.className = "cnm-badge-source";
        sep.textContent = " · " + source;
        b.appendChild(sep);
    }

    const lines = [];
    if (source) lines.push(`Version source: ${source}`);
    if (conflicts && conflicts.length) {
        lines.push("Also found:");
        for (const c of conflicts) {
            lines.push(`  ${c.source}: ${c.version}`);
        }
    }
    if (lines.length) b.title = lines.join("\n");

    return b;
}

async function installFromUrl() {
    const res = await cnmPrompt({
        title: "Install from Git URL",
        message: _t("install_message"),
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
            title: _t("versions_failed_title"),
            message: _t("versions_failed_msg"),
            danger: true,
        });
        return;
    }

    const choice = await cnmVersionPicker({
        title: `Switch Version — ${node.folder}`,
        branch: versions.current.branch,
        currentTag: versions.current.tag,
        tags: versions.tags || [],
        source: versions.source || "local",
    });
    if (!choice) return;

    if (choice.kind === "pull") {
        await runTask({
            url: "/custom_node_manager/update",
            body: { folder: node.folder, version: null },
            title: `Pull latest — ${node.folder}`,
            onSuccess: () => {
                delete _updates[node.folder];
                applyFilterAndRender();
            },
        });
    } else {
        await runTask({
            url: "/custom_node_manager/update",
            body: { folder: node.folder, version: choice.ref },
            title: `Checkout ${node.folder} → ${choice.ref}`,
        });
    }
}

async function askAttachRemote(node) {
    const prefill = node.detected_git_url || "";
    const res = await cnmPrompt({
        title: _t("attach_remote_title") + ` — ${node.folder}`,
        message: _t("attach_remote_msg"),
        fields: [
            {
                id: "git_url",
                label: "Git URL",
                placeholder: "https://github.com/owner/repo",
                required: true,
                autofocus: true,
                value: prefill,
            },
        ],
        okText: _t("attach_remote_ok"),
    });
    if (!res) return;

    const git_url = res.git_url.trim();
    try {
        const resp = await fetch("/custom_node_manager/attach_remote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: node.folder, git_url }),
            cache: "no-store",
        });
        const raw = await resp.text();
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
        }
        if (!data.success) throw new Error(data.error || "attach failed");

        await cnmAlert({
            title: _t("attach_remote_success_title"),
            message: _tf("attach_remote_success_msg", {
                branch: data.branch || "?",
                changed: data.changed_files ?? 0,
            }),
        });

        const refreshBtn = document.querySelector(".cnm-toolbar .cnm-btn:not(.cnm-btn-primary)");
        if (refreshBtn) loadNodes(refreshBtn, { preferCache: false });
    } catch (e) {
        await cnmAlert({
            title: _t("attach_remote_failed_title"),
            message: String(e.message || e),
            danger: true,
        });
    }
}

async function confirmAndRemove(node) {
    const ok = await cnmConfirm({
        title: `Remove ${node.folder}?`,
        message: _t("remove_message"),
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

async function runBatchUpdate() {
    const folders = Array.from(_selected).sort();
    if (!folders.length) return;

    const ok = await cnmConfirm({
        title: _tf("batch_update_confirm_title", { n: folders.length }),
        message: _t("batch_update_confirm_msg") + "\n\n" + folders.join("\n"),
        okText: _t("batch_update_ok"),
    });
    if (!ok) return;

    try {
        const res = await fetch("/custom_node_manager/batch_update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folders }),
            cache: "no-store",
        });
        const raw = await res.text();
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
        }
        if (!data.success) throw new Error(data.error || "batch failed");

        showTaskPanel(
            `Batch update (${folders.length})`,
            data.task_id,
            {
                onSuccess: (task) => {
                    const r = (task && task.result) || {};
                    const results = r.results || [];
                    for (const item of results) {
                        if (item && item.ok && item.folder) {
                            delete _updates[item.folder];
                        }
                    }
                    applyFilterAndRender();
                },
            }
        );
    } catch (e) {
        await cnmAlert({
            title: _t("task_failed_title"),
            message: String(e.message || e),
            danger: true,
        });
    }
}

async function _fetchVersions(folder) {
    try {
        const res = await fetch(
            `/custom_node_manager/versions_remote/${encodeURIComponent(folder)}`,
            { cache: "no-store" }
        );
        if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.tags) && data.tags.length > 0) {
                return {
                    source: "github",
                    rate_limit_remaining: data.rate_limit_remaining,
                    has_token: data.has_token,
                    current: { branch: null, tag: null },
                    tags: data.tags.map((t) => ({
                        ref: t.ref,
                        date: "",
                        commit: t.commit || "",
                    })),
                };
            }
            if (data && data.error) {
                console.warn("🦊 GitHub API:", data.error,
                    data.rate_limit_remaining != null
                        ? `(rate: ${data.rate_limit_remaining})`
                        : "");
            }
        }
    } catch (e) {
        console.warn("🦊 GitHub API недоступен, fallback на локальные теги");
    }

    try {
        const res = await fetch(
            `/custom_node_manager/versions/${encodeURIComponent(folder)}`,
            { cache: "no-store" }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.success) return null;
        data.source = "local";
        return data;
    } catch (e) {
        return null;
    }
}

async function _fetchStashes(folder) {
    try {
        const res = await fetch(
            `/custom_node_manager/stashes/${encodeURIComponent(folder)}`,
            { cache: "no-store" }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.success ? (data.stashes || []) : null;
    } catch (e) {
        return null;
    }
}

async function openStashPicker(node) {
    const stashes = await _fetchStashes(node.folder);
    if (stashes === null) {
        await cnmAlert({
            title: _t("stash_fetch_failed_title"),
            message: _t("stash_fetch_failed_msg"),
            danger: true,
        });
        return;
    }
    if (!stashes.length) {
        await cnmAlert({
            title: _t("stash_picker_title"),
            message: _t("stash_empty"),
        });
        return;
    }

    const didChange = await cnmStashPicker({
        folder: node.folder,
        stashes,
    });

    if (didChange) {
        const refreshBtn = document.querySelector(".cnm-toolbar .cnm-btn:not(.cnm-btn-primary)");
        if (refreshBtn) loadNodes(refreshBtn, { preferCache: false });
    }
}

function cnmStashPicker({ folder, stashes }) {
    return new Promise((resolve) => {
        let currentStashes = [...stashes];
        let didChange = false;

        const { overlay, body, footer } = _buildDialogShell({
            title: `${_t("stash_picker_title")} — ${folder}`,
            onClose: () => close(),
        });

        const hint = document.createElement("div");
        hint.className = "cnm-pop-message";
        hint.textContent = _t("version_picker_hint");
        body.appendChild(hint);

        const srcLabel = document.createElement("div");
        srcLabel.className = "cnm-ver-source";
        if (source === "github") {
            srcLabel.textContent = "· " + _t("version_source_github");
            srcLabel.classList.add("cnm-ver-source-github");
        } else {
            srcLabel.textContent = "· " + _t("version_source_local");
        }
        body.appendChild(srcLabel);

        const listWrap = document.createElement("div");
        listWrap.className = "cnm-ver-list";
        body.appendChild(listWrap);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "cnm-btn";
        cancelBtn.textContent = "Close";
        cancelBtn.style.display = "none";
        footer.appendChild(cancelBtn);

        const close = () => {
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(didChange);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                close();
            }
        };

        const renderList = () => {
            listWrap.innerHTML = "";

            if (!currentStashes.length) {
                const empty = document.createElement("div");
                empty.className = "cnm-empty";
                empty.style.padding = "20px 0";
                empty.textContent = _t("stash_empty");
                listWrap.appendChild(empty);
                setTimeout(close, 400);
                return;
            }

            for (const st of currentStashes) {
                listWrap.appendChild(renderStashRow(st));
            }
        };

        const renderStashRow = (st) => {
            const row = document.createElement("div");
            row.className = "cnm-stash-row";

            const info = document.createElement("div");
            info.className = "cnm-stash-info";

            const headLine = document.createElement("div");
            headLine.className = "cnm-stash-head";

            const refEl = document.createElement("span");
            refEl.className = "cnm-stash-ref";
            refEl.textContent = st.ref;
            headLine.appendChild(refEl);

            if (st.date) {
                const sep = document.createElement("span");
                sep.className = "cnm-stash-sep";
                sep.textContent = " · ";
                headLine.appendChild(sep);

                const dateEl = document.createElement("span");
                dateEl.className = "cnm-stash-date";
                dateEl.textContent = st.date;
                headLine.appendChild(dateEl);
            }
            info.appendChild(headLine);

            const base = st.base || {};
            if (base.tag || base.commit_short || base.subject) {
                const baseLine = document.createElement("div");
                baseLine.className = "cnm-stash-base";

                const refLabel = base.tag ? base.tag : (base.commit_short || "");
                const labelText = _tf("stash_was_at", { ref: refLabel });

                const labelEl = document.createElement("span");
                labelEl.className = "cnm-stash-base-label";
                labelEl.textContent = labelText;
                baseLine.appendChild(labelEl);

                if (base.subject) {
                    const sep2 = document.createElement("span");
                    sep2.className = "cnm-stash-sep";
                    sep2.textContent = " · ";
                    baseLine.appendChild(sep2);

                    const subjEl = document.createElement("span");
                    subjEl.className = "cnm-stash-base-subject";
                    subjEl.textContent = base.subject;
                    subjEl.title = base.subject;
                    baseLine.appendChild(subjEl);
                }
                info.appendChild(baseLine);
            }

            const statsLine = document.createElement("div");
            statsLine.className = "cnm-stash-stats";

            const n = st.files_changed || (st.files || []).length || 0;
            const nLabel = document.createElement("span");
            nLabel.textContent = _tf("stash_files_changed", { n });
            statsLine.appendChild(nLabel);

            if (st.insertions || st.deletions) {
                const sep = document.createElement("span");
                sep.className = "cnm-stash-sep";
                sep.textContent = "  ·  ";
                statsLine.appendChild(sep);

                if (st.insertions) {
                    const ins = document.createElement("span");
                    ins.className = "cnm-stash-ins";
                    ins.textContent = `+${st.insertions}`;
                    statsLine.appendChild(ins);
                }
                if (st.insertions && st.deletions) {
                    const sp = document.createElement("span");
                    sp.textContent = " ";
                    statsLine.appendChild(sp);
                }
                if (st.deletions) {
                    const del = document.createElement("span");
                    del.className = "cnm-stash-del";
                    del.textContent = `−${st.deletions}`;
                    statsLine.appendChild(del);
                }
            }
            info.appendChild(statsLine);

            const files = st.files || [];
            if (files.length) {
                const filesWrap = document.createElement("div");
                filesWrap.className = "cnm-stash-files";
                const SHOW_LIMIT = 10;
                let expanded = false;

                const renderFiles = () => {
                    filesWrap.innerHTML = "";
                    const limit = expanded ? files.length : Math.min(SHOW_LIMIT, files.length);

                    for (let i = 0; i < limit; i++) {
                        filesWrap.appendChild(makeFileRow(files[i]));
                    }

                    if (files.length > SHOW_LIMIT) {
                        const toggle = document.createElement("button");
                        toggle.className = "cnm-stash-toggle";
                        if (expanded) {
                            toggle.textContent = _t("stash_show_less");
                        } else {
                            toggle.textContent =
                                _tf("stash_and_more", { n: files.length - SHOW_LIMIT }) +
                                "  [ " + _t("stash_show_all") + " ]";
                        }
                        toggle.onclick = () => {
                            expanded = !expanded;
                            renderFiles();
                        };
                        filesWrap.appendChild(toggle);
                    }
                };
                renderFiles();
                info.appendChild(filesWrap);
            }

            row.appendChild(info);

            const actions = document.createElement("div");
            actions.className = "cnm-stash-actions";

            const restoreBtn = document.createElement("button");
            restoreBtn.className = "cnm-btn cnm-btn-primary cnm-btn-small";
            restoreBtn.textContent = _t("stash_restore_btn");

            const dropBtn = document.createElement("button");
            dropBtn.className = "cnm-btn cnm-btn-danger cnm-btn-small";
            dropBtn.textContent = _t("stash_drop_btn");

            restoreBtn.onclick = async () => {
                restoreBtn.disabled = true;
                dropBtn.disabled = true;
                restoreBtn.textContent = "…";
                try {
                    const res = await fetch("/custom_node_manager/stash/pop", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ folder, ref: st.ref }),
                        cache: "no-store",
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || "pop failed");

                    didChange = true;
                    const fresh = await _fetchStashes(folder);
                    currentStashes = fresh || [];
                    renderList();
                } catch (e) {
                    restoreBtn.disabled = false;
                    dropBtn.disabled = false;
                    restoreBtn.textContent = _t("stash_restore_btn");
                    await cnmAlert({
                        title: _t("stash_pop_failed_title"),
                        message: String(e.message || e),
                        danger: true,
                    });
                }
            };

            dropBtn.onclick = async () => {
                const ok = await cnmConfirm({
                    title: `${_t("stash_drop_btn")} ${st.ref}?`,
                    message: st.message || "",
                    okText: _t("stash_drop_btn"),
                    danger: true,
                });
                if (!ok) return;

                restoreBtn.disabled = true;
                dropBtn.disabled = true;
                dropBtn.textContent = "…";
                try {
                    const res = await fetch("/custom_node_manager/stash/drop", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ folder, ref: st.ref }),
                        cache: "no-store",
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || "drop failed");

                    didChange = true;
                    const fresh = await _fetchStashes(folder);
                    currentStashes = fresh || [];
                    renderList();
                } catch (e) {
                    restoreBtn.disabled = false;
                    dropBtn.disabled = false;
                    dropBtn.textContent = _t("stash_drop_btn");
                    await cnmAlert({
                        title: _t("stash_drop_failed_title"),
                        message: String(e.message || e),
                        danger: true,
                    });
                }
            };

            actions.appendChild(restoreBtn);
            actions.appendChild(dropBtn);
            row.appendChild(actions);

            return row;
        };

        cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        document.addEventListener("keydown", onKey, true);

        renderList();
        requestAnimationFrame(() => cancelBtn.focus());
    });
}

async function runTask({ url, body, title, onSuccess }) {
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
            title: _t("task_failed_title"),
            message: e.message,
            danger: true,
        });
        return;
    }

    showTaskPanel(title, taskId, { onSuccess });
}

function showTaskPanel(title, taskId, opts = {}) {
    const { onSuccess } = opts;
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
                if (typeof onSuccess === "function") {
                    try { onSuccess(t); } catch (e) {
                        console.error("🦊 onSuccess callback error:", e);
                    }
                }

                const restartBtn = document.getElementById("cnm-task-restart");
                restartBtn.style.display = "inline-block";
                restartBtn.onclick = async () => {
                    restartBtn.disabled = true;
                    restartBtn.textContent = "Restarting…";
                    _serverRestarting = true;
                    try {
                        await fetch("/custom_node_manager/restart", { method: "POST" });
                    } catch (e) { /* expected */ }
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
            _serverRestarting = false;
            restartBtn.disabled = false;
            restartBtn.textContent = "🔄 Restart ComfyUI";
        }
    }, 2000);
}

function cnmPrompt(opts) {
    return new Promise((resolve) => {
        const { title, message, fields = [], okText = "OK", cancelText = "Cancel", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({
            title, danger,
            onClose: () => close(null),
        });

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

function cnmConfirm(opts) {
    return new Promise((resolve) => {
        const { title, message, okText = "OK", cancelText = "Cancel", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({
            title, danger,
            onClose: () => close(false),
        });

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

function cnmAlert(opts) {
    return new Promise((resolve) => {
        const { title, message, okText = "OK", danger = false } = opts || {};

        const { overlay, body, footer } = _buildDialogShell({
            title, danger,
            onClose: () => close(),
        });

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

function cnmVersionPicker({ title, branch, currentTag, tags, source }) {
    return new Promise((resolve) => {
        const { overlay, body, footer } = _buildDialogShell({
            title,
            onClose: () => close(null),
        });

        const hint = document.createElement("div");
        hint.className = "cnm-pop-message";
        hint.textContent = _t("version_picker_hint");
        body.appendChild(hint);

        const listWrap = document.createElement("div");
        listWrap.className = "cnm-ver-list";

        const latestRow = _makeVersionRow({
            star: "⭐",
            ref: _t("latest_version"),
            refIsCode: false,
            date: "",
            current: false,
            disabled: false,
            tooltip: _t("latest_version_tip"),
            onClick: () => close({ kind: "pull" }),
        });
        listWrap.appendChild(latestRow);

        if (tags && tags.length) {
            for (const t of tags) {
                const isCurrent = !!(currentTag && t.ref === currentTag);
                const meta = t.date || t.commit || "";
                const row = _makeVersionRow({
                    star: "",
                    ref: t.ref,
                    refIsCode: true,
                    date: meta,
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

function _makeVersionRow({ star, ref, refIsCode, date, current, disabled, tooltip, onClick }) {
    const row = document.createElement("div");
    row.className = "cnm-ver-row";
    if (disabled) row.classList.add("cnm-ver-row-disabled");
    if (current) row.classList.add("cnm-ver-row-current");
    if (tooltip) row.title = tooltip;

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

function _buildDialogShell({ title, danger, onClose }) {
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

    const headerClose = document.createElement("button");
    headerClose.type = "button";
    headerClose.className = "cnm-pop-header-close";
    headerClose.textContent = "✕";
    headerClose.title = "Close";
    headerClose.setAttribute("aria-label", "Close");
    header.appendChild(headerClose);

    const body = document.createElement("div");
    body.className = "cnm-pop-body";

    const footer = document.createElement("div");
    footer.className = "cnm-pop-footer";

    pop.appendChild(header);
    pop.appendChild(body);
    pop.appendChild(footer);
    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    const doClose = () => {
        if (typeof onClose === "function") {
            try { onClose(); } catch (err) {
                console.error("🦊 popup onClose error:", err);
                try { overlay.remove(); } catch (e) {}
            }
        } else {
            try { overlay.remove(); } catch (e) {}
        }
    };

    headerClose.onclick = doClose;
    overlay.__cnmClose = doClose;

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) doClose();
    });
    pop.addEventListener("click", (e) => e.stopPropagation());

    return { overlay, pop, body, footer, headerClose };
}

const STATUS_TITLE = {
    M: "Modified",
    A: "Added",
    D: "Deleted",
    R: "Renamed",
    C: "Copied",
    U: "Unmerged",
    "?": "Unknown",
};

function _statusClass(s) {
    if (s === "M") return "m";
    if (s === "A") return "a";
    if (s === "D") return "d";
    if (s === "R" || s === "C") return "r";
    return "x";
}

function makeFileRow(f) {
    const line = document.createElement("div");
    line.className = "cnm-stash-file";

    const status = String(f.status || "?").toUpperCase();
    const statusEl = document.createElement("span");
    statusEl.className = `cnm-stash-status cnm-stash-status-${_statusClass(status)}`;
    statusEl.textContent = status;
    statusEl.title = STATUS_TITLE[status] || status;
    line.appendChild(statusEl);

    const pathEl = document.createElement("span");
    pathEl.className = "cnm-stash-path";
    pathEl.textContent = f.path || "";
    pathEl.title = f.path || "";
    line.appendChild(pathEl);

    return line;
}

function injectStyles() {
    if (document.getElementById("cnm-styles")) return;
    const style = document.createElement("style");
    style.id = "cnm-styles";
    style.textContent = `
        .cnm-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.65);
            display: flex; align-items: center; justify-content: center;
            z-index: 12000;
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
        .cnm-search-wrap {
            position: relative;
            flex: 1;
            display: flex;
            align-items: center;
            min-width: 120px;
        }
        .cnm-search-clear {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            padding: 0;
            background: transparent;
            border: none;
            color: var(--descrip-text);
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            transition: background 0.15s, color 0.15s;
        }
        .cnm-search-clear:hover {
            background: var(--comfy-menu-secondary-bg);
            color: var(--fg-color);
        }
        .cnm-search {
            padding-right: 30px;
        }
        .cnm-search {
            width: 100%;
            padding: 6px 12px;
            padding-right: 30px;
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
        .cnm-empty-info {
            color: #10b981;
            font-size: 14px;
            font-weight: 500;
            animation: cnmPulse 1.6s ease-in-out infinite;
        }
        @keyframes cnmPulse {
            0%, 100% { opacity: 0.7; }
            50%      { opacity: 1;   }
        }

        .cnm-row {
            background: var(--comfy-input-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 10px 12px;
            display: flex; flex-direction: column; gap: 6px;
        }
        .cnm-row-warn { border-color: #f59e0b; }
        .cnm-row-has-update {
            border-left: 3px solid #10b981;
            padding-left: 9px;
        }
        .cnm-row-head {
            display: flex; align-items: center; gap: 10px;
        }
        .cnm-row-head .cnm-badges {
            margin-left: auto;
        }
        .cnm-row-check {
            flex: 0 0 auto;
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: #3b82f6;
            margin: 0;
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
        .cnm-badge-error { background: #dc2626; color: white; border-color: #dc2626; }
        .cnm-badge-update {
            background: #10b981;
            color: white;
            border-color: #10b981;
            font-weight: 600;
        }

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

        /* ---------- Custom dialogues ---------- */
        .cnm-pop-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.7);
            display: flex; align-items: center; justify-content: center;
            z-index: 13000;
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
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-pop-header-close {
            flex: 0 0 auto;
            width: 26px;
            height: 26px;
            padding: 0;
            margin: 0;
            background: transparent;
            border: 1px solid transparent;
            color: var(--descrip-text);
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .cnm-pop-header-close:hover {
            background: var(--comfy-menu-secondary-bg);
            color: var(--fg-color);
            border-color: var(--border-color);
        }
        .cnm-pop-header-close:active {
            background: rgba(220,38,38,0.15);
            color: #ef4444;
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

        /* ---------- Update chip ---------- */
        .cnm-updates-chip {
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 600;
            background: #10b981;
            color: white;
            border: 1px solid #10b981;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.15s, box-shadow 0.15s;
            white-space: nowrap;
        }
        .cnm-updates-chip:hover {
            background: #059669;
        }
        .cnm-updates-chip-active {
            background: #047857;
            box-shadow: 0 0 0 2px rgba(16,185,129,0.35);
        }
        .cnm-updates-chip-checking {
            background: #6b7280;
            border-color: #6b7280;
            cursor: default;
        }
        .cnm-updates-chip-checking:hover {
            background: #6b7280;
        }

        /* ---------- Clickable badges ---------- */
        .cnm-badge-clickable {
            cursor: pointer;
            transition: filter 0.15s, transform 0.1s;
        }
        .cnm-badge-clickable:hover {
            filter: brightness(1.15);
            transform: translateY(-1px);
        }
        .cnm-badge-clickable:active {
            transform: translateY(0);
        }

        /* ---------- Stash rows ---------- */
        .cnm-stash-row {
            display: flex; align-items: flex-start; gap: 12px;
            padding: 12px;
        }
        .cnm-stash-row + .cnm-stash-row {
            border-top: 1px solid var(--border-color);
        }
        .cnm-stash-info {
            flex: 1 1 auto;
            display: flex; flex-direction: column; gap: 3px;
            min-width: 0;
        }
        .cnm-stash-head {
            display: flex; align-items: baseline; gap: 0;
            font-size: 12px;
        }
        .cnm-stash-ref {
            font-family: monospace;
            color: #f59e0b;
            font-weight: 600;
        }
        .cnm-stash-sep {
            color: var(--descrip-text);
            opacity: 0.6;
        }
        .cnm-stash-date {
            font-family: monospace;
            font-size: 12px;
            color: var(--descrip-text);
        }
        .cnm-stash-base {
            font-size: 12px;
            color: var(--descrip-text);
            display: flex; align-items: baseline; gap: 0;
            min-width: 0;
        }
        .cnm-stash-base-label {
            color: var(--descrip-text);
            font-weight: 500;
        }
        .cnm-stash-base-subject {
            color: var(--descrip-text);
            font-style: italic;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 340px;
        }
        .cnm-stash-stats {
            font-size: 12px;
            color: var(--descrip-text);
            margin-top: 2px;
        }
        .cnm-stash-ins {
            color: #10b981;
            font-family: monospace;
            font-weight: 600;
        }
        .cnm-stash-del {
            color: #ef4444;
            font-family: monospace;
            font-weight: 600;
        }
        .cnm-stash-files {
            margin-top: 6px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            max-height: 220px;
            overflow-y: auto;
            padding-right: 4px;
        }
        .cnm-stash-files::-webkit-scrollbar {
            width: 6px;
        }
        .cnm-stash-files::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 3px;
        }
        .cnm-stash-files::-webkit-scrollbar-thumb:hover {
            background: var(--descrip-text);
        }
        .cnm-stash-file {
            display: flex;
            gap: 8px;
            align-items: baseline;
            font-size: 12px;
            line-height: 1.4;
        }
        .cnm-stash-status {
            flex: 0 0 auto;
            font-family: monospace;
            font-weight: 700;
            width: 14px;
            text-align: center;
        }
        .cnm-stash-status-m { color: #f59e0b; }
        .cnm-stash-status-a { color: #10b981; }
        .cnm-stash-status-d { color: #ef4444; }
        .cnm-stash-status-r { color: #3b82f6; }
        .cnm-stash-status-x { color: var(--descrip-text); }
        .cnm-stash-path {
            font-family: monospace;
            color: var(--fg-color);
            word-break: break-all;
            min-width: 0;
        }
        .cnm-stash-toggle {
            align-self: flex-start;
            margin-top: 6px;
            padding: 3px 10px;
            background: transparent;
            border: 1px dashed var(--border-color);
            border-radius: 4px;
            color: var(--descrip-text);
            cursor: pointer;
            font-size: 11px;
            transition: background 0.15s, color 0.15s;
        }
        .cnm-stash-toggle:hover {
            background: var(--comfy-menu-secondary-bg);
            color: var(--fg-color);
        }
        .cnm-stash-actions {
            flex: 0 0 auto;
            display: flex;
            flex-direction: column;
            gap: 6px;
            align-self: flex-start;
        }
        .cnm-ver-source {
            font-size: 11px;
            color: var(--descrip-text);
            font-style: italic;
            margin-top: -6px;
            margin-bottom: 4px;
        }
        .cnm-ver-source-github {
            color: #10b981;
            font-style: normal;
            font-weight: 500;
        }
        /* ---------- Select bar ---------- */
        .cnm-select-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 18px;
            background: rgba(16,185,129,0.08);
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-select-counter {
            font-size: 12px;
            color: var(--descrip-text);
        }
        /* ---------- Popup header: заголовок и ✕ в одну строку ---------- */
        .cnm-pop .cnm-pop-header {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 10px !important;
            padding: 12px 16px !important;
            border-bottom: 1px solid var(--border-color);
        }
        .cnm-pop .cnm-pop-header .cnm-pop-title {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            margin: 0 !important;
            font-size: 15px;
            font-weight: 600;
            color: var(--fg-color);
            word-break: break-word;
        }
        .cnm-pop .cnm-pop-header .cnm-pop-header-close {
            flex: 0 0 auto !important;
            width: 26px !important;
            height: 26px !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--descrip-text);
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            line-height: 1;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
        }
        .cnm-pop .cnm-pop-header .cnm-pop-header-close:hover {
            background: var(--comfy-menu-secondary-bg);
            color: var(--fg-color);
        }
        .cnm-pop .cnm-pop-header .cnm-pop-header-close:active {
            background: rgba(220,38,38,0.15);
            color: #ef4444;
            border-color: #ef4444;
        }
        .cnm-detected-url {
            font-size: 11px;
            color: var(--descrip-text);
            text-decoration: none;
        }
        .cnm-detected-url:hover {
            text-decoration: underline;
        }
        /* ---------- Version badge ---------- */
        .cnm-badge-version {
            background: rgba(59,130,246,0.18);
            color: var(--fg-color);
            border: 1px solid rgba(59,130,246,0.4);
            font-weight: 600;
        }
        .cnm-badge-version-text {
            font-family: monospace;
        }
        .cnm-badge-source {
            font-size: 10px;
            font-weight: 400;
            color: var(--descrip-text);
            opacity: 0.85;
        }
    `;
    document.head.appendChild(style);
}

function _isNetworkError(e) {
    if (!e) return false;
    const msg = String(e.message || "");
    return (
        e.name === "TypeError" ||
        /network|failed to fetch|fetch resource/i.test(msg)
    );
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;",
    })[c]);
}