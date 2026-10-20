# systemd units for makamujo

このディレクトリは makamujo の systemd サービス定義です（`main` から `legacy` 向けに移植）。

## 構成

親 unit `makamujo.service` が次の子サービスを `Wants=` で束ねます。

1. `makamujo-screen.service` — 配信サーバ（`bun start`）
2. `makamujo-browser.service` — ゲームブラウザ自動化
3. `makamujo-obs.service` — OBS（flatpak）

補助:

- `xorg10.service` / `x11vnc-10.service` — リポジトリ同梱の永続 DISPLAY `:10` と VNC。
  本番の `:10` は ansible が導入する `makamujo-xvfb.service` で、`makamujo.service`
  はそちらを `Wants=` する。回復ラング（`composition/broadcastFreezeWatchdog.ts`）も
  `makamujo-xvfb.service` を再起動する。
- `makamujo-xvfb.service` — 本番の `:10` の定義（正本は `0_desktop.yml` が
  `/etc/systemd/system/` に置く内容。ここは `tests/makamujo-pipewire.test.ts` が
  同期を検証するための写し）。Xvfb は `Restart=always` +
  `StartLimitIntervalSec=0` で自己回復する。Xorg `:10` が落ちると XSHM キャプチャ・
  ゲームブラウザ・x11vnc が描画先を失って配信画面が固まるため、正常終了でも
  再起動され、レート制限で永久に放棄されないことが要る（2026-10-20/21 の異常検知）。

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
