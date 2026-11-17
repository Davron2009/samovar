CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  status TEXT NOT NULL CHECK (status IN ('mavjud', 'tugadi')),
  image TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  badge TEXT,
  is_chef_special BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  idempotency_key UUID UNIQUE,
  order_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  table_name TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 20),
  status TEXT NOT NULL CHECK (status IN ('yangi', 'tayyorlanmoqda', 'yetkazildi', 'tolandi')),
  notes TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  service_fee_percent INTEGER NOT NULL DEFAULT 10 CHECK (service_fee_percent = 10),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  service_fee INTEGER NOT NULL CHECK (service_fee >= 0),
  total INTEGER NOT NULL CHECK (total = subtotal + service_fee),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_idempotency_keys (
  request_key UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waiter_calls (
  id UUID PRIMARY KEY,
  table_name TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'kutilmoqda' CHECK (status IN ('kutilmoqda', 'bajarildi')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS waiter_calls_created_at_idx ON waiter_calls (created_at DESC);
