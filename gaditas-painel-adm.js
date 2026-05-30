/**
 * GADITAS - Painel Financeiro do Administrador
 * Mostra todos os alunos com faturas vencidas no Asaas.
 * Aparece automaticamente na aba Financeiro quando o admin faz login.
 */

const GaditasPainelAdm = {

    _alunoCobranca: null, // { id, nome, email, asaasId }

    async carregar() {
        const tab = document.getElementById('tab-financeiro');
        if (!tab) return;

        // Data padrão de vencimento: hoje + 3 dias
        const dataVenc = new Date();
        dataVenc.setDate(dataVenc.getDate() + 3);
        const dataVencStr = dataVenc.toISOString().split('T')[0];

        tab.innerHTML = `
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(59, 130, 246, 0.2);">
                <div style="font-size: 2.2rem; color: #f43f5e; margin-bottom: 8px;"><i class="fas fa-file-invoice-dollar"></i></div>
                <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: #f8fafc;">PAINEL FINANCEIRO ADMIN</h3>
                <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">Gaditas Academy & Lotta</p>
            </div>

            <div id="painel-novos-cadastros" style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:15px; margin-top:4px;"></div>

            <div id="painel-config-planos" style="margin-top:4px;"></div>

            <!-- ══ COBRANÇA AVULSA ══ -->
            <div class="card" style="background:#1e293b; border:1px solid #f59e0b44; padding:15px; border-radius:12px; margin-top:4px;">
                <div style="font-size:0.7rem; font-weight:800; color:#f59e0b; margin-bottom:14px; letter-spacing:0.5px;">
                    <i class="fas fa-bolt"></i> GERAR COBRANÇA AVULSA
                </div>

                <!-- Busca de aluno -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">ALUNO:</small>
                <input type="text" id="cobranca-busca-aluno" placeholder="🔍 Digite o nome do aluno..."
                    oninput="GaditasPainelAdm.buscarAlunoCobranca()"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:6px; box-sizing:border-box;"/>
                <div id="cobranca-lista-alunos" style="margin-bottom:6px;"></div>
                <div id="cobranca-aluno-selecionado" class="hidden"
                    style="background:#0f172a; border:1px solid #f59e0b; border-radius:8px; padding:10px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                </div>

                <!-- Descrição -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">DESCRIÇÃO:</small>
                <input type="text" id="cobranca-descricao" placeholder="Ex: Taxa de evento, Kimono, Mensalidade extra..."
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:10px; box-sizing:border-box;"/>

                <!-- Valor + Vencimento -->
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">VALOR (R$):</small>
                        <input type="number" id="cobranca-valor" placeholder="0,00" step="0.01" min="0.01"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.9rem; font-weight:700; box-sizing:border-box;"/>
                    </div>
                    <div style="flex:1;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">VENCIMENTO:</small>
                        <input type="date" id="cobranca-vencimento" value="${dataVencStr}"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
                    </div>
                </div>

                <!-- Forma de pagamento -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">FORMA DE PAGAMENTO:</small>
                <select id="cobranca-tipo"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:14px; box-sizing:border-box;">
                    <option value="PIX">⚡ Pix</option>
                    <option value="BOLETO">📄 Boleto</option>
                    <option value="CREDIT_CARD">💳 Cartão de Crédito</option>
                    <option value="UNDEFINED">🔀 Pix, Boleto ou Cartão (aluno escolhe)</option>
                </select>

                <button onclick="GaditasPainelAdm.gerarCobrancaAvulsa()"
                    style="width:100%; padding:13px; background:#f59e0b; border:none; color:#000; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.3px;">
                    <i class="fas fa-bolt"></i> GERAR COBRANÇA
                </button>

                <div id="cobranca-resultado" style="margin-top:12px;"></div>
            </div>

            <!-- ══ INADIMPLÊNCIA ══ -->
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

    // ── BUSCA DE ALUNO PARA COBRANÇA ───────────────────────
    async buscarAlunoCobranca() {
        const termo = document.getElementById('cobranca-busca-aluno').value.trim().toLowerCase();
        const lista = document.getElementById('cobranca-lista-alunos');
        if (!lista) return;
        if (!termo || termo.length < 2) { lista.innerHTML = ''; return; }

        try {
            const snap = await db.collection('alunos').orderBy('nome').get();
            const resultados = snap.docs.filter(doc =>
                doc.data().nome.toLowerCase().includes(termo)
            ).slice(0, 6);

            if (resultados.length === 0) {
                lista.innerHTML = '<small style="color:#64748b; font-size:0.75rem; padding:6px; display:block;">Nenhum aluno encontrado.</small>';
                return;
            }

            lista.innerHTML = resultados.map(doc => {
                const a = doc.data();
                const asaasId = a.asaasId || '';
                return '<div onclick="GaditasPainelAdm.selecionarAlunoCobranca(\'' + doc.id + '\', \'' +
                    a.nome.replace(/'/g, "\\'") + '\', \'' + (a.email || '') + '\', \'' + asaasId + '\')" ' +
                    'style="background:#0f172a; border:1px solid #334155; padding:10px 12px; border-radius:8px; ' +
                    'margin-bottom:5px; cursor:pointer; font-size:0.8rem; color:#e2e8f0; font-weight:600;" ' +
                    'onmouseover="this.style.borderColor=\'#f59e0b\'" onmouseout="this.style.borderColor=\'#334155\'">' +
                    '👤 ' + a.nome.toUpperCase() +
                    '<small style="color:#64748b; display:block; font-size:0.6rem; margin-top:2px;">' + (a.email || '') + '</small>' +
                    '</div>';
            }).join('');
        } catch(e) {
            lista.innerHTML = '<small style="color:#f43f5e; font-size:0.7rem;">Erro ao buscar alunos.</small>';
        }
    },

    selecionarAlunoCobranca(id, nome, email, asaasId) {
        this._alunoCobranca = { id, nome, email, asaasId };
        document.getElementById('cobranca-lista-alunos').innerHTML = '';
        document.getElementById('cobranca-busca-aluno').value = '';
        const div = document.getElementById('cobranca-aluno-selecionado');
        div.classList.remove('hidden');
        div.innerHTML =
            '<div>' +
                '<div style="font-size:0.85rem; font-weight:800; color:white;">✅ ' + nome.toUpperCase() + '</div>' +
                '<div style="font-size:0.6rem; color:#64748b; margin-top:2px;">' + email + '</div>' +
            '</div>' +
            '<button onclick="GaditasPainelAdm.limparAlunoCobranca()" ' +
            'style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.9rem; font-weight:700; padding:4px 8px;">✕</button>';
    },

    limparAlunoCobranca() {
        this._alunoCobranca = null;
        document.getElementById('cobranca-aluno-selecionado').classList.add('hidden');
        document.getElementById('cobranca-aluno-selecionado').innerHTML = '';
        document.getElementById('cobranca-busca-aluno').value = '';
        document.getElementById('cobranca-lista-alunos').innerHTML = '';
    },

    // ── GERAR COBRANÇA AVULSA NO ASAAS ─────────────────────
    async gerarCobrancaAvulsa() {
        const resultado = document.getElementById('cobranca-resultado');
        if (!this._alunoCobranca) return alert('Selecione um aluno primeiro.');

        const descricao  = document.getElementById('cobranca-descricao').value.trim();
        const valor      = parseFloat(document.getElementById('cobranca-valor').value);
        const vencimento = document.getElementById('cobranca-vencimento').value;
        const tipo       = document.getElementById('cobranca-tipo').value;

        if (!descricao)           return alert('Informe a descrição da cobrança.');
        if (isNaN(valor) || valor <= 0) return alert('Informe um valor válido.');
        if (!vencimento)          return alert('Informe a data de vencimento.');

        const btn = document.querySelector('#cobranca-resultado').parentElement.querySelector('button[onclick*="gerarCobrancaAvulsa"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Gerando...'; }
        if (resultado) resultado.innerHTML = '';

        try {
            const { nome, email, asaasId: asaasIdSalvo } = this._alunoCobranca;

            // 1. Garante que o cliente existe no Asaas
            let asaasId = asaasIdSalvo;
            if (!asaasId) {
                // Tenta buscar pelo e-mail
                const resBusca = await fetch('/api/asaas?endpoint=customers&email=' + encodeURIComponent(email));
                const dadosBusca = await resBusca.json();
                if (dadosBusca.data && dadosBusca.data.length > 0) {
                    asaasId = dadosBusca.data[0].id;
                } else {
                    // Cria o cliente no Asaas
                    const resCriar = await fetch('/api/asaas?endpoint=customers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: nome, email })
                    });
                    const dadosCriado = await resCriar.json();
                    if (dadosCriado.id) {
                        asaasId = dadosCriado.id;
                        // Salva asaasId no Firestore do aluno para próximas cobranças
                        await db.collection('alunos').doc(this._alunoCobranca.id).update({ asaasId });
                    }
                }
            }

            if (!asaasId) throw new Error('Não foi possível localizar ou criar o cliente no Asaas.');

            // 2. Cria o pagamento avulso
            const resPag = await fetch('/api/asaas?endpoint=payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer:    asaasId,
                    billingType: tipo,
                    value:       valor,
                    dueDate:     vencimento,
                    description: descricao + ' — ' + nome,
                    fine:        { value: 0 },
                    interest:    { value: 0 }
                })
            });
            const dadosPag = await resPag.json();

            if (!dadosPag.id) throw new Error(dadosPag.errors?.[0]?.description || 'Erro ao criar cobrança.');

            // 3. Exibe resultado com link de pagamento
            const linkPag = dadosPag.invoiceUrl || dadosPag.bankSlipUrl || '';
            const valorFmt = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const vencFmt = vencimento.split('-').reverse().join('/');
            const tipoLabel = { PIX: '⚡ Pix', BOLETO: '📄 Boleto', CREDIT_CARD: '💳 Cartão', UNDEFINED: '🔀 Livre' }[tipo] || tipo;

            resultado.innerHTML =
                '<div style="background:#064e3b; border:1px solid #10b981; border-radius:10px; padding:14px; margin-top:4px;">' +
                    '<div style="font-size:0.7rem; font-weight:800; color:#10b981; margin-bottom:10px;">✅ COBRANÇA GERADA COM SUCESSO!</div>' +
                    '<div style="font-size:0.8rem; color:#e2e8f0; margin-bottom:4px;"><strong>' + nome.toUpperCase() + '</strong></div>' +
                    '<div style="font-size:0.75rem; color:#94a3b8; margin-bottom:2px;">' + descricao + '</div>' +
                    '<div style="display:flex; justify-content:space-between; margin:8px 0; font-size:0.8rem;">' +
                        '<span style="color:#94a3b8;">Valor:</span><strong style="color:#10b981;">' + valorFmt + '</strong>' +
                    '</div>' +
                    '<div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.8rem;">' +
                        '<span style="color:#94a3b8;">Vence em:</span><span style="color:#e2e8f0;">' + vencFmt + '</span>' +
                    '</div>' +
                    '<div style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:0.8rem;">' +
                        '<span style="color:#94a3b8;">Forma:</span><span style="color:#e2e8f0;">' + tipoLabel + '</span>' +
                    '</div>' +
                    (linkPag
                        ? '<button onclick="navigator.clipboard.writeText(\'' + linkPag + '\').then(()=>alert(\'✅ Link copiado!\'))" ' +
                          'style="width:100%; padding:11px; background:#3b82f6; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem; margin-bottom:6px;">' +
                          '<i class="fas fa-copy"></i> COPIAR LINK DE PAGAMENTO</button>' +
                          '<button onclick="window.open(\'' + linkPag + '\', \'_blank\')" ' +
                          'style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:#60a5fa; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.7rem;">' +
                          '<i class="fas fa-external-link-alt"></i> ABRIR LINK</button>'
                        : '<small style="color:#64748b; font-size:0.65rem;">ID da cobrança: ' + dadosPag.id + '</small>'
                    ) +
                '</div>';

            // Limpa o formulário
            document.getElementById('cobranca-descricao').value = '';
            document.getElementById('cobranca-valor').value = '';
            this.limparAlunoCobranca();

        } catch(e) {
            if (resultado) resultado.innerHTML =
                '<div style="background:#4c0519; border:1px solid #f43f5e; border-radius:8px; padding:12px; margin-top:4px;">' +
                '<small style="color:#f43f5e; font-size:0.75rem; font-weight:700;">❌ ' + e.message + '</small></div>';
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> GERAR COBRANÇA'; }
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
                        asaasId: clienteId,
                        nome: fatura.customerName || '',
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

            // Busca nome/email dos clientes que vieram sem nome no payload dos pagamentos
            const semNome = Object.keys(porCliente).filter(id => !porCliente[id].nome);
            if (semNome.length > 0) {
                await Promise.all(semNome.map(async (id) => {
                    try {
                        const rc = await fetch(`/api/asaas?endpoint=customers/${encodeURIComponent(id)}`);
                        const dc = await rc.json();
                        if (dc.name) {
                            porCliente[id].nome  = dc.name;
                            porCliente[id].email = dc.email || '';
                        } else {
                            porCliente[id].nome = 'Nome não encontrado';
                        }
                    } catch (_) {
                        porCliente[id].nome = 'Nome não encontrado';
                    }
                }));
            }

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
                        <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:8px 10px; border-radius:8px; margin-top:6px; gap:6px;">
                            <span style="font-size:0.7rem; color:#94a3b8; flex:1;">Venc: ${f.vencimento}</span>
                            <span style="font-size:0.75rem; font-weight:700; color:#fff;">${f.valor.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                            <span style="font-size:0.6rem; color:#f43f5e; font-weight:700; min-width:28px; text-align:right;">${f.diasAtraso}d</span>
                            <button onclick="GaditasPainelAdm.cancelarFatura('${f.id}')" title="Cancelar fatura no Asaas" style="background:#1e293b; border:1px solid #f43f5e; color:#f43f5e; border-radius:6px; padding:3px 7px; font-size:0.65rem; cursor:pointer; line-height:1;">🗑️</button>
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
    },

    // ── CANCELAR FATURA INDIVIDUAL NO ASAAS ─────────────────────
    async cancelarFatura(faturaId) {
        if (!confirm('Cancelar esta fatura no Asaas?\n\nEsta ação não pode ser desfeita.')) return;
        try {
            const r = await fetch(`/api/asaas?endpoint=payments/${encodeURIComponent(faturaId)}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const d = await r.json();
            if (d.status === 'CANCELLED' || d.deleted === true) {
                alert('✅ Fatura cancelada com sucesso!');
            } else if (d.id && d.status) {
                alert(`✅ Fatura atualizada. Status: ${d.status}`);
            } else {
                throw new Error(d.errors?.[0]?.description || JSON.stringify(d));
            }
            await this.buscarInadimplentes();
        } catch (e) {
            alert('❌ Erro ao cancelar fatura: ' + e.message);
        }
    }
};

// Integrado via GaditasFiltros.init()