# 馬可無序 (makamujo)
MAKA Mujo: an AI‑VTuber

`makamujo` is the application layer for the AI‑VTuber project. It handles:

- AI speech and Markov‑chain talk model
- Bun server, API routes, and persistence
- Stream state management and comment parsing
- Game‑playing solvers (currently cookie‑clicker) and agent logic
- Front‑end UI that stitches together shared components and app‑specific panels

## Dependencies

- **[automated-gameplay-transmitter](https://github.com/nahcnuj/automated-gameplay-transmitter)**: browser automation helpers, IPC utilities, and shared React components/contexts used by the UI.

## Running as a systemd service

This repository includes a systemd unit and helper scripts under `etc/systemd/` and `bin/`. Use the top-level `Makefile` to install to `/opt/makamujo` and enable the service. After installation, you can follow logs for all makamujo processes with:

```sh
sudo /opt/makamujo/bin/journal-makamujo -f
```

More details are in [etc/systemd/README.md](etc/systemd/README.md).
