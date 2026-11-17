import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import {
  orderStatuses,
  paymentMethods,
  tables,
  validateOrder,
  validateProduct,
  validateWaiterCall,
  ValidationError
} from './validation.js';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(here, '..', 'dist');
const sessionDurationMs = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();
const publicOrderAttempts = new Map();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL muhit o‘zgaruvchisi sozlanmagan.');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_USERNAME va ADMIN_PASSWORD muhit o‘zgaruvchilarini sozlang.');
}
if (process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.includes('change-this')) {
  throw new Error('ADMIN_PASSWORD kamida 12 belgidan iborat, taxmin qilish qiyin parol bo‘lishi kerak.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  const entry = cookies.find(cookie => cookie.trim().startsWith(`${name}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return null;
  }
}

function isRateLimited(limits, key, maxRequests, windowMs) {
  const now = Date.now();
  const current = limits.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    limits.set(key, { count: 1, startedAt: now });
    if (limits.size > 5000) {
      for (const [entryKey, value] of limits) {
        if (now - value.startedAt >= windowMs) limits.delete(entryKey);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > maxRequests;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `samovar_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAgeSeconds}${secure}`
  );
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    stock: row.stock,
    status: row.status,
    image: row.image,
    description: row.description,
    badge: row.badge,
    isChefSpecial: row.is_chef_special
  };
}

function serializeOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    table: row.table_name,
    guestCount: row.guest_count,
    timestamp: row.created_at,
    status: row.status,
    notes: row.notes,
    paymentMethod: row.payment_method,
    serviceFeePercent: row.service_fee_percent,
    subtotal: row.subtotal,
    serviceFee: row.service_fee,
    total: row.total,
    items: row.items
  };
}

async function requireAdmin(req, res, next) {
  const token = getCookie(req, 'samovar_admin');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return sendError(res, 401, 'Admin sifatida tizimga kiring.');
  }

  const result = await pool.query(
    'SELECT username FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [hashToken(token)]
  );
  if (result.rowCount === 0) return sendError(res, 401, 'Admin sessiyasi tugagan. Qayta kiring.');

  req.admin = { username: result.rows[0].username };
  return next();
}

async function getOrders(queryable, limit = 300) {
  const result = await queryable.query(
    `SELECT o.id, 'SMV-' || o.order_number::text AS order_number,
            o.table_name, o.guest_count, o.created_at, o.status, o.notes,
            o.payment_method, o.service_fee_percent, o.subtotal, o.service_fee, o.total,
            COALESCE(
              json_agg(json_build_object(
                'id', oi.product_id, 'name', oi.name, 'price', oi.price, 'quantity', oi.quantity
              ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
              '[]'::json
            ) AS items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(serializeOrder);
}

app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

app.get('/api/products', async (req, res) => {
  const result = await pool.query('SELECT * FROM products ORDER BY created_at, id');
  res.json(result.rows.map(serializeProduct));
});

app.post('/api/admin/login', async (req, res) => {
  const ip = req.ip;
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.count >= 5 && Date.now() - attempt.startedAt < 15 * 60 * 1000) {
    return sendError(res, 429, 'Juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.');
  }

  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const expectedUsername = Buffer.from(process.env.ADMIN_USERNAME);
  const suppliedUsername = Buffer.from(username);
  const expectedPassword = Buffer.from(process.env.ADMIN_PASSWORD);
  const suppliedPassword = Buffer.from(password);
  const usernameMatches = expectedUsername.length === suppliedUsername.length &&
    crypto.timingSafeEqual(expectedUsername, suppliedUsername);
  const passwordMatches = expectedPassword.length === suppliedPassword.length &&
    crypto.timingSafeEqual(expectedPassword, suppliedPassword);

  if (!usernameMatches || !passwordMatches) {
    const current = attempt && Date.now() - attempt.startedAt < 15 * 60 * 1000
      ? attempt
      : { count: 0, startedAt: Date.now() };
    current.count += 1;
    loginAttempts.set(ip, current);
    return sendError(res, 401, 'Foydalanuvchi nomi yoki parol noto‘g‘ri.');
  }

  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  await pool.query(
    'INSERT INTO admin_sessions (token_hash, username, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), username, expiresAt]
  );
  setSessionCookie(res, token, Math.floor(sessionDurationMs / 1000));
  res.json({ username });
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

app.post('/api/admin/logout', async (req, res) => {
  const token = getCookie(req, 'samovar_admin');
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)]);
  }
  setSessionCookie(res, '', 0);
  res.status(204).end();
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  res.json(await getOrders(pool));
});

app.get('/api/admin/waiter-calls', requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, table_name, guest_count, status, created_at
     FROM waiter_calls
     ORDER BY created_at DESC
     LIMIT 100`
  );
  res.json(result.rows.map(row => ({
    id: row.id,
    table: row.table_name,
    guestCount: row.guest_count,
    status: row.status,
    timestamp: row.created_at
  })));
});

