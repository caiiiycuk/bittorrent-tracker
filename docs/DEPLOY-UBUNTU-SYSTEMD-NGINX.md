# Deploying bittorrent-tracker on Ubuntu (systemd + nginx + WSS)

This guide describes running the tracker on a VPS with **Ubuntu**, managing the Node process with **systemd**, and terminating **TLS** and **WebSocket Secure (WSS)** in **nginx**. Adjust hostnames, paths, and ports to match your server.

## What you get

- **HTTP(S) announce & scrape** behind nginx with SSL and rate limiting.
- **WebSocket** upgraded through nginx (`wss://`) to the same Node HTTP listener.
- **UDP** can stay on the host (or be firewalled separately); nginx only handles TCP (HTTP/HTTPS/WSS).

## Prerequisites

- Ubuntu 22.04/24.04 (or similar) with `root` or `sudo`.
- Node.js **≥ 16** (LTS recommended). This document uses a global install via **nvm** under `/root`; you may use a dedicated user and a different path.
- Domain name pointing at the VPS (for Let’s Encrypt).
- Open ports as needed: e.g. **443** or a custom TLS port (**8444** in the examples below), and optionally **UDP** for the tracker if you use classic `udp://` announces.

## 1. Install the tracker

From the project directory or via npm:

```bash
npm install -g bittorrent-tracker
```

Or clone this repo and run `npm install`, then invoke `node bin/cmd.js` (or link the binary yourself).

Confirm the binary path you will use in `ExecStart` (example with nvm):

```text
/root/.nvm/versions/node/v24.14.0/bin/node
/root/.nvm/versions/node/v24.14.0/lib/node_modules/bittorrent-tracker/bin/cmd.js
```

## 2. systemd service

Below is the unit you defined, kept as a single file (e.g. `/etc/systemd/system/bittorrent-tracker.service`). The `**Environment=**` lines for **seed filtering** turn on preferential WebSocket peer selection using your cloud snapshot (**paused** + **resumable** + **download progress**). Set `**SEED_FILTER_ENABLED=true`** and a valid `**SEEDERS_URL**` together; the tracker polls that URL and applies the filter only to **WebRTC/WebSocket** announces (HTTP/UDP lists are unchanged).

```ini
[Unit]
Description=BitTorrent/WebTorrent announce server (bittorrent-tracker)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
ExecStart=/root/.nvm/versions/node/v24.14.0/bin/node /root/.nvm/versions/node/v24.14.0/lib/node_modules/bittorrent-tracker/bin/cmd.js -p 123 --trust-proxy --http-hostname 0.0.0.0 --udp-hostname 0.0.0.0 --no-udp6 --interval 180000
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=SEED_FILTER_ENABLED=true
Environment=SEEDERS_URL=https://your-cloud.example/seeders
Environment=SEED_PROGRESS_MIN=35
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Seed filter environment variables


| Variable                  | Required           | Meaning                                                                                                                                                                                                         |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**SEED_FILTER_ENABLED**` | Yes, to enable     | Must be the literal string `**true**`. Turns on filtering for WebSocket announces when a snapshot is available.                                                                                                 |
| `**SEEDERS_URL**`         | Yes, for live data | HTTPS or HTTP URL the tracker **GET**s periodically (JSON array of records with `info_hash`, `peer_id`, `paused`, `resumable`, `progress`). Without this URL, the tracker does **not** poll and filtering has no cloud data. |
| `**SEED_PROGRESS_MIN`**   | No                 | Minimum **progress percent** for a peer to be preferred (default **35** if unset). Peers at or below this value (or `paused=true` with `resumable=false`) are deprioritized for WebSocket peer lists when the snapshot says so. |


To **disable** seed filtering, remove the three variables or set `Environment=SEED_FILTER_ENABLED=false`, and drop or comment `SEEDERS_URL` / `SEED_PROGRESS_MIN` as needed. Reload after edits: `sudo systemctl daemon-reload && sudo systemctl restart bittorrent-tracker.service`.

