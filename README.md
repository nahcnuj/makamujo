<div align="center">
<h1>
  <ruby>馬可<rp>(</rp><rt>まか</rt><rp>)</rp></ruby>
  <ruby>無序<rp>(</rp><rt>むじょ</rt><rp>)</rp></ruby>
  (MAKA Mujo), an AI‑VTuber
</h1>

<h2>
<a href="https://live.nicovideo.jp/watch/user/14171889" target="_blank" rel="noopener">24/7 Live Streaming at NicoNico</a>
</h2>

[![Stream Health Check](https://github.com/nahcnuj/makamujo/actions/workflows/stream-health-check.yml/badge.svg?event=schedule)](https://github.com/nahcnuj/makamujo/actions/workflows/stream-health-check.yml)

[![CI](https://github.com/nahcnuj/makamujo/actions/workflows/ci.yml/badge.svg)](https://github.com/nahcnuj/makamujo/actions/workflows/ci.yml)
[![CD](https://github.com/nahcnuj/makamujo/actions/workflows/cd.yml/badge.svg)](https://github.com/nahcnuj/makamujo/actions/workflows/cd.yml)  
[![CodeQL](https://github.com/nahcnuj/makamujo/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/nahcnuj/makamujo/actions/workflows/github-code-scanning/codeql)
[![Copilot code review](https://github.com/nahcnuj/makamujo/actions/workflows/copilot-pull-request-reviewer/copilot-pull-request-reviewer/badge.svg)](https://github.com/nahcnuj/makamujo/actions/workflows/copilot-pull-request-reviewer/copilot-pull-request-reviewer)
[![GitHub Advanced Security](https://github.com/nahcnuj/makamujo/actions/workflows/agents/github-advanced-security/badge.svg)](https://github.com/nahcnuj/makamujo/actions/workflows/agents/github-advanced-security)
</div>

- AI speech and Markov‑chain talk model
- Bun server, API routes, and persistence
- Stream state management and comment parsing
- Game‑playing solvers (currently vigilant-fiesta / 落ち物パズル・蘇; cookie‑clicker still available) and agent logic
- Front‑end UI that stitches together shared components and app‑specific panels

## Dependencies

- **[automated-gameplay-transmitter](https://github.com/nahcnuj/automated-gameplay-transmitter)**: browser automation helpers, IPC utilities, and shared React components/contexts used by the UI.

## Docker (VPS reproduction)

Reproduce the production VPS (Debian 13) in Docker for Visual Regression Testing.
The container is provisioned with Ansible exactly like production:

```sh
docker build -t makamujo-vps -f Dockerfile .
docker run --rm -p 7777:7777 makamujo-vps
```

The image installs Playwright Chromium and its system dependencies, starts Xvfb
on `DISPLAY=:99`, and configures PipeWire/Pulse. Chromium is launched with
root-safe flags (`--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`,
`--disable-software-rasterizer`).
