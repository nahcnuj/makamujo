# systemd units for makamujo

このディレクトリは makamujo の systemd サービス定義です（`main` から `legacy` 向けに移植）。

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
```

`/opt/makamujo` にアプリを配置し、unit を有効化します。`composition/` と `architecture/` もコピー対象です。

## 操作

```sh
sudo systemctl start makamujo.service
sudo systemctl stop makamujo.service
sudo systemctl status makamujo.service makamujo-screen.service makamujo-browser.service makamujo-obs.service
sudo journalctl -u makamujo-screen.service -u makamujo-browser.service -u makamujo-obs.service -f
# または
sudo /opt/makamujo/bin/journal-makamujo
```

管理コンソール Basic auth パスワード（自動生成時）:

```sh
make console-password
```

## 注意

- 既定は `User=root` と `DISPLAY=:10`。別ユーザにする場合は unit を編集する。
- `WorkingDirectory` / `ExecStart` の `/opt/makamujo` は `PREFIX` 変更時に合わせて直す。
