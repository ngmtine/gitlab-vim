# 🦊 GitLab Vim Navigation

GitLab を vim ライクなキーバインドで操作する userscript。⌨️
`j` / `k` で issue/MR 一覧を辿り、`:` で issue/MR の検索パレットを開き、`yy` / `yb` で参照やブランチ名をコピーする。
Tampermonkey / Violentmonkey での利用を想定した単一ファイル・依存ゼロのスクリプト。📄

## 📦 インストール

`gitlab-vim.user.js` をユーザースクリプトマネージャに読み込む。

### 🔗 raw URL からインストール (推奨)

Tampermonkey / Violentmonkey を導入済みのブラウザで以下の URL を開くと、インストール画面が表示される。⬇️

```
https://raw.githubusercontent.com/ngmtine/gitlab-vim/master/gitlab-vim.user.js
```

メタデータの `@updateURL` / `@downloadURL` がこの URL を指しているため、master を更新すれば各ブラウザに自動更新が配信される。🔄

### 🐒 Tampermonkey

1. 🧭 Tampermonkey の管理画面を開く。
2. ✏️ 「新規スクリプトを作成」を選び、エディタの内容を `gitlab-vim.user.js` の全文で置き換える。
3. 💾 保存する (Ctrl+S)。

リポジトリを clone 済みなら、`file://` の URL を直接開いてインストールすることもできる。📂
その場合は Tampermonkey の拡張機能設定で「ファイルの URL へのアクセスを許可する」を有効にする必要がある。🔓

### 🐵 Violentmonkey

1. 🧭 Violentmonkey のダッシュボードを開く。
2. ✏️ 「+」から「新規スクリプト」を選び、エディタの内容を `gitlab-vim.user.js` の全文で置き換える。
3. 💾 保存する。

## ⌨️ キーバインド

入力欄 (input / textarea / select / contenteditable) にフォーカスがあるときは、キー入力を一切横取りしない。🛡️
IME 変換中の keydown も横取りしない。🇯🇵
Ctrl / Alt / Meta を伴う入力も素通しする (パレット内の Ctrl+Enter / Ctrl+n / Ctrl+p を除く)。🎹

### 📋 一覧ページ (issue 一覧 / MR 一覧)

| キー | 動作 |
|---|---|
| j / k | ⬇️⬆️ 次/前の issue・MR タイトルへフォーカス移動 |
| h / l | ◀️▶️ 前/次ページへ (ページネーションのボタンまたはリンクをクリック) |
| o | 🆕 フォーカス中の issue・MR を新規タブで開く |

フォーカス中の行を現在のタブで開く操作は用意していない。🚫
タイトルリンクに実際のフォーカスを当てているため、Enter で開く・Ctrl+Enter で新規タブに開くというブラウザ標準の挙動がそのまま使える。↩️

### 🔍 issue / MR 詳細ページ

| キー | 動作 |
|---|---|
| yy | 📋 参照をコピー (issue なら `#123`、MR なら `!45`) |
| yb | 🌿 MR のソースブランチ名をコピー (MR ページ専用) |

`y` の 1 打目から 2 打目までの猶予は 600ms。⏱️
2 打目が `y` / `b` 以外だったときや時間切れのときは、そのキーの通常処理に戻す。
コピーの成否は画面右下のトーストで通知する (2 秒で消える)。🍞

### 🎛️ 検索パレット (`:` で起動)

| キー | 動作 |
|---|---|
| : | 🚀 パレットを開く (一覧ページ以外でも開く) |
| #〜 | 🐛 先頭 `#` で issue のみを検索 |
| !〜 | 🔀 先頭 `!` で MR のみを検索 |
| (空) | 🕒 検索語なしなら最近更新された issue/MR を表示 |
| Tab | 🔭 スコープをプロジェクト ⇔ 全体でトグル |
| ArrowDown / Ctrl+n | ⬇️ 次の候補を選択 |
| ArrowUp / Ctrl+p | ⬆️ 前の候補を選択 |
| Enter | ↩️ 選択中の issue・MR を現在のタブで開く |
| Ctrl+Enter | 🆕 選択中の issue・MR を新規タブで開く |
| Esc | 🚪 パレットを閉じる |

