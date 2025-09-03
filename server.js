import express from "express";
import cors from "cors";
import pkg from "pg";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cards as seedCards } from "./src/data/cards.js";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_hOa2GTSD5BmQ@ep-ancient-cloud-a2ycqvve-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

// Настройки JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Создание таблицы пользователей при запуске
async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_l1 TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_l2 TEXT`);
}
ensureUsersTable().catch((e) => console.error("ensureUsersTable error", e));

// Примечание: таблица `cards` более не используется (перешли на SRS: user_cards + vocab_*).

// Базовая инициализация языков
async function ensureLanguagesSeed() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS languages (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);
    await pool.query(
      `INSERT INTO languages(code, name) VALUES
        ('en','English'),
        ('ru','Русский'),
        ('es','Español'),
        ('de','Deutsch'),
        ('fr','Français'),
        ('it','Italiano'),
        ('pt','Português')
       ON CONFLICT (code) DO NOTHING`
    );
  } catch (e) {
    console.error('ensureLanguagesSeed error', e);
  }
}
ensureLanguagesSeed();

// JWT middleware
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Неверный или истекший токен" });
  }
}

// Маршруты авторизации
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email и password обязательны" });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, preferred_l1, preferred_l2",
      [email, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Пользователь уже существует" });
    }
    console.error("/api/auth/register error", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email и password обязательны" });
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Неверные учетные данные" });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Неверные учетные данные" });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, email: user.email, preferred_l1: user.preferred_l1, preferred_l2: user.preferred_l2 } });
  } catch (e) {
    console.error("/api/auth/login error", e);
    res.status(500).json({ error: e.message });
  }
});

// Получить карточки текущего пользователя (из SRS user_cards + vocab)
app.get("/api/cards", requireAuth, async (req, res) => {
  try {
    const L1 = (req.query?.l1 || 'ru').toString(); // язык перевода
    const L2 = (req.query?.l2 || 'en').toString(); // язык слова
    const sql = `
      SELECT uc.id,
             vi.text AS front,
             COALESCE(vt.meaning, '') AS back,
             uc.reps AS know_count,
             uc.due   AS next_due,
             CASE WHEN uc.state = 'learning' THEN 'learn'
                  WHEN uc.reps >= 5 THEN 'learned'
                  ELSE 'know' END AS status
        FROM user_cards uc
        JOIN vocab_items vi ON vi.id = uc.vocab_id
   LEFT JOIN vocab_translations vt
               ON vt.vocab_id = vi.id AND vt.lang_code = $2
       WHERE uc.user_id = $1 AND vi.lang_code = $3
       ORDER BY vi.text`;
    const result = await pool.query(sql, [req.user.userId, L1, L2]);
    res.json(result.rows);
  } catch (e) {
    console.error("GET /api/cards error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Добавить карточку (создание vocab + перевода + user_card)
app.post("/api/cards", requireAuth, async (req, res) => {
  try {
    const L2 = (req.query?.l2 || req.body?.l2 || 'en').toString();
    const L1 = (req.query?.l1 || req.body?.l1 || 'ru').toString();
    const { front, back } = req.body;
    await pool.query('BEGIN');
    const upsertVocab = await pool.query(
      `INSERT INTO vocab_items (text, lang_code) VALUES ($1, $2)
       ON CONFLICT (lang_code, text) DO UPDATE SET text = EXCLUDED.text
       RETURNING id`,
      [front, L2]
    );
    const vocabId = upsertVocab.rows[0].id;
    await pool.query(
      `INSERT INTO vocab_translations (vocab_id, lang_code, meaning)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [vocabId, L1, back]
    );
    const uc = await pool.query(
      `INSERT INTO user_cards (user_id, vocab_id, card_type, state)
       VALUES ($1, $2, 'L2_TO_L1', 'learning')
       ON CONFLICT (user_id, vocab_id, card_type) DO UPDATE SET state = 'learning'
       RETURNING id, reps AS know_count, due AS next_due, state`,
      [req.user.userId, vocabId]
    );
    await pool.query('COMMIT');

    const row = uc.rows[0];
    res.json({
      id: row.id,
      front,
      back,
      status: row.state === 'learning' ? 'learn' : (row.know_count >= 5 ? 'learned' : 'know'),
      know_count: row.know_count || 0,
      next_due: row.next_due || null,
    });
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('POST /api/cards error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.use((req, _res, next) => {
  console.log(req.method, req.url);
  next();
});

