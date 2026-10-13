# KAW'S ATS Playground Companion

Official Windows installer downloads for KAW'S ATS Playground Companion.

## Download

The corrected v1.7.1 Windows script installer is available in this branch:

- [Download the CB relay fix ZIP](downloads/KAW-ATS-Companion-v1.7.1-CB-Relay-Fix-Windows-Script-Installer.zip)
- [SHA-256 checksum](downloads/KAW-ATS-Companion-v1.7.1-CB-Relay-Fix-Windows-Script-Installer.zip.sha256)
- [CB relay setup guide](downloads/CB-RELAY-SETUP.md)

This package requires Node.js 22 or newer, Python 3, Microsoft Visual Studio Build Tools with Desktop development with C++, and a compatible SCS telemetry plugin already installed in ATS. It does not bundle those prerequisites or a standalone Setup.exe.

Close the Companion, extract the entire ZIP, then run `INSTALL.bat`. Existing settings and data are preserved. Open Settings → CB & relay backup, confirm the Main relay URL, enable Share with convoy if desired, and save. Supply the convoy code and relay key under Convoy → Join a convoy, then open CB and select Check again.

The fix repairs blank main relay addresses, adds the missing main relay and sharing controls, and includes the setup guide. It preserves custom addresses and saved keys. Hosted relay availability has not been verified. Source changes: [Companion CB relay fix](https://github.com/devkawteam/kaws-ats-playground/tree/fix/companion-cb-relay-blank-settings).

## Safety

This first public build is not code-signed, so Windows or a browser may show a reputation warning. Only use files from this repository and verify the published SHA-256 checksum. Do not disable antivirus protection.

KAW'S ATS Playground Companion is an independent community project and is not affiliated with SCS Software.
