# Ambika Battery — Production & Inventory Management

A mobile app for a battery manufacturer to track raw materials, production, and finished-battery stock.
Employees log what they produced; an admin approves it, and stock moves automatically according to each battery type's recipe.

- **Mobile app:** Expo (React Native) + Expo Router, React Native Paper, TanStack Query
- **Backend:** Node.js + Express + TypeScript, Prisma, Zod
- **Database:** PostgreSQL 17
- **Auth:** passwordless, using a 6-digit code sent by email (Gmail SMTP or Resend)

---

## Features

### Everyone
- **Sign in, create a company, or join one** with an email code (no passwords).
- **Multi-company:** the same email can belong to several companies; sign-in asks which one.

### Users (employees)
- **Submit production requests:** battery type + quantity produced.
- **Delete** their own pending requests. The API also supports editing pending requests and resubmitting rejected ones, but the app has no screens for these yet.
- Dashboard with their pending count and recent requests.

### Admins
- **Raw materials:** create, rename, set a low-stock threshold, deactivate, view the stock ledger.
- **Battery types:** same as materials, plus **versioned recipes** (raw material needed per battery).
- **Production approval:**
  - **Approve** consumes the recipe's materials and adds the batteries to stock.
  - **Reject** needs a reason.
  - **Reverse** an approved request (needs a reason): materials go back into stock and the batteries are removed. This is blocked if some of those batteries have already been dispatched.
  - Each request shows **who submitted it**.
- **Dispatches:** send finished batteries to a trader. Quantity can't exceed stock. History can be shown for all types or one.
- **Material receipts:** record incoming raw material. History can be shown for all materials or one.
- **Stock adjustments:** the *only* manual way to change stock. Add or remove, always with a mandatory reason, with a preview of the new balance. New items start at 0 and are stocked here.
- **Low-stock dashboard:** materials and batteries below their threshold.
- **Invitation code:** share it with employees so they can join the company.

### Data integrity
- **Ledger:** every stock change writes a row to the stock-movement ledger, and current stock always equals the sum of the ledger.
- **No negative stock:** stock can never go below zero. Concurrent operations are row-locked, so two simultaneous dispatches can't double-spend the same stock.
- **Company isolation:** every query is scoped to the caller's company.

---

## Project structure

```
.
├── docker-compose.yml        # Postgres + backend (dev)
├── .env.example              # copy to .env
├── backend/
│   ├── prisma/               # schema.prisma + migrations
│   ├── scripts/              # API test suites + seed script
│   └── src/
│       ├── server.ts
│       ├── lib/              # stock ledger, auth, login codes, email, validators
│       ├── middleware/       # requireAuth / requireAdmin
│       └── routes/           # auth, production, admin/*
└── mobile/
    ├── app/                  # Expo Router screens
    │   ├── auth.tsx          # sign in / new company / join
    │   └── (app)/            # dashboard, requests, settings, materials, battery-types,
    │                         # dispatches, receipts, adjustments
    └── src/
        ├── api/              # fetch client + React Query hooks
        ├── auth/             # AuthContext, secure token storage
        └── screens/
```

---

## Getting started

### Prerequisites
- Docker + Docker Compose
- Node.js 20+ (for the mobile app and test scripts)
- **Expo Go** on your phone, which must be on the same Wi-Fi as your computer

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`. The Postgres defaults are fine for local dev. For email, see [Email setup](#email-setup); for a quick start, leave `EMAIL_PROVIDER=console`.

`.env` is git-ignored. Never commit real credentials.

### 2. Start the backend

```bash
docker compose up -d                                            # Postgres + backend on :3000
docker compose exec backend npx prisma migrate deploy           # apply DB migrations
curl http://localhost:3000/health                               # → {"status":"ok","db":"ok",...}
```

The backend runs with `tsx watch`, so code changes in `backend/src` reload automatically.

Use `sudo docker …` if your user isn't in the `docker` group. To fix that permanently, run `sudo usermod -aG docker $USER`, then log out and back in.

### 3. Run the mobile app

```bash
cd mobile
npm install
echo "EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:3000" > .env   # e.g. 192.168.0.9 (find it with: hostname -I)
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). Edits under `mobile/` hot-reload on the phone.

- After changing `mobile/.env`, restart with `npx expo start -c`. The value is baked into the bundle.
- If the app says *Cannot reach server*, open `http://<LAN-IP>:3000/health` in the phone's browser. If that fails, allow the ports through the firewall: `sudo ufw allow 3000 && sudo ufw allow 8081`.

### 4. (Optional) Seed demo data

```bash
cd backend && node scripts/seed-test-data.mjs
```

This creates a company with materials (100 each), battery types, and recipes, and prints the admin email and invitation code.

---

## Email setup

Sign-in codes are delivered according to `EMAIL_PROVIDER` in `.env`:

