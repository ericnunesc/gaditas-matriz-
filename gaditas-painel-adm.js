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

            <div id="painel-resumo-mensal" style="margin-top:4px;"></div>

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

            <!-- ══ MUDAR PLANO ══ -->
            <div class="card" style="background:#1e293b; border:1px solid #8b5cf644; padding:15px; border-radius:12px; margin-top:4px;">
                <div style="font-size:0.7rem; font-weight:800; color:#a78bfa; margin-bottom:14px; letter-spacing:0.5px;">
                    <i class="fas fa-exchange-alt"></i> MUDAR PLANO DO ALUNO
                </div>
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">ALUNO:</small>
                <input type="text" id="mudar-plano-busca" placeholder="🔍 Digite o nome do aluno..."
                    oninput="GaditasPainelAdm.buscarAlunoMudarPlano()"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:6px; box-sizing:border-box;"/>
                <div id="mudar-plano-lista" style="margin-bottom:6px;"></div>
                <div id="mudar-plano-aluno-selecionado" class="hidden" style="background:#0f172a; border:1px solid #8b5cf6; border-radius:8px; padding:10px 12px; margin-bottom:12px;"></div>

                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:6px; letter-spacing:0.5px;">NOVO PLANO:</small>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:10px;">
                    <button id="mp-btn-mensal"     onclick="GaditasPainelAdm._selecionarMudarPlano('mensal')"     style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 MENSAL</button>
                    <button id="mp-btn-trimestral" onclick="GaditasPainelAdm._selecionarMudarPlano('trimestral')" style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 TRIMESTRAL</button>
                    <button id="mp-btn-semestral"  onclick="GaditasPainelAdm._selecionarMudarPlano('semestral')"  style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 SEMESTRAL</button>
                    <button id="mp-btn-anual"      onclick="GaditasPainelAdm._selecionarMudarPlano('anual')"      style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 ANUAL</button>
                    <button id="mp-btn-livre"      onclick="GaditasPainelAdm._selecionarMudarPlano('livre')"      style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">🔓 LIVRE</button>
                    <button id="mp-btn-familia"    onclick="GaditasPainelAdm._selecionarMudarPlano('familia')"    style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">👨‍👩‍👧 FAMÍLIA</button>
                </div>
                <div style="display:flex; gap:10px; margin-bottom:14px;">
                    <div style="flex:1;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">NOVO VALOR (R$/mês):</small>
                        <input type="number" id="mudar-plano-valor" placeholder="0,00" step="0.01"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #8b5cf6; color:white; border-radius:8px; outline:none; font-size:0.9rem; font-weight:700; box-sizing:border-box;"/>
                    </div>
                </div>
                <button onclick="GaditasPainelAdm.confirmarMudancaPlano()"
                    style="width:100%; padding:12px; background:#8b5cf6; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.82rem;">
                    <i class="fas fa-exchange-alt"></i> SALVAR NOVO PLANO
                </button>
                <small style="color:#475569; font-size:0.58rem; display:block; margin-top:6px; line-height:1.4;">
                    Atualiza apenas o plano no sistema. Para cancelar a assinatura antiga no Asaas, acesse o painel Asaas diretamente.
                </small>
                <div id="mudar-plano-resultado" style="margin-top:10px;"></div>
            </div>

            <!-- ══ VINCULAR DEPENDENTE (PLANO FAMÍLIA) ══ -->
            <div class="card" style="background:#1e293b; border:1px solid #f43f5e44; padding:15px; border-radius:12px; margin-top:4px;">
                <div style="font-size:0.7rem; font-weight:800; color:#f43f5e; margin-bottom:4px; letter-spacing:0.5px;">
                    <i class="fas fa-users"></i> VINCULAR DEPENDENTE — PLANO FAMÍLIA
                </div>
                <small style="color:#64748b; font-size:0.58rem; display:block; margin-bottom:12px; line-height:1.4;">
                    O dependente não verá o financeiro. O titular é o responsável pelo pagamento.
                </small>

                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">TITULAR (quem paga):</small>
                <input type="text" id="dep-busca-titular" placeholder="🔍 Nome do titular do plano..."
                    oninput="GaditasPainelAdm.buscarTitularFamilia()"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:6px; box-sizing:border-box;"/>
                <div id="dep-lista-titular" style="margin-bottom:6px;"></div>
                <div id="dep-titular-selecionado" class="hidden" style="background:#0f172a; border:1px solid #10b981; border-radius:8px; padding:10px 12px; margin-bottom:12px;"></div>

                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">DEPENDENTE (quem treina junto):</small>
                <input type="text" id="dep-busca-dependente" placeholder="🔍 Nome do dependente..."
                    oninput="GaditasPainelAdm.buscarDependente()"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:6px; box-sizing:border-box;"/>
                <div id="dep-lista-dependente" style="margin-bottom:6px;"></div>
                <div id="dep-dependente-selecionado" class="hidden" style="background:#0f172a; border:1px solid #f43f5e; border-radius:8px; padding:10px 12px; margin-bottom:12px;"></div>

                <button onclick="GaditasPainelAdm.vincularDependente()"
                    style="width:100%; padding:12px; background:#f43f5e; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.82rem; margin-bottom:8px;">
                    <i class="fas fa-link"></i> VINCULAR DEPENDENTE AO TITULAR
                </button>
                <button onclick="GaditasPainelAdm.desvincularDependente()"
                    style="width:100%; padding:11px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.78rem;">
                    <i class="fas fa-unlink"></i> DESVINCULAR (tornar independente)
                </button>
                <div id="dep-resultado" style="margin-top:10px;"></div>
            </div>

            <!-- ══ CRIAR PLANO / ASSINATURA ══ -->
            <div class="card" style="background:#1e293b; border:1px solid #10b98144; padding:15px; border-radius:12px; margin-top:4px;">
                <div style="font-size:0.7rem; font-weight:800; color:#10b981; margin-bottom:14px; letter-spacing:0.5px;">
                    <i class="fas fa-file-contract"></i> CRIAR PLANO / ASSINATURA RECORRENTE
                </div>

                <!-- Busca de aluno -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">ALUNO:</small>
                <input type="text" id="plano-busca-aluno" placeholder="🔍 Digite o nome do aluno..."
                    oninput="GaditasPainelAdm.buscarAlunoPlano()"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:6px; box-sizing:border-box;"/>
                <div id="plano-lista-alunos" style="margin-bottom:6px;"></div>
                <div id="plano-aluno-selecionado" class="hidden"
                    style="background:#0f172a; border:1px solid #10b981; border-radius:8px; padding:10px 12px; margin-bottom:12px;">
                </div>

                <!-- Tipo de plano -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:6px; letter-spacing:0.5px;">TIPO DE PLANO:</small>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:12px;">
                    <button id="plano-btn-mensal"      onclick="GaditasPainelAdm._selecionarTipoPlano('mensal')"      style="padding:9px 4px; background:#10b981; border:none; color:white; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 MENSAL</button>
                    <button id="plano-btn-trimestral"  onclick="GaditasPainelAdm._selecionarTipoPlano('trimestral')"  style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 TRIMESTRAL</button>
                    <button id="plano-btn-semestral"   onclick="GaditasPainelAdm._selecionarTipoPlano('semestral')"   style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 SEMESTRAL</button>
                    <button id="plano-btn-anual"       onclick="GaditasPainelAdm._selecionarTipoPlano('anual')"       style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">📅 ANUAL</button>
                    <button id="plano-btn-livre"       onclick="GaditasPainelAdm._selecionarTipoPlano('livre')"       style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">🔓 LIVRE</button>
                    <button id="plano-btn-familia"     onclick="GaditasPainelAdm._selecionarTipoPlano('familia')"     style="padding:9px 4px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer;">👨‍👩‍👧 FAMÍLIA</button>
                </div>

                <!-- Valor + 1º Vencimento -->
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">VALOR MENSAL (R$):</small>
                        <input type="number" id="plano-valor" placeholder="0,00" step="0.01" min="0.01"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #10b981; color:white; border-radius:8px; outline:none; font-size:0.9rem; font-weight:700; box-sizing:border-box;"/>
                    </div>
                    <div style="flex:1;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">1º VENCIMENTO:</small>
                        <input type="date" id="plano-vencimento" value="${dataVencStr}"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
                    </div>
                </div>

                <!-- Forma de pagamento -->
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">FORMA DE PAGAMENTO:</small>
                <select id="plano-tipo"
                    style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:14px; box-sizing:border-box;">
                    <option value="PIX">⚡ Pix</option>
                    <option value="BOLETO">📄 Boleto</option>
                    <option value="CREDIT_CARD">💳 Cartão de Crédito</option>
                    <option value="UNDEFINED">🔀 Pix, Boleto ou Cartão (aluno escolhe)</option>
                </select>

                <button onclick="GaditasPainelAdm.criarPlanoAsaas()"
                    style="width:100%; padding:13px; background:#10b981; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.3px;">
                    <i class="fas fa-file-contract"></i> CRIAR PLANO E GERAR 1ª COBRANÇA
                </button>

                <div id="plano-resultado" style="margin-top:12px;"></div>
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

        this.carregarResumoMensal();
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
                    a.nome.replace(/'/g, "\\'").replace(/"/g,'&quot;') + '\', \'' + (a.email || '') + '\', \'' + asaasId + '\')" ' +
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

    async selecionarAlunoCobranca(id, nome, email, asaasId) {
        document.getElementById('cobranca-lista-alunos').innerHTML = '';
        document.getElementById('cobranca-busca-aluno').value = '';

        // Busca CPF do aluno no Firestore
        let cpf = '';
        try {
            const doc = await db.collection('alunos').doc(id).get();
            cpf = (doc.data()?.cpf || '').replace(/\D/g, '');
        } catch(e) {}

        this._alunoCobranca = { id, nome, email, asaasId, cpf };

        const div = document.getElementById('cobranca-aluno-selecionado');
        div.classList.remove('hidden');

        // Se não tem CPF, mostra campo para preencher na hora
        const campoCpf = cpf ? '' :
            '<div style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">' +
                '<small style="color:#f43f5e; font-size:0.6rem; font-weight:800; display:block; margin-bottom:5px;">⚠️ SEM CPF — preencha para cobrar no Asaas:</small>' +
                '<div style="display:flex; gap:6px;">' +
                    '<input type="text" id="cobranca-cpf-inline" maxlength="11" placeholder="Apenas números (11 dígitos)" ' +
                        'style="flex:1; padding:9px; background:#0f172a; border:1px solid #f43f5e; color:white; border-radius:8px; outline:none; font-size:0.8rem; font-weight:700;" ' +
                        'oninput="this.value=this.value.replace(/\\D/g,\'\')"/>' +
                    '<button onclick="GaditasPainelAdm._salvarCpfInline()" ' +
                        'style="background:#f43f5e; border:none; color:white; padding:9px 12px; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.7rem; white-space:nowrap;">SALVAR CPF</button>' +
                '</div>' +
            '</div>';

        div.innerHTML =
            '<div style="width:100%;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                    '<div>' +
                        '<div style="font-size:0.85rem; font-weight:800; color:white;">✅ ' + nome.toUpperCase() + '</div>' +
                        '<div style="font-size:0.6rem; color:#64748b; margin-top:2px;">' + email + '</div>' +
                        (cpf ? '<div style="font-size:0.6rem; color:#10b981; margin-top:2px;">CPF: ' + cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') + '</div>' : '') +
                    '</div>' +
                    '<button onclick="GaditasPainelAdm.limparAlunoCobranca()" ' +
                        'style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.9rem; font-weight:700; padding:4px 8px; flex-shrink:0;">✕</button>' +
                '</div>' +
                campoCpf +
            '</div>';
    },

    async _salvarCpfInline() {
        const cpfInput = document.getElementById('cobranca-cpf-inline');
        const cpf = (cpfInput?.value || '').replace(/\D/g, '');
        if (cpf.length !== 11) { alert('CPF inválido — informe 11 dígitos.'); return; }
        if (!this._alunoCobranca) return;
        try {
            await db.collection('alunos').doc(this._alunoCobranca.id).update({ cpf });
            this._alunoCobranca.cpf = cpf;
            // Atualiza display
            if (cpfInput) cpfInput.closest('div[style*="border-top"]').innerHTML =
                '<div style="font-size:0.65rem; color:#10b981; font-weight:800; margin-top:6px;">✅ CPF salvo: ' +
                cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') + '</div>';
            alert('✅ CPF salvo! Pode gerar a cobrança agora.');
        } catch(e) { alert('Erro ao salvar CPF: ' + e.message); }
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
            const { nome, email, asaasId: asaasIdSalvo, id: alunoFirebaseId, cpf: cpfMemoria } = this._alunoCobranca;

            // Usa CPF já carregado na memória; se não, busca no Firestore
            let cpfAluno = (cpfMemoria || '').replace(/\D/g, '');
            if (!cpfAluno) {
                const alunoDoc = await db.collection('alunos').doc(alunoFirebaseId).get();
                cpfAluno = (alunoDoc.data()?.cpf || '').replace(/\D/g, '');
            }

            if (!cpfAluno || cpfAluno.length !== 11) {
                if (resultado) resultado.innerHTML = '<div style="background:#1c0a00; border:1px solid #f43f5e; border-radius:8px; padding:12px; font-size:0.78rem; color:#f43f5e; font-weight:700;">❌ CPF do aluno não encontrado.<br><small style="font-weight:400; color:#94a3b8;">Preencha o CPF no campo acima e clique em SALVAR CPF antes de gerar a cobrança.</small></div>';
                if (btn) { btn.disabled = false; btn.innerText = '⚡ GERAR COBRANÇA'; }
                return;
            }

            // 1. Garante que o cliente existe no Asaas
            let asaasId = asaasIdSalvo;
            let clienteAsaas = null;

            if (!asaasId) {
                // Tenta buscar pelo e-mail
                const resBusca = await fetch('/api/asaas?endpoint=customers&email=' + encodeURIComponent(email));
                const dadosBusca = await resBusca.json();
                if (dadosBusca.data && dadosBusca.data.length > 0) {
                    asaasId = dadosBusca.data[0].id;
                    clienteAsaas = dadosBusca.data[0];
                } else {
                    // Cria o cliente no Asaas já com CPF
                    const bodyCliente = { name: nome, email };
                    if (cpfAluno.length === 11) bodyCliente.cpfCnpj = cpfAluno;
                    const resCriar = await fetch('/api/asaas?endpoint=customers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(bodyCliente)
                    });
                    const dadosCriado = await resCriar.json();
                    if (dadosCriado.id) {
                        asaasId = dadosCriado.id;
                        clienteAsaas = dadosCriado;
                        await db.collection('alunos').doc(alunoFirebaseId).update({ asaasId });
                    }
                }
            }

            if (!asaasId) throw new Error('Não foi possível localizar ou criar o cliente no Asaas.');

            // 2. Se o cliente não tem CPF no Asaas, atualiza agora
            if (cpfAluno.length === 11) {
                if (!clienteAsaas) {
                    // Busca dados do cliente para checar se tem CPF
                    const resGet = await fetch('/api/asaas?endpoint=customers/' + asaasId);
                    clienteAsaas = await resGet.json();
                }
                const cpfNoAsaas = (clienteAsaas?.cpfCnpj || '').replace(/\D/g, '');
                if (!cpfNoAsaas) {
                    // Atualiza CPF no cliente Asaas
                    await fetch('/api/asaas?endpoint=customers/' + asaasId, {
                        method: 'POST', // Asaas usa POST para update de customer
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: nome, email, cpfCnpj: cpfAluno })
                    });
                }
            } else if (!clienteAsaas?.cpfCnpj) {
                // Sem CPF no Firestore e sem CPF no Asaas — avisa mas não bloqueia
                if (resultado) resultado.innerHTML = '<div style="background:#1c1000; border:1px solid #f59e0b; border-radius:8px; padding:10px; font-size:0.75rem; color:#f59e0b; margin-bottom:8px;">⚠️ Aluno sem CPF cadastrado. Preencha o CPF na ficha do aluno (aba Gestão) para evitar erros no Asaas.</div>';
            }

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
    
    // ══════════════════════════════════════════════════════════
    // MUDAR PLANO
    // ══════════════════════════════════════════════════════════

    _alunoMudarPlano: null,
    _novoPlanoKey: 'mensal',

    _selecionarMudarPlano(tipo) {
        this._novoPlanoKey = tipo;
        const todos = ['mensal','trimestral','semestral','anual','livre','familia'];
        todos.forEach(t => {
            const btn = document.getElementById('mp-btn-' + t);
            if (!btn) return;
            btn.style.background = t === tipo ? '#8b5cf6' : '#0f172a';
            btn.style.border = t === tipo ? 'none' : '1px solid #334155';
            btn.style.color = t === tipo ? 'white' : '#94a3b8';
        });
        try {
            academia.carregarConfiguracaoPlanos().then(planos => {
                const p = planos[tipo];
                if (p && p.valor > 0) {
                    const inp = document.getElementById('mudar-plano-valor');
                    if (inp) inp.value = p.valor.toFixed(2);
                }
            });
        } catch(e) {}
    },

    async buscarAlunoMudarPlano() {
        const termo = document.getElementById('mudar-plano-busca')?.value.trim().toLowerCase();
        const lista = document.getElementById('mudar-plano-lista');
        if (!lista || !termo || termo.length < 2) { if(lista) lista.innerHTML = ''; return; }
        const snap = await db.collection('alunos').orderBy('nome').get();
        const res = snap.docs.filter(d => d.data().nome.toLowerCase().includes(termo)).slice(0, 6);
        lista.innerHTML = res.map(doc => {
            const a = doc.data();
            const planoLabel = a.plano ? `<span style="color:#a78bfa;font-size:0.58rem;">(${a.plano}${a.planoValor > 0 ? ' — R$ ' + a.planoValor.toFixed(2) : ''})</span>` : '<span style="color:#f59e0b;font-size:0.58rem;">(sem plano)</span>';
            return `<div onclick="GaditasPainelAdm.selecionarAlunoMudarPlano('${doc.id}','${a.nome.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${a.plano||''}',${a.planoValor||0})"
                style="background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:0.8rem;color:#e2e8f0;font-weight:600;"
                onmouseover="this.style.borderColor='#8b5cf6'" onmouseout="this.style.borderColor='#334155'">
                👤 ${a.nome.toUpperCase()} ${planoLabel}
            </div>`;
        }).join('');
    },

    selecionarAlunoMudarPlano(id, nome, planoAtual, valorAtual) {
        this._alunoMudarPlano = { id, nome };
        document.getElementById('mudar-plano-lista').innerHTML = '';
        document.getElementById('mudar-plano-busca').value = '';
        const div = document.getElementById('mudar-plano-aluno-selecionado');
        div.classList.remove('hidden');
        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:0.85rem;font-weight:800;color:white;">${nome.toUpperCase()}</div>
                    <div style="font-size:0.62rem;color:#a78bfa;margin-top:2px;">Plano atual: ${planoAtual || '—'} ${valorAtual > 0 ? '(R$ ' + valorAtual.toFixed(2) + '/mês)' : ''}</div>
                </div>
                <button onclick="GaditasPainelAdm._limparMudarPlano()" style="background:none;border:none;color:#f43f5e;cursor:pointer;font-size:0.9rem;font-weight:700;padding:4px 8px;">✕</button>
            </div>`;
        if (planoAtual) this._selecionarMudarPlano(planoAtual);
        if (valorAtual > 0) { const inp = document.getElementById('mudar-plano-valor'); if(inp) inp.value = valorAtual.toFixed(2); }
    },

    _limparMudarPlano() {
        this._alunoMudarPlano = null;
        document.getElementById('mudar-plano-aluno-selecionado').classList.add('hidden');
        document.getElementById('mudar-plano-aluno-selecionado').innerHTML = '';
        document.getElementById('mudar-plano-busca').value = '';
        document.getElementById('mudar-plano-lista').innerHTML = '';
        document.getElementById('mudar-plano-resultado').innerHTML = '';
        document.getElementById('mudar-plano-valor').value = '';
    },

    async confirmarMudancaPlano() {
        if (!this._alunoMudarPlano) return alert('Selecione um aluno.');
        const novoValor = parseFloat(document.getElementById('mudar-plano-valor')?.value);
        const planoKey = this._novoPlanoKey;
        const labelMap = { mensal:'Plano Mensal', trimestral:'Plano Trimestral', semestral:'Plano Semestral', anual:'Plano Anual', livre:'Plano Livre', familia:'Plano Família' };
        const resultado = document.getElementById('mudar-plano-resultado');

        if (isNaN(novoValor) || novoValor <= 0) return alert('Informe o valor do novo plano.');
        if (!confirm(`Mudar plano de ${this._alunoMudarPlano.nome} para ${labelMap[planoKey]} — R$ ${novoValor.toFixed(2)}/mês?\n\nAtenção: isso atualiza apenas o sistema. Cancele a assinatura antiga no Asaas manualmente se necessário.`)) return;

        try {
            await db.collection('alunos').doc(this._alunoMudarPlano.id).update({
                plano: planoKey,
                planoLabel: labelMap[planoKey],
                planoValor: novoValor,
            });
            resultado.innerHTML = `<div style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:10px;font-size:0.78rem;color:#34d399;font-weight:700;margin-top:4px;">✅ Plano de ${this._alunoMudarPlano.nome} atualizado para ${labelMap[planoKey]} — R$ ${novoValor.toFixed(2)}/mês</div>`;
            this._limparMudarPlano();
        } catch(e) { resultado.innerHTML = `<div style="background:#1c0a00;border:1px solid #f43f5e;border-radius:8px;padding:10px;font-size:0.78rem;color:#f43f5e;font-weight:700;">❌ ${e.message}</div>`; }
    },

    // ══════════════════════════════════════════════════════════
    // VINCULAR DEPENDENTE — PLANO FAMÍLIA
    // ══════════════════════════════════════════════════════════

    _titular: null,
    _dependente: null,

    async buscarTitularFamilia() {
        const termo = document.getElementById('dep-busca-titular')?.value.trim().toLowerCase();
        const lista = document.getElementById('dep-lista-titular');
        if (!lista || !termo || termo.length < 2) { if(lista) lista.innerHTML = ''; return; }
        const snap = await db.collection('alunos').orderBy('nome').get();
        const res = snap.docs.filter(d => d.data().nome.toLowerCase().includes(termo)).slice(0, 6);
        lista.innerHTML = res.map(doc => {
            const a = doc.data();
            return `<div onclick="GaditasPainelAdm.selecionarTitular('${doc.id}','${a.nome.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')"
                style="background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:0.8rem;color:#e2e8f0;font-weight:600;"
                onmouseover="this.style.borderColor='#10b981'" onmouseout="this.style.borderColor='#334155'">
                👤 ${a.nome.toUpperCase()} <span style="color:#64748b;font-size:0.58rem;">(${a.plano || 'sem plano'})</span>
            </div>`;
        }).join('');
    },

    async selecionarTitular(id, nome) {
        this._titular = { id, nome };
        document.getElementById('dep-lista-titular').innerHTML = '';
        document.getElementById('dep-busca-titular').value = '';
        await this._renderTitularCard();
    },

    async _renderTitularCard() {
        const { id, nome } = this._titular;
        const div = document.getElementById('dep-titular-selecionado');
        div.classList.remove('hidden');

        // Busca dependentes já vinculados
        const snap = await db.collection('alunos').where('responsavelId', '==', id).get();
        const dependentesAtuais = snap.docs.map(d => ({ id: d.id, nome: d.data().nome }));

        const listaDeps = dependentesAtuais.length
            ? `<div style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">
                <div style="font-size:0.58rem; color:#64748b; font-weight:800; margin-bottom:6px; letter-spacing:0.5px;">DEPENDENTES VINCULADOS (${dependentesAtuais.length}):</div>
                ${dependentesAtuais.map(dep => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; border-radius:8px; padding:8px 10px; margin-bottom:5px;">
                        <span style="font-size:0.78rem; font-weight:700; color:#e2e8f0;">👤 ${dep.nome.toUpperCase()}</span>
                        <button onclick="GaditasPainelAdm._removerVinculoLista('${dep.id}','${dep.nome.replace(/'/g,"\\'")}')"
                            style="background:none;border:none;color:#f43f5e;cursor:pointer;font-size:0.75rem;font-weight:700;padding:2px 6px;">✕ Remover</button>
                    </div>`).join('')}
               </div>`
            : `<div style="margin-top:8px; font-size:0.65rem; color:#475569; font-style:italic;">Nenhum dependente vinculado ainda.</div>`;

        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:0.7rem;font-weight:800;color:#10b981;">💳 TITULAR (quem paga)</div>
                    <div style="font-size:0.85rem;font-weight:800;color:white;margin-top:2px;">${nome.toUpperCase()}</div>
                </div>
                <button onclick="GaditasPainelAdm._limparTitular()" style="background:none;border:none;color:#f43f5e;cursor:pointer;font-size:0.9rem;padding:4px 8px;">✕</button>
            </div>
            ${listaDeps}`;
    },

    async _removerVinculoLista(depId, depNome) {
        if (!confirm(`Remover vínculo de ${depNome}?`)) return;
        try {
            await db.collection('alunos').doc(depId).update({
                responsavelId:   firebase.firestore.FieldValue.delete(),
                responsavelNome: firebase.firestore.FieldValue.delete(),
            });
            // Atualiza o card do titular sem precisar reselecionar
            await this._renderTitularCard();
            document.getElementById('dep-resultado').innerHTML =
                `<div style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:8px 10px;font-size:0.75rem;color:#34d399;font-weight:700;">✅ ${depNome} desvinculado.</div>`;
        } catch(e) { alert('Erro: ' + e.message); }
    },

    _limparTitular() {
        this._titular = null;
        document.getElementById('dep-titular-selecionado').classList.add('hidden');
        document.getElementById('dep-titular-selecionado').innerHTML = '';
        document.getElementById('dep-busca-titular').value = '';
        document.getElementById('dep-lista-titular').innerHTML = '';
    },

    async buscarDependente() {
        const termo = document.getElementById('dep-busca-dependente')?.value.trim().toLowerCase();
        const lista = document.getElementById('dep-lista-dependente');
        if (!lista || !termo || termo.length < 2) { if(lista) lista.innerHTML = ''; return; }
        const snap = await db.collection('alunos').orderBy('nome').get();
        const res = snap.docs.filter(d => d.data().nome.toLowerCase().includes(termo)).slice(0, 6);
        lista.innerHTML = res.map(doc => {
            const a = doc.data();
            const vinculo = a.responsavelId ? `<span style="color:#f59e0b;font-size:0.58rem;">(já vinculado)</span>` : '';
            return `<div onclick="GaditasPainelAdm.selecionarDependente('${doc.id}','${a.nome.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${a.responsavelId||''}')"
                style="background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:0.8rem;color:#e2e8f0;font-weight:600;"
                onmouseover="this.style.borderColor='#f43f5e'" onmouseout="this.style.borderColor='#334155'">
                👤 ${a.nome.toUpperCase()} ${vinculo}
            </div>`;
        }).join('');
    },

    selecionarDependente(id, nome, responsavelIdAtual) {
        this._dependente = { id, nome };
        document.getElementById('dep-lista-dependente').innerHTML = '';
        document.getElementById('dep-busca-dependente').value = '';
        const div = document.getElementById('dep-dependente-selecionado');
        div.classList.remove('hidden');
        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:0.7rem;font-weight:800;color:#f43f5e;">👤 DEPENDENTE</div>
                    <div style="font-size:0.85rem;font-weight:800;color:white;margin-top:2px;">${nome.toUpperCase()}</div>
                    ${responsavelIdAtual ? '<div style="font-size:0.58rem;color:#f59e0b;margin-top:2px;">⚠️ Já possui vínculo — será substituído</div>' : ''}
                </div>
                <button onclick="GaditasPainelAdm._limparDependente()" style="background:none;border:none;color:#f43f5e;cursor:pointer;font-size:0.9rem;padding:4px 8px;">✕</button>
            </div>`;
    },

    _limparDependente() {
        this._dependente = null;
        document.getElementById('dep-dependente-selecionado').classList.add('hidden');
        document.getElementById('dep-dependente-selecionado').innerHTML = '';
        document.getElementById('dep-busca-dependente').value = '';
        document.getElementById('dep-lista-dependente').innerHTML = '';
    },

    async vincularDependente() {
        const resultado = document.getElementById('dep-resultado');
        if (!this._titular) return alert('Selecione o titular.');
        if (!this._dependente) return alert('Selecione o dependente.');
        if (this._titular.id === this._dependente.id) return alert('Titular e dependente não podem ser o mesmo aluno.');

        if (!confirm(`Vincular ${this._dependente.nome} como dependente de ${this._titular.nome}?\n\n• O dependente NÃO verá a aba Financeiro\n• O pagamento fica com o titular`)) return;

        try {
            await db.collection('alunos').doc(this._dependente.id).update({
                responsavelId:    this._titular.id,
                responsavelNome:  this._titular.nome,
                plano:            'familia',
                planoLabel:       'Plano Família',
            });
            resultado.innerHTML = `<div style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:10px;font-size:0.78rem;color:#34d399;font-weight:700;">✅ ${this._dependente.nome} vinculado! Adicione mais dependentes abaixo.</div>`;
            // Limpa só o dependente — titular fica selecionado para adicionar mais
            this._limparDependente();
            // Atualiza a lista de dependentes do titular
            await this._renderTitularCard();
        } catch(e) { resultado.innerHTML = `<div style="background:#1c0a00;border:1px solid #f43f5e;border-radius:8px;padding:10px;font-size:0.78rem;color:#f43f5e;font-weight:700;">❌ ${e.message}</div>`; }
    },

    async desvincularDependente() {
        const resultado = document.getElementById('dep-resultado');
        if (!this._dependente) return alert('Selecione o dependente a desvincular na lista acima.');
        if (!confirm(`Desvincular ${this._dependente.nome}?\n\nEle voltará a ser um aluno independente e verá o Financeiro normalmente.`)) return;
        try {
            await db.collection('alunos').doc(this._dependente.id).update({
                responsavelId:   firebase.firestore.FieldValue.delete(),
                responsavelNome: firebase.firestore.FieldValue.delete(),
            });
            resultado.innerHTML = `<div style="background:#064e3b;border:1px solid #10b981;border-radius:8px;padding:10px;font-size:0.78rem;color:#34d399;font-weight:700;">✅ ${this._dependente.nome} desvinculado com sucesso!</div>`;
            this._limparDependente();
            if (this._titular) await this._renderTitularCard();
        } catch(e) { resultado.innerHTML = `<div style="background:#1c0a00;border:1px solid #f43f5e;border-radius:8px;padding:10px;font-size:0.78rem;color:#f43f5e;font-weight:700;">❌ ${e.message}</div>`; }
    },

    // ══════════════════════════════════════════════════════════
    // CRIAR PLANO / ASSINATURA RECORRENTE
    // ══════════════════════════════════════════════════════════

    _tipoPlanoAtual: 'mensal',

    _selecionarTipoPlano(tipo) {
        this._tipoPlanoAtual = tipo;
        const todos = ['mensal','trimestral','semestral','anual','livre','familia'];
        todos.forEach(t => {
            const btn = document.getElementById('plano-btn-' + t);
            if (!btn) return;
            if (t === tipo) {
                btn.style.background = '#10b981';
                btn.style.border = 'none';
                btn.style.color = 'white';
            } else {
                btn.style.background = '#0f172a';
                btn.style.border = '1px solid #334155';
                btn.style.color = '#94a3b8';
            }
        });
        // Preenche valor sugerido do plano se configurado
        try {
            academia.carregarConfiguracaoPlanos().then(planos => {
                const p = planos[tipo];
                if (p && p.valor > 0) {
                    const input = document.getElementById('plano-valor');
                    if (input && !input.value) input.value = p.valor.toFixed(2);
                }
            });
        } catch(e) {}
    },

    async buscarAlunoPlano() {
        const termo = document.getElementById('plano-busca-aluno')?.value.trim().toLowerCase();
        const lista = document.getElementById('plano-lista-alunos');
        if (!lista) return;
        if (!termo || termo.length < 2) { lista.innerHTML = ''; return; }
        try {
            const snap = await db.collection('alunos').orderBy('nome').get();
            const resultados = snap.docs.filter(d => d.data().nome.toLowerCase().includes(termo)).slice(0, 6);
            if (!resultados.length) { lista.innerHTML = '<small style="color:#64748b;font-size:0.75rem;padding:6px;display:block;">Nenhum aluno encontrado.</small>'; return; }
            lista.innerHTML = resultados.map(doc => {
                const a = doc.data();
                const planoAtual = a.plano ? ` <span style="color:#10b981;font-size:0.58rem;">(${a.plano})</span>` : ' <span style="color:#f59e0b;font-size:0.58rem;">(sem plano)</span>';
                return `<div onclick="GaditasPainelAdm.selecionarAlunoPlano('${doc.id}','${a.nome.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${a.email||''}','${a.asaasId||''}','${(a.cpf||'').replace(/\D/g,'')}')"
                    style="background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;margin-bottom:5px;cursor:pointer;font-size:0.8rem;color:#e2e8f0;font-weight:600;"
                    onmouseover="this.style.borderColor='#10b981'" onmouseout="this.style.borderColor='#334155'">
                    👤 ${a.nome.toUpperCase()}${planoAtual}
                    <small style="color:#64748b;display:block;font-size:0.6rem;margin-top:2px;">${a.email||''}</small>
                </div>`;
            }).join('');
        } catch(e) { lista.innerHTML = '<small style="color:#f43f5e;font-size:0.7rem;">Erro ao buscar.</small>'; }
    },

    async selecionarAlunoPlano(id, nome, email, asaasId, cpf) {
        document.getElementById('plano-lista-alunos').innerHTML = '';
        document.getElementById('plano-busca-aluno').value = '';

        // Busca dados completos do aluno
        let cpfFinal = cpf || '';
        let planoAtual = '';
        try {
            const doc = await db.collection('alunos').doc(id).get();
            const d = doc.data() || {};
            cpfFinal = (d.cpf || '').replace(/\D/g, '');
            planoAtual = d.plano || '';
            if (d.planoValor > 0) {
                const inp = document.getElementById('plano-valor');
                if (inp) inp.value = d.planoValor.toFixed(2);
            }
            if (planoAtual) this._selecionarTipoPlano(planoAtual);
        } catch(e) {}

        this._alunoPlano = { id, nome, email, asaasId, cpf: cpfFinal };

        const div = document.getElementById('plano-aluno-selecionado');
        div.classList.remove('hidden');

        const semCpf = !cpfFinal || cpfFinal.length !== 11;
        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-size:0.85rem;font-weight:800;color:white;">✅ ${nome.toUpperCase()}</div>
                    <div style="font-size:0.6rem;color:#64748b;margin-top:2px;">${email}</div>
                    ${cpfFinal ? `<div style="font-size:0.6rem;color:#10b981;margin-top:2px;">CPF: ${cpfFinal.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4')}</div>` : ''}
                    ${planoAtual ? `<div style="font-size:0.6rem;color:#f59e0b;margin-top:2px;">Plano atual: ${planoAtual}</div>` : '<div style="font-size:0.6rem;color:#f43f5e;margin-top:2px;">⚠️ Sem plano cadastrado</div>'}
                </div>
                <button onclick="GaditasPainelAdm._limparAlunoPlano()" style="background:none;border:none;color:#f43f5e;cursor:pointer;font-size:0.9rem;font-weight:700;padding:4px 8px;">✕</button>
            </div>
            ${semCpf ? `
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid #334155;">
                <small style="color:#f43f5e;font-size:0.6rem;font-weight:800;display:block;margin-bottom:5px;">⚠️ SEM CPF — necessário para criar plano no Asaas:</small>
                <div style="display:flex;gap:6px;">
                    <input type="text" id="plano-cpf-inline" maxlength="11" placeholder="11 dígitos sem pontos"
                        style="flex:1;padding:9px;background:#1e293b;border:1px solid #f43f5e;color:white;border-radius:8px;outline:none;font-size:0.8rem;font-weight:700;"
                        oninput="this.value=this.value.replace(/\\D/g,'')"/>
                    <button onclick="GaditasPainelAdm._salvarCpfPlano()"
                        style="background:#f43f5e;border:none;color:white;padding:9px 12px;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.7rem;white-space:nowrap;">SALVAR CPF</button>
                </div>
            </div>` : ''}`;
    },

    async _salvarCpfPlano() {
        const cpf = (document.getElementById('plano-cpf-inline')?.value || '').replace(/\D/g, '');
        if (cpf.length !== 11) { alert('CPF inválido.'); return; }
        if (!this._alunoPlano) return;
        await db.collection('alunos').doc(this._alunoPlano.id).update({ cpf });
        this._alunoPlano.cpf = cpf;
        const div = document.getElementById('plano-aluno-selecionado').querySelector('div[style*="border-top"]');
        if (div) div.innerHTML = `<div style="font-size:0.65rem;color:#10b981;font-weight:800;margin-top:6px;">✅ CPF salvo: ${cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4')}</div>`;
        alert('✅ CPF salvo!');
    },

    _limparAlunoPlano() {
        this._alunoPlano = null;
        this._tipoPlanoAtual = 'mensal';
        document.getElementById('plano-aluno-selecionado').classList.add('hidden');
        document.getElementById('plano-aluno-selecionado').innerHTML = '';
        document.getElementById('plano-busca-aluno').value = '';
        document.getElementById('plano-lista-alunos').innerHTML = '';
        document.getElementById('plano-valor').value = '';
        document.getElementById('plano-resultado').innerHTML = '';
    },

    async criarPlanoAsaas() {
        const resultado = document.getElementById('plano-resultado');
        if (!this._alunoPlano) return alert('Selecione um aluno primeiro.');

        const valor      = parseFloat(document.getElementById('plano-valor')?.value);
        const vencimento = document.getElementById('plano-vencimento')?.value;
        const tipo       = document.getElementById('plano-tipo')?.value;
        const planoKey   = this._tipoPlanoAtual || 'mensal';

        if (isNaN(valor) || valor <= 0) return alert('Informe o valor do plano.');
        if (!vencimento) return alert('Informe a data do 1º vencimento.');

        const cpfAluno = (this._alunoPlano.cpf || '').replace(/\D/g, '');
        if (!cpfAluno || cpfAluno.length !== 11) {
            if (resultado) resultado.innerHTML = '<div style="background:#1c0a00;border:1px solid #f43f5e;border-radius:8px;padding:10px;font-size:0.75rem;color:#f43f5e;font-weight:700;">❌ Preencha e salve o CPF do aluno primeiro.</div>';
            return;
        }

        const cicloMap = { mensal:'MONTHLY', trimestral:'QUARTERLY', semestral:'SEMIANNUALLY', anual:'YEARLY', livre:'MONTHLY', familia:'MONTHLY' };
        const labelMap = { mensal:'Plano Mensal', trimestral:'Plano Trimestral', semestral:'Plano Semestral', anual:'Plano Anual', livre:'Plano Livre', familia:'Plano Família' };
        const ciclo = cicloMap[planoKey] || 'MONTHLY';
        const label = labelMap[planoKey] || 'Plano Mensal';

        const btn = document.querySelector('[onclick="GaditasPainelAdm.criarPlanoAsaas()"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
        if (resultado) resultado.innerHTML = '';

        try {
            const { nome, email, id: alunoId, asaasId: asaasIdSalvo } = this._alunoPlano;

            // 1. Garante cliente no Asaas
            let asaasId = asaasIdSalvo;
            if (!asaasId) {
                const resBusca = await fetch('/api/asaas?endpoint=customers&email=' + encodeURIComponent(email));
                const dadosBusca = await resBusca.json();
                if (dadosBusca.data?.length > 0) {
                    asaasId = dadosBusca.data[0].id;
                    const cpfNoAsaas = (dadosBusca.data[0].cpfCnpj || '').replace(/\D/g,'');
                    if (!cpfNoAsaas) {
                        await fetch('/api/asaas?endpoint=customers/' + asaasId, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: nome, email, cpfCnpj: cpfAluno })
                        });
                    }
                } else {
                    const resCriar = await fetch('/api/asaas?endpoint=customers', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: nome, email, cpfCnpj: cpfAluno })
                    });
                    const criado = await resCriar.json();
                    if (!criado.id) throw new Error(criado.errors?.[0]?.description || 'Erro ao criar cliente.');
                    asaasId = criado.id;
                }
                await db.collection('alunos').doc(alunoId).update({ asaasId });
            }

            // 2. Cria assinatura recorrente no Asaas
            const resAssin = await fetch('/api/asaas?endpoint=subscriptions', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer:    asaasId,
                    billingType: tipo,
                    value:       valor,
                    nextDueDate: vencimento,
                    cycle:       ciclo,
                    description: label + ' — Gaditas Academy'
                })
            });
            const assin = await resAssin.json();
            if (!assin.id) throw new Error(assin.errors?.[0]?.description || 'Erro ao criar assinatura.');

            // 3. Salva no Firestore do aluno
            await db.collection('alunos').doc(alunoId).update({
                plano:           planoKey,
                planoLabel:      label,
                planoValor:      valor,
                asaasId:         asaasId,
                subscriptionId:  assin.id,
            });

            const valorFmt = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const vencFmt  = vencimento.split('-').reverse().join('/');

            resultado.innerHTML = `
                <div style="background:#064e3b;border:1px solid #10b981;border-radius:12px;padding:14px;margin-top:4px;">
                    <div style="font-size:0.7rem;font-weight:800;color:#10b981;margin-bottom:10px;">✅ PLANO CRIADO COM SUCESSO!</div>
                    <div style="font-size:0.85rem;font-weight:800;color:white;margin-bottom:4px;">${nome.toUpperCase()}</div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px;">
                        <span style="color:#94a3b8;">Plano:</span><strong style="color:#10b981;">${label}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px;">
                        <span style="color:#94a3b8;">Valor mensal:</span><strong style="color:#10b981;">${valorFmt}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px;">
                        <span style="color:#94a3b8;">1º vencimento:</span><span style="color:#e2e8f0;">${vencFmt}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:12px;">
                        <span style="color:#94a3b8;">Recorrência:</span><span style="color:#e2e8f0;">${ciclo}</span>
                    </div>
                    <div style="font-size:0.6rem;color:#6ee7b7;padding-top:8px;border-top:1px solid #10b98133;">
                        Assinatura Asaas: ${assin.id}<br>
                        O aluno já pode pagar via link gerado automaticamente pelo Asaas.
                    </div>
                </div>`;

            this._limparAlunoPlano();
        } catch(e) {
            if (resultado) resultado.innerHTML = `<div style="background:#1c0a00;border:1px solid #f43f5e;border-radius:8px;padding:12px;font-size:0.8rem;color:#f43f5e;font-weight:700;">❌ ${e.message}</div>`;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-contract"></i> CRIAR PLANO E GERAR 1ª COBRANÇA'; }
        }
    },

    // ── RESUMO FINANCEIRO DO MÊS ─────────────────────────────
    async carregarResumoMensal() {
        const container = document.getElementById('painel-resumo-mensal');
        if (!container) return;
        container.innerHTML = `<div style="text-align:center; padding:12px; color:#64748b; font-size:0.75rem;"><i class="fas fa-spinner fa-spin"></i> Calculando resumo do mês...</div>`;

        try {
            const agora = new Date();
            const anoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
            const mesNome = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

            const [resRecebidos, resOverdue] = await Promise.all([
                fetch(`/api/asaas?endpoint=payments&status=RECEIVED&limit=200`),
                fetch(`/api/asaas?endpoint=payments&status=OVERDUE&limit=200`)
            ]);

            const recebidos = await resRecebidos.json();
            const overdue   = await resOverdue.json();

            // Filtra recebidos no mês atual pela paymentDate ou dueDate
            const pagosEsteMes = (recebidos.data || []).filter(p =>
                (p.paymentDate || p.dueDate || '').startsWith(anoMes)
            );

            const totalRecebido = pagosEsteMes.reduce((s, p) => s + p.value, 0);
            const totalOverdue  = (overdue.data  || []).reduce((s, p) => s + p.value, 0);
            const totalGeral    = totalRecebido + totalOverdue;
            const pct           = totalGeral > 0 ? Math.round((totalRecebido / totalGeral) * 100) : 100;
            const corPct        = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#f43f5e';

            container.innerHTML = `
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:14px;">
                    <div style="font-size:0.65rem; font-weight:800; color:#94a3b8; margin-bottom:10px; letter-spacing:0.5px;">
                        📊 RESUMO FINANCEIRO — ${mesNome.toUpperCase()}
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:10px;">
                        <div style="background:#064e3b22; border:1px solid #10b98133; border-radius:8px; padding:10px; text-align:center;">
                            <span style="font-size:0.5rem; color:#34d399; font-weight:800; display:block; margin-bottom:3px;">✅ RECEBIDO</span>
                            <span style="font-size:0.75rem; font-weight:900; color:#10b981;">${totalRecebido.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                            <span style="font-size:0.5rem; color:#64748b; display:block;">${pagosEsteMes.length} pag.</span>
                        </div>
                        <div style="background:#4c051922; border:1px solid #f43f5e33; border-radius:8px; padding:10px; text-align:center;">
                            <span style="font-size:0.5rem; color:#f43f5e; font-weight:800; display:block; margin-bottom:3px;">⚠️ EM ATRASO</span>
                            <span style="font-size:0.75rem; font-weight:900; color:#f43f5e;">${totalOverdue.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                            <span style="font-size:0.5rem; color:#64748b; display:block;">${(overdue.data||[]).length} fat.</span>
                        </div>
                        <div style="background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px; text-align:center;">
                            <span style="font-size:0.5rem; color:#94a3b8; font-weight:800; display:block; margin-bottom:3px;">📈 ADIMPL.</span>
                            <span style="font-size:1.2rem; font-weight:900; color:${corPct};">${pct}%</span>
                        </div>
                    </div>
                    <div style="background:#1e293b; border-radius:6px; height:7px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:${corPct}; border-radius:6px;"></div>
                    </div>
                </div>`;
        } catch(e) {
            const container = document.getElementById('painel-resumo-mensal');
            if (container) container.innerHTML = `<div style="color:#f43f5e; text-align:center; font-size:0.75rem; padding:8px;">Erro no resumo: ${e.message}</div>`;
        }
    },

    // ── CANCELAR ASSINATURA PELO ADMIN ────────────────────────
    async cancelarAssinaturaAdmin(subscriptionId, nomeAluno) {
        if (!confirm(`Cancelar assinatura recorrente de ${nomeAluno}?\n\nO Asaas para de cobrar automaticamente. As faturas já existentes não são removidas.`)) return;
        try {
            const r = await fetch(`/api/asaas?endpoint=subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
            const d = await r.json();
            if (d.deleted === true || d.id) {
                alert(`✅ Assinatura de ${nomeAluno} cancelada com sucesso.`);
            } else {
                throw new Error(d.errors?.[0]?.description || JSON.stringify(d));
            }
        } catch(e) {
            alert('❌ Erro ao cancelar assinatura: ' + e.message);
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