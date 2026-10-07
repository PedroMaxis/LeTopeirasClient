# Deploy (Oracle Cloud, Ampere A1 / ARM64)

The production stack is one `docker compose` project with four services, all on the host network and all `restart: unless-stopped`:

| Service   | What                                                        | Listens on                                                                                           |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `caddy`   | HTTPS (Let's Encrypt) + TURN/TLS routing by SNI on 443      | 80, 443                                                                                              |
| `server`  | Fastify API + WebSocket, SQLite in the `server-data` volume | 127.0.0.1:3000                                                                                       |
| `livekit` | SFU + embedded TURN                                         | 127.0.0.1:7880, 7881/tcp, 3478/udp, 50000–60000/udp, 5349 (behind Caddy, not opened in the firewall) |
| `redis`   | LiveKit room state                                          | 127.0.0.1:6379                                                                                       |

Domains (DuckDNS, all pointing at the instance IP):

- `letopeiras.duckdns.org` → server (API + WebSocket)
- `letopeiras-lk.duckdns.org` → LiveKit signaling
- `letopeiras-turn.duckdns.org` → LiveKit TURN/TLS (Caddy decrypts it on 443 and hands it to LiveKit)

## Prerequisites

- Ubuntu instance with Docker Engine and the Compose plugin (`docker compose version`).
- Oracle VCN Security List, ingress from `0.0.0.0/0`: TCP 80, 443, 7881; UDP 3478, 50000–60000.
- The same ports open in the instance's iptables: `sudo ./setup-firewall.sh` (idempotent, persists with `netfilter-persistent`).

## First deploy

```sh
# 1. Get the repo onto the instance (clone, or rsync from your PC — see below)
git clone <repo-url> ~/letopeiras
cd ~/letopeiras/infra

# 2. Firewall (once)
sudo ./setup-firewall.sh

# 3. Config
cp .env.example .env
sed -i "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=$(openssl rand -base64 48 | tr -d '\n=')|" .env
nano .env   # set ACME_EMAIL, check the domains
chmod 600 .env

# 4. Build and start (the first build takes a few minutes on 1 OCPU)
docker compose up -d --build

# 5. Admin user (prints a random password once)
docker compose exec server node dist/cli/create-admin.mjs <username> "<display name>"
```

Without a git remote, copy the repo from your PC instead of cloning (from the repo root, in Git Bash):

```sh
tar --exclude=node_modules --exclude=.git --exclude=keys --exclude=.env --exclude=data \
    --exclude=dist --exclude=out --exclude=design -czf - . \
  | ssh -i keys/<key> ubuntu@<ip> 'mkdir -p ~/letopeiras && tar -xzf - -C ~/letopeiras'
```

## Checking it works

```sh
docker compose ps                          # all four "running"
curl https://letopeiras.duckdns.org/health
docker compose logs -f caddy               # certificates obtained for the 3 domains
docker compose logs -f livekit             # "starting LiveKit server", TURN on 3478/5349
```

Media test without our client: `./gen-token.sh` prints a token. On two machines on different networks, open <https://meet.livekit.io>, tab **Custom**, paste `wss://letopeiras-lk.duckdns.org` and a token from a different identity on each (`./gen-token.sh pedro`, `./gen-token.sh amigo`). Check voice and screen share both ways.

To force TURN/TLS (simulating a network that blocks UDP): in Chrome, `chrome://webrtc-internals` shows the selected candidate pair; the relay candidate should be `turns:letopeiras-turn.duckdns.org:443`.

## Updating

```sh
cd ~/letopeiras && git pull
cd infra && docker compose up -d --build
docker image prune -f
```

The database lives in the `letopeiras_server-data` volume and survives rebuilds. Migrations run on startup.

## Operations

```sh
docker compose logs -f --tail=200 server    # logs (json-file, rotated at 5 × 10 MB per service)
docker compose restart server
docker compose down                          # stop (volumes are kept)
```

- Certificates live in the `letopeiras_caddy-data` volume; Caddy renews them automatically.
- LiveKit only keeps state in Redis and memory; restarting it drops calls in progress, and the server resyncs voice state on its own restart.
- Changing `LIVEKIT_API_SECRET` logs everyone out of voice (old tokens become invalid) but not out of the app.

### Logs

Every service logs to Docker's `json-file` driver, rotated at 5 × 10 MB per service. The server writes one JSON object per line (pino, through Fastify): each request with method, URL, status and client IP, plus errors with their stack.

```sh
docker compose logs -f --tail=200 server
docker compose logs --since 1h server | grep '"level":50'           # errors only
docker compose logs --since 30m livekit | grep -E 'participant (active|closing)'
```

## Backups

`./backup.sh` writes a consistent copy of the SQLite database (SQLite's online backup API, safe while the server runs), gzipped, to `~/letopeiras-backups`, keeping the newest 7. Run it daily from cron (the instance clock is UTC; 07:00 UTC is 04:00 in Brasília):

```sh
chmod +x ~/letopeiras/infra/backup.sh
(crontab -l 2>/dev/null; echo '0 7 * * * $HOME/letopeiras/infra/backup.sh >> $HOME/letopeiras-backups/backup.log 2>&1') | crontab -
```

The backups live on the same instance. Every now and then, copy one to your PC:

```sh
scp -i keys/<key> 'ubuntu@<ip>:letopeiras-backups/letopeiras-*.db.gz' .
```

Restoring a backup:

```sh
cd ~/letopeiras/infra
docker compose stop server
gunzip -c ~/letopeiras-backups/<file>.db.gz > /tmp/restore.db
# Copied as the container's `node` user, so the server can still write it.
docker compose run --rm --no-deps -v /tmp/restore.db:/restore.db:ro --entrypoint sh server \
  -c 'cp /restore.db /data/letopeiras.db && rm -f /data/letopeiras.db-wal /data/letopeiras.db-shm'
docker compose start server
```

## Outbound traffic (Oracle free limit: 10 TB/month)

Oracle bills outbound data beyond 10 TB/month. Voice is negligible; screen share is what counts. The SFU sends each viewer their own copy, about 6 Mbps at 1080p60, which is roughly **2.7 GB per viewer per hour**. 10 TB is about 3,700 viewer-hours a month (e.g. 5 viewers watching 4 h a day, every day, uses ~1.6 TB).

Where to check:

- **Per instance:** Console → Compute → Instances → the instance → **Metrics** → _Network Bytes Out_ (set the interval to 1 day and the statistic to _Sum_).
- **Per account:** Console → Billing & Cost Management → **Cost Analysis**, grouped by service. Outbound data shows up under Networking; while it stays at US$ 0.00, you're inside the free tier.
- The US$ 1 budget alert e-mails you if anything ever starts costing money.