### Commands

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bittorrent-tracker.service
sudo systemctl status bittorrent-tracker.service
journalctl -u bittorrent-tracker.service -f
```

### Notes

- `**--trust-proxy**` is required so the tracker trusts `X-Forwarded-For` / `X-Real-IP` from nginx and records correct client IPs for HTTP announces.
- `**-p 123**` binds the **HTTP + WebSocket** listener on `123` (localhost-facing; nginx proxies to `127.0.0.1:123`). Pick a high, non-privileged port you are comfortable with.
- `**--interval 180000`** sets the announce interval to **3 minutes** (milliseconds).
- `**--no-udp6`**: the stock `bin/cmd.js` in this repository does **not** define this flag. If your installed package ignores unknown flags, UDP6 may still start. To disable **all** UDP (keep HTTP + WebSocket only), use `**--no-udp`**. To only disable IPv6 UDP, use the programmatic `Server` API or extend the CLI; verify with `ss -ulnp | grep node` after start.
- **Running as `root`**: acceptable only if you accept the risk; a dedicated `**User=**` and `**WorkingDirectory=**` under `/opt/bittorrent-tracker` or `/var/lib/bittorrent-tracker` is safer.

## 3. nginx (TLS + reverse proxy + WSS)

Put the rate-limit zone in `**http**` context (e.g. `/etc/nginx/nginx.conf` inside `http { ... }`):

```nginx
limit_req_zone $binary_remote_addr zone=tracker_zone:10m rate=10r/s;
```

Example `**server**` block (paths and `server_name` match your earlier setup):

```nginx
server {
    listen 8444 ssl;
    server_name cloud.js-dos.com;

    ssl_certificate     /etc/letsencrypt/live/cloud.js-dos.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloud.js-dos.com/privkey.pem;

    location = / {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123/announce;

        proxy_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /announce {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123/announce;

        proxy_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /announce-http {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123/announce;

        proxy_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /scrape {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123/scrape;

        proxy_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /scrape-http {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123/scrape;

        proxy_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /announce-ws {
        limit_req zone=tracker_zone burst=50 nodelay;
        proxy_pass http://127.0.0.1:123;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_connect_timeout 5s;
    }

    location = /announce/ {
        return 301 /announce;
    }

    location = /announce-http/ {
        return 301 /announce-http;
    }

    location = /scrape/ {
        return 301 /scrape;
    }

    location = /scrape-http/ {
        return 301 /scrape-http;
    }

    location /stats {
        proxy_pass http://127.0.0.1:123;
    }
}
```

Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Client URLs


| Role             | Example (your host)                       |
| ---------------- | ----------------------------------------- |
| HTTPS announce   | `https://cloud.js-dos.com:8444/announce`  |
| HTTPS scrape     | `https://cloud.js-dos.com:8444/scrape`    |
| WSS (WebTorrent) | `wss://cloud.js-dos.com:8444/announce-ws` |


WebTorrent / browser clients must use the **WSS URL that matches this `location`**. If a client defaults to `wss://host/` or `wss://host/announce`, change the magnet or app config to `**/announce-ws**` (or add a separate `location` that matches what your client sends).

### TLS on port 443

For standard `https://` / `wss://` on **443**, copy the same `location` blocks into a `server { listen 443 ssl; ... }` and obtain certificates for that `server_name`.

## 4. Firewall

- Allow **TCP** to nginx (e.g. **8444** or **443**).
- If you expose **UDP** tracker: allow the same port number as in `bittorrent-tracker` for UDP4 (see startup logs: `UDP tracker: udp://...`).

Example with `ufw`:

```bash
sudo ufw allow 8444/tcp
# sudo ufw allow 123/udp   # only if clients reach UDP on that port
sudo ufw enable
```

## 5. Let’s Encrypt

Use **certbot** with nginx or standalone to obtain `fullchain.pem` and `privkey.pem` for `cloud.js-dos.com`, then point `ssl_certificate` and `ssl_certificate_key` at those paths (as in your config).

## 6. Verification

- **Tracker up:** `curl -sS "https://cloud.js-dos.com:8444/stats" | head`
- **Announce (smoke):** use a BitTorrent client with `https://.../announce` or test with a minimal announce (respecting required query parameters).
- **Logs:** `journalctl -u bittorrent-tracker -n 100 --no-pager`

---

This document matches the **bittorrent-tracker** HTTP/WebSocket behavior (announce `/announce`, scrape `/scrape`, stats `/stats`) and your nginx path layout for **WSS** on `/announce-ws`.