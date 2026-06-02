const firebaseConfig = {
  apiKey: "AIzaSyCMTBh3za1b7JGQ9x9ECsG3VJNPF4hiHsI",
  authDomain: "gaditasmatriz.firebaseapp.com",
  projectId: "gaditasmatriz",
  storageBucket: "gaditasmatriz.firebasestorage.app",
  messagingSenderId: "166834416988",
  appId: "1:166834416988:web:2921c95c87c42019282599"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
// Storage inicializado de forma lazy para não quebrar se o script carregar fora de ordem
let _storage = null;
function getStorage() { if (!_storage) _storage = firebase.storage(); return _storage; }

const graduacao = {
    regrasAulas: {
        "Branca": { 0: 40, 1: 60, 2: 50, 3: 60, 4: 1 },
        "Azul": { 0: 60, 1: 65, 2: 70, 3: 75, 4: 1 },
        "Roxa": { 0: 50, 1: 55, 2: 60, 3: 65, 4: 1 },
        "Marrom": { 0: 40, 1: 50, 2: 55, 3: 60, 4: 1 },
        "Kids": { "Pré-Mirim": 12, "Mirim": 12, "Infanto": 20 }
    },
    infantil: ["Branca", "Cinza/Branca", "Cinza", "Cinza/Preta", "Amarela/Branca", "Amarela", "Amarela/Preta", "Laranja/Branca", "Laranja", "Laranja/Preta", "Verde/Branca", "Verde", "Verde/Preta"],
    adulto: ["Branca", "Azul", "Roxa", "Marrom", "Preta"],
    getFaixas(idade) { return idade <= 14 ? this.infantil : this.adulto; },
    getMaxGraus(faixa) { return faixa === "Preta" ? 6 : 4; }
};

// ── MUAY THAI — Sequência oficial de graduação ───────────
// Cada faixa É um nível; não há graus separados
const graduacaoMT = {
    faixas: [
        "Branco",
        "Branco ponta Vermelha",
        "Vermelha",
        "Vermelha ponta Azul Clara",
        "Azul Clara",
        "Azul Clara ponta Azul Escura",
        "Azul Escura",
        "Azul Escura ponta Preta",
        "Preta",
        "Preta ponta Branca",
        "Preta, Ponta Branca e Vermelha"
    ]
};

const auth = {
    adminCreds: { user: "admin", pass: "admin", nome: "Eric (Adm)", faixa: "Preta", grau: 3, modalidade: "jiujitsu" },
    role: null, currentUser: null,

    // Carrega credenciais do admin salvas no Firestore
    async carregarCredenciaisAdmin() {
        try {
            const doc = await db.collection('configuracoes').doc('admin_config').get();
            if (doc.exists) {
                const d = doc.data();
                if (d.user)       this.adminCreds.user      = d.user;
                if (d.pass)       this.adminCreds.pass      = d.pass;
                if (d.nome)       this.adminCreds.nome      = d.nome;
                if (d.faixa)      this.adminCreds.faixa     = d.faixa;
                if (d.grau  != null) this.adminCreds.grau   = d.grau;
                if (d.modalidade) this.adminCreds.modalidade = d.modalidade;
            }
        } catch(e) { console.warn('carregarCredenciaisAdmin:', e.message); }
    },

    async login() {
        const u = document.getElementById('user').value.trim().toLowerCase();
        const p = document.getElementById('pass').value.trim();

        // Login admin local
        if (u === this.adminCreds.user && p === this.adminCreds.pass) {
            this.role = 'admin'; this.currentUser = {
                id: 'admin',
                nome:      this.adminCreds.nome       || 'Admin',
                faixa:     this.adminCreds.faixa      || 'Preta',
                grau:      this.adminCreds.grau       ?? 3,
                modalidade: this.adminCreds.modalidade || 'jiujitsu'
            };
            // Aguarda auth anônimo antes de entrar (necessário para Firestore/Storage)
            try { await firebase.auth().signInAnonymously(); }
            catch(e) { console.warn('anon-auth admin:', e.message); }
            return this.sucesso();
        }

        try {
            // ── Passo 1: tenta Firebase Auth primeiro ─────────────────
            // Isso autentica o usuário ANTES de qualquer query Firestore,
            // evitando erros de permissão com as Storage Rules.
            let fbAutenticado = false;
            try {
                await firebase.auth().signInWithEmailAndPassword(u, p);
                fbAutenticado = true;
            } catch(authErr) {
                // Pode ser professor (sem conta Firebase Auth) ou senha errada
                // Continua para verificar via Firestore com auth anônimo
            }

            if (fbAutenticado) {
                // Já autenticado — busca dados no Firestore com segurança
                const aS = await db.collection("alunos").where("email", "==", u).get();
                if (!aS.empty) {
                    const d = aS.docs[0].data();
                    this.role = d.role === 'professor' ? 'professor' : 'aluno';
                    this.currentUser = { id: aS.docs[0].id, ...d };
                    return this.sucesso();
                }
                return alert("Usuário autenticado mas não encontrado na academia. Contate o admin.");
            }

            // ── Passo 2: sem Firebase Auth — garante sessão para acessar Firestore
            if (!firebase.auth().currentUser) {
                try { await firebase.auth().signInAnonymously(); }
                catch(e) { console.warn('anon fallback:', e.message); }
            }

            // ── Passo 3: verifica professor (senha local no Firestore) ─
            const pS = await db.collection("professores").where("email", "==", u).get();
            if (!pS.empty) {
                const d = pS.docs[0].data();
                if (d.senha === p || p === "1234") {
                    this.role = 'professor';
                    this.currentUser = { id: pS.docs[0].id, ...d };
                    return this.sucesso();
                }
                return alert("Senha incorreta.");
            }

            // ── Passo 4: verifica aluno com senha local (sem conta Firebase) ─
            const aS2 = await db.collection("alunos").where("email", "==", u).get();
            if (!aS2.empty) {
                const d = aS2.docs[0].data();
                if (d.senha === p || p === "1234") {
                    this.role = d.role === 'professor' ? 'professor' : 'aluno';
                    this.currentUser = { id: aS2.docs[0].id, ...d };
                    return this.sucesso();
                }
                return alert("Senha incorreta.");
            }

            alert("Acesso negado. Usuário não encontrado.");
        } catch (e) {
            console.error('login error:', e);
            alert("Erro ao fazer login: " + e.message);
        }
    },
    sucesso() {
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('screen-dashboard').classList.remove('hidden');
        document.getElementById('display-user').innerText = this.currentUser.nome;
        // Mostra ícone de configurações só para admin
        const btnCfg = document.getElementById('btn-config-admin');
        if (btnCfg) btnCfg.style.display = this.role === 'admin' ? 'inline-block' : 'none';
        // Exibe faixa/grau no cabeçalho (só para alunos)
        this._renderFaixaHeader();
        ui.configurarVisao();
        ui.showTab('tab-checkin');
        academia.carregarGradeFirebase();
        academia.carregarMural();
        academia.carregarConquistas();
        academia.carregarBibliotecaTecnica();
        academia.renderStoriesBar();

        // Mostra wrapper de perfil para aluno e professor
        if (this.role === 'aluno' || this.role === 'professor') {
            const wp = document.getElementById('wrapper-perfil-proprio');
            if (wp) wp.classList.remove('hidden');
        }

        // ── LISTENERS RELATOS DE SAÚDE ────────────────────
        if (this.role === 'aluno') academia.iniciarListenerRelatoAluno();
        if (this.role === 'admin' || this.role === 'professor') academia.iniciarListenerRelatosProf();
        // Badge de depoimentos aprovados (carrega em background)
        academia._carregarBadgeDepoimentos();

        // ── CHECK-IN AUTOMÁTICO VIA QR CODE ──────────────
        if (this.role === 'aluno') {
            const turmaQR = sessionStorage.getItem('qr_turma');
            if (turmaQR) {
                sessionStorage.removeItem('qr_turma');
                setTimeout(() => academia.processarCheckinQR(turmaQR, this.currentUser.id), 1500);
            }
        }

        // Carrega foto no header
        if (this.currentUser.id && this.currentUser.id !== 'admin') {
            setTimeout(() => {
                db.collection("alunos").doc(this.currentUser.id).get().then(doc => {
                    if (doc.exists && doc.data().fotoPerfil && typeof GaditasFiltros !== 'undefined') {
                        GaditasFiltros.atualizarFotoHeader(doc.data().fotoPerfil);
                    }
                }).catch(() => {});
            }, 600);
        }
    },
    _renderFaixaHeader() {
        try {
            const el = document.getElementById('display-faixa-header');
            if (!el || (this.role !== 'aluno' && this.role !== 'admin')) return;
            const u = this.currentUser;
            const mod = u.modalidade || 'jiujitsu';
            let html = '';
            // Barras visuais reais — renderBeltJJ/MT pertencem ao objeto ui
            if (mod !== 'muaythai' && u.faixa) {
                html += ui.renderBeltJJ(u.faixa, u.grau || 0);
            }
            if (mod === 'muaythai' || mod === 'ambos') {
                html += ui.renderBeltMT(u.faixaMT || 'Branco');
            }
            // Legenda textual abaixo das barras
            let label = '';
            if (mod === 'jiujitsu') {
                label = `${u.faixa || 'Branca'} · ${u.grau || 0}ºG`;
            } else if (mod === 'muaythai') {
                label = `${u.faixaMT || 'Branco'} · MT`;
            } else {
                label = `${u.faixa || 'Branca'} ${u.grau || 0}ºG (JJ) · ${u.faixaMT || 'Branco'} (MT)`;
            }
            html += `<div style="font-size:0.58rem; color:#64748b; font-weight:600; margin-top:2px;">${label}</div>`;
            el.innerHTML = html;
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
        } catch(e) { console.warn('_renderFaixaHeader error:', e.message); }
    },
    logout() {
        firebase.auth().signOut().catch(() => {});
        window.location.reload();
    }
};

const academia = {
    idUltimoAvisoMural: null,
    categoriaFiltroAtual: "all",
    modalidadeFiltroAtual: "all",
    _modalidadeAtual: "jiujitsu",
    textoBuscaNome: "",
    filtroInativos: false,
    leoesFichaTemp: { leaoAtencao: 0, leaoComportamento: 0, leaoCompanheirismo: 0, leaoDisciplina: 0 },

    gradeHorarios: {
        1: ["06:00 - BJJ", "16:00 - BJJ", "17:40 - Kids 1", "18:30 - Kids 2", "20:20 - BJJ"],
        2: ["16:00 - Submission", "19:00 - Kids 1 e 2", "20:00 - Submission", "22:30 - BJJ"],
        3: ["06:00 - BJJ", "16:00 - BJJ", "17:40 - Kids 1", "18:30 - Kids 2", "20:20 - BJJ"],
        4: ["16:00 - Submission", "19:00 - Kids 1 e 2", "20:00 - Submission", "22:30 - BJJ"],
        5: ["06:00 - BJJ", "16:00 - BJJ", "17:40 - Kids 1", "18:30 - Kids 2", "20:20 - BJJ"],
        6: ["09:30 - Submission"],
        0: ["Sem treinos hoje"]
    },
    gradeFirebase: null,
    _modoEdicaoHorarios: false,

    toggleHistoricoTreinos() {
        const x = document.getElementById('secao-historico-treinos-aluno');
        if(x) x.classList.toggle('hidden');
    },

    async lancarPresencaManualAdmin(alunoId, alunoNome) {
        const turmasDisponiveis = [...new Set(Object.values(this.getGrade()).flat())].filter(t => !t.includes("Sem treinos"));
        let mMenu = `Selecione o número da turma para ${alunoNome.toUpperCase()}:\n\n`;
        turmasDisponiveis.forEach((t, i) => { mMenu += `${i + 1}. ${t}\n`; });
        const escolha = prompt(mMenu); if (!escolha) return; 
        const index = parseInt(escolha) - 1;
        if (isNaN(index) || index < 0 || index >= turmasDisponiveis.length) return alert("Opção inválida.");
        try {
            const ref = db.collection("alunos").doc(alunoId); const doc = await ref.get(); if (!doc.exists) return;
            const d = doc.data(); const h = d.historico || [];
            const turmaSel = turmasDisponiveis[index];
            h.unshift({ data: new Date().toLocaleString('pt-BR'), turma: turmaSel, tipo: "Presença Manual (Adm/Prof)" });
            const isMTManual = this._isTurmaMT(turmaSel);
            const updManual = { historico: h };
            if (isMTManual) updManual.aulasMT = (d.aulasMT || 0) + 1;
            else             updManual.aulas   = (d.aulas   || 0) + 1;
            await ref.update(updManual);
            alert("✅ Presença inserida!"); this.renderAlunos(); this.renderRanking();
        } catch (e) { alert("Erro ao lançar."); }
    },

    filtrarCategoriaAlunos(tipo) {
        this.categoriaFiltroAtual = tipo;
        const botoes = { all: "filter-btn-all", adult: "filter-btn-adult", kids: "filter-btn-kids" };
        for (const key in botoes) {
            const btn = document.getElementById(botoes[key]); if (!btn) continue;
            if (key === tipo) { btn.style.background = "var(--accent-blue)"; btn.style.color = "white"; }
            else { btn.style.background = "transparent"; btn.style.color = "var(--text-secondary)"; }
        }
        this.renderAlunos();
    },

    filtrarPorNomeDigitado() {
        const input = document.getElementById('input-busca-aluno');
        this.textoBuscaNome = input ? input.value.trim().toLowerCase() : "";
        this.renderAlunos();
    },

    // ── SELETOR DE MODALIDADE (formulário de cadastro) ──────
    selecionarModalidade(mod) {
        this._modalidadeAtual = mod;
        const mapa = { jiujitsu: 'btn-modal-jj', muaythai: 'btn-modal-mt', ambos: 'btn-modal-ambos' };
        Object.keys(mapa).forEach(k => {
            const btn = document.getElementById(mapa[k]);
            if (!btn) return;
            const ativo = k === mod;
            btn.style.background = ativo ? '#3b82f6' : '#0f172a';
            btn.style.color     = ativo ? 'white' : '#94a3b8';
            btn.style.border    = ativo ? 'none' : '1px solid #334155';
        });
        const jjSec = document.getElementById('section-grad-jj');
        const mtSec = document.getElementById('section-grad-mt');
        if (jjSec) jjSec.classList.toggle('hidden', mod === 'muaythai');
        if (mtSec) mtSec.classList.toggle('hidden', mod === 'jiujitsu');
    },

    // ── FILTRO DE MODALIDADE (lista de atletas) ─────────────
    filtrarModalidade(mod) {
        this.modalidadeFiltroAtual = mod;
        ['all', 'jiujitsu', 'muaythai'].forEach(k => {
            const btn = document.getElementById(`filtro-modal-${k}`);
            if (!btn) return;
            const ativo = k === mod;
            btn.style.background = ativo ? '#3b82f6' : '#0f172a';
            btn.style.color     = ativo ? 'white' : '#94a3b8';
            btn.style.border    = ativo ? 'none' : '1px solid #334155';
        });
        this.renderAlunos();
    },

    alterarLeaoFicha(campo, valor) {
        let actual = this.leoesFichaTemp[campo] || 0;
        let novo = Math.max(actual + valor, 0);
        this.leoesFichaTemp[campo] = novo;
        const lbl = document.getElementById(`label-qty-${campo}`);
        if(lbl) lbl.innerText = novo;
    },

    async calcularAnalyticsFrequencia() {
        const container = document.getElementById('analytics-frequencia-container'); if (!container) return;
        try {
            const snap = await db.collection("alunos").get();
            let totalPresencasGeral = 0; const contagemTurmas = {};
            snap.forEach(doc => {
                const a = doc.data(); const h = a.historico || []; totalPresencasGeral += h.length;
                h.forEach(treino => { if (treino.turma) contagemTurmas[treino.turma] = (contagemTurmas[treino.turma] || 0) + 1; });
            });
            let turmaCampeã = "Nenhum registo"; let maxPresencas = 0;
            for (const t in contagemTurmas) { if (contagemTurmas[t] > maxPresencas) { maxPresencas = contagemTurmas[t]; turmaCampeã = t; } }
            const mediaSemanal = totalPresencasGeral > 0 ? Math.round(totalPresencasGeral / 4) : 0;
            container.innerHTML = `
                <div style="background:#0f172a; padding:15px; border-radius:12px; border:1px solid var(--border-light); margin-top:15px;">
                    <h4 style="color:var(--accent-blue); margin:0 0 12px 0; font-size:0.75rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;"><i class="fas fa-chart-bar"></i> Indicadores Estatísticos de Frequência</h4>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; border-bottom:1px solid #1e293b; padding-bottom:6px;"><span style="color:var(--text-secondary);">Total Geral de Presenças:</span><strong style="color:white;">${totalPresencasGeral} treinos</strong></div>
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; border-bottom:1px solid #1e293b; padding-bottom:6px;"><span style="color:var(--text-secondary);">Fluxo Médio Semanal:</span><strong style="color:var(--accent-green);">${mediaSemanal} atletas/semana</strong></div>
                        <div style="display:flex; flex-direction:column; font-size:0.8rem; padding-top:2px;"><span style="color:var(--text-secondary); margin-bottom:4px;">Líder de Audiência no Tatame:</span><strong style="color:var(--accent-gold); font-size:0.85rem;"><i class="fas fa-trophy"></i> ${turmaCampeã.toUpperCase()} (${maxPresencas} check-ins)</strong></div>
                    </div>
                </div>`;
        } catch (e) { }
    },

    // ── CONFIGURAÇÃO DE PLANOS ─────────────────────────────
    async carregarConfiguracaoPlanos() {
        const doc = await db.collection('configuracoes').doc('planos').get();
        return doc.exists ? doc.data() : {
            mensal:     { valor: 120, label: 'Mensal',     ciclo: 'mês' },
            trimestral: { valor: 110, label: 'Trimestral', ciclo: 'mês' },
            semestral:  { valor: 100, label: 'Semestral',  ciclo: 'mês' },
            anual:      { valor: 90,  label: 'Anual',      ciclo: 'mês' }
        };
    },

    async salvarConfiguracaoPlanos() {
        const planos = {
            mensal:     { valor: parseFloat(document.getElementById('plano-val-mensal').value) || 120,     label: 'Mensal',     ciclo: 'mês' },
            trimestral: { valor: parseFloat(document.getElementById('plano-val-trimestral').value) || 110, label: 'Trimestral', ciclo: 'mês' },
            semestral:  { valor: parseFloat(document.getElementById('plano-val-semestral').value) || 100,  label: 'Semestral',  ciclo: 'mês' },
            anual:      { valor: parseFloat(document.getElementById('plano-val-anual').value) || 90,       label: 'Anual',      ciclo: 'mês' }
        };
        await db.collection('configuracoes').doc('planos').set(planos);
        alert("✅ Valores dos planos atualizados! Já refletem na página de cadastro.");
    },

    async renderPainelPlanos() {
        const container = document.getElementById('painel-config-planos');
        if (!container) return;
        const planos = await this.carregarConfiguracaoPlanos();
        container.innerHTML = `
            <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:15px; margin-bottom:15px;">
                <div style="font-size:0.7rem; font-weight:800; color:#f59e0b; margin-bottom:12px; letter-spacing:0.5px;">
                    <i class="fas fa-cog"></i> CONFIGURAR VALORES DOS PLANOS
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    ${['mensal','trimestral','semestral','anual'].map(key => `
                        <div>
                            <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">${planos[key].label.toUpperCase()} (R$/mês)</small>
                            <input type="number" id="plano-val-${key}" value="${planos[key].valor}" step="0.01"
                                style="width:100%; padding:10px; background:#1e293b; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.85rem; font-weight:700;"/>
                        </div>`).join('')}
                </div>
                <button onclick="academia.salvarConfiguracaoPlanos()" style="width:100%; margin-top:12px; padding:12px; background:#f59e0b; border:none; color:#000; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem;">
                    <i class="fas fa-save"></i> SALVAR VALORES
                </button>
            </div>`;
    },

    // ── ALERTAS DE NOVOS CADASTROS ──────────────────────────
    async carregarNovoCadastrosAlerta() {
        const container = document.getElementById('painel-novos-cadastros');
        if (!container) return;

        db.collection('novos_cadastros').orderBy('data', 'desc').limit(20).onSnapshot(snap => {
            if (snap.empty) {
                container.innerHTML = `<p style="color:#64748b; font-size:0.75rem; text-align:center; padding:10px;">Nenhum novo cadastro ainda.</p>`;
                return;
            }

            const naoLidos = snap.docs.filter(d => !d.data().lido).length;
            const badge = naoLidos > 0 ? `<span style="background:#f43f5e; color:white; font-size:0.6rem; padding:2px 8px; border-radius:10px; font-weight:800; margin-left:8px;">${naoLidos} NOVO${naoLidos > 1 ? 'S' : ''}</span>` : '';
            const cores = { mensal: '#3b82f6', trimestral: '#8b5cf6', semestral: '#10b981', anual: '#f59e0b' };

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:0.7rem; font-weight:800; color:#10b981;"><i class="fas fa-user-plus"></i> NOVOS CADASTROS ${badge}</span>
                    ${naoLidos > 0 ? `<button onclick="academia.marcarTodosCadastrosLidos()" style="background:none; border:none; color:#64748b; font-size:0.65rem; cursor:pointer; font-weight:700;">Marcar todos como lidos</button>` : ''}
                </div>
                ${snap.docs.map(doc => {
                    const d = doc.data();
                    const cor = cores[d.plano] || '#3b82f6';
                    const isNovo = !d.lido;
                    const infoExtra = d.plano === 'familia' && d.qtdFamilia
                        ? `<span style="background:#f59e0b22; color:#f59e0b; font-size:0.6rem; padding:2px 6px; border-radius:4px; font-weight:800;">👨‍👩‍👧‍👦 ${d.qtdFamilia} pessoas</span>`
                        : d.plano === 'livre' && d.qtdModalidades
                        ? `<span style="background:#a78bfa22; color:#a78bfa; font-size:0.6rem; padding:2px 6px; border-radius:4px; font-weight:800;">🥋 ${d.qtdModalidades} modalidade${d.qtdModalidades > 1 ? 's' : ''}</span>`
                        : '';
                    const valorTexto = d.planoValor > 0
                        ? `R$ ${parseFloat(d.planoValor).toFixed(2).replace('.', ',')}/mês`
                        : 'Valor sob consulta';
                    return `
                        <div style="background:${isNovo ? '#0c1a0c' : '#0f172a'}; border:1px solid ${isNovo ? '#10b981' : '#334155'}; border-radius:10px; padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="flex:1;">
                                ${isNovo ? '<span style="background:#10b981; color:#000; font-size:0.5rem; padding:2px 6px; border-radius:4px; font-weight:800; display:inline-block; margin-bottom:4px;">NOVO</span>' : ''}
                                <div style="font-size:0.85rem; font-weight:800; color:white;">${d.nome.toUpperCase()}</div>
                                <div style="font-size:0.65rem; color:#64748b;">${d.email}</div>
                                <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                                    <span style="background:${cor}22; color:${cor}; font-size:0.65rem; padding:3px 8px; border-radius:6px; font-weight:800;">${d.planoLabel} — ${valorTexto}</span>
                                    ${infoExtra}
                                </div>
                                <div style="font-size:0.6rem; color:#475569; margin-top:3px;">${d.dataFormatada}</div>
                            </div>
                            ${isNovo ? `<button onclick="academia.marcarCadastroLido('${doc.id}')" style="background:none; border:none; color:#64748b; cursor:pointer; padding:4px 8px; font-size:0.7rem;">✓ Lido</button>` : ''}
                        </div>`;
                }).join('')}`;
        });
    },

    async marcarCadastroLido(id) {
        await db.collection('novos_cadastros').doc(id).update({ lido: true });
    },

    async marcarTodosCadastrosLidos() {
        const snap = await db.collection('novos_cadastros').where('lido', '==', false).get();
        const batch = db.batch();
        snap.docs.forEach(doc => batch.update(doc.ref, { lido: true }));
        await batch.commit();
    },

    _parsarDataHistorico(dataStr) {
        if (!dataStr) return null;
        if (typeof dataStr === 'number') return new Date(dataStr);
        // Formato: "25/05/2026, 10:30:00"
        try {
            const limpa = dataStr.replace(', ', ' ').trim();
            const partes = limpa.split(' ');
            const [dia, mes, ano] = partes[0].split('/');
            const hora = partes[1] || '00:00:00';
            return new Date(`${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}T${hora}`);
        } catch(e) { return null; }
    },

    async carregarConquistas() {
        const snap = await db.collection("alunos").get();
        const agora = Date.now();
        const LIMITE_48H = 48 * 60 * 60 * 1000;
        const hoje = new Date(); const dH = hoje.getDate(); const mH = hoje.getMonth() + 1;
        let html = "";
        snap.forEach(doc => {
            const a = doc.data(); const s = this.verificarMeta(a);
            // Meta de aulas: só aparece se foi atingida nas últimas 48h
            if (s.pronto) {
                const metaIndex = (a.aulas || 0) - s.meta;
                const hist = a.historico || [];
                if (metaIndex >= 0 && metaIndex < hist.length) {
                    const dataMeta = this._parsarDataHistorico(hist[metaIndex].data);
                    if (dataMeta && (agora - dataMeta.getTime()) <= LIMITE_48H) {
                        html += `<div class="conquista-item" style="border-left:3px solid #10b981;">🎯 <b>${a.nome}</b> atingiu a meta de aulas!</div>`;
                    }
                }
            }
            // Aniversário: aparece o dia inteiro (sem filtro)
            if (a.nascimento) {
                const parts = a.nascimento.split('-');
                if (parts.length === 3 && parseInt(parts[2]) === dH && parseInt(parts[1]) === mH) html += `<div class="conquista-item">🎂 Hoje é o aniversário de <b>${a.nome}</b>!</div>`;
            }
            if (this.calcularEngajamento(a.historico).label === "Em Brasa") html += `<div class="conquista-item">🔥 <b>${a.nome}</b> está em brasa!</div>`;
        });
        const c = document.getElementById('mural-conquistas');
        if (html !== "") { document.getElementById('lista-conquistas').innerHTML = html; c.classList.remove('hidden'); } else { c.classList.add('hidden'); }
    },

    async salvarTecnica() {
        const t = document.getElementById('input-tecnica-titulo').value.trim(); const l = document.getElementById('input-tecnica-link').value.trim();
        if(!t || !l) return alert("Preencha título e link.");
        await db.collection("biblioteca_tecnica").add({ titulo: t, link: l, data: new Date().getTime(), dataFormatada: new Date().toLocaleDateString('pt-BR') });
        alert("Salvo!"); 
        document.getElementById('input-tecnica-titulo').value = "";
        document.getElementById('input-tecnica-link').value = "";
        this.carregarBibliotecaTecnica();
    },

    // ── VÍDEOS COM APROVAÇÃO ──────────────────────────────
    async enviarVideoProf() {
        const titulo = document.getElementById('input-video-prof-titulo').value.trim();
        const link = document.getElementById('input-video-prof-link').value.trim();
        if (!titulo || !link) return alert("Preencha título e link.");
        await db.collection("videos_pendentes").add({
            titulo, link,
            profId: auth.currentUser.id,
            profNome: auth.currentUser.nome,
            status: 'pendente',
            data: new Date().getTime(),
            dataFormatada: new Date().toLocaleDateString('pt-BR')
        });
        document.getElementById('input-video-prof-titulo').value = '';
        document.getElementById('input-video-prof-link').value = '';
        alert("✅ Vídeo enviado para aprovação do admin!");
        this.carregarVideosPendentesProf();
    },

    async carregarVideosPendentesProf() {
        const container = document.getElementById('lista-videos-prof-enviados');
        if (!container) return;
        const snap = await db.collection("videos_pendentes")
            .where("profId", "==", auth.currentUser.id).get();
        if (snap.empty) { container.innerHTML = '<small style="color:#64748b;">Nenhum vídeo enviado ainda.</small>'; return; }
        container.innerHTML = snap.docs.map(doc => {
            const d = doc.data();
            const cor = d.status === 'aprovado' ? '#10b981' : d.status === 'rejeitado' ? '#f43f5e' : '#f59e0b';
            const label = d.status === 'aprovado' ? '✅ Aprovado' : d.status === 'rejeitado' ? '❌ Rejeitado' : '⏳ Aguardando';
            return `<div style="background:#0f172a; border:1px solid #334155; border-left:3px solid ${cor}; border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:0.8rem; font-weight:700; color:white;">${d.titulo}</div>
                    <div style="font-size:0.6rem; color:#64748b;">${d.dataFormatada}</div>
                </div>
                <span style="font-size:0.6rem; font-weight:800; color:${cor};">${label}</span>
            </div>`;
        }).join('');
    },

    async carregarVideosPendentesAdmin() {
        const container = document.getElementById('lista-videos-pendentes-admin');
        if (!container) return;
        container.innerHTML = '<small style="color:#64748b;">Carregando...</small>';
        try {
            const snap = await db.collection("videos_pendentes")
                .where("status", "==", "pendente").get();
            if (snap.empty) {
                container.innerHTML = '<small style="color:#64748b; font-size:0.75rem;">Nenhum vídeo aguardando aprovação.</small>';
                return;
            }
            container.innerHTML = snap.docs.map(doc => {
                const d = doc.data();
                const linkSeguro = (d.link || '').replace(/'/g, '%27');
                return `<div style="background:#0f172a; border:1px solid #f59e0b44; border-left:3px solid #f59e0b; border-radius:8px; padding:12px; margin-bottom:8px;">
                    <div style="font-size:0.8rem; font-weight:800; color:white; margin-bottom:2px;">${d.titulo}</div>
                    <div style="font-size:0.65rem; color:#64748b; margin-bottom:8px;">Por ${d.profNome} • ${d.dataFormatada}</div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="window.open('${linkSeguro}', '_blank')" style="flex:1; padding:7px; background:#1e3a8a; border:none; color:#60a5fa; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer;"><i class="fas fa-play"></i> Ver</button>
                        <button onclick="academia.aprovarVideoAdmin('${doc.id}')" style="flex:1; padding:7px; background:#064e3b; border:none; color:#10b981; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer;"><i class="fas fa-check"></i> Aprovar</button>
                        <button onclick="academia.rejeitarVideoAdmin('${doc.id}')" style="flex:1; padding:7px; background:#4c0519; border:none; color:#f43f5e; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer;"><i class="fas fa-times"></i> Rejeitar</button>
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            container.innerHTML = `<small style="color:#f43f5e;">Erro: ${e.message}</small>`;
        }
    },

    async aprovarVideoAdmin(id) {
        try {
            const doc = await db.collection("videos_pendentes").doc(id).get();
            if (!doc.exists) return alert("Vídeo não encontrado.");
            const d = doc.data();
            await db.collection("videos_pendentes").doc(id).update({ status: 'aprovado' });
            await db.collection("biblioteca_tecnica").add({
                titulo: d.titulo,
                link: d.link,
                data: new Date().getTime(),
                dataFormatada: new Date().toLocaleDateString('pt-BR')
            });
            alert("✅ Vídeo aprovado e publicado na biblioteca!");
        } catch(e) {
            alert("Erro ao aprovar: " + e.message);
        }
    },

    async rejeitarVideoAdmin(id) {
        if (confirm("Rejeitar este vídeo?")) {
            await db.collection("videos_pendentes").doc(id).update({ status: 'rejeitado' });
        }
    },

    async carregarBibliotecaTecnica() {
        const snap = await db.collection("biblioteca_tecnica").orderBy("data", "desc").get();
        const container = document.getElementById('card-tecnica-semana'); 
        const listExclusao = document.getElementById('lista-exclusao-tecnicas');
        if (snap.empty) { 
            if(container) container.classList.add('hidden'); 
            if(listExclusao) listExclusao.innerHTML = "<small style='color:var(--text-muted);'>Nenhum vídeo cadastrado.</small>";
            return; 
        }
        const mR = snap.docs[0].data();
        const viewBtn = document.getElementById('btn-ver-tecnica');
        const viewTitle = document.getElementById('display-tecnica-titulo');
        if(viewTitle) viewTitle.innerText = mR.titulo;
        if(viewBtn) viewBtn.onclick = () => window.open(mR.link, '_blank');
        if(container) container.classList.remove('hidden');
        const txtHistorico = snap.docs.map(doc => {
            const d = doc.data();
            return `<div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:10px; border-radius:8px; margin-bottom:8px; border:1px solid var(--border-light);">
                <div style="flex:1;"><small style="color:var(--text-muted); font-size:0.6rem;">${d.dataFormatada || ''}</small><div style="color:#e2e8f0; font-size:0.8rem; font-weight:bold;">${d.titulo}</div></div>
                <button onclick="window.open('${d.link}', '_blank')" style="background:#1e3a8a; border:none; color:white; padding:5px 10px; border-radius:5px; cursor:pointer;"><i class="fas fa-play"></i></button>
            </div>`;
        }).join('');
        const histContainer = document.getElementById('lista-historico-tecnicas');
        if(histContainer) histContainer.innerHTML = txtHistorico;
        if (listExclusao) {
            listExclusao.innerHTML = snap.docs.map(doc => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 10px; border-radius: 8px; margin-bottom: 6px; border:1px solid var(--border-light);">
                    <span style="font-size: 0.75rem; color:#cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%; font-weight:600;">🎬 ${doc.data().titulo}</span>
                    <button onclick="academia.excluirTecnicaAdmin('${doc.id}')" style="background:none; border:none; color:#f43f5e; cursor:pointer; padding:5px;"><i class="fas fa-trash"></i></button>
                </div>`).join('');
        }
    },

    async excluirTecnicaAdmin(id) {
        if(confirm("Tem certeza que deseja remover este vídeo da biblioteca de técnicas?")) {
            await db.collection("biblioteca_tecnica").doc(id).delete();
            alert("Vídeo removido com sucesso!");
            this.carregarBibliotecaTecnica();
        }
    },

    toggleBiblioteca() { document.getElementById('secao-historico-tecnica').classList.toggle('hidden'); },
    toggleHistoricoMural() { document.getElementById('secao-historico-mural').classList.toggle('hidden'); },

    async generarRelatorioGraduacao() {
        const snap = await db.collection("alunos").orderBy("nome").get();
        const container = document.getElementById('resultado-relatorios');

        const prontos = [];
        const outros = [];

        snap.forEach(doc => {
            const a = doc.data();
            const s = academia.verificarMeta(a);
            // Sobe para destaque: atingiu a meta OU foi convocado pelo admin
            if (s.pronto || a.aspiranteGraduacao === true) prontos.push({ id: doc.id, a, s });
            else outros.push({ id: doc.id, a, s });
        });

        let html = '';

        // ── Prontos para graduar — destaque AMARELO ────────────────────
        if (prontos.length > 0) {
            const totalProntos   = prontos.filter(({ s }) => s.pronto).length;
            const totalConvocados = prontos.filter(({ a }) => a.aspiranteGraduacao).length;
            const subtitulo = [
                totalProntos   ? `${totalProntos} atingiu a meta`  : '',
                totalConvocados ? `${totalConvocados} convocado${totalConvocados > 1 ? 's' : ''}` : ''
            ].filter(Boolean).join(' · ');
            html += `<div style="background:#451a03; border:2px solid #f59e0b; border-radius:12px; padding:14px; margin-bottom:16px;">
                <div style="color:#fbbf24; font-size:0.7rem; font-weight:800; margin-bottom:2px; letter-spacing:0.5px;">
                    ⭐ EM DESTAQUE — ${prontos.length} atleta${prontos.length > 1 ? 's' : ''}
                </div>
                <div style="color:#92400e; font-size:0.6rem; margin-bottom:10px;">${subtitulo}</div>`;
            prontos.forEach(({ id, a }) => {
                const convocado = a.aspiranteGraduacao === true;
                const nomeEsc = (a.nome || '').replace(/'/g, "\\'");
                html += `<div style="display:flex; justify-content:space-between; align-items:center; background:${convocado ? '#052e16' : '#0f172a'}; border:1px solid ${convocado ? '#10b981' : '#78350f'}; border-radius:8px; padding:10px 12px; margin-bottom:6px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.85rem; font-weight:800; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.nome.toUpperCase()}</div>
                        <div style="font-size:0.65rem; color:#94a3b8;">${a.faixa} • ${a.grau}º Grau • ${a.aulas || 0} aulas</div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0; margin-left:8px;">
                        ${convocado
                            ? `<span style="background:#064e3b; color:#10b981; font-size:0.6rem; padding:4px 8px; border-radius:6px; font-weight:800; white-space:nowrap; border:1px solid #10b981;">✅ CONVOCADO</span>
                               <button onclick="academia.desmarcarExame('${id}','${nomeEsc}')" title="Cancelar convocação" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.85rem; padding:2px 4px;">✕</button>`
                            : `<button onclick="academia.marcarParaExame('${id}','${nomeEsc}')" style="background:#92400e; border:1px solid #f59e0b; color:#fbbf24; font-size:0.6rem; padding:5px 10px; border-radius:6px; cursor:pointer; font-weight:800; white-space:nowrap;">🥋 CONVOCAR</button>`
                        }
                    </div>
                </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; text-align:center; margin-bottom:16px;">
                <div style="color:#64748b; font-size:0.8rem;">Nenhum atleta atingiu a meta ainda.</div>
            </div>`;
        }

        // ── Demais alunos ──────────────────────────────────────────────
        html += `<div style="font-size:0.65rem; color:#64748b; font-weight:800; margin-bottom:8px; letter-spacing:0.5px;">TODOS OS ATLETAS</div>`;
        outros.forEach(({ id, a, s }) => {
            const percent = Math.round(s.percent);
            const convocado = a.aspiranteGraduacao === true;
            const nomeEsc = (a.nome || '').replace(/'/g, "\\'");
            html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; border-bottom:1px solid var(--border-light); padding:10px 0; ${convocado ? 'background:#052e1622; border-radius:8px; padding:10px 8px;' : ''}">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.82rem; color:#e2e8f0; font-weight:600;">${a.nome}${convocado ? ' <span style="font-size:0.55rem; color:#10b981; font-weight:800;">✅</span>' : ''}</div>
                    <small style="color:var(--text-muted);">${a.faixa} • ${a.grau}º G • ${a.aulas || 0}/${s.meta} (${percent}%)</small>
                </div>
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    ${convocado
                        ? `<span style="background:#064e3b; color:#10b981; font-size:0.55rem; padding:3px 7px; border-radius:6px; font-weight:800; white-space:nowrap; border:1px solid #10b98155;">✅ CONV.</span>
                           <button onclick="academia.desmarcarExame('${id}','${nomeEsc}')" title="Cancelar convocação" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.75rem; padding:2px 4px;">✕</button>`
                        : `<button onclick="academia.marcarParaExame('${id}','${nomeEsc}')" style="background:#1e293b; border:1px solid #334155; color:#94a3b8; font-size:0.55rem; padding:4px 8px; border-radius:6px; cursor:pointer; font-weight:700; white-space:nowrap;">🥋 CONVOCAR</button>`
                    }
                </div>
            </div>`;
        });

        container.innerHTML = html;
    },

    async marcarParaExame(id, nome) {
        if (!confirm(`Convocar ${nome} para o exame de faixa?\n\nEle(a) verá um aviso fixo no perfil até ser graduado(a).`)) return;
        await db.collection('alunos').doc(id).update({ aspiranteGraduacao: true });
        alert(`✅ ${nome} foi convocado(a) para o exame de faixa! OSS!`);
        this.generarRelatorioGraduacao();
    },

    async desmarcarExame(id, nome) {
        if (!confirm(`Cancelar a convocação de ${nome}?`)) return;
        await db.collection('alunos').doc(id).update({ aspiranteGraduacao: false });
        this.generarRelatorioGraduacao();
    },

    async exportarDadosBackup() {
        const snap = await db.collection("alunos").orderBy("nome").get();
        let texto = "BACKUP GADITAS - " + new Date().toLocaleDateString() + "\n\n";
        snap.forEach(doc => { const a = doc.data(); texto += `${a.nome} | ${a.faixa} | ${a.aulas} aulas\n`; });
        navigator.clipboard.writeText(texto); alert("Dados copiados!");
    },

    async atualizarPresencaAntecipada() {
        const s  = document.getElementById('select-turma-aluno');
        const lD = document.getElementById('quem-treina-hoje');
        if (!s || !lD) return;
        const snap = await db.collection("checkins").where("turma", "==", s.value).get();
        if (snap.empty) {
            lD.innerHTML = `<small style="color:var(--text-muted);">Nenhum atleta confirmado.</small>`;
        } else {
            const chips = snap.docs.map(doc => {
                const d = doc.data();
                const partes = (d.alunoNome || '').split(' ');
                const nome = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
                if (d.tipo === 'visual') {
                    return `<span style="background:#1c1400; color:#f59e0b; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid #f59e0b66; font-weight:800;">🥋 ${nome}</span>`;
                }
                return `<span style="background:#0f172a; color:#ccc; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid var(--border-light); font-weight:600;">${nome}</span>`;
            });
            lD.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:4px;">${chips.join('')}</div>`;
        }
        if (auth.role === 'aluno') this.carregarPlanoAulaTurma(s.value);
    },

    // ── PRESENÇA VISUAL ADMIN NAS TURMAS ─────────────────────
    async renderPresencaAdmin() {
        const container = document.getElementById('lista-turmas-presenca-admin');
        if (!container) return;
        const grade  = this.getGrade();
        const diaSem = new Date().getDay();
        const turmas = (grade[diaSem] || grade[String(diaSem)] || []).filter(t => !t.includes('Sem treinos'));

        const snap = await db.collection('checkins')
            .where('alunoId', '==', 'admin_visual')
            .where('tipo', '==', 'visual')
            .get();
        const turmasComPresenca = new Set(snap.docs.map(d => d.data().turma));

        if (turmas.length === 0) {
            container.innerHTML = '<small style="color:#64748b; font-size:0.7rem;">Sem turmas hoje.</small>';
            return;
        }
        container.innerHTML = turmas.map(turma => {
            const ativo = turmasComPresenca.has(turma);
            return `<div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; border:1px solid ${ativo ? '#f59e0b55' : '#334155'}; border-radius:10px; padding:10px 14px;">
                <span style="color:${ativo ? '#f59e0b' : '#94a3b8'}; font-size:0.8rem; font-weight:700;">${ativo ? '🥋' : '📍'} ${turma}</span>
                <button onclick="academia.togglePresencaAdmin('${turma.replace(/'/g,"\\'")}', ${ativo})"
                    style="background:${ativo ? '#78350f' : '#1e293b'}; border:1px solid ${ativo ? '#f59e0b' : '#334155'}; color:${ativo ? '#fbbf24' : '#64748b'}; padding:6px 14px; border-radius:8px; font-size:0.72rem; font-weight:800; cursor:pointer;">
                    ${ativo ? '✓ CONFIRMADO' : 'CONFIRMAR'}
                </button>
            </div>`;
        }).join('');
    },

    async togglePresencaAdmin(turma, jaEstaPresente) {
        const nome = auth.currentUser?.nome || auth.adminCreds?.nome || 'Prof';
        if (jaEstaPresente) {
            const snap = await db.collection('checkins')
                .where('alunoId', '==', 'admin_visual')
                .where('turma', '==', turma)
                .where('tipo', '==', 'visual')
                .get();
            await Promise.all(snap.docs.map(d => d.ref.delete()));
        } else {
            await db.collection('checkins').add({
                alunoId:   'admin_visual',
                alunoNome: nome,
                turma,
                tipo:      'visual',
                data:      new Date().getTime()
            });
        }
        this.renderPresencaAdmin();
        this.atualizarPresencaAntecipada();
    },

    async salvarEventoAdmin() {
        const id = document.getElementById('edit-evento-id').value;
        const t = document.getElementById('input-evento-titulo').value.trim();
        const d = document.getElementById('input-evento-data').value.trim();
        const v = parseInt(document.getElementById('input-evento-vagas').value) || 0;
        const p = document.getElementById('input-evento-pagamento').value.trim();
        const de = document.getElementById('input-evento-desc').value.trim();
        if(!t || !d || !v) return alert("Preencha título, data e total de vagas.");
        const dados = { titulo: t, dataEvento: d, vagasMax: v, linkPay: p, descricao: de };
        if(id) {
            await db.collection("eventos_oficiais").doc(id).update(dados);
            alert("✅ Evento updated!");
        } else {
            await db.collection("eventos_oficiais").add({ ...dados, inscritos: [], dataCriacao: new Date().getTime() });
            alert("✅ Evento criado!");
        }
        this.limparFormEvento();
        this.carregarEventosAbas();
    },

    async editarEventoAdmin(id) {
        const doc = await db.collection("eventos_oficiais").doc(id).get(); if(!doc.exists) return;
        const ev = doc.data();
        document.getElementById('edit-evento-id').value = id;
        document.getElementById('input-evento-titulo').value = ev.titulo;
        document.getElementById('input-evento-data').value = ev.dataEvento;
        document.getElementById('input-evento-vagas').value = ev.vagasMax;
        document.getElementById('input-evento-pagamento').value = ev.linkPay || "";
        document.getElementById('input-evento-desc').value = ev.descricao || "";
        const btn = document.getElementById('btn-salvar-evento');
        if(btn) btn.innerText = "ATUALIZAR EVENTO";
        // Destaca o formulário de edição
        const editor = document.getElementById('admin-eventos-editor');
        if (editor) {
            editor.style.border = "2px solid #f59e0b";
            setTimeout(() => { editor.style.border = "1px solid #334155"; }, 3000);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    limparFormEvento() {
        document.getElementById('edit-evento-id').value = "";
        document.getElementById('input-evento-titulo').value = "";
        document.getElementById('input-evento-data').value = "";
        document.getElementById('input-evento-vagas').value = "";
        document.getElementById('input-evento-pagamento').value = "";
        document.getElementById('input-evento-desc').value = "";
        const btn = document.getElementById('btn-salvar-evento');
        if(btn) btn.innerText = "PUBLICAR EVENTO";
    },

    async carregarEventosAbas() {
        db.collection("eventos_oficiais").orderBy("dataCriacao", "desc").onSnapshot((snap) => {
            const containerAluno = document.getElementById('lista-eventos-alunos'); 
            const containerAdmin = document.getElementById('lista-eventos-gerenciamento');
            if (snap.empty) {
                if (containerAluno) containerAluno.innerHTML = "<p style='color:var(--text-muted); text-align:center; font-size:0.85rem; padding:15px;'>Nenhum evento agendado.</p>";
                if (containerAdmin) containerAdmin.innerHTML = "<p style='color:var(--text-muted); font-size:0.8rem;'>Nenhum evento ativo.</p>"; return;
            }
            let htmlAluno = ""; let htmlAdmin = "";
            snap.forEach(doc => {
                const ev = doc.data(); const evId = doc.id; const listaInscritos = ev.inscritos || []; const totalInscritos = listaInscritos.length;
                const jaInscrito = auth.currentUser ? listaInscritos.some(i => i.id === auth.currentUser.id) : false;
                let botaoAcao = jaInscrito ? `<button onclick="academia.cancelarInscricaoEvento('${evId}')" class="btn-save" style="background: linear-gradient(135deg, #059669, #047857); color: white; border: 1px solid #10b981;">Inscrito com Sucesso! ✅ (Sair)</button>` : (totalInscritos >= ev.vagasMax ? `<button class="btn-save btn-dark" style='cursor:not-allowed; background:#334155;' disabled>Vagas Esgotadas ❌</button>` : `<button onclick="academia.inscreverEmEvento('${evId}')" class="btn-save btn-tecnica">Garantir Minha Vaga</button>`);
                let botaoPagamentoAluno = (jaInscrito && ev.linkPay) ? `<button onclick="window.open('${ev.linkPay}', '_blank')" class="btn-infinitepay"><i class="fas fa-credit-card"></i> PAGAR INSCRIÇÃO AGORA 💳</button>` : '';
                htmlAluno += `<div class="card-evento"><div class="evento-header"><h4 class="evento-titulo">${ev.titulo.toUpperCase()}</h4><span class="evento-vagas-badge">${totalInscritos} / ${ev.vagasMax} VAGAS</span></div><div class="evento-data"><i class="fas fa-clock"></i> ${ev.dataEvento}</div><div class="evento-desc">${ev.descricao || "Sem descrição."}</div>${botaoAcao}${botaoPagamentoAluno}</div>`;
                const nomesInscritos = listaInscritos.map((n, idx) => `<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #ccc; padding: 6px 0; border-bottom: 1px solid #1e293b;"><span>${idx+1}. ${n.nome.toUpperCase()}</span><button onclick="academia.removerAlunoDeEventoAdmin('${evId}', '${n.id}', '${n.nome.replace(/'/g, "\\'")}')" style="background: none; border: none; color: #f43f5e; cursor: pointer; padding: 2px 6px;"><i class="fas fa-user-minus"></i></button></div>`).join('') || "<small style='color:var(--text-muted);'>Ninguém inscrito ainda.</small>";
                htmlAdmin += `<div style="background:#0f172a; border:1px solid var(--border-light); padding:12px; border-radius:10px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--border-light); padding-bottom:5px;">
                        <b style="color:white; font-size:0.8rem;">🏆 ${ev.titulo}</b>
                        <div style="display:flex; gap:6px;">
                            <button onclick="academia.editarEventoAdmin('${evId}')" style="background:#1e3a8a; border:1px solid #2d2d34; color:#60a5fa; padding:4px 8px; border-radius:6px; cursor:pointer;" title="Editar evento"><i class="fas fa-edit"></i></button>
                            <button onclick="academia.excluirEventoAdmin('${evId}')" style="background:none; border:none; color:var(--accent-red); cursor:pointer;"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div style="max-height:150px; overflow-y:auto;">${nomesInscritos}</div>
                </div>`;
            });
            if (containerAluno) containerAluno.innerHTML = htmlAluno; if (containerAdmin) containerAdmin.innerHTML = htmlAdmin;
        });
    },

    async inscreverEmEvento(eventoId) {
        if (!auth.currentUser || auth.role !== 'aluno') return alert("Faça login como aluno para garantir a vaga.");
        const ref = db.collection("eventos_oficiais").doc(eventoId);
        try {
            let resultado = "";
            await db.runTransaction(async (transaction) => {
                const sfDoc = await transaction.get(ref); if (!sfDoc.exists) return;
                const evData = sfDoc.data(); const listaInscritos = evData.inscritos || [];
                if (listaInscritos.some(i => i.id === auth.currentUser.id)) { resultado = "ja"; return; }
                if (listaInscritos.length >= evData.vagasMax) { resultado = "cheio"; return; }
                listaInscritos.push({ id: auth.currentUser.id, nome: auth.currentUser.nome });
                transaction.update(ref, { inscritos: listaInscritos });
                resultado = "ok";
            });
            if (resultado === "ok") alert("🎯 Vaga reservada com sucesso!");
            if (resultado === "ja") alert("Você já está inscrito neste evento!");
            if (resultado === "cheio") alert("Vagas esgotadas!");
        } catch (err) { alert("Erro ao salvar inscrição."); }
    },

    async cancelarInscricaoEvento(eventoId) {
        if (!auth.currentUser || auth.role !== 'aluno') return;
        if (confirm("Deseja cancelar sua inscrição no evento?")) {
            const ref = db.collection("eventos_oficiais").doc(eventoId);
            try {
                await db.runTransaction(async (transaction) => {
                    const sfDoc = await transaction.get(ref); if (!sfDoc.exists) return;
                    let list = sfDoc.data().inscritos || [];
                    list = list.filter(i => i.id !== auth.currentUser.id);
                    transaction.update(ref, { inscritos: list });
                });
                alert("Inscrição cancelada.");
            } catch (err) { }
        }
    },

    async removerAlunoDeEventoAdmin(eventoId, atletaId, atletaNome) {
        if (confirm(`Remover "${atletaNome.toUpperCase()}" deste evento?`)) {
            const ref = db.collection("eventos_oficiais").doc(eventoId);
            try {
                await db.runTransaction(async (transaction) => {
                    const sfDoc = await transaction.get(ref); if (!sfDoc.exists) return;
                    let list = sfDoc.data().inscritos || [];
                    list = list.filter(i => i.id !== atletaId);
                    transaction.update(ref, { inscritos: list });
                });
                alert("Atleta removido.");
            } catch (err) { }
        }
    },

    async excluirEventoAdmin(eventoId) {
        if(confirm("Deseja excluir permanentemente este evento?")) {
            await db.collection("eventos_oficiais").doc(eventoId).delete();
            alert("Evento removido.");
        }
    },

    async renderAlunos() {
        const l = document.getElementById('list-alunos'); if(!l) return;
        const snap = await db.collection("alunos").orderBy("nome").get();
        const isAdmin = auth.role === 'admin'; const anoAtual = new Date().getFullYear();
        let cardsHtml = "";
        const faixaFiltro = document.getElementById('filtro-avancado-faixas') ? document.getElementById('filtro-avancado-faixas').value : "all";

        // Turmas e categorias do professor
        const turmasProf = (auth.role === 'professor' && auth.currentUser?.turmasAcesso) ? auth.currentUser.turmasAcesso : [];
        const profTemKids = turmasProf.some(t => t.toLowerCase().includes('kids'));
        const profTemAdulto = turmasProf.some(t => t.includes('BJJ') || t.includes('Submission'));

        // Alunos que fizeram check-in hoje (para professor adulto)
        let idsCheckinHoje = new Set();
        if (auth.role === 'professor' && profTemAdulto) {
            const inicioHoje = new Date(); inicioHoje.setHours(0,0,0,0);
            const snapCI = await db.collection("checkins").get();
            snapCI.docs.forEach(d => {
                const c = d.data();
                const turmaProf = turmasProf.some(t => c.turma && c.turma.includes(t.replace(/\s*\d+$/, '').trim()));
                if (turmaProf && c.data >= inicioHoje.getTime()) idsCheckinHoje.add(c.alunoId);
            });
        }

        snap.forEach(doc => {
            const a = doc.data(); const s = this.verificarMeta(a); const eng = this.calcularEngajamento(a.historico);
            const trancado = a.status === 'trancado';
            const nomeAtleta = a.nome ? a.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "";
            const buscaNorm = this.textoBuscaNome.normalize("NFD").replace(/[̀-ͯ]/g, "");
            const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 14;
            if (buscaNorm !== "" && !nomeAtleta.includes(buscaNorm)) return;
            if (this.categoriaFiltroAtual === "adult" && isKids) return;
            if (this.categoriaFiltroAtual === "kids" && !isKids) return;
            if (faixaFiltro !== "all" && a.faixa !== faixaFiltro) return;
            if (this.filtroInativos && eng.label !== 'Inativo') return;

            // Filtro por modalidade
            const alunoMod = a.modalidade || 'jiujitsu';
            if (this.modalidadeFiltroAtual === 'jiujitsu' && alunoMod === 'muaythai') return;
            if (this.modalidadeFiltroAtual === 'muaythai' && alunoMod !== 'muaythai' && alunoMod !== 'ambos') return;

            // Filtro do professor
            if (auth.role === 'professor') {
                if (isKids && !profTemKids) return; // Não tem turma kids
                if (!isKids && !profTemAdulto) return; // Não tem turma adulto
                if (!isKids && profTemAdulto && !idsCheckinHoje.has(doc.id)) return; // Adulto sem check-in hoje
            }
            let tagsLeoes = "";
            if (isKids) {
                const hist = a.historicoLeoes || [];
                const cAtencao = hist.filter(i => i.campo === 'leaoAtencao' && i.faixa === a.faixa).length;
                const cComportamento = hist.filter(i => i.campo === 'leaoComportamento' && i.faixa === a.faixa).length;
                const cCompanheirismo = hist.filter(i => i.campo === 'leaoCompanheirismo' && i.faixa === a.faixa).length;
                const cDisciplina = hist.filter(i => i.campo === 'leaoDisciplina' && i.faixa === a.faixa).length;
                tagsLeoes = `<div style="display:flex; gap:6px; margin-top:5px; font-size:0.6rem; font-weight:700;">
                    <span style="${cAtencao > 0 ? 'color:#10b981;' : 'color:var(--text-muted); opacity:0.4;'}">🟢 ${cAtencao}</span>
                    <span style="${cComportamento > 0 ? 'color:#f43f5e;' : 'color:var(--text-muted); opacity:0.4;'}">🔴 ${cComportamento}</span>
                    <span style="${cCompanheirismo > 0 ? 'color:#3b82f6;' : 'color:var(--text-muted); opacity:0.4;'}">🔵 ${cCompanheirismo}</span>
                    <span style="${cDisciplina > 0 ? 'color:#fbbf24;' : 'color:var(--text-muted); opacity:0.4;'}">🟡 ${cDisciplina}</span>
                </div>`;
            }
            const fotoSrc = a.fotoPerfil || '';
            // Badge e info de graduação por modalidade
            const modBadge = alunoMod === 'muaythai'
                ? `<span style="background:#4c0519; color:#f43f5e; font-size:0.5rem; padding:2px 5px; border-radius:4px; font-weight:800; margin-left:5px; vertical-align:middle;">🥊 MT</span>`
                : alunoMod === 'ambos'
                ? `<span style="background:#2e1065; color:#c4b5fd; font-size:0.5rem; padding:2px 5px; border-radius:4px; font-weight:800; margin-left:5px; vertical-align:middle;">⚡ JJJ+MT</span>`
                : `<span style="background:#1e3a8a; color:#60a5fa; font-size:0.5rem; padding:2px 5px; border-radius:4px; font-weight:800; margin-left:5px; vertical-align:middle;">🥋 JJJ</span>`;
            // Belt visual (prajerão)
            let beltBarHtml = '';
            if (alunoMod === 'muaythai') {
                beltBarHtml = ui.renderBeltMT(a.faixaMT);
            } else if (alunoMod === 'ambos') {
                beltBarHtml = ui.renderBeltJJ(a.faixa, a.grau) + ui.renderBeltMT(a.faixaMT);
            } else {
                beltBarHtml = ui.renderBeltJJ(a.faixa, a.grau);
            }
            // Subtexto com contadores
            const gradInfo = alunoMod === 'muaythai'
                ? `<span style="font-size:0.6rem; color:#64748b;">${a.faixaMT || 'Branco'} • ${a.aulasMT || 0} aulas MT</span>`
                : alunoMod === 'ambos'
                ? `<span style="font-size:0.6rem; color:#64748b;">${a.faixa} ${a.grau}ºG (${a.aulas || 0}aJ) · ${a.faixaMT || 'Branco'} (${a.aulasMT || 0}aMT)</span>`
                : `<span style="font-size:0.6rem; color:#64748b;">${a.faixa} • ${a.grau}ºG • ${a.aulas || 0}/${s.meta} aulas</span>`;
            const corBorda = alunoMod === 'muaythai'
                ? ui.getCorFaixaMT(a.faixaMT)
                : ui.getCorFaixa(a.faixa);
            const fotoMini = fotoSrc
                ? `<img src="${fotoSrc}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:2px solid ${corBorda}; margin-right:10px; flex-shrink:0;"/>`
                : `<div style="width:36px; height:36px; border-radius:50%; background:#1e293b; border:2px solid #334155; display:inline-flex; align-items:center; justify-content:center; margin-right:10px; flex-shrink:0; font-size:0.85rem; font-weight:800; color:#94a3b8;">${a.nome.charAt(0).toUpperCase()}</div>`;

            const telLimpo = (a.telefone || '').replace(/\D/g, '');
            cardsHtml += `<div class="item-card" style="border-left: 4px solid ${trancado ? '#64748b' : corBorda}; flex-direction:column; align-items:stretch; gap:10px; ${trancado ? 'opacity:0.7;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; flex:1; min-width:0;">
                        ${fotoMini}
                        <div style="color:#e2e8f0; flex:1; font-size:0.85rem; font-weight:600; min-width:0;">
                            <span>${a.nome.toUpperCase()}${modBadge} ${eng.icon}${trancado ? ' <span style="background:#334155; color:#94a3b8; font-size:0.5rem; padding:2px 6px; border-radius:4px; font-weight:800; vertical-align:middle;">🔒 TRANCADO</span>' : ''}</span>
                            ${beltBarHtml}
                            ${gradInfo}
                            ${tagsLeoes}
                        </div>
                    </div>
                    <div style="display:flex; gap:5px; flex-shrink:0;">
                        <button onclick="academia.editarAluno('${doc.id}')" style="background:#16161a; border:1px solid #2d2d34; color:#94a3b8; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-eye"></i></button>
                        ${telLimpo ? `<button onclick="academia.abrirWhatsappBusiness('${telLimpo}')" title="WhatsApp Business" style="background:#064e3b; border:none; color:#25d366; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fab fa-whatsapp"></i></button>` : ''}
                        <button onclick="academia.verFichaSaudeAluno('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" title="Ficha de Saúde" style="background:#0c2344; border:none; color:#10b981; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-notes-medical"></i></button>
                        ${isAdmin ? `<button onclick="academia.verFinanceiroAluno('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" style="background:#064e3b; border:none; color:#10b981; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-dollar-sign"></i></button>` : ''}
                        ${isAdmin ? (trancado
                            ? `<button onclick="academia.ativarAluno('${doc.id}','${a.nome.replace(/'/g, "\\'")}')" title="Reativar matrícula" style="background:#1e3a8a; border:none; color:#60a5fa; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-lock-open"></i></button>`
                            : `<button onclick="academia.trancarAluno('${doc.id}','${a.nome.replace(/'/g, "\\'")}')" title="Trancar matrícula" style="background:#1c1000; border:1px solid #92400e; color:#f59e0b; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-lock"></i></button>`)
                        : ''}
                        ${isAdmin ? `<button onclick="academia.excluirAluno('${doc.id}')" style="background:#2a0808; border:none; color:#ef4444; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-start; padding-top:4px;">
                    <button onclick="academia.lancarPresencaManualAdmin('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" style="background:#1e3a8a; border:none; color:#60a5fa; padding:6px 12px; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer;"><i class="fas fa-plus"></i> Presença Manual</button>
                </div>
            </div>`;
        });

        const totalGeral = snap.docs.length;
        const totalVisiveis = snap.docs.filter(doc => {
            const a = doc.data();
            const nomeAtleta = a.nome ? a.nome.toLowerCase() : "";
            const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 14;
            if (this.textoBuscaNome !== "" && !nomeAtleta.includes(this.textoBuscaNome)) return false;
            if (this.categoriaFiltroAtual === "adult" && isKids) return false;
            if (this.categoriaFiltroAtual === "kids" && !isKids) return false;
            if (faixaFiltro !== "all" && a.faixa !== faixaFiltro) return false;
            return true;
        }).length;

        const contadorHtml = `
            <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px 15px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-users" style="color:#3b82f6; font-size:1rem;"></i>
                        <span style="font-size:0.8rem; font-weight:700; color:#e2e8f0;">ATLETAS MATRICULADOS</span>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center;">
                        ${totalVisiveis !== totalGeral ? `<span style="font-size:0.7rem; color:#94a3b8;">Filtrado: <strong style="color:#f59e0b;">${totalVisiveis}</strong></span>` : ''}
                        <span style="font-size:0.7rem; color:#94a3b8;">Total: <strong style="color:#3b82f6; font-size:1rem;">${totalGeral}</strong></span>
                    </div>
                </div>
                <button onclick="academia.toggleFiltroInativos()" style="width:100%; padding:7px; background:${this.filtroInativos ? '#78350f' : '#1e293b'}; border:1px solid ${this.filtroInativos ? '#f59e0b' : '#334155'}; color:${this.filtroInativos ? '#fbbf24' : '#94a3b8'}; border-radius:7px; font-size:0.7rem; font-weight:800; cursor:pointer; letter-spacing:0.3px;">
                    💤 ${this.filtroInativos ? 'MOSTRANDO SÓ INATIVOS — clique para ver todos' : 'FILTRAR: SEM TREINOS (+30 dias)'}
                </button>
            </div>`;

        l.innerHTML = contadorHtml + (cardsHtml || `<p style='color:var(--text-muted); text-align:center; font-size:0.8rem; padding:15px;'>Nenhum atleta.</p>`);
    },

    async renderCheckins() {
        const l = document.getElementById('list-checkins'); if(!l) return;
        let snap = await db.collection("checkins").get(); const aSnap = await db.collection("alunos").get();
        const info = {}; aSnap.forEach(d => info[d.id] = d.data()); const g = {};
        snap.docs.forEach(doc => {
            const c = doc.data();
            if (c.tipo === 'visual') return; // presença visual do admin — não aparece na chamada
            if (auth.role === 'admin' || (auth.currentUser.turmasAcesso && auth.currentUser.turmasAcesso.includes(c.turma))) {
                if (!g[c.turma]) g[c.turma] = []; g[c.turma].push({ id: doc.id, ...c });
            }
        });
        let h = "";
        for (const t in g) {
            h += `<h4 style="color:#3b82f6; font-size:0.7rem; margin:15px 0 6px 4px; font-weight:800; letter-spacing:0.5px;">${t.toUpperCase()}</h4>`;
            h += g[t].map(c => `<div class="item-card" style="border-left: 4px solid ${ui.getCorFaixa(info[c.alunoId]?.faixa || "Branca")};"><span style="font-size:0.85rem; color:#e2e8f0; font-weight:600;">${c.alunoNome}</span><div style="display:flex; gap:6px;"><button onclick="academia.aprovar('${c.id}', '${c.alunoId}', '${c.turma}')" style="background:#062f1d; color:#10b981; border:none; padding:8px 12px; border-radius:6px; font-size:0.75rem; cursor:pointer;"><i class="fas fa-check"></i></button><button onclick="academia.recusarCheckin('${c.id}')" style="background:#3b0707; color:#ef4444; border:none; padding:8px 12px; border-radius:6px; font-size:0.75rem; cursor:pointer;"><i class="fas fa-times"></i></button></div></div>`).join('');
        }
        l.innerHTML = h || "<p style='color:var(--text-muted); text-align:center; font-size:0.8rem; padding:10px;'>Nenhum check-in pendente.</p>";
    },

    // Detecta se a turma é Muay Thai pelo nome
    _isTurmaMT(turma) {
        if (!turma) return false;
        const t = turma.toLowerCase();
        return t.includes('muay') || t.includes('thai') || t.includes(' mt') || t.startsWith('mt ');
    },

    async aprovar(cId, aId, t) {
        const r = db.collection("alunos").doc(aId); const doc = await r.get();
        if(doc.exists) {
            const d = doc.data(); const h = d.historico || [];
            h.unshift({ data: new Date().toLocaleString('pt-BR'), turma: t });
            const isMT = this._isTurmaMT(t);
            const upd = { historico: h };
            if (isMT) upd.aulasMT = (d.aulasMT || 0) + 1;
            else       upd.aulas   = (d.aulas   || 0) + 1;
            await r.update(upd);
        }
        await db.collection("checkins").doc(cId).delete(); this.renderCheckins(); academia.renderRanking(); academia.carregarConquistas();
    },

    async recusarCheckin(cId) { if(confirm("Remover?")) { await db.collection("checkins").doc(cId).delete(); this.renderCheckins(); } },

    _getDataHoje() {
        const h = new Date();
        return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
    },

    async renderPlanoAulaProf() {
        const container = document.getElementById('plano-aula-professor');
        if (!container) return;
        const dataHoje = this._getDataHoje();
        const grade = this.getGrade();
        const diaSemana = new Date().getDay();
        const turmasHoje = (grade[diaSemana] || grade[String(diaSemana)] || []).filter(t => !t.includes('Sem treinos'));

        if (turmasHoje.length === 0) {
            container.innerHTML = '';
            return;
        }

        // Para professor, filtra só as turmas dele
        let turmasVisiveis = turmasHoje;
        if (auth.role === 'professor' && auth.currentUser.turmasAcesso) {
            turmasVisiveis = turmasHoje.filter(t =>
                auth.currentUser.turmasAcesso.some(ta => t.toLowerCase().includes(ta.toLowerCase().replace(/\s*\d+$/, '').trim()))
            );
        }
        if (turmasVisiveis.length === 0) { container.innerHTML = ''; return; }

        // Carrega planos já salvos para hoje
        let planosExistentes = {};
        try {
            const doc = await db.collection('plano_aula').doc(dataHoje).get();
            if (doc.exists) planosExistentes = doc.data();
        } catch(e) {}

        container.innerHTML = `
            <div style="background:#1e293b; border:1px solid #8b5cf644; border-left:3px solid #8b5cf6; border-radius:12px; padding:15px;">
                <div style="font-size:0.75rem; font-weight:800; color:#8b5cf6; margin-bottom:12px; letter-spacing:0.3px;">
                    <i class="fas fa-clipboard-list"></i> PLANO DA AULA DE HOJE
                </div>
                ${turmasVisiveis.map(turma => {
                    const inputId = 'plano_' + turma.replace(/[^a-z0-9]/gi, '_');
                    const conteudoSalvo = this._planoConteudo(planosExistentes[turma]);
                    return `<div style="margin-bottom:12px;">
                        <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:5px; letter-spacing:0.5px;">📍 ${turma.toUpperCase()}</small>
                        <textarea id="${inputId}" placeholder="Ex: Raspagens da guarda fechada + finalização kimura..." rows="2"
                            style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; font-size:0.8rem; outline:none; resize:none; margin-bottom:6px;">${conteudoSalvo}</textarea>
                        <button onclick="academia.salvarPlanoAula('${turma.replace(/'/g,"\\'")}', document.getElementById('${inputId}').value)"
                            style="width:100%; padding:9px; background:#8b5cf6; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem;">
                            <i class="fas fa-save"></i> SALVAR CONTEÚDO DA AULA
                        </button>
                    </div>`;
                }).join('')}
            </div>`;
    },

    // ── CHAMADA / APPELO POR LISTA ────────────────────────────
    renderChamadaProf() {
        // Garante que o card existe (cria uma única vez)
        let card = document.getElementById('card-chamada-prof');
        if (!card) {
            card = document.createElement('div');
            card.id = 'card-chamada-prof';
            card.style.cssText = 'background:#1e293b; border:1px solid #0ea5e944; border-left:3px solid #0ea5e9; border-radius:12px; padding:15px; margin-top:15px;';
            const profArea = document.getElementById('area-professor-checkin');
            if (profArea) profArea.after(card);
            else {
                const checkinTab = document.getElementById('tab-checkin');
                if (checkinTab) checkinTab.appendChild(card);
            }
        }
        const grade = this.getGrade();
        const todasTurmas = [...new Set(Object.values(grade).flat())].filter(t => !t.includes('Sem treinos'));
        const opts = todasTurmas.map(t => `<option value="${t}">${t}</option>`).join('');
        card.innerHTML = `
            <div style="font-size:0.75rem; font-weight:800; color:#0ea5e9; margin-bottom:12px; letter-spacing:0.3px;">
                <i class="fas fa-list-check"></i> CHAMADA POR LISTA
            </div>
            <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:5px;">TURMA:</small>
            <select id="chamada-select-turma"
                style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:10px;">
                ${opts}
            </select>
            <button onclick="academia.abrirChamada()"
                style="width:100%; padding:12px; background:#0ea5e9; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.85rem;">
                <i class="fas fa-users"></i> ABRIR LISTA DE ALUNOS
            </button>`;
    },

    async abrirChamada() {
        const turma = document.getElementById('chamada-select-turma')?.value;
        if (!turma) return alert('Selecione uma turma.');

        // Modal overlay
        let modal = document.getElementById('modal-chamada-prof');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-chamada-prof';
            modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; flex-direction:column; overflow-y:auto; padding:20px; box-sizing:border-box;';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `<div style="background:#1e293b; border-radius:16px; padding:20px; max-width:500px; margin:0 auto; width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div>
                    <div style="font-size:0.65rem; color:#0ea5e9; font-weight:800;">CHAMADA</div>
                    <div style="font-size:1rem; font-weight:800; color:white;">${turma}</div>
                </div>
                <button onclick="document.getElementById('modal-chamada-prof').remove()" style="background:#334155; border:none; color:white; padding:8px 12px; border-radius:8px; cursor:pointer; font-weight:700;">✕</button>
            </div>
            <div id="chamada-lista-alunos" style="color:#64748b; text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:#0ea5e9; display:block; margin-bottom:8px;"></i>Buscando check-ins de hoje...</div>
            </div>`;
        modal.style.display = 'flex';

        try {
            // Busca APENAS os check-ins de hoje para esta turma
            const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
            const snapCI = await db.collection('checkins').where('turma', '==', turma).get();
            const checkinsHoje = snapCI.docs.filter(d => d.data().data >= inicioHoje.getTime());

            if (checkinsHoje.length === 0) {
                document.getElementById('chamada-lista-alunos').innerHTML = `
                    <div style="text-align:center; padding:20px;">
                        <div style="font-size:2rem; margin-bottom:8px;">📋</div>
                        <p style="color:#f59e0b; font-size:0.85rem; font-weight:700; margin-bottom:4px;">Nenhum check-in registrado hoje</p>
                        <p style="color:#64748b; font-size:0.7rem;">Aguarde os alunos confirmarem presença ou use lançamento manual.</p>
                    </div>`;
                return;
            }

            // Busca dados extras (faixa) dos alunos via IDs
            const uniqueIds = [...new Set(checkinsHoje.map(d => d.data().alunoId))];
            const alunosDocs = await Promise.all(uniqueIds.map(id => db.collection('alunos').doc(id).get()));
            const alunosMap = {};
            alunosDocs.forEach(d => { if (d.exists) alunosMap[d.id] = d.data(); });

            const alunos = checkinsHoje.map(d => {
                const c = d.data();
                const dados = alunosMap[c.alunoId] || {};
                return { id: c.alunoId, nome: dados.nome || c.alunoNome || '—', faixa: dados.faixa || '' };
            }).sort((a, b) => a.nome.localeCompare(b.nome));

            let listaHtml = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:0.7rem; color:#0ea5e9; font-weight:800;">✅ ${alunos.length} CHECK-IN${alunos.length !== 1 ? 'S' : ''} HOJE</span>
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.7rem; color:#94a3b8; cursor:pointer;">
                        <input type="checkbox" id="chamada-todos" checked onchange="document.querySelectorAll('.chamada-check').forEach(c=>c.checked=this.checked)"> Marcar todos
                    </label>
                </div>
                <p style="font-size:0.6rem; color:#64748b; margin-bottom:10px; text-align:center;">Desmarque quem não compareceu</p>
                <div style="max-height:50vh; overflow-y:auto; margin-bottom:12px;">`;

            alunos.forEach(a => {
                listaHtml += `
                    <label style="display:flex; align-items:center; gap:10px; padding:10px; background:#0f172a; border-radius:8px; margin-bottom:6px; cursor:pointer; border:1px solid #0ea5e955;">
                        <input type="checkbox" class="chamada-check" value="${a.id}" checked style="width:18px; height:18px; accent-color:#0ea5e9;">
                        <div style="flex:1;">
                            <span style="font-size:0.85rem; font-weight:700; color:#e2e8f0;">${a.nome}</span>
                            ${a.faixa ? `<span style="font-size:0.6rem; color:#64748b; margin-left:8px;">${a.faixa}</span>` : ''}
                        </div>
                        <span style="font-size:0.6rem; color:#10b981; font-weight:700;">✓</span>
                    </label>`;
            });

            listaHtml += `</div>
                <button onclick="academia.confirmarChamada('${turma.replace(/'/g,"\\'")}', document.querySelectorAll('.chamada-check:checked'))"
                    style="width:100%; padding:14px; background:#10b981; border:none; color:white; border-radius:10px; font-weight:800; font-size:0.9rem; cursor:pointer;">
                    <i class="fas fa-check-double"></i> CONFIRMAR PRESENÇAS
                </button>`;

            document.getElementById('chamada-lista-alunos').innerHTML = listaHtml;
        } catch(e) {
            document.getElementById('chamada-lista-alunos').innerHTML = `<p style="color:#f43f5e; text-align:center;">Erro: ${e.message}</p>`;
        }
    },

    async confirmarChamada(turma, checkboxes) {
        const ids = Array.from(checkboxes).map(c => c.value);
        if (ids.length === 0) return alert('Nenhum aluno marcado.');
        if (!confirm(`Confirmar presença de ${ids.length} aluno(s) na turma ${turma}?`)) return;

        const btn = document.querySelector('#modal-chamada-prof button[onclick*="confirmarChamada"]');
        if (btn) { btn.disabled = true; btn.innerText = `⏳ Salvando ${ids.length} presenças...`; }

        const isMT  = this._isTurmaMT(turma);
        const dataStr = new Date().toLocaleString('pt-BR');
        let salvos = 0; let erros = 0;

        await Promise.all(ids.map(async (alunoId) => {
            try {
                const ref = db.collection('alunos').doc(alunoId);
                const doc = await ref.get();
                if (!doc.exists) return;
                const d = doc.data();
                const h = d.historico || [];

                // Evita duplicata no mesmo dia
                const hoje = new Date().toLocaleDateString('pt-BR');
                const jaTem = h.some(e => e.turma === turma && (e.data || '').startsWith(hoje));
                if (jaTem) return;

                h.unshift({ data: dataStr, turma, tipo: 'Chamada (Prof/Adm)' });
                const upd = { historico: h };
                if (isMT) upd.aulasMT = (d.aulasMT || 0) + 1;
                else       upd.aulas   = (d.aulas   || 0) + 1;
                await ref.update(upd);
                salvos++;
            } catch(e) { erros++; }
        }));

        document.getElementById('modal-chamada-prof')?.remove();
        alert(`✅ ${salvos} presença(s) registrada(s)!${erros > 0 ? `\n⚠️ ${erros} erro(s).` : ''}`);
        this.renderRanking();
        this.carregarConquistas();
    },

    // Helpers: suporta dados antigos (string) e novos (objeto {conteudo, profNome})
    _planoConteudo(val) { return val ? (typeof val === 'object' ? val.conteudo || '' : val) : ''; },
    _planoProf(val)     { return val && typeof val === 'object' ? val.profNome || '' : ''; },

    async salvarPlanoAula(turma, conteudo) {
        const dataHoje = this._getDataHoje();
        const profNome = auth.currentUser?.nome || '';
        const texto    = (conteudo || '').trim();
        // Garante sessão Firebase Auth antes de escrever
        if (!firebase.auth().currentUser) {
            try { await firebase.auth().signInAnonymously(); }
            catch(e) { console.warn('re-auth plano:', e.message); }
        }
        try {
            await db.collection('plano_aula').doc(dataHoje).set(
                { [turma]: { conteudo: texto, profNome } },
                { merge: true }
            );
            // Feedback visual no botão
            const btnEl = document.activeElement && document.activeElement.tagName === 'BUTTON'
                ? document.activeElement
                : null;
            if (btnEl) {
                const orig = btnEl.innerHTML;
                btnEl.innerHTML = '<i class="fas fa-check"></i> SALVO!';
                btnEl.style.background = '#10b981';
                setTimeout(() => { btnEl.innerHTML = orig; btnEl.style.background = '#8b5cf6'; }, 2000);
            }
        } catch(e) {
            console.error('salvarPlanoAula:', e.code, e.message);
            // Mensagem específica por tipo de erro
            if (e.code === 'permission-denied') {
                alert('Sem permissão para salvar. Faça logout e entre novamente.');
            } else {
                alert('Erro ao salvar plano: ' + e.message);
            }
        }
    },

    async carregarPlanoAulaTurma(turma) {
        const preview = document.getElementById('preview-plano-aula');
        if (!preview || !turma || turma.includes('Sem treinos')) { if(preview) preview.innerHTML = ''; return; }
        const dataHoje = this._getDataHoje();
        try {
            const doc = await db.collection('plano_aula').doc(dataHoje).get();
            const val = doc.exists ? doc.data()[turma] : null;
            const conteudo = this._planoConteudo(val);
            const profNome = this._planoProf(val);
            if (conteudo.trim()) {
                preview.innerHTML = `
                    <div style="background:#1e293b; border:1px solid #8b5cf644; border-left:3px solid #8b5cf6; border-radius:8px; padding:12px; margin-top:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <small style="color:#8b5cf6; font-weight:800; font-size:0.6rem; letter-spacing:0.5px;"><i class="fas fa-clipboard-list"></i> O QUE SERÁ MINISTRADO:</small>
                            <small style="color:#64748b; font-size:0.6rem; font-weight:700;">${profNome ? 'Prof. ' + profNome : ''}</small>
                        </div>
                        <div style="color:#e2e8f0; font-size:0.85rem; font-weight:500; line-height:1.6;">${conteudo}</div>
                    </div>`;
            } else {
                preview.innerHTML = '';
            }
        } catch(e) { preview.innerHTML = ''; }
    },

    async carregarMeusCheckinsPendentes() {
        const container = document.getElementById('meus-checkins-pendentes');
        if (!container || auth.role !== 'aluno') return;
        const snap = await db.collection("checkins").where("alunoId", "==", auth.currentUser.id).get();
        if (snap.empty) { container.innerHTML = ''; return; }
        container.innerHTML = `
            <small style="color:#f59e0b; font-weight:800; font-size:0.6rem; display:block; margin:8px 0 6px 0; letter-spacing:0.5px;">
                <i class="fas fa-clock"></i> AGUARDANDO VALIDAÇÃO DO PROFESSOR:
            </small>` +
            snap.docs.map(doc => {
                const c = doc.data();
                return `<div style="background:#0f172a; border:1px solid #f59e0b44; border-left:3px solid #f59e0b; border-radius:8px; padding:10px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.8rem; font-weight:700; color:#e2e8f0;">⏳ ${c.turma}</div>
                        <div style="font-size:0.6rem; color:#64748b; margin-top:2px;">Check-in pendente</div>
                    </div>
                    <button onclick="academia.cancelarMeuCheckin('${doc.id}')" style="background:#4c0519; border:none; color:#f43f5e; padding:7px 12px; border-radius:6px; font-size:0.7rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                        <i class="fas fa-times"></i> CANCELAR
                    </button>
                </div>`;
            }).join('');
    },

    async cancelarMeuCheckin(checkinId) {
        if (!confirm("Deseja cancelar seu check-in?")) return;
        try {
            await db.collection("checkins").doc(checkinId).delete();
            await this.carregarMeusCheckinsPendentes();
            await this.atualizarPresencaAntecipada();
        } catch(e) { alert("Erro ao cancelar check-in."); }
    },

    async alunoEnviaCheckin() {
        const t = document.getElementById('select-turma-aluno').value; if(t.includes("Sem treinos")) return;

        // Bloqueia adulto em turma kids e vice-versa
        const anoAtual = new Date().getFullYear();
        const nascimento = auth.currentUser?.nascimento;
        if (nascimento) {
            const idade = anoAtual - new Date(nascimento).getFullYear();
            const isKids = idade <= 14;
            const turmaKids = t.toLowerCase().includes('kids');
            const turmaMT   = this._isTurmaMT(t);
            const alunoMod  = auth.currentUser?.modalidade || 'jiujitsu';
            if (!isKids && turmaKids) {
                alert("🚫 Você está matriculado nas turmas adulto e não pode fazer check-in nas turmas Kids.");
                return;
            }
            if (isKids && !turmaKids) {
                // Kids de Muay Thai podem fazer check-in em turmas MT
                if (turmaMT && (alunoMod === 'muaythai' || alunoMod === 'ambos')) {
                    // Liberado — aluno kids na modalidade MT
                } else {
                    alert("🚫 Você está matriculado nas turmas Kids e não pode fazer check-in nas turmas adulto.");
                    return;
                }
            }
        }
        // Verifica se matrícula está trancada (leitura direta no Firestore)
        try {
            const docAtual = await db.collection('alunos').doc(auth.currentUser.id).get();
            if (docAtual.exists && docAtual.data().status === 'trancado') {
                alert("🔒 Sua matrícula está trancada.\n\nEntre em contato com a academia para reativar. OSS!");
                return;
            }
        } catch(e) { console.warn('Erro ao verificar status matrícula:', e); }

        if (typeof GaditasFiltros !== 'undefined' && auth.currentUser && auth.currentUser.email) {
            const botaoCheckin = document.querySelector("#area-aluno-checkin button");
            const botaoOriginalTxt = botaoCheckin ? botaoCheckin.innerText : "ENVIAR CHECK-IN AGORA";
            if (botaoCheckin) { botaoCheckin.innerText = "VALIDANDO CADASTRO... ⏳"; botaoCheckin.disabled = true; }
            const estahInadimplente = await GaditasFiltros.verificarBloqueioInadimplencia(auth.currentUser.email);
            if (botaoCheckin) { botaoCheckin.innerText = botaoOriginalTxt; botaoCheckin.disabled = false; }
            if (estahInadimplente) {
                alert("🛑 CHECK-IN RECUSADO!\n\nIdentificamos pendências na tua mensalidade vencidas há mais de 3 dias.\n\nPor favor, aceda à aba 'FINANCEIRO' no menu inferior para regularizar via PIX ou Cartão e liberar o teu acesso ao tatame. OSS!");
                return;
            }
        }
        // Verifica duplicata — mesmo aluno, mesma turma, mesmo dia
        try {
            const snapCI = await db.collection("checkins")
                .where("alunoId", "==", auth.currentUser.id)
                .where("turma", "==", t).get();
            const inicioHoje = new Date(); inicioHoje.setHours(0,0,0,0);
            const jaMandou = snapCI.docs.some(d => d.data().data >= inicioHoje.getTime());
            if (jaMandou) return alert("⚠️ Você já enviou check-in para esta turma hoje! OSS!");
        } catch(e) { console.warn("Verificação duplicado falhou:", e.message); }

        await db.collection("checkins").add({ alunoId: auth.currentUser.id, alunoNome: auth.currentUser.nome, turma: t, data: new Date().getTime() });
        alert("Check-in enviado!"); this.atualizarPresencaAntecipada(); this.carregarMeusCheckinsPendentes();
    },

    async renderRanking() {
        const snap = await db.collection("alunos").get();
        const agora    = new Date();
        const anoAtual = agora.getFullYear();
        const mesAtual = agora.getMonth(); // 0-indexed

        const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                        'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const nomeMes = meses[mesAtual];

        // Atualiza títulos com o mês atual
        const tJJ = document.getElementById('titulo-ranking-jj');
        const tMT = document.getElementById('titulo-ranking-mt');
        if (tJJ) tJJ.innerHTML = `<i class="fas fa-trophy"></i> 🥋 Top 5 Jiu-Jitsu — ${nomeMes}`;
        if (tMT) tMT.innerHTML = `<i class="fas fa-trophy"></i> 🥊 Top 5 Muay Thai — ${nomeMes}`;

        // ── Helper: conta treinos NO MÊS ATUAL pelo histórico ──────
        // historico[].data formato: "DD/MM/AAAA, HH:MM:SS" (toLocaleString pt-BR)
        const aulasDoMes = (historico, isMT) => {
            if (!historico || !historico.length) return 0;
            return historico.filter(h => {
                if (!h.data) return false;
                // Extrai dia, mês, ano da string "DD/MM/AAAA..."
                const partes = h.data.split('/');
                if (partes.length < 3) return false;
                const mes = parseInt(partes[1]) - 1;         // 0-indexed
                const ano = parseInt(partes[2]);              // "2026, 15:30" → parseInt pega 2026
                if (mes !== mesAtual || ano !== anoAtual) return false;
                // Filtra por modalidade (JJ ou MT)
                const ehMT = this._isTurmaMT(h.turma || '');
                return isMT ? ehMT : !ehMT;
            }).length;
        };

        // ── JIU-JITSU ────────────────────────────────────────────────
        const listasJJ = { kids1: [], kids2: [], adulto: [] };
        snap.forEach(doc => {
            const a = doc.data();
            if ((a.modalidade || 'jiujitsu') === 'muaythai') return;
            const idade = anoAtual - new Date(a.nascimento).getFullYear();
            const aulasJJMes = aulasDoMes(a.historico, false);
            const entrada = { ...a, _aulasRanking: aulasJJMes };
            if      (idade <= 8)  listasJJ.kids1.push(entrada);
            else if (idade <= 14) listasJJ.kids2.push(entrada);
            else                  listasJJ.adulto.push(entrada);
        });
        ['kids1','kids2','adulto'].forEach(id => {
            const c = document.getElementById(`lista-ranking-${id}`); if (!c) return;
            const ordenado = listasJJ[id].sort((x, y) => y._aulasRanking - x._aulasRanking);
            c.innerHTML = ordenado.slice(0, 5).map((a, i) => `
                <div class="ranking-item">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.85rem; font-weight:700;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}</span>
                        <span style="font-weight:600; color:#cbd5e1; font-size:0.8rem;">${a.nome}</span>
                    </div>
                    <div style="text-align:right;"><b style="color:#3b82f6; font-size:0.85rem; font-weight:800;">${a._aulasRanking}</b></div>
                </div>`).join('') || "<small style='color:var(--text-muted);'>Nenhum treino em " + nomeMes + ".</small>";
        });

        // ── MUAY THAI — lista única (kids + adulto juntos) ───────────
        const listaMTGeral = [];
        snap.forEach(doc => {
            const a = doc.data();
            const mod = a.modalidade || 'jiujitsu';
            if (mod !== 'muaythai' && mod !== 'ambos') return;
            const aulasMTMes = aulasDoMes(a.historico, true);
            const idade = anoAtual - new Date(a.nascimento).getFullYear();
            const tag = idade <= 14 ? ' <span style="font-size:0.5rem;color:#f59e0b;font-weight:800;background:#1c1400;border:1px solid #f59e0b44;border-radius:4px;padding:1px 5px;margin-left:3px;">KIDS</span>' : '';
            listaMTGeral.push({ ...a, _aulasRanking: aulasMTMes, _tag: tag });
        });
        const cMTG = document.getElementById('lista-ranking-mt-geral');
        if (cMTG) {
            const ordenadoMT = listaMTGeral.sort((x, y) => y._aulasRanking - x._aulasRanking);
            cMTG.innerHTML = ordenadoMT.slice(0, 5).map((a, i) => `
                <div class="ranking-item">
                    <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
                        <span style="font-size:0.85rem; font-weight:700; flex-shrink:0;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}º`}</span>
                        <span style="font-weight:600; color:#cbd5e1; font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.nome}${a._tag}</span>
                    </div>
                    <div style="text-align:right; flex-shrink:0;"><b style="color:#f43f5e; font-size:0.85rem; font-weight:800;">${a._aulasRanking}</b></div>
                </div>`).join('') || `<small style='color:var(--text-muted);'>Nenhum treino em ${nomeMes}.</small>`;
        }
    },

    async editarAluno(id) {
        const doc = await db.collection("alunos").doc(id).get(); const a = doc.data(); const isAdmin = auth.role === 'admin';
        document.getElementById('edit-aluno-id').value = id; document.getElementById('nome-aluno').value = a.nome;
        document.getElementById('email-aluno').value = a.email; document.getElementById('nascimento-aluno').value = a.nascimento || '';
        // Modalidade
        const mod = a.modalidade || 'jiujitsu';
        this.selecionarModalidade(mod);
        const anoAtual = new Date().getFullYear();
        if (a.nascimento) {
            const idade = anoAtual - new Date(a.nascimento).getFullYear();
            document.getElementById('select-faixa').innerHTML = graduacao.getFaixas(idade).map(f => `<option value="${f}">${f}</option>`).join('');
        } else {
            document.getElementById('select-faixa').innerHTML = graduacao.adulto.map(f => `<option value="${f}">${f}</option>`).join('');
        }
        if (a.faixa) { document.getElementById('select-faixa').value = a.faixa; }
        ui.atualizarGraus();
        if (a.grau !== undefined) { document.getElementById('select-graus').value = a.grau; }
        // Graduação MT (sem graus — só faixa)
        if (mod === 'muaythai' || mod === 'ambos') {
            const selFaixaMT = document.getElementById('select-faixa-mt');
            if (selFaixaMT && a.faixaMT) selFaixaMT.value = a.faixaMT;
        }
        const idadeAtleta = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
        if (idadeAtleta <= 14 && isAdmin) {
            document.getElementById('admin-painel-leoes').classList.remove('hidden');
            const hist = a.historicoLeoes || [];
            this.leoesFichaTemp.leaoAtencao = hist.filter(i => i.campo === 'leaoAtencao' && i.faixa === a.faixa).length;
            this.leoesFichaTemp.leaoComportamento = hist.filter(i => i.campo === 'leaoComportamento' && i.faixa === a.faixa).length;
            this.leoesFichaTemp.leaoCompanheirismo = hist.filter(i => i.campo === 'leaoCompanheirismo' && i.faixa === a.faixa).length;
            this.leoesFichaTemp.leaoDisciplina = hist.filter(i => i.campo === 'leaoDisciplina' && i.faixa === a.faixa).length;
            for(const k in this.leoesFichaTemp) {
                const label = document.getElementById(`label-qty-${k}`);
                if(label) label.innerText = this.leoesFichaTemp[k];
            }
        } else {
            document.getElementById('admin-painel-leoes').classList.add('hidden');
        }
        document.querySelectorAll('#card-gestao-atleta input, #card-gestao-atleta select').forEach(el => el.disabled = !isAdmin);
        document.getElementById('btn-salvar-atleta').style.display = isAdmin ? 'block' : 'none';
        ui.showTab('tab-alunos');
    },

    // ── PROMOVER ALUNO A PROFESSOR ────────────────────────
    async abrirModalPromoverProfessor() {
        // Remove modal anterior se existir
        const anterior = document.getElementById('modal-promover-prof');
        if (anterior) anterior.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-promover-prof';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; overflow-y:auto; padding:20px;';
        modal.innerHTML = `
            <div style="background:#1e293b; border-radius:16px; padding:20px; max-width:480px; margin:0 auto; width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <div>
                        <div style="font-size:0.65rem; color:#64748b; font-weight:700; text-transform:uppercase;">Admin</div>
                        <div style="font-size:1rem; font-weight:800; color:white;">🥋 Promover a Professor</div>
                        <div style="font-size:0.7rem; color:#64748b;">Faixas Roxa, Marrom e Preta</div>
                    </div>
                    <button onclick="document.getElementById('modal-promover-prof').remove()"
                        style="background:#334155; border:none; color:white; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:700; font-size:1rem;">✕</button>
                </div>
                <input type="text" id="busca-candidato-prof" placeholder="🔍 Buscar atleta pelo nome..."
                    oninput="academia.buscarCandidatoProf()"
                    style="width:100%; padding:11px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; margin-bottom:10px;"/>
                <div id="lista-candidatos-prof" style="max-height:180px; overflow-y:auto; margin-bottom:10px;"></div>
                <div id="candidato-prof-selecionado" class="hidden" style="background:#0f172a; border:1px solid #3b82f6; border-radius:10px; padding:12px; margin-bottom:14px;"></div>
                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:8px; letter-spacing:0.5px;">TURMAS DE RESPONSABILIDADE:</small>
                <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px; max-height:220px; overflow-y:auto;">
                    ${[...new Set(Object.values(academia.getGrade()).flat())].filter(t => !t.includes("Sem treinos")).sort().map(t => `
                        <label style="display:flex; align-items:center; gap:8px; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; cursor:pointer; font-size:0.75rem; color:#e2e8f0; font-weight:600;">
                            <input type="checkbox" class="check-turma-prof" value="${t}" style="accent-color:#3b82f6; width:16px; height:16px;"> ${t}
                        </label>`).join('')}
                </div>
                <button onclick="academia.confirmarPromocaoProf()"
                    style="width:100%; padding:13px; background:#8b5cf6; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.3px;">
                    <i class="fas fa-graduation-cap"></i> CONFIRMAR PROMOÇÃO
                </button>
            </div>`;
        document.body.appendChild(modal);
        this._candidatoProf = null;
    },

    _candidatoProf: null,

    async buscarCandidatoProf() {
        const termo = document.getElementById('busca-candidato-prof').value.trim().toLowerCase();
        const lista = document.getElementById('lista-candidatos-prof');
        if (!termo || termo.length < 2) { lista.innerHTML = ''; return; }

        const snap = await db.collection("alunos").orderBy("nome").get();
        const faixasOk = ['Roxa', 'Marrom', 'Preta'];
        const resultados = snap.docs.filter(doc => {
            const a = doc.data();
            return a.nome.toLowerCase().includes(termo) && faixasOk.includes(a.faixa);
        }).slice(0, 5);

        if (resultados.length === 0) {
            lista.innerHTML = `<small style="color:#64748b; font-size:0.75rem; padding:8px; display:block;">Nenhum atleta Roxa/Marrom/Preta encontrado.</small>`;
            return;
        }

        lista.innerHTML = resultados.map(doc => {
            const a = doc.data();
            return `<div onclick="academia.selecionarCandidatoProf('${doc.id}', '${a.nome.replace(/'/g,"\'")}', '${a.faixa}')"
                style="background:#0f172a; border:1px solid #334155; padding:10px 12px; border-radius:8px; margin-bottom:6px; cursor:pointer; transition:border-color 0.2s;"
                onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='#334155'">
                <div style="font-size:0.8rem; font-weight:800; color:white;">${a.nome.toUpperCase()}</div>
                <div style="font-size:0.65rem; color:#64748b; margin-top:2px;">Faixa ${a.faixa} • ${a.email}</div>
            </div>`;
        }).join('');
    },

    selecionarCandidatoProf(id, nome, faixa) {
        this._candidatoProf = { id, nome, faixa };
        document.getElementById('lista-candidatos-prof').innerHTML = '';
        document.getElementById('busca-candidato-prof').value = '';
        const div = document.getElementById('candidato-prof-selecionado');
        div.classList.remove('hidden');
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:0.85rem; font-weight:800; color:white;">✅ ${nome.toUpperCase()}</div>
                    <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">Faixa ${faixa} — conta de aluno mantida</div>
                </div>
                <button onclick="academia._candidatoProf=null; document.getElementById('candidato-prof-selecionado').classList.add('hidden');"
                    style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.9rem; font-weight:700;">✕</button>
            </div>`;
    },

    async confirmarPromocaoProf() {
        if (!this._candidatoProf) return alert("Selecione um atleta primeiro.");
        const turmas = Array.from(document.querySelectorAll('.check-turma-prof:checked')).map(c => c.value);
        if (turmas.length === 0) return alert("Selecione pelo menos uma turma de responsabilidade.");

        try {
            await db.collection("alunos").doc(this._candidatoProf.id).update({
                role: 'professor',
                turmasAcesso: turmas
            });
            alert(`✅ ${this._candidatoProf.nome.toUpperCase()} agora é professor!
Turmas: ${turmas.join(', ')}`);
            document.getElementById('modal-promover-prof').remove();
            this._candidatoProf = null;
            this.renderProfessores();
        } catch(e) {
            alert("Erro ao promover: " + e.message);
        }
    },

    async renderProfessores() {
        const l = document.getElementById('list-professores'); if(!l || auth.role !== 'admin') return;
        let html = '';

        // Alunos promovidos a professor
        const snapPromovidos = await db.collection("alunos").where("role", "==", "professor").get();
        snapPromovidos.docs.forEach(doc => {
            const p = doc.data();
            const turmas = (p.turmasAcesso || []).join(', ') || 'Nenhuma';
            html += `<div class="item-card" style="padding:15px; border-left:4px solid #8b5cf6;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="background:#8b5cf6; color:white; font-size:0.5rem; padding:2px 7px; border-radius:4px; font-weight:800; display:inline-block; margin-bottom:5px;">ATLETA/PROFESSOR</span>
                        <div style="color:#e2e8f0; font-size:0.85rem; font-weight:700;">🥋 ${p.nome.toUpperCase()}</div>
                        <div style="color:var(--text-muted); font-size:0.7rem; margin-top:2px;">📧 ${p.email} • Faixa ${p.faixa}</div>
                        <div style="color:#8b5cf6; font-size:0.65rem; font-weight:700; margin-top:4px;">Turmas: ${turmas}</div>
                    </div>
                    <button onclick="academia.removerPrivilegioProf('${doc.id}', '${p.nome.replace(/'/g, "\'")}')"
                        style="background:none; border:none; color:#ef4444; cursor:pointer; padding:4px;" title="Remover privilégio">
                        <i class="fas fa-user-minus"></i>
                    </button>
                </div>
            </div>`;
        });

        // Professores da coleção antiga
        const snapProfs = await db.collection("professores").get();
        snapProfs.docs.forEach(doc => {
            const p = doc.data();
            const turmas = (p.turmasAcesso || []).join(', ') || 'Todas';
            html += `<div class="item-card" style="padding:15px; border-left:4px solid #3b82f6;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="color:#e2e8f0; font-size:0.85rem; font-weight:700;">👤 ${p.nome.toUpperCase()}</div>
                        <div style="color:var(--text-muted); font-size:0.7rem; margin-top:2px;">📧 ${p.email}</div>
                        <div style="color:#3b82f6; font-size:0.65rem; font-weight:700; margin-top:4px;">Turmas: ${turmas}</div>
                    </div>
                    <button onclick="academia.excluirProf('${doc.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer;"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        });

        l.innerHTML = html || '<p style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:10px;">Nenhum professor cadastrado.</p>';
    },

    async removerPrivilegioProf(id, nome) {
        if (!confirm(`Remover privilégios de professor de ${nome.toUpperCase()}?
Ele voltará a ser aluno normal.`)) return;
        await db.collection("alunos").doc(id).update({ role: firebase.firestore.FieldValue.delete(), turmasAcesso: firebase.firestore.FieldValue.delete() });
        alert(`${nome} voltou ao perfil de aluno.`);
        this.renderProfessores();
    },

    limparAl() { 
        document.getElementById('edit-aluno-id').value = ""; 
        document.getElementById('nome-aluno').value = ""; 
        document.getElementById('email-aluno').value = ""; 
        document.getElementById('cpf-aluno').value = "";
        document.getElementById('telefone-aluno').value = "";
        document.getElementById('cep-aluno').value = "";
        document.getElementById('rua-aluno').value = "";
        document.getElementById('numero-aluno').value = "";
        if (document.getElementById('complemento-aluno')) document.getElementById('complemento-aluno').value = "";
        if (document.getElementById('filtro-avancado-faixas')) document.getElementById('filtro-avancado-faixas').value = "all";
        document.getElementById('bairro-aluno').value = "";
        document.getElementById('cidade-aluno').value = "";
        document.getElementById('estado-aluno').value = "";
        document.getElementById('nascimento-aluno').value = "";
        document.getElementById('admin-painel-leoes').classList.add('hidden');
        document.querySelectorAll('#card-gestao-atleta input, #card-gestao-atleta select').forEach(el => el.disabled = false);
        // Reset modalidade para JJ (padrão)
        this._modalidadeAtual = 'jiujitsu';
        this.selecionarModalidade('jiujitsu');
    },

    limparPr() { document.getElementById('nome-prof').value = ""; document.getElementById('email-prof').value = ""; document.querySelectorAll('.check-turma').forEach(c => c.checked = false); },
    async excluirAluno(id) { if(confirm("Remover atleta?")) { await db.collection("alunos").doc(id).delete(); this.renderAlunos(); } },
    async verFinanceiroAluno(id, nome) {
        const doc = await db.collection("alunos").doc(id).get();
        if (!doc.exists) return alert("Aluno não encontrado.");
        const d = doc.data(); const email = d.email;
        if (!email) return alert("Aluno sem email cadastrado.");
        let modal = document.getElementById('modal-financeiro-admin');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-financeiro-admin'; modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column; overflow-y:auto; padding:20px;'; document.body.appendChild(modal); }
        modal.innerHTML = `
            <div style="background:#1e293b; border-radius:16px; padding:20px; max-width:480px; margin:0 auto; width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <div><div style="font-size:0.7rem; color:#64748b; font-weight:700;">FINANCEIRO DO ALUNO</div><div style="font-size:1rem; font-weight:800; color:white;">${nome.toUpperCase()}</div><div style="font-size:0.7rem; color:#64748b;">${email}</div></div>
                    <button onclick="document.getElementById('modal-financeiro-admin').remove()" style="background:#334155; border:none; color:white; padding:8px 12px; border-radius:8px; cursor:pointer; font-weight:700;">✕</button>
                </div>
                <div id="modal-fin-conteudo" style="color:#64748b; text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:#3b82f6; display:block; margin-bottom:8px;"></i>Consultando Asaas...</div>
            </div>`;
        modal.style.display = 'flex';
        try {
            const asaasUrl = '/api/asaas';
            const conteudo = document.getElementById('modal-fin-conteudo');
            
            let resCliente;
            try {
                resCliente = await fetch(`${asaasUrl}?endpoint=customers&email=${encodeURIComponent(email)}`);
            } catch(fetchErr) {
                conteudo.innerHTML = `<p style="color:#f43f5e;">❌ Erro de conexão com Asaas.<br><small>${fetchErr.message}</small></p>`;
                return;
            }
            
            if (!resCliente.ok) {
                conteudo.innerHTML = `<p style="color:#f43f5e;">❌ Erro na API: ${resCliente.status}</p>`;
                return;
            }
            
            const dadosCliente = await resCliente.json();
            if (!dadosCliente.data || dadosCliente.data.length === 0) { conteudo.innerHTML = `<p style="color:#f59e0b;">Aluno não localizado no Asaas.<br><small style="color:#64748b;">${email}</small></p>`; return; }
            const customerId = dadosCliente.data[0].id;
            const [resPendente, resPago, resSubs] = await Promise.all([
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=PENDING&limit=10`),
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=RECEIVED&limit=5`),
                fetch(`${asaasUrl}?endpoint=subscriptions&customer=${customerId}&status=ACTIVE&limit=5`)
            ]);
            const pendentes = await resPendente.json(); const pagos = await resPago.json(); const subs = await resSubs.json();
            const dataHoje = new Date(); dataHoje.setHours(0,0,0,0); let html = '';

            // Assinaturas ativas
            if (subs.data && subs.data.length > 0) {
                html += `<small style="color:#8b5cf6; font-weight:800; font-size:0.6rem; display:block; margin-bottom:8px;">🔄 ASSINATURA RECORRENTE</small>`;
                subs.data.forEach(s => {
                    const valor = s.value.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
                    const ciclo = s.cycle === 'MONTHLY' ? 'Mensal' : s.cycle;
                    const proxVenc = s.nextDueDate ? s.nextDueDate.split('-').reverse().join('/') : '—';
                    html += `<div style="background:#0f172a; border:1px solid #8b5cf644; border-left:3px solid #8b5cf6; border-radius:8px; padding:10px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div><div style="font-size:0.85rem; font-weight:800; color:white;">${valor}<span style="font-size:0.6rem; color:#94a3b8; margin-left:5px;">/ ${ciclo}</span></div>
                            <div style="font-size:0.6rem; color:#64748b;">Próx: ${proxVenc} • ID: ${s.id.substring(0,12)}...</div></div>
                            <span style="font-size:0.6rem; font-weight:800; color:#8b5cf6; background:#8b5cf622; padding:3px 8px; border-radius:6px;">ATIVA</span>
                        </div>
                        <button onclick="academia.cancelarAssinaturaAdmin('${s.id}','${nome.replace(/'/g,"\\'")}')" style="width:100%; padding:8px; background:#1a0a00; border:1px solid #92400e; color:#f59e0b; border-radius:7px; font-size:0.7rem; font-weight:800; cursor:pointer;">
                            ⚠️ CANCELAR ASSINATURA RECORRENTE
                        </button>
                    </div>`;
                });
            }

            if (pendentes.data && pendentes.data.length > 0) {
                pendentes.data.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
                html += `<small style="color:#f43f5e; font-weight:800; font-size:0.6rem; display:block; margin-bottom:8px;">FATURAS EM ABERTO</small>`;
                pendentes.data.forEach(f => {
                    const venc = new Date(f.dueDate + 'T00:00:00'); venc.setHours(0,0,0,0);
                    const dias = Math.floor((dataHoje - venc) / 86400000);
                    const vencStr = f.dueDate.split('-').reverse().join('/');
                    const valor = f.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    const cor = dias > 0 ? '#f43f5e' : dias === 0 ? '#f59e0b' : '#10b981';
                    const tag = dias > 0 ? `${dias}d atraso` : dias === 0 ? 'Vence hoje' : 'A vencer';
                    html += `<div style="background:#0f172a; border:1px solid ${cor}44; border-left:3px solid ${cor}; border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:0.85rem; font-weight:800; color:white;">${valor}</div><div style="font-size:0.65rem; color:#64748b;">Venc: ${vencStr}</div></div><span style="font-size:0.6rem; font-weight:800; color:${cor}; background:${cor}22; padding:3px 8px; border-radius:6px;">${tag}</span></div>`;
                });
            } else {
                html += `<div style="background:#064e3b; border:1px solid #10b981; border-radius:8px; padding:12px; text-align:center; margin-bottom:12px;"><span style="color:#10b981; font-weight:800;">✅ MENSALIDADE EM DIA!</span></div>`;
            }
            if (pagos.data && pagos.data.length > 0) {
                html += `<small style="color:#10b981; font-weight:800; font-size:0.6rem; display:block; margin:12px 0 8px 0;">ÚLTIMOS PAGAMENTOS</small>`;
                pagos.data.forEach(f => {
                    const valor = f.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    const vencStr = f.dueDate.split('-').reverse().join('/');
                    html += `<div style="background:#0f172a; border:1px solid #10b98144; border-left:3px solid #10b981; border-radius:8px; padding:10px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:0.85rem; font-weight:800; color:white;">${valor}</div><div style="font-size:0.65rem; color:#64748b;">Ref: ${vencStr}</div></div><span style="font-size:0.6rem; font-weight:800; color:#10b981; background:#10b98122; padding:3px 8px; border-radius:6px;">PAGO</span></div>`;
                });
            }
            conteudo.innerHTML = html || `<p style="color:#64748b;">Nenhuma fatura encontrada.</p>`;
        } catch(e) {
            const conteudo = document.getElementById('modal-fin-conteudo');
            if (conteudo) conteudo.innerHTML = `<p style="color:#f43f5e;">Erro: ${e.message}</p>`;
        }
    },

    async excluirProf(id) { if(confirm("Remover professor?")) { await db.collection("professores").doc(id).delete(); this.renderProfessores(); } },

    async salvarProfessor() {
        const n = document.getElementById('nome-prof').value.trim(); const e = document.getElementById('email-prof').value.trim().toLowerCase();
        const t = Array.from(document.querySelectorAll('.check-turma:checked')).map(cb => cb.value); if(!n || !e) return alert("Campos vazios.");
        await db.collection("professores").add({ nome: n, email: e, senha: "1234", turmasAcesso: t });
        alert("Sucesso!"); this.limparPr(); this.renderProfessores();
    },

    async salvarAluno() {
        const id = document.getElementById('edit-aluno-id').value;
        const novaFaixa = document.getElementById('select-faixa').value;
        const modalidadeSalva = this._modalidadeAtual || 'jiujitsu';
        const dados = {
            nome: document.getElementById('nome-aluno').value.trim(),
            email: document.getElementById('email-aluno').value.trim().toLowerCase(),
            nascimento: document.getElementById('nascimento-aluno').value,
            modalidade: modalidadeSalva,
            faixa: novaFaixa,
            grau: parseInt(document.getElementById('select-graus').value) || 0,
            cpf: document.getElementById('cpf-aluno') ? document.getElementById('cpf-aluno').value.replace(/\D/g, '') : "",
            telefone: document.getElementById('telefone-aluno') ? document.getElementById('telefone-aluno').value.replace(/\D/g, '') : "",
            cep: document.getElementById('cep-aluno') ? document.getElementById('cep-aluno').value.replace(/\D/g, '') : "",
            rua: document.getElementById('rua-aluno') ? document.getElementById('rua-aluno').value.trim() : "",
            numero: document.getElementById('numero-aluno') ? document.getElementById('numero-aluno').value.trim() : "",
            complemento: document.getElementById('complemento-aluno') ? document.getElementById('complemento-aluno').value.trim() : "",
            bairro: document.getElementById('bairro-aluno') ? document.getElementById('bairro-aluno').value.trim() : "",
            cidade: document.getElementById('cidade-aluno') ? document.getElementById('cidade-aluno').value.trim() : "",
            estado: document.getElementById('estado-aluno') ? document.getElementById('estado-aluno').value.trim().toUpperCase() : ""
        };
        // Graduação Muay Thai (sem graus — cada faixa é um nível único)
        if (modalidadeSalva === 'muaythai' || modalidadeSalva === 'ambos') {
            dados.faixaMT = document.getElementById('select-faixa-mt')?.value || 'Branco';
        }
        const painelLeoes = document.getElementById('admin-painel-leoes');
        if (id && painelLeoes && !painelLeoes.classList.contains('hidden')) {
            try {
                const antigoDoc = await db.collection("alunos").doc(id).get();
                const antigoDado = antigoDoc.data();
                let historicoLeoes = antigoDado.historicoLeoes || [];
                const dataHoje = new Date().toLocaleDateString('pt-BR');
                const nomesAmigaveis = { leaoAtencao: "Atenção", leaoComportamento: "Comportamento", leaoCompanheirismo: "Companheirismo", leaoDisciplina: "Disciplina" };
                if (antigoDado.faixa !== novaFaixa) {
                    this.leoesFichaTemp = { leaoAtencao: 0, leaoComportamento: 0, leaoCompanheirismo: 0, leaoDisciplina: 0 };
                } else {
                    historicoLeoes = historicoLeoes.filter(i => !(i.faixa === antigoDado.faixa));
                }
                for (const key in this.leoesFichaTemp) {
                    const qtd = this.leoesFichaTemp[key];
                    for (let i = 0; i < qtd; i++) {
                        historicoLeoes.unshift({ data: dataHoje, campo: key, faixa: novaFaixa, mensagem: `🎖️ Leão de ${nomesAmigaveis[key]} na Faixa ${novaFaixa}` });
                    }
                }
                dados.historicoLeoes = historicoLeoes;
            } catch (err) { console.error(err); }
        }
        if(id) {
            // Se a faixa ou grau mudou, o aluno foi graduado — limpa convocação
            try {
                const docAtual = await db.collection("alunos").doc(id).get();
                const dadosAtuais = docAtual.data() || {};
                if (dadosAtuais.aspiranteGraduacao && (dadosAtuais.faixa !== dados.faixa || dadosAtuais.grau !== dados.grau)) {
                    dados.aspiranteGraduacao = false;
                }
            } catch(e) { /* ignora */ }
            await db.collection("alunos").doc(id).update(dados);
        } else {
            await db.collection("alunos").add({...dados, aulas: 0, historico: [], historicoLeoes: []});
        }
        alert("Atleta salvo!"); this.limparAl(); this.renderAlunos(); academia.carregarConquistas();
    },

    async carregarMural() {
        db.collection("mural_avisos").onSnapshot((snap) => {
            const muralCard = document.getElementById('mural-avisos'); 
            const tC = document.getElementById('texto-aviso');
            const lH = document.getElementById('lista-historico-avisos'); 
            const lE = document.getElementById('lista-exclusao-mural');
            if (!snap.empty) {
                if (muralCard) { muralCard.classList.remove('hidden'); muralCard.classList.add('mural-urgente-neon'); }
                const anoAtual = new Date().getFullYear();
                const docsOrdenados = snap.docs.filter(doc => {
                    const av = doc.data();
                    const pub = av.publico || 'todos';
                    if (pub === 'todos') return true;
                    if (auth.role === 'admin') return true;
                    const aluno = auth.currentUser;
                    if (!aluno) return false;
                    if (pub === 'individual') return av.alunoId === aluno.id;
                    const idade = aluno.nascimento ? (anoAtual - new Date(aluno.nascimento).getFullYear()) : 99;
                    const isKids = idade <= 14;
                    const faixa = aluno.faixa || '';
                    if (pub === 'adulto') return !isKids;
                    if (pub === 'kids') return isKids;
                    if (pub === 'branca') return faixa === 'Branca';
                    if (pub === 'azul-roxa-marrom') return ['Azul','Roxa','Marrom'].includes(faixa);
                    if (pub === 'marrom-preta') return ['Marrom','Preta'].includes(faixa);
                    if (pub === 'preta') return faixa === 'Preta';
                    if (pub === 'muaythai') return ['muaythai','ambos'].includes(aluno.modalidade || 'jiujitsu');
                    return true;
                }).sort((a, b) => { const dataA = a.data().data || 0; const dataB = b.data().data || 0; return dataB - dataA; });

                if (docsOrdenados.length === 0) {
                    if (muralCard) { muralCard.classList.add('hidden'); muralCard.classList.remove('mural-urgente-neon'); }
                    return;
                }
                this.idUltimoAvisoMural = docsOrdenados[0].id;
                const popTexto = document.getElementById('popup-texto-aviso');
                const popData = document.getElementById('popup-data-aviso');
                const popModal = document.getElementById('modal-popup-aviso');
                if (popTexto && popData && popModal) {
                    if ((auth.role === 'aluno' || auth.role === 'professor') && localStorage.getItem('gaditas_ultimo_aviso_visto') !== this.idUltimoAvisoMural) {
                        popTexto.innerText = docsOrdenados[0].data().texto;
                        popData.innerText = `Publicado em: ${docsOrdenados[0].data().dataFormatada}`;
                        popModal.classList.remove('hidden');
                    }
                }
                if (tC) {
                    tC.innerHTML = docsOrdenados.slice(0,1).map(doc => `
                        <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;"><span style="color: #ef4444; font-weight: 800; font-size: 0.85rem; letter-spacing: 0.5px;"><i class="fas fa-exclamation-triangle"></i> COMUNICADO OFICIAL:</span><small style="font-size:0.6rem; opacity:0.4; color:#fff;">${doc.data().dataFormatada}</small></div>
                        <div style="font-size:0.85rem; color:#f1f5f9; line-height: 1.5; font-weight: 500;">${doc.data().texto}</div>`).join('');
                }
                if (lH) lH.innerHTML = docsOrdenados.map(doc => {
                    const av = doc.data();
                    const tag = av.labelPublico ? `<span style="background:#1e3a8a; color:#60a5fa; font-size:0.55rem; padding:2px 6px; border-radius:4px; font-weight:800; margin-left:6px;">${av.labelPublico}</span>` : '';
                    return `<div style="background:#0f172a; padding:12px; border-radius:10px; margin-bottom:8px; border:1px solid var(--border-light);">
                        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:4px;">
                            <small style="font-size:0.6rem; color:var(--text-muted);">${av.dataFormatada}</small>${tag}
                        </div>
                        <div style="color:#ccc; font-size:0.8rem; line-height:1.4;">${av.texto}</div>
                    </div>`;
                }).join('');
                if (lE) {
                    lE.innerHTML = docsOrdenados.map(doc => {
                        const av = doc.data();
                        const tag = av.labelPublico ? `<span style="background:#1e3a8a; color:#60a5fa; font-size:0.55rem; padding:2px 5px; border-radius:4px; font-weight:800; margin-right:4px;">${av.labelPublico}</span>` : '';
                        return `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 10px; border-radius: 8px; margin-bottom: 6px; border:1px solid var(--border-light);">
                            <span style="font-size: 0.75rem; color:#cbd5e1; overflow: hidden; text-overflow: ellipsis; flex:1; font-weight:500;">${tag}📢 ${av.texto}</span>
                            <button onclick="academia.excluirAviso('${doc.id}')" style="background:none; border:none; color:#f43f5e; cursor:pointer; padding:5px; min-width:28px;"><i class="fas fa-trash"></i></button>
                        </div>`;
                    }).join('');
                }
            } else { 
                if (muralCard) { muralCard.classList.add('hidden'); muralCard.classList.remove('mural-urgente-neon'); } 
                if (lE) lE.innerHTML = "<small style='color:var(--text-muted);'>Nenhum comunicado ativo.</small>"; 
            }
        });
    },

    publicoMuralAtual: 'todos',
    _tipoRelatoAtual: 'machucado',
    _professorRelatoId: null,
    _professorRelatoNome: null,
    _relatoListener: null,
    _relatosVistos: {},             // Map { docId: respostaText } — persiste no localStorage
    _relatoRespondidoAtual: null,   // {id, resposta} da resposta em exibição no toast
    alunoMuralSelecionado: null,

    selecionarPublicoMural(publico) {
        this.publicoMuralAtual = publico;
        this.alunoMuralSelecionado = null;
        const botoes = ['todos','individual','adulto','kids','branca','azul-roxa-marrom','marrom-preta','preta','muaythai'];
        botoes.forEach(b => {
            const btn = document.getElementById(`mural-btn-${b}`);
            if (!btn) return;
            btn.style.background = '#0f172a';
            btn.style.color = '#94a3b8';
        });
        const btnAtivo = document.getElementById(`mural-btn-${publico}`);
        if (btnAtivo) { btnAtivo.style.background = '#3b82f6'; btnAtivo.style.color = 'white'; }
        const buscaDiv = document.getElementById('mural-busca-individual');
        if (buscaDiv) {
            if (publico === 'individual') {
                buscaDiv.classList.remove('hidden');
            } else {
                buscaDiv.classList.add('hidden');
                document.getElementById('mural-lista-alunos').innerHTML = '';
                document.getElementById('mural-aluno-selecionado').classList.add('hidden');
                document.getElementById('mural-input-busca-aluno').value = '';
            }
        }
    },

    async buscarAlunoMural() {
        const termo = document.getElementById('mural-input-busca-aluno').value.trim().toLowerCase();
        const lista = document.getElementById('mural-lista-alunos');
        if (!termo || termo.length < 2) { lista.innerHTML = ''; return; }
        const snap = await db.collection("alunos").orderBy("nome").get();
        const resultados = snap.docs.filter(doc => doc.data().nome.toLowerCase().includes(termo)).slice(0, 6);
        lista.innerHTML = resultados.map(doc => `
            <div onclick="academia.selecionarAlunoMural('${doc.id}', '${doc.data().nome.replace(/'/g, "\\'")}')"
                 style="background:#0f172a; border:1px solid #334155; padding:10px; border-radius:8px; margin-bottom:5px; cursor:pointer; font-size:0.8rem; color:#e2e8f0; font-weight:600;">
                👤 ${doc.data().nome.toUpperCase()}
                <small style="color:#64748b; display:block; font-size:0.65rem;">${doc.data().faixa} • ${doc.data().email}</small>
            </div>`).join('') || `<small style="color:#64748b;">Nenhum aluno encontrado.</small>`;
    },

    selecionarAlunoMural(id, nome) {
        this.alunoMuralSelecionado = { id, nome };
        document.getElementById('mural-lista-alunos').innerHTML = '';
        document.getElementById('mural-input-busca-aluno').value = '';
        const div = document.getElementById('mural-aluno-selecionado');
        div.classList.remove('hidden');
        div.innerHTML = `✅ Selecionado: <strong>${nome.toUpperCase()}</strong> <button onclick="academia.limparAlunoMural()" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.75rem; font-weight:700; margin-left:8px;">✕ Remover</button>`;
    },

    limparAlunoMural() {
        this.alunoMuralSelecionado = null;
        document.getElementById('mural-aluno-selecionado').classList.add('hidden');
        document.getElementById('mural-input-busca-aluno').value = '';
        document.getElementById('mural-lista-alunos').innerHTML = '';
    },

    // ══════════════════════════════════════════
    // MURAL DE DEPOIMENTOS & FEEDBACK
    // ══════════════════════════════════════════
    toggleDepoimentos() {
        const card = document.getElementById('card-depoimentos');
        const btn  = document.getElementById('btn-depoimentos-trigger');
        if (!card) return;
        const isOpen = !card.classList.contains('hidden');
        if (isOpen) {
            card.classList.add('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = '';
        } else {
            card.classList.remove('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = 'rotate(180deg)';
            this.carregarDepoimentos();
        }
    },

    async carregarDepoimentos() {
        const lista = document.getElementById('lista-depoimentos-publicos');
        const badge = document.getElementById('badge-depoimentos-count');
        if (!lista) return;
        lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:12px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>';
        try {
            const snap = await db.collection('depoimentos')
                .where('aprovado', '==', true)
                .get();
            const docs = snap.docs.sort((a, b) => (b.data().data || 0) - (a.data().data || 0));
            if (badge) {
                badge.textContent = docs.length;
                badge.classList.toggle('hidden', docs.length === 0);
            }
            if (docs.length === 0) {
                lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:20px; font-size:0.75rem;">Nenhum depoimento ainda. Seja o primeiro! ⭐</small>';
                return;
            }
            const isAdmin = auth.role === 'admin';
            lista.innerHTML = docs.map(doc => {
                const d = doc.data();
                const iniciais = (d.alunoNome || '?').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
                const beltLabel = d.faixa ? `<span style="font-size:0.55rem; color:#94a3b8; display:block; margin-top:2px;">${d.faixa}${d.grau ? ' · ' + d.grau + 'ºG' : ''}${d.modalidadeLabel ? ' · ' + d.modalidadeLabel : ''}</span>` : '';
                const destaque = d.destaque ? '<span style="color:#f59e0b; font-size:0.8rem; margin-right:4px;">⭐</span>' : '';
                const btnExcluir = isAdmin
                    ? `<button onclick="academia.excluirDepoimentoAprovado('${doc.id}')" title="Excluir depoimento" style="background:none; border:none; color:#475569; cursor:pointer; font-size:0.8rem; padding:2px 4px; flex-shrink:0;" onmouseover="this.style.color='#f43f5e'" onmouseout="this.style.color='#475569'"><i class="fas fa-trash"></i></button>`
                    : '';
                return `<div style="background:${d.destaque ? 'linear-gradient(135deg,#1c1400,#2d1e00)' : '#0f172a'}; border:1px solid ${d.destaque ? '#f59e0b55' : '#1e293b'}; border-radius:12px; padding:14px; margin-bottom:10px;">
                    <div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;">
                        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#1e3a8a,#7c3aed); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; color:white; flex-shrink:0;">${iniciais}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.8rem; font-weight:800; color:#f1f5f9;">${destaque}${(d.alunoNome || '').toUpperCase()}</div>
                            ${beltLabel}
                        </div>
                        <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                            <small style="color:#475569; font-size:0.6rem;">${d.dataFormatada || ''}</small>
                            ${btnExcluir}
                        </div>
                    </div>
                    <p style="color:#cbd5e1; font-size:0.8rem; line-height:1.6; margin:0; font-style:italic;">"${d.texto}"</p>
                </div>`;
            }).join('');
        } catch(e) {
            lista.innerHTML = `<small style="color:#f43f5e; display:block; text-align:center; padding:12px;">Erro ao carregar: ${e.message}</small>`;
        }
    },

    toggleMeuDepoimento() {
        const card = document.getElementById('card-meu-depoimento');
        const btn  = document.getElementById('btn-meu-depoimento-trigger');
        if (!card) return;
        const isOpen = !card.classList.contains('hidden');
        if (isOpen) {
            card.classList.add('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = '';
        } else {
            card.classList.remove('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = 'rotate(180deg)';
            this._verificarMeuDepoimento();
        }
    },

    async _verificarMeuDepoimento() {
        if (!auth.currentUser) return;
        const statusEl = document.getElementById('meu-depoimento-status');
        const formEl   = document.getElementById('meu-depoimento-form');
        const badge    = document.getElementById('badge-meu-dep-enviado');
        const LIMITE   = 2;
        try {
            const snap = await db.collection('depoimentos')
                .where('alunoId', '==', auth.currentUser.id)
                .get();
            // Filtra apenas os do mês atual
            const now = new Date();
            const esteMes = snap.docs.filter(d => {
                const dt = new Date(d.data().data || 0);
                return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
            });
            const usados    = esteMes.length;
            const restantes = LIMITE - usados;
            const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const mesLabel = meses[now.getMonth()];
            // Badge: mostra se tem algum aprovado no histórico total
            const temAprovado = snap.docs.some(d => d.data().aprovado);
            if (badge) badge.classList.toggle('hidden', !temAprovado);
            // Monta cards de status deste mês
            let statusHTML = '';
            esteMes.forEach(doc => {
                const d = doc.data();
                if (d.aprovado) {
                    statusHTML += `<div style="background:#064e3b; border:1px solid #10b981; border-radius:10px; padding:10px 12px; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:0.7rem;">⭐</span>
                            <span style="color:#34d399; font-weight:800; font-size:0.72rem;">PUBLICADO</span>
                            <small style="color:#475569; font-size:0.6rem; margin-left:auto;">${d.dataFormatada || ''}</small>
                        </div>
                        <p style="color:#6ee7b7; font-size:0.75rem; margin:0; font-style:italic;">"${d.texto}"</p>
                    </div>`;
                } else {
                    statusHTML += `<div style="background:#1c1400; border:1px solid #f59e0b44; border-radius:10px; padding:10px 12px; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:0.7rem;">⏳</span>
                            <span style="color:#f59e0b; font-weight:800; font-size:0.72rem;">AGUARDANDO APROVAÇÃO</span>
                            <small style="color:#475569; font-size:0.6rem; margin-left:auto;">${d.dataFormatada || ''}</small>
                        </div>
                        <p style="color:#fde68a; font-size:0.75rem; margin:0; font-style:italic;">"${d.texto}"</p>
                    </div>`;
                }
            });
            if (statusHTML) {
                statusHTML = `<small style="color:#64748b; font-size:0.6rem; font-weight:800; display:block; margin-bottom:6px; letter-spacing:0.3px;">SEUS DEPOIMENTOS EM ${mesLabel.toUpperCase()}:</small>` + statusHTML;
            }
            if (statusEl) statusEl.innerHTML = statusHTML;
            // Mostra formulário se ainda tem cota no mês
            if (restantes > 0) {
                if (formEl) {
                    formEl.classList.remove('hidden');
                    const aviso = formEl.querySelector('small[data-cota]');
                    const avisoPadrao = formEl.querySelector('small:not([data-cota])');
                    if (avisoPadrao) {
                        avisoPadrao.setAttribute('data-cota', '1');
                        avisoPadrao.textContent = `⚠️ Você pode enviar mais ${restantes} depoimento${restantes > 1 ? 's' : ''} em ${mesLabel}. Será revisado pelo admin.`;
                    }
                }
            } else {
                if (formEl) formEl.classList.add('hidden');
                if (statusEl) {
                    statusEl.innerHTML += `<div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:10px; text-align:center; margin-top:4px;">
                        <span style="color:#475569; font-size:0.75rem; font-weight:700;">🗓 Limite de ${LIMITE} depoimentos por mês atingido.<br><small style="font-weight:400;">Volte em ${meses[(now.getMonth()+1)%12]}!</small></span>
                    </div>`;
                }
            }
        } catch(e) { console.warn('_verificarMeuDepoimento:', e.message); }
    },

    async enviarDepoimento() {
        if (!auth.currentUser) return;
        const textarea = document.getElementById('textarea-depoimento');
        const texto = textarea ? textarea.value.trim() : '';
        if (!texto || texto.length < 10) return alert('Escreva pelo menos 10 caracteres no depoimento.');
        const u = auth.currentUser;
        const mod = u.modalidade || 'jiujitsu';
        const modLabel = mod === 'jiujitsu' ? 'JJJ' : mod === 'muaythai' ? 'MT' : 'JJJ+MT';
        const LIMITE = 2;
        try {
            // Conta depoimentos do mês atual
            const snap = await db.collection('depoimentos').where('alunoId', '==', u.id).get();
            const now = new Date();
            const esteMes = snap.docs.filter(d => {
                const dt = new Date(d.data().data || 0);
                return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
            });
            if (esteMes.length >= LIMITE) {
                const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                return alert(`Você já enviou ${LIMITE} depoimentos em ${meses[now.getMonth()]}. Volte no mês que vem!`);
            }
            await db.collection('depoimentos').add({
                alunoId:         u.id,
                alunoNome:       u.nome,
                faixa:           u.faixa || '',
                grau:            u.grau  || 0,
                faixaMT:         u.faixaMT || '',
                modalidade:      mod,
                modalidadeLabel: modLabel,
                texto,
                aprovado:        false,
                destaque:        false,
                data:            new Date().getTime(),
                dataFormatada:   new Date().toLocaleDateString('pt-BR')
            });
            if (textarea) textarea.value = '';
            this._verificarMeuDepoimento();
        } catch(e) { alert('Erro ao enviar: ' + e.message); }
    },

    // ── Admin: depoimentos pendentes + aprovados ───────────
    async carregarDepoimentosPendentes() {
        const lista  = document.getElementById('lista-dep-pendentes');
        const badge  = document.getElementById('badge-dep-pendentes');
        if (!lista) return;
        lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>';
        try {
            const snap = await db.collection('depoimentos').get();
            const pendentes = snap.docs.filter(d => !d.data().aprovado)
                .sort((a,b) => (b.data().data||0) - (a.data().data||0));
            const aprovados = snap.docs.filter(d =>  d.data().aprovado)
                .sort((a,b) => (b.data().data||0) - (a.data().data||0));
            if (badge) badge.textContent = pendentes.length;

            let html = '';

            // ── PENDENTES ──
            if (pendentes.length > 0) {
                html += `<div style="font-size:0.6rem; font-weight:800; color:#f59e0b; letter-spacing:0.5px; margin-bottom:6px;">⏳ AGUARDANDO APROVAÇÃO (${pendentes.length})</div>`;
                html += pendentes.map(doc => {
                    const d = doc.data();
                    return `<div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px;">
                            <div>
                                <div style="font-size:0.78rem; font-weight:800; color:#f1f5f9;">${(d.alunoNome||'').toUpperCase()}</div>
                                <small style="color:#64748b; font-size:0.6rem;">${d.faixa||''}${d.grau?' · '+d.grau+'ºG':''} · ${d.dataFormatada||''}</small>
                            </div>
                            <div style="display:flex; gap:5px; flex-shrink:0;">
                                <button onclick="academia.aprovarDepoimento('${doc.id}')" style="background:#064e3b; border:1px solid #10b981; color:#34d399; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.7rem; font-weight:800;">✓ APROVAR</button>
                                <button onclick="academia.rejeitarDepoimento('${doc.id}')" style="background:#2a0808; border:1px solid #f43f5e55; color:#f43f5e; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.7rem; font-weight:800;">✗</button>
                            </div>
                        </div>
                        <p style="color:#94a3b8; font-size:0.78rem; line-height:1.5; margin:0 0 6px; font-style:italic;">"${d.texto}"</p>
                        <button onclick="academia.destaqueDepoimento('${doc.id}',${!d.destaque})" style="background:none; border:none; color:${d.destaque?'#f59e0b':'#475569'}; cursor:pointer; font-size:0.65rem; font-weight:700; padding:0;"><i class="fas fa-star"></i> ${d.destaque?'REMOVER DESTAQUE':'DESTAQUE'}</button>
                    </div>`;
                }).join('');
            } else {
                html += '<small style="color:#64748b; display:block; text-align:center; padding:10px 0; font-size:0.7rem;">Nenhum pendente ✅</small>';
            }

            // ── APROVADOS / PUBLICADOS ──
            html += `<div style="font-size:0.6rem; font-weight:800; color:#10b981; letter-spacing:0.5px; margin:12px 0 6px; border-top:1px solid #1e293b; padding-top:12px;">⭐ PUBLICADOS NO MURAL (${aprovados.length})</div>`;
            if (aprovados.length === 0) {
                html += '<small style="color:#64748b; display:block; text-align:center; padding:6px 0; font-size:0.7rem;">Nenhum aprovado ainda.</small>';
            } else {
                html += aprovados.map(doc => {
                    const d = doc.data();
                    return `<div style="background:#0a1a12; border:1px solid #10b98133; border-radius:10px; padding:10px 12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
                            <div>
                                <div style="font-size:0.78rem; font-weight:800; color:#f1f5f9;">${d.destaque?'⭐ ':''} ${(d.alunoNome||'').toUpperCase()}</div>
                                <small style="color:#64748b; font-size:0.6rem;">${d.faixa||''}${d.grau?' · '+d.grau+'ºG':''} · ${d.dataFormatada||''}</small>
                            </div>
                            <div style="display:flex; gap:5px; flex-shrink:0;">
                                <button onclick="academia.destaqueDepoimento('${doc.id}',${!d.destaque})" title="${d.destaque?'Remover destaque':'Marcar destaque'}" style="background:none; border:1px solid ${d.destaque?'#f59e0b':'#334155'}; color:${d.destaque?'#f59e0b':'#475569'}; padding:5px 8px; border-radius:6px; cursor:pointer; font-size:0.7rem;"><i class="fas fa-star"></i></button>
                                <button onclick="academia.excluirDepoimentoAprovado('${doc.id}')" title="Excluir do mural" style="background:#2a0808; border:1px solid #f43f5e55; color:#f43f5e; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.7rem; font-weight:800;"><i class="fas fa-trash"></i> EXCLUIR</button>
                            </div>
                        </div>
                        <p style="color:#6ee7b7; font-size:0.75rem; line-height:1.5; margin:0; font-style:italic;">"${d.texto}"</p>
                    </div>`;
                }).join('');
            }

            lista.innerHTML = html;
        } catch(e) {
            lista.innerHTML = `<small style="color:#f43f5e; display:block; text-align:center; padding:10px;">Erro: ${e.message}</small>`;
        }
    },

    async aprovarDepoimento(id) {
        try {
            await db.collection('depoimentos').doc(id).update({ aprovado: true });
            this.carregarDepoimentosPendentes();
            // Atualiza badge do mural público
            const badge = document.getElementById('badge-depoimentos-count');
            if (badge) {
                const n = parseInt(badge.textContent || '0') + 1;
                badge.textContent = n;
                badge.classList.remove('hidden');
            }
        } catch(e) { alert('Erro ao aprovar: ' + e.message); }
    },

    async rejeitarDepoimento(id) {
        if (!confirm('Rejeitar e excluir este depoimento?')) return;
        try {
            await db.collection('depoimentos').doc(id).delete();
            this.carregarDepoimentosPendentes();
        } catch(e) { alert('Erro ao rejeitar: ' + e.message); }
    },

    async destaqueDepoimento(id, marcar) {
        try {
            await db.collection('depoimentos').doc(id).update({ destaque: marcar });
            this.carregarDepoimentosPendentes();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async excluirDepoimentoAprovado(id) {
        if (!confirm('Excluir este depoimento do mural?')) return;
        try {
            await db.collection('depoimentos').doc(id).delete();
            this.carregarDepoimentosPendentes();
            // Atualiza mural público se estiver aberto
            const cardMural = document.getElementById('card-depoimentos');
            if (cardMural && !cardMural.classList.contains('hidden')) this.carregarDepoimentos();
        } catch(e) { alert('Erro ao excluir: ' + e.message); }
    },

    async _carregarBadgeDepoimentos() {
        try {
            const snap = await db.collection('depoimentos').where('aprovado', '==', true).get();
            const badge = document.getElementById('badge-depoimentos-count');
            if (badge) {
                badge.textContent = snap.docs.length;
                badge.classList.toggle('hidden', snap.docs.length === 0);
            }
        } catch(e) { /* silencioso */ }
    },

    // ══════════════════════════════════════════
    // RELATOS DE SAÚDE
    // ══════════════════════════════════════════
    toggleRelatoSaude() {
        const card = document.getElementById('card-relato-saude');
        if (!card) return;
        card.classList.toggle('hidden');
        if (!card.classList.contains('hidden')) {
            this.carregarRespostaRelato();
            // Esconde badge e marca resposta como vista quando aluno abre o card
            const badge = document.getElementById('badge-resposta-relato');
            if (badge) badge.classList.add('hidden');
            // Fecha o toast se estiver aberto e marca como visto
            const toast = document.getElementById('toast-resposta-relato');
            if (toast) toast.classList.add('hidden');
            this._marcarRespostaVista();
        }
    },

    iniciarListenerRelatoAluno() {
        if (!auth.currentUser || auth.role !== 'aluno') return;
        // Cancela listener anterior se houver
        if (this._relatoListener) { this._relatoListener(); this._relatoListener = null; }

        // Carrega do localStorage o Map de todas as respostas já vistas (persiste entre sessões)
        try {
            const stored = localStorage.getItem(`relatos_vistos_${auth.currentUser.id}`);
            this._relatosVistos = stored ? JSON.parse(stored) : {};
        } catch(e) { this._relatosVistos = {}; }

        this._relatoListener = db.collection("relatos_saude")
            .where("alunoId","==", auth.currentUser.id)
            .onSnapshot(snap => {
                // Analisa o snapshot completo — pega APENAS o relato ativo mais recente
                const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const ativo = todos
                    .filter(d => !d.arquivado)
                    .sort((a,b) => (b.data||0)-(a.data||0))[0];

                // Só age se o relato ativo tiver resposta
                if (!ativo || !ativo.respondido || !ativo.resposta) return;

                // Verifica se esta resposta específica já foi vista
                const jaViu = this._relatosVistos[ativo.id] === ativo.resposta;
                if (jaViu) return;

                // Guarda referência da resposta atual para salvar ao fechar/abrir
                this._relatoRespondidoAtual = { id: ativo.id, resposta: ativo.resposta };
                // Mostra toast
                const toast  = document.getElementById('toast-resposta-relato');
                const textoEl = document.getElementById('toast-resposta-texto');
                if (toast && textoEl) {
                    textoEl.textContent = ativo.resposta;
                    toast.classList.remove('hidden');
                }
                // Mostra badge no botão
                const badge = document.getElementById('badge-resposta-relato');
                if (badge) badge.classList.remove('hidden');
                // Atualiza o card se estiver aberto
                this.carregarRespostaRelato();
            });
    },

    async carregarProfessoresParaRelato() {
        const container = document.getElementById('div-selector-prof-relato');
        if (!container) return;
        container.innerHTML = '<small style="color:#475569; font-size:0.7rem;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>';
        try {
            const [snapAlunos, snapProfs] = await Promise.all([
                db.collection("alunos").where("role","==","professor").get(),
                db.collection("professores").get()
            ]);
            const lista = [];
            // Admin sempre disponível como opção
            lista.push({ id: 'admin', nome: auth.adminCreds?.nome || 'Admin' });
            // Professores da coleção alunos
            snapAlunos.docs.forEach(d => {
                const dt = d.data();
                if (!lista.find(p => p.id === d.id))
                    lista.push({ id: d.id, nome: dt.nome || dt.name || dt.email || 'Professor' });
            });
            // Professores da coleção professores
            snapProfs.docs.forEach(d => {
                const dt = d.data();
                if (!lista.find(p => p.id === d.id))
                    lista.push({ id: d.id, nome: dt.nome || dt.name || dt.email || 'Professor' });
            });
            // Reseta seleção anterior
            this._professorRelatoId   = null;
            this._professorRelatoNome = null;
            container.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:6px;">` +
                lista.map(p => `<button type="button" id="btn-prof-relato-${p.id}"
                    onclick="academia.selecionarProfessorRelato('${p.id}','${p.nome.replace(/'/g,"\\'")}' )"
                    style="padding:7px 12px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#94a3b8; font-size:0.7rem; font-weight:700; cursor:pointer;">
                    👨‍🏫 ${p.nome}</button>`).join('') +
            `</div>`;
        } catch(e) {
            container.innerHTML = '<small style="color:#f43f5e; font-size:0.7rem;">Erro ao carregar professores.</small>';
        }
    },

    selecionarProfessorRelato(id, nome) {
        this._professorRelatoId   = id;
        this._professorRelatoNome = nome;
        const container = document.getElementById('div-selector-prof-relato');
        if (!container) return;
        container.querySelectorAll('button').forEach(btn => {
            btn.style.borderColor = '#334155';
            btn.style.background  = '#0f172a';
            btn.style.color       = '#94a3b8';
        });
        const sel = document.getElementById(`btn-prof-relato-${id}`);
        if (sel) {
            sel.style.borderColor = '#f43f5e';
            sel.style.background  = '#4c0519';
            sel.style.color       = '#f43f5e';
        }
    },

    iniciarListenerRelatosProf() {
        if (auth.role !== 'admin' && auth.role !== 'professor') return;
        // Listener em tempo real nos relatos não arquivados
        db.collection("relatos_saude")
            .where("arquivado","==", false)
            .onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    // 'added': novo relato chegou — atualiza lista automaticamente
                    if (change.type === 'added') {
                        const d = change.doc.data();
                        if (auth.role === 'professor' && d.professorId !== auth.currentUser.id) return;
                        // Só atualiza se a lista estiver visível (tab gestão aberta)
                        const lista = document.getElementById('lista-relatos-saude');
                        const card  = document.getElementById('card-alertas-saude');
                        if (lista && card && !card.classList.contains('hidden')) {
                            this.carregarRelatosSaude();
                        }
                        return;
                    }
                    if (change.type === 'modified') {
                        const d = change.doc.data();
                        // Professores só recebem alertas dos relatos direcionados a eles
                        if (auth.role === 'professor' && d.professorId !== auth.currentUser.id) return;
                        if (d.recuperado) {
                            // Mostra toast verde
                            const toast = document.getElementById('toast-recuperacao-prof');
                            const nomeEl = document.getElementById('toast-recuperacao-nome');
                            if (toast && nomeEl) {
                                nomeEl.textContent = `${(d.alunoNome||'').toUpperCase()} informou que está bem! Marque como resolvido.`;
                                toast.classList.remove('hidden');
                                setTimeout(() => toast.classList.add('hidden'), 8000);
                            }
                            // Atualiza a lista se estiver aberta
                            const lista = document.getElementById('lista-relatos-saude');
                            if (lista && lista.innerHTML !== '') this.carregarRelatosSaude();
                        }
                    }
                });
            }, err => {
                console.warn('iniciarListenerRelatosProf error:', err.message);
            });
    },

    fecharToastResposta() {
        const toast = document.getElementById('toast-resposta-relato');
        if (toast) toast.classList.add('hidden');
        // Marca resposta como vista — persiste no localStorage
        this._marcarRespostaVista();
    },

    _marcarRespostaVista() {
        if (!this._relatoRespondidoAtual || !auth.currentUser) return;
        if (!this._relatosVistos) this._relatosVistos = {};
        // Adiciona esta resposta ao Map de vistas
        this._relatosVistos[this._relatoRespondidoAtual.id] = this._relatoRespondidoAtual.resposta;
        try {
            localStorage.setItem(
                `relatos_vistos_${auth.currentUser.id}`,
                JSON.stringify(this._relatosVistos)
            );
        } catch(e) {}
        this._relatoRespondidoAtual = null;
        // Esconde badge
        const badge = document.getElementById('badge-resposta-relato');
        if (badge) badge.classList.add('hidden');
    },

    selecionarTipoRelato(tipo) {
        this._tipoRelatoAtual = tipo;
        const cfg = {
            machucado: { border:'#f97316', bg:'#431407', color:'#fb923c' },
            doente:    { border:'#334155', bg:'#0f172a', color:'#64748b' }
        };
        ['machucado','doente'].forEach(t => {
            const btn = document.getElementById(`btn-tipo-${t}`);
            if (!btn) return;
            const s = t === tipo
                ? { border:'#f97316', bg:'#431407', color:'#fb923c' }
                : (t === 'doente' && tipo === 'doente')
                    ? { border:'#f43f5e', bg:'#4c0519', color:'#f43f5e' }
                    : { border:'#334155', bg:'#0f172a', color:'#64748b' };
            // cor dinâmica por tipo selecionado
            const ativo = t === tipo;
            btn.style.borderColor = ativo ? (tipo === 'machucado' ? '#f97316' : '#f43f5e') : '#334155';
            btn.style.background  = ativo ? (tipo === 'machucado' ? '#431407' : '#4c0519') : '#0f172a';
            btn.style.color       = ativo ? (tipo === 'machucado' ? '#fb923c' : '#f43f5e') : '#64748b';
        });
    },

    async enviarRelato() {
        const texto = document.getElementById('textarea-relato')?.value.trim();
        if (!texto) return alert("Descreva o que está acontecendo antes de enviar.");
        if (!this._professorRelatoId) return alert("Selecione um professor para receber o relato.");
        const aluno = auth.currentUser;
        try {
            await db.collection("relatos_saude").add({
                alunoId: aluno.id,
                alunoNome: aluno.nome || aluno.name || aluno.email,
                tipo: this._tipoRelatoAtual,
                relato: texto,
                professorId:   this._professorRelatoId,
                professorNome: this._professorRelatoNome,
                data: new Date().getTime(),
                dataFormatada: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}),
                lido: false, respondido: false, resposta: null, arquivado: false
            });
            document.getElementById('textarea-relato').value = '';
            document.getElementById('card-relato-saude').classList.add('hidden');
            alert(`✅ Relato enviado para ${this._professorRelatoNome}! OSS!`);
        } catch(e) { alert("Erro ao enviar relato."); }
    },

    async carregarRespostaRelato() {
        if (!auth.currentUser) return;
        const secForm   = document.getElementById('section-form-relato');
        const secStatus = document.getElementById('section-status-relato');
        const statusContent = document.getElementById('status-relato-content');
        const divResp   = document.getElementById('resposta-professor-relato');
        const divTexto  = document.getElementById('texto-resposta-professor');
        const divData   = document.getElementById('data-resposta-professor');
        const btnRecup  = document.getElementById('div-btn-recuperado');
        try {
            const snap = await db.collection("relatos_saude")
                .where("alunoId","==", auth.currentUser.id).get();
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const ativo = docs.filter(d => !d.arquivado).sort((a,b) => (b.data||0)-(a.data||0))[0];

            if (ativo) {
                // Há relato ativo — mostra painel de status, esconde formulário
                if (secForm)   secForm.classList.add('hidden');
                if (secStatus) secStatus.classList.remove('hidden');

                const profTag = ativo.professorNome
                    ? `<small style="color:#475569; font-size:0.6rem; display:block; margin-top:4px;">👨‍🏫 Para: <span style="color:#94a3b8;">${ativo.professorNome}</span></small>`
                    : '';

                if (ativo.recuperado) {
                    // Aluno já clicou em MELHOREI — aguarda professor confirmar
                    if (statusContent) statusContent.innerHTML = `
                        <div style="text-align:center; padding:14px; background:#0a1f14; border-radius:10px; border:1px solid #10b981;">
                            <div style="font-size:1.6rem; margin-bottom:6px;">💪</div>
                            <div style="color:#34d399; font-weight:800; font-size:0.85rem;">Recuperação informada!</div>
                            <small style="color:#6ee7b7; font-size:0.7rem;">Aguardando confirmação do professor.</small>
                            ${profTag}
                        </div>`;
                    if (btnRecup) btnRecup.classList.add('hidden');
                } else if (ativo.respondido && ativo.resposta) {
                    // Professor respondeu — mostra resposta + botão MELHOREI
                    if (statusContent) statusContent.innerHTML = `
                        <div style="background:#0f172a; border-radius:8px; padding:10px; margin-bottom:4px;">
                            <small style="color:#64748b; font-size:0.6rem;">Relato enviado em ${ativo.dataFormatada}</small>
                            ${profTag}
                            <p style="color:#cbd5e1; font-size:0.75rem; margin:4px 0 0 0; font-style:italic;">"${ativo.relato}"</p>
                        </div>`;
                    if (divTexto) divTexto.textContent = ativo.resposta;
                    if (divData)  divData.textContent  = ativo.respostaDataFormatada || '';
                    if (divResp)  divResp.classList.remove('hidden');
                    if (btnRecup) btnRecup.classList.remove('hidden');
                } else {
                    // Aguardando resposta do professor
                    if (statusContent) statusContent.innerHTML = `
                        <div style="text-align:center; padding:14px; background:#1c1206; border-radius:10px; border:1px solid #f59e0b44;">
                            <div style="font-size:1.4rem; margin-bottom:6px;">🔔</div>
                            <div style="color:#fbbf24; font-weight:800; font-size:0.8rem;">Relato enviado!</div>
                            <small style="color:#d97706; font-size:0.7rem;">O professor foi notificado e irá responder em breve.</small>
                            ${profTag}
                            <p style="color:#6b7280; font-size:0.7rem; font-style:italic; margin:8px 0 0 0;">"${ativo.relato}"</p>
                        </div>`;
                    if (divResp)  divResp.classList.add('hidden');
                    if (btnRecup) btnRecup.classList.add('hidden');
                }
            } else {
                // Sem relato ativo — mostra formulário limpo
                if (secForm)   secForm.classList.remove('hidden');
                if (secStatus) secStatus.classList.add('hidden');
                if (divResp)   divResp.classList.add('hidden');
                if (btnRecup)  btnRecup.classList.add('hidden');
                // Carrega lista de professores para seleção
                this.carregarProfessoresParaRelato();
            }
        } catch(e) {
            // Se der erro, exibe formulário e tenta carregar professores assim mesmo
            console.warn('carregarRespostaRelato error:', e.message);
            if (secForm)   secForm.classList.remove('hidden');
            if (secStatus) secStatus.classList.add('hidden');
            this.carregarProfessoresParaRelato();
        }
    },

    async marcarRecuperado() {
        if (!auth.currentUser) return;
        try {
            const snap = await db.collection("relatos_saude")
                .where("alunoId","==", auth.currentUser.id).get();
            const ativos = snap.docs.filter(d => !d.data().arquivado);
            if (ativos.length === 0) return;
            // Marca como recuperado (NÃO arquiva — professor ainda precisa resolver)
            await Promise.all(ativos.map(doc =>
                db.collection("relatos_saude").doc(doc.id).update({
                    recuperado: true,
                    dataRecuperacao: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})
                })
            ));
            // Esconde botão e atualiza card
            const btnRecup = document.getElementById('div-btn-recuperado');
            if (btnRecup) btnRecup.classList.add('hidden');
            // Feedback visual
            const card = document.getElementById('card-relato-saude');
            if (card) {
                const aviso = document.createElement('div');
                aviso.style.cssText = 'background:#064e3b; border:1px solid #10b981; border-radius:10px; padding:14px; text-align:center; margin-top:10px;';
                aviso.innerHTML = '<span style="font-size:1.5rem;">💪</span><br><span style="color:#34d399; font-weight:800; font-size:0.85rem;">Que ótimo! Fico feliz que esteja bem!</span><br><small style="color:#6ee7b7; font-size:0.7rem;">O professor foi notificado da sua recuperação.</small>';
                card.appendChild(aviso);
                setTimeout(() => { aviso.remove(); card.classList.add('hidden'); }, 3000);
            }
        } catch(e) { alert("Erro ao registrar recuperação."); }
    },

    // ══════════════════════════════════════════
    // FICHA DE SAÚDE E EMERGÊNCIA
    // ══════════════════════════════════════════
    toggleFichaSaude() {
        const card = document.getElementById('card-ficha-saude');
        const btn  = document.getElementById('btn-ficha-saude-trigger');
        if (!card) return;
        const isOpen = !card.classList.contains('hidden');
        if (isOpen) {
            card.classList.add('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = '';
        } else {
            card.classList.remove('hidden');
            const icon = btn?.querySelector('.fa-chevron-down');
            if (icon) icon.style.transform = 'rotate(180deg)';
            this.carregarFichaSaude();
        }
    },

    async carregarFichaSaude() {
        if (!auth.currentUser) return;
        try {
            const doc = await db.collection("alunos").doc(auth.currentUser.id).get();
            if (!doc.exists) return;
            const ficha = doc.data().fichaSaude || {};
            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val || '';
            };
            set('ficha-grupo', ficha.grupo);
            set('ficha-rh', ficha.rh);
            set('ficha-comorbidades', ficha.comorbidades);
            set('ficha-alergias', ficha.alergias);
            set('ficha-plano', ficha.plano);
            set('ficha-hospital', ficha.hospital);
            set('ficha-emerg1-nome', ficha.emerg1Nome);
            set('ficha-emerg1-tel', ficha.emerg1Tel);
            set('ficha-emerg2-nome', ficha.emerg2Nome);
            set('ficha-emerg2-tel', ficha.emerg2Tel);
            const chkGest = document.getElementById('ficha-gestante');
            if (chkGest) chkGest.checked = !!ficha.gestante;
            // Badge se ficha tem algum dado preenchido
            const temDados = !!(ficha.grupo || ficha.rh || ficha.comorbidades || ficha.alergias ||
                ficha.plano || ficha.hospital || ficha.emerg1Nome || ficha.emerg1Tel ||
                ficha.emerg2Nome || ficha.emerg2Tel || ficha.gestante);
            const badge = document.getElementById('badge-ficha-salva');
            if (badge) badge.classList.toggle('hidden', !temDados);
        } catch(e) { console.warn('carregarFichaSaude error:', e.message); }
    },

    async salvarFichaSaude() {
        if (!auth.currentUser) return;
        const get = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const chkGest = document.getElementById('ficha-gestante');
        const ficha = {
            grupo:        get('ficha-grupo'),
            rh:           get('ficha-rh'),
            comorbidades: get('ficha-comorbidades'),
            alergias:     get('ficha-alergias'),
            gestante:     chkGest ? chkGest.checked : false,
            plano:        get('ficha-plano'),
            hospital:     get('ficha-hospital'),
            emerg1Nome:   get('ficha-emerg1-nome'),
            emerg1Tel:    get('ficha-emerg1-tel'),
            emerg2Nome:   get('ficha-emerg2-nome'),
            emerg2Tel:    get('ficha-emerg2-tel'),
            atualizadoEm: new Date().toLocaleDateString('pt-BR') + ' às ' +
                new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})
        };
        try {
            await db.collection("alunos").doc(auth.currentUser.id).update({ fichaSaude: ficha });
            const badge = document.getElementById('badge-ficha-salva');
            if (badge) badge.classList.remove('hidden');
            // Feedback visual no botão
            const btnSalvar = document.querySelector('#card-ficha-saude > button[onclick="academia.salvarFichaSaude()"]');
            if (btnSalvar) {
                const origHTML  = btnSalvar.innerHTML;
                const origStyle = btnSalvar.getAttribute('style');
                btnSalvar.innerHTML = '<i class="fas fa-check-circle"></i> FICHA SALVA COM SUCESSO!';
                btnSalvar.style.background = 'linear-gradient(135deg,#1e3a5f,#1e40af)';
                btnSalvar.style.borderColor = '#3b82f6';
                btnSalvar.style.color = '#93c5fd';
                setTimeout(() => {
                    btnSalvar.innerHTML = origHTML;
                    btnSalvar.setAttribute('style', origStyle);
                }, 2500);
            }
        } catch(e) { alert('Erro ao salvar ficha: ' + e.message); }
    },

    // Exibe ficha de saúde de um aluno específico (uso admin/professor em emergência)
    async verFichaSaudeAluno(alunoId, nomeAluno) {
        try {
            const doc = await db.collection("alunos").doc(alunoId).get();
            const ficha = doc.exists ? (doc.data().fichaSaude || {}) : {};
            const sangue = (ficha.grupo && ficha.rh) ? `${ficha.grupo} ${ficha.rh}` : (ficha.grupo || '—');
            const linha = (label, val) => val
                ? `<div style="margin-bottom:8px;"><small style="color:#64748b;font-size:0.6rem;font-weight:800;display:block;">${label}</small><span style="color:#f1f5f9;font-size:0.8rem;">${val}</span></div>`
                : '';
            const contatoBloco = (n, tel) => (n || tel)
                ? `<div style="background:#0f172a;border-radius:8px;padding:8px;margin-bottom:6px;"><span style="color:#f1f5f9;font-size:0.8rem;font-weight:700;">${n||'—'}</span><br><span style="color:#94a3b8;font-size:0.75rem;">${tel||'—'}</span></div>`
                : '';
            const html = `
                <div style="background:#0f172a;border-radius:10px;padding:14px;margin-bottom:10px;">
                    ${linha('TIPO SANGUÍNEO', sangue !== '—' ? sangue : '')}
                    ${linha('COMORBIDADES', ficha.comorbidades)}
                    ${linha('ALERGIAS MEDICAMENTOSAS', ficha.alergias)}
                    ${ficha.gestante ? '<div style="background:#7f1d1d;border-radius:8px;padding:8px;margin-bottom:8px;text-align:center;"><span style="color:#fca5a5;font-size:0.8rem;font-weight:800;">🤰 GESTANTE</span></div>' : ''}
                    ${linha('PLANO DE SAÚDE', ficha.plano)}
                    ${linha('HOSPITAL PREFERENCIAL', ficha.hospital)}
                </div>
                ${(ficha.emerg1Nome || ficha.emerg1Tel || ficha.emerg2Nome || ficha.emerg2Tel) ? `
                <small style="color:#f59e0b;font-size:0.6rem;font-weight:800;display:block;margin-bottom:6px;">📞 CONTATOS DE EMERGÊNCIA</small>
                ${contatoBloco(ficha.emerg1Nome, ficha.emerg1Tel)}
                ${contatoBloco(ficha.emerg2Nome, ficha.emerg2Tel)}` : ''}
                ${ficha.atualizadoEm ? `<small style="color:#475569;font-size:0.6rem;">Atualizado em: ${ficha.atualizadoEm}</small>` : ''}
            `;
            // Reutiliza modal genérico ou cria um temporário
            let modal = document.getElementById('modal-ficha-saude-admin');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'modal-ficha-saude-admin';
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `
                <div style="background:#1e293b;border:1px solid #10b981;border-radius:16px;padding:20px;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                        <span style="color:#10b981;font-size:0.85rem;font-weight:800;"><i class="fas fa-notes-medical"></i> FICHA DE SAÚDE</span>
                        <button onclick="document.getElementById('modal-ficha-saude-admin').style.display='none'" style="background:none;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    <div style="color:#10b981;font-size:0.7rem;font-weight:800;margin-bottom:10px;padding:6px 10px;background:#064e3b44;border-radius:6px;">${(nomeAluno||'').toUpperCase()}</div>
                    ${html}
                </div>`;
            modal.style.display = 'flex';
        } catch(e) { alert('Erro ao carregar ficha: ' + e.message); }
    },

    async carregarRelatosSaude() {
        const card  = document.getElementById('card-alertas-saude');
        const lista = document.getElementById('lista-relatos-saude');
        const badge = document.getElementById('badge-relatos');
        if (!lista) return;
        if (card) card.classList.remove('hidden');
        lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>';
        try {
            // Busca sem orderBy/limit para evitar problemas de índice e não perder relatos ativos
            const snap = await db.collection("relatos_saude").get();
            let ativos = snap.docs
                .filter(d => !d.data().arquivado)
                .sort((a, b) => (b.data().data || 0) - (a.data().data || 0));
            // Professores só veem os direcionados a eles
            if (auth.role === 'professor') {
                ativos = ativos.filter(d => d.data().professorId === auth.currentUser.id);
            }
            const naoLidos = ativos.filter(d => !d.data().lido).length;
            if (badge) badge.textContent = naoLidos;

            if (ativos.length === 0) {
                lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:10px;">Nenhum relato ativo. ✅</small>';
                return;
            }
            lista.innerHTML = ativos.map(doc => {
                const d = doc.data();
                const icon  = d.tipo === 'machucado' ? '🤕' : '🤒';
                const label = d.tipo === 'machucado' ? 'MACHUCADO' : 'DOENTE';
                const cor   = d.tipo === 'machucado' ? '#f97316' : '#f43f5e';
                const isRecup = !!d.recuperado;
                const bordaEstilo = isRecup ? 'border-left:3px solid #10b981;' : (!d.lido ? 'border-left:3px solid #f43f5e;' : '');
                const bgCard = isRecup ? '#0a1f14' : '#0f172a';
                const recuperadoTag = isRecup ? `<span style="background:#064e3b; color:#34d399; font-size:0.55rem; font-weight:800; padding:2px 7px; border-radius:4px; margin-left:4px;">💪 RECUPERADO</span>` : '';
                // Admin vê tag do professor destinatário
                const profTag = auth.role === 'admin' && d.professorNome
                    ? `<span style="background:#1e3a5f; color:#93c5fd; font-size:0.55rem; font-weight:800; padding:2px 7px; border-radius:4px; margin-left:4px;">👨‍🏫 ${d.professorNome}</span>`
                    : '';
                return `<div style="background:${bgCard}; border-radius:10px; padding:12px; margin-bottom:8px; ${bordaEstilo}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                        <span style="font-weight:800; font-size:0.8rem; color:#e2e8f0;">${icon} ${(d.alunoNome||'').toUpperCase()}</span>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; justify-content:flex-end; flex-shrink:0; margin-left:6px;"><span style="background:${cor}22; color:${cor}; font-size:0.55rem; font-weight:800; padding:2px 7px; border-radius:4px;">${label}</span>${recuperadoTag}${profTag}</div>
                    </div>
                    <p style="color:#cbd5e1; font-size:0.75rem; margin:0 0 4px 0; line-height:1.5; font-style:italic;">"${d.relato}"</p>
                    <small style="color:#475569; font-size:0.6rem;">${d.dataFormatada}</small>
                    ${isRecup
                        ? `${d.respondido ? `<div style="margin-top:8px; background:#0c2344; padding:8px; border-radius:6px; border-left:2px solid #3b82f6;"><small style="color:#3b82f6; font-size:0.6rem; font-weight:800;">SUA RESPOSTA:</small><p style="color:#93c5fd; font-size:0.75rem; margin:3px 0 0 0;">${d.resposta}</p></div>` : ''}
                          <button onclick="academia.resolverRelato('${doc.id}')" style="margin-top:10px; width:100%; padding:13px; background:linear-gradient(135deg,#064e3b,#065f46); border:1px solid #10b981; color:#34d399; border-radius:10px; font-weight:800; cursor:pointer; font-size:0.8rem; letter-spacing:0.3px;">✅ RESOLVIDO — ARQUIVAR</button>`
                        : d.respondido
                        ? `<div style="margin-top:8px; background:#0c2344; padding:8px; border-radius:6px; border-left:2px solid #3b82f6;">
                               <small style="color:#3b82f6; font-size:0.6rem; font-weight:800;">SUA RESPOSTA:</small>
                               <p style="color:#93c5fd; font-size:0.75rem; margin:3px 0 0 0;">${d.resposta}</p>
                           </div>
                           <button onclick="academia.resolverRelato('${doc.id}')" style="margin-top:6px; width:100%; padding:7px; background:#064e3b22; border:1px solid #10b98144; color:#10b981; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.65rem;">✓ RESOLVIDO</button>`
                        : `<div style="display:flex; gap:6px; margin-top:8px;">
                               <input type="text" id="resp-${doc.id}" placeholder="Responder ao aluno..." style="flex:1; padding:8px; background:#1e293b; border:1px solid #334155; color:white; border-radius:6px; outline:none; font-size:0.75rem;"/>
                               <button onclick="academia.responderRelato('${doc.id}')" style="padding:8px 12px; background:#3b82f6; border:none; color:white; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.7rem; white-space:nowrap;"><i class="fas fa-reply"></i> ENVIAR</button>
                           </div>
                           <button onclick="academia.resolverRelato('${doc.id}')" style="margin-top:6px; width:100%; padding:7px; background:#064e3b22; border:1px solid #10b98144; color:#10b981; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.65rem;">✓ RESOLVIDO SEM RESPONDER</button>`
                    }
                </div>`;
            }).join('');
            // Marca ativos como lidos
            ativos.filter(d => !d.data().lido).forEach(doc => {
                db.collection("relatos_saude").doc(doc.id).update({ lido: true }).catch(()=>{});
            });
        } catch(e) {
            console.error('carregarRelatosSaude error:', e.message);
            lista.innerHTML = `<small style="color:#f43f5e; display:block; text-align:center; padding:10px;">⚠️ Erro ao carregar relatos: ${e.message}</small>`;
        }
    },

    async responderRelato(id) {
        const input = document.getElementById(`resp-${id}`);
        const texto = input?.value.trim();
        if (!texto) return alert("Escreva uma resposta antes de enviar.");
        try {
            await db.collection("relatos_saude").doc(id).update({
                respondido: true, resposta: texto,
                respostaDataFormatada: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})
            });
            this.carregarRelatosSaude();
        } catch(e) { alert("Erro ao responder."); }
    },

    async resolverRelato(id) {
        if (!confirm("Marcar este relato como resolvido?")) return;
        try {
            await db.collection("relatos_saude").doc(id).update({ arquivado: true });
            this.carregarRelatosSaude();
        } catch(e) { alert("Erro."); }
    },

    async salvarAvisoMural() {
        const txt = document.getElementById('input-mural').value.trim();
        if (!txt) return alert("Escreva um comunicado antes de publicar.");
        const publico = this.publicoMuralAtual || 'todos';
        if (publico === 'individual' && !this.alunoMuralSelecionado) {
            return alert("Selecione um aluno para enviar o comunicado individual.");
        }
        const labelPublico = {
            'todos': '👥 Todos', 'individual': `👤 ${this.alunoMuralSelecionado?.nome || ''}`,
            'adulto': '🥋 Adulto', 'kids': '🧒 Kids', 'branca': '⬜ Faixa Branca',
            'azul-roxa-marrom': '🟦 Azul/Roxa/Marrom', 'marrom-preta': '🟫 Marrom/Preta', 'preta': '⬛ Faixa Preta',
            'muaythai': '🥊 Muay Thai'
        };
        try {
            await db.collection("mural_avisos").add({
                texto: txt, publico, alunoId: publico === 'individual' ? this.alunoMuralSelecionado.id : null,
                alunoNome: publico === 'individual' ? this.alunoMuralSelecionado.nome : null,
                labelPublico: labelPublico[publico] || publico,
                data: new Date().getTime(),
                dataFormatada: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
            });

            // ── Envia push notification para os alunos do público selecionado ──
            try {
                const snapAlunos = await db.collection('alunos').get();
                const anoAtual = new Date().getFullYear();
                const tokens = [];
                const alunoIndivId = this.alunoMuralSelecionado?.id;
                snapAlunos.forEach(doc => {
                    const a = doc.data();
                    if (!a.fcmToken) return;
                    if (publico === 'todos')      { tokens.push(a.fcmToken); return; }
                    if (publico === 'individual') { if (doc.id === alunoIndivId) tokens.push(a.fcmToken); return; }
                    const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
                    const isKids = idade <= 14;
                    const faixa = a.faixa || '';
                    const mod   = a.modalidade || 'jiujitsu';
                    if (publico === 'adulto'           && !isKids)                                       tokens.push(a.fcmToken);
                    if (publico === 'kids'             && isKids)                                        tokens.push(a.fcmToken);
                    if (publico === 'branca'           && faixa === 'Branca')                            tokens.push(a.fcmToken);
                    if (publico === 'azul-roxa-marrom' && ['Azul','Roxa','Marrom'].includes(faixa))      tokens.push(a.fcmToken);
                    if (publico === 'marrom-preta'     && ['Marrom','Preta'].includes(faixa))            tokens.push(a.fcmToken);
                    if (publico === 'preta'            && faixa === 'Preta')                             tokens.push(a.fcmToken);
                    if (publico === 'muaythai'         && ['muaythai','ambos'].includes(mod))            tokens.push(a.fcmToken);
                });
                if (tokens.length > 0) {
                    fetch('/api/push-comunicado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tokens, title: '📢 Gaditas — Novo comunicado', body: txt.substring(0, 150) })
                    }).catch(e => console.warn('Push mural falhou:', e));
                }
            } catch(ePush) { console.warn('Erro ao montar push do mural:', ePush); }

            document.getElementById('input-mural').value = "";
            this.alunoMuralSelecionado = null;
            this.selecionarPublicoMural('todos');
            alert(`🎯 Comunicado publicado para: ${labelPublico[publico]}!`);
        } catch (e) { alert("Erro ao salvar comunicado."); }
    },

    async abrirHistoricoAvisosAluno() {
        const container = document.getElementById('historico-avisos-aluno');
        const lista = document.getElementById('lista-historico-avisos-aluno');
        if (!container || !lista) return;
        container.classList.remove('hidden');
        lista.innerHTML = '<small style="color:#64748b;">Carregando...</small>';

        const snap = await db.collection("mural_avisos").orderBy("data", "desc").limit(20).get();
        const anoAtual = new Date().getFullYear();
        const aluno = auth.currentUser;

        const docs = snap.docs.filter(doc => {
            const av = doc.data();
            const pub = av.publico || 'todos';
            if (pub === 'todos') return true;
            if (pub === 'individual') return av.alunoId === aluno.id;
            const idade = aluno.nascimento ? (anoAtual - new Date(aluno.nascimento).getFullYear()) : 99;
            const isKids = idade <= 14;
            const faixa = aluno.faixa || '';
            if (pub === 'adulto') return !isKids;
            if (pub === 'kids') return isKids;
            if (pub === 'branca') return faixa === 'Branca';
            if (pub === 'azul-roxa-marrom') return ['Azul','Roxa','Marrom'].includes(faixa);
            if (pub === 'marrom-preta') return ['Marrom','Preta'].includes(faixa);
            if (pub === 'preta') return faixa === 'Preta';
            if (pub === 'muaythai') return ['muaythai','ambos'].includes(aluno.modalidade || 'jiujitsu');
            return false;
        });

        if (docs.length === 0) {
            lista.innerHTML = '<small style="color:#64748b;">Nenhum comunicado encontrado.</small>';
            return;
        }

        lista.innerHTML = docs.map(doc => {
            const av = doc.data();
            return `<div style="background:#0f172a; padding:12px; border-radius:10px; margin-bottom:8px; border:1px solid #334155;">
                <small style="color:#64748b; font-size:0.6rem;">${av.dataFormatada}</small>
                <div style="color:#e2e8f0; font-size:0.8rem; line-height:1.4; margin-top:4px;">${av.texto}</div>
            </div>`;
        }).join('');
    },

    marcarAvisoComoLido() { if (this.idUltimoAvisoMural) { localStorage.setItem('gaditas_ultimo_aviso_visto', this.idUltimoAvisoMural); const m = document.getElementById('modal-popup-aviso'); if(m) m.classList.add('hidden'); } },
    async excluirAviso(id) { if (confirm("Deseja apagar definitivamente este aviso do mural?")) { await db.collection("mural_avisos").doc(id).delete(); alert("Aviso removido!"); } },

    // ══════════════════════════════════════════════════════════
    // ── 11. DASHBOARD VISUAL ADMIN ────────────────────────────
    // ══════════════════════════════════════════════════════════
    async renderDashboardAdmin() {
        if (auth.role !== 'admin') return;
        let container = document.getElementById('dashboard-admin-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboard-admin-container';
            container.style.marginBottom = '16px';
            const relTab = document.getElementById('tab-relatorios');
            if (relTab) relTab.insertBefore(container, relTab.firstChild);
        }
        container.innerHTML = `<div style="text-align:center;padding:12px;color:#64748b;font-size:0.75rem;"><i class="fas fa-spinner fa-spin"></i> Carregando dashboard...</div>`;
        try {
            const snap = await db.collection('alunos').get();
            const agora = new Date();
            const ms7  = agora.getTime() - 7  * 86400000;
            const ms30 = agora.getTime() - 30 * 86400000;
            const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
            const anoAtual = agora.getFullYear();
            let total = 0, ativos7 = 0, inativos30 = 0, kids = 0, adulto = 0, jj = 0, mt = 0, ambos = 0;

            snap.forEach(doc => {
                const a = doc.data();
                if (a.status === 'trancado') return;
                total++;
                const hist = a.historico || [];
                let ultimaDataMs = null;
                if (hist[0]?.data) {
                    const p = hist[0].data.split(',')[0].split('/');
                    if (p.length === 3) ultimaDataMs = new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime();
                }
                if (ultimaDataMs && ultimaDataMs >= ms7)  ativos7++;
                if (!ultimaDataMs || ultimaDataMs < ms30) inativos30++;
                const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
                if (idade <= 14) kids++; else adulto++;
                const mod = a.modalidade || 'jiujitsu';
                if (mod === 'muaythai') mt++; else if (mod === 'ambos') ambos++; else jj++;
            });

            let novosMes = 0;
            try {
                const snapN = await db.collection('novos_cadastros').where('data', '>=', primeiroDiaMes).get();
                novosMes = snapN.size;
            } catch(_) {}

            const pctAtivos = total > 0 ? Math.round((ativos7 / total) * 100) : 0;
            const corAtivos  = pctAtivos >= 60 ? '#10b981' : pctAtivos >= 30 ? '#f59e0b' : '#f43f5e';

            container.innerHTML = `
                <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:12px;padding:16px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#94a3b8;margin-bottom:12px;letter-spacing:0.5px;">🎛️ DASHBOARD — VISÃO GERAL</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                        <div style="background:#1e3a8a22;border:1px solid #3b82f644;border-radius:10px;padding:12px;text-align:center;">
                            <span style="font-size:0.5rem;color:#60a5fa;font-weight:800;display:block;margin-bottom:3px;">🧑‍🤝‍🧑 TOTAL</span>
                            <span style="font-size:2rem;font-weight:900;color:#3b82f6;">${total}</span>
                        </div>
                        <div style="background:#064e3b22;border:1px solid #10b98144;border-radius:10px;padding:12px;text-align:center;">
                            <span style="font-size:0.5rem;color:#34d399;font-weight:800;display:block;margin-bottom:3px;">🔥 ATIVOS (7d)</span>
                            <span style="font-size:2rem;font-weight:900;color:${corAtivos};">${ativos7}</span>
                            <span style="font-size:0.55rem;color:#64748b;">${pctAtivos}% do total</span>
                        </div>
                        <div style="background:#4c051922;border:1px solid #f43f5e44;border-radius:10px;padding:12px;text-align:center;">
                            <span style="font-size:0.5rem;color:#f43f5e;font-weight:800;display:block;margin-bottom:3px;">💤 INATIVOS (+30d)</span>
                            <span style="font-size:2rem;font-weight:900;color:#f43f5e;">${inativos30}</span>
                        </div>
                        <div style="background:#78350f22;border:1px solid #f59e0b44;border-radius:10px;padding:12px;text-align:center;">
                            <span style="font-size:0.5rem;color:#fbbf24;font-weight:800;display:block;margin-bottom:3px;">🆕 NOVOS (mês)</span>
                            <span style="font-size:2rem;font-weight:900;color:#f59e0b;">${novosMes}</span>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;">
                            <span style="font-size:0.5rem;color:#94a3b8;font-weight:800;display:block;margin-bottom:6px;">FAIXA ETÁRIA</span>
                            <div style="font-size:0.7rem;display:flex;justify-content:space-between;">
                                <span style="color:#60a5fa;">🥋 ${adulto} adultos</span>
                                <span style="color:#fbbf24;">🧒 ${kids} kids</span>
                            </div>
                        </div>
                        <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;">
                            <span style="font-size:0.5rem;color:#94a3b8;font-weight:800;display:block;margin-bottom:6px;">MODALIDADE</span>
                            <div style="font-size:0.65rem;color:#e2e8f0;">
                                JJJ <strong>${jj}</strong> · MT <strong>${mt}</strong> · ⚡ <strong>${ambos}</strong>
                            </div>
                        </div>
                    </div>
                </div>`;
        } catch(e) {
            container.innerHTML = `<div style="color:#f43f5e;text-align:center;font-size:0.75rem;padding:10px;">Erro: ${e.message}</div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // ── 12. STORIES ───────────────────────────────────────────
    // ══════════════════════════════════════════════════════════
    async renderStoriesBar() {
        const bar = document.getElementById('stories-bar');
        if (!bar) return;
        try {
            const snap = await db.collection('stories').orderBy('criadoEm', 'desc').limit(20).get();
            const agora = Date.now();
            const vistos  = JSON.parse(localStorage.getItem('gaditas_stories_vistos') || '{}');
            const isAdmin = auth.role === 'admin';
            const stories = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => !s.duracaoDias || (agora - s.criadoEm) < s.duracaoDias * 86400000);

            if (stories.length === 0 && !isAdmin) { bar.innerHTML = ''; return; }

            let html = `<div style="display:flex;gap:12px;overflow-x:auto;padding:6px 2px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">`;

            if (isAdmin) {
                html += `<div onclick="academia.abrirFormStory()" style="flex-shrink:0;cursor:pointer;text-align:center;">
                    <div style="width:58px;height:58px;border-radius:50%;background:#1e293b;border:2px dashed #334155;display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:#64748b;">+</div>
                    <span style="font-size:0.5rem;color:#64748b;display:block;margin-top:4px;font-weight:700;">STORY</span>
                </div>`;
            }

            stories.forEach(s => {
                const visto = !!vistos[s.id];
                const anel  = visto
                    ? 'border:2px solid #334155;'
                    : 'border:2px solid transparent;background-image:linear-gradient(white,white),linear-gradient(135deg,#f43f5e,#f59e0b);background-origin:border-box;background-clip:padding-box,border-box;';
                html += `<div style="flex-shrink:0;cursor:pointer;text-align:center;position:relative;" onclick="academia.abrirStory('${s.id}','${s.imageUrl.replace(/'/g,"\\'")}','${(s.titulo||'').replace(/'/g,"\\'")}','${(s.link||'').replace(/'/g,"\\'")}')">
                    <div style="width:58px;height:58px;border-radius:50%;overflow:hidden;${anel}">
                        <img src="${s.imageUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=font-size:1.6rem;line-height:58px;>📸</div>'"/>
                    </div>
                    ${isAdmin ? `<button onclick="event.stopPropagation();academia.excluirStory('${s.id}')" style="position:absolute;top:-4px;right:-4px;background:#f43f5e;border:none;color:white;border-radius:50%;width:18px;height:18px;font-size:0.6rem;cursor:pointer;line-height:18px;padding:0;">✕</button>` : ''}
                    <span style="font-size:0.5rem;color:#94a3b8;display:block;margin-top:4px;font-weight:700;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.titulo || 'Story'}</span>
                </div>`;
            });
            html += `</div>`;
            bar.innerHTML = html;
        } catch(e) {
            bar.innerHTML = '';
        }
    },

    abrirStory(id, imageUrl, titulo, link) {
        // Marca como visto
        const vistos = JSON.parse(localStorage.getItem('gaditas_stories_vistos') || '{}');
        vistos[id] = true;
        localStorage.setItem('gaditas_stories_vistos', JSON.stringify(vistos));
        this.renderStoriesBar(); // atualiza borda

        let overlay = document.getElementById('overlay-story');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'overlay-story';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;';
            overlay.onclick = e => { if (e.target === overlay) this.fecharStory(); };
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <style>@keyframes storyBar{from{width:0}to{width:100%}}</style>
            <div style="position:absolute;top:0;left:0;right:0;height:3px;background:#1e293b;">
                <div style="height:100%;background:linear-gradient(90deg,#f43f5e,#f59e0b);animation:storyBar 8s linear forwards;border-radius:2px;"></div>
            </div>
            <button onclick="academia.fecharStory()" style="position:absolute;top:18px;right:18px;background:rgba(255,255,255,0.15);border:none;color:white;width:36px;height:36px;border-radius:50%;font-size:1.1rem;cursor:pointer;z-index:1;">✕</button>
            <img src="${imageUrl}" style="max-width:100%;max-height:82vh;object-fit:contain;border-radius:4px;" onerror="this.alt='Imagem indisponível'"/>
            ${titulo ? `<div style="position:absolute;bottom:${link ? '70px' : '24px'};left:0;right:0;text-align:center;padding:0 24px;">
                <span style="background:rgba(0,0,0,0.75);color:white;padding:8px 18px;border-radius:20px;font-size:0.9rem;font-weight:700;">${titulo}</span>
            </div>` : ''}
            ${link ? `<div style="position:absolute;bottom:18px;left:0;right:0;text-align:center;">
                <button onclick="window.open('${link}')" style="background:#3b82f6;color:white;border:none;padding:10px 28px;border-radius:20px;font-size:0.8rem;font-weight:700;cursor:pointer;">🔗 VER MAIS</button>
            </div>` : ''}`;
        overlay.style.display = 'flex';
    },

    fecharStory() {
        document.getElementById('overlay-story')?.remove();
    },

    abrirFormStory() {
        let modal = document.getElementById('modal-form-story');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-form-story'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;';
        const opts = [{ v: 1, l: '24 horas' }, { v: 3, l: '3 dias' }, { v: 7, l: '7 dias' }, { v: 0, l: 'Sem expirar' }].map(o => `<option value="${o.v}">${o.l}</option>`).join('');
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:400px;margin-top:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <span style="font-size:0.95rem;font-weight:800;color:white;">📸 POSTAR STORY</span>
                    <button onclick="document.getElementById('modal-form-story').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
                </div>

                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:8px;">IMAGEM *</small>

                <!-- Opção 1: galeria -->
                <div id="story-preview-box" style="display:none;width:100%;border-radius:10px;background:#0f172a;border:1px solid #334155;margin-bottom:8px;overflow:hidden;position:relative;">
                    <img id="story-preview-img" src="" style="width:100%;height:140px;object-fit:cover;border-radius:10px;" />
                    <div id="story-img-info" style="font-size:0.55rem;color:#64748b;padding:4px 8px;text-align:center;background:#0f172a;"></div>
                    <button onclick="academia._limparImagemStory()" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);border:none;color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.75rem;">✕</button>
                </div>
                <label id="story-galeria-label" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px;background:#1e3a8a;border:1px solid #3b82f6;color:#93c5fd;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:700;margin-bottom:8px;box-sizing:border-box;">
                    <i class="fas fa-image"></i> ESCOLHER DA GALERIA
                    <input type="file" id="story-file-input" accept="image/*" style="display:none;" onchange="academia._previewImagemStory(this)">
                </label>

                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div style="flex:1;height:1px;background:#334155;"></div>
                    <span style="color:#64748b;font-size:0.65rem;font-weight:700;">OU</span>
                    <div style="flex:1;height:1px;background:#334155;"></div>
                </div>

                <!-- Opção 2: URL -->
                <input type="url" id="story-imageUrl" placeholder="https://... (cole URL da imagem)" style="${inp}" oninput="academia._onUrlStoryInput(this)"/>

                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">TÍTULO (opcional)</small>
                <input type="text" id="story-titulo" placeholder="Ex: Aula especial hoje!" style="${inp}"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">LINK (opcional)</small>
                <input type="url" id="story-link" placeholder="https://..." style="${inp}"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">DURAÇÃO:</small>
                <select id="story-duracao" style="${inp}">${opts}</select>
                <button id="btn-publicar-story" onclick="academia.postarStory()" style="width:100%;padding:13px;background:linear-gradient(135deg,#f43f5e,#f59e0b);border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">📸 PUBLICAR STORY</button>
            </div>`;
    },

    _previewImagemStory(input) {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            document.getElementById('story-preview-img').src = e.target.result;
            document.getElementById('story-preview-box').style.display = 'block';
            document.getElementById('story-imageUrl').value = '';
            // Mostra tamanho original
            const kb = (file.size / 1024).toFixed(0);
            const info = document.getElementById('story-img-info');
            if (info) info.innerText = `Original: ${kb} KB — será redimensionada antes do envio`;
        };
        reader.readAsDataURL(file);
    },

    // Redimensiona e comprime imagem via Canvas antes do upload
    _redimensionarImagem(file, maxW = 1080, maxH = 1920, quality = 0.82) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                let { width, height } = img;
                // Calcula escala mantendo proporção
                const ratio = Math.min(maxW / width, maxH / height, 1); // nunca aumenta
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
                const canvas = document.createElement('canvas');
                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Falha ao processar imagem'));
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('Imagem inválida'));
            img.src = url;
        });
    },

    _onUrlStoryInput(input) {
        if (input.value.trim()) {
            // Limpa arquivo selecionado quando digita URL
            const fi = document.getElementById('story-file-input');
            if (fi) fi.value = '';
            document.getElementById('story-preview-box').style.display = 'none';
        }
    },

    _limparImagemStory() {
        const fi = document.getElementById('story-file-input');
        if (fi) fi.value = '';
        document.getElementById('story-preview-box').style.display = 'none';
        document.getElementById('story-preview-img').src = '';
    },

    async postarStory() {
        const titulo  = document.getElementById('story-titulo')?.value.trim() || '';
        const link    = document.getElementById('story-link')?.value.trim() || '';
        const duracao = parseInt(document.getElementById('story-duracao')?.value || '1');
        const btn     = document.getElementById('btn-publicar-story');

        let imageUrl = document.getElementById('story-imageUrl')?.value.trim();
        const fileInput = document.getElementById('story-file-input');
        const file = fileInput?.files?.[0];

        // Se selecionou arquivo → redimensiona e envia via servidor (bypassa Storage Rules)
        if (file && !imageUrl) {
            if (btn) { btn.disabled = true; btn.innerText = '⏳ Redimensionando...'; }
            try {
                // Redimensiona para no máximo 1080×1920 JPEG 82% de qualidade
                const blob = await this._redimensionarImagem(file, 1080, 1920, 0.82);
                const kbFinal = (blob.size / 1024).toFixed(0);
                if (btn) btn.innerText = `⏳ Enviando (${kbFinal} KB)...`;

                // Converte blob para base64
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload  = e => resolve(e.target.result.split(',')[1]); // só o base64
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                // Envia para API Vercel (usa Admin SDK — sem restrição de Storage Rules)
                const nomeArq = file.name.replace(/\s/g, '_').replace(/\.[^.]+$/, '') + '.jpg';
                const resp = await fetch('/api/upload-story', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageBase64: base64, fileName: nomeArq })
                });
                const data = await resp.json();
                if (!data.ok) throw new Error(data.error || 'Falha no upload');
                imageUrl = data.url;
            } catch(e) {
                if (btn) { btn.disabled = false; btn.innerHTML = '📸 PUBLICAR STORY'; }
                return alert('Erro ao enviar imagem: ' + e.message);
            }
        }

        if (!imageUrl) return alert('Selecione uma imagem da galeria ou informe a URL.');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Publicando...'; }
        try {
            // Garante auth antes de escrever no Firestore
            if (!firebase.auth().currentUser) {
                try { await firebase.auth().signInAnonymously(); }
                catch(e) { console.warn('anon pre-write:', e.message); }
            }
            await db.collection('stories').add({ imageUrl, titulo, link, duracaoDias: duracao, criadoEm: Date.now() });
            document.getElementById('modal-form-story')?.remove();
            alert('✅ Story publicado!');
            this.renderStoriesBar();
        } catch(e) {
            if (btn) { btn.disabled = false; btn.innerHTML = '📸 PUBLICAR STORY'; }
            alert('Erro: ' + e.message);
        }
    },

    async excluirStory(id) {
        if (!confirm('Remover este story?')) return;
        await db.collection('stories').doc(id).delete();
        this.renderStoriesBar();
    },

    // ── CONFIGURAÇÕES DO ADMIN ────────────────────────────────
    abrirConfigAdmin() {
        let modal = document.getElementById('modal-config-admin');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-config-admin'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <span style="font-size:0.95rem;font-weight:800;color:white;">⚙️ Configurações do Admin</span>
                    <button onclick="document.getElementById('modal-config-admin').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
                </div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">NOME DE EXIBIÇÃO</small>
                <input type="text" id="cfg-admin-nome" value="${auth.adminCreds.nome || 'Admin'}" style="${inp}" placeholder="Seu nome"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">USUÁRIO DE LOGIN</small>
                <input type="text" id="cfg-admin-user" value="${auth.adminCreds.user}" style="${inp}" placeholder="Usuário"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">NOVA SENHA (deixe em branco para manter)</small>
                <input type="password" id="cfg-admin-pass" placeholder="••••••••" style="${inp}"/>
                <input type="password" id="cfg-admin-pass2" placeholder="Confirmar nova senha" style="${inp}"/>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div>
                        <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">MINHA FAIXA</small>
                        <select id="cfg-admin-faixa" style="${inp} margin-bottom:0;">
                            ${['Branca','Azul','Roxa','Marrom','Preta'].map(f => `<option value="${f}" ${(auth.adminCreds.faixa||'Preta')===f?'selected':''}>${f}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">GRAU</small>
                        <select id="cfg-admin-grau" style="${inp} margin-bottom:0;">
                            ${[0,1,2,3,4,5,6].map(g => `<option value="${g}" ${(auth.adminCreds.grau??3)===g?'selected':''}>${g}º Grau</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div style="height:10px;"></div>
                <button onclick="academia.salvarConfigAdmin()" style="width:100%;padding:13px;background:#3b82f6;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">💾 SALVAR CONFIGURAÇÕES</button>
            </div>`;
    },

    async salvarConfigAdmin() {
        const nome  = document.getElementById('cfg-admin-nome')?.value.trim();
        const user  = document.getElementById('cfg-admin-user')?.value.trim().toLowerCase();
        const pass1 = document.getElementById('cfg-admin-pass')?.value;
        const pass2 = document.getElementById('cfg-admin-pass2')?.value;
        if (!nome || !user) return alert('Nome e usuário são obrigatórios.');
        if (pass1 && pass1 !== pass2) return alert('As senhas não coincidem.');
        const faixa = document.getElementById('cfg-admin-faixa')?.value || 'Preta';
        const grau  = parseInt(document.getElementById('cfg-admin-grau')?.value ?? 3);
        const dados = { nome, user, faixa, grau };
        if (pass1) dados.pass = pass1;
        try {
            await db.collection('configuracoes').doc('admin_config').set(dados, { merge: true });
            // Atualiza em memória imediatamente
            auth.adminCreds.nome  = nome;
            auth.adminCreds.user  = user;
            auth.adminCreds.faixa = faixa;
            auth.adminCreds.grau  = grau;
            if (pass1) auth.adminCreds.pass = pass1;
            if (auth.currentUser?.id === 'admin') {
                auth.currentUser.nome  = nome;
                auth.currentUser.faixa = faixa;
                auth.currentUser.grau  = grau;
                const el = document.getElementById('display-user');
                if (el) el.innerText = nome;
                auth._renderFaixaHeader();
            }
            document.getElementById('modal-config-admin')?.remove();
            alert('✅ Configurações salvas!');
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── TRANCAR / ATIVAR MATRÍCULA ────────────────────────────
    async trancarAluno(id, nome) {
        if (!confirm(`Trancar matrícula de ${nome}?\n\nO aluno ficará impedido de fazer check-in.`)) return;
        await db.collection('alunos').doc(id).update({ status: 'trancado' });
        alert(`🔒 Matrícula de ${nome} trancada.`);
        this.renderAlunos();
    },

    async ativarAluno(id, nome) {
        if (!confirm(`Reativar matrícula de ${nome}?`)) return;
        await db.collection('alunos').doc(id).update({ status: 'ativo' });
        alert(`✅ ${nome} reativado com sucesso!`);
        this.renderAlunos();
    },

    // ── CANCELAR ASSINATURA PELO ADMIN (modal financeiro do aluno) ──
    async cancelarAssinaturaAdmin(subscriptionId, nomeAluno) {
        if (!confirm(`Cancelar assinatura recorrente de ${nomeAluno}?\n\nO Asaas para de cobrar mensalmente. As faturas já emitidas permanecem.`)) return;
        try {
            const r = await fetch(`/api/asaas?endpoint=subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
            const d = await r.json();
            if (d.deleted === true || d.id) {
                alert(`✅ Assinatura de ${nomeAluno} cancelada!`);
                // Fecha o modal para o admin atualizar
                const modal = document.getElementById('modal-financeiro-admin');
                if (modal) modal.remove();
            } else {
                throw new Error(d.errors?.[0]?.description || JSON.stringify(d));
            }
        } catch(e) {
            alert('❌ Erro ao cancelar assinatura: ' + e.message);
        }
    },

    // ── WHATSAPP BUSINESS ─────────────────────────────────────
    abrirWhatsappBusiness(tel) {
        let num = tel.replace(/\D/g, '');
        if (num.startsWith('55') && num.length >= 12) num = num.slice(2);

        const ua = navigator.userAgent;
        const isAndroid = /android/i.test(ua);
        const isIOS     = /iphone|ipad|ipod/i.test(ua);

        if (isAndroid) {
            // Android: intent URL força abertura no WhatsApp Business (com.whatsapp.w4b)
            // Se não estiver instalado, redireciona para a Play Store
            const fallback = encodeURIComponent('https://play.google.com/store/apps/details?id=com.whatsapp.w4b');
            window.location.href = `intent://send?phone=55${num}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${fallback};end`;
        } else if (isIOS) {
            window.location.href = `whatsapp-business://send?phone=55${num}`;
        } else {
            // Desktop
            window.location.href = `whatsapp://send?phone=55${num}`;
        }
    },

    // ── FILTRO INATIVOS ───────────────────────────────────────
    toggleFiltroInativos() {
        this.filtroInativos = !this.filtroInativos;
        this.renderAlunos();
    },

    calcularEngajamento(h) {
        if (!h || h.length === 0) return { label: "Inativo", icon: "💤", color: "#475569" };
        const tD = new Date(); tD.setDate(tD.getDate() - 30);
        const rec = h.filter(i => { if (!i.data) return false; const p = i.data.split(',')[0].split('/'); return new Date(`${p[2]}-${p[1]}-${p[0]}`) >= tD; });
        if (rec.length >= 12) return { label: "Em Brasa", icon: "🔥", color: "#f97316" };
        return { label: "Focado", icon: "✅", color: "#10b981" };
    },

    _verificarJanelaHorario(turmaQR) {
        // Extrai o horário de início da turma — ex: "16:00 - BJJ" → 16:00
        const match = turmaQR.match(/^(\d{2}):(\d{2})/);
        if (!match) return true; // sem horário no nome → sem restrição

        const minInicio = parseInt(match[1]) * 60 + parseInt(match[2]);
        const duracoes  = this.gradeFirebase?.duracoes || {};
        const duracao   = duracoes[turmaQR] || (this.gradeFirebase?.duracaoAula) || 90;
        const minFim    = minInicio + duracao;

        const agora    = new Date();
        const minAgora = agora.getHours() * 60 + agora.getMinutes();

        // Janela: 15 min antes do início até 15 min após o término
        return minAgora >= (minInicio - 15) && minAgora <= (minFim + 15);
    },

    async processarCheckinQR(turmaQR, alunoId) {
        try {
            const alunoRef = db.collection("alunos").doc(alunoId);
            const alunoDoc = await alunoRef.get();
            if (!alunoDoc.exists) return;
            const d = alunoDoc.data();

            // Bloqueia adulto em turma kids e vice-versa
            if (d.nascimento) {
                const idade = new Date().getFullYear() - new Date(d.nascimento).getFullYear();
                const isKids = idade <= 14;
                const turmaKids = turmaQR.toLowerCase().includes('kids');
                if (!isKids && turmaKids) {
                    alert("🚫 Turma Kids não permitida para alunos adultos.");
                    return;
                }
                if (isKids && !turmaKids) {
                    alert("🚫 Turma adulto não permitida para alunos Kids.");
                    return;
                }
            }

            // Verifica duplicata no histórico
            const hoje = new Date().toLocaleDateString('pt-BR');
            const jaMandou = (d.historico || []).some(h => h.turma === turmaQR && h.data && h.data.startsWith(hoje));
            if (jaMandou) {
                alert("✅ Presença já registrada hoje! OSS!");
                return;
            }

            // Verifica janela de ±15 minutos
            const dentroJanela = this._verificarJanelaHorario(turmaQR);

            if (dentroJanela) {
                // Computa presença automaticamente
                const h = d.historico || [];
                h.unshift({ data: new Date().toLocaleString('pt-BR'), turma: turmaQR });
                const isMTqr = this._isTurmaMT(turmaQR);
                const updQR = { historico: h };
                if (isMTqr) updQR.aulasMT = (d.aulasMT || 0) + 1;
                else         updQR.aulas   = (d.aulas   || 0) + 1;
                await alunoRef.update(updQR);

                // Remove checkin pendente se existir
                const snapCI = await db.collection("checkins").where("alunoId", "==", alunoId).get();
                const batch = db.batch();
                snapCI.docs.forEach(doc => { if (doc.data().turma === turmaQR) batch.delete(doc.ref); });
                await batch.commit();

                alert("✅ Presença computada automaticamente! Turma: " + turmaQR + " OSS! 🥋");
            } else {
                // Fora da janela — envia para fila do professor aprovar
                const snapCI = await db.collection("checkins").where("alunoId", "==", alunoId).get();
                const jaTemCheckin = snapCI.docs.some(doc => doc.data().turma === turmaQR);
                if (!jaTemCheckin) {
                    await db.collection("checkins").add({
                        alunoId: alunoId,
                        alunoNome: auth.currentUser.nome,
                        turma: turmaQR,
                        data: new Date().getTime()
                    });
                }
                const duracoes = this.gradeFirebase?.duracoes || {};
                const durQR = duracoes[turmaQR] || (this.gradeFirebase?.duracaoAula) || 90;
                alert(`⚠️ Check-in enviado para aprovação!\n\nVocê está fora da janela permitida.\nA janela para esta turma é:\n• 15 min antes do início\n• até 15 min após o término (${durQR} min de aula)`);
            }
        } catch(e) { console.warn("Erro QR:", e.message); }
    },

    // ── SCANNER QR CODE IN-APP ─────────────────────────────────
    _html5QrScanner: null,

    abrirScannerQR() {
        const modal = document.getElementById('modal-scanner-qr');
        if (!modal) return;
        modal.style.display = 'flex';
        const status = document.getElementById('qr-scanner-status');

        // Garante que o #qr-reader esteja limpo antes de instanciar
        const readerEl = document.getElementById('qr-reader');
        if (readerEl) readerEl.innerHTML = '';

        if (typeof Html5Qrcode === 'undefined') {
            if (status) status.innerHTML = '<small style="color:#ef4444; font-size:0.65rem;">❌ Biblioteca de scanner não carregou. Verifique sua conexão.</small>';
            return;
        }

        try {
            this._html5QrScanner = new Html5Qrcode("qr-reader");
            const config = {
                fps: 10,
                qrbox: { width: 200, height: 200 },
                aspectRatio: 1.0,
                showTorchButtonIfSupported: true,
                showZoomSliderIfSupported: false,
            };

            this._html5QrScanner.start(
                { facingMode: "environment" }, // câmera traseira
                config,
                (decodedText) => {
                    // QR lido com sucesso
                    this._processarQRLido(decodedText);
                },
                (errorMsg) => { /* erros de frame — ignorar */ }
            ).catch(err => {
                if (status) status.innerHTML = '<small style="color:#ef4444; font-size:0.65rem;">❌ Câmera não permitida. Verifique as permissões do navegador.</small>';
                console.warn('QR scanner err:', err);
            });

        } catch(e) {
            if (status) status.innerHTML = '<small style="color:#ef4444; font-size:0.65rem;">❌ Erro ao iniciar câmera: ' + e.message + '</small>';
        }
    },

    fecharScannerQR() {
        if (this._html5QrScanner) {
            this._html5QrScanner.stop().then(() => {
                this._html5QrScanner.clear();
                this._html5QrScanner = null;
            }).catch(() => {
                this._html5QrScanner = null;
            });
        }
        const modal = document.getElementById('modal-scanner-qr');
        if (modal) modal.style.display = 'none';
        const readerEl = document.getElementById('qr-reader');
        if (readerEl) readerEl.innerHTML = '';
        const status = document.getElementById('qr-scanner-status');
        if (status) status.innerHTML = '<small style="color:#64748b; font-size:0.65rem;">Aponte a câmera para o QR Code da turma</small>';
    },

    _processarQRLido(decodedText) {
        const status = document.getElementById('qr-scanner-status');
        try {
            // Extrai o parâmetro ?checkin= da URL lida
            let turma = null;
            try {
                const url  = new URL(decodedText);
                turma = url.searchParams.get('checkin') || url.searchParams.get('turma');
            } catch(_) {
                // Não é URL — tenta usar o texto direto como nome da turma
                turma = decodedText.trim();
            }

            if (!turma) {
                if (status) status.innerHTML = '<small style="color:#f59e0b; font-size:0.65rem;">⚠️ QR Code não reconhecido. Tente novamente.</small>';
                return;
            }

            // Feedback visual imediato
            if (status) status.innerHTML = '<small style="color:#10b981; font-size:0.65rem; font-weight:800;">✅ QR lido! Processando check-in para: ' + turma + '</small>';

            // Para o scanner
            this.fecharScannerQR();

            // Processa o check-in (já logado, usa o aluno atual)
            const alunoId = auth.currentUser?.id;
            if (!alunoId) {
                alert('❌ Nenhum aluno logado. Faça login primeiro.');
                return;
            }

            setTimeout(() => this.processarCheckinQR(turma, alunoId), 300);

        } catch(e) {
            if (status) status.innerHTML = '<small style="color:#ef4444; font-size:0.65rem;">❌ Erro ao processar QR: ' + e.message + '</small>';
        }
    },

    getGrade() {
        return this.gradeFirebase || this.gradeHorarios;
    },

    async carregarGradeFirebase() {
        try {
            const doc = await db.collection('configuracoes').doc('horarios').get();
            this.gradeFirebase = doc.exists ? doc.data() : { ...this.gradeHorarios };
        } catch(e) {
            if (!this.gradeFirebase) this.gradeFirebase = { ...this.gradeHorarios };
        }
        // Atualiza o select de turmas do aluno após a grade do Firebase carregar
        if (typeof ui !== 'undefined') ui.atualizarTurmasDinamicas();
        return this.gradeFirebase;
    },

    async renderHorarios() {
        const container = document.getElementById('tab-horarios');
        if (!container) return;
        await this.carregarGradeFirebase();
        const grade = this.getGrade();
        const diasNomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const hoje = new Date().getDay();
        const isAdmin = auth.role === 'admin';
        const modoEditar = this._modoEdicaoHorarios;

        const duracaoAtual = grade.duracaoAula || 90;

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <span style="font-size:0.85rem; font-weight:800; color:${modoEditar ? '#f59e0b' : 'white'};">
                    <i class="fas fa-${modoEditar ? 'pen' : 'calendar-alt'}" style="margin-right:6px; color:${modoEditar ? '#f59e0b' : '#3b82f6'};"></i>
                    ${modoEditar ? 'EDITAR HORÁRIOS' : 'Horários e Turmas'}
                </span>
                ${isAdmin
                    ? '<div style="display:flex; gap:6px;">' +
                      '<button onclick="academia.gerarQRCodesHorarios()" style="background:#1e3a8a; border:1px solid #3b82f6; color:#60a5fa; padding:8px 12px; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">📱 QR CODES</button>' +
                      '<button onclick="academia.toggleEdicaoHorarios()" style="background:' + (modoEditar ? '#334155' : '#f59e0b') + '; border:none; color:' + (modoEditar ? 'white' : '#000') + '; padding:8px 14px; border-radius:8px; font-size:0.7rem; font-weight:800; cursor:pointer;">' + (modoEditar ? '✕ FECHAR' : '✏️ EDITAR') + '</button>' +
                      '</div>'
                    : ''}
            </div>
            <div id="bloco-duracao-aula"></div>
            <div id="bloco-info-janela"></div>
        `;

        for (let d = 0; d <= 6; d++) {
            const slots = grade[d] || grade[String(d)] || ['Sem treinos hoje'];
            const isHoje = d === hoje;

            if (modoEditar) {
                const duracoes = grade.duracoes || {};
                html += '<div style="margin-bottom:18px;">' +
                    '<div style="font-size:0.65rem; font-weight:800; color:' + (isHoje ? '#3b82f6' : '#94a3b8') + '; margin-bottom:8px; letter-spacing:0.5px;">' +
                    diasNomes[d].toUpperCase() + (isHoje ? ' — HOJE' : '') + '</div>';
                slots.forEach(slot => {
                    if (slot === 'Sem treinos hoje') {
                        html += '<div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:11px 14px; margin-bottom:6px;">' +
                            '<span style="color:#64748b; font-size:0.8rem; font-style:italic;">Sem treinos hoje</span></div>';
                        return;
                    }
                    const durSlot = duracoes[slot] || (grade.duracaoAula || 90);
                    const slotEsc = slot.replace(/'/g, "\\'");
                    html += '<div style="background:#1e293b; border:1px solid #334155; border-radius:8px; padding:8px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:6px;">' +
                        '<span style="color:#e2e8f0; font-size:0.83rem; font-weight:600; flex:1;">' + slot + '</span>' +
                        '<div style="display:flex; align-items:center; gap:3px; flex-shrink:0;">' +
                        '<input type="number" value="' + durSlot + '" min="15" max="300" title="Duração desta turma em minutos" ' +
                        'onchange="academia.salvarDuracaoSlot(\'' + slotEsc + '\', this.value)" ' +
                        'style="width:48px; padding:4px 5px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:5px; font-size:0.7rem; text-align:center; outline:none;"/>' +
                        '<span style="color:#475569; font-size:0.55rem; font-weight:600;">min</span>' +
                        '<button onclick="academia.removerHorarioAdmin(' + d + ', \'' + slotEsc + '\')" ' +
                        'style="background:none; border:none; color:#f43f5e; cursor:pointer; padding:4px 6px; font-size:0.9rem;"><i class="fas fa-times"></i></button>' +
                        '</div></div>';
                });
                html += '<div style="display:flex; gap:6px; margin-top:4px; align-items:center;">' +
                    '<input type="text" id="input-horario-' + d + '" placeholder="ex: 19:00 - BJJ" ' +
                    'style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;"/>' +
                    '<input type="number" id="input-dur-novo-' + d + '" value="90" min="15" max="300" placeholder="min" title="Duração em minutos" ' +
                    'style="width:52px; padding:10px 5px; background:#0f172a; border:1px solid #334155; color:#94a3b8; border-radius:8px; outline:none; font-size:0.75rem; text-align:center;"/>' +
                    '<button onclick="academia.adicionarHorarioAdmin(' + d + ')" ' +
                    'style="background:#3b82f6; border:none; color:white; padding:10px 14px; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem; white-space:nowrap;">+ Add</button>' +
                    '</div></div>';
            } else {
                html += `<div style="${isHoje ? 'border:1px solid #3b82f6; border-radius:12px; padding:10px;' : ''} margin-bottom:16px;">
                    <div style="font-size:0.65rem; font-weight:800; color:${isHoje ? '#3b82f6' : '#94a3b8'}; margin-bottom:8px; letter-spacing:0.5px;">
                        ${isHoje ? '📍 ' : ''}${diasNomes[d].toUpperCase()}${isHoje ? ' — HOJE' : ''}
                    </div>`;
                slots.forEach(slot => {
                    html += `<div style="background:#1e293b; border:1px solid #334155; border-radius:8px; padding:12px 14px; margin-bottom:6px;">
                        <span style="color:#e2e8f0; font-size:0.85rem; font-weight:500;">${slot}</span>
                    </div>`;
                });
                html += `</div>`;
            }
        }

        html += `
            <div style="margin-top:20px; border-top:1px solid #334155; padding-top:15px;">
                <button onclick="academia.toggleHistoricoAulas()" style="width:100%; padding:12px; background:#1e293b; border:1px solid #334155; color:#94a3b8; border-radius:10px; font-weight:800; font-size:0.75rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                    <span><i class="fas fa-history" style="color:#8b5cf6; margin-right:8px;"></i> HISTÓRICO DE AULAS MINISTRADAS</span>
                    <i class="fas fa-chevron-down" id="icon-historico-aulas"></i>
                </button>
                <div id="historico-aulas-container" class="hidden" style="margin-top:10px;"></div>
            </div>`;

        container.innerHTML = html;

        // Preenche bloco de duração separadamente (evita problema com template literal aninhado)
        const blocoDuracao = document.getElementById('bloco-duracao-aula');
        const blocoInfo    = document.getElementById('bloco-info-janela');
        if (modoEditar && isAdmin && blocoDuracao) {
            blocoDuracao.innerHTML =
                '<div style="background:#0f172a; border:1px solid #f59e0b44; border-radius:10px; padding:10px 12px; margin-bottom:16px;">' +
                    '<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">' +
                        '<i class="fas fa-clock" style="color:#f59e0b; font-size:0.7rem;"></i>' +
                        '<small style="color:#f59e0b; font-size:0.6rem; font-weight:800; letter-spacing:0.5px;">DURAÇÃO POR TURMA</small>' +
                    '</div>' +
                    '<small style="color:#64748b; font-size:0.6rem; display:block; line-height:1.5;">Cada turma tem sua pr&#243;pria dura&#231;&#227;o &mdash; edite o n&#250;mero <em>(min)</em> ao lado de cada aula.</small>' +
                    '<small style="color:#475569; font-size:0.55rem; display:block; margin-top:4px;">Padr&#227;o quando n&#227;o configurado: ' + duracaoAtual + ' min &bull; Janela QR = 15 min antes + dura&#231;&#227;o + 15 min ap&#243;s</small>' +
                '</div>';
        } else if (!modoEditar && blocoInfo) {
            blocoInfo.innerHTML =
                '<div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:8px 12px; margin-bottom:14px; display:flex; align-items:center; gap:8px;">' +
                    '<i class="fas fa-qrcode" style="color:#3b82f6; font-size:0.8rem;"></i>' +
                    '<small style="color:#64748b; font-size:0.65rem; font-weight:600;">Janela QR: 15 min antes do in&#237;cio at&#233; 15 min ap&#243;s o t&#233;rmino &bull; Dura&#231;&#227;o configurada por turma</small>' +
                '</div>';
        }
    },

    async toggleHistoricoAulas() {
        const container = document.getElementById('historico-aulas-container');
        const icon = document.getElementById('icon-historico-aulas');
        if (!container) return;
        if (!container.classList.contains('hidden')) {
            container.classList.add('hidden');
            if (icon) icon.className = 'fas fa-chevron-down';
            return;
        }
        container.classList.remove('hidden');
        if (icon) icon.className = 'fas fa-chevron-up';
        await this.renderHistoricoAulas();
    },

    async renderHistoricoAulas() {
        const container = document.getElementById('historico-aulas-container');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin" style="color:#8b5cf6; font-size:1.2rem;"></i></div>';

        try {
            // Busca simples sem orderBy para evitar necessidade de índice
            const snap = await db.collection('plano_aula').get();

            if (snap.empty) {
                container.innerHTML = '<p style="color:#64748b; text-align:center; font-size:0.8rem; padding:15px;">Nenhum histórico registrado ainda.</p>';
                return;
            }

            // Ordena por data decrescente no cliente
            const docs = snap.docs
                .filter(doc => /^\d{4}-\d{2}-\d{2}$/.test(doc.id))
                .sort((a, b) => b.id.localeCompare(a.id))
                .slice(0, 60);

            const diasNomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
            const dataHoje = this._getDataHoje();

            let html = '';
            docs.forEach(doc => {
                const dataId = doc.id;
                const planos = doc.data();
                const isHoje = dataId === dataHoje;
                const dataObj = new Date(dataId + 'T12:00:00');
                const diaSemana = diasNomes[dataObj.getDay()];
                const dataFormatada = dataObj.toLocaleDateString('pt-BR');

                // Filtra só turmas com conteúdo real
                const turmasComConteudo = Object.entries(planos).filter(([, v]) => {
                    const c = this._planoConteudo(v);
                    return c && c.trim();
                });
                if (turmasComConteudo.length === 0) return;

                html += `
                    <div style="background:#0f172a; border:1px solid ${isHoje ? '#8b5cf6' : '#334155'}; border-radius:10px; padding:12px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #334155;">
                            <span style="font-size:0.75rem; font-weight:800; color:${isHoje ? '#8b5cf6' : 'white'};">
                                ${isHoje ? '📍 ' : ''}${diaSemana.toUpperCase()}${isHoje ? ' — HOJE' : ''}
                            </span>
                            <span style="font-size:0.65rem; color:#64748b; font-weight:700; background:#1e293b; padding:3px 8px; border-radius:6px;">${dataFormatada}</span>
                        </div>
                        ${turmasComConteudo.map(([turma, val]) => {
                            const conteudo = this._planoConteudo(val);
                            const profNome = this._planoProf(val);
                            const isAdminOrProf = auth.role === 'admin' || auth.role === 'professor';
                            const itemId = 'hist_' + dataId.replace(/-/g,'') + '_' + turma.replace(/[^a-z0-9]/gi,'_');
                            const turmaEsc = turma.replace(/'/g, "\\'");
                            return `<div style="margin-bottom:8px; padding:10px; background:#1e293b; border-radius:8px; border-left:2px solid #8b5cf6;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:6px;">
                                    <small style="color:#8b5cf6; font-size:0.6rem; font-weight:800; letter-spacing:0.5px; flex:1;">
                                        <i class="fas fa-clock"></i> ${turma.toUpperCase()}
                                    </small>
                                    <small style="color:#64748b; font-size:0.6rem; font-weight:700;">${profNome ? 'Prof. ' + profNome : 'Prof. não registrado'}</small>
                                    ${isAdminOrProf ? `
                                        <button onclick="academia.editarPlanoAula('${dataId}','${turmaEsc}','${itemId}')" style="background:#1e3a8a; border:none; color:#60a5fa; padding:4px 8px; border-radius:5px; cursor:pointer; font-size:0.65rem;"><i class="fas fa-edit"></i></button>
                                        <button onclick="academia.excluirPlanoAula('${dataId}','${turmaEsc}')" style="background:#4c0519; border:none; color:#f43f5e; padding:4px 8px; border-radius:5px; cursor:pointer; font-size:0.65rem;"><i class="fas fa-trash"></i></button>
                                    ` : ''}
                                </div>
                                <div id="${itemId}" style="color:#cbd5e1; font-size:0.8rem; line-height:1.5;">${conteudo}</div>
                            </div>`;
                        }).join('')}
                    </div>`;
            });

            container.innerHTML = html || '<p style="color:#64748b; text-align:center; font-size:0.8rem; padding:15px;">Nenhum conteúdo registrado ainda.</p>';
        } catch(e) {
            container.innerHTML = `<p style="color:#f43f5e; text-align:center; font-size:0.8rem; padding:15px;">Erro ao carregar histórico.</p>`;
        }
    },

    editarPlanoAula(dataId, turma, itemId) {
        const div = document.getElementById(itemId);
        if (!div) return;
        const conteudoAtual = div.innerText.trim();
        div.innerHTML = `
            <textarea id="edit_${itemId}" rows="3"
                style="width:100%; padding:8px; background:#0f172a; border:1px solid #8b5cf6; color:white; border-radius:6px; font-size:0.8rem; outline:none; resize:none; margin-bottom:6px;">${conteudoAtual}</textarea>
            <div style="display:flex; gap:6px;">
                <button onclick="academia.salvarEdicaoHistorico('${dataId}','${turma.replace(/'/g,"\\'")}','${itemId}')"
                    style="flex:1; padding:7px; background:#8b5cf6; border:none; color:white; border-radius:6px; font-size:0.7rem; font-weight:800; cursor:pointer;">
                    <i class="fas fa-save"></i> SALVAR
                </button>
                <button onclick="academia.renderHistoricoAulas()"
                    style="flex:1; padding:7px; background:#334155; border:none; color:white; border-radius:6px; font-size:0.7rem; font-weight:800; cursor:pointer;">
                    CANCELAR
                </button>
            </div>`;
    },

    async salvarEdicaoHistorico(dataId, turma, itemId) {
        const textarea = document.getElementById('edit_' + itemId);
        if (!textarea) return;
        const novoConteudo = textarea.value.trim();
        if (!novoConteudo) return alert('O conteúdo não pode ser vazio.');
        const profNome = auth.currentUser?.nome || '';
        try {
            await db.collection('plano_aula').doc(dataId).update({ [turma]: { conteudo: novoConteudo, profNome } });
            await this.renderHistoricoAulas();
        } catch(e) { alert('Erro ao salvar edição.'); }
    },

    async excluirPlanoAula(dataId, turma) {
        if (!confirm(`Excluir o plano de "${turma}" deste dia?`)) return;
        try {
            await db.collection('plano_aula').doc(dataId).update({ [turma]: firebase.firestore.FieldValue.delete() });
            await this.renderHistoricoAulas();
        } catch(e) { alert('Erro ao excluir.'); }
    },

    toggleEdicaoHorarios() {
        this._modoEdicaoHorarios = !this._modoEdicaoHorarios;
        this.renderHorarios();
    },

    async salvarDuracaoAula() {
        const input = document.getElementById('input-duracao-aula');
        const min = parseInt(input?.value);
        if (isNaN(min) || min < 15 || min > 300) return alert("Duração inválida (15 a 300 minutos).");
        try {
            await db.collection('configuracoes').doc('horarios').set({ duracaoAula: min }, { merge: true });
            if (!this.gradeFirebase) this.gradeFirebase = {};
            this.gradeFirebase.duracaoAula = min;
            alert(`✅ Duração salva: ${min} min.\nJanela QR: 15 min antes até ${min + 15} min após o início.`);
        } catch(e) { alert("Erro ao salvar duração."); }
    },

    // Salva a duração de um slot específico (por turma)
    async salvarDuracaoSlot(slot, minStr) {
        const min = parseInt(minStr);
        if (isNaN(min) || min < 15 || min > 300) return; // silencioso — input direto
        const grade = this.getGrade();
        if (!grade.duracoes) grade.duracoes = {};
        grade.duracoes[slot] = min;
        this.gradeFirebase = grade;
        try {
            await db.collection('configuracoes').doc('horarios').set({ duracoes: grade.duracoes }, { merge: true });
        } catch(e) { console.warn('Erro ao salvar duração do slot:', e); }
    },

    async adicionarHorarioAdmin(dia) {
        const input = document.getElementById(`input-horario-${dia}`);
        if (!input || !input.value.trim()) return alert("Digite o horário e turma (ex: 19:00 - BJJ).");
        const valor = input.value.trim();
        const durInput = document.getElementById(`input-dur-novo-${dia}`);
        const durMin = durInput ? parseInt(durInput.value) : NaN;
        const grade = this.getGrade();
        const slots = (grade[dia] || grade[String(dia)] || []).filter(s => s !== 'Sem treinos hoje');
        if (!slots.includes(valor)) slots.push(valor);
        slots.sort();
        grade[dia] = slots;
        // Salva duração por slot se fornecida e válida
        if (!isNaN(durMin) && durMin >= 15 && durMin <= 300) {
            if (!grade.duracoes) grade.duracoes = {};
            grade.duracoes[valor] = durMin;
        }
        this.gradeFirebase = grade;
        try {
            await db.collection('configuracoes').doc('horarios').set(grade);
        } catch(e) { console.warn('Erro ao salvar horário:', e); }
        this.renderHorarios();
    },

    async removerHorarioAdmin(dia, slotValor) {
        if (!confirm(`Remover "${slotValor}"?`)) return;
        const grade = this.getGrade();
        const slots = (grade[dia] || grade[String(dia)] || []).filter(s => s !== slotValor);
        grade[dia] = slots.length > 0 ? slots : ['Sem treinos hoje'];
        // Remove duração do slot removido, se existir
        if (grade.duracoes && grade.duracoes[slotValor] !== undefined) {
            delete grade.duracoes[slotValor];
        }
        this.gradeFirebase = grade;
        try {
            await db.collection('configuracoes').doc('horarios').set(grade);
        } catch(e) { console.warn('Erro ao salvar horário:', e); }
        this.renderHorarios();
    },

    // ── GERADOR DE QR CODES PARA IMPRESSÃO ───────────────────
    async gerarQRCodesHorarios() {
        const grade = this.getGrade();
        const diasAbrev   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const baseUrl     = window.location.origin + window.location.pathname.replace(/index\.html$/, '');

        // Monta mapa: slot → dias em que aparece
        const slotDias = {};
        for (let d = 0; d <= 6; d++) {
            const slots = grade[d] || grade[String(d)] || [];
            slots.forEach(s => {
                if (!s.includes('Sem treinos')) {
                    if (!slotDias[s]) slotDias[s] = [];
                    slotDias[s].push(d);
                }
            });
        }
        const slots = Object.keys(slotDias).sort();
        if (slots.length === 0) return alert("Nenhuma turma cadastrada na grade.");

        // Remove modal anterior
        const anterior = document.getElementById('modal-qr-horarios');
        if (anterior) anterior.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-qr-horarios';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(2,6,23,0.97); z-index:9999; overflow-y:auto; padding:20px; box-sizing:border-box;';

        const cardsHtml = slots.map(slot => {
            const url    = baseUrl + '?checkin=' + encodeURIComponent(slot);
            const qrUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url) + '&format=png&margin=2&color=000000&bgcolor=FFFFFF';
            const dias   = slotDias[slot].map(d => diasAbrev[d]).join(' · ');
            return '<div class="qr-card" style="background:white; border-radius:12px; padding:14px 12px; text-align:center;">' +
                '<div style="font-size:0.5rem; font-weight:800; color:#64748b; letter-spacing:0.8px; margin-bottom:3px;">📅 ' + dias.toUpperCase() + '</div>' +
                '<div style="font-size:0.75rem; font-weight:800; color:#0f172a; margin-bottom:10px; line-height:1.3;">' + slot.toUpperCase() + '</div>' +
                '<img src="' + qrUrl + '" width="170" height="170" style="display:block; margin:0 auto; border-radius:6px;"/>' +
                '<div style="font-size:0.42rem; color:#94a3b8; margin-top:8px; line-height:1.5;">Gaditas Matriz — escaneie para check-in</div>' +
                '</div>';
        }).join('');

        modal.innerHTML =
            '<div style="max-width:860px; margin:0 auto;">' +
                '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; gap:10px;">' +
                    '<div>' +
                        '<div style="font-size:0.6rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Admin — Gaditas Matriz</div>' +
                        '<div style="font-size:1rem; font-weight:800; color:white; margin-top:3px;">📱 QR Codes de Check-in</div>' +
                        '<div style="font-size:0.65rem; color:#64748b; margin-top:4px;">Imprima e cole nas paredes — alunos escaneiam para registrar presença</div>' +
                    '</div>' +
                    '<div style="display:flex; gap:8px; flex-shrink:0;">' +
                        '<button onclick="academia.imprimirQRCodes()" style="background:#10b981; border:none; color:white; padding:10px 18px; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem;">🖨️ IMPRIMIR / PDF</button>' +
                        '<button onclick="document.getElementById(\'modal-qr-horarios\').remove()" style="background:#334155; border:none; color:white; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:700; font-size:1rem;">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div id="grid-qr-codes" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:14px;">' +
                    cardsHtml +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);
    },

    imprimirQRCodes() {
        const grid = document.getElementById('grid-qr-codes');
        if (!grid) return;

        const cards = Array.from(grid.querySelectorAll('.qr-card'));
        if (cards.length === 0) return;

        const win = window.open('', '_blank');
        if (!win) return alert("Permita pop-ups para imprimir.");

        let cardsImpressao = '';
        cards.forEach(card => {
            const diasEl = card.querySelector('div:first-child');
            const slotEl = card.querySelector('div:nth-child(2)');
            const imgEl  = card.querySelector('img');
            if (!imgEl) return;
            cardsImpressao +=
                '<div class="card">' +
                    '<div class="dia">' + (diasEl ? diasEl.innerText : '') + '</div>' +
                    '<div class="slot">' + (slotEl ? slotEl.innerText : '') + '</div>' +
                    '<img src="' + imgEl.src + '" width="155" height="155"/>' +
                    '<div class="rodape">Gaditas Matriz — check-in QR Code</div>' +
                '</div>';
        });

        win.document.write(
            '<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8">' +
            '<title>QR Codes — Gaditas Matriz</title>' +
            '<style>' +
            '* { box-sizing: border-box; margin: 0; padding: 0; }' +
            'body { background: #fff; font-family: sans-serif; padding: 12px; }' +
            'h1 { font-size: 13px; color: #0f172a; text-align: center; margin-bottom: 14px; font-weight: 800; }' +
            '.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }' +
            '.card { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px 10px; text-align: center; break-inside: avoid; page-break-inside: avoid; }' +
            '.dia  { font-size: 7.5px; font-weight: 800; color: #64748b; letter-spacing: 0.8px; margin-bottom: 4px; }' +
            '.slot { font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 8px; line-height: 1.3; }' +
            '.rodape { font-size: 7px; color: #94a3b8; margin-top: 7px; }' +
            '@media print { @page { margin: 8mm; } body { padding: 0; } }' +
            '</style></head><body>' +
            '<h1>📱 QR Codes — Gaditas Matriz — Check-in por turma</h1>' +
            '<div class="grid">' + cardsImpressao + '</div>' +
            '</body></html>'
        );
        win.document.close();

        // Aguarda as imagens carregarem antes de imprimir
        const imgs = win.document.querySelectorAll('img');
        let loaded = 0;
        const total = imgs.length;
        const doPrint = () => { win.focus(); win.print(); };
        if (total === 0) { setTimeout(doPrint, 300); return; }
        imgs.forEach(img => {
            img.onload  = () => { if (++loaded >= total) doPrint(); };
            img.onerror = () => { if (++loaded >= total) doPrint(); };
        });
        setTimeout(doPrint, 4000); // fallback
    },

    verificarMeta(a) {
        // Aluno exclusivo de Muay Thai não tem meta JJ
        if ((a.modalidade || 'jiujitsu') === 'muaythai') return { meta: 0, pronto: false, percent: 0 };
        if (a.faixa === "Preta") return { meta: 0, pronto: false, percent: 100 };
        let m = 40;
        if (graduacao.adulto.includes(a.faixa)) m = graduacao.regrasAulas[a.faixa][a.grau] || 40;
        else {
            const i = new Date().getFullYear() - new Date(a.nascimento).getFullYear();
            let cat = (i <= 6) ? "Pré-Mirim" : (i <= 9) ? "Mirim" : "Infanto"; m = graduacao.regrasAulas["Kids"][cat];
        }
        return { meta: m, pronto: (a.aulas || 0) >= m, percent: Math.min(((a.aulas || 0) / m) * 100, 100) };
    }
};

const ui = {
    showTab(id) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
        document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
        const activeBtn = Array.from(document.querySelectorAll('.bottom-nav .nav-item')).find(btn => btn.getAttribute('onclick').includes(id));
        if (activeBtn) activeBtn.classList.add('active');
        if(id === 'tab-alunos') {
            const inputBusca = document.getElementById('input-busca-aluno'); if (inputBusca) inputBusca.value = "";
            if (document.getElementById('filtro-avancado-faixas')) document.getElementById('filtro-avancado-faixas').value = "all";
            academia.textoBuscaNome = ""; academia.categoriaFiltroAtual = "all"; academia.filtrarCategoriaAlunos("all");
            academia.renderProfessores(); this.renderTurmasCheckboxes();
            // Carrega relatos de saúde para prof/admin
            if (auth.role === 'admin' || auth.role === 'professor') {
                const cardS = document.getElementById('card-alertas-saude');
                if (cardS) cardS.classList.remove('hidden');
                academia.carregarRelatosSaude();
            }
            // Depoimentos pendentes — carrega ao entrar na aba (card já visível via configurarVisao)
            if (auth.role === 'admin') {
                academia.carregarDepoimentosPendentes();
            }
            if (auth.role === 'admin') academia.carregarVideosPendentesAdmin();
            if (auth.role === 'professor') {
                academia.carregarVideosPendentesProf();
                const profSenha = document.getElementById('prof-senha-section');
                if (profSenha) profSenha.classList.remove('hidden');
            }
        }
        if(id === 'tab-eventos') { academia.limparFormEvento(); academia.carregarEventosAbas(); }
        if(id === 'tab-checkin') { academia.renderStoriesBar(); academia.renderRanking(); this.atualizarTurmasDinamicas(); academia.renderCheckins(); this.renderPerfilAluno(); academia.carregarConquistas(); academia.carregarBibliotecaTecnica(); academia.carregarMeusCheckinsPendentes(); if(auth.role === 'professor' || auth.role === 'admin') { academia.renderPlanoAulaProf(); academia.renderChamadaProf(); } if(auth.role === 'admin') { academia.renderPresencaAdmin(); } }
        if(id === 'tab-relatorios') { if(auth.role === 'admin') academia.renderDashboardAdmin(); academia.generarRelatorioGraduacao(); academia.calcularAnalyticsFrequencia(); }
        if(id === 'tab-horarios') { academia._modoEdicaoHorarios = false; academia.renderHorarios(); }
        if(id === 'tab-loja') { loja.renderVitrine(); if(auth.role === 'admin') { loja.mudarModoAdmin('vitrine'); loja.renderAdminLoja(); } }
    },
    getCorFaixa(f) {
        if(!f) return "#fff";
        const c = { "Branca": "#fff", "Azul": "#1e3a8a", "Roxa": "#581c87", "Marrom": "#451a03", "Preta": "#000", "Cinza": "#4b5563", "Amarela": "#ca8a04", "Laranja": "#c2410c", "Verde": "#15803d", "Vermelha": "#dc2626" };
        return c[f.split('/')[0]] || "#fff";
    },

    // ── BELT VISUAL (prajerão) ──────────────────────────────
    _corJJSingle(nome) {
        const c = {
            'Branca':'#e2e8f0', 'Cinza':'#6b7280', 'Amarela':'#ca8a04',
            'Laranja':'#ea580c', 'Verde':'#15803d', 'Azul':'#1d4ed8',
            'Roxa':'#7c3aed',   'Marrom':'#92400e', 'Preta':'#111827',
            'Vermelha':'#dc2626'
        };
        return c[nome.trim()] || '#e2e8f0';
    },

    _corMTSingle(nome) {
        const c = {
            'Branco':'#e2e8f0', 'Vermelha':'#dc2626',
            'Azul Clara':'#60a5fa', 'Azul Escura':'#1d4ed8', 'Preta':'#111827'
        };
        return c[nome.trim()] || '#475569';
    },

    renderBeltJJ(faixa, grau) {
        const partes = (faixa || 'Branca').split('/');
        const cor1 = this._corJJSingle(partes[0]);
        const cor2 = partes[1] ? this._corJJSingle(partes[1]) : null;
        // Faixas combinadas: listra horizontal no meio
        const bodyBg = cor2
            ? `linear-gradient(to bottom, ${cor1} 34%, ${cor2} 34%, ${cor2} 66%, ${cor1} 66%)`
            : cor1;
        // Faixa preta: corpo mais escuro + tarja vermelha
        const isPreta = partes[0] === 'Preta';
        const corCorpo = isPreta ? '#000000' : bodyBg;
        const corTarja = isPreta ? '#dc2626' : '#000';
        const corListra = isPreta ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.92)';
        let stripesFinal = '';
        for (let i = 0; i < (grau || 0); i++) {
            stripesFinal += `<div style="width:3px; height:75%; background:${corListra}; border-radius:1px;"></div>`;
        }
        // Estrutura: [corpo colorido][tarja c/ graus][pequeno pedaço colorido]
        return `<div style="display:flex; height:10px; border-radius:3px; overflow:hidden; width:100%; margin-top:4px;">
            <div style="flex:3; background:${corCorpo};"></div>
            <div style="width:2px; background:#000;"></div>
            <div style="flex:1; background:${corTarja}; display:flex; align-items:center; justify-content:center; gap:2px;">${stripesFinal}</div>
            <div style="width:2px; background:#000;"></div>
            <div style="flex:0.25; background:${corCorpo};"></div>
        </div>`;
    },

    renderBeltMT(faixaMT) {
        const f = faixaMT || 'Branco';
        // "Preta, Ponta Branca e Vermelha" — Grão Mestre (3 cores)
        if (f.includes('Branca e Vermelha')) {
            return `<div style="display:flex; height:10px; border-radius:3px; overflow:hidden; width:100%; margin-top:4px;">
                <div style="flex:2; background:#111827;"></div>
                <div style="flex:1; background:#e2e8f0;"></div>
                <div style="flex:1; background:#dc2626;"></div>
            </div>`;
        }
        if (f.includes(' ponta ')) {
            const parts = f.split(' ponta ');
            const c1 = this._corMTSingle(parts[0].trim());
            const c2 = this._corMTSingle(parts[1].trim());
            return `<div style="display:flex; height:10px; border-radius:3px; overflow:hidden; width:100%; margin-top:4px;">
                <div style="flex:3; background:${c1};"></div>
                <div style="width:2px; background:#0a0a0f;"></div>
                <div style="flex:1; background:${c2};"></div>
            </div>`;
        }
        const cor = this._corMTSingle(f);
        return `<div style="display:flex; height:10px; border-radius:3px; overflow:hidden; width:100%; margin-top:4px;">
            <div style="flex:1; background:${cor};"></div>
        </div>`;
    },
    getCorFaixaMT(f) {
        if (!f) return "#475569";
        if (f.startsWith("Branco"))           return "#cbd5e1";   // branco
        if (f.startsWith("Vermelha ponta"))   return "#dc2626";   // vermelho
        if (f === "Vermelha")                 return "#dc2626";   // vermelho
        if (f.startsWith("Azul Clara ponta")) return "#60a5fa";   // azul clara
        if (f === "Azul Clara")               return "#60a5fa";   // azul clara
        if (f.startsWith("Azul Escura ponta"))return "#1d4ed8";   // azul escura
        if (f === "Azul Escura")              return "#1d4ed8";   // azul escura
        if (f.startsWith("Preta ponta"))      return "#334155";   // preta/branca
        if (f.includes("Branca e Vermelha"))  return "#7f1d1d";   // grão mestre
        if (f === "Preta")                    return "#0f172a";   // preta
        return "#475569";
    },
    configurarVisao() {
        const isAdmin = auth.role === 'admin'; const isProf = auth.role === 'professor';
        document.getElementById('menu-alunos').style.display = (isAdmin || isProf) ? "flex" : "none";
        document.getElementById('menu-relatorios').style.display = isAdmin ? "flex" : "none";
        document.getElementById('area-professor-checkin').classList.toggle('hidden', !isAdmin && !isProf);
        const planoProfDiv = document.getElementById('plano-aula-professor');
        if (planoProfDiv) planoProfDiv.classList.toggle('hidden', !isAdmin && !isProf);
        // Professor/aluno vê área de check-in próprio
        document.getElementById('area-aluno-checkin').classList.toggle('hidden', auth.role !== 'aluno' && auth.role !== 'professor');
        document.getElementById('admin-mural-editor').classList.toggle('hidden', !isAdmin);
        document.getElementById('admin-prof-section').classList.toggle('hidden', !isAdmin);
        document.getElementById('list-professores').classList.toggle('hidden', !isAdmin);
        document.getElementById('title-professores').classList.toggle('hidden', !isAdmin);
        document.getElementById('admin-tecnica-editor').classList.toggle('hidden', !isAdmin);
        const profVideo = document.getElementById('prof-video-editor');
        if (profVideo) profVideo.classList.toggle('hidden', !isProf);
        const profSenhaSection = document.getElementById('prof-senha-section');
        if (profSenhaSection) profSenhaSection.classList.toggle('hidden', !isProf);
        document.getElementById('card-gestao-atleta').classList.toggle('hidden', isProf && !document.getElementById('edit-aluno-id').value);
        document.getElementById('admin-eventos-editor').classList.toggle('hidden', !isAdmin);
        // Card depoimentos pendentes — só admin, usa display block/none
        const cardDepAdmin = document.getElementById('card-depoimentos-admin');
        if (cardDepAdmin) cardDepAdmin.style.display = isAdmin ? 'block' : 'none';
        // Card presença visual admin
        const cardPresAdmin = document.getElementById('card-presenca-admin');
        if (cardPresAdmin) cardPresAdmin.style.display = isAdmin ? 'block' : 'none';
        // Toggle VITRINE/GERENCIAR na aba loja — só admin
        const lojaToggle = document.getElementById('loja-admin-toggle');
        if (lojaToggle) lojaToggle.style.display = isAdmin ? 'flex' : 'none';
        // Professor vê o wrapper de perfil (alterar senha, dados)
        const wrapperPerfil = document.getElementById('wrapper-perfil-proprio');
        if (wrapperPerfil && isProf) wrapperPerfil.classList.remove('hidden');
    },
    renderTurmasCheckboxes() {
        const c = document.getElementById('grid-turmas-prof'); if(!c) return;
        const t = [...new Set(Object.values(academia.getGrade()).flat())].filter(i => !i.includes("Sem treinos")).sort();
        c.innerHTML = t.map(i => `<label style="display:block; font-size:0.65rem; color:#94a3b8; margin-bottom:5px; font-weight:600;"><input type="checkbox" class="check-turma" value="${i}"> ${i}</label>`).join('');
    },
    atualizarTurmasDinamicas() {
        const s = document.getElementById('select-turma-aluno'); if (!s) return;
        const t = academia.getGrade()[new Date().getDay()] || academia.getGrade()[String(new Date().getDay())] || ["Sem treinos hoje"];
        s.innerHTML = t.map(i => `<option value="${i}">${i}</option>`).join(''); academia.atualizarPresencaAntecipada();
    },
    atualizarFaixas() {
        // Se modalidade for Muay Thai puro, não precisa popular faixas JJ
        if ((academia._modalidadeAtual || 'jiujitsu') === 'muaythai') return;
        const n = document.getElementById('nascimento-aluno').value; if(!n) return;
        const i = new Date().getFullYear() - new Date(n).getFullYear();
        const faixaAtual = document.getElementById('select-faixa').value;
        document.getElementById('select-faixa').innerHTML = graduacao.getFaixas(i).map(f => `<option value="${f}">${f}</option>`).join('');
        if(faixaAtual && document.querySelector(`#select-faixa option[value="${faixaAtual}"]`)) { document.getElementById('select-faixa').value = faixaAtual; }
        this.atualizarGraus();
    },
    atualizarGraus() {
        const f = document.getElementById('select-faixa').value; const m = graduacao.getMaxGraus(f);
        let h = ""; for(let i=0; i<=m; i++) h += `<option value="${i}">${i}º G</option>`;
        document.getElementById('select-graus').innerHTML = h;
    },
    async renderPerfilAluno() {
        const card = document.getElementById('meu-status-card'); if (!card) return;
        if(auth.role === 'aluno' || auth.role === 'professor') {
            const doc = await db.collection("alunos").doc(auth.currentUser.id).get(); if(!doc.exists) return; const d = doc.data();
            const s = academia.verificarMeta(d); const eng = academia.calcularEngajamento(d.historico); const f = Math.max(s.meta - (d.aulas || 0), 0);
            const anoAtual = new Date().getFullYear();
            const idadeAtleta = d.nascimento ? (anoAtual - new Date(d.nascimento).getFullYear()) : 99;
            const cardLeoes = document.getElementById('card-leoes-kids');
            if (idadeAtleta <= 14) {
                cardLeoes.classList.remove('hidden');
                const histLeoes = d.historicoLeoes || [];
                const lAtencao = histLeoes.filter(i => i.campo === 'leaoAtencao' && i.faixa === d.faixa).length;
                const lComportamento = histLeoes.filter(i => i.campo === 'leaoComportamento' && i.faixa === d.faixa).length;
                const lConquistado = histLeoes.filter(i => i.campo === 'leaoCompanheirismo' && i.faixa === d.faixa).length;
                const lDisciplina = histLeoes.filter(i => i.campo === 'leaoDisciplina' && i.faixa === d.faixa).length;
                const bAtencao = document.getElementById('circle-leao-atencao');
                document.getElementById('count-view-atencao').innerText = lAtencao;
                if(bAtencao) bAtencao.className = `leao-icon-circle ${lAtencao > 0 ? 'bg-leao-verde' : 'leao-desativado'}`;
                const bComportamento = document.getElementById('circle-leao-comportamento');
                document.getElementById('count-view-comportamento').innerText = lComportamento;
                if(bComportamento) bComportamento.className = `leao-icon-circle ${lComportamento > 0 ? 'bg-leao-vermelho' : 'leao-desativado'}`;
                const bCompanheirismo = document.getElementById('circle-leao-companheirismo');
                document.getElementById('count-view-companheirismo').innerText = lConquistado;
                if(bCompanheirismo) bCompanheirismo.className = `leao-icon-circle ${lConquistado > 0 ? 'bg-leao-azul' : 'leao-desativado'}`;
                const bDisciplina = document.getElementById('circle-leao-disciplina');
                document.getElementById('count-view-disciplina').innerText = lDisciplina;
                if(bDisciplina) bDisciplina.className = `leao-icon-circle ${lDisciplina > 0 ? 'bg-leao-amarelo' : 'leao-desativado'}`;
                const htmlHistLeoes = histLeoes.map(item => `
                    <div style="font-size: 0.7rem; color: #cbd5e1; background: #0f172a; padding: 6px 8px; border-radius: 6px; margin-bottom: 4px; border-left: 2px solid ${item.faixa === d.faixa ? 'var(--accent-gold)' : '#4b5563'}; opacity: ${item.faixa === d.faixa ? '1' : '0.5'}">
                        <b>${item.data}</b> - ${item.mensagem} ${item.faixa !== d.faixa ? `<span style="font-size:0.55rem; color:var(--text-muted);">[Histórico Faixa Antiga]</span>` : ''}
                    </div>`).join('') || `<p style="color:var(--text-muted); font-size:0.7rem; text-align:center; margin:5px 0;">Nenhuma medalha conquistada.</p>`;
                document.getElementById('historico-leoes-aluno').innerHTML = `<small style="color:var(--accent-gold); font-weight:800; display:block; margin-bottom:5px; font-size:0.55rem; letter-spacing:0.3px;">LINHA DE TEMPO COLECIONÁVEL DE CONQUISTAS:</small>${htmlHistLeoes}`;
            } else {
                cardLeoes.classList.add('hidden');
            }
            const listaHistorico = d.historico || [];
            const htmlLinhaTempo = listaHistorico.map(t => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:10px 14px; border-radius:10px; margin-bottom:6px; border:1px solid var(--border-light);">
                    <div style="font-size:0.8rem; color:#e2e8f0; font-weight:600;"><i class="fas fa-check-circle" style="color:var(--accent-green); margin-right:6px;"></i> ${t.turma.toUpperCase()}</div>
                    <div style="font-size:0.65rem; color:var(--text-muted); font-weight:500;">${t.data.split(' ')[0]} às ${t.data.split(' ')[1] || ''}</div>
                </div>`).join('') || `<p style="color:var(--text-muted); text-align:center; font-size:0.75rem; padding:10px;">Nenhum treino registrado.</p>`;
            // ── Blocos condicionais por modalidade ────────────────
            const modPerfil = d.modalidade || 'jiujitsu';
            const corJJ = this.getCorFaixa(d.faixa);
            const corMT = this.getCorFaixaMT(d.faixaMT);

            // Bloco de faixa/graduação
            const beltHtml = modPerfil === 'muaythai'
                ? `<div style="font-weight:700; font-size:0.85rem; border-bottom:2px solid ${corMT}; display:inline-block; margin-bottom:15px; color:#e2e8f0; padding-bottom:3px;">🥊 ${(d.faixaMT || 'Branco').toUpperCase()} — MUAY THAI</div>`
                : modPerfil === 'ambos'
                ? `<div style="display:flex; flex-direction:column; gap:5px; margin-bottom:15px;">
                       <div style="font-weight:700; font-size:0.8rem; border-left:3px solid ${corJJ}; padding-left:8px; color:#e2e8f0;">🥋 ${d.faixa.toUpperCase()} • ${d.grau}º GRAU — JIU-JITSU</div>
                       <div style="font-weight:700; font-size:0.8rem; border-left:3px solid ${corMT}; padding-left:8px; color:#e2e8f0;">🥊 ${(d.faixaMT || 'Branco').toUpperCase()} — MUAY THAI</div>
                   </div>`
                : `<div style="font-weight:700; font-size:0.85rem; border-bottom:2px solid ${corJJ}; display:inline-block; margin-bottom:15px; color:#e2e8f0; padding-bottom:3px;">${d.faixa.toUpperCase()} • ${d.grau}º GRAU</div>`;

            // Bloco de estatísticas (contadores separados por modalidade)
            const statsHtml = modPerfil === 'muaythai'
                ? `<div style="display:flex; gap:10px; margin-bottom:15px;">
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border-light);"><small style="font-size:0.55rem; color:#f43f5e; display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">🥊 AULAS MUAY THAI</small><span style="font-size:1.1rem; font-weight:800; color:white;">${d.aulasMT || 0}</span></div>
                       <div style="flex:1; background:#4c0519; padding:12px; border-radius:10px; text-align:center; border:1px solid #f43f5e44;"><small style="font-size:0.55rem; color:#f43f5e; display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:4px;">MODALIDADE</small><span style="font-size:0.7rem; font-weight:800; color:#f43f5e;">MUAY THAI</span></div>
                   </div>`
                : modPerfil === 'ambos'
                ? `<div style="display:flex; gap:10px; margin-bottom:8px;">
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid #3b82f644;"><small style="font-size:0.55rem; color:#60a5fa; display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">🥋 AULAS JIU-JITSU</small><span style="font-size:1.1rem; font-weight:800; color:white;">${d.aulas || 0}</span></div>
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid #f43f5e44;"><small style="font-size:0.55rem; color:#f43f5e; display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">🥊 AULAS MUAY THAI</small><span style="font-size:1.1rem; font-weight:800; color:white;">${d.aulasMT || 0}</span></div>
                   </div>
                   <div style="display:flex; gap:10px; margin-bottom:15px;">
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border-light);"><small style="font-size:0.55rem; color:var(--text-muted); display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">FALTAM P/ META JJ</small><span style="font-size:1.1rem; font-weight:800; color:var(--accent-gold);">${f}</span></div>
                   </div>`
                : `<div style="display:flex; gap:10px; margin-bottom:15px;">
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border-light);"><small style="font-size:0.55rem; color:var(--text-muted); display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">AULAS COMPUTADAS</small><span style="font-size:1.1rem; font-weight:800; color:white;">${d.aulas || 0}</span></div>
                       <div style="flex:1; background:#0f172a; padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border-light);"><small style="font-size:0.55rem; color:var(--text-muted); display:block; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">FALTAM P/ META</small><span style="font-size:1.1rem; font-weight:800; color:var(--accent-gold);">${f}</span></div>
                   </div>`;

            // Barra de progresso (só JJ/ambos)
            const progressHtml = modPerfil !== 'muaythai'
                ? `<div style="background:#16161a; height:6px; border-radius:3px; overflow:hidden; margin-bottom:15px;"><div style="width:${s.percent}%; background:var(--accent-blue); height:100%;"></div></div>`
                : '';

            // Banner de convocação para exame de faixa
            const bannerConvocado = d.aspiranteGraduacao === true
                ? `<div style="background:linear-gradient(135deg,#052e16,#064e3b); border:2px solid #10b981; border-radius:14px; padding:16px 14px; margin-bottom:14px; text-align:center;">
                       <div style="font-size:1.6rem; margin-bottom:4px;">🥋✅</div>
                       <div style="color:#10b981; font-size:0.95rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;">Você foi convocado!</div>
                       <div style="color:#a7f3d0; font-size:0.75rem; margin-top:6px; line-height:1.5;">Você está apto para o exame de faixa.<br>Entre em contato com a academia. <strong>OSS! 🙏</strong></div>
                   </div>`
                : '';

            card.innerHTML = `
                <div class="curriculo-atleta" style="background: var(--bg-card); padding: 18px; border-radius: 16px; border: 1px solid var(--border-light);">
                    ${bannerConvocado}
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h2 style="color:var(--accent-blue); margin:0; font-size: 0.95rem; font-weight:800; letter-spacing:-0.3px;">${d.nome.toUpperCase()}</h2>
                        <span style="background:${eng.color}; font-size: 0.55rem; padding: 4px 10px; border-radius: 20px; font-weight: 700; color:white;">${eng.icon} ${eng.label.toUpperCase()}</span>
                    </div>
                    ${beltHtml}
                    ${statsHtml}
                    ${progressHtml}
                    <button onclick="academia.toggleHistoricoTreinos()" class="btn-clean" style="margin-top:0; color:#60a5fa; text-align:center; display:block; width:100%; font-size:0.75rem; font-weight:700;"><i class="fas fa-history"></i> VER MEU HISTÓRICO DE TREINOS</button>
                    <div id="secao-historico-treinos-aluno" class="hidden" style="margin-top:15px; padding-top:12px; border-top:1px solid var(--border-light); max-height:200px; overflow-y:auto; padding-right:4px;">${htmlLinhaTempo}</div>
                </div>`;
            // Mostra wrapper de perfil (só para aluno)
            if (auth.role === 'aluno') {
                const wp = document.getElementById('wrapper-perfil-proprio');
                if (wp) wp.classList.remove('hidden');
            }
        }
    }
};

// ══════════════════════════════════════════════════════════
// LOJA VIRTUAL — Vitrine, Pedidos, Gestão Admin
// ══════════════════════════════════════════════════════════
const loja = {
    _produtos: [],
    _categoriaAtual: 'todas',
    _produtoAtual: null,
    _variacaoAtual: null,
    _variacoesTemp: [],
    _abaAdminAtual: 'prods',

    // ── VITRINE (alunos) ─────────────────────────────────
    async renderVitrine() {
        const grid = document.getElementById('loja-grid');
        const filtrosEl = document.getElementById('loja-filtros');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#475569; font-size:0.75rem;">Carregando...</div>';
        try {
            const snap = await db.collection('loja_produtos').where('ativo', '==', true).get();
            this._produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.destaque ? 1 : 0) - (a.destaque ? 1 : 0) || (a.ordem || 0) - (b.ordem || 0));

            const cats = ['todas', ...new Set(this._produtos.map(p => p.categoria).filter(Boolean))];
            if (filtrosEl) {
                filtrosEl.innerHTML = cats.map(cat => `
                    <button onclick="loja._filtrar('${cat}')" id="loja-filtro-${cat.replace(/\s/g,'_')}"
                        style="background:${cat === this._categoriaAtual ? '#3b82f6' : '#1e293b'};
                               border:1px solid ${cat === this._categoriaAtual ? '#3b82f6' : '#334155'};
                               color:${cat === this._categoriaAtual ? 'white' : '#94a3b8'};
                               padding:6px 14px; border-radius:20px; font-size:0.62rem; font-weight:700;
                               cursor:pointer; white-space:nowrap; flex-shrink:0;">
                        ${cat === 'todas' ? '🛒 TODOS' : cat.toUpperCase()}
                    </button>`).join('');
            }
            this._renderGrid();

            // Mostra botão meus pedidos para alunos
            const btnP = document.getElementById('btn-ver-meus-pedidos');
            if (btnP && auth.role === 'aluno') { btnP.style.display = 'block'; this._carregarBadgePedidos(); }
        } catch(e) {
            grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:30px; color:#ef4444; font-size:0.72rem;">Erro ao carregar loja: ${e.message}</div>`;
        }
    },

    _filtrar(cat) {
        this._categoriaAtual = cat;
        document.querySelectorAll('[id^="loja-filtro-"]').forEach(btn => {
            const active = btn.id === 'loja-filtro-' + cat.replace(/\s/g,'_');
            btn.style.background = active ? '#3b82f6' : '#1e293b';
            btn.style.borderColor = active ? '#3b82f6' : '#334155';
            btn.style.color = active ? 'white' : '#94a3b8';
        });
        this._renderGrid();
    },

    _renderGrid() {
        const grid = document.getElementById('loja-grid');
        if (!grid) return;
        const prods = this._categoriaAtual === 'todas'
            ? this._produtos
            : this._produtos.filter(p => p.categoria === this._categoriaAtual);
        if (prods.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#475569; font-size:0.75rem;">Nenhum produto encontrado.</div>';
            return;
        }
        grid.innerHTML = prods.map(p => {
            const totalEstoque = (p.variacoes || []).reduce((s, v) => s + (v.estoque || 0), 0);
            const esgotado = (p.variacoes || []).length > 0 && totalEstoque === 0;
            return `
                <div onclick="loja.abrirProduto('${p.id}')" style="background:#1e293b; border:1px solid ${p.destaque ? '#f59e0b55' : '#334155'}; border-radius:12px; overflow:hidden; cursor:pointer; position:relative; ${esgotado ? 'opacity:0.65;' : ''}">
                    ${p.destaque ? '<div style="position:absolute; top:6px; left:6px; z-index:2; background:#f59e0b; color:#000; border-radius:6px; padding:2px 7px; font-size:0.48rem; font-weight:800; letter-spacing:0.5px;">⭐ DESTAQUE</div>' : ''}
                    ${esgotado ? '<div style="position:absolute; top:6px; right:6px; z-index:2; background:#ef4444; color:white; border-radius:6px; padding:2px 7px; font-size:0.48rem; font-weight:800;">ESGOTADO</div>' : ''}
                    <div style="aspect-ratio:1; background:#0f172a; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                        ${p.foto ? `<img src="${p.foto}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:3rem>🛒</span>'">` : '<span style="font-size:3rem;">🛒</span>'}
                    </div>
                    <div style="padding:10px;">
                        <div style="font-size:0.55rem; color:#64748b; font-weight:700; margin-bottom:3px;">${(p.categoria || 'produto').toUpperCase()}</div>
                        <div style="font-size:0.78rem; font-weight:800; color:white; margin-bottom:6px; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${p.nome}</div>
                        <div style="font-size:0.88rem; font-weight:800; color:#10b981;">R$ ${(p.preco || 0).toFixed(2).replace('.', ',')}</div>
                    </div>
                </div>`;
        }).join('');
    },

    // ── DETALHE DO PRODUTO ───────────────────────────────
    abrirProduto(id) {
        const p = this._produtos.find(x => x.id === id);
        if (!p) return;
        const anterior = document.getElementById('modal-produto-detalhe');
        if (anterior) anterior.remove();

        this._produtoAtual = p;
        const variacoes = p.variacoes || [];
        const temVar = variacoes.length > 0;
        const primeiraDisp = temVar ? Math.max(0, variacoes.findIndex(v => (v.estoque || 0) > 0)) : -1;
        this._variacaoAtual = temVar ? variacoes[primeiraDisp >= 0 ? primeiraDisp : 0] : null;

        const btnComprarOk = !temVar || (this._variacaoAtual && (this._variacaoAtual.estoque || 0) > 0);

        const modal = document.createElement('div');
        modal.id = 'modal-produto-detalhe';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(2,6,23,0.98); z-index:10001; overflow-y:auto; padding:20px; box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:440px; margin:0 auto; padding-bottom:80px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <button onclick="loja.fecharProduto()" style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:8px 14px; border-radius:8px; font-size:0.7rem; font-weight:700; cursor:pointer;">← VOLTAR</button>
                    ${auth.role === 'admin' ? `<button onclick="loja.fecharProduto(); loja.abrirModalProduto('${id}')" style="background:#1e3a8a; border:1px solid #3b82f655; color:#93c5fd; padding:8px 14px; border-radius:8px; font-size:0.62rem; font-weight:700; cursor:pointer;">✏️ EDITAR</button>` : ''}
                </div>
                <div style="width:100%; aspect-ratio:1.2; background:#1e293b; border-radius:14px; overflow:hidden; margin-bottom:16px; display:flex; align-items:center; justify-content:center;">
                    ${p.foto ? `<img src="${p.foto}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:4rem>🛒</span>'">` : '<span style="font-size:4rem;">🛒</span>'}
                </div>
                <div style="font-size:0.6rem; color:#64748b; font-weight:700; letter-spacing:0.5px; margin-bottom:4px;">${(p.categoria || 'produto').toUpperCase()}</div>
                <div style="font-size:1.1rem; font-weight:800; color:white; margin-bottom:8px;">${p.nome}</div>
                <div style="font-size:1.3rem; font-weight:800; color:#10b981; margin-bottom:${p.descricao ? '12px' : '16px'};">R$ ${(p.preco || 0).toFixed(2).replace('.', ',')}</div>
                ${p.descricao ? `<div style="font-size:0.75rem; color:#94a3b8; line-height:1.6; margin-bottom:16px; background:#0f172a; border-radius:10px; padding:12px;">${p.descricao}</div>` : ''}
                ${temVar ? `
                <div style="margin-bottom:16px;">
                    <div style="font-size:0.65rem; color:#94a3b8; font-weight:700; margin-bottom:8px;">TAMANHO / VARIAÇÃO:</div>
                    <div id="variacao-selector" style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${variacoes.map((v, i) => {
                            const sem = (v.estoque || 0) === 0;
                            const sel = i === (primeiraDisp >= 0 ? primeiraDisp : 0);
                            return `<button onclick="loja._selecionarVariacao(${i})" id="var-btn-${i}"
                                style="background:${sel && !sem ? '#1e3a8a' : '#1e293b'};
                                       border:${sel && !sem ? '1px solid #3b82f6' : '1px solid #334155'};
                                       color:${sem ? '#475569' : sel ? '#93c5fd' : '#94a3b8'};
                                       padding:8px 14px; border-radius:8px; font-size:0.72rem; font-weight:800;
                                       cursor:${sem ? 'not-allowed' : 'pointer'};
                                       text-decoration:${sem ? 'line-through' : 'none'};
                                       opacity:${sem ? '0.5' : '1'};">
                                ${v.nome}
                            </button>`;
                        }).join('')}
                    </div>
                    <div id="variacao-info" style="font-size:0.6rem; color:#64748b; margin-top:8px;">
                        ${this._variacaoAtual ? `Estoque: <strong style="color:${(this._variacaoAtual.estoque||0)>0?'#10b981':'#ef4444'}">${this._variacaoAtual.estoque||0} unid.</strong>` : ''}
                    </div>
                </div>` : ''}
                <button id="btn-fazer-pedido" onclick="loja._confirmarPedido('${id}')"
                    style="width:100%; padding:16px; background:${btnComprarOk ? '#10b981' : '#334155'}; color:white; border:none; border-radius:12px; font-weight:800; font-size:0.9rem; cursor:pointer; margin-top:8px;"
                    ${!btnComprarOk ? 'disabled' : ''}>
                    ${btnComprarOk ? '🛒 FAZER PEDIDO' : '❌ ESGOTADO'}
                </button>
                <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; margin-top:10px; font-size:0.62rem; color:#64748b; text-align:center; line-height:1.6;">
                    📍 Retirada na academia · Pagamento via link externo
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    _selecionarVariacao(index) {
        const p = this._produtoAtual;
        if (!p) return;
        const v = (p.variacoes || [])[index];
        if (!v) return;
        this._variacaoAtual = v;
        (p.variacoes || []).forEach((vx, i) => {
            const btn = document.getElementById('var-btn-' + i);
            if (!btn) return;
            const sem = (vx.estoque || 0) === 0;
            btn.style.background = i === index && !sem ? '#1e3a8a' : '#1e293b';
            btn.style.borderColor = i === index && !sem ? '#3b82f6' : '#334155';
            btn.style.color = sem ? '#475569' : i === index ? '#93c5fd' : '#94a3b8';
        });
        const info = document.getElementById('variacao-info');
        if (info) info.innerHTML = `Estoque: <strong style="color:${(v.estoque||0)>0?'#10b981':'#ef4444'}">${v.estoque||0} unid.</strong>`;
        const btn = document.getElementById('btn-fazer-pedido');
        if (btn) {
            const sem = (v.estoque || 0) === 0;
            btn.disabled = sem;
            btn.style.background = sem ? '#334155' : '#10b981';
            btn.innerHTML = sem ? '❌ ESGOTADO' : '🛒 FAZER PEDIDO';
        }
    },

    fecharProduto() {
        document.getElementById('modal-produto-detalhe')?.remove();
        this._produtoAtual = null; this._variacaoAtual = null;
    },

    async _confirmarPedido(produtoId) {
        const p = this._produtoAtual;
        if (!p) return;
        if (auth.role !== 'aluno') { alert('Apenas alunos podem fazer pedidos.'); return; }
        const btn = document.getElementById('btn-fazer-pedido');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Processando...'; }
        try {
            const ref = await db.collection('loja_pedidos').add({
                alunoId: auth.currentUser.id, alunoNome: auth.currentUser.nome,
                produtoId, produtoNome: p.nome,
                variacao: this._variacaoAtual ? this._variacaoAtual.nome : null,
                preco: p.preco, linkPagamento: p.linkPagamento || null,
                status: 'pendente', data: new Date().getTime()
            });
            this.fecharProduto();
            this._mostrarModalPagamento(p, this._variacaoAtual, ref.id);
        } catch(e) {
            if (btn) { btn.disabled = false; btn.innerHTML = '🛒 FAZER PEDIDO'; }
            alert('Erro ao registrar pedido: ' + e.message);
        }
    },

    _mostrarModalPagamento(p, variacao, pedidoId) {
        document.getElementById('modal-pagamento-loja')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-pagamento-loja';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(2,6,23,0.98); z-index:10002; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b; border:1px solid #10b98155; border-radius:16px; padding:24px; max-width:380px; width:100%; text-align:center;">
                <div style="font-size:2.5rem; margin-bottom:8px;">✅</div>
                <div style="font-size:0.95rem; font-weight:800; color:#10b981; margin-bottom:4px;">PEDIDO REGISTRADO!</div>
                <div style="font-size:0.65rem; color:#64748b; margin-bottom:18px;">Protocolo #${pedidoId.slice(-6).toUpperCase()}</div>
                <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; margin-bottom:16px; text-align:left;">
                    <div style="font-size:0.62rem; color:#64748b; font-weight:700; margin-bottom:4px;">PRODUTO</div>
                    <div style="font-size:0.82rem; font-weight:800; color:white;">${p.nome}</div>
                    ${variacao ? `<div style="font-size:0.62rem; color:#94a3b8; margin-top:3px;">Tamanho: <strong>${variacao.nome}</strong></div>` : ''}
                    <div style="font-size:0.9rem; font-weight:800; color:#10b981; margin-top:8px;">R$ ${(p.preco||0).toFixed(2).replace('.', ',')}</div>
                </div>
                ${p.linkPagamento ? `
                <a href="${p.linkPagamento}" target="_blank" rel="noopener"
                    style="display:block; width:100%; padding:14px; background:#10b981; color:white; border-radius:12px; font-weight:800; font-size:0.85rem; text-decoration:none; margin-bottom:8px; box-sizing:border-box;">
                    💳 IR PARA O PAGAMENTO
                </a>
                <div style="font-size:0.58rem; color:#64748b; margin-bottom:14px;">Você será redirecionado para a página de pagamento</div>
                ` : `
                <div style="background:#1e3a8a22; border:1px solid #3b82f633; border-radius:10px; padding:12px; margin-bottom:14px;">
                    <div style="font-size:0.65rem; color:#93c5fd; font-weight:700; margin-bottom:4px;">💬 PRÓXIMO PASSO</div>
                    <div style="font-size:0.7rem; color:#94a3b8; line-height:1.5;">Combine o pagamento diretamente com a academia. Seu pedido está registrado!</div>
                </div>`}
                <div style="font-size:0.6rem; color:#475569; margin-bottom:16px;">📍 Retirada na academia após confirmação do pagamento</div>
                <button onclick="document.getElementById('modal-pagamento-loja').remove()" style="background:#334155; border:none; color:white; padding:10px 24px; border-radius:8px; font-size:0.7rem; font-weight:700; cursor:pointer;">FECHAR</button>
            </div>`;
        document.body.appendChild(modal);
    },

    // ── MEUS PEDIDOS (aluno) ─────────────────────────────
    async verMeusPedidos() {
        const card = document.getElementById('loja-meus-pedidos');
        const lista = document.getElementById('loja-lista-meus-pedidos');
        if (!card || !lista) return;
        if (card.style.display !== 'none') { card.style.display = 'none'; return; }
        card.style.display = 'block';
        lista.innerHTML = '<small style="color:#475569; font-size:0.65rem;">Carregando...</small>';
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
            const snap = await db.collection('loja_pedidos')
                .where('alunoId', '==', auth.currentUser.id).get();
            if (snap.empty) {
                lista.innerHTML = '<small style="color:#475569; font-size:0.65rem;">Você ainda não fez nenhum pedido.</small>';
                return;
            }
            // Ordena client-side (evita índice composto no Firestore)
            snap.docs.sort((a, b) => (b.data().data || 0) - (a.data().data || 0));
            const statusCor   = { pendente:'#f59e0b', pago:'#3b82f6', entregue:'#10b981', cancelado:'#ef4444' };
            const statusLabel = { pendente:'⏳ Pendente', pago:'💳 Pago', entregue:'✅ Entregue', cancelado:'❌ Cancelado' };
            lista.innerHTML = snap.docs.map(d => {
                const o = d.data(); const cor = statusCor[o.status]||'#64748b';
                return `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <div style="flex:1; margin-right:8px;">
                                <div style="font-size:0.75rem; font-weight:800; color:white; margin-bottom:2px;">${o.produtoNome}</div>
                                ${o.variacao ? `<div style="font-size:0.6rem; color:#64748b;">Tamanho: ${o.variacao}</div>` : ''}
                                <div style="font-size:0.58rem; color:#64748b; margin-top:3px;">${new Date(o.data).toLocaleDateString('pt-BR')} · #${d.id.slice(-6).toUpperCase()}</div>
                            </div>
                            <div style="text-align:right; flex-shrink:0;">
                                <div style="font-size:0.8rem; font-weight:800; color:#10b981;">R$ ${(o.preco||0).toFixed(2).replace('.', ',')}</div>
                                <div style="font-size:0.55rem; font-weight:800; color:${cor}; margin-top:4px;">${statusLabel[o.status]||o.status}</div>
                            </div>
                        </div>
                        ${o.linkPagamento && o.status === 'pendente' ? `
                        <a href="${o.linkPagamento}" target="_blank" rel="noopener"
                            style="display:block; text-align:center; padding:8px; background:#10b98122; border:1px solid #10b98144; color:#10b981; border-radius:8px; font-size:0.62rem; font-weight:800; text-decoration:none; margin-top:8px;">
                            💳 IR PARA O PAGAMENTO
                        </a>` : ''}
                    </div>`;
            }).join('');
        } catch(e) {
            lista.innerHTML = `<small style="color:#ef4444; font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    async _carregarBadgePedidos() {
        if (auth.role !== 'aluno') return;
        try {
            const snap = await db.collection('loja_pedidos')
                .where('alunoId', '==', auth.currentUser.id).get();
            // Filtra client-side (evita índice composto)
            const pendentes = snap.docs.filter(d => d.data().status === 'pendente').length;
            const badge = document.getElementById('badge-meus-pedidos');
            if (badge && pendentes > 0) { badge.textContent = pendentes; badge.style.display = 'block'; }
        } catch(e) {}
    },

    // ── ADMIN — MODO VITRINE / GERENCIAR ────────────────
    _modoAdmin: 'vitrine',

    mudarModoAdmin(modo) {
        this._modoAdmin = modo;
        const vitrine   = document.getElementById('loja-painel-vitrine');
        const gerenciar = document.getElementById('loja-painel-gerenciar');
        const btnV      = document.getElementById('loja-toggle-vitrine');
        const btnG      = document.getElementById('loja-toggle-gerenciar');

        if (modo === 'vitrine') {
            if (vitrine)   vitrine.style.display = 'block';
            if (gerenciar) gerenciar.style.display = 'none';
            if (btnV) { btnV.style.background = '#3b82f6'; btnV.style.color = 'white'; }
            if (btnG) { btnG.style.background = 'transparent'; btnG.style.color = '#64748b'; }
        } else {
            if (vitrine)   vitrine.style.display = 'none';
            if (gerenciar) gerenciar.style.display = 'block';
            if (btnV) { btnV.style.background = 'transparent'; btnV.style.color = '#64748b'; }
            if (btnG) { btnG.style.background = '#10b981'; btnG.style.color = 'white'; }
            this.mostrarTabAdmin(this._abaAdminAtual || 'prods');
        }
    },

    _refreshAdmin() {
        if (this._abaAdminAtual === 'pedidos') this.renderPedidosAdmin();
        else this.renderAdminLoja();
    },

    // ── ADMIN — GESTÃO ───────────────────────────────────
    mostrarTabAdmin(aba) {
        this._abaAdminAtual = aba;
        const elProds   = document.getElementById('loja-admin-prods');
        const elPedidos = document.getElementById('loja-admin-pedidos');
        const btnP      = document.getElementById('loja-tab-btn-prods');
        const btnO      = document.getElementById('loja-tab-btn-pedidos');
        const ativo   = 'background:#10b981; border:none; color:white;';
        const inativo = 'background:#1e293b; border:1px solid #334155; color:#94a3b8;';
        if (aba === 'prods') {
            if (elProds)   elProds.style.display = 'block';
            if (elPedidos) elPedidos.style.display = 'none';
            if (btnP) btnP.style.cssText = ativo + 'flex:1; padding:7px; border-radius:7px; font-size:0.62rem; font-weight:800; cursor:pointer;';
            if (btnO) btnO.style.cssText = inativo + 'flex:1; padding:7px; border-radius:7px; font-size:0.62rem; font-weight:800; cursor:pointer; position:relative;';
            this.renderAdminLoja();
        } else {
            if (elProds)   elProds.style.display = 'none';
            if (elPedidos) elPedidos.style.display = 'block';
            if (btnP) btnP.style.cssText = inativo + 'flex:1; padding:7px; border-radius:7px; font-size:0.62rem; font-weight:800; cursor:pointer;';
            if (btnO) btnO.style.cssText = ativo + 'flex:1; padding:7px; border-radius:7px; font-size:0.62rem; font-weight:800; cursor:pointer; position:relative;';
            this.renderPedidosAdmin();
        }
    },

    async renderAdminLoja() {
        const container = document.getElementById('loja-admin-prods');
        if (!container) return;
        container.innerHTML = '<small style="color:#475569; font-size:0.65rem;">Carregando...</small>';
        try {
            const snap = await db.collection('loja_produtos').get();
            const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.destaque ? 1 : 0) - (a.destaque ? 1 : 0) || (a.ordem || 0) - (b.ordem || 0));
            if (prods.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:20px; color:#475569; font-size:0.7rem;">Nenhum produto cadastrado.<br><br>Clique em <strong>+ PRODUTO</strong> para adicionar.</div>';
                return;
            }
            container.innerHTML = prods.map(p => {
                const totalEst = (p.variacoes || []).reduce((s, v) => s + (v.estoque || 0), 0);
                return `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; margin-bottom:8px; display:flex; gap:10px; align-items:center;">
                        <div style="width:48px; height:48px; background:#1e293b; border-radius:8px; overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.3rem;">
                            ${p.foto ? `<img src="${p.foto}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='🛒'">` : '🛒'}
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.75rem; font-weight:800; color:${p.ativo ? 'white' : '#475569'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.nome}</div>
                            <div style="font-size:0.65rem; color:#10b981; font-weight:700;">R$ ${(p.preco||0).toFixed(2).replace('.', ',')}</div>
                            <div style="font-size:0.55rem; color:#64748b; margin-top:2px;">
                                ${(p.variacoes||[]).length} variações · estoque: ${totalEst}
                                ${totalEst === 0 && (p.variacoes||[]).length > 0 ? '<span style="color:#ef4444; font-weight:700;"> ⚠️ ESGOTADO</span>' : ''}
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
                            <button onclick="loja.toggleAtivoProduto('${p.id}', ${p.ativo})"
                                style="background:${p.ativo ? '#10b98122' : '#33415522'}; border:1px solid ${p.ativo ? '#10b981' : '#475569'}; color:${p.ativo ? '#10b981' : '#64748b'}; padding:4px 8px; border-radius:6px; font-size:0.55rem; font-weight:800; cursor:pointer;">
                                ${p.ativo ? '✓ ATIVO' : '— INATIVO'}
                            </button>
                            <button onclick="loja.abrirModalProduto('${p.id}')"
                                style="background:#1e3a8a; border:1px solid #3b82f655; color:#93c5fd; padding:4px 8px; border-radius:6px; font-size:0.55rem; font-weight:700; cursor:pointer;">
                                ✏️ EDITAR
                            </button>
                        </div>
                    </div>`;
            }).join('');
        } catch(e) {
            container.innerHTML = `<small style="color:#ef4444; font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    async renderPedidosAdmin() {
        const container = document.getElementById('loja-admin-pedidos');
        if (!container) return;
        container.innerHTML = '<small style="color:#475569; font-size:0.65rem;">Carregando...</small>';
        try {
            const snap = await db.collection('loja_pedidos').get();
            if (snap.empty) {
                container.innerHTML = '<div style="text-align:center; padding:20px; color:#475569; font-size:0.7rem;">Nenhum pedido ainda.</div>';
                return;
            }
            // Ordena client-side (evita necessidade de índice)
            snap.docs.sort((a, b) => (b.data().data || 0) - (a.data().data || 0));
            const pendentes = snap.docs.filter(d => d.data().status === 'pendente').length;
            const badge = document.getElementById('badge-pedidos-loja');
            if (badge) { badge.textContent = pendentes; badge.style.display = pendentes > 0 ? 'block' : 'none'; }

            const statusCor   = { pendente:'#f59e0b', pago:'#3b82f6', entregue:'#10b981', cancelado:'#ef4444' };
            const statusLabel = { pendente:'⏳ Pendente', pago:'💳 Pago', entregue:'✅ Entregue', cancelado:'❌ Cancelado' };
            container.innerHTML = snap.docs.map(d => {
                const o = { id: d.id, ...d.data() };
                const cor = statusCor[o.status] || '#64748b';
                return `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                            <div>
                                <div style="font-size:0.75rem; font-weight:800; color:white;">${o.alunoNome}</div>
                                <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">${o.produtoNome}${o.variacao ? ' · ' + o.variacao : ''}</div>
                                <div style="font-size:0.55rem; color:#64748b; margin-top:2px;">${new Date(o.data).toLocaleDateString('pt-BR')} · #${o.id.slice(-6).toUpperCase()}</div>
                            </div>
                            <div style="text-align:right; flex-shrink:0;">
                                <div style="font-size:0.8rem; font-weight:800; color:#10b981;">R$ ${(o.preco||0).toFixed(2).replace('.', ',')}</div>
                                <div style="font-size:0.55rem; font-weight:800; color:${cor}; margin-top:4px;">${statusLabel[o.status]||o.status}</div>
                            </div>
                        </div>
                        ${o.status !== 'entregue' && o.status !== 'cancelado' ? `
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${o.status === 'pendente' ? `<button onclick="loja.atualizarStatusPedido('${o.id}','pago','${o.produtoId}','${o.variacao||''}')" style="background:#3b82f622; border:1px solid #3b82f6; color:#93c5fd; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">✓ MARCAR PAGO</button>` : ''}
                            ${o.status === 'pago' ? `<button onclick="loja.atualizarStatusPedido('${o.id}','entregue','${o.produtoId}','${o.variacao||''}')" style="background:#10b98122; border:1px solid #10b981; color:#10b981; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">📦 ENTREGAR</button>` : ''}
                            <button onclick="loja.atualizarStatusPedido('${o.id}','cancelado','${o.produtoId}','${o.variacao||''}')" style="background:#ef444422; border:1px solid #ef4444; color:#ef4444; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">✕ CANCELAR</button>
                        </div>` : ''}
                    </div>`;
            }).join('');
        } catch(e) {
            container.innerHTML = `<small style="color:#ef4444; font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    async atualizarStatusPedido(pedidoId, novoStatus, produtoId, variacaoNome) {
        try {
            await db.collection('loja_pedidos').doc(pedidoId).update({ status: novoStatus });
            // Decrementa estoque ao marcar como PAGO
            if (novoStatus === 'pago' && produtoId && variacaoNome) {
                try {
                    const pd = await db.collection('loja_produtos').doc(produtoId).get();
                    if (pd.exists) {
                        const vars = pd.data().variacoes || [];
                        const idx = vars.findIndex(v => v.nome === variacaoNome);
                        if (idx >= 0) {
                            vars[idx].estoque = Math.max(0, (vars[idx].estoque || 0) - 1);
                            await db.collection('loja_produtos').doc(produtoId).update({ variacoes: vars });
                        }
                    }
                } catch(_) {}
            }
            this.renderPedidosAdmin();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async toggleAtivoProduto(id, ativo) {
        try {
            await db.collection('loja_produtos').doc(id).update({ ativo: !ativo });
            this.renderAdminLoja();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── MODAL ADD/EDIT PRODUTO (admin) ───────────────────
    abrirModalProduto(id) {
        document.getElementById('modal-editar-produto')?.remove();
        const p = id ? (this._produtos.find(x => x.id === id) || null) : null;
        this._variacoesTemp = p ? JSON.parse(JSON.stringify(p.variacoes || [])) : [];

        const categorias = ['kimono', 'rashguard', 'camisa', 'boné', 'bandagem', 'protetor', 'luva', 'acessório', 'outro'];
        const modal = document.createElement('div');
        modal.id = 'modal-editar-produto';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(2,6,23,0.98); z-index:10003; overflow-y:auto; padding:20px; box-sizing:border-box;';

        const inp = (lbl, id2, val, type='text', ph='') =>
            `<div><small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">${lbl}</small>
             <input id="${id2}" type="${type}" value="${val||''}" placeholder="${ph}"
                style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.8rem;box-sizing:border-box;"></div>`;

        modal.innerHTML = `
            <div style="max-width:440px; margin:0 auto; padding-bottom:80px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <div style="font-size:0.9rem; font-weight:800; color:white;">${id ? '✏️ EDITAR PRODUTO' : '➕ NOVO PRODUTO'}</div>
                    <div style="display:flex; gap:8px;">
                        ${id ? `<button onclick="loja.excluirProduto('${id}')" style="background:#ef444422; border:1px solid #ef4444; color:#ef4444; padding:8px 12px; border-radius:8px; font-size:0.62rem; font-weight:700; cursor:pointer;">🗑 EXCLUIR</button>` : ''}
                        <button onclick="document.getElementById('modal-editar-produto').remove()" style="background:#334155; border:none; color:white; padding:8px 14px; border-radius:8px; font-size:0.7rem; font-weight:700; cursor:pointer;">✕</button>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    ${inp('NOME DO PRODUTO *', 'prod-nome', p?.nome, 'text', 'Ex: Kimono Gaditas')}
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        ${inp('PREÇO (R$) *', 'prod-preco', p?.preco, 'number', '0,00')}
                        <div>
                            <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">CATEGORIA</small>
                            <select id="prod-categoria" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.78rem;box-sizing:border-box;">
                                ${categorias.map(c => `<option value="${c}" ${p?.categoria===c?'selected':''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div>
                        <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">DESCRIÇÃO</small>
                        <textarea id="prod-descricao" rows="3" placeholder="Descreva o produto..." style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.78rem;resize:vertical;box-sizing:border-box;">${p?.descricao||''}</textarea>
                    </div>
                    <!-- Foto com upload de arquivo -->
                    <div>
                        <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:6px;">FOTO DO PRODUTO</small>
                        <div style="display:flex;gap:10px;align-items:flex-start;">
                            <div id="prod-foto-preview" style="width:64px;height:64px;background:#0f172a;border:1px solid #334155;border-radius:10px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.8rem;">
                                ${p?.foto ? `<img src="${p.foto}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='🛒'">` : '🛒'}
                            </div>
                            <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
                                <button type="button" onclick="document.getElementById('prod-foto-file').click()"
                                    style="width:100%;padding:9px;background:#1e3a8a;border:1px solid #3b82f655;color:#93c5fd;border-radius:8px;font-size:0.68rem;font-weight:800;cursor:pointer;">
                                    📁 BUSCAR ARQUIVO
                                </button>
                                <input type="file" id="prod-foto-file" accept="image/*" onchange="loja._uploadFoto(this.files[0])" style="display:none;">
                                <input id="prod-foto" type="url" value="${p?.foto||''}" placeholder="ou cole a URL: https://..."
                                    oninput="loja._atualizarPreviewFoto(this.value)"
                                    style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.72rem;box-sizing:border-box;">
                            </div>
                        </div>
                        <div id="prod-foto-status" style="font-size:0.58rem;color:#64748b;margin-top:5px;min-height:14px;"></div>
                    </div>
                    <div>
                        ${inp('LINK DE PAGAMENTO', 'prod-link', p?.linkPagamento, 'url', 'https://infinitypay.io/... ou mercadolivre.com.br/...')}
                        <small style="font-size:0.55rem;color:#475569;margin-top:3px;display:block;">Cole o link do InfinityPay, Mercado Livre, etc.</small>
                    </div>
                    <!-- Variações -->
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <small style="font-size:0.6rem;color:#64748b;font-weight:700;">TAMANHOS / VARIAÇÕES (+ ESTOQUE)</small>
                            <button onclick="loja._adicionarVariacaoTemp()" style="background:#1e3a8a;border:1px solid #3b82f655;color:#93c5fd;padding:5px 10px;border-radius:6px;font-size:0.6rem;font-weight:700;cursor:pointer;">+ ADICIONAR</button>
                        </div>
                        <div id="lista-variacoes-temp"></div>
                        <small style="font-size:0.55rem;color:#475569;display:block;margin-top:4px;">Deixe vazio se o produto tem tamanho único ou sem variações.</small>
                    </div>
                    <!-- Opções -->
                    <div style="display:flex; gap:20px; padding:10px 0;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="prod-ativo" ${p?.ativo!==false?'checked':''} style="accent-color:#10b981;width:16px;height:16px;">
                            <span style="font-size:0.7rem;color:#94a3b8;font-weight:700;">ATIVO</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="prod-destaque" ${p?.destaque?'checked':''} style="accent-color:#f59e0b;width:16px;height:16px;">
                            <span style="font-size:0.7rem;color:#94a3b8;font-weight:700;">⭐ DESTAQUE</span>
                        </label>
                    </div>
                    <button onclick="loja.salvarProduto('${id||''}')" id="btn-salvar-produto"
                        style="width:100%;padding:14px;background:#10b981;color:white;border:none;border-radius:10px;font-weight:800;font-size:0.85rem;cursor:pointer;">
                        ${id ? '💾 SALVAR ALTERAÇÕES' : '✅ CRIAR PRODUTO'}
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        this._renderVariacoesTemp();
    },

    _renderVariacoesTemp() {
        const container = document.getElementById('lista-variacoes-temp');
        if (!container) return;
        if (this._variacoesTemp.length === 0) {
            container.innerHTML = '<small style="color:#475569;font-size:0.62rem;">Nenhuma variação cadastrada.</small>';
            return;
        }
        container.innerHTML = this._variacoesTemp.map((v, i) => `
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                <input type="text" value="${v.nome||''}" placeholder="Ex: A1, P, M, G, GG..."
                    onchange="loja._variacoesTemp[${i}].nome=this.value"
                    style="flex:1;padding:8px;background:#0f172a;border:1px solid #334155;color:white;border-radius:7px;font-size:0.75rem;">
                <input type="number" value="${v.estoque||0}" min="0" placeholder="Qtd"
                    onchange="loja._variacoesTemp[${i}].estoque=parseInt(this.value)||0"
                    style="width:65px;padding:8px;background:#0f172a;border:1px solid #334155;color:white;border-radius:7px;font-size:0.75rem;text-align:center;">
                <button onclick="loja._removerVariacaoTemp(${i})"
                    style="background:#ef444422;border:1px solid #ef4444;color:#ef4444;width:32px;height:34px;border-radius:7px;cursor:pointer;font-size:0.8rem;flex-shrink:0;">✕</button>
            </div>`).join('');
    },

    _adicionarVariacaoTemp() {
        this._variacoesTemp.push({ nome: '', estoque: 0 });
        this._renderVariacoesTemp();
        setTimeout(() => {
            const inputs = document.querySelectorAll('#lista-variacoes-temp input[type="text"]');
            if (inputs.length) inputs[inputs.length - 1].focus();
        }, 50);
    },

    _removerVariacaoTemp(i) {
        this._variacoesTemp.splice(i, 1);
        this._renderVariacoesTemp();
    },

    async salvarProduto(id) {
        const nome      = document.getElementById('prod-nome')?.value.trim();
        const preco     = parseFloat(document.getElementById('prod-preco')?.value);
        const categoria = document.getElementById('prod-categoria')?.value;
        const descricao = document.getElementById('prod-descricao')?.value.trim();
        const foto      = document.getElementById('prod-foto')?.value.trim();
        const link      = document.getElementById('prod-link')?.value.trim();
        const ativo     = document.getElementById('prod-ativo')?.checked ?? true;
        const destaque  = document.getElementById('prod-destaque')?.checked ?? false;

        if (!nome)             { alert('Nome do produto é obrigatório.'); return; }
        if (isNaN(preco)||preco<=0) { alert('Preço inválido.'); return; }

        const variacoes = this._variacoesTemp.filter(v => v.nome.trim() !== '');
        const dados = {
            nome, preco, categoria, descricao: descricao||'',
            foto: foto||'', linkPagamento: link||'',
            variacoes, ativo, destaque, ordem: 0,
            atualizadoEm: new Date().getTime()
        };

        const btn = document.getElementById('btn-salvar-produto');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Salvando...'; }
        try {
            if (id) {
                await db.collection('loja_produtos').doc(id).update(dados);
            } else {
                dados.criadoEm = new Date().getTime();
                await db.collection('loja_produtos').add(dados);
            }
            document.getElementById('modal-editar-produto')?.remove();
            this.renderAdminLoja();
        } catch(e) {
            if (btn) { btn.disabled = false; btn.innerHTML = id ? '💾 SALVAR ALTERAÇÕES' : '✅ CRIAR PRODUTO'; }
            alert('Erro ao salvar: ' + e.message);
        }
    },

    async excluirProduto(id) {
        if (!confirm('Excluir este produto permanentemente?')) return;
        try {
            await db.collection('loja_produtos').doc(id).delete();
            document.getElementById('modal-editar-produto')?.remove();
            document.getElementById('modal-produto-detalhe')?.remove();
            this.renderAdminLoja();
        } catch(e) { alert('Erro ao excluir: ' + e.message); }
    },

    // ── UPLOAD DE FOTO ───────────────────────────────────
    async _uploadFoto(file) {
        if (!file) return;
        const status   = document.getElementById('prod-foto-status');
        const preview  = document.getElementById('prod-foto-preview');
        const urlInput = document.getElementById('prod-foto');

        if (!file.type.startsWith('image/')) {
            if (status) status.innerHTML = '<span style="color:#ef4444;">❌ Apenas imagens são aceitas.</span>';
            return;
        }

        if (status) status.innerHTML = '<span style="color:#f59e0b;">⏳ Processando imagem...</span>';

        // 1. Comprime e gera base64 (sempre — serve como preview e fallback)
        let base64;
        try {
            base64 = await this._comprimirImagem(file, 600, 0.82);
        } catch(e) {
            if (status) status.innerHTML = '<span style="color:#ef4444;">❌ Erro ao ler imagem.</span>';
            return;
        }

        // Preview imediato com a versão comprimida
        if (preview) preview.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover;">`;

        // 2. Tenta Firebase Storage
        try {
            if (status) status.innerHTML = '<span style="color:#f59e0b;">⏳ Enviando para o servidor...</span>';
            const nomeArquivo = 'loja/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const ref  = getStorage().ref(nomeArquivo);
            const snap = await ref.put(file);
            const url  = await snap.ref.getDownloadURL();
            if (urlInput) urlInput.value = url;
            if (status) status.innerHTML = '<span style="color:#10b981;">✅ Imagem salva no servidor!</span>';
            return;
        } catch(storageErr) {
            console.warn('Firebase Storage falhou, usando base64:', storageErr.message);
        }

        // 3. Fallback: salva base64 comprimida direto no campo
        if (urlInput) urlInput.value = base64;
        const kb = Math.round(base64.length * 0.75 / 1024);
        if (status) status.innerHTML = `<span style="color:#10b981;">✅ Imagem salva localmente (${kb} KB).</span>`;
    },

    // Comprime imagem usando Canvas → retorna base64 JPEG
    _comprimirImagem(file, maxLado = 600, qualidade = 0.82) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = (ev) => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const ratio  = Math.min(maxLado / img.width, maxLado / img.height, 1);
                    const canvas = document.createElement('canvas');
                    canvas.width  = Math.round(img.width  * ratio);
                    canvas.height = Math.round(img.height * ratio);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', qualidade));
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    _atualizarPreviewFoto(url) {
        const preview = document.getElementById('prod-foto-preview');
        if (!preview) return;
        if (url && (url.startsWith('http') || url.startsWith('data:'))) {
            preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='🛒'">`;
        } else {
            preview.innerHTML = '🛒';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Salva turma do QR Code no sessionStorage antes do login
    const params = new URLSearchParams(window.location.search);
    const turmaQR = params.get('checkin') || params.get('turma');
    if (turmaQR) {
        sessionStorage.setItem('qr_turma', turmaQR);
        console.log('QR Code detectado — turma:', turmaQR);
    }

    const btn = document.getElementById('btnEntrar');
    if(btn) btn.addEventListener('click', () => auth.login());

    // Carrega credenciais do admin salvas no Firestore
    auth.carregarCredenciaisAdmin();
});
