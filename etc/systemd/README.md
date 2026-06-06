# systemd units for makamujo

This directory contains systemd service files that manage the makamujo application lifecycle.

## Architecture

The makamujo service is structured as a parent unit (`makamujo.service`) that coordinates three child services:

- `makamujo-screen.service`: Starts the screen/server component
- `makamujo-browser.service`: Starts the browser automation (depends on screen)
- `makamujo-obs.service`: Starts OBS (depends on browser)

The parent service uses systemd's `After=` and `Wants=` directives to ensure the correct startup order:
1. screen → 2. browser → 3. obs

## Install (system-wide)

Use the top-level make target to install all services and dependencies:

```sh
sudo make install
```

This copies all `etc/systemd/*.service` units to `/etc/systemd/system/`, installs Bun dependencies under `/opt/makamujo`, and enables `makamujo.service`.

## Manual installation

If you prefer manual installation:

```sh
sudo cp /workspaces/makamujo/etc/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now makamujo.service
```

## Managing the service

Start/stop/restart the entire application stack:

```sh
# Start all services (screen → browser → obs)
sudo systemctl start makamujo.service

# Stop all services (obs → browser → screen, via PartOf=)
sudo systemctl stop makamujo.service

# Restart
sudo systemctl restart makamujo.service

# Check status of all units
sudo systemctl status makamujo.service makamujo-screen.service makamujo-browser.service makamujo-obs.service
```

## Viewing logs

View logs for all makamujo components:

```sh
sudo journalctl -u makamujo.service -u makamujo-screen.service -u makamujo-browser.service -u makamujo-obs.service -f
```

Or use the convenience script (after `make install`):

```sh
sudo /opt/makamujo/bin/journal-makamujo -f
```

## Notes

- The services are configured to start after `graphical.target`, so they will wait for the graphical session to be ready.
- All services run as `root` by default. To run as a different user, edit the service files and adjust `User=`, `Environment=DISPLAY`, and `Environment=XAUTHORITY` accordingly.
- The persistent Xorg display is configured as `:10` to match `xorg10.service` and `x11vnc-10.service`.
- Adjust `WorkingDirectory` and `ExecStart` paths in the service files if you install the application to a different location.

