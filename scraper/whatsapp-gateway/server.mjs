// BizzFlow WhatsApp gateway: one WhatsApp number linked as a device (QR scan),
// driven by Baileys. BizzFlow talks to it over HTTP; it posts incoming messages
// and delivery receipts to BizzFlow's webhook in the Cloud API shape.
//
// Unofficial: WhatsApp Web's protocol, not Meta's API. The number can be banned.
//
// Env:
//   WHATSAPP_GATEWAY_TOKEN   bearer token BizzFlow sends (required)
//   WHATSAPP_WEBHOOK_URL     https://bizzflow.top/api/whatsapp/webhook
//   WHATSAPP_WEBHOOK_SECRET  sent as X-Webhook-Secret
//   WA_DATA_DIR              auth state + media (default /data)
//   WA_PROXY_URL             optional outbound proxy (local testing only)
//   WHATSAPP_HISTORY_DAYS    history imported on a fresh link (default 14)

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestWaWebVersion, useMultiFileAuthState } from "baileys";
import QRCode from "qrcode";
import pino from "pino";
import { MEDIA_MIME, contactEntry, customerWaId, envelope, historyBatches, phoneOf, toCloudItem, toStatus } from "./convert.mjs";

const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.WA_DATA_DIR || "/data";
const AUTH_DIR = `${DATA}/auth`;
const MEDIA_DIR = `${DATA}/media`;
const TOKEN = (process.env.WHATSAPP_GATEWAY_TOKEN || "").trim();
const HOOK_URL = (process.env.WHATSAPP_WEBHOOK_URL || "").trim();
const HOOK_SECRET = (process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const HISTORY_DAYS = Number(process.env.WHATSAPP_HISTORY_DAYS || 14);

const recentErrors = [];
const logger = pino({
  level: process.env.LOG_LEVEL || "warn",
  hooks: {
    // Keep the last few error messages (text only, no payload) for /health.
    logMethod(args, method, level) {
      if (level >= 50) {
        const msg = args.find((a) => typeof a === "string") ?? args[0]?.err?.message ?? args[0]?.message ?? "error";
        recentErrors.push(`${new Date().toISOString()} ${String(msg).slice(0, 160)}`);
        if (recentErrors.length > 5) recentErrors.shift();
      }
      return method.apply(this, args);
    },
  },
});
const agent = process.env.WA_PROXY_URL
  ? new (await import("https-proxy-agent")).HttpsProxyAgent(process.env.WA_PROXY_URL)
  : undefined;

/** What BizzFlow's admin tab shows. */
const state = { status: "starting", qr: null, me: null, error: null };
// Counts only (no ids, no text): served on the public /health so the import can be checked remotely.
const stats = {
  webhook: { configured: Boolean((process.env.WHATSAPP_WEBHOOK_URL || "").trim()), ok: 0, failed: 0, lastStatus: null },
  history: { sets: 0, received: 0, inWindow: 0, kept: 0, unmappedLids: 0, lastAt: null },
};
let sock = null;
let generation = 0;
/** Ids this gateway sent: BizzFlow stores those itself, so their echo is skipped. */
const sentIds = new Set();

function remember(id) {
  sentIds.add(id);
  // ponytail: bounded Set, oldest dropped; ids only matter for the seconds the echo takes.
  if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
}

async function postWebhook(body) {
  if (!HOOK_URL) return;
  const payload = JSON.stringify(body);
  // ponytail: 3 tries then give up; the message is still on the phone. A queue if this loses messages.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(HOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": HOOK_SECRET },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      stats.webhook.lastStatus = res.status;
      if (res.ok) {
        stats.webhook.ok += 1;
        return;
      }
      logger.warn({ status: res.status }, "webhook refused");
      if (res.status === 401 || res.status === 403) {
        stats.webhook.failed += 1;
        return;
      }
    } catch (e) {
      stats.webhook.lastStatus = "unreachable";
      logger.warn({ err: e?.message }, "webhook unreachable");
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  stats.webhook.failed += 1;
}

async function saveMedia(msg, field, id) {
  const media = msg.message?.[field] ?? null;
  const mime = (media?.mimetype || "").split(";")[0].trim().toLowerCase();
  const ext = MEDIA_MIME[mime];
  if (!ext || Number(media?.fileLength ?? 0) > MAX_MEDIA_BYTES) return;
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    await writeFile(`${MEDIA_DIR}/${id}.${ext}`, buffer);
  } catch (e) {
    logger.warn({ id, err: e?.message }, "media download failed");
  }
}