結果は最大 20 件で、issue と MR を更新日の降順にマージして並べる。🔢
各行には種別マーカー (`#` / `!`) と iid・タイトル・state バッジ・更新日 (YYYY-MM-DD) を表示する。
全体スコープのときはプロジェクトのフルパスも併記する。🏷️
マウスクリックでも開ける。🖱️

## 🌐 対応ホスト

`@match` で以下の 2 つを対象にしている。

- ☁️ `https://gitlab.com/*`
- 🏢 `https://gitlab.firstloop-tech.com/*`

self-managed の GitLab で使いたい場合は、スクリプト冒頭のメタデータブロックに `@match` を自分で追加する。✍️

```js
// @match        https://gitlab.example.com/*
```

API はスクリプトを動かしているホスト自身 (`location.origin`) の `/api/v4` を叩くため、`@match` を足す以外の設定は要らない。🔌

## 🧠 設計メモ

### 🎯 data-testid を手がかりにする

一覧の行の取得には `a[data-testid="issuable-title-link"]` を使い、ページネーションには `button[data-testid="prevButton"]` / `button[data-testid="nextButton"]` を使う。
GitLab の class 名はユーティリティクラス主体で入れ替わりが激しいため、class には一切依存しない。🎲

`data-testid` は GitLab の E2E テスト用の属性であり、class より変更されにくいという判断でこちらに寄せている。🧪
これはあくまで判断であって、GitLab 側が後方互換を保証しているわけではない。⚠️

### 🔀 issue 一覧の新旧 UI 両対応

gitlab.com の issue 一覧は新 UI (`/-/work_items`) にリダイレクトされることがある。
実 DOM を確認した限り (2026-08-01 時点の gitlab.com)、旧 UI の issue 一覧・新 UI の issue 一覧・MR 一覧のいずれも行が `li[data-testid="issuable-container"]`、タイトルリンクが `a[data-testid="issuable-title-link"]` で共通していた。🧬
そのため一覧の種別ごとに分岐せず、単一のセレクタで扱っている。

詳細ページの判定も同様に、`/-/issues/(\d+)` と `/-/work_items/(\d+)` の両方を issue として扱う。🪪

ページネーションは、新 UI の keyset 方式 (`button[data-testid="prevButton"]` / `nextButton`) を優先し、無ければ旧 UI の offset 方式 (`a[rel="prev"]` / `a[rel="next"]`) にフォールバックする。📑
ボタンが disabled のときは端のページとみなして何もしない。

### 🔄 キー入力のたびに毎回スキャンする

一覧はキャッシュせず、キーが押されるたびに DOM を走査し直す。
GitLab はフィルタ適用や keyset ページングや Vue のルーティングで一覧を非同期に差し替えるため、キャッシュを持つと実 DOM とずれる。🔁
MutationObserver でキャッシュを保守する方法も取らず、状態を持たないことで壊れにくさを優先した。🪶

現在位置はインデックスではなく要素参照で保持する。📌
走査結果の配列に `indexOf` で現在位置を求め、見つからなければ先頭扱いにフォールバックする。
`document.activeElement` が一覧のリンクであれば、そちらを優先して現在位置とみなす。

移動先には `focus({ preventScroll: true })` で実フォーカスを与え、スクロールするかどうかは自前で判断する。🖱️
上下 80px の余白を残して画面内に収まっているときはスクロールせず、画面外か端に近いときだけ `scrollIntoView({ block: "center" })` で中央に寄せる。🪟
フォーカスリングだけでは視認しにくいため、`a[data-glv-focus]` に対するアウトラインを `<style>` で注入して併用する。🖍️

### 🔌 same-origin の REST API v4 をセッション Cookie で叩く

検索パレットと `yb` は `location.origin` の `/api/v4` を `fetch` する。
同一オリジンなのでブラウザのセッション Cookie がそのまま送られ、アクセストークンを持たせる必要がない。🍪
トークンをスクリプトや設定に保存しないので、`@grant none` のまま動く。🔓

