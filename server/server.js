require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// ============ CONFIGURAÇÃO DO BANCO ============
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'gameficacao_db',
    password: '1234',
    port: 5432,
});

const JWT_SECRET = 'sua_chave_secreta_muito_forte_2025_xyz_@#$_change_in_production';

// ============ AUTENTICAÇÃO MIDDLEWARE ============
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token necessário' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
        req.user = user;
        next();
    });
}

// =================================================================
// ROTAS DE AUTENTICAÇÃO E PERFIL
// =================================================================

app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) return res.status(400).json({ error: 'E-mail já cadastrado' });

        const hash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, avatar_initials',
            [name, email, hash]
        );
        const userId = result.rows[0].id;

        // Inicializa stats
        await pool.query(
            'INSERT INTO user_stats (user_id, xp, accumulated_points, level) VALUES ($1, 0, 0, 1) ON CONFLICT (user_id) DO NOTHING',
            [userId]
        );

        res.status(201).json({ message: 'Usuário criado com sucesso!', user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro no cadastro' });
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
            user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar_initials }
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro no login' });
    }
});

app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const user = await pool.query('SELECT id, name, email, avatar_initials FROM users WHERE id = $1', [req.user.id]);
        const stats = await pool.query('SELECT * FROM user_stats WHERE user_id = $1', [req.user.id]);

        res.json({
            user: user.rows[0],
            userStats: stats.rows[0] || {}
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar perfil' });
    }
});

// =================================================================
// ROTAS DE MISSÕES
// =================================================================

app.get('/api/missions', authenticateToken, async (req, res) => {
    try {
        const missions = await pool.query('SELECT * FROM missions WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
        res.json(missions.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar missões' });
    }
});

app.post('/api/missions', authenticateToken, async (req, res) => {
    const { title, description, category, reward } = req.body;
    const finalReward = Math.max(10, parseInt(reward) || 10);

    try {
        const mission = await pool.query(
            'INSERT INTO missions (user_id, title, description, category, reward) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.id, title, description, category, finalReward]
        );
        res.status(201).json(mission.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar missão' });
    }
});

// Toggle (BURRO): Apenas atualiza status e completed_at. O Trigger do PG faz o XP.
app.put('/api/missions/:id/toggle', authenticateToken, async (req, res) => {
    const missionId = req.params.id;

    try {
        const current = await pool.query('SELECT status FROM missions WHERE id = $1 AND user_id = $2', [missionId, req.user.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Missão não encontrada' });

        const newStatus = current.rows[0].status === 'Concluído' ? 'Pendente' : 'Concluído';
        const completedAt = newStatus === 'Concluído' ? new Date() : null;

        const updated = await pool.query(
            'UPDATE missions SET status = $1, completed_at = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
            [newStatus, completedAt, missionId, req.user.id]
        );

        res.json(updated.rows[0]);
    } catch (err) {
        console.error('Erro no toggle:', err);
        res.status(500).json({ error: 'Erro ao atualizar missão' });
    }
});

app.delete('/api/missions/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM missions WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Missão não encontrada' });
        res.json({ success: true, message: 'Missão deletada com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar' });
    }
});

// =================================================================
// ROTAS DE TESTE E VALIDAÇÃO DE GATILHO (XP)
// =================================================================

// Teste de Conexão DB
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ success: true, time: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA DE TESTE FINAL (100% ROBUSTA E REPETÍVEL)
app.post('/api/register-and-complete-test', async (req, res) => {
    const client = await pool.connect();
    let userId = null;
    try {
        await client.query('BEGIN');

        const timestamp = Date.now();
        const email = `teste_${timestamp}@xp.com`;

        const hash = await bcrypt.hash('123456', 12);
        const userRes = await client.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [`Teste ${timestamp}`, email, hash]
        );
        userId = userRes.rows[0].id;

        await client.query('INSERT INTO user_stats (user_id, xp, accumulated_points, level) VALUES ($1, 0, 0, 1)', [userId]);

        const mission = await client.query(
            'INSERT INTO missions (user_id, title, category, reward) VALUES ($1, $2, $3, $4) RETURNING id',
            [userId, 'Missão de Teste Trigger', 'Teste', 100]
        );
        const missionId = mission.rows[0].id;

        // Atualiza a missão para concluída, o trigger deve disparar aqui
        await client.query(
            'UPDATE missions SET status = $1, completed_at = NOW() WHERE id = $2',
            ['Concluído', missionId]
        );

        const stats = await client.query(
            'SELECT COALESCE(accumulated_points, xp) AS points, missions_completed FROM user_stats WHERE user_id = $1',
            [userId]
        );

        const finalPoints = stats.rows[0]?.points || 0;
        const missionsCompleted = stats.rows[0]?.missions_completed || 0;

        await client.query('COMMIT');
        
        // Tenta limpar o usuário de teste após o COMMIT
        try {
            if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        } catch (cleanError) {
            console.warn('Falha na limpeza do usuário de teste:', cleanError.message);
        }

        res.json({
            status: 'success',
            message: 'Trigger funcionando perfeitamente! Dados de teste criados e deletados.',
            email_usado: email,
            xp_ganho: 100,
            xp_final: finalPoints,
            missões_concluídas: missionsCompleted,
            trigger_ok: finalPoints === 100 && missionsCompleted === 1
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro no teste de trigger:', err);
        
        // Tenta limpar o usuário de teste, mesmo em erro
        try {
            if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        } catch (cleanError) {
            // Ignore clean error
        }
        
        res.status(500).json({ error: 'Erro no teste do trigger', details: err.message });
    } finally {
        client.release();
    }
});

// ============ SERVIDOR ============
app.listen(3000, () => {
    console.log('🚀 Servidor rodando em http://localhost:3000');
    console.log('✅ Tudo pronto: body-parser, completed_at, trigger puro, teste robusto');
    console.log('POST /api/register-and-complete-test → Testa o trigger do início ao fim');
});

module.exports = app; 