app.patch('/api/admin/waiter-calls/:id', requireAdmin, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return sendError(res, 400, 'Chaqiruv identifikatori noto‘g‘ri.');
  }
  const result = await pool.query(
    `UPDATE waiter_calls SET status = 'bajarildi'
     WHERE id = $1 AND status = 'kutilmoqda'
     RETURNING id, status`,
    [req.params.id]
  );
  if (result.rowCount === 0) return sendError(res, 404, 'Faol chaqiruv topilmadi.');
  res.json(result.rows[0]);
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!orderStatuses.has(status)) return sendError(res, 400, 'Buyurtma holati noto‘g‘ri.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return sendError(res, 400, 'Buyurtma identifikatori noto‘g‘ri.');
  }

  const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id', [status, req.params.id]);
  if (result.rowCount === 0) return sendError(res, 404, 'Buyurtma topilmadi.');
  res.json({ id: result.rows[0].id, status });
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  let product;
  try {
    product = validateProduct(req.body);
  } catch (error) {
    if (error instanceof ValidationError) return sendError(res, 400, error.message);
    throw error;
  }

  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO products
       (id, name, category, price, stock, status, image, description, badge, is_chef_special)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [id, product.name, product.category, product.price, product.stock, product.status,
      product.image, product.description, product.badge, product.isChefSpecial]
  );
  res.status(201).json(serializeProduct(result.rows[0]));
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  let product;
  try {
    product = validateProduct(req.body);
  } catch (error) {
    if (error instanceof ValidationError) return sendError(res, 400, error.message);
    throw error;
  }

  const result = await pool.query(
    `UPDATE products
     SET name = $1, category = $2, price = $3, stock = $4, status = $5,
         image = $6, description = $7, badge = $8, is_chef_special = $9, updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [product.name, product.category, product.price, product.stock, product.status,
      product.image, product.description, product.badge, product.isChefSpecial, req.params.id]
  );
  if (result.rowCount === 0) return sendError(res, 404, 'Mahsulot topilmadi.');
  res.json(serializeProduct(result.rows[0]));
});

app.patch('/api/admin/products/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['mavjud', 'tugadi'].includes(status)) return sendError(res, 400, 'Mahsulot holati noto‘g‘ri.');

  const result = await pool.query(
    `UPDATE products
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND ($1 = 'tugadi' OR stock > 0)
     RETURNING *`,
    [status, req.params.id]
  );
  if (result.rowCount === 0) return sendError(res, 409, 'Mahsulot topilmadi yoki qoldig‘i mavjud emas.');
  res.json(serializeProduct(result.rows[0]));
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return sendError(res, 404, 'Mahsulot topilmadi.');
  res.status(204).end();
});

app.post('/api/orders', async (req, res) => {
  if (isRateLimited(publicOrderAttempts, req.ip, 30, 15 * 60 * 1000)) {
    return sendError(res, 429, 'Qisqa vaqtda juda ko‘p buyurtma yuborildi. Keyinroq urinib ko‘ring.');
  }
  const idempotencyKey = req.get('Idempotency-Key');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey || '')) {
    return sendError(res, 400, 'Buyurtma so‘rovi kaliti noto‘g‘ri.');
  }

  let orderInput;
  try {
    orderInput = validateOrder(req.body);
  } catch (error) {
    if (error instanceof ValidationError) return sendError(res, 400, error.message);
    throw error;
  }
  const { table, guestCount, notes, paymentMethod, quantities } = orderInput;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO order_idempotency_keys (request_key) VALUES ($1) ON CONFLICT DO NOTHING',
      [idempotencyKey]
    );
    const previousOrder = await client.query('SELECT id FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
    if (previousOrder.rowCount) {
      const order = await getOrderById(client, previousOrder.rows[0].id);
      await client.query('COMMIT');
      res.status(200).json(order);
      return;
    }

    const lockedProducts = [];
    for (const [productId, quantity] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const result = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const product = result.rows[0];
      if (!product || product.status !== 'mavjud' || product.stock < quantity) {
        await client.query('ROLLBACK');
        return sendError(res, 409, `${product?.name || 'Mahsulot'} uchun qoldiq yetarli emas. Menyuni yangilang.`);
      }
      lockedProducts.push({ product, quantity });
    }

    const subtotal = lockedProducts.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 2000000000) {
      await client.query('ROLLBACK');
      return sendError(res, 400, 'Buyurtmaning jami summasi ruxsat etilgan chegaradan oshdi.');
    }
    const serviceFee = Math.round(subtotal * 0.1);
    const orderId = crypto.randomUUID();
    await client.query(
      `INSERT INTO orders
         (id, idempotency_key, table_name, guest_count, status, notes, payment_method, subtotal, service_fee, total)
       VALUES ($1, $2, $3, $4, 'yangi', $5, $6, $7, $8, $9)`,
      [orderId, idempotencyKey, table, guestCount, notes, paymentMethod, subtotal, serviceFee, subtotal + serviceFee]
    );

    for (const { product, quantity } of lockedProducts) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES ($1, $2, $3, $4, $5)',
        [orderId, product.id, product.name, product.price, quantity]
      );
      const newStock = product.stock - quantity;
      await client.query(
        'UPDATE products SET stock = $1, status = $2, updated_at = NOW() WHERE id = $3',
        [newStock, newStock === 0 ? 'tugadi' : product.status, product.id]
      );
    }

    const order = await getOrderById(client, orderId);
    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/orders/:id/status', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return sendError(res, 400, 'Buyurtma identifikatori noto‘g‘ri.');
  }
  const result = await pool.query(
    `SELECT 'SMV-' || order_number::text AS order_number, status
     FROM orders WHERE id = $1`,
    [req.params.id]
  );
  if (result.rowCount === 0) return sendError(res, 404, 'Buyurtma topilmadi.');
  res.json({ orderNumber: result.rows[0].order_number, status: result.rows[0].status });
});

app.post('/api/waiter-calls', async (req, res) => {
  if (isRateLimited(publicOrderAttempts, `waiter:${req.ip}`, 20, 15 * 60 * 1000)) {
    return sendError(res, 429, 'Qisqa vaqtda juda ko‘p chaqiruv yuborildi. Keyinroq urinib ko‘ring.');
  }
  let call;
  try {
    call = validateWaiterCall(req.body);
  } catch (error) {
    if (error instanceof ValidationError) return sendError(res, 400, error.message);
    throw error;
  }
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO waiter_calls (id, table_name, guest_count)
     VALUES ($1, $2, $3)
     RETURNING id, table_name, guest_count, status, created_at`,
    [id, call.table, call.guestCount]
  );
  res.status(201).json({
    id: result.rows[0].id,
    table: result.rows[0].table_name,
    guestCount: result.rows[0].guest_count,
    status: result.rows[0].status,
    timestamp: result.rows[0].created_at
  });
});

