-- AvtoStoyanka bazasi. init-db.js ishga tushiradi (qayta ishga tushirsa — tozadan yaratadi).
DROP TABLE IF EXISTS sessions, spots, users, settings, staff, expenses, kv CASCADE;

-- Profillar: admin va qorovullar
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'guard')),
  active BOOLEAN NOT NULL DEFAULT true
);

-- Joylar: 5 zona × 40 = 200
CREATE TABLE spots (
  id SERIAL PRIMARY KEY,
  label TEXT UNIQUE NOT NULL,
  zone CHAR(1) NOT NULL,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  is_busy BOOLEAN NOT NULL DEFAULT false,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  is_accessible BOOLEAN NOT NULL DEFAULT false -- nogironlar uchun joy
);

-- Sessiyalar = cheklar arxivi
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  spot_id INTEGER NOT NULL REFERENCES spots(id),
  plate TEXT NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  fee INTEGER,
  guard_in INTEGER REFERENCES users(id),
  guard_out INTEGER REFERENCES users(id),
  ticket_no TEXT UNIQUE,  -- kirish cheki (QR)
  receipt_no TEXT UNIQUE, -- chiqish cheki (QZ- = to'lanmagan, haydalgan)
  paid BOOLEAN NOT NULL DEFAULT true,
  disabled_driver BOOLEAN NOT NULL DEFAULT false -- nogironlik guvohnomasi: bepul
);
-- Bitta joyda faqat bitta ochiq sessiya
CREATE UNIQUE INDEX one_open_session ON sessions(spot_id) WHERE left_at IS NULL;
CREATE INDEX sessions_left_at ON sessions(left_at);

-- Tarif
CREATE TABLE settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO settings VALUES ('base_hour', 5000), ('step_hour', 1000), ('premium_hour', 30000);

INSERT INTO spots (label, zone, is_premium)
SELECT z || '-' || lpad(n::text, 2, '0'), z, z = 'A'
FROM unnest(ARRAY['A','B','C','D','E']) AS z, generate_series(1, 40) AS n
ORDER BY z, n;
