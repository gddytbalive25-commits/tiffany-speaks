# Tiffany Speaks — Implementation Plan

## Approved scope

Build the approved honest MVP from the supplied Tiffany Speaks prototype. Deliver a mobile-first installable PWA with the real browser capabilities available to it: microphone-based speech recognition where supported, camera preview and local labelled training-clip recording, browser text-to-speech, phrase/transcript display, non-manual marker guidance, a searchable offline starter sign catalog, install/offline shell, and a Stripe test-mode checkout/entitlement foundation with durable records. Clearly disclose that the browser app does not yet visually recognize ASL or produce fluent avatar signing; those require licensed sign-video assets and a validated recognition/signing pipeline. Do not fabricate model behavior or sign media.

The supplied reference’s simulated “download” progress and fixed delayed “Hello” result are replaced by explicit real functionality or honest capability notices. Speakerphone/microphone guidance remains central; browser speech recognition is best-effort and not a guarantee of direct telephone audio capture.

## Architecture

- **Frontend:** React + TypeScript + Vite, responsive mobile-first interface; semantic controls and accessible contrast/focus states.
- **Browser features:** Web Speech API behind feature detection; `getUserMedia` for camera and training-video capture; `speechSynthesis` for playback. Persist personal clips/catalog preferences locally in IndexedDB, with graceful permission/API failure states.
- **Offline/PWA:** app-owned manifest, install icons, and a service worker/cache for the shell and bundled catalog. Clearly identify that live speech recognition and payment require connectivity/browser support.
- **ASL scope:** Text-based grammar cueing for time-topic-comment and simple question/negation heuristics is educational guidance, not validated ASL translation. Starter catalog contains searchable labels and explanations, not invented sign footage. Training clips are user-labelled examples and are not claimed to train a recognition model.
- **Server/payments:** Node/Express TypeScript server; Stripe Checkout in test mode only; managed database for checkout/entitlement state and webhook event deduplication. Verify raw webhook signatures and grant entitlements only from verified webhook state. Never claim live selling until prices, account claim/live keys, webhook connection, policies, domain, and operational validation are complete.
- **Product page:** Branded product/pricing/feature surface suitable for later `gooddaytobealive.com` domain mapping; pricing remains clearly configurable rather than inventing a final business offer.

## Project structure

- `src/` React app, mode views, browser capability hooks, catalog and accessibility UI.
- `src/lib/` ASL cue heuristics, speech/camera helpers, local clip storage and type-safe API client.
- `server/` Express API, Stripe checkout/webhook handlers, persistence and health endpoint.
- `public/` supplied Tiffany photo, PWA manifest/icons, service worker and route manifest.
- `README.md` local setup, supported-browser notes, environment variables, Stripe sandbox setup, deployment and honest capability boundaries.
- `plan.md` and `TODO.md` retain approved scope and delivery status.

## Design system

- **Design Movement:** warm, modern mobile utility grounded in the supplied prototype’s deep-teal call interface.
- **Core Principles:** calm during live calls; make the active mode and permission state unmistakable; captions stay legible; capability limits are stated plainly.
- **Color Philosophy:** deep blue-green conveys steadiness; brighter sea-glass teal marks actions and focus; warm ivory and restrained coral add human warmth and safety cues.
- **Layout Paradigm:** compact phone-first vertical stage with Tiffany portrait/voice context above a persistent four-destination navigation and task-specific panels; larger screens widen into a comfortable two-column workspace.
- **Signature Elements:** live listening pill; softly rounded transcript cards; small “what works here” capability badges.
- **Interaction Philosophy:** one primary action per mode, explicit start/stop and permission feedback, no fake progress or automatic recognition claims.
- **Animation:** restrained fades/pulses only for live/listening states; honor reduced-motion preference; never suggest movement signing when no clip is playing.
- **Typography System:** system sans stack for robust mobile rendering; large readable mode titles, medium-weight labels, high line-height transcript text.
- **Brand Essence:** a practical communication companion for callers and signers, built around Tiffany’s presence and transparent about its current limits; warm, dependable, candid.
- **Brand Voice:** direct and reassuring. Examples: “Put your call on speaker so the mic can hear it.” “Your saved clips stay on this device.”
- **Wordmark & Logo:** custom text mark with a subtle paired-hand/voice-wave motif, implemented in CSS/SVG without suggesting a signing avatar.
- **Signature Brand Color:** deep teal `#0D7377`, retained from the prototype.

## Dependencies, serving, and operational constraints

Use a pinned package manager and reviewed lifecycle-script policy before first install. The server capability is enabled; the managed database is enabled only for the approved entitlement need. Browser secrets are never shipped to the client. Stripe is enabled through the managed integration and starts with its test account; complete checkout/webhook wiring but do not assert live production readiness. The app listens on configured port 3000, with a health route and a static frontend build. The final README must document required `STRIPE_PRICE_ID`/public app origin/config and the live-key/webhook claim steps without embedding secrets.
