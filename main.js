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
    adminCreds: { user: "admin", pass: "admin" },
    role: null, currentUser: null,
    async login() {
        const u = document.getElementById('user').value.trim().toLowerCase();
        const p = document.getElementById('pass').value.trim();

        // Login admin local
        if (u === this.adminCreds.user && p === this.adminCreds.pass) {
            this.role = 'admin'; this.currentUser = { id: 'admin', nome: "Eric (Adm)" };
            return this.sucesso();
        }

        try {
            // Verifica se é professor (sem Firebase Auth)
            const pS = await db.collection("professores").where("email", "==", u).get();
            if (!pS.empty) {
                const d = pS.docs[0].data();
                if (d.senha === p || p === "1234") {
                    this.role = 'professor';
                    this.currentUser = { id: pS.docs[0].id, ...d };
                    return this.sucesso();
                } else {
                    return alert("Senha incorreta.");
                }
            }

            // Login de aluno (pode ter role professor)
            const aS = await db.collection("alunos").where("email", "==", u).get();
            if (!aS.empty) {
                const d = aS.docs[0].data();
                const id = aS.docs[0].id;
                // Autentica
                let autenticado = false;
                try {
                    await firebase.auth().signInWithEmailAndPassword(u, p);
                    autenticado = true;
                } catch(authErr) {
                    autenticado = (d.senha === p || p === "1234");
                }
                if (!autenticado) return alert("Senha incorreta.");
                // Define role pelo campo no Firestore
                this.role = d.role === 'professor' ? 'professor' : 'aluno';
                this.currentUser = { id, ...d };
                return this.sucesso();
            }

            alert("Acesso negado. Usuário não encontrado.");
        } catch (e) { alert("Erro de conexão."); }
    },
    sucesso() {
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('screen-dashboard').classList.remove('hidden');
        document.getElementById('display-user').innerText = this.currentUser.nome;
        ui.configurarVisao();
        ui.showTab('tab-checkin');
        academia.carregarGradeFirebase();
        academia.carregarMural();
        academia.carregarConquistas();
        academia.carregarBibliotecaTecnica();

        // Mostra wrapper de perfil para aluno e professor
        if (this.role === 'aluno' || this.role === 'professor') {
            const wp = document.getElementById('wrapper-perfil-proprio');
            if (wp) wp.classList.remove('hidden');
        }

        // ── LISTENER RELATOS DE SAÚDE (aluno) ────────────
        if (this.role === 'aluno') academia.iniciarListenerRelatoAluno();

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
            if (s.pronto) prontos.push({ a, s });
            else outros.push({ a, s });
        });

        let html = '';

        // Prontos para graduar em destaque
        if (prontos.length > 0) {
            html += `<div style="background:#064e3b; border:1px solid #10b981; border-radius:12px; padding:14px; margin-bottom:16px;">
                <div style="color:#10b981; font-size:0.7rem; font-weight:800; margin-bottom:10px; letter-spacing:0.5px;">
                    🎯 PRONTOS PARA GRADUAR — ${prontos.length} atleta${prontos.length > 1 ? 's' : ''}
                </div>`;
            prontos.forEach(({ a }) => {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; border:1px solid #10b981; border-radius:8px; padding:10px 12px; margin-bottom:6px;">
                    <div>
                        <div style="font-size:0.85rem; font-weight:800; color:white;">${a.nome.toUpperCase()}</div>
                        <div style="font-size:0.65rem; color:#94a3b8;">${a.faixa} • ${a.grau}º Grau • ${a.aulas || 0} aulas</div>
                    </div>
                    <span style="background:#10b981; color:white; font-size:0.6rem; padding:4px 10px; border-radius:6px; font-weight:800;">✅ PRONTO</span>
                </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; text-align:center; margin-bottom:16px;">
                <div style="color:#64748b; font-size:0.8rem;">Nenhum atleta atingiu a meta ainda.</div>
            </div>`;
        }

        // Demais alunos
        html += `<div style="font-size:0.65rem; color:#64748b; font-weight:800; margin-bottom:8px; letter-spacing:0.5px;">TODOS OS ATLETAS</div>`;
        outros.forEach(({ a, s }) => {
            const percent = Math.round(s.percent);
            html += `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding:10px 0; font-size:0.8rem;">
                <span style="color:#e2e8f0;">${a.nome}<br><small style="color:var(--text-muted);">${a.faixa} • ${a.grau}º G</small></span>
                <span style="color:#64748b; font-size:0.7rem;">${a.aulas || 0}/${s.meta} <small>(${percent}%)</small></span>
            </div>`;
        });

        container.innerHTML = html;
    },

    async exportarDadosBackup() {
        const snap = await db.collection("alunos").orderBy("nome").get();
        let texto = "BACKUP GADITAS - " + new Date().toLocaleDateString() + "\n\n";
        snap.forEach(doc => { const a = doc.data(); texto += `${a.nome} | ${a.faixa} | ${a.aulas} aulas\n`; });
        navigator.clipboard.writeText(texto); alert("Dados copiados!");
    },

    async atualizarPresencaAntecipada() {
        const s = document.getElementById('select-turma-aluno'); const lD = document.getElementById('quem-treina-hoje'); if(!s || !lD) return;
        const snap = await db.collection("checkins").where("turma", "==", s.value).get();
        if (snap.empty) { lD.innerHTML = `<small style="color:var(--text-muted);">Nenhum atleta confirmado.</small>`; } else {
            const nomes = snap.docs.map(doc => { const n = doc.data().alunoNome.split(' '); return n.length > 1 ? `${n[0]} ${n[1][0]}.` : n[0]; });
            lD.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:4px;">${nomes.map(n => `<span style="background:#0f172a; color:#ccc; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid var(--border-light); font-weight:600;">${n}</span>`).join('')}</div>`;
        }
        // Mostra o plano da aula para o aluno ao trocar turma
        if (auth.role === 'aluno') this.carregarPlanoAulaTurma(s.value);
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
            const nomeAtleta = a.nome ? a.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "";
            const buscaNorm = this.textoBuscaNome.normalize("NFD").replace(/[̀-ͯ]/g, "");
            const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 14;
            if (buscaNorm !== "" && !nomeAtleta.includes(buscaNorm)) return;
            if (this.categoriaFiltroAtual === "adult" && isKids) return;
            if (this.categoriaFiltroAtual === "kids" && !isKids) return;
            if (faixaFiltro !== "all" && a.faixa !== faixaFiltro) return;

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

            cardsHtml += `<div class="item-card" style="border-left: 4px solid ${corBorda}; flex-direction:column; align-items:stretch; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; flex:1; min-width:0;">
                        ${fotoMini}
                        <div style="color:#e2e8f0; flex:1; font-size:0.85rem; font-weight:600; min-width:0;">
                            <span>${a.nome.toUpperCase()}${modBadge} ${eng.icon}</span>
                            ${beltBarHtml}
                            ${gradInfo}
                            ${tagsLeoes}
                        </div>
                    </div>
                    <div style="display:flex; gap:5px; flex-shrink:0;">
                        <button onclick="academia.editarAluno('${doc.id}')" style="background:#16161a; border:1px solid #2d2d34; color:#94a3b8; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-eye"></i></button>
                        ${isAdmin ? `<button onclick="academia.verFinanceiroAluno('${doc.id}', '${a.nome.replace(/'/g, "\'")}')" style="background:#064e3b; border:none; color:#10b981; padding:6px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-dollar-sign"></i></button>` : ''}
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
            <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px 15px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-users" style="color:#3b82f6; font-size:1rem;"></i>
                    <span style="font-size:0.8rem; font-weight:700; color:#e2e8f0;">ATLETAS MATRICULADOS</span>
                </div>
                <div style="display:flex; gap:12px; align-items:center;">
                    ${totalVisiveis !== totalGeral ? `<span style="font-size:0.7rem; color:#94a3b8;">Filtrado: <strong style="color:#f59e0b;">${totalVisiveis}</strong></span>` : ''}
                    <span style="font-size:0.7rem; color:#94a3b8;">Total: <strong style="color:#3b82f6; font-size:1rem;">${totalGeral}</strong></span>
                </div>
            </div>`;

        l.innerHTML = contadorHtml + (cardsHtml || `<p style='color:var(--text-muted); text-align:center; font-size:0.8rem; padding:15px;'>Nenhum atleta.</p>`);
    },

    async renderCheckins() {
        const l = document.getElementById('list-checkins'); if(!l) return;
        let snap = await db.collection("checkins").get(); const aSnap = await db.collection("alunos").get();
        const info = {}; aSnap.forEach(d => info[d.id] = d.data()); const g = {};
        snap.docs.forEach(doc => {
            const c = doc.data(); if (auth.role === 'admin' || (auth.currentUser.turmasAcesso && auth.currentUser.turmasAcesso.includes(c.turma))) {
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

    // Helpers: suporta dados antigos (string) e novos (objeto {conteudo, profNome})
    _planoConteudo(val) { return val ? (typeof val === 'object' ? val.conteudo || '' : val) : ''; },
    _planoProf(val)     { return val && typeof val === 'object' ? val.profNome || '' : ''; },

    async salvarPlanoAula(turma, conteudo) {
        const dataHoje = this._getDataHoje();
        const profNome = auth.currentUser?.nome || '';
        try {
            await db.collection('plano_aula').doc(dataHoje).set(
                { [turma]: { conteudo: conteudo.trim(), profNome } },
                { merge: true }
            );
            const btn = event.target.closest ? event.target : event.srcElement;
            const txtOriginal = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> SALVO!';
            btn.style.background = '#10b981';
            setTimeout(() => { btn.innerHTML = txtOriginal; btn.style.background = '#8b5cf6'; }, 2000);
        } catch(e) { alert('Erro ao salvar plano.'); }
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
            if (!isKids && turmaKids) {
                alert("🚫 Você está matriculado nas turmas adulto e não pode fazer check-in nas turmas Kids.");
                return;
            }
            if (isKids && !turmaKids) {
                alert("🚫 Você está matriculado nas turmas Kids e não pode fazer check-in nas turmas adulto.");
                return;
            }
        }
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
        const ids = ['kids1', 'kids2', 'adulto']; const snap = await db.collection("alunos").orderBy("aulas", "desc").get();
        const ano = new Date().getFullYear(); const listas = { kids1: [], kids2: [], adulto: [] };
        snap.forEach(doc => { const a = doc.data(); const i = ano - new Date(a.nascimento).getFullYear(); if(i <= 8) listas.kids1.push(a); else if(i <= 14) listas.kids2.push(a); else listas.adulto.push(a); });
        ids.forEach(id => {
            const c = document.getElementById(`lista-ranking-${id}`); if(!c) return;
            c.innerHTML = listas[id].slice(0,5).map((a, i) => `<div class="ranking-item"><div style="display:flex; align-items:center; gap:8px;"><span style="font-size:0.85rem; font-weight:700;">${(i === 0) ? "🥇" : (i === 1) ? "🥈" : (i === 2) ? "🥉" : `${i+1}º`}</span><span style="font-weight:600; color:#cbd5e1; font-size:0.8rem;">${a.nome}</span></div><div style="text-align:right;"><b style="color:#3b82f6; font-size:0.85rem; font-weight:800;">${a.aulas}</b></div></div>`).join('') || "<small style='color:var(--text-muted);'>Nenhum registro.</small>";
        });
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
            const [resPendente, resPago] = await Promise.all([
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=PENDING&limit=10`),
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=RECEIVED&limit=5`)
            ]);
            const pendentes = await resPendente.json(); const pagos = await resPago.json();
            const dataHoje = new Date(); dataHoje.setHours(0,0,0,0); let html = '';
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
        if(id) await db.collection("alunos").doc(id).update(dados);
        else await db.collection("alunos").add({...dados, aulas: 0, historico: [], historicoLeoes: []});
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
    _relatoListener: null,
    _relatoRespondidoVisto: null, // id do último relato respondido já notificado
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
    // RELATOS DE SAÚDE
    // ══════════════════════════════════════════
    toggleRelatoSaude() {
        const card = document.getElementById('card-relato-saude');
        if (!card) return;
        card.classList.toggle('hidden');
        if (!card.classList.contains('hidden')) {
            this.carregarRespostaRelato();
            // Esconde badge quando aluno abre o card
            const badge = document.getElementById('badge-resposta-relato');
            if (badge) badge.classList.add('hidden');
        }
    },

    iniciarListenerRelatoAluno() {
        if (!auth.currentUser || auth.role !== 'aluno') return;
        // Cancela listener anterior se houver
        if (this._relatoListener) { this._relatoListener(); this._relatoListener = null; }

        this._relatoListener = db.collection("relatos_saude")
            .where("alunoId","==", auth.currentUser.id)
            .onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    if (change.type === 'modified' || change.type === 'added') {
                        const d = change.doc.data();
                        const id = change.doc.id;
                        if (d.respondido && d.resposta && id !== this._relatoRespondidoVisto) {
                            this._relatoRespondidoVisto = id;
                            // Mostra toast
                            const toast = document.getElementById('toast-resposta-relato');
                            const textoEl = document.getElementById('toast-resposta-texto');
                            if (toast && textoEl) {
                                textoEl.textContent = d.resposta;
                                toast.classList.remove('hidden');
                            }
                            // Mostra badge no botão
                            const badge = document.getElementById('badge-resposta-relato');
                            if (badge) badge.classList.remove('hidden');
                            // Atualiza o campo de resposta no card se estiver aberto
                            this.carregarRespostaRelato();
                        }
                    }
                });
            });
    },

    fecharToastResposta() {
        const toast = document.getElementById('toast-resposta-relato');
        if (toast) toast.classList.add('hidden');
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
        const aluno = auth.currentUser;
        try {
            await db.collection("relatos_saude").add({
                alunoId: aluno.id,
                alunoNome: aluno.nome || aluno.name || aluno.email,
                tipo: this._tipoRelatoAtual,
                relato: texto,
                data: new Date().getTime(),
                dataFormatada: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}),
                lido: false, respondido: false, resposta: null
            });
            document.getElementById('textarea-relato').value = '';
            document.getElementById('card-relato-saude').classList.add('hidden');
            alert("✅ Relato enviado! O professor foi notificado. OSS!");
        } catch(e) { alert("Erro ao enviar relato."); }
    },

    async carregarRespostaRelato() {
        if (!auth.currentUser) return;
        try {
            const snap = await db.collection("relatos_saude")
                .where("alunoId","==", auth.currentUser.id).get();
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Relato ativo (não arquivado) — para mostrar botão recuperado
            const ativo = docs.filter(d => !d.arquivado).sort((a,b) => (b.data||0)-(a.data||0))[0];
            const btnRecup = document.getElementById('div-btn-recuperado');
            if (btnRecup) {
                if (ativo) btnRecup.classList.remove('hidden');
                else       btnRecup.classList.add('hidden');
            }

            // Última resposta (mesmo arquivado, guarda a resposta)
            const respondidos = docs.filter(d => d.respondido && d.resposta)
                .sort((a,b) => (b.data||0)-(a.data||0));
            const divResp  = document.getElementById('resposta-professor-relato');
            const divTexto = document.getElementById('texto-resposta-professor');
            const divData  = document.getElementById('data-resposta-professor');
            if (respondidos.length > 0 && divResp && divTexto) {
                const d = respondidos[0];
                divTexto.textContent = d.resposta;
                if (divData) divData.textContent = d.respostaDataFormatada || '';
                divResp.classList.remove('hidden');
            }
        } catch(e) {}
    },

    async marcarRecuperado() {
        if (!auth.currentUser) return;
        try {
            const snap = await db.collection("relatos_saude")
                .where("alunoId","==", auth.currentUser.id).get();
            const ativos = snap.docs.filter(d => !d.data().arquivado);
            if (ativos.length === 0) return;
            // Arquiva todos os relatos ativos do aluno
            await Promise.all(ativos.map(doc =>
                db.collection("relatos_saude").doc(doc.id).update({
                    arquivado: true,
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

    async carregarRelatosSaude() {
        const card  = document.getElementById('card-alertas-saude');
        const lista = document.getElementById('lista-relatos-saude');
        const badge = document.getElementById('badge-relatos');
        if (!lista) return;
        if (card) card.classList.remove('hidden');
        lista.innerHTML = '<small style="color:#64748b; display:block; text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>';
        try {
            const snap = await db.collection("relatos_saude").orderBy("data","desc").limit(50).get();
            const ativos   = snap.docs.filter(d => !d.data().arquivado);
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
                const novo  = !d.lido ? 'border-left:3px solid #f43f5e;' : '';
                const recuperadoTag = d.recuperado ? `<span style="background:#06503b; color:#34d399; font-size:0.55rem; font-weight:800; padding:2px 7px; border-radius:4px; margin-left:4px;">💪 RECUPERADO</span>` : '';
                return `<div style="background:#0f172a; border-radius:10px; padding:12px; margin-bottom:8px; ${novo}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                        <span style="font-weight:800; font-size:0.8rem; color:#e2e8f0;">${icon} ${(d.alunoNome||'').toUpperCase()}</span>
                        <span style="background:${cor}22; color:${cor}; font-size:0.55rem; font-weight:800; padding:2px 7px; border-radius:4px; flex-shrink:0; margin-left:6px;">${label}</span>${recuperadoTag}
                    </div>
                    <p style="color:#cbd5e1; font-size:0.75rem; margin:0 0 4px 0; line-height:1.5; font-style:italic;">"${d.relato}"</p>
                    <small style="color:#475569; font-size:0.6rem;">${d.dataFormatada}</small>
                    ${d.respondido
                        ? `<div style="margin-top:8px; background:#0c2344; padding:8px; border-radius:6px; border-left:2px solid #3b82f6;">
                               <small style="color:#3b82f6; font-size:0.6rem; font-weight:800;">SUA RESPOSTA:</small>
                               <p style="color:#93c5fd; font-size:0.75rem; margin:3px 0 0 0;">${d.resposta}</p>
                           </div>
                           <button onclick="academia.resolverRelato('${doc.id}')" style="margin-top:6px; width:100%; padding:7px; background:#064e3b22; border:1px solid #10b98144; color:#10b981; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.65rem;">✓ MARCAR COMO RESOLVIDO</button>`
                        : `<div style="display:flex; gap:6px; margin-top:8px;">
                               <input type="text" id="resp-${doc.id}" placeholder="Responder ao aluno..." style="flex:1; padding:8px; background:#1e293b; border:1px solid #334155; color:white; border-radius:6px; outline:none; font-size:0.75rem;"/>
                               <button onclick="academia.responderRelato('${doc.id}')" style="padding:8px 12px; background:#3b82f6; border:none; color:white; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.7rem; white-space:nowrap;"><i class="fas fa-reply"></i> ENVIAR</button>
                           </div>
                           <button onclick="academia.resolverRelato('${doc.id}')" style="margin-top:6px; width:100%; padding:7px; background:#064e3b22; border:1px solid #10b98144; color:#10b981; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.65rem;">✓ MARCAR COMO RESOLVIDO SEM RESPONDER</button>`
                    }
                </div>`;
            }).join('');
            // Marca ativos como lidos
            ativos.filter(d => !d.data().lido).forEach(doc => {
                db.collection("relatos_saude").doc(doc.id).update({ lido: true }).catch(()=>{});
            });
        } catch(e) { lista.innerHTML = '<small style="color:#f43f5e;">Erro ao carregar relatos.</small>'; }
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

    calcularEngajamento(h) {
        if (!h || h.length === 0) return { label: "Inativo", icon: "💤", color: "#475569" };
        const tD = new Date(); tD.setDate(tD.getDate() - 30);
        const rec = h.filter(i => { if (!i.data) return false; const p = i.data.split(',')[0].split('/'); return new Date(`${p[2]}-${p[1]}-${p[0]}`) >= tD; });
        if (rec.length >= 12) return { label: "Em Brasa", icon: "🔥", color: "#f97316" };
        return { label: "Focado", icon: "✅", color: "#10b981" };
    },

    _verificarJanelaHorario(turmaQR) {
        // Extrai o horário da turma — ex: "22:30 - BJJ" → "22:30"
        const match = turmaQR.match(/^(\d{2}):(\d{2})/);
        if (!match) return false;
        const hTurma = parseInt(match[1]);
        const mTurma = parseInt(match[2]);

        const agora = new Date();
        const minAgora = agora.getHours() * 60 + agora.getMinutes();
        const minTurma = hTurma * 60 + mTurma;

        // Janela de ±15 minutos
        return Math.abs(minAgora - minTurma) <= 15;
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
                alert("⚠️ Check-in enviado para aprovação! Você está fora da janela de ±15 min da aula.");
            }
        } catch(e) { console.warn("Erro QR:", e.message); }
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

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <span style="font-size:0.85rem; font-weight:800; color:${modoEditar ? '#f59e0b' : 'white'};">
                    <i class="fas fa-${modoEditar ? 'pen' : 'calendar-alt'}" style="margin-right:6px; color:${modoEditar ? '#f59e0b' : '#3b82f6'};"></i>
                    ${modoEditar ? 'EDITAR HORÁRIOS' : 'Horários e Turmas'}
                </span>
                ${isAdmin ? `<button onclick="academia.toggleEdicaoHorarios()" style="background:${modoEditar ? '#334155' : '#f59e0b'}; border:none; color:${modoEditar ? 'white' : '#000'}; padding:8px 14px; border-radius:8px; font-size:0.7rem; font-weight:800; cursor:pointer;">${modoEditar ? '✕ FECHAR' : '✏️ EDITAR'}</button>` : ''}
            </div>`;

        for (let d = 0; d <= 6; d++) {
            const slots = grade[d] || grade[String(d)] || ['Sem treinos hoje'];
            const isHoje = d === hoje;

            if (modoEditar) {
                html += `<div style="margin-bottom:18px;">
                    <div style="font-size:0.65rem; font-weight:800; color:${isHoje ? '#3b82f6' : '#94a3b8'}; margin-bottom:8px; letter-spacing:0.5px;">
                        ${diasNomes[d].toUpperCase()}${isHoje ? ' — HOJE' : ''}
                    </div>`;
                slots.forEach(slot => {
                    if (slot === 'Sem treinos hoje') {
                        html += `<div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:11px 14px; margin-bottom:6px;">
                            <span style="color:#64748b; font-size:0.8rem; font-style:italic;">Sem treinos hoje</span>
                        </div>`;
                        return;
                    }
                    html += `<div style="background:#1e293b; border:1px solid #334155; border-radius:8px; padding:11px 14px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#e2e8f0; font-size:0.85rem; font-weight:600;">${slot}</span>
                        <button onclick="academia.removerHorarioAdmin(${d}, '${slot.replace(/'/g, "\\'")}')" style="background:none; border:none; color:#f43f5e; cursor:pointer; padding:4px; font-size:1rem;"><i class="fas fa-times"></i></button>
                    </div>`;
                });
                html += `<div style="display:flex; gap:8px; margin-top:4px;">
                    <input type="text" id="input-horario-${d}" placeholder="ex: 19:00 - BJJ"
                        style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;"/>
                    <button onclick="academia.adicionarHorarioAdmin(${d})" style="background:#3b82f6; border:none; color:white; padding:10px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem; white-space:nowrap;">+ Add</button>
                </div></div>`;
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

    async adicionarHorarioAdmin(dia) {
        const input = document.getElementById(`input-horario-${dia}`);
        if (!input || !input.value.trim()) return alert("Digite o horário e turma (ex: 19:00 - BJJ).");
        const valor = input.value.trim();
        const grade = this.getGrade();
        const slots = (grade[dia] || grade[String(dia)] || []).filter(s => s !== 'Sem treinos hoje');
        if (!slots.includes(valor)) slots.push(valor);
        slots.sort();
        grade[dia] = slots;
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
        this.gradeFirebase = grade;
        try {
            await db.collection('configuracoes').doc('horarios').set(grade);
        } catch(e) { console.warn('Erro ao salvar horário:', e); }
        this.renderHorarios();
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
            if (auth.role === 'admin' || auth.role === 'professor') academia.carregarRelatosSaude();
            if (auth.role === 'admin') academia.carregarVideosPendentesAdmin();
            if (auth.role === 'professor') {
                academia.carregarVideosPendentesProf();
                const profSenha = document.getElementById('prof-senha-section');
                if (profSenha) profSenha.classList.remove('hidden');
            }
        }
        if(id === 'tab-eventos') { academia.limparFormEvento(); academia.carregarEventosAbas(); }
        if(id === 'tab-checkin') { academia.renderRanking(); this.atualizarTurmasDinamicas(); academia.renderCheckins(); this.renderPerfilAluno(); academia.carregarConquistas(); academia.carregarBibliotecaTecnica(); academia.carregarMeusCheckinsPendentes(); if(auth.role === 'professor' || auth.role === 'admin') academia.renderPlanoAulaProf(); }
        if(id === 'tab-relatorios') { academia.generarRelatorioGraduacao(); academia.calcularAnalyticsFrequencia(); }
        if(id === 'tab-horarios') { academia._modoEdicaoHorarios = false; academia.renderHorarios(); }
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

            card.innerHTML = `
                <div class="curriculo-atleta" style="background: var(--bg-card); padding: 18px; border-radius: 16px; border: 1px solid var(--border-light);">
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
});
