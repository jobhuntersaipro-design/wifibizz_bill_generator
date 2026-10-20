// Fixes to Baileys 7.0.0-rc14 for QR linking, applied after npm install. Each one
// fails the install if its line has moved, so a Baileys upgrade cannot drop it silently.
//
// 1. Notifications are acked with `authState.creds.me.id`, undefined before the phone
//    has scanned: the ack threw and the notification below was never acked.
// 2. Since mid-2026 WhatsApp sends `companion_reg_refresh` while pairing: the QR's adv
//    secret is retired, and the companion must rotate it and re-render the QR. rc14
//    ignores it, pair-success never comes and the phone says "connection lost".
//    Port of WhiskeySockets/Baileys PR 2765 (issue 2737). The phone may need to scan
//    the re-rendered QR (a second scan).
import { readFileSync, writeFileSync } from "node:fs";

const PATCHES = [
  {
    file: "Socket/messages-recv.js",
    from: "buildAckStanza(node, errorCode, authState.creds.me.id)",
    to: "buildAckStanza(node, errorCode, authState.creds.me?.id)",
  },
  {
    file: "Socket/socket.js",
    from: `        const advB64 = creds.advSecretKey;
        let qrMs = qrTimeout || 60000; // time to let a QR live`,
    to: `        // advSecretKey is read per render: companion_reg_refresh rotates it mid-flow.
        let currentRef;
        const renderQR = () => ev.emit('connection.update', { qr: buildPairingQRData(currentRef, noiseKeyB64, identityKeyB64, creds.advSecretKey, browser) });
        refreshPairingQR = () => { if (currentRef !== undefined) renderQR(); };
        let qrMs = qrTimeout || 60000; // time to let a QR live`,
  },
  {
    file: "Socket/socket.js",
    from: `            const ref = refNode.content.toString('utf-8');
            const qr = buildPairingQRData(ref, noiseKeyB64, identityKeyB64, advB64, browser);
            ev.emit('connection.update', { qr });`,
    to: `            currentRef = refNode.content.toString('utf-8');
            renderQR();`,
  },
  {
    file: "Socket/socket.js",
    from: `    // QR gen
    ws.on('CB:iq,type:set,pair-device', async (stanza) => {`,
    to: `    // Re-renders the QR on screen; set while a pairing QR flow is live.
    let refreshPairingQR;
    // The server retiring an unpaired companion's adv secret: rotate it and re-render the
    // same ref (no ref consumed, qrTimer untouched). A registered session keeps its secret.
    ws.on('CB:notification,type:companion_reg_refresh', (node) => {
        if (!getBinaryNodeChild(node, 'companion_reg_refresh') && !getBinaryNodeChild(node, 'pair-device-rotate-qr')) return;
        if (creds.me) return;
        creds.advSecretKey = randomBytes(32).toString('base64');
        ev.emit('creds.update', { advSecretKey: creds.advSecretKey });
        logger.warn({ id: node.attrs.id }, 'companion_reg_refresh: rotated adv secret, re-rendering QR');
        refreshPairingQR?.();
    });
    // QR gen
    ws.on('CB:iq,type:set,pair-device', async (stanza) => {`,
  },
];

const root = new URL("./node_modules/baileys/lib/", import.meta.url);
for (const { file, from, to } of PATCHES) {
  const path = new URL(file, root);
  const src = readFileSync(path, "utf8");
  if (src.includes(to)) continue;
  if (!src.includes(from)) throw new Error(`patch-baileys: ${file} has changed; check the Baileys upgrade`);
  writeFileSync(path, src.replace(from, to));
}
