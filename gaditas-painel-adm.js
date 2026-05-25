/**
 * GADITAS - Painel Financeiro do Administrador
 * Mostra todos os alunos com faturas vencidas no Asaas.
 * Aparece automaticamente na aba Financeiro quando o admin faz login.
 */

const GaditasPainelAdm = {
    
    async carregar() {
        const tab = document.getElementById('tab-financeiro');
        if (!tab) return;
        
        // Mantém o conteúdo existente e adiciona o painel de inadimplência no final
        tab.innerHTML = `
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(59, 130, 246, 0.2);">
                <div style="font-size: 2.2rem; color: #f43f5e; margin-bottom: 8px;"><i class="fas fa-file-invoice-dollar"></i></div>
                <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: #f8fafc;">PAINEL FINANCEIRO ADMIN</h3>
                <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">Gaditas Academy & Lotta</p>
            </div>

            <div id="painel-novos-cadastros" style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:15px; margin-top:4px;"></div>

            <div id="painel-config-planos" style="margin-top:4px;"></div>

            <div class="card" style="background:#1e293b; border:1px solid #334155; padding:15px; border-radius:12px; margin-top:4px;">
                <div style="font-size:0.7rem; font-weight:800; color:#f43f5e; margin-bottom:12px; letter-spacing:0.5px;">
                    <i class="fas fa-exclamation-triangle"></i> INADIMPLÊNCIA — FATURAS VENCIDAS
                </div>
                <div id="adm-financeiro-loading" style="text-align:center; color:#64748b; font-size:0.85rem; padding:20px;">
                    <i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:#3b82f6; display:block; margin-bottom:8px;"></i>
                    Consultando Asaas...
                </div>
                <div id="adm-financeiro-conteudo" class="hidden"></div>
            </div>
        `;
        
        await this.buscarInadimplentes();
        
        // Carrega os outros painéis após renderizar
        if (typeof academia !== 'undefined') {
            academia.carregarNovoCadastrosAlerta();
            academia.renderPainelPlanos();
        }
    },
    
    async buscarInadimplentes() {
        const loading = document.getElementById('adm-financeiro-loading');
        const conteudo = document.getElementById('adm-financeiro-conteudo');
        
        // Timeout de 15 segundos
        const timeoutId = setTimeout(() => {
            if (loading) loading.classList.add('hidden');
            if (conteudo) {
                conteudo.classList.remove('hidden');
                conteudo.innerHTML = `<p style="color:#f43f5e; text-align:center; margin-bottom:10px;">⏱️ Tempo esgotado. Verifique a conexão com o Asaas.</p>
                <button onclick="GaditasPainelAdm.buscarInadimplentes()" style="width:100%; padding:10px; background:#3b82f6; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer;">TENTAR NOVAMENTE</button>`;
            }
        }, 15000);
        
        try {
            // Busca pagamentos vencidos no Asaas
            const resp = await fetch(`/api/asaas?endpoint=payments&status=OVERDUE&limit=100`);
            clearTimeout(timeoutId);
            
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            
            const dados = await resp.json();
            if (dados.errors) throw new Error(dados.errors[0]?.description || 'Erro Asaas');
            
            if (loading) loading.classList.add('hidden');
            if (conteudo) conteudo.classList.remove('hidden');
            
            if (!dados.data || dados.data.length === 0) {
                conteudo.innerHTML = `
                    <div style="text-align:center; padding:20px; background:#064e3b; border:1px solid #10b981; border-radius:12px;">
                        <i class="fas fa-check-circle" style="color:#10b981; font-size:2rem; display:block; margin-bottom:8px;"></i>
                        <h4 style="margin:0; color:#fff; font-size:0.95rem;">NENHUMA FATURA VENCIDA!</h4>
                        <p style="color:#94a3b8; font-size:0.75rem; margin:4px 0 0 0;">Todos os alunos estão em dia.</p>
                    </div>`;
                return;
            }
            
            // Agrupa por cliente
            const porCliente = {};
            const dataHoje = new Date();
            dataHoje.setHours(0, 0, 0, 0);
            
            dados.data.forEach(fatura => {
                const clienteId = fatura.customer;
                if (!porCliente[clienteId]) {
                    porCliente[clienteId] = {
                        nome: fatura.customerName || 'Nome não encontrado',
                        email: fatura.customerEmail || '',
                        faturas: []
                    };
                }
                
                const vencimento = new Date(fatura.dueDate + 'T00:00:00');
                vencimento.setHours(0, 0, 0, 0);
                const diasAtraso = Math.floor((dataHoje - vencimento) / (1000 * 60 * 60 * 24));
                
                porCliente[clienteId].faturas.push({
                    id: fatura.id,
                    valor: fatura.value,
                    vencimento: fatura.dueDate.split('-').reverse().join('/'),
                    diasAtraso
                });
            });
            
            // Calcula totais
            const clientes = Object.values(porCliente);
            const totalAlunos = clientes.length;
            const totalValor = dados.data.reduce((s, f) => s + f.value, 0);
            const bloqueados = clientes.filter(c => c.faturas.some(f => f.diasAtraso > 5)).length;
            
            // Resumo geral
            let html = `
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:16px;">
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; text-align:center;">
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:800; display:block;">INADIMPLENTES</span>
                        <span style="font-size:1.4rem; font-weight:900; color:#f43f5e;">${totalAlunos}</span>
                    </div>
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; text-align:center;">
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:800; display:block;">BLOQUEADOS</span>
                        <span style="font-size:1.4rem; font-weight:900; color:#f59e0b;">${bloqueados}</span>
                    </div>
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; text-align:center;">
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:800; display:block;">TOTAL</span>
                        <span style="font-size:0.85rem; font-weight:900; color:#10b981;">${totalValor.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                    </div>
                </div>

                <button onclick="GaditasPainelAdm.buscarInadimplentes()" style="width:100%; background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:10px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; margin-bottom:16px;">
                    <i class="fas fa-sync-alt"></i> ATUALIZAR LISTA
                </button>

                <div id="adm-lista-inadimplentes">
            `;
            
            // Lista de alunos
            clientes
                .sort((a, b) => Math.max(...b.faturas.map(f => f.diasAtraso)) - Math.max(...a.faturas.map(f => f.diasAtraso)))
                .forEach(cliente => {
                    const maiorAtraso = Math.max(...cliente.faturas.map(f => f.diasAtraso));
                    const totalDevido = cliente.faturas.reduce((s, f) => s + f.valor, 0);
                    const bloqueado = maiorAtraso > 5;
                    const corBorda = bloqueado ? '#f43f5e' : '#f59e0b';
                    const corTag = bloqueado ? '#f43f5e' : '#f59e0b';
                    const tagTexto = bloqueado ? `🔒 BLOQUEADO (${maiorAtraso} dias)` : `⚠️ ${maiorAtraso} dia${maiorAtraso > 1 ? 's' : ''} de atraso`;
                    
                    const faturasHtml = cliente.faturas.map(f => `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:8px 10px; border-radius:8px; margin-top:6px;">
                            <span style="font-size:0.7rem; color:#94a3b8;">Venc: ${f.vencimento}</span>
                            <span style="font-size:0.75rem; font-weight:700; color:#fff;">${f.valor.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                            <span style="font-size:0.6rem; color:#f43f5e; font-weight:700;">${f.diasAtraso}d</span>
                        </div>`).join('');
                    
                    html += `
                        <div style="background:#1a0a00; border:1px solid ${corBorda}; border-radius:12px; padding:14px; margin-bottom:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                                <div style="flex:1;">
                                    <span style="font-size:0.65rem; font-weight:800; color:${corTag}; display:block;">${tagTexto}</span>
                                    <span style="font-size:0.9rem; font-weight:800; color:#fff;">${cliente.nome.toUpperCase()}</span>
                                    <span style="font-size:0.65rem; color:#64748b; display:block;">${cliente.email}</span>
                                </div>
                                <div style="text-align:right;">
                                    <span style="font-size:0.55rem; color:#94a3b8; display:block;">TOTAL DEVIDO</span>
                                    <span style="font-size:1rem; font-weight:900; color:${corTag};">${totalDevido.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                                </div>
                            </div>
                            ${faturasHtml}
                        </div>`;
                });
            
            html += `</div>`;
            conteudo.innerHTML = html;
            
        } catch (e) {
            clearTimeout(timeoutId);
            if (loading) loading.classList.add('hidden');
            if (conteudo) {
                conteudo.classList.remove('hidden');
                conteudo.innerHTML = `
                    <p style="color:#f43f5e; text-align:center; font-size:0.85rem; margin-bottom:10px;">❌ Erro: ${e.message}</p>
                    <button onclick="GaditasPainelAdm.buscarInadimplentes()" style="width:100%; padding:10px; background:#3b82f6; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer;">TENTAR NOVAMENTE</button>`;
            }
        }
    }
};

// Integrado via GaditasFiltros.init()