スコープの既定はプロジェクトで、URL からプロジェクトのフルパスを求める。🗺️
`/-/` を含むパスは `/-/` より前をフルパスとみなす (サブグループの階層数を固定で仮定しない)。
`/-/` を含まないパスは `GET /api/v4/projects/<URL エンコードしたフルパス>` が 200 を返すかで検証し、結果はページ内に 1 回だけキャッシュする。
先頭セグメントが `dashboard` / `groups` / `admin` / `help` / `users` / `search` / `explore` / `api` / `projects` / `-` のいずれかなら、プロジェクト文脈なしとして全体スコープに固定する。🚧

入力は 250ms デバウンスし、実行中の `fetch` は `AbortController` で中断してから次を発行する。⏳
issue と MR は別々のリクエストなので、片方が失敗しても成功した側の結果は表示し、失敗した種別だけをエラー行で知らせる。🩹

### 🤝 GitLab ネイティブショートカットとの共存

GitLab 自身にもキーボードショートカットがある (`?` で一覧を表示できる)。⌨️
本スクリプトが使うのは `j` / `k` / `h` / `l` / `o` / `y` シーケンス / `:` だけで、それ以外のキーには触れない。
`s` / `/` / `f` / `t` / `g` シーケンス / MR 内の `]` `[` `n` `p` / Ctrl+K といった GitLab 側のキーはそのまま使える。🧩

`y` は GitLab ではファイル閲覧ページで permalink をコピーするキーとして使われている。
衝突を避けるため、`y` シーケンスは issue/MR 詳細ページでのみ有効にしている。🚦

一覧での `j` / `k` / `o` は GitLab 自身のショートカットとも重なる (`?` の一覧で確認できる)。
本スクリプトは document のキャプチャフェーズでキーを受け、処理したキーだけ `preventDefault` と `stopPropagation` を呼ぶため、こちらの挙動が優先される。🥇
一覧が無いページやページネーションの端など、処理しなかったキーは GitLab 側にそのまま渡す。🎁

パレット表示中はグローバルのハンドラを早期 return し、パレットのルート要素で `keydown` を `stopPropagation` する。🧱
GitLab はリッチテキストエディタやフィルタ入力が多いため、編集対象 (input / textarea / select / contenteditable) では常に素通しにしている。📝

## ⚠️ 既知の制約

- 🔐 全体スコープの検索 (`/api/v4/issues?scope=all` など) は認証が要る。未ログインだと 401 などで失敗するため、結果リストにエラー行を出す。握りつぶさない。
- ⏱️ 巨大なプロジェクトでは `search` 付きの MR API がタイムアウト (HTTP 408) を返すことがある。実装前の調査時 (2026-08-01) に gitlab.com の `gitlab-org/gitlab` で確認した。issue 側は成功することが多いので、その場合は issue の結果だけを表示してエラー行を 1 行添える。
- 🏗️ GitLab が `data-testid` を変更すると一覧のナビゲーションが動かなくなる。特に `issuable-title-link` と `prevButton` / `nextButton` への変更の影響が大きい。
- 🎯 検索対象は issue と MR だけ。epic・スニペット・コミット・プロジェクト検索などは対象外。
- 📐 `offsetParent === null` を不可視の判定に使っているため、`position: fixed` で配置された一覧行があれば取りこぼす。2026-08-01 時点の一覧ページでそのような配置は確認していない。
- 🌍 GitLab をサブパス (relative URL root、`https://example.com/gitlab/` のような設置) で運用しているホストは想定していない。API のベース URL とプロジェクトパスの解釈がずれる。
- 🚫 Ctrl+n / Ctrl+p はブラウザ側のショートカットと重なるため、環境によっては `preventDefault` が効かずブラウザの動作が優先される可能性がある。その場合は ArrowDown / ArrowUp を使う。
- 📋 コピーは `navigator.clipboard.writeText` を使う。HTTPS でない環境やタブが非アクティブな場合は失敗し、トーストで失敗を知らせる。
