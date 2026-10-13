# KAW'S ATS Playground Companion

Official Windows installer downloads for KAW'S ATS Playground Companion.

## Download

[Download the self-contained v1.7.2 Windows installer](https://github.com/devkawteam/kaws-ats-companion-downloads/releases/download/v1.7.2/KAW-ATS-Companion-Setup-v1.7.2.exe), or open the [latest release](https://github.com/devkawteam/kaws-ats-companion-downloads/releases/latest).

The installer includes its own Node.js runtime, a prebuilt telemetry module and the ATS telemetry plugin. Drivers do not install Node.js, Python, Visual Studio, npm or C++ Build Tools. Windows 10/11 x64 and ATS are required for game telemetry.

Close the Companion and ATS, run Setup.exe, then open KAW'S ATS Companion from the Start menu or desktop. Start ATS, accept the SDK warning, and load your truck.

Native upgrades keep settings and data. Script-installer settings and data are copied from `%LOCALAPPDATA%\KAW-ATS-Companion` when the native destination has no config. Remove the old script installer's startup shortcut to avoid starting two copies.

For CB, open Settings → CB & relay backup, confirm Main relay URL, enable Share with convoy if desired, and save. Enter your convoy code and any required relay key under Convoy → Join a convoy. The relay must be running.

## Safety

This installer is not code-signed, so Windows or a browser may show a reputation warning. Only use files from this repository and verify the published SHA-256 checksum. Do not disable antivirus protection.

KAW'S ATS Playground Companion is an independent community project and is not affiliated with SCS Software.
