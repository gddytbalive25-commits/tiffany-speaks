# Tiffany Speaks

A mobile-first Progressive Web App for Good Day To Be Alive LLC. The first approved MVP builds on the supplied interactive prototype while replacing its fake download progress and fixed delayed translation with real browser capabilities and explicit capability notes.

## Current product scope

- **Call mode:** microphone-based Web Speech API captions when the browser supports them, a speakerphone/volume guide, transcript cards, and educational question/negation cue heuristics.
- **Sign mode:** camera preview, manual phrase selection/entry, and device text-to-speech. The app does **not** visually recognize ASL signs; it does not claim to do so.
- **Training mode:** short labelled camera clips saved to IndexedDB on the current device. Clips do not train an AI model and are not uploaded.
- **Library:** searchable, offline English gloss labels (10 free, 20 additional Plus labels), not sign definitions or sign videos. Media should be added only after licensing and ASL review.
- **Plans:** free local clip limit and Stripe Checkout/entitlement foundation. Stripe remains in test mode and checkout buttons remain disabled until price IDs are configured. Account recovery/cross-device syncing are not part of this MVP.
- **PWA:** installable manifest, icons, service worker, and cached shell/catalog assets. Speech recognition, speech synthesis voices, camera, and payments remain browser/device/network-dependent.

This is not a substitute for a qualified ASL interpreter. The text-to-sign grammar scaffold is a small heuristic, not validated ASL translation. Tiffany’s supplied portrait is displayed as a still image; no signing animation is fabricated.

## Requirements

- Node.js 20.19+ (22 recommended)
- pnpm 11.25.0 (the exact version is pinned in `package.json`)
- MySQL-compatible `DATABASE_URL` for server sessions, Stripe entitlements, and purchase history
- The managed Stripe integration for test `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- Test Price IDs to activate one-time and subscription checkout

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env
```

Set `DATABASE_URL` to a MySQL database. Set `APP_URL=http://localhost:3000` for local browser callbacks and local non-Secure guest cookies. Create test prices in Stripe, then set `STRIPE_ONE_TIME_PRICE_ID` and/or `STRIPE_SUBSCRIPTION_PRICE_ID` in `.env`. Never use live credentials for local/test work.

Export the managed Stripe keys in your shell (or load them through your local secret manager), then start the app:

```bash
export DATABASE_URL='mysql://…'
export STRIPE_SECRET_KEY='sk_test_…'
export STRIPE_WEBHOOK_SECRET='whsec_…'
pnpm dev
```

The web app and API are served together at `http://localhost:3000`. `pnpm check` runs TypeScript checks; `pnpm build` compiles the Vite client and the Node server; `pnpm start` serves the production build. First start applies additive, repeatable `CREATE TABLE IF NOT EXISTS` schema setup to the selected database. Do not point local development at data you are not authorized to change.

## Stripe test setup

The application creates Checkout Sessions on the server and verifies webhooks from the exact raw request body. It processes the managed integration’s subscribed events: `checkout.session.completed`, payment-intent success/failure, and subscription created/updated/deleted lifecycle events. Event IDs are stored before acknowledgment so Stripe redelivery is idempotent. One-time and subscription grants are stored independently so a cancellation cannot revoke a separate purchase; subscription lifecycle events retrieve current Stripe state before updating access. Entitlement is granted from a verified event, never from a browser return URL.

Configure Stripe test Products/Prices and set:

- `STRIPE_ONE_TIME_PRICE_ID=price_...`
- `STRIPE_SUBSCRIPTION_PRICE_ID=price_...`
- `APP_URL=https://<the exact public app origin>` for the published deployment

The managed integration provisions test credentials and registers `POST /api/stripe/webhook` for the current Preview. Reconnect the webhook for the active Preview before testing callbacks. Use Stripe’s test card `4242 4242 4242 4242` with a future expiry and any CVC; USD payments must satisfy Stripe’s minimum amount. Checkout does not become a live sale merely because the test integration is enabled.

Before live selling, the owner must define actual prices and terms, claim the sandbox/account, supply live Stripe keys through the platform’s integration settings, connect the production webhook, set the public URL, and validate purchase/fulfillment and support processes. The user’s requested `gooddaytobealive.com` domain is ready to be mapped, but it is not configured by this repository.

## PWA and privacy

The app-owned manifest and service worker cache the built UI, catalog bundle, icons, and supplied portrait. API routes are network-only. Camera clips are stored in IndexedDB on the same device/browser; clearing browser data can remove them. Captions are held in app memory only and are limited to the 100 most recent entries. The app does not upload microphone/camera recordings. Web Speech recognition may use browser/vendor services and can require connectivity; its privacy and availability depend on the browser/platform. If a buyer enters an email, the server stores it with the guest session; purchase history and required Stripe identifiers, webhook event IDs, and entitlement state are also stored persistently. A data-retention/deletion request policy and customer-facing privacy/terms must be defined before public sales; this MVP does not yet provide account deletion or automated retention expiry.

## Deployment

The `Dockerfile` builds the Vite client and TypeScript server, then runs the Express server on `PORT` (default 3000). Provide `DATABASE_URL`, managed Stripe secrets, configured test/live price IDs, and the browser-visible `APP_URL` as runtime variables. The unauthenticated readiness endpoint is `GET /api/ready`. Keep the integration in test mode until the owner explicitly prepares production pricing and live Stripe credentials. For Manus hosting, publish a reviewed checkpoint through the project’s deployment controls; this project is not automatically published by `pnpm build`.
