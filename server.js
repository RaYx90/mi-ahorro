const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { Pool, types } = require('pg');

// Devolver DATE y TIMESTAMPTZ como strings (no objetos Date) para compatibilidad con el frontend
types.setTypeParser(1082, val => val); // DATE
types.setTypeParser(1114, val => val); // TIMESTAMP
types.setTypeParser(1184, val => val); // TIMESTAMPTZ

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

// Categorías válidas (sincronizadas con el frontend)
const VALID_CATEGORIES = [
    'salary', 'bonus', 'investment', 'hucha', 'other_in',
    'food', 'home', 'transport', 'health', 'leisure', 'restaurant', 'bills', 'other_out'
];
const VALID_TYPES = ['income', 'expense'];

// ── Seguridad ──────────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
        }
    }
}));

// Confiar en Caddy reverse proxy para X-Forwarded-Proto
app.set('trust proxy', 1);

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días (se renueva con cada petición)
    }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting login ─────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos
    message: { error: 'Demasiados intentos. Espera 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Base de datos ──────────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/miahorro'
});

async function initDb() {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        amount NUMERIC(12,2) NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS investments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        capital NUMERIC(12,2) NOT NULL,
        monthly_return NUMERIC(12,2) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
}

initDb().catch(err => { console.error('Error inicializando BD:', err); process.exit(1); });

// ── Middlewares ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: 'No autorizado' });
}

function validateTransaction(body, partial = false) {
    const { type, amount, description, category, date } = body;
    const errors = [];

    if (!partial || type !== undefined) {
        if (!VALID_TYPES.includes(type)) errors.push('type inválido');
    }
    if (!partial || amount !== undefined) {
        const amt = parseFloat(amount);
        if (!Number.isFinite(amt) || amt <= 0) errors.push('amount debe ser un número positivo');
    }
    if (!partial || description !== undefined) {
        if (!description || typeof description !== 'string' || description.trim().length === 0)
            errors.push('description requerida');
        if (description && description.trim().length > 200)
            errors.push('description máximo 200 caracteres');
    }
    if (!partial || category !== undefined) {
        if (!VALID_CATEGORIES.includes(category)) errors.push('category inválida');
    }
    if (!partial || date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)))
            errors.push('date inválida (formato YYYY-MM-DD)');
    }
    return errors;
}

// ── Auth endpoints ─────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(401).json({ error: 'Usuario y contraseña requeridos' });
    }

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ ok: true, username: user.username });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// ── API transactions (protegida) ───────────────────────────────────────────────
app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM transactions ORDER BY date DESC, id DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/transactions', requireAuth, async (req, res) => {
    const errors = validateTransaction(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const { type, amount, description, category, date } = req.body;
    try {
        const { rows } = await pool.query(
            'INSERT INTO transactions (type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [type, parseFloat(amount), description.trim(), category, date]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.put('/api/transactions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const errors = validateTransaction(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const { type, amount, description, category, date } = req.body;
    const updates = [], params = [];
    let idx = 1;
    if (type !== undefined) { updates.push(`type = $${idx++}`); params.push(type); }
    if (amount !== undefined) { updates.push(`amount = $${idx++}`); params.push(parseFloat(amount)); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description.trim()); }
    if (category !== undefined) { updates.push(`category = $${idx++}`); params.push(category); }
    if (date !== undefined) { updates.push(`date = $${idx++}`); params.push(date); }
    if (!updates.length) return res.status(400).json({ error: 'Sin datos para actualizar' });

    params.push(id);
    try {
        const { rows } = await pool.query(
            `UPDATE transactions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    try {
        const { rowCount } = await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ── API investments (protegida) ────────────────────────────────────────────────
function validateInvestment(body) {
    const { name, capital, monthly_return, start_date, end_date } = body;
    const errors = [];
    if (!name || typeof name !== 'string' || name.trim().length === 0) errors.push('name requerido');
    if (name && name.trim().length > 100) errors.push('name máximo 100 caracteres');
    const cap = parseFloat(capital);
    if (!Number.isFinite(cap) || cap <= 0) errors.push('capital debe ser un número positivo');
    const ret = parseFloat(monthly_return);
    if (!Number.isFinite(ret) || ret < 0) errors.push('monthly_return debe ser >= 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || isNaN(Date.parse(start_date))) errors.push('start_date inválida');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date) || isNaN(Date.parse(end_date))) errors.push('end_date inválida');
    if (start_date && end_date && start_date >= end_date) errors.push('end_date debe ser posterior a start_date');
    return errors;
}

app.get('/api/investments', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM investments ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/investments', requireAuth, async (req, res) => {
    const errors = validateInvestment(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });
    const { name, capital, monthly_return, start_date, end_date, notes } = req.body;
    try {
        const { rows } = await pool.query(
            'INSERT INTO investments (name, capital, monthly_return, start_date, end_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name.trim(), parseFloat(capital), parseFloat(monthly_return), start_date, end_date, (notes || '').trim()]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.put('/api/investments/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const errors = validateInvestment(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });
    const { name, capital, monthly_return, start_date, end_date, notes } = req.body;
    try {
        const { rows } = await pool.query(
            'UPDATE investments SET name=$1, capital=$2, monthly_return=$3, start_date=$4, end_date=$5, notes=$6 WHERE id=$7 RETURNING *',
            [name.trim(), parseFloat(capital), parseFloat(monthly_return), start_date, end_date, (notes || '').trim(), id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Inversión no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.delete('/api/investments/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
        const { rowCount } = await pool.query('DELETE FROM investments WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Inversión no encontrada' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Servidor ──────────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => console.log(`HTTP: http://localhost:${PORT}`));

process.on('SIGINT', async () => { await pool.end(); process.exit(0); });
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
