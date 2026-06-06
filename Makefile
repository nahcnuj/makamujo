# Makefile: install makamujo to /opt and manage systemd unit

PREFIX ?= /opt/makamujo
UNIT_DIR ?= /etc/systemd/system
INSTALL_BIN = bin/x bin/xorg10 bin/x11vnc-10 bin/obs-studio
INSTALL_DATA = package.json bunfig.toml tsconfig.json bootstrap.ts index.ts lib routes src console obs-studio
SERVICE = makamujo.service
UNIT_FILES = $(shell ls etc/systemd/*.service 2>/dev/null)

.PHONY: all install install-app install-systemd uninstall uninstall-app uninstall-systemd help

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
	@chown -R root:root "$(PREFIX)"
	@chmod +x "$(PREFIX)/bin/"*

install-systemd:
	@echo "Installing systemd units to $(UNIT_DIR)"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@cp -a etc/systemd/*.service "$(UNIT_DIR)/"
	@systemctl daemon-reload
	@systemctl enable --now "$(SERVICE)"
	@echo ""
	@echo "================================================================="
	@echo "管理コンソールパスワード:"
	@bash -lc 'journalctl -u makamujo.service -n 20 --no-pager | grep "Console Basic auth password" | tail -n 1 | sed -E "s/^.*Console Basic auth password: //"'
	@echo ""
	@echo "通常は restart で再起動されるはずです。"
	@echo "もしサービスが failed のまま残る場合は次のコマンドで状態をリセットしてください:"
	@echo "  sudo systemctl stop makamujo.service"
	@echo "  sudo systemctl reset-failed makamujo.service makamujo-obs.service makamujo-browser.service makamujo-screen.service"
	@echo "  sudo systemctl daemon-reload"
	@echo "  sudo systemctl start makamujo.service"
	@echo "  sudo systemctl status makamujo.service makamujo-obs.service makamujo-browser.service makamujo-screen.service --no-pager -l"
	@echo "  sudo journalctl -u makamujo.service -u makamujo-obs.service -u makamujo-browser.service -u makamujo-screen.service --since '5 minutes ago'"
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