const CLASSIFY_DELAY_MS = Number(process.env.WHATSAPP_CLASSIFY_DELAY_S || 180) * 1000;
const classifyTimers = new Map();

/** Each customer message restarts the chat's quiet timer; when it runs out, BizzFlow sorts the chat once. */
// ponytail: in-memory timers, a restart drops pending ones (the next message re-arms them).
function scheduleClassify(waId) {
  clearTimeout(classifyTimers.get(waId));
  classifyTimers.set(waId, setTimeout(() => {
    classifyTimers.delete(waId);
    void postWebhook({ object: "bizzflow", classify: waId });
  }, CLASSIFY_DELAY_MS));
}

async function onMessages({ messages }) {
  const me = state.me;
  for (const msg of messages ?? []) {
    const waId = customerWaId(msg.key);
    if (!waId || !me) continue;
    if (msg.key.fromMe && sentIds.has(msg.key.id)) continue;
    const converted = toCloudItem(msg, waId, me);
    if (!converted) continue;
    if (converted.media && /^[A-Za-z0-9]{1,64}$/.test(msg.key.id)) {
      // Unwrapped copy so downloadMediaMessage finds the media node.
      const inner = msg.message?.ephemeralMessage?.message ?? msg.message?.documentWithCaptionMessage?.message ?? msg.message;
      await saveMedia({ ...msg, message: inner }, converted.media, msg.key.id);
    }
    const body = msg.key.fromMe
      ? envelope("smb_message_echoes", "message_echoes", [converted.item])
      : envelope("messages", "messages", [converted.item], { contacts: contactEntry(waId, msg.pushName) });
    await postWebhook(body);
    if (!msg.key.fromMe) scheduleClassify(waId);
  }
}

/** History sync, sent by the phone after a fresh QR link. Only the last HISTORY_DAYS reach BizzFlow. */
async function onHistory(set) {
  const since = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86400;
  // History can land before connection "open" sets state.me.
  const me = state.me ?? phoneOf(sock?.user?.id);
  // Most chats are keyed by an opaque @lid; resolve the ones the batch did not map.
  const mapped = new Set((set.lidPnMappings ?? []).map((m) => m.lid));
  const missing = [...new Set((set.messages ?? []).map((m) => m.key?.remoteJid).filter((j) => j?.endsWith("@lid") && !mapped.has(j)))];
  const found = missing.length ? await sock?.signalRepository?.lidMapping?.getPNsForLIDs(missing).catch(() => null) : null;
  const lidPnMappings = [...(set.lidPnMappings ?? []), ...(found ?? []).filter(Boolean)];
  const bodies = historyBatches({ ...set, lidPnMappings }, me, since);
  for (const body of bodies) await postWebhook(body);
  const inWindow = (set.messages ?? []).filter((m) => Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0) >= since).length;
  const kept = bodies.reduce((n, b) => n + b.entry[0].changes[0].value.messages.length + b.entry[0].changes[0].value.message_echoes.length, 0);
  const h = stats.history;
  Object.assign(h, {
    sets: h.sets + 1,
    received: h.received + (set.messages?.length ?? 0),
    inWindow: h.inWindow + inWindow,
    kept: h.kept + kept,
    unmappedLids: h.unmappedLids + missing.length - (found?.length ?? 0),
    lastAt: new Date().toISOString(),
  });
  logger.warn(
    { received: set.messages?.length ?? 0, inWindow, kept, chats: set.chats?.length ?? 0, unmappedLids: missing.length - (found?.length ?? 0), me: Boolean(me), syncType: set.syncType, progress: set.progress, hook: Boolean(HOOK_URL) },
    "history batch",
  );
}

async function onUpdates(updates) {
  const statuses = [];
  for (const { key, update } of updates ?? []) {
    const waId = customerWaId(key);
    const status = waId ? toStatus(key, update, waId) : null;
    if (status) statuses.push(status);
  }
  if (statuses.length) await postWebhook(envelope("statuses", "statuses", statuses));
}

