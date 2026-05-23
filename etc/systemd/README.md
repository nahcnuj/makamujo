# systemd unit for makamujo

This directory contains a systemd service file to run the application using `bin/start` and `bin/stop`.

## Install (system-wide)

1. Copy the service file to the systemd system directory:

```sh
sudo cp /workspaces/makamujo/etc/systemd/makamujo.service /etc/systemd/system/makamujo.service
sudo cp /workspaces/makamujo/etc/systemd/xorg10.service /etc/systemd/system/xorg10.service
sudo cp /workspaces/makamujo/etc/systemd/x11vnc-10.service /etc/systemd/system/x11vnc-10.service
```

2. Reload systemd and enable/start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now makamujo.service
```

If you want the persistent Xorg/VNC services installed by `make install`, use the top-level make target instead:

```sh
sudo make install
```

The `make install` target copies all `etc/systemd/*.service` units to `/etc/systemd/system/` and enables `makamujo.service`.

`makamujo.service` now also controls `xorg10.service` and `x11vnc-10.service` when those units are installed. Restarting or stopping `makamujo.service` will propagate to the persistent display services.

If you want to enable the persistent display services as standalone units in addition to `makamujo.service`:

```sh
sudo systemctl enable --now xorg10.service x11vnc-10.service
```

3. Stop the service:

```sh
sudo systemctl stop makamujo.service
```

3. Stop the service:

```sh
sudo systemctl stop makamujo.service
```

4. View logs (journalctl):

```sh
sudo journalctl -u makamujo.service -f
```

## Notes

- `bin/start` requires an X Window session. The unit is configured to start after `graphical.target` so it will wait for the graphical session.
- If `bin/start` must run as a non-root user and access the X display, edit the service and add `User=yourusername` and suitable `Environment=` settings (for example `DISPLAY` and `XAUTHORITY`).
- Adjust `WorkingDirectory` and `ExecStart` paths if you install the application to a different location.

## XAUTHORITY 自動検出ラッパー

このリポジトリには `bin/start-with-xauth.sh` というラッパースクリプトを同梱しています。サービスはこのラッパーを使って起動するようになっており、以下の順で `DISPLAY` / `XAUTHORITY` を自動検出します:

- `loginctl` でアクティブなグラフィカルセッションを調べ、該当ユーザーの `~/.Xauthority` や `/run/user/<UID>/gdm/Xauthority` を探す
- X サーバ / セッションプロセスの `/proc/<pid>/environ` やコマンドラインに `XAUTHORITY` / `-auth` があればそれを使う
- `/home/*/.Xauthority` や `/root/.Xauthority` の中で最終更新日時が新しいものを候補にする
- 最後の手段として `xhost` を使って `root` の接続許可を試みる（環境によって動かない場合があります）

使い方（インストール後）:

```sh
# ラッパーを実行可能にしてからサービスを有効化/再読み込みしてください
sudo chmod +x /workspaces/makamujo/bin/start-with-xauth.sh
sudo cp /workspaces/makamujo/etc/systemd/makamujo.service /etc/systemd/system/makamujo.service
sudo systemctl daemon-reload
sudo systemctl enable --now makamujo.service
sudo journalctl -u makamujo.service -f
```

もし自動検出で見つからない場合は、ユニットに明示的に `Environment=XAUTHORITY=/home/<user>/.Xauthority` を設定してください。Wayland 環境では XAUTHORITY が無意味な場合がある点にも注意してください。