async function getOrderById(queryable, id) {
  const orders = await getOrdersById(queryable, id);
  return orders[0] || null;
}

async function getOrdersById(queryable, id) {
  const result = await queryable.query(
    `SELECT o.id, 'SMV-' || o.order_number::text AS order_number,
            o.table_name, o.guest_count, o.created_at, o.status, o.notes,
            o.payment_method, o.service_fee_percent, o.subtotal, o.service_fee, o.total,
            COALESCE(
              json_agg(json_build_object(
                'id', oi.product_id, 'name', oi.name, 'price', oi.price, 'quantity', oi.quantity
              ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
              '[]'::json
            ) AS items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [id]
  );
  return result.rows.map(serializeOrder);
}

app.use(express.static(distDirectory));
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDirectory, 'index.html'), error => {
    if (error) next(error);
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.status >= 400 && error.status < 500) {
    return sendError(res, error.status, 'So‘rov ma’lumotlari noto‘g‘ri.');
  }
  return sendError(res, 500, 'Serverda kutilmagan xatolik yuz berdi.');
});

async function start() {
  const schema = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
  const seed = await fs.readFile(path.join(here, 'seed.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(seed);
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');

  const port = Number(process.env.PORT || process.env.API_PORT) || 3001;
  const server = app.listen(port, () => {
    console.log(`Samovar API http://localhost:${port} manzilida ishlayapti.`);
  });
  server.on('error', async error => {
    console.error('API serverini tinglab bo‘lmadi:', error);
    await pool.end();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => pool.end());
    });
  }
}

start().catch(async error => {
  console.error('API ishga tushmadi:', error);
  await pool.end();
  process.exitCode = 1;
});