// Список языков из БД (публично)
app.get("/api/languages", async (_req, res) => {
  try {
    const result = await pool.query("SELECT code, name FROM languages ORDER BY name");
    res.json(result.rows);
  } catch (e) {
    console.error("GET /api/languages error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Профиль пользователя: получить/обновить предпочитаемые языки
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const row = (await pool.query('SELECT id, email, preferred_l1, preferred_l2 FROM users WHERE id=$1', [req.user.userId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/me', requireAuth, async (req, res) => {
  try {
    const { preferred_l1, preferred_l2 } = req.body || {};
    const row = (await pool.query(
      'UPDATE users SET preferred_l1=$2, preferred_l2=$3 WHERE id=$1 RETURNING id, email, preferred_l1, preferred_l2',
      [req.user.userId, preferred_l1 || null, preferred_l2 || null]
    )).rows[0];
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Админ: добавить язык
app.post("/api/languages", requireAuth, async (req, res) => {
  try {
    const adminIdEnv = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
    if (adminIdEnv && req.user.userId !== adminIdEnv) return res.status(403).json({ error: 'Forbidden' });
    const { code, name } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code и name обязательны' });
    const result = await pool.query(
      `INSERT INTO languages(code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING code, name`,
      [code, name]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error("POST /api/languages error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Админ: переименовать язык
app.put("/api/languages/:code", requireAuth, async (req, res) => {
  try {
    const adminIdEnv = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
    if (adminIdEnv && req.user.userId !== adminIdEnv) return res.status(403).json({ error: 'Forbidden' });
    const { code } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name обязателен' });
    const result = await pool.query(
      `UPDATE languages SET name = $2 WHERE code = $1 RETURNING code, name`,
      [code, name]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Язык не найден' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("PUT /api/languages/:code error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Админ: удалить язык
app.delete("/api/languages/:code", requireAuth, async (req, res) => {
  try {
    const adminIdEnv = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
    if (adminIdEnv && req.user.userId !== adminIdEnv) return res.status(403).json({ error: 'Forbidden' });
    const { code } = req.params;
    const result = await pool.query(`DELETE FROM languages WHERE code = $1 RETURNING code`, [code]);
    if (!result.rows.length) return res.status(404).json({ error: 'Язык не найден' });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/languages/:code error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Удалить карточку (удаляет user_card для пользователя)
app.delete("/api/cards/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // UUID user_cards.id
    const deleted = await pool.query(
      `DELETE FROM user_cards WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, req.user.userId]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ error: "Карточка не найдена" });
    }
    res.json({ ok: true, deleted: { id } });
  } catch (e) {
    console.error("DELETE /api/cards error:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- Static serving for production build ---
import path from "node:path";
import fs from "node:fs";
const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res, next) => {
    // avoid intercepting API routes
    if (_req.path.startsWith("/api") || _req.path.startsWith("/admin")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const PORT = Number(process.env.PORT || 5000);
// On Vercel, we export the app for Serverless Functions and do not call listen()
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export default app;
// Обновить карточку (редактирование текста и перевода по user_card)
app.put("/api/cards/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // user_cards.id
    const { front, back } = req.body;

    if (!front || !back) {
      return res.status(400).json({ error: "front и back обязательны" });
    }

    await pool.query('BEGIN');
    const L1 = (req.query?.l1 || req.body?.l1 || 'ru').toString();
    // Найти карточку и vocab_id
    const uc = await pool.query(
      `SELECT uc.vocab_id FROM user_cards uc WHERE uc.id = $1 AND uc.user_id = $2`,
      [id, req.user.userId]
    );
    if (uc.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Карточка не найдена' });
    }
    const vocabId = uc.rows[0].vocab_id;
    await pool.query(`UPDATE vocab_items SET text = $1 WHERE id = $2`, [front, vocabId]);
    await pool.query(
      `INSERT INTO vocab_translations (vocab_id, lang_code, meaning)
       VALUES ($1, $2, $3)
       ON CONFLICT (vocab_id, lang_code, meaning) DO NOTHING`,
      [vocabId, L1, back]
    );
    // Если существует другой перевод на тот же язык, можно обновить до нового "back"
    await pool.query(
      `UPDATE vocab_translations SET meaning = $3 WHERE vocab_id = $1 AND lang_code = $2`,
      [vocabId, L1, back]
    );
    await pool.query('COMMIT');

    // Вернуть как в GET
    const row = (await pool.query(
      `SELECT uc.id, vi.text AS front, COALESCE(vt.meaning,'') AS back,
              uc.reps AS know_count, uc.due AS next_due,
              CASE WHEN uc.state = 'learning' THEN 'learn'
                   WHEN uc.reps >= 5 THEN 'learned' ELSE 'know' END AS status
         FROM user_cards uc
         JOIN vocab_items vi ON vi.id = uc.vocab_id
    LEFT JOIN vocab_translations vt ON vt.vocab_id = vi.id AND vt.lang_code = $3
        WHERE uc.id = $1 AND uc.user_id = $2`,
      [id, req.user.userId, L1]
    )).rows[0];
    res.json(row);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Обновить прогресс/статус карточки в SRS
app.post("/api/cards/:id/progress", requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // user_cards.id
    const { status, knowCount, nextDue } = req.body || {};
    const state = status === 'learn' ? 'learning' : 'review';
    const dueValue = (nextDue === null || nextDue === undefined) ? null : new Date(Number(nextDue));
    const result = await pool.query(
      `UPDATE user_cards
          SET state = $1,
              reps = $2,
              due = $3,
              updated_at = now()
        WHERE id = $4 AND user_id = $5
        RETURNING id, state, reps, due`,
      [state, knowCount ?? 0, dueValue, id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Карточка не найдена" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("POST /api/cards/:id/progress error", e);
    res.status(500).json({ error: e.message });
  }
});

// Импорт стартовых карточек пользователю (если у него пока нет карточек)
app.post("/api/cards/migrate", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const L2 = (req.query?.l2 || 'en').toString();
    const L1 = (req.query?.l1 || 'ru').toString();
    // Если у пользователя уже есть user_cards — не импортируем повторно
    const existing = await pool.query("SELECT COUNT(*)::int AS cnt FROM user_cards WHERE user_id = $1", [userId]);
    if (existing.rows[0].cnt > 0) {
      return res.json({ imported: 0, message: "У пользователя уже есть карточки" });
    }
    await pool.query('BEGIN');
    let imported = 0;
    for (const c of seedCards) {
      // upsert vocab
      const v = await pool.query(
        `INSERT INTO vocab_items (text, lang_code) VALUES ($1, $2)
         ON CONFLICT (lang_code, text) DO UPDATE SET text = EXCLUDED.text
         RETURNING id`,
        [c.front, L2]
      );
      const vocabId = v.rows[0].id;
      // ensure translation
      await pool.query(
        `INSERT INTO vocab_translations (vocab_id, lang_code, meaning)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [vocabId, L1, c.back]
      );
      // upsert user_card
      const uc = await pool.query(
        `INSERT INTO user_cards (user_id, vocab_id, card_type, state)
         VALUES ($1, $2, 'L2_TO_L1', 'learning')
         ON CONFLICT (user_id, vocab_id, card_type) DO NOTHING
         RETURNING id`,
        [userId, vocabId]
      );
      if (uc.rows.length) imported += 1;
    }
    await pool.query('COMMIT');
    res.json({ imported });
  } catch (e) {
    await pool.query('ROLLBACK').catch(()=>{});
    console.error("/api/cards/migrate error", e);
    res.status(500).json({ error: e.message });
  }
});

// Execute raw SQL files for SRS (schema + migration)
app.post('/admin/srs/init', requireAuth, async (req, res) => {
  try {
    // Admin guard: if ADMIN_USER_ID is set, enforce it; otherwise allow any authenticated user
    const adminIdEnv = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
    if (adminIdEnv && req.user.userId !== adminIdEnv) return res.status(403).json({ error: 'Forbidden' });
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const base = path.resolve(process.cwd(), 'sql');
    const schemaSql = await fs.readFile(path.join(base, 'srs_schema.sql'), 'utf8');
    await pool.query(schemaSql);
    // Optional migration from existing `cards`
    const migratePath = path.join(base, 'migrate_from_cards.sql');
    try {
      const migrateSql = await fs.readFile(migratePath, 'utf8');
      await pool.query(migrateSql);
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    console.error('/admin/srs/init error', e);
    res.status(500).json({ error: e.message });
  }
});