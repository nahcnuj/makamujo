# systemd unit for makamujo

This directory contains the systemd unit file and documentation for installing `makamujo` using the included `Makefile`.

## Install (recommended via Makefile)

Use the top-level `Makefile` to install to `/opt` (default) and enable the systemd unit.

Run as root (or via `sudo`):

```sh
sudo make install
```

To uninstall:

```sh
sudo make uninstall
```

To install to a custom prefix (example):

```sh
sudo make install PREFIX=/srv/makamujo
```

Notes:
- The default install path is `/opt/makamujo`. The included unit file expects binaries under `/opt/makamujo/bin`.
- If you change the install prefix, update the installed systemd unit (`/etc/systemd/system/makamujo.service`) so `ExecStart`/`ExecStop` point to the correct paths, then run `sudo systemctl daemon-reload`.

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

