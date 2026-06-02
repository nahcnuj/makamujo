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

### Production runtime dependencies (OpenJTalk)

In production (`NODE_ENV=production`), makamujo requires OpenJTalk voice assets and dictionary assets at startup (unless `MAKAMUJO_ALLOW_FALLBACK_TTS=1` is explicitly set).

- `open_jtalk` binary
- one of these voice files:
  - `/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice`
  - `/usr/share/hts-voice/mei/mei_normal.htsvoice`
- one of these dictionary directories:
  - `/var/lib/mecab/dic/open-jtalk`
  - `/var/lib/mecab/dic/open-jtalk/naist-jdic`
  - `/usr/share/open_jtalk_dic`
  - `/usr/share/open_jtalk_dic_utf_8`

You can override lookup paths by setting:

- `OPEN_JTALK_HTSVOICE_FILE=/absolute/path/to/file.htsvoice`
- `OPEN_JTALK_DICTIONARY_DIR=/absolute/path/to/dictionary-dir`

On Debian/Ubuntu, these packages usually provide the required assets:

```sh
sudo apt-get update
sudo apt-get install -y open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001
```

## Running as a systemd service

This repository includes a systemd unit and helper scripts under `etc/systemd/` and `bin/`. Use the top-level `Makefile` to install to `/opt/makamujo` and enable the service. After installation, you can follow logs for all makamujo processes with:

```sh
sudo /opt/makamujo/bin/journal-makamujo -f
```

More details are in [etc/systemd/README.md](etc/systemd/README.md).
