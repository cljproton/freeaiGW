# FreeAI Gateway

**English** | [简体中文](README.zh-CN.md)

A highly available AI API gateway that aggregates free-tier AI APIs. Deployable on **Cloudflare Workers** (Hono + D1 + KV) or **self-hosted VPS** (Node + better-sqlite3 + file-based KV, one-command Docker Compose).

It automatically schedules multiple upstream channels behind a single `sk-xxx` gateway token, with tiered quotas, circuit breaking, automatic failover, reputation-based penalties, contribution incentives, and budget protection — fully automated, no manual intervention. The whole site is bilingual (EN / 中文).

## Features

- **Unified account**: anonymous sign-up (username + password only), one gateway token per user ([details](#security-design))
- **OpenAI compatible**: `POST /v1/chat/completions` with Bearer token auth
- **Bilingual UI**: EN/zh i18n via `ln` cookie, language-prefixed URLs (`/en`, `/zh`)
- **Upstream scheduling**: model matching + weighted routing + retry + automatic health stats (success rate, circuit breaking)
- **Tiered quotas**: dynamic tiers by reputation / new-user status (normal: 100 calls/day + 300k tokens)
- **Anti-abuse (self-built, zero third-party deps)**: Proof-of-Work (difficulty 4) + honeypot + submission timing + KV one-time replay guard + per-IP registration rate limit
- **Circuit breaking & auto-recovery**: success-rate threshold, 30-minute cooldown, auto probe & reuse
- **Reputation system**: lenient penalties, never bans, auto recovery through good behavior
- **Contribution incentives**: submit channels to earn CR tiers + newbie bonus, contributions boost your daily quota
- **Budget protection**: sampled usage estimation, upstream calls paused above threshold (static pages remain)
- **Daily cron**: quota reset, log cleanup, health recovery, budget reopen
- **Encrypted storage**: upstream `api_key` encrypted with `ENCRYPTION_KEY`; tokens stored as SHA-256 hashes only
- **Dual runtime**: the same `src/` runs on Cloudflare Workers and pure Node (D1→SQLite, KV→files)

## Architecture

```
                        ┌──────────────────────────────────────┐
  User / htmx pages  ──▶ │        Cloudflare Workers            │
  OpenAI-compatible  ──▶ │   Hono routes + middleware (budget /  │
        clients          │   quota / rate-limit)                │
                        │   ┌────────────────────────────┐     │
                        │   │  Scheduler (model match /   │     │
                        │   │  retry / failover)          │     │
                        │   └────────────┬───────────────┘     │
                        └────────────┬───────────────────────┘
                                     ▼
                  Upstream free AI channels (multiple providers)
```

### Routes

| Method & Path | Description |
|---------------|-------------|
| `GET /` | Homepage: integration example + available model list (with health status) |
| `GET/POST /auth` | Sign up / log in (transparent PoW challenge) |
| `POST /auth/logout` | Log out |
| `GET /dashboard` | Gateway token card + usage + contributions |
| `GET /submit` | Contributors submit / manage channels |
| `GET /api/tokens/*` | Token generation / reset (one-time plaintext display) |
| `GET/POST /api/channels/*` | Channel view / submit / re-validate / delete / fetch-models |
| `POST /v1/chat/completions` | **Main gateway endpoint** (Bearer `sk-xxx`) |
| `GET /v1/models` | Available model list |
| `GET /lang` | Language switch (`?to=zh` / `?to=en`, sets `ln` cookie) |
| `POST /cron/run` | Daily scheduled tasks (header `x-cron-token` verified) |
| `GET /en`, `GET /zh`, `GET /{en\|zh}/docs`, `GET /{en\|zh}/terms` | Language-prefixed pages (canonical form with hreflang; unprefixed public pages 301-redirect) |
| `GET /robots.txt` | Crawler policy (public pages allowed, admin/API disallowed; includes Sitemap) |
| `GET /sitemap.xml` | Bilingual sitemap with hreflang alternates |
| `GET /llms.txt`, `GET /llms.md` | GEO: site summary & full reference for LLMs |

## Quick Start (local development, Workers mode)

Prerequisites: Node.js ≥ 18, Cloudflare account (D1 + KV enabled), wrangler 4.x.

```bash
npm install

# 1. Local resources: create a D1 database and two KV namespaces, fill real IDs into wrangler.toml
#    (see wrangler.toml.example; IDs are on the Cloudflare dashboard)
cp wrangler.toml.example wrangler.toml

# 2. Local secrets (dev only; production uses wrangler secret)
cat > .dev.vars <<'EOF'
ENCRYPTION_KEY=<32-hex random>
CRON_TOKEN=<random string>
EOF

# 3. Initialize local DB and start the dev server
npm run db:migrate:local
npm run dev            # → http://127.0.0.1:8787
```

## Quick Start (self-hosted VPS, Node mode)

No Cloudflare account / D1 / KV needed — pure Node runs the same codebase (better-sqlite3 + file KV):

```bash
npm install
cp .env.example .env    # edit ENCRYPTION_KEY / CRON_TOKEN / PORT / DATA_DIR etc.
npm run start:node      # → http://127.0.0.1:8791 (DB tables auto-migrated on first run)
```

Manually trigger the daily cron: `POST /cron/run` + header `x-cron-token`.

## Deploy (Cloudflare Workers)

```bash
npm run publish                 # typecheck → skip remote D1 migration → deploy
npm run publish -- --migrate    # first deploy / schema change: apply remote D1 migration first
```

Set production secrets before deploying:

```bash
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put CRON_TOKEN
```

## Deploy (self-hosted VPS, Docker Compose)

The compose file pulls the **prebuilt GHCR image** by default — no local build required:

```bash
cp .env.example .env            # optional config; ENCRYPTION_KEY & CRON_TOKEN are auto-generated on first start
docker compose up -d            # pull + start, data persisted in ./data volume
docker compose logs -f          # view logs
```

- `ENCRYPTION_KEY` and `CRON_TOKEN` are **auto-generated on first container start** (`openssl rand -hex 16`); no manual setup needed.
- Custom image source / tag via `GHCR_REPO` and `IMAGE_TAG`; default `ghcr.io/cljproton/freeaigw:latest`.

Single container without Compose:

```bash
docker pull ghcr.io/cljproton/freeaigw:latest
docker run -d --name freeai -p 8791:8791 -v ./data:/app/data \
  ghcr.io/cljproton/freeaigw:latest
```

## GitHub Actions: build & publish the image

`.github/workflows/docker-publish.yml` is **manually triggered** (`workflow_dispatch`, optional `image_tag` input):
typecheck gate → multi-arch (amd64/arm64) build → push to GHCR using `GITHUB_TOKEN` (no extra secrets).

## Configuration

| Group | Variable | Default | Description |
|-------|----------|---------|-------------|
| Quota | `MAX_CALLS_PER_USER_DAY` | `100` | Daily call limit per normal/user |
| Quota | `MAX_TOKENS_PER_USER_DAY` | `300000` | Daily token limit per user |
| New user | `NEW_USER_DAYS` | `7` | New-user window (days) |
| New user | `NEW_USER_CALLS_QUOTA` | `50` | Daily call limit for new users |
| New user | `NEW_USER_TOKENS_QUOTA` | `150000` | Daily token limit for new users |
| Session | `SESSION_TTL` | `604800` | Session KV TTL (seconds) |
| Anti-abuse | `MAX_REGISTER_PER_IP_PER_DAY` | `20` | Max registrations per IP per day |
| Circuit | `CIRCUIT_*` | - | Success-rate threshold / min requests / cooldown / deactivation count |
| Retry | `MAX_PROXY_RETRIES` | `2` | Max upstream switches per call |
| Reputation | `REPUTATION_*` | - | Gain / penalty weights (Appendix J) |
| Contribution | `CONTRIBUTION_*` | - | CR tiers and bonuses (Appendix G) |
| Budget | `BUDGET_PAUSE_THRESHOLD` | `0.9` | Pause threshold |
| Budget | `BUDGET_SAMPLE_RATE` | `1/200` | Sampling frequency |
| SEO | `PUBLIC_BASE_URL` | `""` | Canonical/OG/sitemap base URL (empty = request Host) |

Full reference in `docs/PLAN.md` Appendix D; VPS/Node-specific config (Appendix K: `PORT`, `DATA_DIR`, `CRON_SCHEDULE`, and Workers-mode `ADSENSE_SLOT` / `ADSENSE_CLIENT`).

## Data Model

- **users**: account, PBKDF2 password hash, reputation, contribution tier, IP
- **user_tokens**: unique gateway token per user (SHA-256 hash + prefix hint only)
- **channels**: contributor upstream keys (encrypted) + health metadata (success rate / circuit / offlined)
- **user_quota**: daily per-user usage (calls / tokens)
- **usage_log**: call audit (model, upstream, status, tokens)
- **ip_register_log**: per-IP registration counter

## Security Design

- **Passwords**: PBKDF2 (low iteration, ≤10ms CPU, lightweight protection for anonymous accounts)
- **Gateway token**: one-time plaintext display; only hash stored; reset invalidates instantly
- **Upstream keys**: symmetric encryption with `ENCRYPTION_KEY`; `key_hint` masked display
- **Sign-up/login anti-abuse** (no third-party deps):
  1. **PoW**: server issues a random salt; the client solves `SHA-256(salt:nonce)` with ≥4 leading zero hex (~65k hashes, <0.5s on modern devices)
  2. **Honeypot**: hidden `website` field — any fill is rejected
  3. **Timing**: submission faster than 2.5s or older than 10 minutes is rejected
  4. **One-time replay guard**: challenge stored in KV (TTL 10 min), deleted on verification
- **IP rate limit**: ≤20 registrations per IP per day; temporary lockout after repeated login failures
- **Budget protection**: sampled estimation, global upstream pause above threshold (static pages & login kept)

## Project Structure

```
src/
├── index.ts            # Hono entry + Cron scheduled handler
├── types.ts            # Env types (wrangler.toml vars)
├── config.ts
├── db/                 # D1 access layer + row types
├── platform/           # Storage abstraction: Workers impl + Node impl (better-sqlite3 / file KV)
├── node/entry.ts       # Pure Node entry (node:http + .env + node-cron)
├── utils/              # crypto (PBKDF2/password/token), pow, audit, i18n, seo (canonical/JSON-LD)
├── middleware/         # auth / budget / quota / rate-limit / seo (language prefix + normalization)
├── routes/             # pages / auth / tokens / channels / proxy / cron / seo (robots/sitemap/llms)
└── views/              # htmx + Tailwind pages (inline PoW script, bilingual)
migrations/             # D1 SQL migrations (auto-applied in Node mode)
scripts/publish.sh      # One-shot publish (optional --migrate)
dist-node/              # Node-mode esbuild output
docs/PLAN.md            # Full design document (architecture / scheduling / budget / incentives / penalties)
```

## Documentation

- `docs/PLAN.md`: detailed design — scheduling engine (Ch.5), quota tiers (5.5), cron (Ch.6),
  anti-abuse (Appendix A), contribution incentives (Appendix G), budget protection (Appendix I),
  penalty system (Appendix J), Node/VPS runtime & i18n (Appendix K), SEO/GEO & image publishing (Appendix L)

## Disclaimer

- **Learning/testing only**: this project **provides no model services**; it only aggregates free API credentials voluntarily shared by community members. No availability, stability, or SLA guarantee.
- **Upstream ToS risk**: sharing API keys may violate upstream vendors' Terms of Service. Any resulting account bans, legal risks, or direct/indirect losses are **borne entirely by the contributor**.
- **Best-effort credential protection**: upstream keys are stored with AES-256-GCM encryption and tokens as SHA-256 hashes only, but the project assumes **no liability for data loss or leakage caused by force majeure**.
- **Service may become unavailable at any time**: quotas, circuit breaking, budget protection, and upstream vendor rate limits may pause or degrade the service at any time.
- **API does not expose upstream information**: the gateway **never leaks any upstream service identity, addresses, model lists, or error details** to clients; errors return only standard HTTP statuses and unified error codes.
- **Use implies acceptance**: using this service means you have read, understood, and agreed to the terms above. If you disagree, do not use it.

## License

[MIT](LICENSE)
