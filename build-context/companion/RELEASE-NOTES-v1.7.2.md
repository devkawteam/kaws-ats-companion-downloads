# Companion v1.7.2 — self-contained Windows installer

Drivers no longer need to install Node.js, Python or C++ Build Tools. The native
Setup.exe includes its own Node runtime, the prebuilt telemetry module and the
ATS telemetry plugin. Start the Companion from the desktop or Start menu.

Includes the CB relay fix: blank main relay addresses are repaired, and
Settings → CB & relay backup includes Main relay URL and Share with convoy.
Saved keys, custom addresses and sharing preferences are preserved.

Native upgrades retain settings and data. When moving from the script
installer, settings and data are copied from
`%LOCALAPPDATA%\KAW-ATS-Companion` if the native installation has no config.
Close the old Companion before installation and remove its old startup
shortcut so both copies do not start together.

Windows 10/11 x64 and American Truck Simulator are required for game telemetry.
A running relay and any required relay key are still needed for online CB.
