const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

if (!APP_PASSWORD) {
    console.error('ERROR: APP_PASSWORD no está definida. Configura la variable de entorno.');
    process.exit(1);
}

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
            scriptSrc: ["'self'", "'unsafe-inline'"],      // inline JS del frontend
            scriptSrcAttr: ["'unsafe-inline'"],            // onclick="" en elementos HTML
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
        }
    }
}));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000 // 8 horas
    }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Base de datos ──────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'finanzas.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_date ON transactions(date)`);
    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        capital REAL NOT NULL,
        monthly_return REAL NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ── Middlewares ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.loggedIn) return next();
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
app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== APP_PASSWORD) {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    req.session.loggedIn = true;
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// ── API transactions (protegida) ───────────────────────────────────────────────
app.get('/api/transactions', requireAuth, (req, res) => {
    db.all('SELECT * FROM transactions ORDER BY date DESC, id DESC', [], (err, rows) => {
        if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
        res.json(rows);
    });
});

app.post('/api/transactions', requireAuth, (req, res) => {
    const errors = validateTransaction(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const { type, amount, description, category, date } = req.body;

    db.run('INSERT INTO transactions (type, amount, description, category, date) VALUES (?, ?, ?, ?, ?)',
        [type, parseFloat(amount), description.trim(), category, date], function(err) {
            if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
            db.get('SELECT * FROM transactions WHERE id = ?', [this.lastID], (err2, row) => {
                if (err2) { console.error(err2); return res.status(500).json({ error: 'Error interno' }); }
                res.status(201).json(row);
            });
        });
});

app.put('/api/transactions/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const errors = validateTransaction(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });

    const { type, amount, description, category, date } = req.body;
    const updates = [], params = [];
    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (amount !== undefined) { updates.push('amount = ?'); params.push(parseFloat(amount)); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description.trim()); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (!updates.length) return res.status(400).json({ error: 'Sin datos para actualizar' });

    params.push(id);
    db.run(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
        if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
        if (this.changes === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
        db.get('SELECT * FROM transactions WHERE id = ?', [id], (err2, row) => {
            if (err2) { console.error(err2); return res.status(500).json({ error: 'Error interno' }); }
            res.json(row);
        });
    });
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    db.run('DELETE FROM transactions WHERE id = ?', [id], function(err) {
        if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
        if (this.changes === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
        res.json({ success: true });
    });
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

app.get('/api/investments', requireAuth, (req, res) => {
    db.all('SELECT * FROM investments ORDER BY created_at DESC', [], (err, rows) => {
        if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
        res.json(rows);
    });
});

app.post('/api/investments', requireAuth, (req, res) => {
    const errors = validateInvestment(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });
    const { name, capital, monthly_return, start_date, end_date, notes } = req.body;
    db.run('INSERT INTO investments (name, capital, monthly_return, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [name.trim(), parseFloat(capital), parseFloat(monthly_return), start_date, end_date, (notes || '').trim()],
        function(err) {
            if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
            db.get('SELECT * FROM investments WHERE id = ?', [this.lastID], (err2, row) => {
                if (err2) { console.error(err2); return res.status(500).json({ error: 'Error interno' }); }
                res.status(201).json(row);
            });
        });
});

app.put('/api/investments/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const errors = validateInvestment(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(', ') });
    const { name, capital, monthly_return, start_date, end_date, notes } = req.body;
    db.run('UPDATE investments SET name=?, capital=?, monthly_return=?, start_date=?, end_date=?, notes=? WHERE id=?',
        [name.trim(), parseFloat(capital), parseFloat(monthly_return), start_date, end_date, (notes || '').trim(), id],
        function(err) {
            if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
            if (this.changes === 0) return res.status(404).json({ error: 'Inversión no encontrada' });
            db.get('SELECT * FROM investments WHERE id = ?', [id], (err2, row) => {
                if (err2) { console.error(err2); return res.status(500).json({ error: 'Error interno' }); }
                res.json(row);
            });
        });
});

app.delete('/api/investments/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    db.run('DELETE FROM investments WHERE id = ?', [id], function(err) {
        if (err) { console.error(err); return res.status(500).json({ error: 'Error interno' }); }
        if (this.changes === 0) return res.status(404).json({ error: 'Inversión no encontrada' });
        res.json({ success: true });
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Servidores ─────────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => console.log(`🚀 HTTP:  http://localhost:${PORT}`));

const certPath = process.env.CERT_PATH || path.join(__dirname, 'certs');
if (fs.existsSync(path.join(certPath, 'key.pem')) && fs.existsSync(path.join(certPath, 'cert.pem'))) {
    https.createServer({
        key: fs.readFileSync(path.join(certPath, 'key.pem')),
        cert: fs.readFileSync(path.join(certPath, 'cert.pem'))
    }, app).listen(HTTPS_PORT, '0.0.0.0', () => console.log(`🔒 HTTPS: https://localhost:${HTTPS_PORT}`));
}

process.on('SIGINT', () => db.close(() => process.exit(0)));
process.on('SIGTERM', () => db.close(() => process.exit(0)));
