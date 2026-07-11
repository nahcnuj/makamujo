# Makefile: install makamujo to /opt and manage systemd units (ported from main, adapted for legacy layout)

PREFIX ?= /opt/makamujo
UNIT_DIR ?= /etc/systemd/system
# Prefer PATH bun; fall back to common install location.
BUN_BIN ?= $(shell command -v bun 2>/dev/null || echo /root/.bun/bin/bun)
INSTALL_BIN = bin/x bin/xorg10 bin/x11vnc-10 bin/obs-studio bin/journal-makamujo bin/start bin/stop
INSTALL_DATA = package.json bunfig.toml tsconfig.json index.ts lib routes src console composition architecture obs-studio
SERVICE = makamujo.service
UNIT_TEMPLATES = makamujo.service makamujo-screen.service makamujo-browser.service makamujo-obs.service xorg10.service x11vnc-10.service

.PHONY: all install install-app install-systemd uninstall uninstall-app uninstall-systemd help console-password

all: install

install: install-app install-systemd
	@echo "Installed to $(PREFIX) (bun=$(BUN_BIN))"

install-app:
	@echo "Installing application files to $(PREFIX)"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@mkdir -p "$(PREFIX)/bin" "$(PREFIX)/var/log/console"
	@cp -a $(INSTALL_BIN) "$(PREFIX)/bin/"
	@cp -a $(INSTALL_DATA) "$(PREFIX)/"
	@if [ -e bun.lock ]; then \
		cp -a bun.lock "$(PREFIX)/"; \
	elif [ -e bun.lockb ]; then \
		cp -a bun.lockb "$(PREFIX)/"; \
	fi
	@echo "Installing Bun dependencies in $(PREFIX)"
	@cd "$(PREFIX)" && if command -v bun >/dev/null 2>&1; then bun install --production; else echo "Warning: bun not found in PATH, skipping dependency install"; fi
	@chmod +x "$(PREFIX)/bin/"* "$(PREFIX)/bin/x/"* 2>/dev/null || chmod +x "$(PREFIX)/bin/"*

install-systemd:
	@echo "Installing systemd units to $(UNIT_DIR) (PREFIX=$(PREFIX) BUN_BIN=$(BUN_BIN))"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@pkill obs || :
	@pkill bun || :
	@pkill chromium || :
	@systemctl stop "$(SERVICE)" 2>/dev/null || true
	@for unit in $(UNIT_TEMPLATES); do \
		sed \
			-e 's|@PREFIX@|$(PREFIX)|g' \
			-e 's|@BUN_BIN@|$(BUN_BIN)|g' \
			"etc/systemd/$$unit" > "$(UNIT_DIR)/$$unit"; \
	done
	@systemctl daemon-reload
	@systemctl reset-failed "$(SERVICE)" 2>/dev/null || true
	@systemctl enable --now "$(SERVICE)"
	@echo ""
	@echo "================================================================="
	@echo "管理コンソールパスワード:"
	@echo "  Prefer: CONSOLE_BASIC_AUTH_PASSWORD env, or file $(PREFIX)/var/console-basic-auth-password"
	@bash -lc 'if [ -f "$(PREFIX)/var/console-basic-auth-password" ]; then cat "$(PREFIX)/var/console-basic-auth-password"; else journalctl -u makamujo-screen.service -u makamujo.service -n 40 --no-pager | grep "Console Basic auth password" | tail -n 1 | sed -E "s/^.*Console Basic auth password: //"; fi'
	@echo "================================================================="

uninstall: uninstall-systemd uninstall-app
	@echo "Uninstalled"

uninstall-systemd:
	@echo "Removing systemd units"
	-@systemctl disable --now "$(SERVICE)" 2>/dev/null || true
	-@for unit in $(UNIT_TEMPLATES); do rm -f "$(UNIT_DIR)/$$unit"; done
	@systemctl daemon-reload

uninstall-app:
	@echo "Removing installed files from $(PREFIX)"
	-@rm -rf "$(PREFIX)" || true

help:
	@echo "Usage:"
	@echo "  sudo make install                    # install to $(PREFIX) and enable service"
	@echo "  sudo make install PREFIX=/opt/foo BUN_BIN=/usr/local/bin/bun"
	@echo "  sudo make uninstall                  # remove service and installed files"
	@echo "  make console-password                # print Basic auth password (file or journal)"

console-password:
	@if [ -f "$(PREFIX)/var/console-basic-auth-password" ]; then \
		cat "$(PREFIX)/var/console-basic-auth-password"; \
	elif [ -f var/console-basic-auth-password ]; then \
		cat var/console-basic-auth-password; \
	else \
		bash -lc 'journalctl -u makamujo-screen.service -u makamujo.service -n 40 --no-pager | grep "Console Basic auth password" | tail -n 1 | sed -E "s/^.*Console Basic auth password: //"'; \
	fi
