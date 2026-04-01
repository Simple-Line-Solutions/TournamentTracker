-- Schema inicial para PostgreSQL
-- Reemplaza las 012 migraciones incrementales de SQLite

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'asistente', 'superadmin', 'Player')),
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'finalizado', 'cancelado')),
  planned_pairs INTEGER NOT NULL DEFAULT 0 CHECK (planned_pairs >= 0),
  tipo_torneo TEXT NOT NULL CHECK (tipo_torneo IN ('americano', 'largo')),
  match_format TEXT NOT NULL CHECK (match_format IN ('one_set', 'best_of_3', 'best_of_3_super_tb')),
  clasifican_de_zona_3 INTEGER NOT NULL DEFAULT 2,
  clasifican_de_zona_4 INTEGER NOT NULL DEFAULT 3,
  zonas_generadas BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('Caballeros', 'Damas')),
  number INTEGER NOT NULL,
  ordinal TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (type, number, ordinal, code) VALUES
  ('Caballeros', 2, '2da', 'C2'),
  ('Caballeros', 3, '3ra', 'C3'),
  ('Caballeros', 4, '4ta', 'C4'),
  ('Caballeros', 5, '5ta', 'C5'),
  ('Caballeros', 6, '6ta', 'C6'),
  ('Caballeros', 7, '7ma', 'C7'),
  ('Caballeros', 8, '8va', 'C8'),
  ('Damas', 2, '2da', 'D2'),
  ('Damas', 3, '3ra', 'D3'),
  ('Damas', 4, '4ta', 'D4'),
  ('Damas', 5, '5ta', 'D5'),
  ('Damas', 6, '6ta', 'D6'),
  ('Damas', 7, '7ma', 'D7'),
  ('Damas', 8, '8va', 'D8')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  telefono TEXT NOT NULL,
  dni TEXT UNIQUE,
  email TEXT UNIQUE,
  category_id INTEGER,
  fecha_nacimiento TEXT,
  ranking_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE(nombre, apellido, telefono)
);

CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_category_id ON players(category_id);
CREATE INDEX IF NOT EXISTS idx_players_dni ON players(dni);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);

CREATE TABLE IF NOT EXISTS pairs (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  group_id INTEGER,
  seed_rank INTEGER,
  presente BOOLEAN,
  presente_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pair_players (
  id SERIAL PRIMARY KEY,
  pair_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  player_num INTEGER NOT NULL CHECK (player_num IN (1,2)),
  FOREIGN KEY (pair_id) REFERENCES pairs(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE(pair_id, player_num),
  UNIQUE(pair_id, player_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  pair_id INTEGER NOT NULL,
  player_num INTEGER NOT NULL CHECK (player_num IN (1,2)),
  estado TEXT NOT NULL CHECK (estado IN ('sin_pago', 'parcial', 'pagado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (pair_id) REFERENCES pairs(id) ON DELETE CASCADE,
  UNIQUE(tournament_id, pair_id, player_num)
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  payment_method_id INTEGER NOT NULL,
  monto NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
);

CREATE TABLE IF NOT EXISTS tournament_payment_methods (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  payment_method_id INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE,
  UNIQUE(tournament_id, payment_method_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size IN (3,4)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('zona','eliminatoria')),
  round TEXT,
  group_id INTEGER,
  pair1_id INTEGER,
  pair2_id INTEGER,
  slot1_source_match_id INTEGER,
  slot2_source_match_id INTEGER,
  set1_pair1 INTEGER,
  set1_pair2 INTEGER,
  set2_pair1 INTEGER,
  set2_pair2 INTEGER,
  supertb_pair1 INTEGER,
  supertb_pair2 INTEGER,
  winner_id INTEGER,
  is_bye BOOLEAN NOT NULL DEFAULT FALSE,
  is_wo BOOLEAN NOT NULL DEFAULT FALSE,
  court_id INTEGER,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (pair1_id) REFERENCES pairs(id),
  FOREIGN KEY (pair2_id) REFERENCES pairs(id),
  FOREIGN KEY (winner_id) REFERENCES pairs(id)
);

CREATE TABLE IF NOT EXISTS group_standings (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL,
  pair_id INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  games_lost INTEGER NOT NULL DEFAULT 0,
  position INTEGER,
  position_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (pair_id) REFERENCES pairs(id) ON DELETE CASCADE,
  UNIQUE(group_id, pair_id)
);

CREATE TABLE IF NOT EXISTS courts (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  identificador TEXT NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE(tournament_id, identificador)
);

CREATE TABLE IF NOT EXISTS court_queue (
  id SERIAL PRIMARY KEY,
  court_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL UNIQUE,
  orden INTEGER NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS global_clubs (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_courts (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  club TEXT,
  club_id INTEGER REFERENCES global_clubs(id),
  UNIQUE(nombre, club_id)
);

CREATE TABLE IF NOT EXISTS ranking_config (
  id SERIAL PRIMARY KEY,
  instancia TEXT NOT NULL,
  puntos INTEGER NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ranking_history (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  tournament_id INTEGER NOT NULL,
  instancia TEXT NOT NULL,
  puntos_ganados INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
