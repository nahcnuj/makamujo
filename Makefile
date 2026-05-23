# Makefile: install makamujo to /opt and manage systemd unit

PREFIX ?= /opt/makamujo
UNIT_DIR ?= /etc/systemd/system
INSTALL_BIN = bin/start-with-xauth.sh bin/start bin/stop bin/x
INSTALL_DATA = package.json bunfig.toml tsconfig.json bootstrap.ts index.ts lib routes src console obs-studio
SERVICE = makamujo.service
UNIT_SRC = etc/systemd/$(SERVICE)

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
	@chown -R root:root "$(PREFIX)"
	@chmod +x "$(PREFIX)/bin/"*

install-systemd:
	@echo "Installing systemd unit to $(UNIT_DIR)"
	@if [ "$$(id -u)" -ne 0 ]; then echo "This target requires root: run 'sudo make install'"; exit 1; fi
	@cp "$(UNIT_SRC)" "$(UNIT_DIR)/$(SERVICE)"
	@systemctl daemon-reload
	@systemctl enable --now "$(SERVICE)"

uninstall: uninstall-systemd uninstall-app
	@echo "Uninstalled"

uninstall-systemd:
	@echo "Removing systemd unit"
	-@systemctl disable --now "$(SERVICE)" 2>/dev/null || true
	-@rm -f "$(UNIT_DIR)/$(SERVICE)" || true
	@systemctl daemon-reload

uninstall-app:
	@echo "Removing installed files from $(PREFIX)"
	-@rm -rf "$(PREFIX)" || true

help:
	@echo "Usage:"
	@echo "  sudo make install          # install to $(PREFIX) and enable service"
	@echo "  sudo make uninstall        # remove service and installed files"
	@echo "  make install PREFIX=/some/path  # install to custom prefix (run as root)"
