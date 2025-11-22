// ... dentro do document.addEventListener('DOMContentLoaded', () => { ...

// Lógica para o formulário de Recuperação de Senha (Mantenha este bloco)
const forgotForm = document.getElementById('forgotForm');

if (forgotForm) {
    forgotForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = document.getElementById('forgot-email').value;

        try {
            // Requisição POST para a rota de recuperação no backend
            const response = await fetch('http://localhost:3000/api/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (response.ok) {
                alert(data.message || 'Se o usuário estiver cadastrado, um link de redefinição foi enviado para o seu e-mail.');
                // Opcional: Redirecionar para a página de login após o envio
                // window.location.href = 'login.html'; 
            } else {
                alert(data.error || 'Ocorreu um erro ao processar sua solicitação.');
            }
        } catch (error) {
            console.error('Erro de conexão com a API:', error);
            alert('Não foi possível conectar ao servidor. Verifique se o backend está rodando.');
        }
    });
}
// ----------------------------------------------------------------
    // Lógica para o formulário de Cadastro (Sign Up)
    // ----------------------------------------------------------------
    const signupForm = document.getElementById('signupForm');

    if (signupForm) {
        signupForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.getElementById('name').value;
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // Validação de senhas no frontend
            if (password !== confirmPassword) {
                alert('As senhas não coincidem! Por favor, verifique.');
                return;
            }

            try {
                // 1. Enviar requisição POST para a rota de registro no backend
                const response = await fetch('http://localhost:3000/api/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    // Envia Nome, Email e Senha para o server.js
                    body: JSON.stringify({ name, email, password }),
                });

                const data = await response.json();

                // 2. Tratar a resposta
                if (response.ok) {
                    alert(data.message || 'Cadastro realizado com sucesso! Faça login.');
                    // Redireciona para a página de login
                    window.location.href = 'login.html'; 
                } else {
                    // Erro de cadastro (ex: e-mail já existe - tratado pelo backend)
                    alert(data.error || 'Erro no cadastro. E-mail já existe ou inválido.');
                }
            } catch (error) {
                console.error('Erro de conexão com a API:', error);
                alert('Não foi possível conectar ao servidor. O backend está ativo?');
            }
        });
    }

// ... outros blocos de código de loginForm e forgotForm ...