| Provider | Use for | Settings |
|---|---|---|
| `console` | Local dev | None. Codes are printed in the backend log and shown in the app. |
| `smtp` | Real email (e.g. Gmail) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| `resend` | Real email via [resend.com](https://resend.com) | `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) |

**Gmail:**
1. Turn on 2-Step Verification for the Google account.
2. Create an **App Password** under Google Account → Security → App passwords.
3. Add to `.env`:
   ```
   EMAIL_PROVIDER=smtp
   EMAIL_FROM="Ambika Battery <you@gmail.com>"
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=you@gmail.com
   SMTP_PASS=<16-char app password>
   ```
4. Apply the settings with `docker compose up -d backend`.
5. Check `docker compose logs backend | grep email`. It should say `provider=smtp connected`.

Gmail allows roughly 500 emails a day, which is plenty for sign-in codes.

**Dev safeguard:** outside production, addresses at `example.com`, `.test` or `.invalid` are never really emailed. Their code is logged and returned to the app as `devCode`, which is how the test scripts sign in.

**Code rules:**
- Codes expire after 10 minutes and work once.
- A code is locked after 5 wrong attempts.
- You can request a new code every 30 seconds, up to 10 per hour per email.

---

## Testing

The backend has end-to-end API test suites in `backend/scripts/`. Run them against the running server:

```bash
cd backend
npm run test:all          # or individually, e.g. npm run test:auth, npm run test:stock
```

| Suite | Covers |
|---|---|
| `test:auth` | Email codes: sign-in, register, join, lockout, cooldown, multi-company |
| `test:isolation` | Company data isolation, roles, sessions |
| `test:materials`, `test:batteryTypes`, `test:recipes` | Admin CRUD + recipe versioning |
| `test:stock` | Ledger invariant, adjustments, no negative stock |
| `test:productionRequests`, `test:approval` | Request lifecycle, approval stock math |
| `test:receiptsDispatches` | Receipts, dispatches, concurrent dispatch safety |
| `test:reversalLowStock` | Reversal + battery-stock guard, low-stock report |

Each run creates throwaway companies with `@example.com` emails.

Mobile typecheck:

```bash
cd mobile && npx tsc --noEmit
```

---

## API overview

All routes except `/health` and `/auth/*` need `Authorization: Bearer <token>`. `/admin/*` routes are admin-only.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/request-code`, `POST /auth/sign-in`, `POST /auth/register-company`, `POST /auth/join-company`, `GET /auth/me`, `POST /auth/logout` |
| Battery types (users) | `GET /battery-types` |
| Production requests (users) | `GET/POST /production-requests`, `GET/PATCH/DELETE /production-requests/:id`, `POST /production-requests/:id/resubmit` |
| Production requests (admin) | `GET /admin/production-requests[?status=]`, `GET /admin/production-requests/:id`, `POST …/:id/approve`, `POST …/:id/reject`, `POST …/:id/reverse` |
| Materials | `GET/POST /admin/materials`, `GET/PATCH /admin/materials/:id`, `POST …/:id/adjust`, `GET …/:id/movements`, `GET/POST …/:id/receipts` |
| Battery types (admin) | `GET/POST /admin/battery-types`, `GET/PATCH /admin/battery-types/:id`, `POST …/:id/adjust`, `GET …/:id/movements`, `GET/POST …/:id/dispatches` |
| Recipes | `GET/POST /admin/battery-types/:id/recipes`, `GET …/recipes/active`, `GET …/recipes/:recipeId` |
| Reports | `GET /admin/low-stock`, `GET /admin/dispatches`, `GET /admin/receipts`, `GET /admin/users` |

**Errors** are returned as `{ "error": "message", "code": "MACHINE_CODE", "details"?: … }`. Examples:
- `INSUFFICIENT_STOCK`
- `INSUFFICIENT_BATTERY_FOR_REVERSAL`
- `OTP_INVALID`
- `EMAIL_TAKEN`

---

## Database changes

The schema lives in `backend/prisma/schema.prisma`. After editing it:

```bash
docker compose exec backend npx prisma migrate dev --name <change_name>   # creates + applies migration, regenerates client
docker compose restart backend
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App: *Cannot reach server* | Phone and computer must be on the same Wi-Fi. Check `EXPO_PUBLIC_API_URL` matches `hostname -I`, then restart with `npx expo start -c`. Check the firewall. |
| Sign-in: *Could not send the email* | Check `docker compose logs backend \| grep email`. With Gmail, the App Password must be valid and 2-Step Verification on. |
| No email arrives | Check spam. In `console` mode codes are in the backend log, not your inbox. |
| Backend 500s after a schema change | Run the migration + restart from [Database changes](#database-changes). |
| Backend won't start after adding a dependency | Run `docker compose exec backend npm install`, then `docker compose restart backend`. |
