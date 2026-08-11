# Deploying the scraper / order-entry service to a DigitalOcean Droplet

This service runs a persistent Flask + Playwright/Chromium process that logs into
the Unifi dealer portal, searches addresses, and (later) submits orders. It powers
everything under BizzFlow's **Order Entry** tab. Vercel (the Next.js frontend)
calls it over HTTPS via `SCRAPER_API_URL`.

Files in this folder: `Dockerfile`, `docker-compose.yml`, `Caddyfile`,
`requirements.txt`, `.env.production.example`.

---

## ⚠️ 0. Preflight — test the portal login from the droplet FIRST

The Unifi portal has bot-detection and this will run from a **datacenter IP**.
Before relying on the droplet, do one **real dealer connect** (OTP) through it.
If login is challenged/blocked, you'll need a **residential proxy** in front of
the login (or keep the service on a residential IP via a tunnel). Don't skip this —
everything else is wasted effort if the IP is blocked.

---

## 1. Create the droplet

- **Type:** a regular **Droplet** — NOT a GPU Droplet (headless Chromium is
  CPU/RAM-bound; a GPU does nothing here).
- **Image:** Ubuntu 24.04 LTS
- **Plan:** Basic → Regular. **$6 / 1 GB RAM / 1 vCPU** is the minimum and is OK
  for **single-user testing only** (one browser at a time) **— but you MUST add
  swap (step 3.5).** For real multi-agent use, size up to 2–4 GB; 1 GB will OOM
  under any concurrency.
- **Region:** **Singapore (SGP1)** — closest to the Malaysian portal.
- **SSH key:** paste your PUBLIC key (`~/.ssh/id_ed25519.pub`). The private key
  stays on your Mac in `~/.ssh/` — never upload it.

## 2. DNS

Point a subdomain at the droplet's public IP (for automatic HTTPS):

```
Type  Host                     Value
A     scraper.yourdomain.com   <droplet-ip>
```

## 3. Install Docker on the droplet

```bash
ssh root@<droplet-ip>
curl -fsSL https://get.docker.com | sh
```

## 3.5. Add swap (REQUIRED on the 1 GB / $6 droplet)

Without swap, Chromium will OOM-kill on 1 GB. Add 2 GB of swap:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab   # persist across reboots
free -h                                            # confirm Swap: 2.0Gi
```

(Skip this only if you chose a 4 GB+ droplet.)

## 4. Copy the scraper code up

`scraper/` is git-ignored, so copy it directly from your machine (run locally):

```bash
rsync -av --exclude '.env' --exclude 'sessions/' --exclude 'logs/' \
      --exclude '__pycache__/' --exclude '.pytest_cache/' \
      ./scraper/  root@<droplet-ip>:/opt/bizzflow-scraper/
```

If you use the shared-login fallback, also copy `config/` (holds the encryption
key). For the per-user dealer flow it's not required.

## 5. Configure env + persistent dirs (on the droplet)

```bash
cd /opt/bizzflow-scraper
cp .env.production.example .env
nano .env            # set ORDER_ENTRY_API_TOKEN (MATCH Vercel) + SCRAPER_DOMAIN
mkdir -p sessions logs config
```

`ORDER_ENTRY_API_TOKEN` **must be identical** to the one you set in Vercel.

## 6. Build + run

```bash
docker compose up -d --build
docker compose logs -f scraper     # watch it boot
```

Health check (from the droplet or anywhere once DNS + TLS are live):

```bash
curl https://scraper.yourdomain.com/health
# -> {"status":"healthy",...}
```

## 7. Firewall

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

## 8. Point Vercel at it

In the Vercel project → Settings → Environment Variables:

```
SCRAPER_API_URL      = https://scraper.yourdomain.com
ORDER_ENTRY_API_TOKEN = <same token as the droplet>
```

Redeploy the frontend so the new env is picked up.

## 9. End-to-end test (Louis)

1. Louis logs into BizzFlow (production).
2. Order Entry tab is visible (his admin toggle is ON).
3. **Connect Unifi Dealer Account** → OTP → connected  ← this is the real IP test.
4. New Order → search an address (proves the droplet round-trip works).

---

## Operating notes

- **Single process only.** The service keeps job + dealer-session state in memory,
  so it runs one worker (`-w 1`). Do **not** scale to multiple workers/replicas.
- **Sessions persist** in `./sessions` (bind-mounted). Dealer portal sessions
  still expire ~15 min server-side; users reconnect via OTP as normal.
- **Updating code:** re-run the `rsync` from step 4, then
  `docker compose up -d --build`.
- **Memory:** `docker stats` to watch; if Chromium OOMs, size up the droplet.
  `shm_size: 1gb` is already set to avoid the classic Chromium `/dev/shm` crash.
- **Logs/screenshots:** `./logs` on the droplet (error screenshots land here).
- **Security:** only `/health` and the dealer/OTP/address/order routes are exposed;
  the order routes require the `X-Internal-Token` header (your shared secret) and
  travel over HTTPS. Keep the token secret and rotate it if leaked.
