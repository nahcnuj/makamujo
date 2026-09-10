# Makefile: install makamujo to /opt and manage systemd units (ported from main, adapted for legacy layout)

PREFIX ?= /opt/makamujo
UNIT_DIR ?= /etc/systemd/system
INSTALL_BIN = bin/x bin/xorg10 bin/x11vnc-10 bin/obs-studio bin/journal-makamujo bin/start bin/stop
INSTALL_DATA = package.json bunfig.toml tsconfig.json index.ts lib routes src console composition architecture obs-studio
SERVICE = makamujo.service

.PHONY: all install install-app install-systemd uninstall uninstall-app uninstall-systemd help console-password

all: install

install: install-app install-systemd
	@echo "Installed to $(PREFIX)"

install-app:
	@echo "Installing application files to $(PREFIX)"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@mkdir -p "$(PREFIX)/bin"
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
	@echo "Installing systemd units to $(UNIT_DIR)"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@pkill obs || :
	@pkill bun || :
	@pkill chromium || :
	@systemctl stop "$(SERVICE)" 2>/dev/null || true
	@cp -a etc/systemd/*.service "$(UNIT_DIR)/"
	@systemctl daemon-reload
	@systemctl reset-failed "$(SERVICE)" 2>/dev/null || true
	@systemctl enable --now "$(SERVICE)"
	@echo ""
	@echo "================================================================="
	@echo "管理コンソールパスワード:"
	@bash -lc 'journalctl -u makamujo-screen.service -u makamujo.service -n 40 --no-pager | grep "Console Basic auth password" | tail -n 1 | sed -E "s/^.*Console Basic auth password: //"'
	@echo "================================================================="

uninstall: uninstall-systemd uninstall-app
	@echo "Uninstalled"

uninstall-systemd:
	@echo "Removing systemd units"
	-@systemctl disable --now "$(SERVICE)" 2>/dev/null || true
	-@for unit in etc/systemd/*.service; do rm -f "$(UNIT_DIR)/$$(basename "$$unit")"; done
	@systemctl daemon-reload

uninstall-app:
	@echo "Removing installed files from $(PREFIX)"
	-@rm -rf "$(PREFIX)" || true

help:
	@echo "Usage:"
	@echo "  sudo make install          # install to $(PREFIX) and enable service"
	@echo "  sudo make uninstall        # remove service and installed files"
	@echo "  make install PREFIX=/some/path  # install to custom prefix (run as root)"
	@echo "  make console-password      # print last generated console Basic auth password"

console-password:
	@bash -lc 'journalctl -u makamujo-screen.service -u makamujo.service -n 40 --no-pager | grep "Console Basic auth password" | tail -n 1 | sed -E "s/^.*Console Basic auth password: //"'
