// Baileys 7.0.0-rc14 acks every notification with `authState.creds.me.id`, which is
// undefined before the phone has scanned. WhatsApp sends `companion_reg_refresh` while
// the QR is up; the ack throws, nothing is acked, and the phone's scan fails with
// "connection lost". `me` is only used for message acks, so pass it optionally.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("./node_modules/baileys/lib/Socket/messages-recv.js", import.meta.url);
const src = readFileSync(file, "utf8");
const from = "buildAckStanza(node, errorCode, authState.creds.me.id)";
const to = "buildAckStanza(node, errorCode, authState.creds.me?.id)";
if (src.includes(to)) process.exit(0);
if (!src.includes(from)) throw new Error("patch-baileys: ack line not found; check the Baileys upgrade");
writeFileSync(file, src.replace(from, to));
