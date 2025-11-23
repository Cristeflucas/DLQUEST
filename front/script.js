const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

// --- Configuração do PostgreSQL ---
// Usamos as credenciais de teste fornecidas anteriormente
const pool = new Pool({
    user: 'gamificacao_db',
    host: 'localhost',
    database: 'gamificacao_db',
    password: 'senha 1234',
    port: 5432,
});

const app = express();
const PORT = 3000;
const JWT_SECRET = 'sua_chave_secreta_muito_segura'; // Mantenha isso secreto!

// --- Middleware ---
app.use(cors()); // Permite requisições do frontend (localhost:3000)
app.use(bodyParser.json());

// --- Middleware de Autenticação JWT ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) return res.status(401).json({ error: 'Token necessário' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
        req.user = user; // Adiciona o payload do usuário à requisição
        next();
    });
}

// =================================================================
// 1. ROTAS DE AUTENTICAÇÃO (Login e Cadastro)
// =================================================================

// Cadastro de novo usuário
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const client = await pool.connect();
        
        // Insere o novo usuário
        const userResult = await client.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [name, email, hashedPassword]
        );
        const userId = userResult.rows[0].id;

        // Cria a entrada de estatísticas inicial (Obrigatório para o Trigger!)
        await client.query(
            'INSERT INTO user_stats (user_id) VALUES ($1)',
            [userId]
        );

        client.release();
        res.status(201).json({ message: 'Usuário registrado com sucesso.' });
    } catch (error) {
        if (error.code === '23505') { // Código de erro de violação de chave única (email)
            return res.status(409).json({ error: 'E-mail já cadastrado.' });
        }
        console.error('Erro no cadastro:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Login de usuário
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const client = await pool.connect();
        const userResult = await client.query('SELECT id, name, password_hash FROM users WHERE email = $1', [email]);
        client.release();

        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        // Gera o Token JWT
        const token = jwt.sign(
            { id: user.id, email: email, name: user.name }, 
            JWT_SECRET, 
            { expiresIn: '24h' } // Token válido por 24 horas
        );

        res.json({ token, user: { id: user.id, name: user.name, email } });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// =================================================================
// 2. ROTAS PROTEGIDAS (Missões e Dados do Usuário)
// =================================================================

// Rota 2.1: Obter todos os dados do usuário e do dashboard (PROTEGIDA)
app.get('/api/user-data', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const client = await pool.connect();
        
        // 1. Dados do Usuário (name, email)
        const userResult = await client.query('SELECT name, email FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        // 2. Estatísticas do Usuário
        const statsResult = await client.query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
        const user_stats = statsResult.rows[0];

        // 3. Missões recentes (últimas 5, não concluídas ou as últimas concluídas)
        const missionsResult = await client.query(
            'SELECT * FROM missions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
            [userId]
        );
        const recent_missions = missionsResult.rows;

        client.release();

        if (!user || !user_stats) {
            return res.status(404).json({ error: 'Dados do usuário não encontrados.' });
        }

        res.json({ user, user_stats, recent_missions });

    } catch (error) {
        console.error('Erro ao buscar dados do usuário:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Rota 2.2: Criar nova Missão (PROTEGIDA - Frontend chama essa rota)
app.post('/api/missions', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { title, description, category, reward, status } = req.body;
    
    if (!title || !reward) {
        return res.status(400).json({ error: 'Título e recompensa são obrigatórios.' });
    }

    try {
        const client = await pool.connect();
        const result = await client.query(
            'INSERT INTO missions (user_id, title, description, category, reward, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [userId, title, description, category || 'Geral', reward, status || 'Pendente']
        );
        client.release();

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao adicionar missão:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Rota 2.3: Listar todas as Missões (PROTEGIDA)
app.get('/api/missions', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM missions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        client.release();

        res.json({ missions: result.rows });
    } catch (error) {
        console.error('Erro ao buscar missões:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Rota 2.4: Obter detalhes de uma Missão (Para Modal)
app.get('/api/missions/:id', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const missionId = req.params.id;

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM missions WHERE id = $1 AND user_id = $2', [missionId, userId]);
        client.release();

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Missão não encontrada ou não pertence ao usuário.' });
        }

        res.json({ mission: result.rows[0] });
    } catch (error) {
        console.error('Erro ao buscar missão:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Rota 2.5: Concluir Missão (ROTA CRÍTICA - Dispara o Trigger do PG)
app.patch('/api/missions/:id/complete', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const missionId = req.params.id;

    try {
        const client = await pool.connect();

        // 1. Verifica o status atual da missão
        const checkResult = await client.query(
            'SELECT status, reward FROM missions WHERE id = $1 AND user_id = $2',
            [missionId, userId]
        );

        if (checkResult.rows.length === 0) {
            client.release();
            return res.status(404).json({ error: 'Missão não encontrada.' });
        }

        const mission = checkResult.rows[0];

        if (mission.status === 'Concluída') {
            client.release();
            return res.status(400).json({ error: 'Missão já concluída.' });
        }

        // 2. Atualiza a missão para 'Concluída' (Isto dispara o TRIGGER!)
        const updateResult = await client.query(
            "UPDATE missions SET status = 'Concluída', completed_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING reward",
            [missionId, userId]
        );

        client.release();
        
        // Retorna a recompensa para o Frontend mostrar o feedback
        res.json({ message: 'Missão concluída com sucesso.', reward: updateResult.rows[0].reward });
        
    } catch (error) {
        console.error('Erro ao concluir missão (TRIGGER FALHOU?):', error);
        res.status(500).json({ error: 'Erro interno ao concluir missão.' });
    }
});


// =================================================================
// 3. ROTA DE TESTE (Mantida para depuração do Trigger)
// =================================================================

app.post('/api/register-and-complete-test', async (req, res) => {
    // Esta é uma rota de teste, não precisa de autenticação.
    const client = await pool.connect();
    let email, token;
    
    try {
        // 1. Limpa o ambiente
        await client.query("DELETE FROM users WHERE email LIKE 'teste_trigger_%@xp.com'");

        // 2. Cria um novo usuário de teste
        email = `teste_trigger_${Date.now()}@xp.com`;
        const password = '123';
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const userResult = await client.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name',
            ['Teste Trigger', email, hashedPassword]
        );
        const userId = userResult.rows[0].id;
        
        // 3. Cria a entrada de estatísticas inicial
        await client.query('INSERT INTO user_stats (user_id) VALUES ($1)', [userId]);

        // 4. Cria duas missões (uma concluída, uma pendente)
        const mission1Result = await client.query(
            "INSERT INTO missions (user_id, title, reward, status) VALUES ($1, $2, $3, $4) RETURNING id",
            [userId, 'Missão Teste Pendente', 50, 'Pendente']
        );
        const mission1Id = mission1Result.rows[0].id;

        const mission2Result = await client.query(
            "INSERT INTO missions (user_id, title, reward, status) VALUES ($1, $2, $3, $4) RETURNING id",
            [userId, 'Missão Teste Concluída', 100, 'Pendente']
        );
        const mission2Id = mission2Result.rows[0].id;

        // 5. Conclui a segunda missão (DISPARA O TRIGGER)
        await client.query(
            "UPDATE missions SET status = 'Concluída', completed_at = NOW() WHERE id = $1", 
            [mission2Id]
        );
        
        // 6. Confirma o resultado do user_stats
        const statsResult = await client.query('SELECT xp, missions_completed FROM user_stats WHERE user_id = $1', [userId]);
        const stats = statsResult.rows[0];

        // 7. Limpa a missão de teste (missão 1 fica pendente, missão 2 fica concluída)
        // O usuário de teste deve ser limpo no finally.

        token = jwt.sign({ id: userId, email: email }, JWT_SECRET, { expiresIn: '1h' });

        res.json({
            status: 'success',
            message: 'Trigger funcionando perfeitamente! Dados de teste criados e deletados',
            xp_ganho: 100,
            xp_final: stats.xp,
            missões_concluídas: stats.missions_completed,
            email_usado: email,
            token_gerado: token
        });
        
    } catch (error) {
        console.error('Erro no teste do trigger:', error);
        res.status(500).json({ error: 'Erro no teste do trigger', details: error.message });
    } finally {
        if (email) {
            // Tenta limpar o usuário de teste
            await client.query("DELETE FROM users WHERE email = $1", [email]).catch(err => console.error('Erro ao limpar usuário de teste:', err));
        }
        client.release();
    }
});


// =================================================================
// 4. INICIALIZAÇÃO DO SERVIDOR
// =================================================================

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Tudo pronto: API de Gamificação conectada ao PostgreSQL.');
});

// Testa a conexão ao iniciar
pool.query('SELECT NOW()')
    .then(() => console.log('Conexão com PostgreSQL bem-sucedida!'))
    .catch(err => console.error('Erro ao conectar ao PostgreSQL:', err.stack));

module.exports = app; 
