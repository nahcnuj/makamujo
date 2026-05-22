# systemd unit for makamujo

This directory contains a systemd service file to run the application using `bin/start` and `bin/stop`.

## Install (system-wide)

Recommended (portable): install to `/opt`

1. Copy application files to `/opt` and install the unit:

```sh
sudo mkdir -p /opt/makamujo/bin
sudo cp -a ./bin/start-with-xauth.sh ./bin/start ./bin/stop /opt/makamujo/bin/
sudo chown -R root:root /opt/makamujo
sudo chmod +x /opt/makamujo/bin/*.sh /opt/makamujo/bin/start /opt/makamujo/bin/stop
sudo cp ./etc/systemd/makamujo.service /etc/systemd/system/makamujo.service
```

2. Reload systemd and enable/start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now makamujo.service
```

3. Stop the service:

```sh
sudo systemctl stop makamujo.service
```

4. View logs (journalctl):

```sh
sudo journalctl -u makamujo.service -f
```

Alternative (quick): leave files in the repository

If you already copied the unit from the repo and prefer to keep files in-place under the repository path, update the installed unit to point at `./workspaces/makamujo` before reloading:

```sh
sudo sed -i 's|ExecStart=.*|ExecStart=/workspaces/makamujo/bin/start-with-xauth.sh|' /etc/systemd/system/makamujo.service
sudo sed -i 's|ExecStop=.*|ExecStop=/workspaces/makamujo/bin/stop|' /etc/systemd/system/makamujo.service
sudo systemctl daemon-reload
sudo systemctl restart makamujo.service
sudo journalctl -u makamujo.service -f
```

Note: the version of `makamujo.service` included in this repository has `ExecStart`/`ExecStop` pointing at `/opt/makamujo` by default. If you install to a different path, edit the unit file accordingly before copying it to `/etc/systemd/system/`.

## Makefile install

This repository includes a top-level `Makefile` that automates the `/opt` installation and systemd enable steps.

Usage (run as root or via sudo):

```sh
sudo make install           # installs files to /opt/makamujo and enables the service
sudo make uninstall         # disables the service and removes installed files

# To install to a custom prefix:
sudo make install PREFIX=/srv/makamujo
```

Notes:
- `make install` will copy `bin/*` to `$(PREFIX)/bin` (default `/opt/makamujo/bin`) and copy the unit file to `/etc/systemd/system/makamujo.service` then reload and enable the service.
- If you prefer to keep files in the repository path, see the "Alternative (quick)" section above.

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

