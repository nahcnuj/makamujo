# systemd units for makamujo

このディレクトリは makamujo の systemd サービス定義です（`main` から `legacy` 向けに移植）。

unit ファイル内の `@PREFIX@` / `@BUN_BIN@` は **`make install-systemd` が実パスに置換**して `/etc/systemd/system` へ配置します。リポジトリ内のテンプレートを直接 `cp` しないでください。

## 構成

親 unit `makamujo.service` が次の子サービスを `Wants=` で束ねます。

1. `makamujo-screen.service` — 配信サーバ（`bun start`）
2. `makamujo-browser.service` — ゲームブラウザ自動化
3. `makamujo-obs.service` — OBS（flatpak）

補助:

- `xorg10.service` / `x11vnc-10.service` — 永続 DISPLAY `:10` と VNC

ローカル開発では従来どおり `bin/start` / `bin/stop` も利用できます。

## インストール

```sh
sudo make install
# カスタム配置例
sudo make install PREFIX=/opt/makamujo BUN_BIN="$(command -v bun)"
```

`composition/` と `architecture/` もコピー対象です。

## 管理コンソール Basic auth

production（`NODE_ENV=production`）では outer TLS サーバが **IP 許可 + Basic auth** を要求します。

優先順位:

1. 環境変数 `CONSOLE_BASIC_AUTH_PASSWORD`（**本番推奨・固定**）
2. ファイル `CONSOLE_BASIC_AUTH_PASSWORD_FILE`（未設定時は `$PREFIX/var/console-basic-auth-password`）
3. 初回起動時に乱数生成して 2. のパスへ保存（再起動で同じ値を再利用）

```sh
make console-password
# または
sudo cat /opt/makamujo/var/console-basic-auth-password
```

ユーザー名は `admin` です。

## 操作

```sh
sudo systemctl start makamujo.service
sudo systemctl stop makamujo.service
sudo systemctl status makamujo.service makamujo-screen.service makamujo-browser.service makamujo-obs.service
sudo journalctl -u makamujo-screen.service -u makamujo-browser.service -u makamujo-obs.service -f
# または
sudo /opt/makamujo/bin/journal-makamujo
```

## コメント取得について（main との差分）

このツリーには orphan `main` にあった **組み込み `niconamaCommentClient` は含まれません**。  
コメントは HTTP 経由で配信プロセスへ投入する既存経路を使います。組み込みクライアントの再導入は別作業です。

## 注意

- 既定は `User=root` と `DISPLAY=:10`。別ユーザにする場合は unit を編集する。
- Bun パスは install 時の `BUN_BIN` で固定される。bun を更新したら `make install-systemd` を再実行する。
