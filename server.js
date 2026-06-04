/*
╔══════════════════════════════════════════════════╗
║       ZICH PANEL — NODE.JS BACKEND API           ║
║                                                  ║
║  DEPLOY SA RAILWAY.APP (libre):                  ║
║  1. Gumawa ng account sa railway.app             ║
║  2. New Project → Deploy from GitHub             ║
║  3. I-upload ang folder na ito sa GitHub         ║
║  4. Kumuha ng URL (e.g. zich.up.railway.app)     ║
║  5. Ilagay ang URL sa panel HTML at Lua script   ║
╚══════════════════════════════════════════════════╝
*/

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── DATABASE SETUP (SQLite — no config needed) ──
const db = new Database(path.join(__dirname, 'zich_panel.db'));

// Auto-create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    role      TEXT DEFAULT 'member',
    points    INTEGER DEFAULT 1000,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keys_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    license_key TEXT NOT NULL,
    game        TEXT DEFAULT 'CODMGR',
    days        INTEGER NOT NULL,
    cost        INTEGER NOT NULL,
    devices     INTEGER DEFAULT 1,
    status      TEXT DEFAULT 'active',
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// ── CREATE DEFAULT OWNER (sich / zich123) if not exists ──
const existing = db.prepare("SELECT id FROM users WHERE username = 'zich'").get();
if (!existing) {
  const hash = bcrypt.hashSync('zich123', 10);
  db.prepare("INSERT INTO users (username, password, role, points) VALUES ('zich', ?, 'owner', 99999999999)").run(hash);
  console.log('✅ Default owner created: zich / zich123');
}

// ═══════════════════════════════════════
// HELPER
// ═══════════════════════════════════════
function ok(res, data = {})   { res.json({ success: true,  ...data }); }
function err(res, msg, code = 200) { res.json({ success: false, message: msg }); }

// ═══════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ZICH PANEL API running ✅', version: '2.0' });
});

// ─────────────────────────────
// LOGIN
// ─────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return err(res, 'Fill in all fields');

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());
  if (!user) return err(res, 'Invalid username or password');

  const match = bcrypt.compareSync(password, user.password);
  if (!match) return err(res, 'Invalid username or password');

  ok(res, {
    message: 'Login successful',
    user: {
      id:       user.id,
      username: user.username,
      role:     user.role,
      points:   user.points
    }
  });
});

// ─────────────────────────────
// REGISTER
// ─────────────────────────────
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)   return err(res, 'Fill in all fields');
  if (username.trim().length < 4) return err(res, 'Username min 4 characters');
  if (password.length < 6)      return err(res, 'Password min 6 characters');

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
  if (exists) return err(res, 'Username already taken');

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users (username, password, role, points) VALUES (?, ?, 'member', 1000)").run(username.trim(), hash);

  ok(res, { message: 'Account created! You can now login.' });
});

// ─────────────────────────────
// GET USER INFO
// ─────────────────────────────
app.post('/api/get_user', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return err(res, 'Invalid user ID');

  const user = db.prepare("SELECT id, username, role, points FROM users WHERE id = ?").get(user_id);
  user ? ok(res, { user }) : err(res, 'User not found');
});

// ─────────────────────────────
// GENERATE KEY (deduct + save)
// ─────────────────────────────
app.post('/api/generate_key', (req, res) => {
  const { user_id, key, game, days, cost, devices } = req.body;
  if (!user_id || !key || !days || !cost) return err(res, 'Invalid parameters');

  const user = db.prepare("SELECT points FROM users WHERE id = ?").get(user_id);
  if (!user) return err(res, 'User not found');
  if (user.points < cost) return err(res, 'Not enough points');

  // Deduct points
  db.prepare("UPDATE users SET points = points - ? WHERE id = ?").run(cost, user_id);

  // Save key
  db.prepare("INSERT INTO keys_log (user_id, license_key, game, days, cost, devices) VALUES (?, ?, ?, ?, ?, ?)")
    .run(user_id, key, game || 'CODMGR', days, cost, devices || 1);

  const updated = db.prepare("SELECT points FROM users WHERE id = ?").get(user_id);
  ok(res, { message: 'Key generated', new_points: updated.points });
});

// ─────────────────────────────
// GET KEY HISTORY
// ─────────────────────────────
app.post('/api/get_keys', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return err(res, 'Invalid user ID');

  const keys = db.prepare("SELECT * FROM keys_log WHERE user_id = ? ORDER BY created_at DESC").all(user_id);
  ok(res, { keys });
});

// ─────────────────────────────
// VERIFY KEY
// ─────────────────────────────
app.post('/api/verify_key', (req, res) => {
  const { key } = req.body;
  if (!key) return err(res, 'Key required');

  const row = db.prepare(`
    SELECT k.*, u.username FROM keys_log k
    JOIN users u ON k.user_id = u.id
    WHERE k.license_key = ?
  `).get(key.toUpperCase().trim());

  ok(res, row
    ? { valid: true,  data: row }
    : { valid: false, message: 'Key not found' }
  );
});

// ─────────────────────────────
// ADD POINTS (admin only)
// ─────────────────────────────
app.post('/api/add_points', (req, res) => {
  const { admin_user_id, target_username, amount } = req.body;
  if (!admin_user_id || !target_username || !amount) return err(res, 'Invalid parameters');

  const admin = db.prepare("SELECT role FROM users WHERE id = ?").get(admin_user_id);
  if (!admin || admin.role !== 'owner') return err(res, 'Unauthorized');

  const target = db.prepare("SELECT id FROM users WHERE username = ?").get(target_username);
  if (!target) return err(res, 'User not found');

  db.prepare("UPDATE users SET points = points + ? WHERE username = ?").run(amount, target_username);
  ok(res, { message: `Added ${amount} points to ${target_username}` });
});

// ─────────────────────────────
// LIST USERS (admin only)
// ─────────────────────────────
app.post('/api/list_users', (req, res) => {
  const { admin_user_id } = req.body;
  const admin = db.prepare("SELECT role FROM users WHERE id = ?").get(admin_user_id);
  if (!admin || admin.role !== 'owner') return err(res, 'Unauthorized');

  const users = db.prepare("SELECT id, username, role, points, created_at FROM users ORDER BY created_at DESC").all();
  ok(res, { users });
});

// ── START SERVER ──
app.listen(PORT, () => {
  console.log(`🚀 ZICH PANEL API running on port ${PORT}`);
});
