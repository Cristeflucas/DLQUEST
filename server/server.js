// server/server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexão com PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'gameficacao_db',
    password: '1234',
    port: 5432,
});

const JWT_SECRET = 'sua_chave_secreta_muito_forte_123456789'; // mude isso depois!

// Middleware para verificar token
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token necessário' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
}

// ========== AUTH ==========
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, avatar_initials',
            [name, email, hash]
        );

        // Cria stats iniciais
        await pool.query('INSERT INTO user_stats (user_id) VALUES ($1)', [result.rows[0].id]);

        res.json({ message: 'Usuário criado com sucesso!', user: result.rows[0] });
    } catch (err) {
        res.status(400).json({ error: 'E-mail já existe ou erro no cadastro' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'Usuário não encontrado' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(400).json({ error: 'Senha incorreta' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar: user.avatar_initials
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro no login' });
    }
});

// ========== ROTAS PROTEGIDAS ==========
app.get('/api/profile', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const userRes = await pool.query('SELECT id, name, email, avatar_initials FROM users WHERE id = $1', [userId]);
        const statsRes = await pool.query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
        const missionsRes = await pool.query('SELECT * FROM missions WHERE user_id = $1 ORDER BY id DESC', [userId]);

        res.json({
            user: userRes.rows[0],
            userStats: statsRes.rows[0] || {},
            missions: missionsRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/missions', authenticateToken, async (req, res) => {
    const { title, description, category, reward, status, time } = req.body;
    const userId = req.user.id;
    try {
        const result = await pool.query(
            'INSERT INTO missions (user_id, title, description, category, reward, status, time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [userId, title, description, category, reward || 10, status || 'Pendente', time || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/missions/:id/toggle', authenticateToken, async (req, res) => {
    const missionId = req.params.id;
    const userId = req.user.id;
    try {
        const result = await pool.query(
            `UPDATE missions 
             SET status = CASE WHEN status = 'Concluído' THEN 'Pendente' ELSE 'Concluído' END,
                 time = CASE WHEN status = 'Pendente' THEN CURRENT_TIME ELSE time END
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [missionId, userId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/missions/:id', authenticateToken, async (req, res) => {
    const missionId = req.params.id;
    const userId = req.user.id;
    await pool.query('DELETE FROM missions WHERE id = $1 AND user_id = $2', [missionId, userId]);
    res.json({ success: true });
});

// Atualiza stats automaticamente (pode chamar depois de toda mudança)
app.post('/api/update-stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    // sua lógica de updateStats aqui (igual você já tem no frontend)
    // ... (vou deixar simples por enquanto)
    res.json({ success: true });
});

app.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
    console.log('Rotas: /api/register | /api/login | /api/profile | /api/missions');
});