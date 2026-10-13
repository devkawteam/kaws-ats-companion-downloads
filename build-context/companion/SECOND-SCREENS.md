# Phones, tablets and second screens

Author: Kaw. Free local-network feature in the v1.7.0-beta.1 source preview.

## Connect a screen

1. Keep the Companion running on the PC. Open its dashboard at `http://127.0.0.1:4280`
   (replace 4280 if you configured a different port).
2. Open **Devices & Screens** from Setup or the Settings shortcut. Click **Enable
   network sharing**, then close and reopen the Companion once. No config editing needed.
3. Put the phone/tablet on the PC's private network. The PC can use Ethernet and the
   tablet can use Wi-Fi on the same router.
4. Select the PC's private-network address and the screen: Driving, Navigation, Truck,
   Convoy radar, Shifting, or Earnings & stats. Click **Create QR code**.
5. Scan the QR with the receiving device's camera and tap the camera's link prompt.
   It opens on the device doing the scan. A QR cannot force the browser to open or send
   a page from one tablet to a different phone automatically.
6. Name the device and tap **Connect and open screen**. Optionally allow this PC to
   change the screen. Bookmark the resulting dashboard page, rather than the pairing link.

Pairing links expire in five minutes and are single-use. The QR generator is bundled
locally with its MIT license; there is no QR service, CDN, account or subscription.
The browser remembers a session cookie, and the PC stores a hash of that session in
`data/device-hub.json`. Clearing cookies, changing the PC address, or changing browsers
may require pairing again. **Forget device** revokes that session. Network sharing
disabled in the app takes effect after restarting.

## Change a paired device's screen

Open its bookmarked dashboard in the foreground. On the device, enable **Allow PC screen
changes** in the connected-device banner. On the PC choose a remembered device's screen
and click **Send screen**. The page checks for a request every five seconds. Requests
expire after 30 seconds; they do not launch an app on a sleeping or closed device.
Each device has its own consent, browser voice settings, and map preferences.

## Share a link

**Copy link** works through the clipboard or selects the link for manual copying.
**Share…** uses the browser's native share menu if available; it depends on the browser
and secure-context rules. **Email draft** and **Text draft** open an installed handler
if the operating system has one. They do not send a message. The recipient must be on
the same reachable network while the Companion runs, and open the link before it expires.
These links are not public internet access links.

## Connection help

- Choose your home-router address when the PC also lists VPN/virtual adapters. Only
  private IPv4 addresses are suggested; this is not automatic discovery of nearby devices.
- Avoid guest Wi-Fi and router client isolation. A VPN can also prevent local access.
- On Windows, allow the Companion's port (normally TCP 4280) on the Private network in
  Windows Firewall. Linux firewall settings may need the same port. No router port
  forwarding is needed. A listed IP does not prove the tablet can reach it.
- Use a private network you trust. This preview serves LAN pages over HTTP, which does
  not encrypt network traffic. Bluetooth/proximity transfers and automatic HTTPS setup
  are not included. Remote microphone features require HTTPS; the dashboard itself
  can display over HTTP in supported browsers.
- Network devices are paired displays. Configuration changes, convoy commands,
  map installation, Ollama and the offline speech bridge stay on the Companion PC.
  Existing unauthenticated LAN browser/API access now requires pairing for supported
  display endpoints. Existing external command integrations need a separate authenticated
  integration design; they are not authorized by a tablet's display session.

## Preview validation

Automated tests cover invitation expiry/single-use, saved session hashes, permission
checks, command acknowledgement/isolation, revocation, address filtering, the HTTP
pairing cookie, and QR matrix generation. Test camera scanning and live screens on a
Windows/ATS PC plus Android/iPad/iPhone hardware before publishing an installer.

## Automatic name: kaw-companion.local

While network sharing is on, the Companion also answers the name **kaw-companion.local** on your home network (multicast DNS), so a device can open `http://kaw-companion.local:4280` instead of an IP address. In Devices & Screens pick **kaw-companion.local (automatic name)** as the PC address before creating the QR code.

- Works on iPhone/iPad, Mac and Windows. Some Android browsers do not resolve `.local` names yet; use the numeric address there.
- The Companion only answers for its own name and only with private home-network (IPv4) addresses.
- Bluetooth/proximity discovery is still not available in browsers; this is the network equivalent.

## HTTPS for the phone microphone

Phones only allow the microphone on secure (https) pages. In Devices & Screens:

1. Turn on network sharing and **Turn on HTTPS**, then close and reopen the Companion once. HTTPS listens on port 4443 (config `https.port`).
2. Scan the certificate QR code with the phone and install the **KAW Companion Local CA** certificate (iPhone: install the profile, then enable it under Settings → General → About → Certificate Trust Settings; Android: Security → Install a certificate → CA certificate). Check the SHA-256 fingerprint shown on the PC.
3. Tick **Use a secure (https) link** before creating the pairing QR code.

The CA and server certificates are created on the PC (data/https) with Node's built-in crypto (ECDSA P-256, SHA-256). The server certificate covers the PC's private addresses, `kaw-companion.local` and `localhost`, is valid for 800 days (Apple's limit is 825) and is reissued automatically when the addresses change. Remove the certificate from the phone at any time to revoke trust.
