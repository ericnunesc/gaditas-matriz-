/**
 * GADITAS - Modal de Aviso Financeiro
 * Aparece automaticamente ao abrir o app quando há fatura vencida.
 * Cole este script no index.html antes do </body>
 */

const GaditasModalFinanceiro = {
    
    async verificarEExibir() {
        // Só executa para alunos
        if (!auth.currentUser || auth.role !== 'aluno') return;
        
        // Evita mostrar mais de uma vez por sessão
        if (sessionStorage.getItem('modalFinanceiroVisto')) return;
        
        const email = auth.currentUser.email?.trim();
        if (!email) return;
        
        try {
            // Busca cliente no Asaas
            const resCliente = await fetch(`/api/asaas?endpoint=customers&email=${encodeURIComponent(email)}`);
            const dadosCliente = await resCliente.json();
            if (!dadosCliente.data || dadosCliente.data.length === 0) return;
            
            const customerId = dadosCliente.data[0].id;
            
            // Busca faturas pendentes
            const resCobrancas = await fetch(`/api/asaas?endpoint=payments&customer=${customerId}&status=PENDING&limit=20`);
            const dadosCobrancas = await resCobrancas.json();
            if (!dadosCobrancas.data || dadosCobrancas.data.length === 0) return;
            
            const dataHoje = new Date();
            dataHoje.setHours(0, 0, 0, 0);
            
            let maiorAtraso = 0;
            let valorDevido = 0;
            
            dadosCobrancas.data.forEach(cobranca => {
                const dataFatura = new Date(cobranca.dueDate + 'T00:00:00');
                dataFatura.setHours(0, 0, 0, 0);
                const dias = Math.floor((dataHoje - dataFatura) / (1000 * 60 * 60 * 24));
                if (dias > maiorAtraso) maiorAtraso = dias;
                if (dias > 0) valorDevido += cobranca.value;
            });
            
            // Só mostra se tiver pelo menos 1 dia de atraso
            if (maiorAtraso < 1) return;
            
            const bloqueado = maiorAtraso > 3;
            this.exibir(maiorAtraso, valorDevido, bloqueado);
            
        } catch (e) {
            console.error('Erro ao verificar modal financeiro:', e);
        }
    },
    
    exibir(diasAtraso, valorDevido, bloqueado) {
        // Remove modal anterior se existir
        const anterior = document.getElementById('modal-financeiro-gaditas');
        if (anterior) anterior.remove();
        
        const corPrincipal = bloqueado ? '#f43f5e' : '#f59e0b';
        const corFundo = bloqueado ? '#1a0008' : '#1c1000';
        const corBorda = bloqueado ? '#f43f5e' : '#f59e0b';
        const emoji = bloqueado ? '🔒' : '⚠️';
        const titulo = bloqueado ? 'ACESSO BLOQUEADO' : 'FATURA EM ATRASO';
        const mensagem = bloqueado ?
            `Seu acesso ao check-in está <strong>bloqueado</strong> por inadimplência de <strong>${diasAtraso} dias</strong>.<br><br>Regularize agora para voltar a treinar!` :
            `Você possui fatura vencida há <strong>${diasAtraso} dia${diasAtraso > 1 ? 's' : ''}</strong>.<br><br>Regularize para evitar o bloqueio do seu acesso.`;
        
        const valorTexto = valorDevido > 0 ?
            `<div style="background: rgba(255,255,255,0.05); border-radius: 10px; padding: 12px; margin: 16px 0; text-align: center;">
                <span style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px;">VALOR EM ABERTO</span>
                <span style="font-size: 1.8rem; font-weight: 900; color: ${corPrincipal};">
                    ${valorDevido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
               </div>` :
            '';
        
        const modal = document.createElement('div');
        modal.id = 'modal-financeiro-gaditas';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            backdrop-filter: blur(4px);
            animation: fadeInModal 0.3s ease;
        `;
        
        modal.innerHTML = `
            <style>
                @keyframes fadeInModal {
                    from { opacity: 0; transform: scale(0.92); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes pulseModal {
                    0%, 100% { box-shadow: 0 0 0 0 ${corPrincipal}44; }
                    50% { box-shadow: 0 0 0 15px ${corPrincipal}00; }
                }
                #modal-financeiro-gaditas .modal-box {
                    animation: pulseModal 2s infinite;
                }
            </style>

            <div class="modal-box" style="
                background: ${corFundo};
                border: 2px solid ${corBorda};
                border-radius: 20px;
                padding: 28px 24px;
                max-width: 360px;
                width: 100%;
                text-align: center;
                position: relative;
            ">
                <div style="font-size: 3.5rem; margin-bottom: 8px;">${emoji}</div>

                <h2 style="
                    color: ${corPrincipal};
                    font-size: 1.3rem;
                    font-weight: 900;
                    margin: 0 0 12px 0;
                    letter-spacing: 1px;
                ">${titulo}</h2>

                <p style="
                    color: #e2e8f0;
                    font-size: 0.9rem;
                    line-height: 1.6;
                    margin: 0;
                ">${mensagem}</p>

                ${valorTexto}

                <button onclick="GaditasModalFinanceiro.irParaFinanceiro()" style="
                    width: 100%;
                    background: ${corPrincipal};
                    color: #000;
                    border: none;
                    border-radius: 12px;
                    padding: 16px;
                    font-size: 1rem;
                    font-weight: 900;
                    cursor: pointer;
                    margin-bottom: 10px;
                    letter-spacing: 0.5px;
                ">💳 PAGAR AGORA</button>

                <button onclick="GaditasModalFinanceiro.fechar()" style="
                    width: 100%;
                    background: transparent;
                    color: #64748b;
                    border: 1px solid #334155;
                    border-radius: 12px;
                    padding: 13px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    cursor: pointer;
                ">Fechar e ver depois</button>
            </div>
        `;
        
        document.body.appendChild(modal);
    },
    
    irParaFinanceiro() {
        this.fechar();
        // Abre a aba financeiro do app
        if (typeof ui !== 'undefined' && ui.showTab) {
            ui.showTab('tab-financeiro');
        } else if (typeof GaditasFiltros !== 'undefined') {
            GaditasFiltros.carregarDadosFinanceirosReal();
        }
    },
    
    fechar() {
        const modal = document.getElementById('modal-financeiro-gaditas');
        if (modal) modal.remove();
        // Marca como visto nessa sessão
        sessionStorage.setItem('modalFinanceiroVisto', '1');
    }
};

// Dispara automaticamente após o login do aluno
document.addEventListener('DOMContentLoaded', () => {
    const intervalo = setInterval(() => {
        if (typeof auth !== 'undefined' && auth.currentUser && auth.role === 'aluno') {
            clearInterval(intervalo);
            // Aguarda 2 segundos para o app carregar antes de mostrar o modal
            setTimeout(() => GaditasModalFinanceiro.verificarEExibir(), 2000);
        }
    }, 1000);
});