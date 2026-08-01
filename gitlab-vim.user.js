// ==UserScript==
// @name         GitLab Vim Navigation
// @namespace    https://github.com/ngmtine
// @version      0.1.0
// @description  GitLab を vim ライクなキーバインドで操作する (j/k ナビ・検索パレット・yy/yb コピー)
// @match        https://gitlab.com/*
// @match        https://gitlab.firstloop-tech.com/*
// @downloadURL  https://raw.githubusercontent.com/ngmtine/gitlab-vim/master/gitlab-vim.user.js
// @updateURL    https://raw.githubusercontent.com/ngmtine/gitlab-vim/master/gitlab-vim.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
    "use strict";

    // ---------------------------------------------------------------------
    // 定数
    // ---------------------------------------------------------------------

    const FOCUS_ATTR = "data-glv-focus";
    const SELECTED_ATTR = "data-glv-selected";
    const INDEX_ATTR = "data-glv-index";

    /** フォーカス先が画面内に収まっているとみなすための上下マージン (px) */
    const SCROLL_MARGIN_PX = 80;
    /** y の 1 打目を覚えておく時間 (ms) */
    const Y_SEQUENCE_MS = 600;
    const SEARCH_DEBOUNCE_MS = 250;
    const RESULT_LIMIT = 20;
    const TOAST_MS = 2000;

    // GitLab の class 名はユーティリティクラス主体で入れ替わりが激しいため手がかりにしない。
    // data-testid は GitLab の E2E テスト用の属性で、class より変更されにくいという判断でこちらに寄せる
    // (GitLab 側が後方互換を保証しているわけではない)。
    // issue 一覧 (旧 UI の /-/issues と新 UI の /-/work_items の両方) と MR 一覧が同じ testid を共有する。
    const ROW_LINK_SELECTOR = 'a[data-testid="issuable-title-link"]';
    const PREV_BUTTON_SELECTOR = 'button[data-testid="prevButton"]';
    const NEXT_BUTTON_SELECTOR = 'button[data-testid="nextButton"]';

    /** issue/MR 詳細ページの判定。work_items は issue の新 UI */
    const ISSUABLE_PATH_RE = /\/-\/(issues|work_items|merge_requests)\/(\d+)/;

    /** この先頭セグメントを持つパスはプロジェクトではない (個人ダッシュボード・グループ・管理画面など) */
    const RESERVED_TOP_SEGMENTS = new Set([
        "dashboard",
        "groups",
        "admin",
        "help",
        "users",
        "search",
        "explore",
        "api",
        "projects",
        "-",
    ]);

    const STATE_CLASSES = {
        opened: "glv-state-opened",
        closed: "glv-state-closed",
        merged: "glv-state-merged",
    };

    // ---------------------------------------------------------------------
    // 状態
    // ---------------------------------------------------------------------

    /** 現在フォーカス中の行アンカー。インデックスではなく要素参照で持つ (DOM 差し替えで番号がずれるため) */
    let focusedRow = null;
    /** y シーケンスの 1 打目を押した時刻 (ms)。0 は待ち状態なし */
    let pendingYAt = 0;

    let toastElement = null;
    let toastTimer = 0;

    let searchTimer = 0;
    let searchController = null;
    /** プロジェクト文脈の検出結果を保持する Promise。検証 API を 2 回以上叩かないためのキャッシュ */
    let projectPathPromise = null;

    const paletteState = {
        root: null,
        input: null,
        hint: null,
        list: null,
        open: false,
        /** "project" | "global" */
        scope: "global",
        /** プロジェクトのフルパス。null ならプロジェクト文脈なし */
        projectPath: null,
        /** ユーザーが Tab でスコープを切り替えたか。文脈検出の完了時に上書きしないための目印 */
        scopeTouched: false,
        items: [],
        selected: 0,
    };

    class ApiError extends Error {
        constructor(status) {
            super(`HTTP ${status}`);
            this.name = "ApiError";
            this.status = status;
        }
    }

    // ---------------------------------------------------------------------
    // スタイル
    // ---------------------------------------------------------------------

    const injectStyle = () => {
        const style = document.createElement("style");
        // GitLab 側のスタイル (ユーティリティクラスやリセット CSS) に負けないよう !important を付ける。
        // パレットとトーストは GitLab のライト/ダークテーマに依存しない自己完結の配色にする。
        style.textContent = `a[${FOCUS_ATTR}] {
    outline: 2px solid #fc6d26 !important;
    outline-offset: 2px !important;
    border-radius: 3px !important;
    background-color: rgba(252, 109, 38, 0.10) !important;
}

/* .glv-backdrop の display より優先させたいので、詳細度を上げて記述順に依存させない */
.glv-backdrop.glv-hidden {
    display: none !important;
}

.glv-backdrop {
    position: fixed !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    z-index: 2147483000 !important;
    display: flex !important;
    align-items: flex-start !important;
    justify-content: center !important;
    padding: 10vh 16px 16px !important;
    margin: 0 !important;
    background: rgba(0, 0, 0, 0.55) !important;
}

.glv-panel {
    display: flex !important;
    flex-direction: column !important;
    width: min(760px, 96vw) !important;
    max-height: 76vh !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 1px solid #3d3d4d !important;
    border-radius: 8px !important;
    background: #1c1c24 !important;
    color: #f2f2f5 !important;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55) !important;
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans JP", sans-serif !important;
    font-size: 14px !important;
    line-height: 1.5 !important;
    text-align: left !important;
}

.glv-input {
    box-sizing: border-box !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 12px 14px !important;
    border: none !important;
    border-bottom: 1px solid #3d3d4d !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: #f2f2f5 !important;
    font-family: inherit !important;
    font-size: 16px !important;
    outline: none !important;
    box-shadow: none !important;
}

.glv-input::placeholder {
    color: #7b7b8c !important;
}

.glv-hint {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 4px 12px !important;
    margin: 0 !important;
    padding: 6px 14px !important;
    border-bottom: 1px solid #3d3d4d !important;
    background: #23232d !important;
    color: #a9a9bb !important;
    font-size: 12px !important;
}

.glv-scope {
    color: #f2f2f5 !important;
}

.glv-list {
    margin: 0 !important;
    padding: 0 !important;
    overflow-y: auto !important;
    list-style: none !important;
}

.glv-item {
    display: flex !important;
    align-items: baseline !important;
    gap: 8px !important;
    margin: 0 !important;
    padding: 7px 14px !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    color: #f2f2f5 !important;
    cursor: pointer !important;
}

.glv-item[${SELECTED_ATTR}] {
    background: #2d3d5c !important;
}

.glv-ref {
    flex: 0 0 auto !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
}

.glv-ref-issue {
    color: #ffb45f !important;
}

.glv-ref-mr {
    color: #7fc7ff !important;
}

.glv-title {
    flex: 1 1 auto !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
}

.glv-project {
    flex: 0 1 auto !important;
    max-width: 30% !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    color: #a9a9bb !important;
    font-size: 12px !important;
}

.glv-state {
    flex: 0 0 auto !important;
    padding: 1px 7px !important;
    border-radius: 9px !important;
    background: #4a4a5a !important;
    color: #e6e6ee !important;
    font-size: 11px !important;
}

.glv-state-opened {
    background: #1f6f43 !important;
    color: #eafff1 !important;
}

.glv-state-closed {
    background: #8b2c2c !important;
    color: #ffeaea !important;
}

.glv-state-merged {
    background: #3b4fa8 !important;
    color: #eaefff !important;
}

.glv-date {
    flex: 0 0 auto !important;
    color: #a9a9bb !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
    font-size: 12px !important;
}

.glv-message {
    margin: 0 !important;
    padding: 10px 14px !important;
    color: #a9a9bb !important;
    font-size: 13px !important;
    list-style: none !important;
}

.glv-message-error {
    color: #ff9f9f !important;
}

.glv-toast {
    position: fixed !important;
    right: 16px !important;
    bottom: 16px !important;
    z-index: 2147483000 !important;
    max-width: 40vw !important;
    margin: 0 !important;
    padding: 10px 14px !important;
    border: 1px solid #3d3d4d !important;
    border-radius: 6px !important;
    background: #1c1c24 !important;
    color: #f2f2f5 !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45) !important;
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans JP", sans-serif !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
}`;
        (document.head || document.documentElement).appendChild(style);
    };

    // ---------------------------------------------------------------------
    // トースト
    // ---------------------------------------------------------------------

    const showToast = (message) => {
        if (!toastElement) {
            toastElement = document.createElement("div");
            toastElement.className = "glv-toast";
        }
        toastElement.textContent = message;
        (document.body || document.documentElement).appendChild(toastElement);

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastElement.remove();
        }, TOAST_MS);
    };

    // ---------------------------------------------------------------------
    // 一覧の列挙とフォーカス移動
    // ---------------------------------------------------------------------

    /** blur してもハイライトだけが残らないようにする */
    const onRowBlur = (e) => {
        e.currentTarget.removeAttribute(FOCUS_ATTR);
    };

    // GitLab は一覧を非同期に差し替える (フィルタ適用・keyset ページング・work_items の Vue ルーティング)。
    // キャッシュを保守するより、キー入力のたびに素直に取り直す方が実 DOM とずれない。
    const collectRows = () => {
        const rows = [];
        const seenHrefs = new Set();

        for (const anchor of document.querySelectorAll(ROW_LINK_SELECTOR)) {
            // 折りたたみ内や display:none の要素を除く
            if (anchor.offsetParent === null) continue;

            const href = anchor.href;
            if (!href) continue;
            // レスポンシブ対応で同一行が二重に描画されるレイアウトを取りこぼさず 1 件に畳む
            if (seenHrefs.has(href)) continue;

            seenHrefs.add(href);
            rows.push(anchor);
        }

        return rows;
    };

    /** 現在位置を返す。未選択・見失った場合は -1 */
    const getCurrentIndex = (rows) => {
        const active = document.activeElement;
        if (active) {
            const activeIndex = rows.indexOf(active);
            if (activeIndex !== -1) return activeIndex;
        }
        if (focusedRow) return rows.indexOf(focusedRow);
        return -1;
    };

    const focusRow = (anchor) => {
        if (!anchor) return;

        if (focusedRow && focusedRow !== anchor) {
            focusedRow.removeAttribute(FOCUS_ATTR);
        }
        focusedRow = anchor;
        anchor.setAttribute(FOCUS_ATTR, "");

        // 同一の関数参照なので、重ねて呼んでもリスナは重複登録されない
        anchor.addEventListener("blur", onRowBlur);

        // focus() 由来のスクロールは端に寄るだけなので抑止し、スクロールは自前で判断する
        anchor.focus({ preventScroll: true });

        // 移動のたびに中央寄せするとビューポートが毎回跳ねて追いにくい。
        // 上下に余白を残して画面内に収まっている間はスクロールせず、
        // 画面外か端に近いときだけ中央へ寄せる (vim の scrolloff に近い挙動)。
        const rect = anchor.getBoundingClientRect();
        const isComfortablyVisible = rect.top >= SCROLL_MARGIN_PX && rect.bottom <= window.innerHeight - SCROLL_MARGIN_PX;
        if (!isComfortablyVisible) {
            anchor.scrollIntoView({ block: "center" });
        }
    };

    /** 処理したら true。一覧が無いページではキーを奪わない */
    const moveFocus = (delta) => {
        const rows = collectRows();
        if (rows.length === 0) return false;

        const current = getCurrentIndex(rows);
        // 見失った場合は先頭扱い
        const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), rows.length - 1);
        focusRow(rows[next]);
        return true;
    };

    const openFocusedInNewTab = () => {
        const rows = collectRows();
        const index = getCurrentIndex(rows);
        if (index === -1) return false;
        window.open(rows[index].href, "_blank", "noopener");
        return true;
    };

    // ---------------------------------------------------------------------
    // ページネーション
    // ---------------------------------------------------------------------

    // 新 UI は keyset ページネーションの button、旧 UI は offset ページネーションの a[rel] を描画する
    const goPage = (direction) => {
        const button = document.querySelector(direction === "next" ? NEXT_BUTTON_SELECTOR : PREV_BUTTON_SELECTOR);
        if (button) {
            // 端のページではボタンが disabled で描画される。その場合は何もしない
            if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
            button.click();
            return true;
        }

        const link = document.querySelector(direction === "next" ? 'a[rel="next"]' : 'a[rel="prev"]');
        if (!link) return false;
        link.click();
        return true;
    };

    // ---------------------------------------------------------------------
    // プロジェクト文脈の検出
    // ---------------------------------------------------------------------

    const apiBase = () => `${location.origin}/api/v4`;

    /** location からプロジェクトのフルパス候補を返す。verified が true なら API 検証は要らない */
    const guessProjectPath = () => {
        const path = location.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
        if (!path) return null;

        const segments = path.split("/");
        if (RESERVED_TOP_SEGMENTS.has(segments[0])) return null;

        // "/-/" より前がプロジェクトのフルパス。サブグループがあるので階層数を固定で仮定しない
        const dashIndex = segments.indexOf("-");
        if (dashIndex !== -1) {
            // プロジェクトのフルパスは最低でも namespace/project の 2 段
            if (dashIndex < 2) return null;
            return { path: segments.slice(0, dashIndex).join("/"), verified: true };
        }

        // "/-/" が無いページ (プロジェクトトップなど) はグループページと見分けが付かないので検証に回す
        if (segments.length < 2) return null;
        return { path, verified: false };
    };

    const detectProjectPath = async () => {
        const candidate = guessProjectPath();
        if (!candidate) return null;
        if (candidate.verified) return candidate.path;

        try {
            const response = await fetch(`${apiBase()}/projects/${encodeURIComponent(candidate.path)}`, {
                headers: { Accept: "application/json" },
            });
            return response.ok ? candidate.path : null;
        } catch {
            return null;
        }
    };

    const resolveProjectPath = () => {
        if (!projectPathPromise) projectPathPromise = detectProjectPath();
        return projectPathPromise;
    };

    // ---------------------------------------------------------------------
    // REST API v4
    // ---------------------------------------------------------------------

    // same-origin なのでセッション Cookie がそのまま効き、アクセストークンを持たせる必要がない
    const fetchIssuables = async (kind, scope, projectPath, term, signal) => {
        const resource = kind === "issue" ? "issues" : "merge_requests";
        const params = new URLSearchParams({
            per_page: String(RESULT_LIMIT),
            order_by: "updated_at",
            sort: "desc",
        });
        // 検索語が空のときは search を付けず、更新日降順の一覧をそのまま出す
        if (term) params.set("search", term);

        let url;
        if (scope === "project" && projectPath) {
            url = `${apiBase()}/projects/${encodeURIComponent(projectPath)}/${resource}?${params.toString()}`;
        } else {
            params.set("scope", "all");
            url = `${apiBase()}/${resource}?${params.toString()}`;
        }

        const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new ApiError(response.status);

        const payload = await response.json();
        if (!Array.isArray(payload)) return [];
        return payload.map((raw) => normalizeIssuable(kind, raw));
    };

    const formatDate = (iso) => {
        const date = new Date(iso ?? "");
        if (Number.isNaN(date.getTime())) return "";
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };

    const normalizeIssuable = (kind, raw) => ({
        kind,
        iid: raw.iid,
        title: raw.title ?? "",
        state: raw.state ?? "",
        webUrl: raw.web_url ?? "",
        updatedAt: Date.parse(raw.updated_at ?? "") || 0,
        updatedLabel: formatDate(raw.updated_at),
        // references.full は "group/project#123" / "group/project!45" 形式。プロジェクトパスだけを取り出す
        projectPath: typeof raw.references?.full === "string" ? raw.references.full.split(/[#!]/)[0] : "",
    });

    const describeError = (kind, error, scope) => {
        const label = kind === "issue" ? "issue" : "MR";
        if (!(error instanceof ApiError)) {
            return `${label} の取得に失敗した (${error?.message ?? "不明なエラー"})`;
        }
        if (scope === "global" && (error.status === 401 || error.status === 403 || error.status === 500)) {
            return `${label} の取得に失敗した (HTTP ${error.status})。グローバル検索はログインが必要な可能性`;
        }
        if (error.status === 408 || error.status === 504) {
            return `${label} の取得がタイムアウトした (HTTP ${error.status})。検索語を絞ると通ることがある`;
        }
        return `${label} の取得に失敗した (HTTP ${error.status})`;
    };

    // ---------------------------------------------------------------------
    // 検索パレット
    // ---------------------------------------------------------------------

    const parseQuery = (raw) => {
        const text = raw.trim();
        if (text.startsWith("#")) return { kinds: ["issue"], term: text.slice(1).trim() };
        if (text.startsWith("!")) return { kinds: ["mr"], term: text.slice(1).trim() };
        return { kinds: ["issue", "mr"], term: text };
    };

    const appendMessage = (text, isError) => {
        const li = document.createElement("li");
        li.className = isError ? "glv-message glv-message-error" : "glv-message";
        li.textContent = text;
        paletteState.list.appendChild(li);
    };

    const renderMessage = (text, isError) => {
        paletteState.items = [];
        paletteState.selected = 0;
        paletteState.list.textContent = "";
        appendMessage(text, isError);
    };

    const renderHint = () => {
        const scopeText = paletteState.projectPath
            ? paletteState.scope === "project"
                ? `スコープ: ${paletteState.projectPath} (Tab で全体へ)`
                : "スコープ: 全体 (Tab でプロジェクトへ)"
            : "スコープ: 全体";

        paletteState.hint.textContent = "";

        const scope = document.createElement("span");
        scope.className = "glv-scope";
        scope.textContent = scopeText;

        const keys = document.createElement("span");
        keys.textContent = "# issue / ! MR / Enter 開く / Ctrl+Enter 新規タブ / Ctrl+n Ctrl+p 選択 / Esc 閉じる";

        paletteState.hint.append(scope, keys);
    };

    const buildItemNode = (item, index) => {
        const li = document.createElement("li");
        li.className = "glv-item";
        li.setAttribute(INDEX_ATTR, String(index));

        const ref = document.createElement("span");
        ref.className = item.kind === "mr" ? "glv-ref glv-ref-mr" : "glv-ref glv-ref-issue";
        ref.textContent = `${item.kind === "mr" ? "!" : "#"}${item.iid}`;

        const title = document.createElement("span");
        title.className = "glv-title";
        title.textContent = item.title;

        li.append(ref, title);

        if (paletteState.scope === "global" && item.projectPath) {
            const project = document.createElement("span");
            project.className = "glv-project";
            project.textContent = item.projectPath;
            li.appendChild(project);
        }

        if (item.state) {
            const state = document.createElement("span");
            const stateClass = STATE_CLASSES[item.state];
            state.className = stateClass ? `glv-state ${stateClass}` : "glv-state";
            state.textContent = item.state;
            li.appendChild(state);
        }

        if (item.updatedLabel) {
            const date = document.createElement("span");
            date.className = "glv-date";
            date.textContent = item.updatedLabel;
            li.appendChild(date);
        }

        return li;
    };

    const updateSelection = (shouldScroll) => {
        const nodes = paletteState.list.querySelectorAll(".glv-item");
        nodes.forEach((node, index) => {
            if (index !== paletteState.selected) {
                node.removeAttribute(SELECTED_ATTR);
                return;
            }
            node.setAttribute(SELECTED_ATTR, "");
            if (shouldScroll) node.scrollIntoView({ block: "nearest" });
        });
    };

    const renderResults = (items, errors) => {
        paletteState.items = items;
        paletteState.selected = 0;
        paletteState.list.textContent = "";

        for (const message of errors) appendMessage(message, true);

        if (items.length === 0) {
            appendMessage(errors.length > 0 ? "表示できる結果がない" : "該当なし", false);
            return;
        }

        items.forEach((item, index) => paletteState.list.appendChild(buildItemNode(item, index)));
        updateSelection(false);
    };

    const moveSelection = (delta) => {
        if (paletteState.items.length === 0) return;
        const next = paletteState.selected + delta;
        paletteState.selected = Math.min(Math.max(next, 0), paletteState.items.length - 1);
        updateSelection(true);
    };

    const openSelected = (newTab) => {
        const item = paletteState.items[paletteState.selected];
        if (!item || !item.webUrl) return;

        const url = item.webUrl;
        closePalette();
        if (newTab) {
            window.open(url, "_blank", "noopener");
            return;
        }
        location.href = url;
    };

    const runSearch = async () => {
        if (!paletteState.open) return;

        // 実行中の fetch は中断してから次を発行する
        if (searchController) searchController.abort();
        const controller = new AbortController();
        searchController = controller;

        const { kinds, term } = parseQuery(paletteState.input.value);
        const scope = paletteState.projectPath ? paletteState.scope : "global";
        const projectPath = paletteState.projectPath;

        const settled = await Promise.allSettled(
            kinds.map((kind) => fetchIssuables(kind, scope, projectPath, term, controller.signal)),
        );

        // 応答を待つ間に次の検索が始まっていたら、この結果は捨てる
        if (controller.signal.aborted || searchController !== controller || !paletteState.open) return;

        const items = [];
        const errors = [];
        settled.forEach((result, index) => {
            if (result.status === "fulfilled") {
                items.push(...result.value);
                return;
            }
            // issue と MR は片方だけ失敗しうる (巨大プロジェクトの MR 検索が 408 になる等)。
            // 成功した側は表示しつつ、失敗した種別だけをエラー行で知らせる
            errors.push(describeError(kinds[index], result.reason, scope));
        });

        items.sort((a, b) => b.updatedAt - a.updatedAt);
        renderResults(items.slice(0, RESULT_LIMIT), errors);
    };

    const scheduleSearch = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            void runSearch();
        }, SEARCH_DEBOUNCE_MS);
    };

    const toggleScope = () => {
        // プロジェクト文脈が無いページではグローバル固定
        if (!paletteState.projectPath) return;
        paletteState.scopeTouched = true;
        paletteState.scope = paletteState.scope === "project" ? "global" : "project";
        renderHint();
        void runSearch();
    };

    const onListClick = (e) => {
        const node = e.target instanceof Element ? e.target.closest(".glv-item") : null;
        if (!node) return;

        const index = Number.parseInt(node.getAttribute(INDEX_ATTR) ?? "", 10);
        if (!Number.isFinite(index)) return;

        e.preventDefault();
        paletteState.selected = index;
        openSelected(e.ctrlKey || e.metaKey);
    };

    const onPaletteKeyDown = (e) => {
        // パレット内のキーを GitLab 本体のショートカット (document で待ち受けている) へ漏らさない
        e.stopPropagation();

        // 変換確定の Enter が「開く」に化けるのを防ぐ
        if (e.isComposing || e.keyCode === 229) return;

        const key = e.key;

        if (key === "Escape") {
            closePalette();
            e.preventDefault();
            return;
        }

        if (key === "Enter") {
            openSelected(e.ctrlKey || e.metaKey);
            e.preventDefault();
            return;
        }

        if (key === "Tab") {
            toggleScope();
            e.preventDefault();
            return;
        }

        if (key === "ArrowDown" || (e.ctrlKey && key === "n")) {
            moveSelection(1);
            e.preventDefault();
            return;
        }

        if (key === "ArrowUp" || (e.ctrlKey && key === "p")) {
            moveSelection(-1);
            e.preventDefault();
        }
    };

    const buildPalette = () => {
        if (paletteState.root) return;

        const root = document.createElement("div");
        root.className = "glv-backdrop glv-hidden";

        const panel = document.createElement("div");
        panel.className = "glv-panel";

        const input = document.createElement("input");
        input.className = "glv-input";
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = "issue / MR を検索 (先頭 # で issue のみ、! で MR のみ)";

        const hint = document.createElement("div");
        hint.className = "glv-hint";

        const list = document.createElement("ul");
        list.className = "glv-list";

        panel.append(input, hint, list);
        root.appendChild(panel);

        root.addEventListener("mousedown", (e) => {
            if (e.target === root) closePalette();
        });
        input.addEventListener("input", scheduleSearch);
        // バブリングで受けて止める。キャプチャで止めると input 自身にイベントが届かなくなる
        root.addEventListener("keydown", onPaletteKeyDown);
        list.addEventListener("click", onListClick);

        (document.body || document.documentElement).appendChild(root);

        paletteState.root = root;
        paletteState.input = input;
        paletteState.hint = hint;
        paletteState.list = list;
    };

    const openPalette = () => {
        if (paletteState.open) return;

        buildPalette();
        paletteState.open = true;
        paletteState.scopeTouched = false;
        paletteState.input.value = "";
        paletteState.root.classList.remove("glv-hidden");
        paletteState.input.focus();
        renderHint();
        renderMessage("読み込み中…", false);

        void resolveProjectPath().then((projectPath) => {
            if (!paletteState.open) return;
            paletteState.projectPath = projectPath;
            // 検出を待つ間に Tab を押されていたら、ユーザーの選択を優先する
            if (!paletteState.scopeTouched) paletteState.scope = projectPath ? "project" : "global";
            renderHint();
            void runSearch();
        });
    };

    const closePalette = () => {
        if (!paletteState.open) return;

        paletteState.open = false;
        clearTimeout(searchTimer);
        if (searchController) {
            searchController.abort();
            searchController = null;
        }
        // 閉じたあとにグローバルのキーバインドが効くよう、input からフォーカスを外す
        paletteState.input.blur();
        paletteState.root.classList.add("glv-hidden");
        paletteState.list.textContent = "";
        paletteState.items = [];
        paletteState.selected = 0;
    };

    // ---------------------------------------------------------------------
    // y コピーシーケンス
    // ---------------------------------------------------------------------

    const getIssuableContext = () => {
        const match = location.pathname.match(ISSUABLE_PATH_RE);
        if (!match) return null;
        return {
            kind: match[1] === "merge_requests" ? "mr" : "issue",
            iid: match[2],
            projectPath: location.pathname.replace(/^\/+/, "").split("/-/")[0],
        };
    };

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            showToast(`コピーした: ${text}`);
        } catch (error) {
            showToast(`コピーに失敗した: ${error?.message ?? "不明なエラー"}`);
        }
    };

    const copyReference = (context) => {
        void copyToClipboard(`${context.kind === "mr" ? "!" : "#"}${context.iid}`);
    };

    const copySourceBranch = async (context) => {
        if (context.kind !== "mr") {
            showToast("yb は MR ページ専用");
            return;
        }
        if (!context.projectPath) {
            showToast("プロジェクトパスを特定できなかった");
            return;
        }

        const url = `${apiBase()}/projects/${encodeURIComponent(context.projectPath)}/merge_requests/${context.iid}`;
        try {
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) throw new ApiError(response.status);

            const payload = await response.json();
            if (!payload.source_branch) throw new Error("source_branch が空");
            await copyToClipboard(payload.source_branch);
        } catch (error) {
            showToast(`ブランチ名の取得に失敗した: ${error?.message ?? "不明なエラー"}`);
        }
    };

    // ---------------------------------------------------------------------
    // キーハンドラ
    // ---------------------------------------------------------------------

    const isEditableTarget = (target) => {
        if (!(target instanceof Element)) return false;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (target instanceof HTMLElement && target.isContentEditable) return true;
        return false;
    };

    const onKeyDown = (e) => {
        // IME 変換中の keydown をキーバインドとして扱うと、日本語入力が「j で下移動」等に化ける。
        // keyCode === 229 は isComposing を正しく立てない環境向けのフォールバック。
        if (e.isComposing || e.keyCode === 229) return;

        // ブラウザ/GitLab 側のショートカットを奪わない。Shift だけは ":" のために許容する
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        // パレット表示中はパレット自身のハンドラに任せる。
        // ただし Escape だけはここでも処理する。Vimium 等の拡張が insert モードの Esc を
        // 横取りして input を blur した後でも、もう一度 Esc を押せば閉じられるようにするため
        if (paletteState.open) {
            if (e.key === "Escape") {
                closePalette();
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }

        // GitLab はリッチテキストエディタやフィルタ入力だらけなので、編集対象では一切横取りしない
        if (isEditableTarget(e.target)) return;

        const key = e.key;

        // y シーケンス。ネイティブの y (ファイル閲覧ページの permalink コピー) と衝突しないよう
        // issue/MR 詳細ページでのみ受け付ける
        const issuable = getIssuableContext();
        const now = Date.now();
        const waitingSecondKey = pendingYAt !== 0 && now - pendingYAt <= Y_SEQUENCE_MS;
        pendingYAt = 0;

        if (waitingSecondKey && issuable) {
            if (key === "y") {
                copyReference(issuable);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (key === "b") {
                void copySourceBranch(issuable);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // 2 打目が y/b 以外・時間切れなら、そのキーの通常処理に戻す
        }

        if (key === "y" && issuable) {
            // 1 打目の y には他の割り当てが無いので、2 打目を待つあいだ握りつぶしてよい
            pendingYAt = now;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        let handled = false;
        switch (key) {
            case "j":
                handled = moveFocus(1);
                break;
            case "k":
                handled = moveFocus(-1);
                break;
            case "l":
                handled = goPage("next");
                break;
            case "h":
                handled = goPage("prev");
                break;
            case "o":
                handled = openFocusedInNewTab();
                break;
            case ":":
                openPalette();
                handled = true;
                break;
            default:
                return;
        }

        // 一覧が無いページやページネーションの端では、GitLab 側にキーを渡す
        if (!handled) return;

        e.preventDefault();
        e.stopPropagation();
    };

    injectStyle();
    // GitLab 自身のキーハンドラより先に受けたいのでキャプチャフェーズで登録する
    document.addEventListener("keydown", onKeyDown, true);
})();
