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
  `makamujo-xvfb.service` を再起動し、最深ラングではアプリ三連
  （screen / browser / obs）もまとめて再起動する。
- `makamujo-screen.service` は `makamujo-xvfb.service` を `Wants=` で束ねる
  （`Requires=` にしない）。systemd は明示的な restart を `Requires=` の下流へ
  伝播するので、`Requires=` のままだと xvfb の再起動が screen（watchdog の
  実体）の再起動に変わり、回復ラングの残りの unit 再起動が実行されない
  （`architecture/README.md` の「配信画面の停止回復」参照）。

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
