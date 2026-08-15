/**
 * GADITAS MATRIZ - Fluxo de Auto-Matrícula de Atletas
 * Gravação unificada de credenciais de acesso, perfil, CPF, Telefone e Endereço Completo.
 * + Integração Asaas: verifica se cliente já existe pelo CPF ou email, associa ou cria.
 */

const iniciarCadastroApp = () => {
    const btn = document.getElementById('btnRegistrar');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const nome = document.getElementById('reg-nome').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const nascimento = document.getElementById('reg-nascimento').value;
        const senha = document.getElementById('reg-pass').value;
        const rua = document.getElementById('reg-rua').value.trim();
        const numero = document.getElementById('reg-numero').value.trim();
        const complemento = document.getElementById('reg-complemento').value.trim();
        const bairro = document.getElementById('reg-bairro').value.trim();
        const cidade = document.getElementById('reg-cidade').value.trim();
        const estado = document.getElementById('reg-estado').value.trim().toUpperCase();
        const cpf = document.getElementById('reg-cpf').value.replace(/\D/g, '');
        const telefone = document.getElementById('reg-telefone').value.replace(/\D/g, '');
        const cep = document.getElementById('reg-cep').value.replace(/\D/g, '');

        if (!nome || !email || !senha || !nascimento || !cpf || !telefone || !cep || !rua || !numero || !bairro || !cidade || !estado) {
            alert("Por favor, preencha todos os campos do formulário, incluindo os dados de Endereço e CEP.");
            return;
        }
        if (cpf.length !== 11) { alert("CPF inválido! Verifique a numeração digitada."); return; }
        if (telefone.length < 10 || telefone.length > 11) { alert("Telefone inválido! Digite o número com o DDD."); return; }
        if (cep.length !== 8) { alert("CEP inválido! O campo precisa conter os 8 números."); return; }

        btn.disabled = true;
        btn.innerText = "PROCESSANDO MATRÍCULA...";

        try {
            const authInstance = firebase.auth();
            const dbInstance = firebase.firestore();

            // 1. Cria a conta no Firebase Authentication
            const userCredential = await authInstance.createUserWithEmailAndPassword(email, senha);
            const user = userCredential.user;

            // 2. Integração Asaas — busca cliente por CPF primeiro, depois por email
            btn.innerText = "VERIFICANDO NO ASAAS...";
            let asaasCustomerId = null;

            try {
                // Busca por CPF
                const resCpf = await fetch(`/api/asaas?endpoint=customers&cpfCnpj=${cpf}`);
                const dadosCpf = await resCpf.json();

                if (dadosCpf.data && dadosCpf.data.length > 0) {
                    // Cliente já existe — associa
                    asaasCustomerId = dadosCpf.data[0].id;
                    console.log('✅ Cliente encontrado no Asaas pelo CPF:', asaasCustomerId);
                } else {
                    // Busca por email
                    const resEmail = await fetch(`/api/asaas?endpoint=customers&email=${encodeURIComponent(email)}`);
                    const dadosEmail = await resEmail.json();

                    if (dadosEmail.data && dadosEmail.data.length > 0) {
                        // Cliente já existe pelo email — associa
                        asaasCustomerId = dadosEmail.data[0].id;
                        console.log('✅ Cliente encontrado no Asaas pelo email:', asaasCustomerId);
                    } else {
                        // Não existe — cria novo cliente no Asaas
                        btn.innerText = "CRIANDO NO ASAAS...";
                        const resCriar = await fetch(`/api/asaas?endpoint=customers`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name: nome,
                                email: email,
                                cpfCnpj: cpf,
                                mobilePhone: telefone,
                                postalCode: cep,
                                address: rua,
                                addressNumber: numero,
                                complement: complemento,
                                province: bairro,
                                city: cidade,
                                state: estado
                            })
                        });
                        const dadosCriado = await resCriar.json();
                        if (dadosCriado.id) {
                            asaasCustomerId = dadosCriado.id;
                            console.log('✅ Cliente criado no Asaas:', asaasCustomerId);
                        } else {
                            console.warn('⚠️ Asaas não retornou ID:', dadosCriado);
                        }
                    }
                }
            } catch (errAsaas) {
                // Se falhar no Asaas, continua o cadastro normalmente sem bloquear o aluno
                console.warn('⚠️ Erro na integração Asaas (cadastro continua):', errAsaas.message);
            }

            // 3. Grava no Firestore com o ID do Asaas se disponível
            btn.innerText = "SALVANDO DADOS...";
            const novoAluno = {
                nome, email, cpf, telefone, nascimento,
                cep, rua, numero, complemento, bairro, cidade, estado,
                faixa: "Branca",
                grau: 0,
                aulas: 0,
                historico: [],
                historicoLeoes: [],
                role: "aluno",
                dataCadastro: new Date().toISOString()
            };

            // Salva o ID do Asaas se conseguiu
            if (asaasCustomerId) novoAluno.asaasId = asaasCustomerId;

            await dbInstance.collection("alunos").doc(user.uid).set(novoAluno);

            // Push para o admin avisando da nova matrícula
            try {
                const adminDoc = await dbInstance.collection('configuracoes').doc('admin_config').get();
                const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;
                if (adminToken) {
                    await fetch('/api/push-comunicado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            tokens: [adminToken],
                            title: '🎉 Nova Matrícula!',
                            body: `${nome} acabou de se matricular na Gaditas Matriz!`
                        })
                    });
                }
            } catch(_) { /* não bloqueia o cadastro */ }

            alert("Matrícula realizada com sucesso! Seja bem-vindo à Gaditas Matriz! OSS.");
            window.location.href = "index.html";

        } catch (error) {
            console.error("Erro durante o processo de matrícula:", error);
            btn.disabled = false;
            btn.innerText = "FINALIZAR MEU CADASTRO";

            if (error.code === 'auth/email-already-in-use') {
                alert("Este endereço de e-mail já está em uso na plataforma da academia.");
            } else {
                alert("Falha ao registrar dados: " + error.message);
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarCadastroApp);
} else {
    iniciarCadastroApp();
}