async function start() {
  const mine = ++generation;
  await mkdir(MEDIA_DIR, { recursive: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  // Baileys ships a fixed WhatsApp Web version that goes stale; the phone then refuses
  // the scan with "check your connection". Ask web.whatsapp.com for the current one
  // (falls back to the bundled version if that fetch fails).
  const { version, isLatest } = await fetchLatestWaWebVersion();
  logger.warn({ version: version.join("."), isLatest }, "whatsapp web version");
  const s = makeWASocket({
    version,
    auth,
    logger,
    agent,
    fetchAgent: agent,
    // Not Browsers.macOS("Desktop"): with syncFullHistory WhatsApp now terminates
    // that pairing before a QR is issued (2026-10-20). As a non-Desktop device the
    // phone sends its recent history (months), and onHistory keeps HISTORY_DAYS.
    browser: Browsers.ubuntu("BizzFlow"),
    markOnlineOnConnect: false,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
  });
  sock = s;
  s.ev.on("creds.update", saveCreds);
  s.ev.on("messages.upsert", (e) => void onMessages(e).catch((err) => logger.error(err)));
  s.ev.on("messages.update", (e) => void onUpdates(e).catch((err) => logger.error(err)));
  s.ev.on("messaging-history.set", (e) => void onHistory(e).catch((err) => logger.error(err)));
  s.ev.on("connection.update", async (u) => {
    if (mine !== generation) return;
    if (u.isNewLogin) {
      // Scanned. WhatsApp now drops the socket and we must reconnect to finish linking.
      Object.assign(state, { status: "reconnecting", qr: null });
    }
    if (u.qr) {
      state.status = "qr";
      state.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      state.error = null;
    }
    if (u.connection === "open") {
      Object.assign(state, { status: "open", qr: null, me: phoneOf(s.user?.id), error: null });
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const wasShowingQr = state.status === "qr";
      // 408 is both "QR expired" and "connection lost": only an unpaired socket has an expired QR.
      const paired = Boolean(s.authState?.creds?.me);
      logger.warn({ code, paired, reason: u.lastDisconnect?.error?.message }, "connection closed");
      state.qr = null;
      if (wasShowingQr && !paired && code === DisconnectReason.timedOut) {
        // Nobody scanned. Wait for "Show new QR" (POST /connect) instead of
        // reconnecting forever with no one watching.
        state.status = "qr_expired";
        return;
      }
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone (or by /logout): forget the device and offer a fresh QR.
        Object.assign(state, { status: "logged_out", me: null });
        await rm(AUTH_DIR, { recursive: true, force: true });
      } else {
        state.status = "reconnecting";
        state.error = u.lastDisconnect?.error?.message ?? null;
      }
      setTimeout(() => void start().catch((e) => logger.error(e)), code === DisconnectReason.loggedOut ? 1000 : 3000);
    }
  });
}

function authorized(req) {
  if (!TOKEN) return false;
  const got = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("too large");
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://gateway");
  try {
    if (url.pathname === "/health") return json(res, 200, { ok: true, status: state.status, ...stats, recentErrors });
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/status") return json(res, 200, state);

    if (req.method === "POST" && url.pathname === "/send") {
      const { to, text } = await readJson(req);
      if (!/^\d{6,15}$/.test(String(to)) || typeof text !== "string" || !text.trim() || text.length > 4096) {
        return json(res, 400, { error: "Invalid number or message." });
      }
      if (state.status !== "open") return json(res, 409, { error: "WhatsApp is not connected. Scan the QR on the WhatsApp tab." });
      const sent = await sock.sendMessage(`${to}@s.whatsapp.net`, { text });
      const id = sent?.key?.id;
      if (!id) return json(res, 502, { error: "WhatsApp did not return a message id." });
      remember(id);
      return json(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/connect") {
      if (state.status === "qr_expired" || state.status === "logged_out") {
        state.status = "starting";
        void start().catch((e) => logger.error(e));
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/logout") {
      if (state.status !== "open") return json(res, 409, { error: "Not connected." });
      await sock.logout();
      return json(res, 200, { ok: true });
    }

    const media = url.pathname.match(/^\/media\/([A-Za-z0-9]{1,64})$/);
    if (req.method === "GET" && media) {
      for (const [mime, ext] of Object.entries(MEDIA_MIME)) {
        const bytes = await readFile(`${MEDIA_DIR}/${media[1]}.${ext}`).catch(() => null);
        if (bytes) {
          res.writeHead(200, { "Content-Type": mime, "X-Content-Type-Options": "nosniff" });
          return res.end(bytes);
        }
      }
      return json(res, 404, { error: "not found" });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    logger.error(e);
    return json(res, 500, { error: e instanceof Error ? e.message : "error" });
  }
});

if (!TOKEN) logger.error("WHATSAPP_GATEWAY_TOKEN is not set; every API call will be refused");
server.listen(PORT, () => logger.warn(`whatsapp gateway on :${PORT}`));
// One empty body at start proves the webhook URL and secret: /health shows lastStatus 200 or why not.
void postWebhook({ object: "whatsapp_business_account", entry: [] });
await start();
