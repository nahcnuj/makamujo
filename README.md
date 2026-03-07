# 馬可無序 (makamujo)
MAKA Mujo: an AI‑VTuber

`makamujo` is the application layer for the AI‑VTuber project. It handles:

- AI speech and Markov‑chain talk model
- Bun server, API routes, and persistence
- Stream state management and comment parsing
- Game‑playing solvers (currently cookie‑clicker) and agent logic
- Front‑end UI that stitches together shared components and app‑specific panels

This repository consumes **[automated-gameplay-transmitter](../automated-gameplay-transmitter)** as a local dependency (see `package.json`).
The shared library provides browser automation helpers, IPC utilities, and a set of common React components/contexts used by the UI.

Responsibilities are intentionally separated:

- `automated-gameplay-transmitter` contains the generic automation engine and reusable UI.
- `makamujo` contains AI‑specific behavior, game solvers, and the concrete TTS/browser implementation.

See the library README for detailed documentation of shared modules.
