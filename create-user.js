/**
 * Crear usuario en la BD de mi-ahorro
 *
 * Uso:
 *   DATABASE_URL="postgresql://miahorro:pass@host:5432/miahorro" node create-user.js <username> <password>
 *
 * Ejemplo:
 *   DATABASE_URL="postgresql://miahorro:M1Ah0rr0_Pr0d!2026$@192.168.1.199:5432/miahorro" node create-user.js jose MiPassword123
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const [,, username, password] = process.argv;

if (!username || !password) {
    console.error('Uso: node create-user.js <username> <password>');
    process.exit(1);
}

async function createUser() {
    const pool = new Pool(process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : { host: process.env.PGHOST || 'localhost', port: process.env.PGPORT || 5432, database: process.env.PGDATABASE || 'miahorro', user: process.env.PGUSER || 'miahorro', password: process.env.PGPASSWORD || 'password' }
    );

    await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    const hash = await bcrypt.hash(password, 12);
    try {
        const { rows } = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
            [username, hash]
        );
        console.log('Usuario creado:', rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            console.error(`El usuario "${username}" ya existe.`);
        } else {
            throw err;
        }
    }

    await pool.end();
}

createUser().catch(err => { console.error('Error:', err); process.exit(1); });
