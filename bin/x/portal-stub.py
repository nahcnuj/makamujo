#!/usr/bin/env python3
"""Minimal xdg-desktop-portal stub for headless Flatpak OBS (fail-fast Settings/FileChooser)."""
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()


class PortalStub(dbus.service.Object):
    def __init__(self):
        self._bus_name = dbus.service.BusName(
            "org.freedesktop.portal.Desktop",
            bus,
            allow_replacement=True,
            replace_existing=True,
            do_not_queue=True,
        )
        super().__init__(bus, "/org/freedesktop/portal/desktop")

    @dbus.service.method(
        "org.freedesktop.portal.Settings",
        in_signature="as",
        out_signature="a{sa{sv}}",
    )
    def ReadAll(self, namespaces):
        return dbus.Dictionary({}, signature="sa{sv}")

    @dbus.service.method(
        "org.freedesktop.portal.Settings",
        in_signature="ss",
        out_signature="v",
    )
    def Read(self, namespace, key):
        return dbus.String("")

    @dbus.service.method(
        "org.freedesktop.portal.Settings",
        in_signature="ss",
        out_signature="v",
    )
    def ReadOne(self, namespace, key):
        return dbus.String("")

    @dbus.service.method(
        "org.freedesktop.DBus.Properties",
        in_signature="ss",
        out_signature="v",
    )
    def Get(self, interface, prop):
        if prop == "version":
            return dbus.UInt32(1)
        return dbus.String("")

    @dbus.service.method(
        "org.freedesktop.DBus.Properties",
        in_signature="s",
        out_signature="a{sv}",
    )
    def GetAll(self, interface):
        return dbus.Dictionary({"version": dbus.UInt32(1)}, signature="sv")


if __name__ == "__main__":
    PortalStub()
    GLib.MainLoop().run()
