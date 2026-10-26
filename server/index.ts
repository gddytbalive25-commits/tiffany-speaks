import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { closeDatabase, createGuest, findGuest, getPool, hasPlus, initializeDatabase, listOrders, saveGuestEmail } from './db.js';
import { createCheckoutSession, offerings, processStripeEvent, verifyStripeEvent } from './billing.js';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function writeSessionCookie(res: Response, token: string): void {
  // Preview is public HTTPS even when the server sees proxy HTTP; only explicit localhost APP_URL opts out of Secure.
  const configuredOrigin = process.env.APP_URL?.trim();
  const localHttp = configuredOrigin ? /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredOrigin) : false;
  const secure = !localHttp;
  const sameSite = secure ? 'None' : 'Lax';
  const cookie = `ts_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=31536000; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
  res.append('Set-Cookie', cookie);
}

async function resolveGuest(req: Request, res: Response) {
  const token = readCookie(req, 'ts_session');
  if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    const hash = createHash('sha256').update(token).digest('hex');
    const found = await findGuest(hash);
    if (found) return found;
  }
  const created = await createGuest();
  writeSessionCookie(res, created.token);
  return created.guest;
}

function visibleOrigin(req: Request): string {
  const requestOrigin = req.get('origin');
  if (!requestOrigin) throw new Error('Checkout needs the browser-visible application origin.');
  const parsed = new URL(requestOrigin);
  if (parsed.origin !== requestOrigin) throw new Error('Checkout origin is malformed.');
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && new URL(appUrl).origin !== parsed.origin) throw new Error('Checkout origin does not match APP_URL.');
  return parsed.origin;
}

// Stripe requires the exact, unparsed request bytes for signature verification.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
  const signature = req.get('stripe-signature');
  if (!signature || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Missing signature or raw body.' });
    return;
  }
  try {
    const event = verifyStripeEvent(req.body, signature);
    await processStripeEvent(event);
    res.status(200).json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    console.error('Stripe webhook rejected:', message);
    res.status(message.includes('signature') || message.includes('secret') ? 400 : 500).json({ error: 'Webhook verification or processing failed.' });
  }
});

app.use(express.json({ limit: '64kb' }));
app.get('/api/ready', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.status(200).json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

app.get('/api/session', async (req, res) => {
  try {
    const guest = await resolveGuest(req, res);
    res.json({ buyerId: guest.buyerId, email: guest.email, plus: await hasPlus(guest.buyerId) });
  } catch (error) {
    console.error('Guest session could not be loaded:', error instanceof Error ? error.message : 'unknown');
    res.status(503).json({ error: 'Session service is temporarily unavailable.' });
  }
});

app.get('/api/payments/offerings', (_req, res) => res.json(offerings()));

app.post('/api/checkout', async (req, res) => {
  try {
    const plan = req.body?.plan;
    if (plan !== 'one_time' && plan !== 'subscription') {
      res.status(400).json({ error: 'Choose a supported plan.' });
      return;
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
      return;
    }
    const guest = await resolveGuest(req, res);
    if (email) await saveGuestEmail(guest.buyerId, email);
    const url = await createCheckoutSession({ plan, buyerId: guest.buyerId, email: email || guest.email, origin: visibleOrigin(req) });
    res.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout could not be started.';
    console.warn('Checkout not started:', message);
    const status = message.includes('not configured') ? 409 : message.includes('origin') || message.includes('email') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const guest = await resolveGuest(req, res);
    res.json(await listOrders(guest.buyerId));
  } catch (error) {
    console.error('Purchase history unavailable:', error instanceof Error ? error.message : 'unknown');
    res.status(503).json({ error: 'Purchase history is temporarily unavailable.' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

const isProduction = process.env.NODE_ENV === 'production';
const httpServer = createHttpServer(app);
let viteServer: { middlewares: express.RequestHandler; close: () => Promise<void> } | null = null;

async function start(): Promise<void> {
  await initializeDatabase();
  if (isProduction) {
    const staticRoot = path.resolve(process.cwd(), 'dist');
    app.use(express.static(staticRoot, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'vite.config.ts'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server: httpServer } },
    });
    viteServer = vite;
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('Request failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'An unexpected application error occurred.' });
  });

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  httpServer.listen(port, '0.0.0.0', () => console.log(`Tiffany Speaks listening on port ${port}`));
}

let shutdownPromise: Promise<void> | null = null;
async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    await viteServer?.close();
    const forceClose = setTimeout(() => httpServer.closeAllConnections(), 8_000);
    forceClose.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    } finally {
      clearTimeout(forceClose);
      await closeDatabase();
    }
  })();
  return shutdownPromise;
}
process.once('SIGTERM', () => { void shutdown().catch((error) => { console.error('Shutdown failed:', error); process.exitCode = 1; }); });
process.once('SIGINT', () => { void shutdown().catch((error) => { console.error('Shutdown failed:', error); process.exitCode = 1; }); });

void start().catch((error) => {
  console.error('Application startup failed:', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
