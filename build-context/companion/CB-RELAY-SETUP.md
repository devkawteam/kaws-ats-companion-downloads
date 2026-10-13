# CB relay setup
Author: Kaw

This patch restores the shipped main relay address for blank configurations and adds Main relay URL and Share with convoy controls in Settings → CB & relay backup. Custom relay addresses and saved keys are preserved.

## Install
Close the Companion, extract this whole ZIP, and run INSTALL.bat.
The installer preserves your config.json and data. On startup, a blank relay address is repaired; sharing stays at its existing setting.

## Connect
On the PC running the Companion, open Settings → CB & relay backup.
Confirm the main relay URL, enable Share with convoy if desired, and Save.
On Convoy → Join a convoy, enter your convoy code and relay key if required.
All drivers should use the same code and relay addresses.
Return to CB and select Check again.

## Backup
Enter an existing compatible relay's full URL ending in /api/telemetry.
Leave it empty if you have no backup. This installer does not contain relay server source or provision a backup server.
The previous referenced relay-server/BACKUP-RELAY.md was not included in the original package.
A backup needs the same compatible service and authentication setup for all drivers.

## Limits
The shipped relay's current availability is unverified. A configured address does not guarantee a running service.
Discord links remain available as voice fallback.
