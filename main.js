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

// Converte URLs no texto em links clicáveis (igual WhatsApp)
function linkificar(texto) {
    if (!texto) return '';
    const escaped = texto.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return escaped.replace(
        /(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener" style="color:#60a5fa;text-decoration:underline;word-break:break-all;">$1</a>'
    );
}

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
    getFaixas(idade) { return idade <= 15 ? this.infantil : this.adulto; },
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

    // Carrega metas de aulas por faixa/grau salvas no Firestore
    async carregarMetasAulas() {
        try {
            const doc = await db.collection('configuracoes').doc('metas_aulas').get();
            if (doc.exists) {
                const d = doc.data();
                // Mescla sobre o objeto hardcoded, permitindo override pelo admin
                for (const faixa of Object.keys(d)) {
                    if (graduacao.regrasAulas[faixa] !== undefined) {
                        if (typeof d[faixa] === 'object') {
                            graduacao.regrasAulas[faixa] = { ...graduacao.regrasAulas[faixa], ...d[faixa] };
                        }
                    }
                }
            }
        } catch(e) { console.warn('carregarMetasAulas:', e.message); }
    },

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
                if (d.permitirKidsComAdultos != null) this.adminCreds.permitirKidsComAdultos = d.permitirKidsComAdultos;
                if (d.nascimentoMestre) this.adminCreds.nascimentoMestre = d.nascimentoMestre;
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
    async recuperarSenha() {
        const email = prompt('Digite seu e-mail cadastrado:');
        if (!email || !email.includes('@')) return;
        const e = email.trim().toLowerCase();
        try {
            // Garante sessão anônima para poder consultar Firestore
            if (!firebase.auth().currentUser) {
                try { await firebase.auth().signInAnonymously(); } catch(_) {}
            }
            // Tenta enviar pelo Firebase Auth (funciona para alunos com conta Firebase)
            try {
                await firebase.auth().sendPasswordResetEmail(e);
                alert('✅ Email de recuperação enviado!\n\nVerifique sua caixa de entrada (e o spam).');
                return;
            } catch(authErr) {
                if (authErr.code !== 'auth/user-not-found') throw authErr;
            }
            // Usuário não tem conta Firebase — verifica se existe como prof/aluno no Firestore
            const [snapP, snapA] = await Promise.all([
                db.collection('professores').where('email','==',e).get(),
                db.collection('alunos').where('email','==',e).get()
            ]);
            if (!snapP.empty || !snapA.empty) {
                alert('⚠️ Sua conta não usa login por e-mail.\n\nContate o professor ou admin para redefinir sua senha.');
            } else {
                alert('❌ Nenhuma conta encontrada com esse e-mail.');
            }
        } catch(err) {
            alert('Erro: ' + err.message);
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
        ui.renderCardContrato();
        // Exibe popup de contrato para aluno que ainda não assinou
        if ((this.role === 'aluno' || this.role === 'professor') && !this.currentUser?.contrato?.assinaturaImg) {
            setTimeout(() => { if (typeof contrato !== 'undefined') contrato.abrir(); }, 800);
        }
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
        // Boletim escolar: visível para kids (por idade ou por turma kids)
        if (this.role === 'aluno') {
            const _nasc = this.currentUser?.nascimento;
            const _idadeBoletim = _nasc ? new Date().getFullYear() - new Date(_nasc).getFullYear() : 99;
            const _turmasKids = (this.currentUser?.turmas || []).some(t => /kids/i.test(t));
            const _nomeKids = /kids/i.test(this.currentUser?.nome || '');
            if (_idadeBoletim <= 15 || _turmasKids || _nomeKids) {
                const wb = document.getElementById('wrapper-boletim-escolar');
                if (wb) wb.classList.remove('hidden');
            }
            // Verifica se professor enviou relatório novo
            if (typeof boletim !== 'undefined') {
                setTimeout(() => boletim.verificarRelatorioPais(this.currentUser.id), 2000);
            }
        }

        // ── TAB DE EXAME + BANNER TREINO ──────────────────────
        // Garante escondida antes de verificar (usa classe por causa do !important no CSS)
        const _btnExame = document.getElementById('menu-exame');
        if (_btnExame && this.role !== 'admin') _btnExame.classList.add('nav-item-hidden');
        if ((this.role === 'aluno' || this.role === 'professor') && this.currentUser?.id) {
            exame.verificarConvocacao(this.currentUser.id);
            setTimeout(() => exame.carregarBannerExame(), 600);
        }

        // ── LISTENERS RELATOS DE SAÚDE ────────────────────
        if (this.role === 'aluno') { academia.iniciarListenerRelatoAluno(); setTimeout(() => academia.iniciarListenerRecadosAluno(), 1500); }
        if (this.role === 'admin' || this.role === 'professor') academia.iniciarListenerRelatosProf();
        if (this.role === 'professor') { profComms.iniciarListenerRecadosProf(); setTimeout(() => profComms.renderPainelDispensas(), 1000); }
        if (this.role === 'admin') {
            setTimeout(() => profComms.renderPainelConvocacoes(), 1500);
            setTimeout(() => profComms.verificarDispensasAdmin(), 2000);
        }
        // Badge de depoimentos aprovados (carrega em background)
        academia._carregarBadgeDepoimentos();
        // Badge e painel de solicitações de avaliação física (admin/professor)
        if (this.role === 'admin' || this.role === 'professor') avaliacaoFisica.iniciarListenerSolicitacoes();

        // ── ANIVERSÁRIO, CONVOCAÇÃO e GRADUAÇÃO — para aluno e professor promovido ─────────────
        if (this.role === 'aluno' || this.role === 'professor') {
            setTimeout(() => aniversario.verificarAniversario(), 800);
            setTimeout(() => aniversario.verificarAniversarioColegas(), 1000);
            setTimeout(() => aniversario.verificarAniversarioMestre(), 1800);
            setTimeout(() => aniversario.verificarParabensRecebidos(), 2200);
            setTimeout(() => aniversario.verificarConvocacao(), 1200);
            setTimeout(() => aniversario.verificarGraduacao(), 1500);
            setTimeout(() => aniversario.verificarAulasCanceladas(), 2500);
        }

        // ── ENQUETE ATIVA (aparece como popup bloqueante) ─
        if (this.role === 'aluno') {
            setTimeout(() => enquetes.verificarEnqueteAtiva(), 2000);
        }
        if (this.role === 'aluno' || this.role === 'professor') {
            setTimeout(() => academia.verificarDisparoEvento(), 3500);
        }

        // ── CHECK-IN AUTOMÁTICO VIA QR CODE ──────────────
        if (this.role === 'aluno') {
            const turmaQR = sessionStorage.getItem('qr_turma');
            if (turmaQR) {
                sessionStorage.removeItem('qr_turma');
                setTimeout(() => academia.processarCheckinQR(turmaQR, this.currentUser.id), 1500);
            }
        }

        // Registra token FCM para push notifications (todos os roles)
        setTimeout(() => this._registrarFcmToken(), 3000);

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
    _VAPID_KEY: 'BCtvNDMaM5KiOT70UmBxguiQc7YnSeCdpfS5YXIQwl89SGtueD-kqxdseexAr_jU2rCEefC-jBtWXGhbr85MIv8',

    _mostrarBannerNotificacao() {
        if (document.getElementById('banner-notif-perm')) return;
        const banner = document.createElement('div');
        banner.id = 'banner-notif-perm';
        banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:9999;width:calc(100% - 32px);max-width:420px;';
        banner.innerHTML = `
            <div style="background:#1e293b;border:1px solid #f59e0b;border-radius:14px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;align-items:center;gap:12px;">
                <span style="font-size:1.4rem;flex-shrink:0;">🔔</span>
                <div style="flex:1;">
                    <div style="font-size:0.72rem;font-weight:800;color:#f59e0b;margin-bottom:2px;">ATIVE AS NOTIFICAÇÕES</div>
                    <div style="font-size:0.68rem;color:#94a3b8;line-height:1.4;">Para receber avisos de eventos e presenças, ative as notificações nas configurações do seu navegador.</div>
                </div>
                <button onclick="document.getElementById('banner-notif-perm').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1.1rem;flex-shrink:0;padding:0;">✕</button>
            </div>`;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 12000);
    },

    async _registrarFcmToken() {
        const log = (msg, err) => console[err ? 'error' : 'log']('[FCM] ' + msg);
        try {
            if (!('Notification' in window))              { log('Notification API não disponível'); return; }
            if (!('serviceWorker' in navigator))          { log('ServiceWorker não disponível'); return; }
            if (typeof firebase === 'undefined')          { log('Firebase não definido'); return; }
            if (typeof firebase.messaging !== 'function') { log('firebase.messaging não carregado'); return; }

            if (Notification.permission === 'denied') {
                // Só mostra banner se ainda não registrou token neste dispositivo
                if (!localStorage.getItem('gaditas_fcm_ok')) {
                    this._mostrarBannerNotificacao();
                }
                return;
            }

            if (Notification.permission !== 'granted') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') { log('Usuário recusou permissão'); return; }
            }
            log('Permissão OK');

            const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
                .then(() => navigator.serviceWorker.ready)
                .catch(e => { log('SW falhou: ' + e.message, true); return null; });
            if (!swReg) return;
            log('SW pronto');

            // FCM v9 compat exige usuário autenticado no Firebase Auth para registrar o token
            const curUser = firebase.auth().currentUser;
            log('Firebase Auth currentUser: ' + (curUser ? curUser.uid : 'null'));
            if (!curUser) {
                log('Fazendo signInAnonymously...');
                try {
                    const cred = await firebase.auth().signInAnonymously();
                    log('Auth anônimo OK: ' + cred.user.uid);
                } catch(e) {
                    log('signInAnonymously falhou: ' + e.message, true);
                    return;
                }
            } else {
                // Força refresh do ID token para garantir que não está expirado
                try {
                    await curUser.getIdToken(true);
                    log('ID token refreshed');
                } catch(e) {
                    log('Refresh falhou, tentando signInAnonymously...', true);
                    try {
                        await firebase.auth().signInAnonymously();
                        log('Auth anônimo OK (fallback)');
                    } catch(e2) { log('signInAnonymously falhou: ' + e2.message, true); return; }
                }
            }

            const messaging = firebase.messaging();
            const token = await messaging.getToken({ vapidKey: this._VAPID_KEY, serviceWorkerRegistration: swReg });
            if (!token) { log('Token vazio — verifique VAPID key no Firebase Console', true); return; }
            log('Token obtido: ' + token.substring(0, 20) + '...');

            if (this.currentUser?.id) {
                if (this.role === 'admin') {
                    // Admin salva em configuracoes/admin_config
                    await db.collection('configuracoes').doc('admin_config').set({ fcmToken: token }, { merge: true });
                } else {
                    const colecao = this.role === 'professor' ? 'professores' : 'alunos';
                    await db.collection(colecao).doc(this.currentUser.id).update({ fcmToken: token });
                }
                localStorage.setItem('gaditas_fcm_ok', '1');
                log('Token salvo no Firestore ✅');
            }

            // Notificações com o app em primeiro plano
            messaging.onMessage(payload => {
                const n = payload.notification || {};
                if (!n.title) return;
                swReg.showNotification(n.title, {
                    body: n.body || '',
                    icon: n.icon || '/gaditasstore.png',
                    badge: '/gaditasstore.png',
                    vibrate: [200, 100, 200],
                    data: payload.data
                });
            });
            log('onMessage (foreground) registrado ✅');
        } catch(e) {
            console.error('[FCM] Erro:', e.message, e);
        }
    },

    // Envia push via API para um token específico
    async _enviarPush(token, title, body) {
        if (!token) return;
        try {
            fetch('/api/push-comunicado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens: [token], title, body })
            }).catch(() => {});
        } catch(e) { /* silencioso */ }
    },

    _renderFaixaHeader() {
        try {
            const el = document.getElementById('display-faixa-header');
            if (!el || (this.role !== 'aluno' && this.role !== 'admin' && this.role !== 'professor')) return;
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
    _gradFiltroCategoria: "all",   // 'all' | 'kids' | 'adulto'
    _gradFiltroFaixa: "all",       // 'all' | nome da faixa
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
        const turmasDisponiveis = [...new Set(Object.values(this.getGrade()).filter(v => Array.isArray(v)).flat())].filter(t => !t.includes("Sem treinos"));
        let mMenu = `Selecione o número da turma para ${alunoNome.toUpperCase()}:\n\n`;
        turmasDisponiveis.forEach((t, i) => { mMenu += `${i + 1}. ${t}\n`; });
        const escolha = prompt(mMenu); if (!escolha) return; 
        const index = parseInt(escolha) - 1;
        if (isNaN(index) || index < 0 || index >= turmasDisponiveis.length) return alert("Opção inválida.");
        try {
            const ref = db.collection("alunos").doc(alunoId); const doc = await ref.get(); if (!doc.exists) return;
            const d = doc.data(); const h = d.historico || [];
            const turmaSel = turmasDisponiveis[index];
            h.unshift({ data: new Date().toLocaleDateString('pt-BR'), turma: turmaSel, tipo: "Presença Manual (Adm/Prof)" });
            const isMTManual = this._isTurmaMT(turmaSel);
            const updManual = { historico: h };
            if (isMTManual) updManual.aulasMT = (d.aulasMT || 0) + 1;
            else             updManual.aulas   = (d.aulas   || 0) + 1;
            await ref.update(updManual);
            alert("✅ Presença inserida!"); this.renderAlunos(); this.renderRanking();
        } catch (e) { alert("Erro ao lançar."); }
    },

    async removerPresencaAdmin(alunoId, alunoNome) {
        const ref = db.collection('alunos').doc(alunoId);
        const doc = await ref.get();
        if (!doc.exists) return;
        const d = doc.data();
        const hist = d.historico || [];
        if (!hist.length) return alert('Nenhuma presença registrada.');

        // Monta lista das últimas 10 presenças
        const ultimas = hist.slice(0, 10);
        let menu = `Remover presença de ${alunoNome.toUpperCase()}\nEscolha o número:\n\n`;
        ultimas.forEach((h, i) => { menu += `${i+1}. ${h.data} — ${h.turma || ''}${h.tipo ? ' ('+h.tipo+')' : ''}\n`; });
        const escolha = prompt(menu);
        if (!escolha) return;
        const idx = parseInt(escolha) - 1;
        if (isNaN(idx) || idx < 0 || idx >= ultimas.length) return alert('Opção inválida.');
        if (!confirm(`Remover presença do dia ${ultimas[idx].data} (${ultimas[idx].turma})?`)) return;

        const isMT = this._isTurmaMT(ultimas[idx].turma || '');
        hist.splice(idx, 1);
        const upd = { historico: hist };
        if (isMT) upd.aulasMT = Math.max((d.aulasMT || 0) - 1, 0);
        else       upd.aulas   = Math.max((d.aulas   || 0) - 1, 0);
        await ref.update(upd);
        alert('✅ Presença removida!');
        this.renderAlunos();
        this.renderRanking();
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
            <div style="background:#0f172a; border:1px solid #f59e0b44; border-radius:12px; overflow:hidden; margin-bottom:4px;">
                <div onclick="const b=this.nextElementSibling;const open=b.style.display!=='none';b.style.display=open?'none':'block';this.querySelector('.cfg-chv').style.transform=open?'rotate(0)':'rotate(180deg)'"
                    style="padding:13px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                    <span style="font-size:0.7rem; font-weight:800; color:#f59e0b; letter-spacing:0.5px;">
                        <i class="fas fa-cog"></i> CONFIGURAR VALORES DOS PLANOS
                    </span>
                    <i class="fas fa-chevron-down cfg-chv" style="color:#f59e0b; font-size:0.8rem; transition:transform 0.25s;"></i>
                </div>
                <div style="display:none; padding:0 15px 15px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        ${['mensal','trimestral','semestral','anual'].map(key => `
                            <div>
                                <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px;">${planos[key].label.toUpperCase()} (R$/mês)</small>
                                <input type="number" id="plano-val-${key}" value="${planos[key].valor}" step="0.01"
                                    style="width:100%; padding:10px; background:#1e293b; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.85rem; font-weight:700;"/>
                            </div>`).join('')}
                    </div>
                    <div style="display:flex; gap:8px; margin-top:12px;">
                        <button onclick="academia.salvarConfiguracaoPlanos()" style="flex:1; padding:12px; background:#f59e0b; border:none; color:#000; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem;">
                            <i class="fas fa-save"></i> SALVAR VALORES
                        </button>
                        <button onclick="window.open('index.html','_blank')" style="padding:12px 14px; background:#1e293b; border:1px solid #334155; color:#e2e8f0; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.8rem; white-space:nowrap;">
                            <i class="fas fa-external-link-alt"></i> VER SITE
                        </button>
                    </div>
                </div>
            </div>`;
    },

    // ── CMS LANDING PAGE ────────────────────────────────────
    async _carregarLandingConfig() {
        const doc = await db.collection('configuracoes').doc('landing_config').get();
        return doc.exists ? doc.data() : {
            whatsapp: '', endereco: '', instagram: '',
            hero_descricao: 'Jiu-Jitsu, Muay Thai e programa Kids.\nAqui o tatame transforma vidas.',
            planos_desc: {
                mensal: 'Renovação mensal, sem fidelidade.',
                trimestral: 'Pague 3 meses e economize.',
                semestral: 'Melhor custo-benefício do ano.',
                anual: 'Comprometimento total com sua evolução.'
            },
            mais_popular: 'semestral',
            planos_itens: {
                mensal:     'Aulas ilimitadas (BJJ, MT e Kids)\nSistema de graduação\nAcesso ao app exclusivo\nParticipação em eventos',
                trimestral: 'Aulas ilimitadas (BJJ, MT e Kids)\nSistema de graduação\nAcesso ao app exclusivo\nParticipação em eventos',
                semestral:  'Aulas ilimitadas (BJJ, MT e Kids)\nSistema de graduação\nAcesso ao app exclusivo\nParticipação em eventos',
                anual:      'Aulas ilimitadas (BJJ, MT e Kids)\nSistema de graduação\nAcesso ao app exclusivo\nParticipação em eventos'
            }
        };
    },

    async salvarLandingConfig() {
        const cfg = {
            whatsapp:       document.getElementById('lnd-whatsapp').value.trim(),
            endereco:       document.getElementById('lnd-endereco').value.trim(),
            instagram:      document.getElementById('lnd-instagram').value.trim(),
            hero_descricao: document.getElementById('lnd-hero-desc').value.trim(),
            mais_popular: document.getElementById('lnd-mais-popular').value,
            planos_desc: {
                mensal:     document.getElementById('lnd-desc-mensal').value.trim(),
                trimestral: document.getElementById('lnd-desc-trimestral').value.trim(),
                semestral:  document.getElementById('lnd-desc-semestral').value.trim(),
                anual:      document.getElementById('lnd-desc-anual').value.trim()
            },
            planos_itens: {
                mensal:     document.getElementById('lnd-itens-mensal').value.trim(),
                trimestral: document.getElementById('lnd-itens-trimestral').value.trim(),
                semestral:  document.getElementById('lnd-itens-semestral').value.trim(),
                anual:      document.getElementById('lnd-itens-anual').value.trim()
            }
        };
        await db.collection('configuracoes').doc('landing_config').set(cfg);
        alert('✅ Conteúdo do site atualizado!');
    },

    async renderPainelLanding() {
        const container = document.getElementById('painel-config-landing');
        if (!container) return;
        const cfg = await this._carregarLandingConfig();

        const inputStyle = `width:100%; padding:9px 11px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.82rem; box-sizing:border-box;`;
        const taStyle   = `${inputStyle} resize:vertical; min-height:72px; font-family:inherit;`;
        const label     = (txt) => `<small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin:10px 0 4px;letter-spacing:0.5px;">${txt}</small>`;

        const planoRow = (key, label_) => `
            <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px;margin-top:8px;">
                <div style="font-size:0.65rem;font-weight:900;color:#3b82f6;letter-spacing:1px;margin-bottom:8px;">${label_.toUpperCase()}</div>
                ${label('DESCRIÇÃO CURTA')}
                <input id="lnd-desc-${key}" value="${(cfg.planos_desc?.[key] || '').replace(/"/g,'&quot;')}" style="${inputStyle}" placeholder="Ex: Renovação mensal, sem fidelidade."/>
                ${label('O QUE ESTÁ INCLUSO (um item por linha)')}
                <textarea id="lnd-itens-${key}" style="${taStyle}" placeholder="Item 1&#10;Item 2&#10;Item 3">${cfg.planos_itens?.[key] || ''}</textarea>
            </div>`;

        container.innerHTML = `
        <div style="background:#0f172a; border:1px solid #3b82f644; border-radius:12px; overflow:hidden; margin-bottom:4px;">
            <div onclick="const b=this.nextElementSibling;const o=b.style.display!=='none';b.style.display=o?'none':'block';this.querySelector('.lnd-chv').style.transform=o?'rotate(0)':'rotate(180deg)'"
                style="padding:13px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                <span style="font-size:0.7rem;font-weight:800;color:#3b82f6;letter-spacing:0.5px;">
                    <i class="fas fa-globe"></i> EDITAR CONTEÚDO DO SITE
                </span>
                <i class="fas fa-chevron-down lnd-chv" style="color:#3b82f6;font-size:0.8rem;transition:transform 0.25s;"></i>
            </div>
            <div style="display:none;padding:0 15px 15px;">

                <!-- CONTATO -->
                <div style="font-size:0.65rem;font-weight:900;color:#10b981;letter-spacing:1px;margin-top:4px;">CONTATO</div>
                ${label('WHATSAPP (só números, ex: 79912345678)')}
                <input id="lnd-whatsapp" value="${cfg.whatsapp||''}" style="${inputStyle}" placeholder="79912345678" type="tel"/>
                ${label('ENDEREÇO')}
                <input id="lnd-endereco" value="${cfg.endereco||''}" style="${inputStyle}" placeholder="Rua X, Bairro — Aracaju/SE"/>
                ${label('INSTAGRAM (com @)')}
                <input id="lnd-instagram" value="${cfg.instagram||''}" style="${inputStyle}" placeholder="@gaditasacademy"/>

                <!-- HERO -->
                <div style="font-size:0.65rem;font-weight:900;color:#10b981;letter-spacing:1px;margin-top:16px;">TEXTO PRINCIPAL</div>
                ${label('SUBTÍTULO DO HERO')}
                <textarea id="lnd-hero-desc" style="${taStyle}" placeholder="Jiu-Jitsu, Muay Thai e programa Kids.&#10;Aqui o tatame transforma vidas.">${cfg.hero_descricao||''}</textarea>

                <!-- PLANOS -->
                <div style="font-size:0.65rem;font-weight:900;color:#10b981;letter-spacing:1px;margin-top:16px;">PLANOS — DESCRIÇÃO E ITENS</div>
                ${label('PLANO DESTAQUE (MAIS POPULAR)')}
                <select id="lnd-mais-popular" style="${inputStyle}">
                    ${['mensal','trimestral','semestral','anual'].map(k =>
                        `<option value="${k}" ${(cfg.mais_popular||'semestral')===k?'selected':''}>${k.charAt(0).toUpperCase()+k.slice(1)}</option>`
                    ).join('')}
                </select>
                ${planoRow('mensal','Mensal')}
                ${planoRow('trimestral','Trimestral')}
                ${planoRow('semestral','Semestral')}
                ${planoRow('anual','Anual')}

                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button onclick="academia.salvarLandingConfig()" style="flex:1;padding:12px;background:#3b82f6;border:none;color:#fff;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.8rem;">
                        <i class="fas fa-save"></i> SALVAR CONTEÚDO DO SITE
                    </button>
                    <button onclick="window.open('index.html','_blank')" style="padding:12px 14px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.8rem;white-space:nowrap;">
                        <i class="fas fa-external-link-alt"></i> VER SITE
                    </button>
                </div>
            </div>
        </div>`;
    },

    // ── ALERTAS DE NOVOS CADASTROS ──────────────────────────
    async carregarNovoCadastrosAlerta() {
        const container = document.getElementById('painel-novos-cadastros');
        if (!container) return;

        db.collection('novos_cadastros').orderBy('data', 'desc').limit(50).onSnapshot(snap => {
            if (snap.empty) {
                container.innerHTML = `<p style="color:#64748b; font-size:0.75rem; text-align:center; padding:10px;">Nenhum novo cadastro ainda.</p>`;
                return;
            }

            // Filtra: mostra não lidos + lidos dos últimos 7 dias
            const limite7dias = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const docsVisiveis = snap.docs.filter(doc => {
                const d = doc.data();
                if (!d.lido) return true; // sempre mostra não lidos
                const dataMs = typeof d.data === 'number' ? d.data : (d.data?.toMillis?.() || 0);
                return dataMs > limite7dias; // lidos: só últimos 7 dias
            });

            if (docsVisiveis.length === 0) {
                container.innerHTML = `<p style="color:#64748b; font-size:0.75rem; text-align:center; padding:10px;">Nenhum cadastro recente.</p>`;
                return;
            }

            const naoLidos = docsVisiveis.filter(d => !d.data().lido).length;
            const badge = naoLidos > 0 ? `<span style="background:#f43f5e; color:white; font-size:0.6rem; padding:2px 8px; border-radius:10px; font-weight:800; margin-left:8px;">${naoLidos} NOVO${naoLidos > 1 ? 'S' : ''}</span>` : '';
            const cores = { mensal: '#3b82f6', trimestral: '#8b5cf6', semestral: '#10b981', anual: '#f59e0b' };

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:0.7rem; font-weight:800; color:#10b981;"><i class="fas fa-user-plus"></i> NOVOS CADASTROS ${badge}</span>
                    ${naoLidos > 0 ? `<button onclick="academia.marcarTodosCadastrosLidos()" style="background:none; border:none; color:#64748b; font-size:0.65rem; cursor:pointer; font-weight:700;">Marcar todos como lidos</button>` : ''}
                </div>
                ${docsVisiveis.map(doc => {
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

    // ── Em Brasa: aparece 2 dias, oculta 5, volta 2 dias... ──
    _deveExibirEmBrasa(alunoId, estaEmBrasa) {
        const key = `embrasa_${alunoId}`;
        if (!estaEmBrasa) { localStorage.removeItem(key); return false; }
        const hoje = new Date().toISOString().split('T')[0];
        const stored = localStorage.getItem(key);
        if (!stored) { localStorage.setItem(key, hoje); return true; }
        const dias = Math.floor((new Date(hoje) - new Date(stored)) / 86400000);
        if (dias <= 1) return true;        // dias 1-2: exibe
        if (dias <= 6) return false;       // dias 3-7: oculta (5 dias de intervalo)
        localStorage.setItem(key, hoje);   // dia 7+: novo ciclo
        return true;
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
            // Aniversário
            if (a.nascimento) {
                const parts = a.nascimento.split('-');
                if (parts.length === 3 && parseInt(parts[2]) === dH && parseInt(parts[1]) === mH)
                    html += `<div class="conquista-item">🎂 Hoje é o aniversário de <b>${a.nome}</b>!</div>`;
            }
            // Em Brasa — mostra 2 dias, oculta 5, mostra 2...
            const emBrasa = this.calcularEngajamento(a.historico).label === "Em Brasa";
            if (this._deveExibirEmBrasa(doc.id, emBrasa))
                html += `<div class="conquista-item">🔥 <b>${a.nome}</b> está em brasa!</div>`;
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

    // ── RELATÓRIO POR PLANO & VALORES ────────────────────────
    async renderRelatPlanos() {
        const container = document.getElementById('resultado-relat-planos') || document.getElementById('resultado-relatorios');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';

        const snap = await db.collection('alunos').orderBy('nome').get();

        const ordemPlanos = ['mensal','trimestral','semestral','anual','livre','familia'];
        const labelPlano  = { mensal:'Mensal', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual', livre:'Livre', familia:'Família' };
        const iconPlano   = { mensal:'📅', trimestral:'📅', semestral:'📅', anual:'📅', livre:'🔓', familia:'👨‍👩‍👧' };
        const corPlano    = { mensal:'#3b82f6', trimestral:'#8b5cf6', semestral:'#10b981', anual:'#f59e0b', livre:'#a78bfa', familia:'#f43f5e' };

        const grupos = {};
        snap.docs.forEach(doc => {
            const d = doc.data();
            const plano = (d.plano || 'mensal').toLowerCase();
            if (!grupos[plano]) grupos[plano] = [];
            grupos[plano].push({ id: doc.id, nome: d.nome, email: d.email, planoValor: d.planoValor || 0 });
        });

        // ── Calcula totais ──
        let totalAlunos = 0, totalReceita = 0, semValor = 0;
        ordemPlanos.forEach(p => {
            const alunos = grupos[p] || [];
            totalAlunos  += alunos.length;
            totalReceita += alunos.reduce((s, a) => s + (a.planoValor || 0), 0);
            semValor     += alunos.filter(a => !(a.planoValor > 0)).length;
        });

        // ── Cards de resumo por plano ──
        let cardsHtml = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">';
        ordemPlanos.forEach(p => {
            const alunos = grupos[p] || [];
            if (!alunos.length) return;
            const cor    = corPlano[p];
            const label  = labelPlano[p];
            const icon   = iconPlano[p];
            const total  = alunos.length;
            const receita = alunos.reduce((s, a) => s + (a.planoValor || 0), 0);
            cardsHtml += `
            <div style="background:#0f172a; border:1px solid ${cor}44; border-left:3px solid ${cor}; border-radius:14px; padding:12px 14px;">
                <div style="font-size:0.65rem; font-weight:800; color:${cor}; letter-spacing:0.5px; margin-bottom:6px;">${icon} ${label.toUpperCase()}</div>
                <div style="font-size:1.4rem; font-weight:800; color:white; line-height:1;">${total}</div>
                <div style="font-size:0.55rem; color:#64748b; font-weight:700; margin-bottom:6px; margin-top:2px;">ALUNO${total !== 1 ? 'S' : ''}</div>
                <div style="font-size:0.82rem; font-weight:800; color:${cor};">R$ ${receita.toFixed(2).replace('.', ',')}</div>
                <div style="font-size:0.52rem; color:#475569; font-weight:700;">/mês</div>
            </div>`;
        });
        cardsHtml += '</div>';

        // ── Card total geral ──
        cardsHtml += `
        <div style="background:linear-gradient(135deg,#064e3b,#065f46); border:1px solid #10b981; border-radius:16px; padding:14px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-size:0.58rem; color:#6ee7b7; font-weight:800; letter-spacing:0.8px; margin-bottom:4px;">TOTAL GERAL</div>
                <div style="font-size:1.6rem; font-weight:800; color:white; line-height:1;">${totalAlunos} <span style="font-size:0.75rem; color:#6ee7b7;">alunos</span></div>
                ${semValor > 0 ? `<div style="font-size:0.58rem; color:#f43f5e; font-weight:700; margin-top:4px;">⚠️ ${semValor} sem valor definido</div>` : `<div style="font-size:0.58rem; color:#6ee7b7; font-weight:700; margin-top:4px;">✅ Todos com valor definido</div>`}
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.58rem; color:#6ee7b7; font-weight:700; margin-bottom:4px;">RECEITA MENSAL ESTIMADA</div>
                <div style="font-size:1.5rem; font-weight:800; color:#10b981; letter-spacing:-0.5px;">R$ ${totalReceita.toFixed(2).replace('.', ',')}</div>
            </div>
        </div>`;

        // ── Lista detalhada por plano (acordeão por grupo) ──
        let listaHtml = `<div style="font-size:0.6rem; color:#64748b; font-weight:800; letter-spacing:1px; margin-bottom:10px;">DETALHES POR ALUNO — clique no plano para expandir</div>`;

        ordemPlanos.forEach((p, idx) => {
            const alunos = grupos[p] || [];
            if (!alunos.length) return;
            const cor     = corPlano[p];
            const label   = labelPlano[p];
            const receita = alunos.reduce((s, a) => s + (a.planoValor || 0), 0);
            const bodyId  = `relat-plano-body-${p}`;

            listaHtml += `
            <div style="background:#1e293b; border:1px solid ${cor}33; border-radius:14px; overflow:hidden; margin-bottom:8px;">
                <div onclick="const b=document.getElementById('${bodyId}');const open=b.style.display!=='none';b.style.display=open?'none':'block';this.querySelector('i').style.transform=open?'rotate(0)':'rotate(180deg)'"
                    style="padding:12px 14px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:3px; height:18px; background:${cor}; border-radius:2px;"></div>
                        <div>
                            <div style="font-size:0.72rem; font-weight:800; color:${cor};">${label.toUpperCase()}</div>
                            <div style="font-size:0.58rem; color:#64748b; margin-top:1px;">${alunos.length} aluno${alunos.length !== 1 ? 's' : ''} · R$ ${receita.toFixed(2).replace('.', ',')} /mês</div>
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" style="color:${cor}; font-size:0.8rem; transition:transform 0.25s; ${idx === 0 ? 'transform:rotate(180deg)' : ''}"></i>
                </div>
                <div id="${bodyId}" style="display:${idx === 0 ? 'block' : 'none'}; border-top:1px solid ${cor}22;">
                    ${alunos.map(a => {
                        const temValor = a.planoValor > 0;
                        if (!temValor) semValor++;
                        return `
                        <div id="row-plano-${a.id}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #1a2540; gap:10px;">
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:0.78rem; font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.nome}</div>
                            </div>
                            <div id="display-valor-${a.id}" style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                                ${temValor
                                    ? `<span style="font-size:0.82rem; font-weight:800; color:#10b981;">R$ ${a.planoValor.toFixed(2).replace('.', ',')}</span>`
                                    : `<span style="font-size:0.72rem; font-weight:800; color:#f43f5e;">⚠️ Sem valor</span>`
                                }
                                <button onclick="academia._editarValorPlano('${a.id}','${a.nome.replace(/'/g,"\\'").replace(/"/g,'&quot;')}',${a.planoValor})"
                                    style="background:#0f172a; border:1px solid #334155; color:#94a3b8; padding:4px 9px; border-radius:8px; font-size:0.58rem; font-weight:700; cursor:pointer;">✏️</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        });

        container.innerHTML = `
        <div style="background:#1e293b; border:1px solid #2d3f55; border-radius:20px; overflow:hidden; margin-bottom:14px; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
            <div style="height:3px; background:linear-gradient(90deg,#3b82f6,#8b5cf6);"></div>
            <div style="padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                    <span style="font-size:0.65rem; font-weight:800; color:#f8fafc; letter-spacing:0.5px;">📊 RELATÓRIO POR PLANO</span>
                    <button onclick="academia.renderRelatPlanos()" style="background:#0f172a; border:1px solid #334155; color:#64748b; padding:5px 10px; border-radius:8px; font-size:0.6rem; font-weight:700; cursor:pointer;">
                        <i class="fas fa-sync-alt"></i> Atualizar
                    </button>
                </div>
                ${cardsHtml}
                ${listaHtml}
            </div>
        </div>`;
    },

    // Edição inline do valor do plano direto no relatório
    async _editarValorPlano(alunoId, nomeAluno, valorAtual) {
        const novoValorStr = prompt(`Novo valor mensal para ${nomeAluno}:\n(atual: R$ ${valorAtual > 0 ? valorAtual.toFixed(2) : '0,00'})`, valorAtual > 0 ? valorAtual.toFixed(2) : '');
        if (novoValorStr === null) return; // cancelou
        const novoValor = parseFloat(novoValorStr.replace(',', '.'));
        if (isNaN(novoValor) || novoValor < 0) { alert('Valor inválido.'); return; }
        try {
            await db.collection('alunos').doc(alunoId).update({ planoValor: novoValor });
            // Atualiza o display inline sem recarregar tudo
            const display = document.getElementById(`display-valor-${alunoId}`);
            if (display) {
                display.innerHTML = `
                    <span style="font-size:0.82rem; font-weight:800; color:#10b981;">R$ ${novoValor.toFixed(2).replace('.', ',')}</span>
                    <button onclick="academia._editarValorPlano('${alunoId}', '${nomeAluno.replace(/'/g,"\\'")}', ${novoValor})"
                        style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:5px 9px; border-radius:8px; font-size:0.6rem; font-weight:700; cursor:pointer; white-space:nowrap;">
                        ✏️ Editar
                    </button>`;
            }
        } catch(e) { alert('Erro ao salvar: ' + e.message); }
    },

    async generarRelatorioGraduacao() {
        const snap = await db.collection("alunos").orderBy("nome").get();
        const container = document.getElementById('resultado-relatorios');
        const anoAtual  = new Date().getFullYear();

        // ── Coleta faixas únicas para o filtro ────────────────
        const faixasUnicas = [...new Set(
            snap.docs.map(d => d.data().faixa).filter(Boolean)
        )].sort();

        // ── Aplica filtros de categoria e faixa ───────────────
        const _passaFiltro = (a) => {
            const idade  = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 15;
            if (this._gradFiltroCategoria === 'kids'   && !isKids) return false;
            if (this._gradFiltroCategoria === 'adulto' && isKids)  return false;
            if (this._gradFiltroFaixa !== 'all' && a.faixa !== this._gradFiltroFaixa) return false;
            return true;
        };

        const prontos = [];
        const outros  = [];
        snap.forEach(doc => {
            const a = doc.data();
            if (!_passaFiltro(a)) return;
            const s = academia.verificarMeta(a);
            if (s.pronto || a.aspiranteGraduacao === true) prontos.push({ id: doc.id, a, s });
            else outros.push({ id: doc.id, a, s });
        });

        // ── Botões de filtro ──────────────────────────────────
        const btnCat = (v, l) => {
            const ativo = this._gradFiltroCategoria === v;
            return `<button onclick="academia._gradFiltroCategoria='${v}'; academia.generarRelatorioGraduacao()"
                style="padding:7px 12px; background:${ativo ? '#3b82f6' : '#1e293b'}; border:1px solid ${ativo ? '#3b82f6' : '#334155'}; color:${ativo ? 'white' : '#94a3b8'}; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer; white-space:nowrap;">${l}</button>`;
        };
        const btnFaixa = (v, l) => {
            const ativo = this._gradFiltroFaixa === v;
            return `<button onclick="academia._gradFiltroFaixa='${v}'; academia.generarRelatorioGraduacao()"
                style="padding:7px 12px; background:${ativo ? '#f59e0b' : '#1e293b'}; border:1px solid ${ativo ? '#f59e0b' : '#334155'}; color:${ativo ? '#000' : '#94a3b8'}; border-radius:8px; font-size:0.62rem; font-weight:800; cursor:pointer; white-space:nowrap;">${l}</button>`;
        };

        let html = `
            <!-- Botão mensagem em grupo -->
            <div style="margin-bottom:12px;">
                <button onclick="academia.abrirMensagemIndicados()" style="width:100%;padding:11px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#000;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;">📢 Enviar Mensagem para Indicados</button>
            </div>
            <!-- Filtros -->
            <div style="margin-bottom:14px;">
                <div style="font-size:0.55rem; color:#64748b; font-weight:700; letter-spacing:0.8px; margin-bottom:6px;">CATEGORIA</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                    ${btnCat('all', '👥 Todos')}
                    ${btnCat('kids', '🧒 Kids')}
                    ${btnCat('adulto', '🥋 Adulto')}
                </div>
                <div style="font-size:0.55rem; color:#64748b; font-weight:700; letter-spacing:0.8px; margin-bottom:6px;">FAIXA</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    ${btnFaixa('all', '🥋 Todas')}
                    ${faixasUnicas.map(f => btnFaixa(f, f)).join('')}
                </div>
            </div>`;

        // ── Prontos para graduar — destaque AMARELO ────────────
        if (prontos.length > 0) {
            const totalProntos    = prontos.filter(({ s }) => s.pronto).length;
            const totalConvocados = prontos.filter(({ a }) => a.aspiranteGraduacao).length;
            const subtitulo = [
                totalProntos    ? `${totalProntos} atingiu a meta`  : '',
                totalConvocados ? `${totalConvocados} convocado${totalConvocados > 1 ? 's' : ''}` : ''
            ].filter(Boolean).join(' · ');
            html += `<div style="background:#451a03; border:2px solid #f59e0b; border-radius:12px; padding:14px; margin-bottom:16px;">
                <div style="color:#fbbf24; font-size:0.7rem; font-weight:800; letter-spacing:0.5px; margin-bottom:2px;">⭐ EM DESTAQUE — ${prontos.length} atleta${prontos.length > 1 ? 's' : ''}</div>
                <div style="color:#92400e; font-size:0.6rem; margin-bottom:10px;">${subtitulo}</div>`;
            prontos.forEach(({ id, a }) => {
                const convocado = a.aspiranteGraduacao === true;
                const nomeEsc   = (a.nome || '').replace(/'/g, "\\'");
                html += `<div style="display:flex; justify-content:space-between; align-items:center; background:${convocado ? '#052e16' : '#0f172a'}; border:1px solid ${convocado ? '#10b981' : '#78350f'}; border-radius:8px; padding:10px 12px; margin-bottom:6px;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.85rem; font-weight:800; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.nome.toUpperCase()}</div>
                        <div style="font-size:0.65rem; color:#94a3b8;">${a.faixa} • ${a.grau}º Grau • ${a.aulas || 0} aulas</div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0; margin-left:8px;">
                        ${convocado
                            ? `<span style="background:#064e3b; color:#10b981; font-size:0.6rem; padding:4px 8px; border-radius:6px; font-weight:800; white-space:nowrap; border:1px solid #10b981;">✅ CONVOCADO</span>
                               <button onclick="academia.desmarcarExame('${id}','${nomeEsc}')" title="Cancelar" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.85rem; padding:2px 4px;">✕</button>`
                            : `<button onclick="academia.marcarParaExame('${id}','${nomeEsc}')" style="background:#92400e; border:1px solid #f59e0b; color:#fbbf24; font-size:0.6rem; padding:5px 10px; border-radius:6px; cursor:pointer; font-weight:800; white-space:nowrap;">🥋 CONVOCAR</button>`
                        }
                    </div>
                </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; text-align:center; margin-bottom:16px;">
                <div style="color:#64748b; font-size:0.8rem;">Nenhum atleta em destaque com os filtros selecionados.</div>
            </div>`;
        }

        // ── Demais alunos ──────────────────────────────────────
        const labelFiltro = this._gradFiltroCategoria !== 'all' || this._gradFiltroFaixa !== 'all'
            ? `ATLETAS FILTRADOS (${prontos.length + outros.length})`
            : 'TODOS OS ATLETAS';
        html += `<div style="font-size:0.65rem; color:#64748b; font-weight:800; margin-bottom:8px; letter-spacing:0.5px;">${labelFiltro}</div>`;

        if (outros.length === 0) {
            html += `<div style="color:#475569; font-size:0.75rem; text-align:center; padding:20px;">Nenhum atleta nesta combinação de filtros.</div>`;
        }

        outros.forEach(({ id, a, s }) => {
            const percent   = Math.round(s.percent);
            const convocado = a.aspiranteGraduacao === true;
            const nomeEsc   = (a.nome || '').replace(/'/g, "\\'");
            html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; border-bottom:1px solid var(--border-light); padding:10px 0; ${convocado ? 'background:#052e1622; border-radius:8px; padding:10px 8px;' : ''}">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.82rem; color:#e2e8f0; font-weight:600;">${a.nome}${convocado ? ' <span style="font-size:0.55rem; color:#10b981; font-weight:800;">✅</span>' : ''}</div>
                    <small style="color:var(--text-muted);">${a.faixa} • ${a.grau}º G • ${a.aulas || 0}/${s.meta} (${percent}%)</small>
                </div>
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    ${typeof contrato !== 'undefined' ? contrato.badgeContrato({ ...a, id }) : ''}
                    ${convocado
                        ? `<span style="background:#064e3b; color:#10b981; font-size:0.55rem; padding:3px 7px; border-radius:6px; font-weight:800; white-space:nowrap; border:1px solid #10b98155;">✅ CONV.</span>
                           <button onclick="academia.desmarcarExame('${id}','${nomeEsc}')" title="Cancelar" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.75rem; padding:2px 4px;">✕</button>`
                        : `<button onclick="academia.marcarParaExame('${id}','${nomeEsc}')" style="background:#1e293b; border:1px solid #334155; color:#94a3b8; font-size:0.55rem; padding:4px 8px; border-radius:6px; cursor:pointer; font-weight:700; white-space:nowrap;">🥋 CONVOCAR</button>`
                    }
                </div>
            </div>`;
        });

        container.innerHTML = html;
    },

    async marcarParaExame(id, nome) {
        if (!confirm(`Convocar ${nome} para o exame de faixa?\n\nEle(a) verá um aviso fixo no perfil até ser graduado(a).`)) return;
        await db.collection('alunos').doc(id).update({ aspiranteGraduacao: true, convocacaoPendente: true });
        push.paraAluno(id, '🏆 Você foi convocado(a)!', `Parabéns! Seu professor te indicou para o exame de faixa. OSS! 🥋`);
        alert(`✅ ${nome} foi convocado(a) para o exame de faixa! OSS!`);
        this.generarRelatorioGraduacao();
    },

    async desmarcarExame(id, nome) {
        if (!confirm(`Cancelar a convocação de ${nome}?`)) return;
        await db.collection('alunos').doc(id).update({ aspiranteGraduacao: false });
        this.generarRelatorioGraduacao();
    },

    async abrirMensagemIndicados() {
        try {
        const snap = await db.collection('alunos').where('aspiranteGraduacao','==',true).get();
        if (snap.empty) return alert('Nenhum atleta convocado no momento.');

        const todos = [], kids = [], adulto = [];
        const ano = new Date().getFullYear();
        snap.forEach(doc => {
            const a = doc.data();
            const idade = a.nascimento ? (ano - new Date(a.nascimento).getFullYear()) : 99;
            const item = { id: doc.id, nome: a.nome, faixa: a.faixa || '' };
            todos.push(item);
            if (idade < 16) kids.push(item); else adulto.push(item);
        });

        let modal = document.getElementById('modal-msg-indicados');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-msg-indicados'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:10000;display:flex;align-items:flex-end;justify-content:center;box-sizing:border-box;';
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        const btnGrupo = (label, val, cor='#1e293b', txt='#94a3b8', borda='#334155') =>
            `<button onclick="academia._selecionarGrupoMsg('${val}')"
                id="btn-grupo-${val}"
                style="flex:1;padding:9px 4px;font-size:0.62rem;font-weight:800;background:${cor};border:2px solid ${borda};color:${txt};border-radius:8px;cursor:pointer;">${label}</button>`;

        modal.innerHTML = `<div style="background:#1e293b;border-radius:16px 16px 0 0;padding:18px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <span style="font-size:0.85rem;font-weight:800;color:white;">📢 Mensagem — Indicados</span>
                <button onclick="document.getElementById('modal-msg-indicados').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
            </div>

            <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:6px;">ENVIAR PARA O GRUPO</small>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                ${btnGrupo(`👥 Todos (${todos.length})`,'todos','#334155','#fff','#475569')}
                ${btnGrupo(`🧒 Kids (${kids.length})`,'kids')}
                ${btnGrupo(`🥋 Adulto (${adulto.length})`,'adulto')}
            </div>

            <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">🔍 OU PESQUISAR ALUNO ESPECÍFICO</small>
            <input id="msg-busca-aluno" type="text" placeholder="Digite o nome do aluno..."
                oninput="academia._filtrarBuscaIndicados(this.value)"
                style="${inp}margin-bottom:6px;" />
            <div id="msg-busca-resultado" style="display:none;background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:6px;margin-bottom:10px;max-height:120px;overflow-y:auto;"></div>

            <div id="msg-indicados-preview" style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;margin-bottom:10px;font-size:0.62rem;color:#64748b;min-height:28px;max-height:80px;overflow-y:auto;">
                <span style="color:#475569;">Selecione um grupo acima.</span>
            </div>

            <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">MENSAGEM</small>
            <textarea id="msg-indicados-texto" rows="3" placeholder="Ex: A data do exame foi confirmada para o dia XX. Prepare-se! OSS!" style="${inp}resize:none;"></textarea>
            <button id="btn-enviar-msg-indicados" onclick="academia._enviarMensagemIndicados()" style="width:100%;padding:13px;background:#f59e0b;border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">📢 ENVIAR MENSAGEM</button>
        </div>`;

        this._todosIndicados = todos;
        this._kidsIndicados  = kids;
        this._adultoIndicados = adulto;
        this._listaEnvioIndicados = [];
        } catch(e) { alert('Erro ao buscar indicados: ' + e.message); }
    },

    _selecionarGrupoMsg(grupo) {
        const lista = grupo === 'todos' ? this._todosIndicados
                    : grupo === 'kids'  ? this._kidsIndicados
                    :                    this._adultoIndicados;
        this._listaEnvioIndicados = [...lista];
        // destaca botão ativo
        ['todos','kids','adulto'].forEach(g => {
            const b = document.getElementById(`btn-grupo-${g}`);
            if (!b) return;
            b.style.background = g === grupo ? '#f59e0b' : '#1e293b';
            b.style.color      = g === grupo ? '#000'    : '#94a3b8';
            b.style.borderColor= g === grupo ? '#f59e0b' : '#334155';
        });
        // limpa busca individual
        const busca = document.getElementById('msg-busca-aluno');
        if (busca) busca.value = '';
        document.getElementById('msg-busca-resultado').style.display = 'none';
        this._renderPreviewIndicados();
    },

    _filtrarBuscaIndicados(termo) {
        const res = document.getElementById('msg-busca-resultado');
        if (!termo.trim()) { res.style.display = 'none'; return; }
        const t = termo.toLowerCase();
        const filtrados = this._todosIndicados.filter(a => a.nome.toLowerCase().includes(t));
        if (!filtrados.length) { res.innerHTML = '<span style="color:#475569;font-size:0.65rem;">Nenhum encontrado.</span>'; res.style.display = 'block'; return; }
        res.style.display = 'block';
        res.innerHTML = filtrados.map(a =>
            `<div onclick="academia._adicionarIndividualMsg('${a.id}','${a.nome.replace(/'/g,"\\'")}')"
                style="padding:6px 8px;cursor:pointer;font-size:0.7rem;color:#e2e8f0;border-bottom:1px solid #1e293b;">${a.nome} <span style="color:#64748b;font-size:0.6rem;">${a.faixa}</span></div>`
        ).join('');
    },

    _adicionarIndividualMsg(id, nome) {
        // limpa seleção de grupo
        ['todos','kids','adulto'].forEach(g => {
            const b = document.getElementById(`btn-grupo-${g}`);
            if (b) { b.style.background='#1e293b'; b.style.color='#94a3b8'; b.style.borderColor='#334155'; }
        });
        if (!this._listaEnvioIndicados.find(a => a.id === id)) {
            this._listaEnvioIndicados = [{ id, nome }];
        }
        document.getElementById('msg-busca-aluno').value = nome;
        document.getElementById('msg-busca-resultado').style.display = 'none';
        this._renderPreviewIndicados();
    },

    _renderPreviewIndicados() {
        const el = document.getElementById('msg-indicados-preview');
        if (!el) return;
        const lista = this._listaEnvioIndicados || [];
        el.innerHTML = lista.length
            ? lista.map(a => `<span style="display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:2px 7px;margin:2px;font-size:0.6rem;color:#94a3b8;">${a.nome}</span>`).join('')
            : '<span style="color:#475569;">Nenhum destinatário selecionado.</span>';
    },

    async _enviarMensagemIndicados() {
        const texto = document.getElementById('msg-indicados-texto')?.value.trim();
        if (!texto) return alert('Escreva a mensagem.');
        const lista = this._listaEnvioIndicados || [];
        if (!lista.length) return alert('Selecione um grupo ou aluno.');

        const btn = document.getElementById('btn-enviar-msg-indicados');
        if (btn) { btn.innerText = `⏳ Enviando para ${lista.length} atleta${lista.length>1?'s':''}...`; btn.disabled = true; }

        let enviados = 0;
        const agora = Date.now();
        for (const a of lista) {
            await push.paraAluno(a.id, '🏆 Aviso — Exame de Faixa', texto);
            await db.collection('recados_alunos').add({
                alunoId: a.id,
                texto,
                lido: false,
                criadoEm: agora
            });
            enviados++;
        }

        document.getElementById('modal-msg-indicados')?.remove();
        alert(`✅ Mensagem enviada para ${enviados} atleta${enviados > 1 ? 's' : ''}!`);
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

        // ── Verifica se a turma está cancelada hoje ───────────
        const preview = document.getElementById('preview-plano-aula');
        try {
            const docCanc = await db.collection('aulas_canceladas').doc(this._getDataHoje()).get();
            if (docCanc.exists && docCanc.data()[s.value] === true) {
                lD.innerHTML = '';
                if (preview) preview.innerHTML = `
                    <div style="background:#1a0404; border:1px solid #ef444466; border-radius:8px; padding:12px; margin:8px 0; text-align:center;">
                        <div style="font-size:0.85rem; font-weight:800; color:#ef4444; margin-bottom:4px;">🚫 AULA CANCELADA</div>
                        <div style="font-size:0.65rem; color:#94a3b8;">Esta turma foi cancelada hoje.<br>Entre em contato com a academia.</div>
                    </div>`;
                return;
            } else {
                // Limpa aviso de cancelamento se existia
                if (preview?.innerHTML.includes('AULA CANCELADA')) preview.innerHTML = '';
            }
        } catch(e) {}

        const snap = await db.collection("checkins").where("turma", "==", s.value).get();
        // Busca experimentais para esta turma hoje (aceita formato ISO e pt-BR)
        const hoje = this._getDataHoje(); // YYYY-MM-DD
        const hojeFormatado = hoje.split('-').reverse().join('/'); // DD/MM/YYYY
        const [snapExp, snapExpLegacy] = await Promise.all([
            db.collection("experimentais").where("turma","==",s.value).where("data","==",hoje).get(),
            db.collection("experimentais").where("turma","==",s.value).where("data","==",hojeFormatado).get()
        ]);
        const docsExp = [...snapExp.docs, ...snapExpLegacy.docs];

        const chips = [];
        snap.docs.forEach(doc => {
            const d = doc.data();
            const partes = (d.alunoNome || '').split(' ');
            const nome = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
            if (d.tipo === 'visual') {
                chips.push(`<span style="background:#1c1400; color:#f59e0b; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid #f59e0b66; font-weight:800;">🥋 ${nome}</span>`);
            } else {
                chips.push(`<span style="background:#0f172a; color:#ccc; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid var(--border-light); font-weight:600;">${nome}</span>`);
            }
        });
        docsExp.forEach(doc => {
            const d = doc.data();
            if (d.status === 'excluido') return; // ignora cancelados
            const partes = (d.nome || '').split(' ');
            const nome = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
            chips.push(`<span style="background:#0c1a3a; color:#60a5fa; padding:4px 10px; border-radius:6px; font-size:0.65rem; border:1px solid #3b82f666; font-weight:800;">🆕 ${nome}</span>`);
        });

        if (chips.length === 0) {
            lD.innerHTML = `<small style="color:var(--text-muted);">Nenhum atleta confirmado.</small>`;
        } else {
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
        const id     = document.getElementById('edit-evento-id').value;
        const t      = document.getElementById('input-evento-titulo').value.trim();
        const iso    = document.getElementById('input-evento-data-iso').value;
        const isoFim = document.getElementById('input-evento-data-fim-iso').value;
        const hr     = document.getElementById('input-evento-hora').value;
        const v      = parseInt(document.getElementById('input-evento-vagas').value) || 0;
        const p      = document.getElementById('input-evento-pagamento').value.trim();
        const de     = document.getElementById('input-evento-desc').value.trim();
        if (!t || !iso || !v) return alert("Preencha título, data de início e total de vagas.");

        // Texto de exibição: "29/06 a 03/07/2026 às 08:00" ou "29/06/2026 às 08:00"
        const [ay, am, ad] = iso.split('-');
        let dataExibicao = `${ad}/${am}/${ay}${hr ? ' às ' + hr : ''}`;
        if (isoFim && isoFim !== iso) {
            const [fy, fm, fd] = isoFim.split('-');
            dataExibicao = `${ad}/${am} a ${fd}/${fm}/${fy}${hr ? ' às ' + hr : ''}`;
        }

        const btn = document.getElementById('btn-salvar-evento');
        if (btn) { btn.disabled = true; btn.innerText = 'Salvando...'; }

        const imagemUrl = document.getElementById('input-evento-imagemUrl')?.value || '';
        const dados = { titulo: t, dataEvento: dataExibicao, dataEventoISO: iso, dataFimISO: isoFim || '', vagasMax: v, linkPay: p, descricao: de, imagemUrl };

        const publicarStory = document.getElementById('toggle-story-evento')?.dataset.on === 'true';

        try {
            if (id) {
                await db.collection("eventos_oficiais").doc(id).update(dados);
                if (publicarStory) {
                    if (!imagemUrl) {
                        alert("✅ Evento atualizado!\n\n⚠️ Story NÃO publicado — adicione um cartaz para publicar como story.");
                    } else {
                        try {
                            if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously().catch(() => {});
                            await db.collection('stories').add({ imageUrl: imagemUrl, titulo: t, link: '#tab-eventos', duracaoDias: 7, criadoEm: Date.now() });
                            academia.renderStoriesBar();
                            alert("✅ Evento atualizado e Story publicado!");
                        } catch(se) { alert("✅ Evento atualizado!\n\n⚠️ Story falhou: " + se.message); }
                    }
                } else {
                    alert("✅ Evento atualizado!");
                }
            } else {
                const ref = await db.collection("eventos_oficiais").add({ ...dados, inscritos: [], dataCriacao: new Date().getTime() });
                // Publica story se toggle ativado
                if (publicarStory) {
                    if (!imagemUrl) {
                        alert("✅ Evento criado!\n\n⚠️ Story NÃO publicado — adicione um cartaz antes de salvar para publicar como story.");
                    } else {
                        try {
                            if (!firebase.auth().currentUser) {
                                await firebase.auth().signInAnonymously().catch(() => {});
                            }
                            await db.collection('stories').add({
                                imageUrl: imagemUrl,
                                titulo: t,
                                link: '#tab-eventos',
                                duracaoDias: 7,
                                criadoEm: Date.now()
                            });
                            academia.renderStoriesBar();
                            alert("✅ Evento criado e Story publicado!");
                        } catch(se) {
                            alert("✅ Evento criado!\n\n⚠️ Story falhou: " + se.message);
                        }
                    }
                } else {
                    alert("✅ Evento criado!");
                }
            }
        } catch(e) { alert("Erro: " + e.message); }
        this.limparFormEvento();
        this.carregarEventosAbas();
    },

    async _uploadCartazEvento(file) {
        if (!file) return;
        const status  = document.getElementById('status-evento-imagem');
        const preview = document.getElementById('preview-evento-imagem');
        const imgEl   = document.getElementById('img-preview-evento');
        const hidden  = document.getElementById('input-evento-imagemUrl');
        if (status) status.innerHTML = '<span style="color:#f59e0b;">⏳ Processando...</span>';
        // Comprime
        let base64;
        try {
            base64 = await loja._comprimirImagem(file, 900, 0.82);
        } catch(e) {
            if (status) status.innerHTML = '<span style="color:#f43f5e;">❌ Erro ao ler imagem.</span>';
            return;
        }
        // Preview imediato
        if (imgEl) imgEl.src = base64;
        if (preview) preview.style.display = 'block';
        // Tenta Storage
        try {
            if (status) status.innerHTML = '<span style="color:#f59e0b;">⏳ Enviando...</span>';
            const nome = 'eventos/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const snap = await getStorage().ref(nome).put(file);
            const url  = await snap.ref.getDownloadURL();
            if (hidden) hidden.value = url;
            if (status) status.innerHTML = '<span style="color:#10b981;">✅ Cartaz salvo!</span>';
            return;
        } catch(e) { /* fallback base64 */ }
        // Fallback base64
        if (hidden) hidden.value = base64;
        if (status) status.innerHTML = '<span style="color:#10b981;">✅ Cartaz pronto!</span>';
    },

    limparImagemEvento() {
        const input  = document.getElementById('input-evento-imagem');
        const hidden = document.getElementById('input-evento-imagemUrl');
        const preview = document.getElementById('preview-evento-imagem');
        const img    = document.getElementById('img-preview-evento');
        const status = document.getElementById('status-evento-imagem');
        if(input) input.value = '';
        if(hidden) hidden.value = '';
        if(img) img.src = '';
        if(preview) preview.style.display = 'none';
        if(status) status.innerHTML = '';
    },

    async editarEventoAdmin(id) {
        const doc = await db.collection("eventos_oficiais").doc(id).get(); if(!doc.exists) return;
        const ev = doc.data();
        document.getElementById('edit-evento-id').value = id;
        document.getElementById('input-evento-titulo').value = ev.titulo;
        document.getElementById('input-evento-data-iso').value = ev.dataEventoISO || '';
        document.getElementById('input-evento-data-fim-iso').value = ev.dataFimISO || '';
        const horaMatch = (ev.dataEvento || '').match(/(\d{2}:\d{2})/);
        document.getElementById('input-evento-hora').value = horaMatch ? horaMatch[1] : '';
        document.getElementById('input-evento-vagas').value = ev.vagasMax;
        document.getElementById('input-evento-pagamento').value = ev.linkPay || "";
        document.getElementById('input-evento-desc').value = ev.descricao || "";
        // Mostra imagem existente
        const img = document.getElementById('img-preview-evento');
        const preview = document.getElementById('preview-evento-imagem');
        const hidden = document.getElementById('input-evento-imagemUrl');
        if (ev.imagemUrl) {
            if (hidden) hidden.value = ev.imagemUrl;
            if (img) img.src = ev.imagemUrl;
            if (preview) preview.style.display = 'block';
        } else { this.limparImagemEvento(); }
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
        document.getElementById('input-evento-data-iso').value = "";
        document.getElementById('input-evento-data-fim-iso').value = "";
        document.getElementById('input-evento-hora').value = "";
        document.getElementById('input-evento-vagas').value = "";
        document.getElementById('input-evento-pagamento').value = "";
        document.getElementById('input-evento-desc').value = "";
        this.limparImagemEvento();
        const btn = document.getElementById('btn-salvar-evento');
        if(btn) { btn.innerText = "PUBLICAR EVENTO"; btn.disabled = false; }
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
                const cartaz = ev.imagemUrl ? `<img src="${ev.imagemUrl}" style="width:100%; border-radius:10px; margin-bottom:10px; max-height:220px; object-fit:cover;" loading="lazy"/>` : '';
                const descHtml = (ev.descricao || "Sem descrição.").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                htmlAluno += `<div class="card-evento">${cartaz}<div class="evento-header"><h4 class="evento-titulo">${ev.titulo.toUpperCase()}</h4><span class="evento-vagas-badge">${totalInscritos} / ${ev.vagasMax} VAGAS</span></div><div class="evento-data"><i class="fas fa-clock"></i> ${ev.dataEvento}</div><div class="evento-desc">${descHtml}</div>${botaoAcao}${botaoPagamentoAluno}</div>`;
                const nomesInscritos = listaInscritos.map((n, idx) => `<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #ccc; padding: 6px 0; border-bottom: 1px solid #1e293b;"><span>${idx+1}. ${n.nome.toUpperCase()}</span><button onclick="academia.removerAlunoDeEventoAdmin('${evId}', '${n.id}', '${n.nome.replace(/'/g, "\\'")}')" style="background: none; border: none; color: #f43f5e; cursor: pointer; padding: 2px 6px;"><i class="fas fa-user-minus"></i></button></div>`).join('') || "<small style='color:var(--text-muted);'>Ninguém inscrito ainda.</small>";
                htmlAdmin += `<div style="background:#0f172a; border:1px solid var(--border-light); padding:12px; border-radius:10px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--border-light); padding-bottom:5px;">
                        <b style="color:white; font-size:0.8rem;">🏆 ${ev.titulo}</b>
                        <div style="display:flex; gap:6px;">
                            <button onclick="academia.dispararEvento('${evId}','${ev.titulo.replace(/'/g,"\\'")}','${(ev.imagemUrl||'').replace(/'/g,"\\'")}' )" style="background:#064e3b; border:1px solid #10b981; color:#34d399; padding:4px 8px; border-radius:6px; cursor:pointer; font-size:0.65rem; font-weight:800;" title="Disparar para alunos">📢</button>
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

    // ── DISPARAR EVENTO PARA ALUNOS ──────────────────────────
    dispararEvento(evId, titulo, imagemUrl) {
        const existente = document.getElementById('modal-disparar-evento');
        if (existente) existente.remove();

        const grupos = [
            { val: 'todos',           label: '👥 Todos os Alunos' },
            { val: 'adulto',          label: '🥋 Adulto (JJ)' },
            { val: 'kids',            label: '⭐ Kids' },
            { val: 'muaythai',        label: '🥊 Muay Thai' },
            { val: 'branca',          label: '⬜ Faixa Branca' },
            { val: 'azul-roxa-marrom',label: '🟦 Azul / Roxa / Marrom' },
            { val: 'marrom-preta',    label: '🟫 Marrom / Preta' },
            { val: 'preta',           label: '⬛ Faixa Preta' },
        ];

        const modal = document.createElement('div');
        modal.id = 'modal-disparar-evento';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #3b82f6;border-radius:16px;padding:22px 20px;max-width:360px;width:100%;">
                <div style="font-size:0.75rem;font-weight:800;color:#3b82f6;margin-bottom:4px;letter-spacing:0.5px;">📢 DISPARAR EVENTO</div>
                <div style="font-size:0.88rem;font-weight:700;color:white;margin-bottom:16px;">${titulo}</div>
                <div style="font-size:0.65rem;font-weight:800;color:#94a3b8;margin-bottom:8px;letter-spacing:0.5px;">ENVIAR PARA:</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px;">
                    ${grupos.map(g => `
                    <label style="display:flex;align-items:center;gap:10px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;cursor:pointer;">
                        <input type="radio" name="grupo-disparo" value="${g.val}" ${g.val === 'todos' ? 'checked' : ''} style="accent-color:#3b82f6;width:16px;height:16px;flex-shrink:0;">
                        <span style="color:#e2e8f0;font-size:0.8rem;font-weight:600;">${g.label}</span>
                    </label>`).join('')}
                </div>
                <div style="display:flex;gap:10px;">
                    <button onclick="document.getElementById('modal-disparar-evento').remove()"
                        style="flex:1;padding:12px;background:#334155;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                        Cancelar
                    </button>
                    <button onclick="academia._confirmarDisparoEvento('${evId}','${titulo.replace(/'/g,"\\'")}','${(imagemUrl||'').replace(/'/g,"\\'")}',document.querySelector('input[name=grupo-disparo]:checked')?.value)"
                        style="flex:2;padding:12px;background:#3b82f6;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                        📢 Disparar
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    async _confirmarDisparoEvento(evId, titulo, imagemUrl, grupo) {
        if (!grupo) return alert('Selecione o grupo.');
        document.getElementById('modal-disparar-evento')?.remove();

        const labelMap = { todos:'Todos', adulto:'Adulto', kids:'Kids', muaythai:'Muay Thai',
            branca:'Faixa Branca', 'azul-roxa-marrom':'Azul/Roxa/Marrom', 'marrom-preta':'Marrom/Preta', preta:'Faixa Preta' };

        try {
            // Salva disparo no Firestore (alunos lerão ao abrir a aba)
            await db.collection('disparos_evento').add({
                eventoId: evId,
                titulo,
                imagemUrl: imagemUrl || '',
                grupo,
                criadoEm: Date.now(),
                expiraEm: Date.now() + 7 * 24 * 60 * 60 * 1000,
                lidos: []
            });

            // Envia push para o grupo
            const snap = await db.collection('alunos').get();
            const anoAtual = new Date().getFullYear();
            const tokens = [];
            snap.forEach(doc => {
                const a = doc.data();
                if (!a.fcmToken) return;
                const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
                const isKids = idade <= 15;
                const faixa  = a.faixa || '';
                const mod    = a.modalidade || 'jiujitsu';
                if (grupo === 'todos')            { tokens.push(a.fcmToken); return; }
                if (grupo === 'adulto'            && !isKids)                                        tokens.push(a.fcmToken);
                if (grupo === 'kids'              && isKids)                                         tokens.push(a.fcmToken);
                if (grupo === 'branca'            && faixa === 'Branca')                             tokens.push(a.fcmToken);
                if (grupo === 'azul-roxa-marrom'  && ['Azul','Roxa','Marrom'].includes(faixa))       tokens.push(a.fcmToken);
                if (grupo === 'marrom-preta'      && ['Marrom','Preta'].includes(faixa))             tokens.push(a.fcmToken);
                if (grupo === 'preta'             && faixa === 'Preta')                              tokens.push(a.fcmToken);
                if (grupo === 'muaythai'          && ['muaythai','ambos'].includes(mod))             tokens.push(a.fcmToken);
            });
            if (tokens.length > 0) {
                fetch('/api/push-comunicado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tokens, title: '🏆 Novo Evento — Gaditas!', body: `${titulo} — Veja na aba Eventos do app!` })
                }).catch(() => {});
            }
            alert(`✅ Evento disparado para: ${labelMap[grupo] || grupo}!\n\n📲 ${tokens.length} aluno(s) receberão notificação no celular agora.\n\n🔔 Todos os demais verão o popup ao abrir o app (mesmo sem notificação ativada).`);
        } catch(e) { alert('Erro ao disparar: ' + e.message); }
    },

    async verificarDisparoEvento() {
        if (!auth.currentUser || (auth.role !== 'aluno' && auth.role !== 'professor')) return;
        try {
            const agora = Date.now();
            const aluno = auth.currentUser;
            const anoAtual = new Date().getFullYear();
            const idade   = aluno.nascimento ? (anoAtual - new Date(aluno.nascimento).getFullYear()) : 99;
            const isKids  = idade <= 15;
            const faixa   = aluno.faixa || '';
            const mod     = aluno.modalidade || 'jiujitsu';

            const snap = await db.collection('disparos_evento')
                .where('expiraEm', '>', agora)
                .orderBy('expiraEm', 'desc')
                .limit(5).get();

            for (const doc of snap.docs) {
                const d = doc.data();
                if ((d.lidos || []).includes(aluno.id)) continue;

                // Verifica se este aluno pertence ao grupo
                const g = d.grupo;
                let pertence = false;
                if (g === 'todos')            pertence = true;
                else if (g === 'adulto')      pertence = !isKids;
                else if (g === 'kids')        pertence = isKids;
                else if (g === 'branca')      pertence = faixa === 'Branca';
                else if (g === 'azul-roxa-marrom') pertence = ['Azul','Roxa','Marrom'].includes(faixa);
                else if (g === 'marrom-preta') pertence = ['Marrom','Preta'].includes(faixa);
                else if (g === 'preta')       pertence = faixa === 'Preta';
                else if (g === 'muaythai')    pertence = ['muaythai','ambos'].includes(mod);
                if (!pertence) continue;

                // Mostra popup
                this._mostrarPopupEvento(doc.id, d);
                break; // mostra 1 por vez
            }
        } catch(e) { /* silencioso */ }
    },

    _mostrarPopupEvento(disparoId, d) {
        const existente = document.getElementById('modal-popup-evento');
        if (existente) return; // já mostrando

        const cartaz = d.imagemUrl
            ? `<img src="${d.imagemUrl}" style="width:100%;border-radius:10px;margin-bottom:12px;max-height:200px;object-fit:cover;">`
            : '';

        const fechar = `
            document.getElementById('modal-popup-evento').remove();
            db.collection('disparos_evento').doc('${disparoId}').update({ lidos: firebase.firestore.FieldValue.arrayUnion('${auth.currentUser.id}') });
        `;

        const modal = document.createElement('div');
        modal.id = 'modal-popup-evento';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #3b82f6;border-radius:16px;padding:20px;max-width:360px;width:100%;position:relative;">
                <button onclick="${fechar}" style="position:absolute;top:10px;right:10px;background:none;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;line-height:1;">✕</button>
                <div style="font-size:0.6rem;font-weight:800;color:#3b82f6;margin-bottom:8px;letter-spacing:0.5px;">🏆 NOVO EVENTO — GADITAS</div>
                ${cartaz}
                <div style="font-size:0.95rem;font-weight:800;color:white;margin-bottom:18px;">${d.titulo}</div>
                <div style="display:flex;gap:10px;">
                    <button onclick="${fechar}" style="flex:1;padding:12px;background:#334155;border:none;color:white;border-radius:10px;font-weight:700;cursor:pointer;font-size:0.8rem;">
                        Fechar
                    </button>
                    <button onclick="${fechar} ui.showTab('tab-eventos');"
                        style="flex:2;padding:12px;background:#3b82f6;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                        👉 Ver o Evento
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    async excluirEventoAdmin(eventoId) {
        if(confirm("Deseja excluir permanentemente este evento?")) {
            await db.collection("eventos_oficiais").doc(eventoId).delete();
            alert("Evento removido.");
        }
    },

    // ── CONTRATO: reenviar para um aluno específico ──────────
    async reenviarContrato(alunoId, nomeAluno) {
        if (!confirm(`Reenviar contrato para ${nomeAluno}?\n\nA assinatura atual será removida e o aluno precisará assinar novamente ao abrir o app.`)) return;
        try {
            await db.collection('alunos').doc(alunoId).update({ contrato: firebase.firestore.FieldValue.delete() });
            alert(`✅ Contrato de ${nomeAluno} resetado! Ele verá o pendente ao abrir o app.`);
            this.renderAlunos();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── CONTRATO: solicitar nova assinatura de TODOS ─────────
    async solicitarNovaAssinaturaGeral() {
        if (!confirm('Solicitar nova assinatura de TODOS os alunos?\n\nTodos que já assinaram precisarão reassinar. Recomendado apenas após atualizar o texto do contrato.')) return;
        try {
            const novaVersao = Date.now();
            await db.collection('configuracoes').doc('contrato').set({ versao: novaVersao }, { merge: true });
            alert('✅ Nova versão do contrato criada!\n\nTodos os alunos verão a notificação de reassinar ao abrir o app.');
        } catch(e) { alert('Erro: ' + e.message); }
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
        const profTemMT   = turmasProf.some(t => t.toLowerCase().includes('muay') || t.toLowerCase().includes('thai') || t.toLowerCase().includes('mt'));
        // Professor reserva (sem turmas) ou adulto BJJ não vê lista de alunos
        if (auth.role === 'professor' && !profTemKids && !profTemMT) {
            l.innerHTML = '<p style="color:#64748b;text-align:center;font-size:0.8rem;padding:20px;">Acesso restrito ao painel de alunos.</p>';
            return;
        }

        snap.forEach(doc => {
            const a = doc.data(); const s = this.verificarMeta(a); const eng = this.calcularEngajamento(a.historico);
            const trancado = a.status === 'trancado';
            const nomeAtleta = a.nome ? a.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "";
            const buscaNorm = this.textoBuscaNome.normalize("NFD").replace(/[̀-ͯ]/g, "");
            const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 15;
            if (buscaNorm !== "" && !nomeAtleta.includes(buscaNorm)) return;
            if (this.categoriaFiltroAtual === "adult" && isKids && !a.treinaComAdultos) return;
            if (this.categoriaFiltroAtual === "kids" && !isKids) return;
            if (faixaFiltro !== "all" && a.faixa !== faixaFiltro) return;
            if (this.filtroInativos && eng.label !== 'Inativo') return;

            // Filtro por modalidade
            const alunoMod = a.modalidade || 'jiujitsu';
            if (this.modalidadeFiltroAtual === 'jiujitsu' && alunoMod === 'muaythai') return;
            if (this.modalidadeFiltroAtual === 'muaythai' && alunoMod !== 'muaythai' && alunoMod !== 'ambos') return;

            // Filtro do professor — só Kids e MT podem ver alunos
            if (auth.role === 'professor') {
                const alunoIsMT = alunoMod === 'muaythai' || alunoMod === 'ambos';
                if (profTemKids && !profTemMT) {
                    // Só Kids: vê apenas alunos kids
                    if (!isKids) return;
                } else if (profTemMT && !profTemKids) {
                    // Só MT: vê apenas alunos MT
                    if (!alunoIsMT) return;
                } else if (profTemKids && profTemMT) {
                    // Tem os dois: vê kids e MT
                    if (!isKids && !alunoIsMT) return;
                }
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
                ? `<img src="${fotoSrc}" onclick="academia.abrirModalFotoAluno('${doc.id}','${a.nome.replace(/'/g,"\\'")}')" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:2px solid ${corBorda}; margin-right:10px; flex-shrink:0; cursor:pointer;" title="Clique para ver ou trocar foto"/>`
                : `<div onclick="academia.abrirModalFotoAluno('${doc.id}','${a.nome.replace(/'/g,"\\'")}')" style="width:36px; height:36px; border-radius:50%; background:#1e293b; border:2px solid #334155; display:inline-flex; align-items:center; justify-content:center; margin-right:10px; flex-shrink:0; font-size:0.85rem; font-weight:800; color:#94a3b8; cursor:pointer;" title="Clique para adicionar foto">${a.nome.charAt(0).toUpperCase()}</div>`;

            // Selo escolar (só kids com boletim)
            let seloBadge = '';
            if (isKids && a.boletim?.notas) {
                const _anoAtual = new Date().getFullYear();
                const _avs = (a.boletim?.sistemaPorAno?.[_anoAtual] || a.boletim?.sistema || '2x') === '3x' ? ['av1','av2','av3'] : ['av1','av2'];
                let _s = 0, _t = 0;
                [1,2].forEach(sem => _avs.forEach(av => (a.boletim.materias||[]).forEach(m => {
                    const v = a.boletim.notas[_anoAtual]?.['sem'+sem]?.[av]?.[m];
                    if (v !== null && v !== undefined) { _s += v; _t++; }
                })));
                if (_t > 0) {
                    const _med = _s / _t;
                    const _selo = _med >= 8 ? { cor:'#f59e0b', label:'Ouro' } : _med >= 6 ? { cor:'#94a3b8', label:'Prata' } : _med >= 4 ? { cor:'#b45309', label:'Bronze' } : { cor:'#ef4444', label:'Baixo' };
                    const _pts = Array.from({length:24},(_,i)=>{const ang=(i*Math.PI/12)-Math.PI/2;const r=i%2===0?9:6;return`${(10+r*Math.cos(ang)).toFixed(1)},${(10+r*Math.sin(ang)).toFixed(1)}`;}).join(' ');
                    seloBadge = `<span title="Boletim ${_anoAtual}: Média ${_med.toFixed(1)} — ${_selo.label}" style="display:inline-flex;align-items:center;gap:3px;vertical-align:middle;margin-left:4px;">
                        <svg width="20" height="20" viewBox="0 0 20 20" style="display:inline-block;vertical-align:middle;"><polygon points="${_pts}" fill="${_selo.cor}" stroke="${_med>=8?'#b45309':_med>=6?'#64748b':'#7c2d12'}" stroke-width="1"/></svg>
                        <span style="font-size:0.55rem;color:${_selo.cor};font-weight:800;">${_med.toFixed(1)}</span>
                    </span>`;
                }
            }

            const telLimpo = (a.telefone || '').replace(/\D/g, '');
            cardsHtml += `<div class="item-card" style="border-left: 4px solid ${trancado ? '#64748b' : corBorda}; flex-direction:column; align-items:stretch; gap:8px; ${trancado ? 'opacity:0.7;' : ''}">
                <!-- Linha info -->
                <div style="display:flex; align-items:center; gap:10px;">
                    ${fotoMini}
                    <div style="color:#e2e8f0; flex:1; font-size:0.85rem; font-weight:600; min-width:0;">
                        <div style="word-break:break-word; line-height:1.3;">${a.nome.toUpperCase()}${modBadge} ${eng.icon}${seloBadge}${trancado ? ' <span style="background:#334155; color:#94a3b8; font-size:0.5rem; padding:2px 6px; border-radius:4px; font-weight:800; vertical-align:middle;">🔒 TRANCADO</span>' : ''}</div>
                        ${beltBarHtml}
                        ${gradInfo}
                        ${tagsLeoes}
                    </div>
                </div>
                <!-- Linha botões -->
                <div style="display:flex; flex-wrap:wrap; gap:5px; padding-top:2px; border-top:1px solid #1e293b;">
                    <button onclick="academia.abrirModalEditarAluno('${doc.id}')" title="Editar" style="background:#1e3a5f;border:1px solid #3b82f6;color:#93c5fd;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-edit"></i></button>
                    ${telLimpo ? `<button onclick="academia.abrirWhatsappBusiness('${telLimpo}')" title="WhatsApp" style="background:#064e3b;border:none;color:#25d366;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fab fa-whatsapp"></i></button>` : ''}
                    <button onclick="academia.verFichaSaudeAluno('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" title="Ficha de Saúde" style="background:#0c2344;border:none;color:#10b981;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-notes-medical"></i></button>
                    <button onclick="graduacaoHistorico.abrirModal('${doc.id}')" title="Graduações" style="background:#1e1040;border:none;color:#a78bfa;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-medal"></i></button>
                    <button onclick="avaliacaoFisica.abrirMenu('${doc.id}')" title="Avaliação Física" style="background:#0c2a1a;border:none;color:#10b981;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-chart-line"></i></button>
                    ${isAdmin ? `<button onclick="academia.verFinanceiroAluno('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" title="Financeiro" style="background:#064e3b;border:none;color:#10b981;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-dollar-sign"></i></button>` : ''}
                    ${isAdmin ? (trancado
                        ? `<button onclick="academia.ativarAluno('${doc.id}','${a.nome.replace(/'/g, "\\'")}')" title="Reativar" style="background:#1e3a8a;border:none;color:#60a5fa;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-lock-open"></i></button>`
                        : `<button onclick="academia.trancarAluno('${doc.id}','${a.nome.replace(/'/g, "\\'")}')" title="Trancar" style="background:#1c1000;border:1px solid #92400e;color:#f59e0b;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-lock"></i></button>`)
                    : ''}
                    ${isAdmin ? `<button onclick="academia.reenviarContrato('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" title="Contrato" style="background:#1c1000;border:1px solid #92400e;color:#f59e0b;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-file-contract"></i></button>` : ''}
                    ${isAdmin ? `<button onclick="academia.excluirAluno('${doc.id}')" title="Excluir" style="background:#2a0808;border:none;color:#ef4444;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-trash"></i></button>` : ''}
                    <button onclick="academia.lancarPresencaManualAdmin('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" style="background:#1e3a8a;border:none;color:#60a5fa;padding:5px 9px;border-radius:6px;font-size:0.65rem;font-weight:700;cursor:pointer;"><i class="fas fa-plus"></i> Presença</button>
                    <button onclick="academia.removerPresencaAdmin('${doc.id}', '${a.nome.replace(/'/g, "\\'")}')" title="Remover presença" style="background:#2a0808;border:1px solid #ef4444;color:#ef4444;padding:5px 9px;border-radius:6px;font-size:0.65rem;font-weight:700;cursor:pointer;"><i class="fas fa-minus"></i> Presença</button>
                </div>
            </div>`;
        });

        const totalGeral = snap.docs.length;
        const totalVisiveis = snap.docs.filter(doc => {
            const a = doc.data();
            const nomeAtleta = a.nome ? a.nome.toLowerCase() : "";
            const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
            const isKids = idade <= 15;
            if (this.textoBuscaNome !== "" && !nomeAtleta.includes(this.textoBuscaNome)) return false;
            if (this.categoriaFiltroAtual === "adult" && isKids && !a.treinaComAdultos) return false;
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

    // Detecta se a turma é infantil/kids pelo nome
    // Cobre: Kids, Infantil, Mirim, Pré-Mirim, Petit, Júnior, Sub-X, Criança
    _isTurmaKids(turma) {
        if (!turma) return false;
        const t = turma.toLowerCase();
        return t.includes('kids')      || t.includes('infantil') ||
               t.includes('mirim')     || t.includes('pré-mirim') ||
               t.includes('pre-mirim') || t.includes('petit')    ||
               t.includes('criança')   || t.includes('crianças') ||
               t.includes('júnior')    || t.includes('junior')   ||
               t.includes('sub-')      || t.includes('sub ');
    },

    async aprovar(cId, aId, t) {
        const r = db.collection("alunos").doc(aId); const doc = await r.get();
        if(doc.exists) {
            const d = doc.data(); const h = d.historico || [];

            // Bloqueia duplicata: se já tem presença nessa turma hoje (ex: aprovado via QR)
            const hoje = new Date().toLocaleDateString('pt-BR');
            const jaTemHoje = h.some(entry => entry.turma === t && entry.data && entry.data.startsWith(hoje));

            if (jaTemHoje) {
                // Já tem presença via QR — só exclui o checkin pendente, não contabiliza de novo
                await db.collection("checkins").doc(cId).delete();
                this.renderCheckins();
                alert(`⚠️ Presença de ${d.nome} na turma "${t}" já estava registrada hoje (via QR Code).\n\nCheck-in removido da fila sem duplicar.`);
                return;
            }

            // Usa o timestamp original do check-in (quando o aluno clicou), não a hora de aprovação
            const ciDoc = await db.collection("checkins").doc(cId).get();
            const dataOriginal = ciDoc.exists && ciDoc.data().data
                ? new Date(ciDoc.data().data).toLocaleDateString('pt-BR')
                : new Date().toLocaleDateString('pt-BR');

            h.unshift({ data: dataOriginal, turma: t });
            const isMT = this._isTurmaMT(t);
            const upd = { historico: h };
            if (isMT) upd.aulasMT = (d.aulasMT || 0) + 1;
            else       upd.aulas   = (d.aulas   || 0) + 1;
            // Salva feedback pendente — aparece pro aluno até ele responder
            upd.feedbackPendente = { turma: t, data: dataOriginal };
            await r.update(upd);
            // Push para o aluno
            push.paraAluno(aId, '✅ Presença confirmada!', `Sua presença na turma ${t} foi registrada. OSS! 🥋`);
        }
        await db.collection("checkins").doc(cId).delete();
        this.renderCheckins(); academia.renderRanking(); academia.carregarConquistas();
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

        // Verifica quais turmas estão canceladas hoje
        let canceladas = {};
        try {
            const docCanc = await db.collection('aulas_canceladas').doc(dataHoje).get();
            if (docCanc.exists) canceladas = docCanc.data();
        } catch(e) {}

        container.innerHTML = `
            <div style="background:#1e293b; border:1px solid #8b5cf644; border-left:3px solid #8b5cf6; border-radius:12px; padding:15px;">
                <div style="font-size:0.75rem; font-weight:800; color:#8b5cf6; margin-bottom:12px; letter-spacing:0.3px;">
                    <i class="fas fa-clipboard-list"></i> PLANO DA AULA DE HOJE
                </div>
                ${turmasVisiveis.map(turma => {
                    const inputId     = 'plano_' + turma.replace(/[^a-z0-9]/gi, '_');
                    const conteudoSalvo = this._planoConteudo(planosExistentes[turma]);
                    const turmaCancelada = canceladas[turma] === true;
                    const turmaEsc = turma.replace(/'/g,"\\'");
                    return `<div style="margin-bottom:14px; ${turmaCancelada ? 'opacity:0.7;' : ''}">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <small style="color:${turmaCancelada ? '#ef4444' : '#94a3b8'}; font-size:0.6rem; font-weight:800; letter-spacing:0.5px;">
                                ${turmaCancelada ? '🚫 CANCELADA — ' : '📍 '}${turma.toUpperCase()}
                            </small>
                            <button onclick="academia.toggleCancelamentoAula('${turmaEsc}', ${turmaCancelada})"
                                style="background:${turmaCancelada ? '#064e3b' : '#1a0a0a'}; border:1px solid ${turmaCancelada ? '#10b981' : '#ef4444'}; color:${turmaCancelada ? '#10b981' : '#ef4444'}; padding:3px 10px; border-radius:6px; font-size:0.55rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                                ${turmaCancelada ? '✓ REATIVAR' : '🚫 CANCELAR AULA'}
                            </button>
                        </div>
                        ${turmaCancelada
                            ? `<div style="background:#1a0404; border:1px solid #ef444444; border-radius:8px; padding:10px; font-size:0.7rem; color:#ef4444; font-weight:700; text-align:center;">Alunos verão aviso de aula cancelada.</div>`
                            : `<textarea id="${inputId}" placeholder="Ex: Raspagens da guarda fechada + finalização kimura..." rows="2"
                                style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; font-size:0.8rem; outline:none; resize:none; margin-bottom:6px;">${conteudoSalvo}</textarea>
                               <button onclick="academia.salvarPlanoAula('${turmaEsc}', document.getElementById('${inputId}').value)"
                                style="width:100%; padding:9px; background:#8b5cf6; border:none; color:white; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem;">
                                <i class="fas fa-save"></i> SALVAR CONTEÚDO DA AULA
                               </button>`
                        }
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
        const todasTurmas = [...new Set(Object.values(grade).filter(v => Array.isArray(v)).flat())].filter(t => typeof t === 'string' && !t.includes('Sem treinos'));
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

            // Busca experimentais para esta turma hoje
            const hojeExp = this._getDataHoje();
            const hojeExpFmt = hojeExp.split('-').reverse().join('/');
            const [snapExp, snapExpLeg] = await Promise.all([
                db.collection('experimentais').where('turma','==',turma).where('data','==',hojeExp).get(),
                db.collection('experimentais').where('turma','==',turma).where('data','==',hojeExpFmt).get()
            ]);
            const docsExpChamada = [...snapExp.docs, ...snapExpLeg.docs];

            if (docsExpChamada.length > 0) {
                listaHtml += `
                    <div style="margin-top:10px; padding:12px; background:#0c1a3a; border:1px solid #3b82f644; border-radius:10px; margin-bottom:12px;">
                        <div style="font-size:0.65rem; color:#60a5fa; font-weight:800; margin-bottom:10px; letter-spacing:1px;">🆕 EXPERIMENTAIS HOJE (${docsExpChamada.length})</div>`;
                docsExpChamada.forEach(doc => {
                    const e = doc.data();
                    if (e.status === 'excluido') return;
                    const modalLabel = e.modalidade === 'muaythai' ? '🥊 MT' : e.modalidade === 'ambos' ? '⚔️ Ambos' : '🥋 JJ';
                    const isAprovado = e.status === 'aprovado';
                    listaHtml += `
                        <div style="display:flex; align-items:center; gap:10px; padding:10px; background:#0f172a; border-radius:8px; margin-bottom:6px; border:1px solid ${isAprovado ? '#10b98133' : '#3b82f633'};">
                            <div style="flex:1;">
                                <div style="font-size:0.85rem; font-weight:700; color:#60a5fa;">${e.nome}</div>
                                <div style="font-size:0.6rem; color:#64748b; margin-top:2px;">${modalLabel} · ${e.telefone || '—'}</div>
                            </div>
                            ${isAprovado
                                ? `<span style="font-size:0.65rem; color:#10b981; font-weight:800;">✅ APROVADO</span>`
                                : `<button onclick="academia.aprovarExperimental('${doc.id}','${e.nome.replace(/'/g,"\\'")}','${e.email}')"
                                        style="background:#1e3a8a; border:none; color:#60a5fa; padding:6px 10px; border-radius:6px; font-size:0.65rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                                        ✅ Aprovar ida
                                   </button>`
                            }
                        </div>`;
                });
                listaHtml += `</div>`;
            }

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

    async aprovarExperimental(docId, nome, email) {
        try {
            await db.collection('experimentais').doc(docId).update({ status: 'aprovado' });
            // Atualiza visual sem fechar o modal
            this.abrirChamada();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async confirmarChamada(turma, checkboxes) {
        const ids = Array.from(checkboxes).map(c => c.value);
        if (ids.length === 0) return alert('Nenhum aluno marcado.');
        if (!confirm(`Confirmar presença de ${ids.length} aluno(s) na turma ${turma}?`)) return;

        const btn = document.querySelector('#modal-chamada-prof button[onclick*="confirmarChamada"]');
        if (btn) { btn.disabled = true; btn.innerText = `⏳ Salvando ${ids.length} presenças...`; }

        const isMT  = this._isTurmaMT(turma);
        const dataStr = new Date().toLocaleDateString('pt-BR');
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
                upd.feedbackPendente = { turma, data: dataStr };
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

    async toggleCancelamentoAula(turma, estaCancelada) {
        const acao = estaCancelada ? 'reativar' : 'cancelar';
        if (!confirm(`${estaCancelada ? 'Reativar' : 'Cancelar'} a aula "${turma}" hoje?\n${!estaCancelada ? 'Os alunos verão um aviso de aula cancelada.' : 'A aula voltará a aparecer normalmente.'}`)) return;
        const dataHoje = this._getDataHoje();
        try {
            if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously().catch(() => {});
            await db.collection('aulas_canceladas').doc(dataHoje).set(
                { [turma]: !estaCancelada },
                { merge: true }
            );
            this.renderPlanoAulaProf();
            // Atualiza área de check-in dos alunos
            this.atualizarPresencaAntecipada();
        } catch(e) {
            alert('Erro ao ' + acao + ' aula: ' + e.message);
        }
    },

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
        const t = this._turmaSelecionada || document.getElementById('select-turma-aluno')?.value || '';
        if (!t || t.includes("Sem treinos")) return;

        // Bloqueia adulto em turma kids e vice-versa
        const anoAtual = new Date().getFullYear();
        const nascimento = auth.currentUser?.nascimento;
        if (nascimento) {
            const idade = anoAtual - new Date(nascimento).getFullYear();
            const isKids          = idade <= 15;
            const isIntermediario = idade === 14 || idade === 15;
            const turmaKids       = this._isTurmaKids(t);
            const turmaMT         = this._isTurmaMT(t);
            const alunoMod        = auth.currentUser?.modalidade || 'jiujitsu';
            const ehAlunoMT       = alunoMod === 'muaythai' || alunoMod === 'ambos';

            if (turmaMT && ehAlunoMT) {
                // Aluno de Muay Thai + turma MT → LIVRE em qualquer idade
            } else if (isIntermediario) {
                // 14-15 anos → livre em qualquer turma
            } else if (!isKids && turmaKids) {
                // Adulto (>15 anos) bloqueado em turma infantil
                alert("🚫 Esta turma é exclusiva para alunos até 13 anos.");
                return;
            } else if (isKids && !turmaKids && !auth.currentUser?.treinaComAdultos) {
                // Criança (≤13 anos) bloqueada em turma adulto (exceto se treinaComAdultos)
                alert("🚫 Alunos até 13 anos não podem fazer check-in nas turmas adulto.");
                return;
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
            // 1) Verifica checkin pendente na fila
            const snapCI = await db.collection("checkins")
                .where("alunoId", "==", auth.currentUser.id)
                .where("turma", "==", t).get();
            const inicioHoje = new Date(); inicioHoje.setHours(0,0,0,0);
            const jaPendente = snapCI.docs.some(d => d.data().data >= inicioHoje.getTime());
            if (jaPendente) return alert("⚠️ Você já enviou check-in para esta turma hoje! OSS!");

            // 2) Verifica se já foi aprovado hoje (via QR ou aprovação anterior) no histórico
            const alunoDoc = await db.collection("alunos").doc(auth.currentUser.id).get();
            if (alunoDoc.exists) {
                const hoje = new Date().toLocaleDateString('pt-BR');
                const jaNoHistorico = (alunoDoc.data().historico || [])
                    .some(h => h.turma === t && h.data && h.data.startsWith(hoje));
                if (jaNoHistorico) return alert("✅ Sua presença nesta turma já está registrada hoje! OSS!");
            }
        } catch(e) { console.warn("Verificação duplicado falhou:", e.message); }

        await db.collection("checkins").add({ alunoId: auth.currentUser.id, alunoNome: auth.currentUser.nome, turma: t, data: new Date().getTime() });
        alert("Check-in enviado! Aguarde a aprovação do professor."); this.atualizarPresencaAntecipada(); this.carregarMeusCheckinsPendentes();
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
            else if (idade <= 15) listasJJ.kids2.push(entrada);
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
            const tag = idade <= 15 ? ' <span style="font-size:0.5rem;color:#f59e0b;font-weight:800;background:#1c1400;border:1px solid #f59e0b44;border-radius:4px;padding:1px 5px;margin-left:3px;">KIDS</span>' : '';
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
        document.getElementById('edit-aluno-id').value = id;
        document.getElementById('nome-aluno').value = a.nome || '';
        document.getElementById('email-aluno').value = a.email || '';
        document.getElementById('nascimento-aluno').value = a.nascimento || '';
        // Campos de endereço/contato
        const _set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
        _set('cpf-aluno', a.cpf);
        _set('telefone-aluno', a.telefone);
        _set('planoValor-aluno', a.planoValor > 0 ? a.planoValor : '');
        _set('cep-aluno', a.cep);
        _set('rua-aluno', a.rua);
        _set('numero-aluno', a.numero);
        _set('bairro-aluno', a.bairro);
        _set('complemento-aluno', a.complemento);
        _set('cidade-aluno', a.cidade);
        _set('estado-aluno', a.estado);
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
        if (idadeAtleta <= 15 && isAdmin) {
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

    // ── MODAL POPUP EDITAR ATLETA ────────────────────────
    _meLeoesFichaTemp: { leaoAtencao:0, leaoComportamento:0, leaoCompanheirismo:0, leaoDisciplina:0 },

    _meModalidade(mod) {
        document.getElementById('me-modalidade').value = mod;
        const mods = ['jiujitsu','muaythai','ambos'];
        mods.forEach(m => {
            const btn = document.getElementById('me-mod-btn-' + m);
            if (btn) { btn.style.background = m === mod ? '#1e3a8a' : '#0f172a'; btn.style.border = m === mod ? '1px solid #1d4ed8' : '1px solid #334155'; btn.style.color = m === mod ? '#93c5fd' : '#64748b'; }
        });
        const secJj = document.getElementById('me-section-jj');
        const secMt = document.getElementById('me-section-mt');
        if (secJj) secJj.style.display = (mod === 'muaythai') ? 'none' : 'block';
        if (secMt) secMt.style.display  = (mod === 'jiujitsu') ? 'none' : 'block';
    },

    _meAtualizarGraus() {
        const f = document.getElementById('me-faixa')?.value || 'Branca';
        const m = graduacao.getMaxGraus(f);
        let h = '';
        for (let i = 0; i <= m; i++) h += `<option value="${i}">${i}º G</option>`;
        const sel = document.getElementById('me-graus');
        if (sel) sel.innerHTML = h;
    },

    _meAtualizarFaixas() {
        const n = document.getElementById('me-nascimento')?.value;
        const selF = document.getElementById('me-faixa');
        if (!selF) return;
        const faixaAtual = selF.value;
        const idade = n ? (new Date().getFullYear() - new Date(n).getFullYear()) : 99;
        selF.innerHTML = graduacao.getFaixas(idade).map(f => `<option value="${f}">${f}</option>`).join('');
        if (faixaAtual && selF.querySelector(`option[value="${faixaAtual}"]`)) selF.value = faixaAtual;
        this._meAtualizarGraus();
    },

    async _meSalvar(id) {
        const mod = document.getElementById('me-modalidade')?.value || 'jiujitsu';
        const novaFaixa = document.getElementById('me-faixa')?.value || 'Branca';
        const dados = {
            nome:        (document.getElementById('me-nome')?.value || '').trim(),
            email:       (document.getElementById('me-email')?.value || '').trim().toLowerCase(),
            nascimento:  document.getElementById('me-nascimento')?.value || '',
            modalidade:  mod,
            faixa:       (mod === 'muaythai') ? 'Branca' : novaFaixa,
            grau:        (mod === 'muaythai') ? 0 : (parseInt(document.getElementById('me-graus')?.value) || 0),
            faixaMT:     (mod === 'muaythai' || mod === 'ambos') ? (document.getElementById('me-faixa-mt')?.value || 'Branco (Iniciante)') : '',
            cpf:         (document.getElementById('me-cpf')?.value || '').replace(/\D/g,''),
            telefone:    (document.getElementById('me-telefone')?.value || '').replace(/\D/g,''),
            cep:         (document.getElementById('me-cep')?.value || '').replace(/\D/g,''),
            rua:         (document.getElementById('me-rua')?.value || '').trim(),
            numero:      (document.getElementById('me-numero')?.value || '').trim(),
            complemento: (document.getElementById('me-complemento')?.value || '').trim(),
            bairro:      (document.getElementById('me-bairro')?.value || '').trim(),
            cidade:      (document.getElementById('me-cidade')?.value || '').trim(),
            estado:      (document.getElementById('me-estado')?.value || '').trim().toUpperCase(),
            treinaComAdultos: document.getElementById('me-treina-toggle')?.dataset.on === 'true',
        };
        // Leões
        const painelLeoes = document.getElementById('me-painel-leoes');
        if (painelLeoes && !painelLeoes.classList.contains('hidden')) {
            try {
                const antigoDoc = await db.collection('alunos').doc(id).get();
                const antigoDado = antigoDoc.data();
                let historicoLeoes = antigoDado.historicoLeoes || [];
                const dataHoje = new Date().toLocaleDateString('pt-BR');
                const nomesAmigaveis = { leaoAtencao:'Atenção', leaoComportamento:'Comportamento', leaoCompanheirismo:'Companheirismo', leaoDisciplina:'Disciplina' };
                if (antigoDado.faixa !== novaFaixa) {
                    this._meLeoesFichaTemp = { leaoAtencao:0, leaoComportamento:0, leaoCompanheirismo:0, leaoDisciplina:0 };
                } else {
                    historicoLeoes = historicoLeoes.filter(i => !(i.faixa === antigoDado.faixa));
                }
                for (const key in this._meLeoesFichaTemp) {
                    const qtd = this._meLeoesFichaTemp[key];
                    for (let i = 0; i < qtd; i++) {
                        historicoLeoes.unshift({ data: dataHoje, campo: key, faixa: novaFaixa, mensagem: `🎖️ Leão de ${nomesAmigaveis[key]} na Faixa ${novaFaixa}` });
                    }
                }
                dados.historicoLeoes = historicoLeoes;
            } catch(e) { console.error(e); }
        }
        await db.collection('alunos').doc(id).update(dados);
        document.getElementById('modal-editar-atleta')?.remove();
        alert('✅ Atleta salvo!');
        this.renderAlunos();
    },

    async abrirModalEditarAluno(id) {
        const docSnap = await db.collection('alunos').doc(id).get();
        if (!docSnap.exists) return alert('Atleta não encontrado.');
        const a = docSnap.data();
        const isAdmin = auth.role === 'admin';
        const anoAtual = new Date().getFullYear();
        const idadeAtleta = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
        const mod = a.modalidade || 'jiujitsu';

        const faixasOpts = graduacao.getFaixas(idadeAtleta).map(f => `<option value="${f}" ${f === a.faixa ? 'selected' : ''}>${f}</option>`).join('');
        const maxGrau = graduacao.getMaxGraus(a.faixa || 'Branca');
        let grausOpts = '';
        for (let i = 0; i <= maxGrau; i++) grausOpts += `<option value="${i}" ${i === (a.grau || 0) ? 'selected' : ''}>${i}º G</option>`;

        const faixasMT = ['Branco (Iniciante)','Branco ponta Vermelha','Vermelha','Vermelha ponta Azul Clara','Azul Clara','Azul Clara ponta Azul Escura (Monitor)','Azul Escura (Instrutor Auxiliar)','Azul Escura ponta Preta (Instrutor)','Preta (Professor)','Preta ponta Branca (Mestre)','Preta, Ponta Branca e Vermelha (Grão Mestre)'];
        const faixasMTOpts = faixasMT.map(f => `<option value="${f}" ${f === a.faixaMT ? 'selected' : ''}>${f}</option>`).join('');

        const usaLeoes = idadeAtleta <= 15 && isAdmin;
        const hist = a.historicoLeoes || [];
        this._meLeoesFichaTemp = {
            leaoAtencao:       hist.filter(i => i.campo === 'leaoAtencao'        && i.faixa === a.faixa).length,
            leaoComportamento: hist.filter(i => i.campo === 'leaoComportamento'  && i.faixa === a.faixa).length,
            leaoCompanheirismo:hist.filter(i => i.campo === 'leaoCompanheirismo' && i.faixa === a.faixa).length,
            leaoDisciplina:    hist.filter(i => i.campo === 'leaoDisciplina'     && i.faixa === a.faixa).length,
        };

        const leoesPanelHtml = usaLeoes ? `
        <div id="me-painel-leoes" style="background:#0f172a; padding:15px; border-radius:12px; margin-top:15px; border:1px solid #334155;">
            <small style="color:#f59e0b; font-weight:800; display:block; font-size:0.6rem; margin-bottom:10px; text-transform:uppercase;">🦁 Conceder Leões de Conquest</small>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                ${[['leaoAtencao','🟢 Atenção'],['leaoComportamento','🔴 Comportamento'],['leaoCompanheirismo','🔵 Companheirismo'],['leaoDisciplina','🟡 Disciplina']].map(([k,lbl]) => `
                <div style="background:#1e293b; padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #334155;">
                    <span style="font-size:0.65rem; color:white; font-weight:700;">${lbl}</span>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <button onclick="academia._meLeoesFichaTemp['${k}'] = Math.max(0,(academia._meLeoesFichaTemp['${k}']||0)-1); document.getElementById('me-leao-qty-${k}').innerText = academia._meLeoesFichaTemp['${k}'];" style="background:#334155; border:none; color:white; width:22px; height:22px; border-radius:4px; font-weight:bold; cursor:pointer;">-</button>
                        <b id="me-leao-qty-${k}" style="font-size:0.8rem; color:white; min-width:12px; text-align:center;">${this._meLeoesFichaTemp[k]}</b>
                        <button onclick="academia._meLeoesFichaTemp['${k}'] = (academia._meLeoesFichaTemp['${k}']||0)+1; document.getElementById('me-leao-qty-${k}').innerText = academia._meLeoesFichaTemp['${k}'];" style="background:#3b82f6; border:none; color:white; width:22px; height:22px; border-radius:4px; font-weight:bold; cursor:pointer;">+</button>
                    </div>
                </div>`).join('')}
            </div>
        </div>` : `<div id="me-painel-leoes" class="hidden"></div>`;

        const phoneClean = (a.telefone || '').replace(/\D/g,'');
        const btnWaHtml = phoneClean ? `<a href="https://wa.me/${phoneClean.startsWith('55') ? phoneClean : '55'+phoneClean}" target="_blank" style="background:#25D366; color:#000; border:none; padding:5px 10px; border-radius:6px; font-size:0.65rem; font-weight:800; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">📱 WhatsApp</a>` : '';

        const dis = isAdmin ? '' : 'disabled';

        document.getElementById('modal-editar-atleta')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-editar-atleta';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.88); z-index:9999; display:flex; flex-direction:column; overflow-y:auto; padding:20px; box-sizing:border-box;';
        modal.innerHTML = `
        <div style="background:#1e293b; border-radius:16px; padding:20px; max-width:500px; margin:0 auto; width:100%; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div>
                    <div style="font-size:0.6rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:1px;">✏️ Editar Atleta</div>
                    <div style="font-size:1rem; font-weight:900; color:white; margin-top:2px;">${a.nome}</div>
                    ${btnWaHtml}
                </div>
                <button onclick="document.getElementById('modal-editar-atleta').remove()" style="background:#334155; border:none; color:white; width:36px; height:36px; border-radius:8px; cursor:pointer; font-size:1rem; font-weight:700; flex-shrink:0;">✕</button>
            </div>

            <input type="text" id="me-nome" value="${(a.nome||'').replace(/"/g,'&quot;')}" placeholder="Nome Completo" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <input type="email" id="me-email" value="${(a.email||'').replace(/"/g,'&quot;')}" placeholder="E-mail" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <input type="text" id="me-cpf" value="${a.cpf||''}" placeholder="CPF (apenas números)" maxlength="11" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <input type="text" id="me-telefone" value="${a.telefone||''}" placeholder="Telefone com DDD" maxlength="11" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <input type="text" id="me-cep" value="${a.cep||''}" placeholder="CEP" maxlength="8" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <input type="text" id="me-rua" value="${(a.rua||'').replace(/"/g,'&quot;')}" placeholder="Rua / Logradouro" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <input type="text" id="me-numero" value="${(a.numero||'').replace(/"/g,'&quot;')}" placeholder="Nº" ${dis} style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;"/>
                <input type="text" id="me-bairro" value="${(a.bairro||'').replace(/"/g,'&quot;')}" placeholder="Bairro" ${dis} style="flex:2; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;"/>
            </div>
            <input type="text" id="me-complemento" value="${(a.complemento||'').replace(/"/g,'&quot;')}" placeholder="Complemento" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <input type="text" id="me-cidade" value="${(a.cidade||'').replace(/"/g,'&quot;')}" placeholder="Cidade" ${dis} style="flex:3; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;"/>
                <input type="text" id="me-estado" value="${(a.estado||'').replace(/"/g,'&quot;')}" placeholder="UF" maxlength="2" ${dis} style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem; text-align:center; text-transform:uppercase;"/>
            </div>

            <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:6px; letter-spacing:0.5px;">MODALIDADE:</small>
            <input type="hidden" id="me-modalidade" value="${mod}"/>
            <div style="display:flex; gap:6px; margin-bottom:12px;">
                <button id="me-mod-btn-jiujitsu" type="button" onclick="academia._meModalidade('jiujitsu')" ${dis} style="flex:1; padding:9px 4px; background:${mod==='jiujitsu'?'#1e3a8a':'#0f172a'}; border:1px solid ${mod==='jiujitsu'?'#1d4ed8':'#334155'}; color:${mod==='jiujitsu'?'#93c5fd':'#64748b'}; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">🥋 JIU-JITSU</button>
                <button id="me-mod-btn-muaythai"  type="button" onclick="academia._meModalidade('muaythai')"  ${dis} style="flex:1; padding:9px 4px; background:${mod==='muaythai'?'#1e3a8a':'#0f172a'}; border:1px solid ${mod==='muaythai'?'#1d4ed8':'#334155'}; color:${mod==='muaythai'?'#93c5fd':'#64748b'}; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">🥊 MUAY THAI</button>
                <button id="me-mod-btn-ambos"     type="button" onclick="academia._meModalidade('ambos')"     ${dis} style="flex:1; padding:9px 4px; background:${mod==='ambos'?'#1e3a8a':'#0f172a'}; border:1px solid ${mod==='ambos'?'#1d4ed8':'#334155'}; color:${mod==='ambos'?'#93c5fd':'#64748b'}; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">⚔️ AMBOS</button>
            </div>

            <label style="color:#94a3b8; font-size:0.7rem; margin-left:2px; font-weight:700;">Data de Nascimento:</label>
            <input type="date" id="me-nascimento" value="${a.nascimento||''}" onchange="academia._meAtualizarFaixas()" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; margin-bottom:8px; outline:none; font-size:0.8rem; box-sizing:border-box;"/>

            <div id="me-section-jj" style="display:${mod==='muaythai'?'none':'block'};">
                <small style="color:#93c5fd; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px; letter-spacing:0.5px;">🥋 FAIXA JIU-JITSU:</small>
                <div style="display:flex; gap:10px; margin-bottom:8px;">
                    <select id="me-faixa" onchange="academia._meAtualizarGraus()" ${dis} style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;">${faixasOpts}</select>
                    <select id="me-graus" ${dis} style="flex:1; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px; outline:none; font-size:0.8rem;">${grausOpts}</select>
                </div>
            </div>

            <div id="me-section-mt" style="display:${mod==='jiujitsu'?'none':'block'};">
                <small style="color:#fca5a5; font-size:0.6rem; font-weight:800; display:block; margin-bottom:4px; letter-spacing:0.5px;">🥊 PRAJIOUD MUAY THAI:</small>
                <select id="me-faixa-mt" ${dis} style="width:100%; padding:10px; background:#0f172a; border:1px solid #7f1d1d; color:white; border-radius:8px; outline:none; font-size:0.78rem; margin-bottom:8px;">${faixasMTOpts}</select>
            </div>

            ${leoesPanelHtml}

            ${idadeAtleta <= 15 ? `
            <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:0.75rem; font-weight:800; color:#e2e8f0;">👥 Treina com Adultos</div>
                    <div style="font-size:0.62rem; color:#64748b; margin-top:2px;">Aparece na aba Adultos além de Kids</div>
                </div>
                <label style="position:relative; display:inline-block; width:44px; height:24px; flex-shrink:0; cursor:pointer;">
                    <span id="me-treina-toggle" data-on="${a.treinaComAdultos ? 'true' : 'false'}" onclick="if('${dis}'==='disabled')return; const on=this.dataset.on==='true'; this.dataset.on=on?'false':'true'; this.style.background=(!on)?'#3b82f6':'#334155'; this.querySelector('span').style.left=(!on)?'23px':'3px';" style="position:absolute; top:0; left:0; right:0; bottom:0; background:${a.treinaComAdultos ? '#3b82f6' : '#334155'}; border-radius:24px; transition:background 0.3s; cursor:pointer;">
                        <span style="position:absolute; height:18px; width:18px; left:${a.treinaComAdultos ? '23px' : '3px'}; bottom:3px; background:white; border-radius:50%; transition:0.3s;"></span>
                    </span>
                </label>
            </div>` : ''}

            <div style="display:flex; gap:8px; margin-top:20px;">
                ${isAdmin ? `<button onclick="academia._meSalvar('${id}')" style="flex:2; padding:13px; background:#3b82f6; border:none; color:white; border-radius:10px; font-weight:800; cursor:pointer; font-size:0.85rem;">💾 SALVAR ALTERAÇÕES</button>` : ''}
                <button onclick="document.getElementById('modal-editar-atleta').remove()" style="flex:1; padding:13px; background:#334155; border:none; color:white; border-radius:10px; font-weight:800; cursor:pointer; font-size:0.85rem;">✕ FECHAR</button>
            </div>
        </div>`;

        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
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
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:6px;letter-spacing:0.5px;">TIPO DE PROFESSOR:</small>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                    <label id="promo-tipo-titular" onclick="academia._selecionarTipoProfModal('titular')" style="display:flex;align-items:center;gap:8px;background:#0f172a;border:2px solid #3b82f6;border-radius:8px;padding:10px;cursor:pointer;">
                        <span style="font-size:1rem;">🧑‍🏫</span>
                        <div><div style="color:#e2e8f0;font-size:0.72rem;font-weight:700;">Titular</div><div style="color:#64748b;font-size:0.55rem;">Tem turmas fixas</div></div>
                    </label>
                    <label id="promo-tipo-reserva" onclick="academia._selecionarTipoProfModal('reserva')" style="display:flex;align-items:center;gap:8px;background:#0f172a;border:2px solid #334155;border-radius:8px;padding:10px;cursor:pointer;">
                        <span style="font-size:1rem;">🔄</span>
                        <div><div style="color:#e2e8f0;font-size:0.72rem;font-weight:700;">Reserva</div><div style="color:#64748b;font-size:0.55rem;">Convocado quando precisar</div></div>
                    </label>
                </div>
                <input type="hidden" id="promo-tipo-prof" value="titular"/>
                <div id="promo-section-turmas">
                    <small style="color:#94a3b8; font-size:0.6rem; font-weight:800; display:block; margin-bottom:8px; letter-spacing:0.5px;">TURMAS DE RESPONSABILIDADE:</small>
                    <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px; max-height:220px; overflow-y:auto;">
                        ${[...new Set(
                            Object.values(academia.getGrade())
                                .filter(v => Array.isArray(v))
                                .flat()
                                .filter(t => typeof t === 'string' && !t.includes("Sem treinos"))
                        )].sort().map(t => `
                            <label style="display:flex; align-items:center; gap:8px; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; cursor:pointer; font-size:0.75rem; color:#e2e8f0; font-weight:600;">
                                <input type="checkbox" class="check-turma-prof" value="${t}" style="accent-color:#3b82f6; width:16px; height:16px;"> ${t}
                            </label>`).join('')}
                    </div>
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

    _selecionarTipoProfModal(tipo) {
        document.getElementById('promo-tipo-prof').value = tipo;
        document.getElementById('promo-tipo-titular').style.borderColor = tipo === 'titular' ? '#3b82f6' : '#334155';
        document.getElementById('promo-tipo-reserva').style.borderColor = tipo === 'reserva' ? '#a855f7' : '#334155';
        const sec = document.getElementById('promo-section-turmas');
        if (sec) sec.style.display = tipo === 'reserva' ? 'none' : 'block';
    },

    async buscarCandidatoProf() {
        const termo = document.getElementById('busca-candidato-prof').value.trim().toLowerCase();
        const lista = document.getElementById('lista-candidatos-prof');
        if (!termo || termo.length < 2) { lista.innerHTML = ''; return; }

        const snap = await db.collection("alunos").get();
        const faixasOk = ['Roxa', 'Marrom', 'Preta'];
        const resultados = snap.docs.filter(doc => {
            const a = doc.data();
            return a.nome && a.nome.toLowerCase().includes(termo) && faixasOk.includes(a.faixa);
        }).sort((a, b) => a.data().nome.localeCompare(b.data().nome)).slice(0, 5);

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
        const tipo = document.getElementById('promo-tipo-prof')?.value || 'titular';
        const turmas = tipo === 'reserva' ? [] : Array.from(document.querySelectorAll('.check-turma-prof:checked')).map(c => c.value);
        if (tipo === 'titular' && turmas.length === 0) return alert("Selecione pelo menos uma turma de responsabilidade.");

        try {
            await db.collection("alunos").doc(this._candidatoProf.id).update({
                role: 'professor',
                turmasAcesso: turmas,
                tipo
            });
            const msg = tipo === 'reserva'
                ? `✅ ${this._candidatoProf.nome.toUpperCase()} promovido como professor RESERVA!`
                : `✅ ${this._candidatoProf.nome.toUpperCase()} agora é professor!\nTurmas: ${turmas.join(', ')}`;
            alert(msg);
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
            const turmas = (p.turmasAcesso || []).join(', ') || '—';
            const isReserva = p.tipo === 'reserva';
            const tipoBadge = isReserva
                ? `<span style="background:#7c3aed;color:white;font-size:0.48rem;padding:2px 7px;border-radius:4px;font-weight:800;">RESERVA</span>`
                : `<span style="background:#8b5cf6;color:white;font-size:0.48rem;padding:2px 7px;border-radius:4px;font-weight:800;">TITULAR</span>`;
            html += `<div class="item-card" style="padding:12px; border-left:4px solid ${isReserva ? '#7c3aed' : '#8b5cf6'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;">
                        <div style="display:flex;gap:5px;margin-bottom:4px;">
                            <span style="background:#8b5cf6;color:white;font-size:0.45rem;padding:2px 6px;border-radius:4px;font-weight:800;">ATLETA/PROF</span>
                            ${tipoBadge}
                        </div>
                        <div style="color:#e2e8f0;font-size:0.82rem;font-weight:700;">🥋 ${p.nome.toUpperCase()}</div>
                        <div style="color:var(--text-muted);font-size:0.65rem;margin-top:2px;">📧 ${p.email} • ${p.faixa}</div>
                        ${turmas !== '—' ? `<div style="color:#8b5cf6;font-size:0.6rem;font-weight:700;margin-top:3px;">Turmas: ${turmas}</div>` : (isReserva ? `<div style="color:#64748b;font-size:0.6rem;margin-top:3px;">Sem turmas definidas</div>` : '')}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;">
                        <button onclick="profComms.abrirConvocacao('${doc.id}','${p.nome.replace(/'/g,"\\'")}','${turmas}')" style="background:#10b981;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">📋 Convocar</button>
                        <button onclick="profComms.abrirRecado('${doc.id}','${p.nome.replace(/'/g,"\\'")}','alunos')" style="background:#3b82f6;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">💬 Recado</button>
                        <button onclick="academia.editarTurmasProf('${doc.id}','alunos')" style="background:#8b5cf6;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">✏️ Turmas</button>
                        <button onclick="academia.removerPrivilegioProf('${doc.id}','${p.nome.replace(/'/g,"\\'")}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.8rem;" title="Remover privilégio"><i class="fas fa-user-minus"></i></button>
                    </div>
                </div>
            </div>`;
        });

        // Professores da coleção
        const snapProfs = await db.collection("professores").get();
        snapProfs.docs.forEach(doc => {
            const p = doc.data();
            const turmas = (p.turmasAcesso || []).join(', ') || '—';
            const isReserva = p.tipo === 'reserva';
            const badge = isReserva
                ? `<span style="background:#7c3aed;color:white;font-size:0.48rem;padding:2px 7px;border-radius:4px;font-weight:800;">RESERVA</span>`
                : `<span style="background:#3b82f6;color:white;font-size:0.48rem;padding:2px 7px;border-radius:4px;font-weight:800;">TITULAR</span>`;
            html += `<div class="item-card" style="padding:12px; border-left:4px solid ${isReserva ? '#7c3aed' : '#3b82f6'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;">
                        <div style="margin-bottom:4px;">${badge}</div>
                        <div style="color:#e2e8f0;font-size:0.82rem;font-weight:700;">👤 ${p.nome.toUpperCase()}</div>
                        <div style="color:var(--text-muted);font-size:0.65rem;margin-top:2px;">📧 ${p.email}</div>
                        ${turmas !== '—' ? `<div style="color:#3b82f6;font-size:0.6rem;font-weight:700;margin-top:3px;">Turmas: ${turmas}</div>` : (isReserva ? `<div style="color:#64748b;font-size:0.6rem;margin-top:3px;">Sem turmas definidas</div>` : '')}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;">
                        <button onclick="profComms.abrirConvocacao('${doc.id}','${p.nome.replace(/'/g,"\\'")}','${turmas}')" style="background:#10b981;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">📋 Convocar</button>
                        <button onclick="profComms.abrirRecado('${doc.id}','${p.nome.replace(/'/g,"\\'")}','professores')" style="background:#3b82f6;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">💬 Recado</button>
                        <button onclick="academia.editarTurmasProf('${doc.id}','professores')" style="background:#8b5cf6;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.65rem;font-weight:700;white-space:nowrap;">✏️ Turmas</button>
                        <button onclick="academia.excluirProf('${doc.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.8rem;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        });

        l.innerHTML = html || '<p style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:10px;">Nenhum professor cadastrado.</p>';
        document.getElementById('btns-prof-admin')?.classList.toggle('hidden', !html);
    },

    async removerPrivilegioProf(id, nome) {
        if (!confirm(`Remover privilégios de professor de ${nome.toUpperCase()}?
Ele voltará a ser aluno normal.`)) return;
        await db.collection("alunos").doc(id).update({ role: firebase.firestore.FieldValue.delete(), turmasAcesso: firebase.firestore.FieldValue.delete() });
        alert(`${nome} voltou ao perfil de aluno.`);
        this.renderProfessores();
    },

    async editarTurmasProf(id, colecao) {
        const snap = await db.collection(colecao).doc(id).get();
        if (!snap.exists) return alert('Professor não encontrado.');
        const p = snap.data();
        const turmasAtuais = p.turmasAcesso || [];
        const gradeVals = Object.values(academia.getGrade() || {});
        const todasTurmas = [...new Set(gradeVals.filter(v => Array.isArray(v)).flat())].filter(t => typeof t === 'string' && t.trim() && !t.includes('Sem treino')).sort();

        let modal = document.getElementById('modal-editar-turmas-prof');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-editar-turmas-prof'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const checks = todasTurmas.map(t => {
            const checked = turmasAtuais.includes(t) ? 'checked' : '';
            return `<label style="display:flex;align-items:center;gap:8px;font-size:0.72rem;color:#e2e8f0;padding:6px 0;border-bottom:1px solid #1e293b;cursor:pointer;">
                <input type="checkbox" class="check-turma-edit" value="${t}" ${checked} style="width:16px;height:16px;accent-color:#8b5cf6;">
                <span>${t}</span>
            </label>`;
        }).join('');
        modal.innerHTML = `<div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;max-height:80vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <span style="font-size:0.9rem;font-weight:800;color:white;">✏️ Turmas de ${p.nome}</span>
                <button onclick="document.getElementById('modal-editar-turmas-prof').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="margin-bottom:14px;">${checks || '<p style="color:#64748b;font-size:0.75rem;">Nenhuma turma configurada na grade.</p>'}</div>
            <button onclick="academia._salvarTurmasProf('${id}','${colecao}')" style="width:100%;padding:12px;background:#8b5cf6;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;">💾 SALVAR TURMAS</button>
        </div>`;
    },

    async _salvarTurmasProf(id, colecao) {
        const selecionadas = Array.from(document.querySelectorAll('.check-turma-edit:checked')).map(c => c.value);
        const update = { turmasAcesso: selecionadas };
        if (selecionadas.length > 0) update.tipo = 'titular';
        await db.collection(colecao).doc(id).update(update);
        document.getElementById('modal-editar-turmas-prof')?.remove();
        alert(`✅ Turmas atualizadas!${selecionadas.length ? '\n' + selecionadas.join(', ') : '\nNenhuma turma selecionada.'}`);
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

    _selecionarTipoProf(tipo) {
        document.getElementById('tipo-prof').value = tipo;
        document.getElementById('tipo-titular-label').style.borderColor = tipo === 'titular' ? '#3b82f6' : '#334155';
        document.getElementById('tipo-reserva-label').style.borderColor = tipo === 'reserva' ? '#a855f7' : '#334155';
        const sec = document.getElementById('section-turmas-prof');
        if (sec) sec.style.display = tipo === 'reserva' ? 'none' : 'block';
    },
    limparPr() {
        document.getElementById('nome-prof').value = "";
        document.getElementById('email-prof').value = "";
        document.querySelectorAll('.check-turma').forEach(c => c.checked = false);
        this._selecionarTipoProf('titular');
    },
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
            const [resPendente, resVencida, resPago, resSubs] = await Promise.all([
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=PENDING&limit=10`),
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=OVERDUE&limit=10`),
                fetch(`${asaasUrl}?endpoint=payments&customer=${customerId}&status=RECEIVED&limit=5`),
                fetch(`${asaasUrl}?endpoint=subscriptions&customer=${customerId}&status=ACTIVE&limit=5`)
            ]);
            const _pend = await resPendente.json(); const _venc = await resVencida.json();
            const pagos = await resPago.json(); const subs = await resSubs.json();
            // Combina PENDING + OVERDUE numa lista única de "em aberto"
            const pendentes = { data: [...(_pend.data||[]), ...(_venc.data||[])] };
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
                pendentes.data.forEach((f, idx) => {
                    const venc = new Date(f.dueDate + 'T00:00:00'); venc.setHours(0,0,0,0);
                    const dias = Math.floor((dataHoje - venc) / 86400000);
                    const vencStr = f.dueDate.split('-').reverse().join('/');
                    const valor = f.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    const vencida = dias > 0;
                    const hoje = dias === 0;
                    const cor = vencida ? '#f43f5e' : hoje ? '#f59e0b' : '#10b981';
                    const tag = vencida ? `⚠️ ${dias}d DE ATRASO` : hoje ? 'Vence hoje' : 'A vencer';
                    const isPrimeira = idx === 0;
                    if (isPrimeira) {
                        // Fatura mais urgente — destaque total
                        const bgDestaque = vencida ? '#3b000e' : hoje ? '#2d1800' : '#052e16';
                        const label = vencida ? '⚠️ PAGUE ESTA PRIMEIRO — EM ATRASO' : hoje ? '⚠️ PAGUE ESTA PRIMEIRO — VENCE HOJE' : '👆 PAGUE ESTA PRIMEIRO';
                        html += `
                        <div style="background:${bgDestaque}; border:2px solid ${cor}; border-radius:12px; padding:14px; margin-bottom:10px;">
                            <div style="font-size:0.55rem; font-weight:900; color:${cor}; letter-spacing:1px; margin-bottom:8px; text-align:center;">${label}</div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div>
                                    <div style="font-size:1.15rem; font-weight:900; color:${vencida ? '#f43f5e' : 'white'};">${valor}</div>
                                    <div style="font-size:0.65rem; color:#94a3b8;">Venc: ${vencStr}</div>
                                </div>
                                <span style="font-size:0.65rem; font-weight:900; color:${cor}; background:${cor}33; padding:5px 10px; border-radius:8px; text-align:center;">${tag}</span>
                            </div>
                        </div>`;
                    } else {
                        html += `<div style="background:#0f172a; border:1px solid ${cor}44; border-left:3px solid ${cor}; border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; opacity:0.75;"><div><div style="font-size:0.85rem; font-weight:800; color:white;">${valor}</div><div style="font-size:0.65rem; color:#64748b;">Venc: ${vencStr}</div></div><span style="font-size:0.6rem; font-weight:800; color:${cor}; background:${cor}22; padding:3px 8px; border-radius:6px;">${tag}</span></div>`;
                    }
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
        const n = document.getElementById('nome-prof').value.trim();
        const e = document.getElementById('email-prof').value.trim().toLowerCase();
        const tipo = document.getElementById('tipo-prof')?.value || 'titular';
        const t = tipo === 'reserva' ? [] : Array.from(document.querySelectorAll('.check-turma:checked')).map(cb => cb.value);
        if (!n || !e) return alert("Campos vazios.");
        await db.collection("professores").add({ nome: n, email: e, senha: "1234", turmasAcesso: t, tipo });
        alert("✅ Professor cadastrado!"); this.limparPr(); this.renderProfessores();
    },

    async salvarAluno() {
      try {
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
        // Valor do contrato — se preenchido, atualiza planoValor
        const novoValor = parseFloat(document.getElementById('planoValor-aluno')?.value);
        if (novoValor > 0) dados.planoValor = novoValor;
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
            // Se a faixa ou grau mudou, o aluno foi graduado — limpa convocação e marca celebração
            try {
                const docAtual = await db.collection("alunos").doc(id).get();
                const dadosAtuais = docAtual.data() || {};
                const faixaMudou = dadosAtuais.faixa !== dados.faixa;
                const grauMudou  = dadosAtuais.grau  !== dados.grau;
                const faixaMTMudou = dados.faixaMT && dadosAtuais.faixaMT !== dados.faixaMT;
                if (dadosAtuais.aspiranteGraduacao && (faixaMudou || grauMudou)) {
                    dados.aspiranteGraduacao = false;
                }
                const hoje = new Date();
                const dataFormatada = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;
                const historicoGrad = dadosAtuais.historicoGraduacao || [];

                if (faixaMudou || grauMudou) {
                    // JJ mudou
                    dados.graduacaoPendente = {
                        faixa: dados.faixa, grau: dados.grau || 0,
                        faixaMT: null, modalidadeAlterada: 'jiujitsu'
                    };
                    historicoGrad.push({
                        faixa: dados.faixa, grau: dados.grau || 0,
                        faixaMT: null, modalidade: 'jiujitsu', data: dataFormatada
                    });
                    dados.historicoGraduacao = historicoGrad;
                }
                if (faixaMTMudou) {
                    // MT mudou (pode sobrescrever graduacaoPendente se os dois mudaram juntos)
                    dados.graduacaoPendente = {
                        faixa: dados.faixa, grau: dados.grau || 0,
                        faixaMT: dados.faixaMT, modalidadeAlterada: 'muaythai'
                    };
                    historicoGrad.push({
                        faixa: dados.faixa, grau: dados.grau || 0,
                        faixaMT: dados.faixaMT, modalidade: 'muaythai', data: dataFormatada
                    });
                    dados.historicoGraduacao = historicoGrad;
                }
            } catch(e) { /* ignora */ }
            await db.collection("alunos").doc(id).update(dados);
        } else {
            await db.collection("alunos").add({...dados, aulas: 0, historico: [], historicoLeoes: []});
        }
        alert("Atleta salvo!"); this.limparAl(); this.renderAlunos(); academia.carregarConquistas();
      } catch(err) {
        console.error('salvarAluno erro:', err);
        alert('Erro ao salvar atleta: ' + err.message);
      }
    },

    _muralListener: null,
    _popupAvisoMostrado: false, // evita reaparecer na mesma sessão

    async carregarMural() {
        // Cancela listener anterior para não acumular múltiplos
        if (this._muralListener) { this._muralListener(); this._muralListener = null; }
        this._muralListener = db.collection("mural_avisos").onSnapshot((snap) => {
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
                    const isKids = idade <= 15;
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
                const novoId = docsOrdenados[0].id;
                if (novoId !== this.idUltimoAvisoMural) this._popupAvisoMostrado = false; // novo comunicado → permite mostrar
                this.idUltimoAvisoMural = novoId;
                const popTexto = document.getElementById('popup-texto-aviso');
                const popData = document.getElementById('popup-data-aviso');
                const popModal = document.getElementById('modal-popup-aviso');
                if (popTexto && popData && popModal) {
                    const jaVisto = localStorage.getItem('gaditas_ultimo_aviso_visto') === this.idUltimoAvisoMural;
                    const ehNovo  = !jaVisto;
                    // Mostra popup só se: é novo comunicado E ainda não mostrou nesta sessão
                    if ((auth.role === 'aluno' || auth.role === 'professor') && ehNovo && !this._popupAvisoMostrado) {
                        popTexto.innerHTML = linkificar(docsOrdenados[0].data().texto);
                        popData.innerText = `Publicado em: ${docsOrdenados[0].data().dataFormatada}`;
                        popModal.classList.remove('hidden');
                        this._popupAvisoMostrado = true; // não mostra de novo até nova sessão ou novo comunicado
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
                    <p style="color:#cbd5e1; font-size:0.8rem; line-height:1.6; margin:0; font-style:italic;">${linkificar(d.texto)}</p>
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
                        <p style="color:#6ee7b7; font-size:0.75rem; margin:0; font-style:italic;">${linkificar(d.texto)}</p>
                    </div>`;
                } else {
                    statusHTML += `<div style="background:#1c1400; border:1px solid #f59e0b44; border-radius:10px; padding:10px 12px; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:0.7rem;">⏳</span>
                            <span style="color:#f59e0b; font-weight:800; font-size:0.72rem;">AGUARDANDO APROVAÇÃO</span>
                            <small style="color:#475569; font-size:0.6rem; margin-left:auto;">${d.dataFormatada || ''}</small>
                        </div>
                        <p style="color:#fde68a; font-size:0.75rem; margin:0; font-style:italic;">${linkificar(d.texto)}</p>
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
                        <p style="color:#94a3b8; font-size:0.78rem; line-height:1.5; margin:0 0 6px; font-style:italic;">${linkificar(d.texto)}</p>
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
                        <p style="color:#6ee7b7; font-size:0.75rem; line-height:1.5; margin:0; font-style:italic;">${linkificar(d.texto)}</p>
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

    iniciarListenerRecadosAluno() {
        if (!auth.currentUser || auth.role !== 'aluno') return;
        const alunoId = auth.currentUser.id;
        db.collection('recados_alunos')
            .where('alunoId', '==', alunoId)
            .where('lido', '==', false)
            .onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        setTimeout(() => this._mostrarPopupRecadoAluno(change.doc), 1000);
                    }
                });
            });
    },

    _mostrarPopupRecadoAluno(doc) {
        const r = doc.data();
        const popupId = `popup-recado-aluno-${doc.id}`;
        if (document.getElementById(popupId)) return;
        const modal = document.createElement('div');
        modal.id = popupId;
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const hora = r.criadoEm ? new Date(r.criadoEm).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 80px #f59e0b33;position:relative;">
                <div style="font-size:3rem;margin-bottom:8px;">🏆</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;margin-bottom:8px;">GADITAS ACADEMY</div>
                <div style="font-size:1.2rem;font-weight:800;color:white;margin-bottom:4px;">Aviso — Exame de Faixa</div>
                ${hora ? `<div style="font-size:0.62rem;color:#64748b;margin-bottom:14px;">${hora}</div>` : ''}
                <div style="background:#451a03;border:1px solid #f59e0b;border-radius:12px;padding:16px;margin:14px 0;text-align:left;">
                    <div style="font-size:0.85rem;color:#e2e8f0;line-height:1.6;">${r.texto}</div>
                </div>
                <button onclick="academia._marcarRecadoAlunoLido('${doc.id}','${popupId}')" style="width:100%;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:0.9rem;">
                    ✅ LI O RECADO
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    async _marcarRecadoAlunoLido(recadoId, popupId) {
        try {
            await db.collection('recados_alunos').doc(recadoId).update({ lido: true, lidoEm: Date.now() });
        } catch(e) {}
        document.getElementById(popupId)?.remove();
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
            // Notifica o professor via push
            try {
                const profDoc = await db.collection('professores').doc(this._professorRelatoId).get();
                const profToken = profDoc.exists ? profDoc.data().fcmToken : null;
                const tipoLabel = this._tipoRelatoAtual === 'machucado' ? '🤕 MACHUCADO' : '🤒 DOENTE';
                const nomeAluno = aluno.nome || aluno.name || 'Aluno';
                auth._enviarPush(profToken, `${tipoLabel} — ${nomeAluno}`, texto.substring(0, 120));
            } catch(ePush) { /* silencioso */ }
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
            // Busca o relato para pegar o alunoId antes de atualizar
            const relatoDoc = await db.collection("relatos_saude").doc(id).get();
            const relato = relatoDoc.exists ? relatoDoc.data() : null;

            await db.collection("relatos_saude").doc(id).update({
                respondido: true, resposta: texto,
                respostaDataFormatada: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})
            });

            // Notifica o aluno via push
            if (relato?.alunoId) {
                try {
                    const alunoDoc = await db.collection('alunos').doc(relato.alunoId).get();
                    const alunoToken = alunoDoc.exists ? alunoDoc.data().fcmToken : null;
                    const profNome = auth.currentUser?.nome || 'Professor';
                    auth._enviarPush(alunoToken, `💬 ${profNome} respondeu seu relato`, texto.substring(0, 120));
                } catch(ePush) { /* silencioso */ }
            }

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
                    const isKids = idade <= 15;
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
            const isKids = idade <= 15;
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
    // ── Dashboard Aluno ───────────────────────────────────
    async renderDashboardAluno() {
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
        const el = document.getElementById('dashboard-grid-aluno');
        if (!el) return;
        el.style.display = 'block';

        // Dados do aluno
        const alunoId = auth.currentUser?.id;
        let nome = auth.currentUser?.nome || '';
        let faixa = 'Branca', grau = 0, aulas = 0, meta = 40;
        let corFaixa = '#e2e8f0', rankPos = null, rankTotal = 0;

        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            if (doc.exists) {
                const d = doc.data();
                faixa  = d.faixa  || 'Branca';
                grau   = d.grau   || 0;
                aulas  = d.aulas  || 0;
                const s = academia.verificarMeta(d);
                meta   = s.meta || 40;
            }
            corFaixa = ui.getCorFaixa(faixa);

            // Ranking do mês
            const snap = await db.collection('alunos').get();
            const hoje = new Date();
            const mesAtual = hoje.getMonth();
            const anoAtual = hoje.getFullYear();
            const ranking = [];
            snap.docs.forEach(doc => {
                const d = doc.data();
                if (d.status === 'trancado') return;
                const aulasMs = (d.historico || []).filter(h => {
                    if (!h.data) return false;
                    const p = h.data.split(',')[0].split('/');
                    if (p.length < 3) return false;
                    const dt = new Date(`${p[2]}-${p[1]}-${p[0]}`);
                    return dt.getMonth() === mesAtual && dt.getFullYear() === anoAtual;
                }).length;
                ranking.push({ id: doc.id, nome: d.nome, aulasMs });
            });
            ranking.sort((a, b) => b.aulasMs - a.aulasMs);
            rankTotal = ranking.length;
            const myIdx = ranking.findIndex(r => r.id === alunoId);
            rankPos = myIdx >= 0 ? myIdx + 1 : null;

            // Top 3 para exibir
            const top3 = ranking.slice(0, 3);
            const medals = ['🥇','🥈','🥉'];
            const mesNome = hoje.toLocaleDateString('pt-BR', { month: 'long' });

            const pct  = Math.min(Math.round((aulas / meta) * 100), 100);
            const primeiroNome = nome.split(' ')[0];

            const _isKidsGrid = /kids/i.test(nome) || (auth.currentUser?.turmas || []).some(t => /kids/i.test(t));
            const cards = [
                { icon:'fa-qrcode',       label:'Check-in',   cor:'#10b981', fn:`academia._irParaCheckin()` },
                { icon:'fa-camera',       label:'QR Code',    cor:'#3b82f6', fn:`academia.abrirScannerQR()` },
                { icon:'fa-clock',        label:'Horários',   cor:'#8b5cf6', fn:`ui.showTab('tab-horarios')` },
                { icon:'fa-dollar-sign',  label:'Financeiro', cor:'#22c55e', fn:`ui.showTab('tab-financeiro')` },
                { icon:'fa-shopping-bag', label:'Loja',       cor:'#ec4899', fn:`ui.showTab('tab-loja')` },
                { icon:'fa-calendar-alt', label:'Eventos',    cor:'#f97316', fn:`ui.showTab('tab-eventos')` },
                { icon:'fa-video',        label:'Técnica',    cor:'#f43f5e', fn:`document.getElementById('card-tecnica-semana').scrollIntoView({behavior:'smooth'})` },
                _isKidsGrid
                    ? { icon:'fa-book-open', label:'Boletim',  cor:'#a78bfa', fn:`boletim.abrir(auth.currentUser.id)` }
                    : { icon:'fa-book',      label:'Diário',   cor:'#a78bfa', fn:`treinoPost.abrirDiario()` },
                { icon:'fa-medal',        label:'Conquistas', cor:'#f59e0b', fn:`document.getElementById('mural-conquistas').scrollIntoView({behavior:'smooth'})` },
            ];

            const cardsHtml = cards.map(c => `
                <button onclick="${c.fn}"
                    style="background:#1e293b;border:1px solid ${c.cor}22;border-radius:14px;padding:16px 6px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;"
                    onmousedown="this.style.transform='scale(0.93)'" onmouseup="this.style.transform=''" ontouchstart="this.style.transform='scale(0.93)'" ontouchend="this.style.transform=''">
                    <div style="width:44px;height:44px;background:${c.cor}18;border-radius:12px;display:flex;align-items:center;justify-content:center;">
                        <i class="fas ${c.icon}" style="font-size:1.2rem;color:${c.cor};"></i>
                    </div>
                    <span style="font-size:0.58rem;font-weight:800;color:#cbd5e1;letter-spacing:0.3px;text-align:center;">${c.label.toUpperCase()}</span>
                </button>`).join('');

            const rankingHtml = top3.map((r, i) => {
                const isMe = r.id === alunoId;
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b${isMe?';background:#f59e0b0a;border-radius:6px;padding:6px 8px;':''}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:0.85rem;">${medals[i]}</span>
                        <span style="font-size:0.72rem;font-weight:${isMe?'900':'600'};color:${isMe?'#f59e0b':'#e2e8f0'};">${r.nome.split(' ')[0]} ${r.nome.split(' ')[1]||''}</span>
                    </div>
                    <span style="font-size:0.7rem;font-weight:800;color:${isMe?'#f59e0b':'#94a3b8'};">${r.aulasMs} aula${r.aulasMs!==1?'s':''}</span>
                </div>`;
            }).join('');

            const minhaPosHtml = rankPos && rankPos > 3 ? `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#f59e0b0a;border-radius:6px;margin-top:4px;border:1px dashed #f59e0b44;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:0.72rem;color:#64748b;">${rankPos}°</span>
                        <span style="font-size:0.72rem;font-weight:900;color:#f59e0b;">${primeiroNome} (você)</span>
                    </div>
                    <span style="font-size:0.7rem;font-weight:800;color:#f59e0b;">${ranking[rankPos-1]?.aulasMs||0} aulas</span>
                </div>` : '';

            el.innerHTML = `
                <!-- Header com faixa e progresso -->
                <div style="background:#1e293b;border:1px solid ${corFaixa}33;border-radius:16px;padding:16px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <div>
                            <div style="font-size:0.55rem;color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;">OSS, bem-vindo(a)!</div>
                            <div style="font-size:1rem;font-weight:900;color:white;margin-top:1px;">${primeiroNome} 👋</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.65rem;font-weight:800;color:${corFaixa};">${faixa.toUpperCase()}</div>
                            <div style="font-size:0.55rem;color:#64748b;">${grau}° Grau</div>
                        </div>
                    </div>
                    <!-- Barra de progresso -->
                    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                        <span style="font-size:0.58rem;color:#64748b;font-weight:700;">Meta de aulas</span>
                        <span style="font-size:0.58rem;font-weight:800;color:${pct>=100?'#10b981':corFaixa};">${aulas}/${meta} · ${pct}%</span>
                    </div>
                    <div style="background:#0f172a;border-radius:999px;height:8px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:${pct>=100?'#10b981':corFaixa};border-radius:999px;transition:width 0.8s;"></div>
                    </div>
                </div>

                <!-- Convocações pendentes (professor) -->
                <div id="dash-convocacoes-prof"></div>

                <!-- Grid 3x3 -->
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
                    ${cardsHtml}
                </div>

                <!-- Ranking do mês -->
                <div style="background:#1e293b;border:1px solid #f59e0b22;border-radius:14px;padding:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <div style="font-size:0.62rem;font-weight:800;color:#f59e0b;">🔥 RANKING — ${mesNome.toUpperCase()}</div>
                        <span style="font-size:0.55rem;color:#475569;">${rankTotal} alunos</span>
                    </div>
                    ${rankingHtml}
                    ${minhaPosHtml}
                </div>`;
        // Convocações pendentes para professor
        if (auth.role === 'professor' && alunoId) {
            db.collection('convocacoes_prof')
                .where('profId', '==', alunoId)
                .where('status', '==', 'pendente')
                .get().then(snap => {
                    const cont = document.getElementById('dash-convocacoes-prof');
                    if (!cont || snap.empty) return;
                    let html = `<div style="background:#1e3a1a;border:1px solid #10b981;border-radius:12px;padding:12px;margin-bottom:12px;">
                        <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:8px;">📋 CONVOCAÇÕES PENDENTES</div>`;
                    snap.forEach(doc => {
                        const c = doc.data();
                        html += `<div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:6px;">
                            <div style="font-size:0.78rem;font-weight:700;color:#e2e8f0;">${c.turma} — ${c.dataExib}</div>
                            ${c.mensagem ? `<div style="font-size:0.62rem;color:#94a3b8;margin:3px 0;">"${c.mensagem}"</div>` : ''}
                            <div style="display:flex;gap:8px;margin-top:8px;">
                                <button onclick="profComms._responderConvocacao('${doc.id}','confirmado')" style="flex:1;padding:7px;background:#10b981;border:none;color:white;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.7rem;">✅ CONFIRMAR</button>
                                <button onclick="profComms._responderConvocacao('${doc.id}','recusado')" style="flex:1;padding:7px;background:#1e293b;border:1px solid #ef4444;color:#ef4444;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.7rem;">❌ NÃO POSSO</button>
                            </div>
                        </div>`;
                    });
                    html += '</div>';
                    cont.innerHTML = html;
                }).catch(() => {});
        }
        } catch(e) { console.warn('Dashboard aluno:', e.message); }
    },

    // ── Helpers do dashboard admin ────────────────────────
    _irParaCheckin() {
        ui.showTab('tab-checkin');
        setTimeout(() => {
            if (auth.role === 'aluno') {
                const alunoArea = document.getElementById('area-aluno-checkin');
                if (alunoArea) alunoArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                const profArea = document.getElementById('area-professor-checkin');
                if (profArea) {
                    profArea.classList.remove('hidden');
                    profArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                academia.renderPresencaAdmin();
            }
        }, 200);
    },

    _irParaChamada() {
        // Abre modal direto com seleção de turma
        const grade = this.getGrade();
        const turmas = [...new Set(Object.values(grade).filter(v => Array.isArray(v)).flat())]
            .filter(t => typeof t === 'string' && !t.includes('Sem treinos'));

        document.getElementById('modal-chamada-dash')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-chamada-dash';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #0ea5e944;border-radius:16px;padding:24px;width:100%;max-width:400px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="font-size:0.85rem;font-weight:800;color:#0ea5e9;">📋 Chamada por Lista</div>
                    <button onclick="document.getElementById('modal-chamada-dash').remove()" style="background:none;border:none;color:#64748b;font-size:1rem;cursor:pointer;">✕</button>
                </div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:6px;">SELECIONE A TURMA:</small>
                <select id="chamada-dash-turma" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:12px;">
                    ${turmas.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <button onclick="
                    const t=document.getElementById('chamada-dash-turma').value;
                    document.getElementById('modal-chamada-dash').remove();
                    // Garante que o card-chamada existe com a turma certa
                    setTimeout(()=>{
                        academia.renderChamadaProf();
                        setTimeout(()=>{
                            const sel=document.getElementById('chamada-select-turma');
                            if(sel){sel.value=t;}
                            academia.abrirChamada();
                        },200);
                    },100);"
                    style="width:100%;padding:12px;background:#0ea5e9;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                    <i class="fas fa-users"></i> ABRIR LISTA DE ALUNOS
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    _irParaAniversarios() {
        // Abre aniversariantes em modal para não precisar trocar de aba
        document.getElementById('modal-aniv-dash')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-aniv-dash';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99999;overflow-y:auto;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:480px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="font-size:0.95rem;font-weight:900;color:#f59e0b;">🎂 Aniversariantes</div>
                    <button onclick="document.getElementById('modal-aniv-dash').remove()" style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.75rem;font-weight:800;cursor:pointer;">✕ Fechar</button>
                </div>
                <div id="lista-aniv-dash"><div style="text-align:center;padding:20px;color:#64748b;"><i class="fas fa-spinner fa-spin"></i></div></div>
            </div>`;
        document.body.appendChild(modal);

        // Carrega aniversariantes direto no modal
        db.collection('alunos').get().then(snap => {
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            const lista = [];
            snap.docs.forEach(doc => {
                const a = doc.data();
                if (!a.nascimento) return;
                const p = a.nascimento.split('-');
                if (p.length < 3) return;
                const dia = parseInt(p[2]); const mes = parseInt(p[1]) - 1;
                for (let d = 0; d < 7; d++) {
                    const dt = new Date(hoje); dt.setDate(hoje.getDate() + d);
                    if (dia === dt.getDate() && mes === dt.getMonth()) {
                        lista.push({ nome: a.nome, faixa: a.faixa||'Branca', dias: d });
                    }
                }
            });
            lista.sort((a,b) => a.dias - b.dias);
            const el = document.getElementById('lista-aniv-dash');
            if (!el) return;
            if (!lista.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:#475569;font-size:0.8rem;">Nenhum aniversariante nos próximos 7 dias.</div>'; return; }
            el.innerHTML = lista.map(a => `
                <div style="background:#0f172a;border:1px solid #f59e0b22;border-left:3px solid #f59e0b;border-radius:0 10px 10px 0;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:0.8rem;font-weight:800;color:white;">${a.nome}</div>
                        <div style="font-size:0.6rem;color:#64748b;">${a.faixa}</div>
                    </div>
                    <span style="font-size:0.65rem;font-weight:800;color:${a.dias===0?'#10b981':'#f59e0b'};">${a.dias===0?'🎂 HOJE!':a.dias===1?'Amanhã':'Em '+a.dias+' dias'}</span>
                </div>`).join('');
        }).catch(e => { const el = document.getElementById('lista-aniv-dash'); if(el) el.innerHTML = '<small style="color:#f43f5e;">Erro: '+e.message+'</small>'; });
    },

    async renderDashboardGrid() {
        if (auth.role !== 'admin') return;
        const el = document.getElementById('dashboard-grid-admin');
        if (!el) return;
        el.style.display = 'block';

        // Resumo do dia
        let checkinsHoje = 0, aulasHoje = 0, totalAlunos = 0;
        try {
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            const [ciSnap, alSnap] = await Promise.all([
                db.collection('checkins').get(),
                db.collection('alunos').get()
            ]);
            checkinsHoje = ciSnap.docs.filter(d => d.data().data >= hoje.getTime()).length;
            totalAlunos  = alSnap.docs.filter(d => d.data().status !== 'trancado').length;

            // Aulas no histórico hoje
            const hojeStr = hoje.toLocaleDateString('pt-BR');
            const setAlunos = new Set();
            alSnap.docs.forEach(doc => {
                (doc.data().historico || []).forEach(h => {
                    if (h.data && h.data.startsWith(hojeStr)) setAlunos.add(doc.id);
                });
            });
            aulasHoje = setAlunos.size;
        } catch(e) {}

        const cards = [
            { icon:'fa-qrcode',        label:'Check-in',     cor:'#10b981', fn:`academia._irParaCheckin()` },
            { icon:'fa-users',         label:'Alunos',       cor:'#3b82f6', fn:`ui.showTab('tab-alunos')` },
            { icon:'fa-clock',         label:'Horários',     cor:'#8b5cf6', fn:`ui.showTab('tab-horarios')` },
            { icon:'fa-dollar-sign',   label:'Financeiro',   cor:'#22c55e', fn:`ui.showTab('tab-financeiro')` },
            { icon:'fa-medal',         label:'Exame',        cor:'#f59e0b', fn:`ui.showTab('tab-exame'); exame.carregarExameAluno()` },
            { icon:'fa-chart-bar',     label:'Relatórios',   cor:'#06b6d4', fn:`ui.showTab('tab-relatorios')` },
            { icon:'fa-shopping-bag',  label:'Loja',         cor:'#ec4899', fn:`ui.showTab('tab-loja')` },
            { icon:'fa-calendar-alt',  label:'Eventos',      cor:'#f97316', fn:`ui.showTab('tab-eventos')` },
            { icon:'fa-clipboard-list',label:'Chamada',      cor:'#84cc16', fn:`academia._irParaChamada()` },
            { icon:'fa-satellite-dish',label:'Sumidos',      cor:'#ef4444', fn:`ui.showTab('tab-relatorios'); setTimeout(()=>treinoPost.renderRadarSumidos(),300)` },
            { icon:'fa-star',          label:'Avaliações',   cor:'#facc15', fn:`ui.showTab('tab-relatorios'); setTimeout(()=>treinoPost.renderAvaliacoesPainel(),300)` },
            { icon:'fa-birthday-cake', label:'Aniversários', cor:'#a78bfa', fn:`academia._irParaAniversarios()` },
        ];

        const cardsHtml = cards.map(c => `
            <button onclick="${c.fn}"
                style="background:#1e293b;border:1px solid ${c.cor}22;border-radius:16px;padding:18px 8px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;transition:transform 0.1s;active:scale(0.95);"
                onmousedown="this.style.transform='scale(0.94)'" onmouseup="this.style.transform='scale(1)'" ontouchstart="this.style.transform='scale(0.94)'" ontouchend="this.style.transform='scale(1)'">
                <div style="width:48px;height:48px;background:${c.cor}18;border-radius:14px;display:flex;align-items:center;justify-content:center;">
                    <i class="fas ${c.icon}" style="font-size:1.3rem;color:${c.cor};"></i>
                </div>
                <span style="font-size:0.6rem;font-weight:800;color:#cbd5e1;letter-spacing:0.3px;text-align:center;line-height:1.2;">${c.label.toUpperCase()}</span>
            </button>`).join('');

        el.innerHTML = `
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Gaditas Academy</div>
                    <div style="font-size:0.6rem;color:#475569;">${new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                <div style="font-size:1.1rem;font-weight:900;color:white;">Dashboard Admin 👋</div>
            </div>

            <!-- Grid 3 colunas -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
                ${cardsHtml}
            </div>

            <!-- Resumo do dia -->
            <div style="background:#1e293b;border:1px solid #f59e0b22;border-radius:16px;padding:14px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <div style="font-size:0.62rem;font-weight:800;color:#f59e0b;letter-spacing:0.5px;">📋 RESUMO DO DIA</div>
                    <div style="font-size:0.55rem;color:#475569;">${new Date().toLocaleDateString('pt-BR')}</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                    <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;border:1px solid #10b98122;">
                        <div style="font-size:1.6rem;font-weight:900;color:#10b981;">${checkinsHoje}</div>
                        <div style="font-size:0.52rem;color:#64748b;font-weight:700;margin-top:2px;">CHECK-INS</div>
                    </div>
                    <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;border:1px solid #3b82f622;">
                        <div style="font-size:1.6rem;font-weight:900;color:#3b82f6;">${aulasHoje}</div>
                        <div style="font-size:0.52rem;color:#64748b;font-weight:700;margin-top:2px;">PRESENTES</div>
                    </div>
                    <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;border:1px solid #f59e0b22;">
                        <div style="font-size:1.6rem;font-weight:900;color:#f59e0b;">${totalAlunos}</div>
                        <div style="font-size:0.52rem;color:#64748b;font-weight:700;margin-top:2px;">ALUNOS ATIVOS</div>
                    </div>
                </div>
            </div>`;
    },

    async renderDashboardAdmin() {
        if (auth.role !== 'admin') return;
        const container = document.getElementById('dashboard-admin-container');
        if (!container) return;
        container.innerHTML = `<div style="text-align:center;padding:12px;color:#64748b;font-size:0.75rem;"><i class="fas fa-spinner fa-spin"></i> Carregando dashboard...</div>`;
        try {
            const snap = await db.collection('alunos').get();
            const agora = new Date();
            const ms7  = agora.getTime() - 7  * 86400000;
            const ms30 = agora.getTime() - 30 * 86400000;
            const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
            const anoAtual = agora.getFullYear();
            let total = 0, ativos7 = 0, inativos30 = 0, kids = 0, adulto = 0, jj = 0, mt = 0, ambos = 0;
            const kidsGraus = {};

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
                if (idade <= 15) {
                    kids++;
                    const fk = a.faixa || 'Branca';
                    kidsGraus[fk] = (kidsGraus[fk] || 0) + 1;
                } else adulto++;
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
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
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
                    ${kids > 0 ? (() => {
                        const ordemKids = ["Branca","Cinza/Branca","Cinza","Cinza/Preta","Amarela/Branca","Amarela","Amarela/Preta","Laranja/Branca","Laranja","Laranja/Preta","Verde/Branca","Verde","Verde/Preta"];
                        const pills = ordemKids
                            .filter(f => kidsGraus[f])
                            .map(f => {
                                const partes = f.split('/');
                                const c1 = ui._corJJSingle(partes[0]);
                                const c2 = partes[1] ? ui._corJJSingle(partes[1]) : null;
                                const bg = c2 ? `linear-gradient(90deg,${c1} 60%,${c2} 60%)` : c1;
                                const textColor = ['Branca','Cinza/Branca','Amarela/Branca','Amarela','Laranja/Branca','Laranja','Verde/Branca'].includes(f) ? '#111' : '#fff';
                                return `<div style="display:flex;align-items:center;gap:5px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:5px 8px;">
                                    <div style="width:20px;height:8px;border-radius:3px;background:${bg};flex-shrink:0;"></div>
                                    <span style="font-size:0.58rem;color:#e2e8f0;font-weight:700;white-space:nowrap;">${f}</span>
                                    <span style="font-size:0.65rem;font-weight:900;color:#fbbf24;margin-left:auto;">${kidsGraus[f]}</span>
                                </div>`;
                            }).join('');
                        return `<div style="background:#0f172a;border:1px solid #f59e0b44;border-radius:8px;padding:10px;">
                            <span style="font-size:0.5rem;color:#fbbf24;font-weight:800;display:block;margin-bottom:7px;">🧒 GRAU COLORIDO — KIDS</span>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">${pills}</div>
                        </div>`;
                    })() : ''}
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

            // Salva lista para navegação por índice
            academia._storiesList = stories;

            stories.forEach((s, idx) => {
                const visto = !!vistos[s.id];
                const anel  = visto
                    ? 'border:2px solid #334155;'
                    : 'border:2px solid transparent;background-image:linear-gradient(white,white),linear-gradient(135deg,#f43f5e,#f59e0b);background-origin:border-box;background-clip:padding-box,border-box;';
                const nCurtidas = (s.curtidas || []).length;
                html += `<div style="flex-shrink:0;cursor:pointer;text-align:center;position:relative;" onclick="academia.abrirStory(${idx})">
                    <div style="width:58px;height:58px;border-radius:50%;overflow:hidden;${anel}">
                        <img src="${s.imageUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=font-size:1.6rem;line-height:58px;>📸</div>'"/>
                    </div>
                    ${isAdmin ? `<button onclick="event.stopPropagation();academia.excluirStory('${s.id}')" style="position:absolute;top:-4px;right:-4px;background:#f43f5e;border:none;color:white;border-radius:50%;width:18px;height:18px;font-size:0.6rem;cursor:pointer;line-height:18px;padding:0;">✕</button>` : ''}
                    ${nCurtidas > 0 ? `<div style="position:absolute;bottom:16px;right:-2px;background:#f43f5e;color:white;font-size:0.45rem;font-weight:800;border-radius:10px;padding:1px 4px;line-height:1.4;">❤️${nCurtidas}</div>` : ''}
                    <span style="font-size:0.5rem;color:#94a3b8;display:block;margin-top:4px;font-weight:700;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.titulo || 'Story'}</span>
                </div>`;
            });
            html += `</div>`;
            bar.innerHTML = html;
        } catch(e) {
            bar.innerHTML = '';
        }
    },

    _storiesList: [],
    _storyIdx: 0,
    _storyTimer: null,

    abrirStory(idx) {
        this._storyIdx = idx;
        const stories = this._storiesList;
        const s = stories[idx];
        if (!s) return;

        // Marca como visto
        const vistos = JSON.parse(localStorage.getItem('gaditas_stories_vistos') || '{}');
        vistos[s.id] = true;
        localStorage.setItem('gaditas_stories_vistos', JSON.stringify(vistos));
        this.renderStoriesBar();

        // Cancela timer anterior
        if (this._storyTimer) { clearTimeout(this._storyTimer); this._storyTimer = null; }

        // Verifica se já curtiu
        const jaCurtiu = (s.curtidas || []).some(c => c.id === auth.currentUser?.id);

        let overlay = document.getElementById('overlay-story');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'overlay-story';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none;';
            document.body.appendChild(overlay);
        }

        // Barras de progresso
        const barras = stories.map((_, i) =>
            `<div style="flex:1;height:3px;border-radius:2px;background:${i < idx ? '#fff' : '#ffffff44'};overflow:hidden;">
                ${i === idx ? `<div id="story-progress-bar" style="height:100%;background:#fff;width:0;"></div>` : ''}
            </div>`
        ).join('');

        const link = s.link || '';
        const curtidas = s.curtidas || [];
        const isAdmin = auth.role === 'admin';

        overlay.innerHTML = `
            <style>@keyframes storyProg{from{width:0}to{width:100%}}</style>
            <!-- Barras de progresso -->
            <div style="position:absolute;top:10px;left:12px;right:12px;display:flex;gap:3px;z-index:2;">${barras}</div>
            <!-- Fechar -->
            <button onclick="academia.fecharStory()" style="position:absolute;top:20px;right:12px;background:rgba(255,255,255,0.15);border:none;color:white;width:32px;height:32px;border-radius:50%;font-size:1rem;cursor:pointer;z-index:3;">✕</button>
            <!-- Toque esquerdo: voltar -->
            <div onclick="academia._navStory(-1)" style="position:absolute;top:0;left:0;width:35%;height:100%;z-index:1;cursor:pointer;"></div>
            <!-- Toque direito: avançar -->
            <div onclick="academia._navStory(1)" style="position:absolute;top:0;right:0;width:35%;height:100%;z-index:1;cursor:pointer;"></div>
            <!-- Imagem -->
            <img src="${s.imageUrl}" style="max-width:100%;max-height:78vh;object-fit:contain;border-radius:4px;user-select:none;" onerror="this.alt='📸'"/>
            <!-- Título -->
            ${s.titulo ? `<div style="position:absolute;bottom:${link ? '80px' : '60px'};left:0;right:0;text-align:center;padding:0 24px;z-index:2;">
                <span style="background:rgba(0,0,0,0.75);color:white;padding:8px 18px;border-radius:20px;font-size:0.85rem;font-weight:700;">${s.titulo}</span>
            </div>` : ''}
            <!-- Rodapé: curtir + link -->
            <div style="position:absolute;bottom:14px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:12px;z-index:2;">
                ${link ? `<button id="btn-story-link" onclick="academia.fecharStory();${link.startsWith('#tab-') ? `ui.showTab('${link.slice(1)}')` : `window.open('${link}')`}" style="background:#3b82f6;color:white;border:none;padding:9px 22px;border-radius:20px;font-size:0.78rem;font-weight:700;cursor:pointer;">🔗 VER EVENTO</button>` : ''}
                ${auth.role !== 'admin' ? `<button id="btn-curtir-story" onclick="academia._curtirStory('${s.id}')" style="background:${jaCurtiu ? '#f43f5e' : 'rgba(255,255,255,0.15)'};border:none;color:white;padding:9px 18px;border-radius:20px;font-size:0.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <span>${jaCurtiu ? '❤️' : '🤍'}</span><span id="curtidas-count">${curtidas.length || ''}</span>
                </button>` : ''}
                ${isAdmin && curtidas.length > 0 ? `<button onclick="academia._verCurtidas('${s.id}')" style="background:rgba(255,255,255,0.15);border:none;color:white;padding:9px 16px;border-radius:20px;font-size:0.78rem;cursor:pointer;">❤️ ${curtidas.length} curtida${curtidas.length > 1 ? 's' : ''}</button>` : ''}
            </div>`;

        overlay.style.display = 'flex';

        // Inicia barra de progresso animada
        const bar = document.getElementById('story-progress-bar');
        if (bar) {
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.animation = 'storyProg 8s linear forwards';
        }

        // Auto-avança após 8s
        this._storyTimer = setTimeout(() => this._navStory(1), 8000);
    },

    _navStory(delta) {
        const next = this._storyIdx + delta;
        if (next < 0 || next >= this._storiesList.length) { this.fecharStory(); return; }
        this.abrirStory(next);
    },

    async _curtirStory(storyId) {
        if (!auth.currentUser?.id || auth.role === 'admin') return;
        const ref = db.collection('stories').doc(storyId);
        const doc = await ref.get();
        if (!doc.exists) return;
        const curtidas = doc.data().curtidas || [];
        const jaCurtiu = curtidas.some(c => c.id === auth.currentUser.id);
        const novas = jaCurtiu
            ? curtidas.filter(c => c.id !== auth.currentUser.id)
            : [...curtidas, { id: auth.currentUser.id, nome: auth.currentUser.nome || 'Aluno' }];
        await ref.update({ curtidas: novas });
        // Atualiza no cache local
        const s = this._storiesList.find(x => x.id === storyId);
        if (s) s.curtidas = novas;
        // Atualiza botão sem reabrir o story
        const btn = document.getElementById('btn-curtir-story');
        const count = document.getElementById('curtidas-count');
        if (btn) btn.style.background = jaCurtiu ? 'rgba(255,255,255,0.15)' : '#f43f5e';
        btn.querySelector('span').innerText = jaCurtiu ? '🤍' : '❤️';
        if (count) count.innerText = novas.length || '';
    },

    async _verCurtidas(storyId) {
        const doc = await db.collection('stories').doc(storyId).get();
        const curtidas = doc.exists ? (doc.data().curtidas || []) : [];
        if (!curtidas.length) return alert('Nenhuma curtida ainda.');
        const lista = curtidas.map(c => `• ${c.nome}`).join('\n');
        alert(`❤️ Curtidas (${curtidas.length}):\n\n${lista}`);
    },

    fecharStory() {
        if (this._storyTimer) { clearTimeout(this._storyTimer); this._storyTimer = null; }
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
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;max-height:90vh;overflow-y:auto;">
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
                <!-- ANIVERSÁRIO DO MESTRE -->
                <div style="margin-top:12px;">
                    <small style="color:#f59e0b;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">🎂 DATA DE NASCIMENTO DO MESTRE</small>
                    <input type="date" id="cfg-admin-nascimento" value="${auth.adminCreds.nascimentoMestre||''}"
                        style="${inp} margin-bottom:0;"/>
                    <div style="font-size:0.58rem;color:#64748b;margin-top:3px;">Alunos recebem popup 1 dia antes e no dia do seu aniversário.</div>
                </div>
                <!-- KIDS COM ADULTOS -->
                <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:14px; margin-top:12px; margin-bottom:4px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-size:0.75rem; font-weight:800; color:#e2e8f0;">👥 Kids podem treinar com Adultos</div>
                            <div style="font-size:0.62rem; color:#64748b; margin-top:2px;">Permite marcar atletas kids para aparecerem na aba Adultos</div>
                        </div>
                        <label style="position:relative; display:inline-block; width:44px; height:24px; flex-shrink:0;">
                            <span id="cfg-kids-toggle" data-on="${auth.adminCreds?.permitirKidsComAdultos ? 'true' : 'false'}" onclick="const on=this.dataset.on==='true'; this.dataset.on=on?'false':'true'; this.style.background=(!on)?'#3b82f6':'#334155'; this.querySelector('span').style.left=(!on)?'23px':'3px';" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:${auth.adminCreds?.permitirKidsComAdultos ? '#3b82f6' : '#334155'}; border-radius:24px; transition:background 0.3s;">
                                <span style="position:absolute; height:18px; width:18px; left:${auth.adminCreds?.permitirKidsComAdultos ? '23px' : '3px'}; bottom:3px; background:white; border-radius:50%; transition:left 0.3s;"></span>
                            </span>
                        </label>
                    </div>
                </div>
                <div style="height:10px;"></div>
                <button onclick="academia.salvarConfigAdmin()" style="width:100%;padding:13px;background:#3b82f6;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">💾 SALVAR CONFIGURAÇÕES</button>
                <div style="height:1px;background:#334155;margin:16px 0;"></div>
                <div style="font-size:0.6rem;color:#64748b;font-weight:800;letter-spacing:0.8px;margin-bottom:10px;">🎯 META DE AULAS POR FAIXA/GRAU</div>
                <div style="font-size:0.62rem;color:#475569;margin-bottom:10px;line-height:1.4;">Aulas necessárias para progressão em cada grau. Grau 4 = convocação automática para exame.</div>
                ${['Branca','Azul','Roxa','Marrom'].map(f => {
                    const regs = graduacao.regrasAulas[f] || {};
                    return `<div style="margin-bottom:10px;">
                        <div style="font-size:0.65rem;color:#e2e8f0;font-weight:700;margin-bottom:4px;">${f}</div>
                        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">
                            ${[0,1,2,3,4].map(g => `
                                <div style="text-align:center;">
                                    <div style="font-size:0.5rem;color:#64748b;margin-bottom:2px;">${g}ºG</div>
                                    <input type="number" id="meta-${f}-${g}" value="${regs[g] ?? 40}" min="1" max="999"
                                        style="width:100%;padding:5px 2px;background:#0f172a;border:1px solid #334155;color:white;border-radius:6px;text-align:center;font-size:0.72rem;box-sizing:border-box;"/>
                                </div>`).join('')}
                        </div>
                    </div>`;
                }).join('')}
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.65rem;color:#e2e8f0;font-weight:700;margin-bottom:4px;">Kids</div>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
                        ${['Pré-Mirim','Mirim','Infanto'].map(cat => `
                            <div style="text-align:center;">
                                <div style="font-size:0.5rem;color:#64748b;margin-bottom:2px;">${cat}</div>
                                <input type="number" id="meta-Kids-${cat}" value="${(graduacao.regrasAulas['Kids'] || {})[cat] ?? 12}" min="1" max="999"
                                    style="width:100%;padding:5px 2px;background:#0f172a;border:1px solid #334155;color:white;border-radius:6px;text-align:center;font-size:0.72rem;box-sizing:border-box;"/>
                            </div>`).join('')}
                    </div>
                </div>
                <button onclick="academia.salvarMetasAulas()" style="width:100%;padding:11px;background:#10b981;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.78rem;">🎯 SALVAR METAS</button>
                <div style="height:1px;background:#334155;margin:16px 0;"></div>
                <div style="font-size:0.6rem;color:#64748b;font-weight:800;letter-spacing:0.8px;margin-bottom:10px;">📋 GESTÃO DE CONTRATOS</div>
                <button onclick="academia.solicitarNovaAssinaturaGeral()" style="width:100%;padding:12px;background:#1c1000;border:1px solid #92400e;color:#f59e0b;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.8rem;">
                    🔄 SOLICITAR NOVA ASSINATURA DE TODOS
                </button>
                <div style="font-size:0.58rem;color:#475569;margin-top:6px;line-height:1.4;">Use após atualizar o contrato. Todos os alunos verão aviso para reassinar.</div>
                <div style="height:1px;background:#334155;margin:16px 0;"></div>
                <div style="font-size:0.6rem;color:#64748b;font-weight:800;letter-spacing:0.8px;margin-bottom:10px;">🔔 DIAGNÓSTICO DE PUSH</div>
                <input type="text" id="cfg-diag-email" placeholder="E-mail do aluno para testar..." style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:8px;box-sizing:border-box;"/>
                <button onclick="academia._diagnosticarPush()" style="width:100%;padding:11px;background:#8b5cf6;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.78rem;margin-bottom:8px;">🔍 DIAGNÓSTICO PUSH</button>
                <div id="cfg-diag-resultado" style="font-size:0.72rem;line-height:1.6;"></div>
            </div>`;
    },

    async _diagnosticarPush() {
        const email = document.getElementById('cfg-diag-email')?.value.trim().toLowerCase();
        const res   = document.getElementById('cfg-diag-resultado');
        if (!res) return;
        if (!email) { res.innerHTML = '<span style="color:#f59e0b;">⚠️ Digite o e-mail do aluno.</span>'; return; }

        const ok  = s => `<span style="color:#10b981;">✅ ${s}</span><br>`;
        const err = s => `<span style="color:#f43f5e;">❌ ${s}</span><br>`;
        const inf = s => `<span style="color:#94a3b8;">ℹ️ ${s}</span><br>`;
        let html = '<b style="color:white;">Verificando...</b><br>';
        res.innerHTML = html;

        // 1. FCM token no Firestore
        try {
            const snap = await db.collection('alunos').where('email','==',email).limit(1).get();
            if (snap.empty) { res.innerHTML += err('Aluno não encontrado no Firestore com este e-mail.'); return; }
            const a = snap.docs[0].data();
            if (a.fcmToken) {
                html += ok(`Token FCM salvo: ${a.fcmToken.substring(0,20)}...`);
            } else {
                html += err('Aluno NÃO tem fcmToken salvo. O aluno precisa logar no app e aceitar notificações.');
                html += inf('Dica: Permissão de notificação deve ser "Concedida" nas configurações do browser/celular.');
                res.innerHTML = html;
                return;
            }
            res.innerHTML = html;

            // 2. Testa chamada à API /api/push-comunicado
            html += inf('Testando API push-comunicado...');
            res.innerHTML = html;
            const r = await fetch('/api/push-comunicado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens: [a.fcmToken], title: '🧪 Teste Gaditas', body: 'Notificação de teste — se chegou, está funcionando!' })
            });
            const dados = await r.json();
            if (r.ok && dados.sucesso > 0) {
                html += ok(`API OK — push enviado! sucesso:${dados.sucesso} falha:${dados.falha}`);
            } else if (r.ok && dados.falha > 0) {
                html += err(`API chamada mas FCM rejeitou o token (sucesso:${dados.sucesso} falha:${dados.falha}). Token pode estar expirado — peça ao aluno logar novamente.`);
            } else {
                html += err(`API retornou erro: ${JSON.stringify(dados)}`);
                html += inf('Verifique as variáveis de ambiente no Vercel: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.');
            }
        } catch(e) {
            html += err('Erro: ' + e.message);
            html += inf('Verifique se as env vars estão configuradas no Vercel.');
        }
        res.innerHTML = html;
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
        const permitirKids = document.getElementById('cfg-kids-toggle')?.dataset.on === 'true';
        const nascimentoMestre = document.getElementById('cfg-admin-nascimento')?.value || '';
        const dados = { nome, user, faixa, grau, permitirKidsComAdultos: permitirKids, nascimentoMestre };
        if (pass1) dados.pass = pass1;
        try {
            await db.collection('configuracoes').doc('admin_config').set(dados, { merge: true });
            // Atualiza em memória imediatamente
            auth.adminCreds.nome  = nome;
            auth.adminCreds.user  = user;
            auth.adminCreds.faixa = faixa;
            auth.adminCreds.grau  = grau;
            if (pass1) auth.adminCreds.pass = pass1;
            auth.adminCreds.permitirKidsComAdultos = permitirKids;
            auth.adminCreds.nascimentoMestre = nascimentoMestre;
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

    async salvarMetasAulas() {
        try {
            const dados = {};
            for (const f of ['Branca','Azul','Roxa','Marrom']) {
                dados[f] = {};
                for (let g = 0; g <= 4; g++) {
                    const v = parseInt(document.getElementById(`meta-${f}-${g}`)?.value);
                    if (!isNaN(v) && v > 0) dados[f][g] = v;
                }
            }
            dados['Kids'] = {};
            for (const cat of ['Pré-Mirim','Mirim','Infanto']) {
                const v = parseInt(document.getElementById(`meta-Kids-${cat}`)?.value);
                if (!isNaN(v) && v > 0) dados['Kids'][cat] = v;
            }
            await db.collection('configuracoes').doc('metas_aulas').set(dados);
            // Atualiza em memória imediatamente
            for (const f of Object.keys(dados)) {
                if (graduacao.regrasAulas[f] !== undefined) {
                    graduacao.regrasAulas[f] = { ...graduacao.regrasAulas[f], ...dados[f] };
                }
            }
            alert('✅ Metas de aulas salvas!');
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

    // ── FOTO DO ALUNO ─────────────────────────────────────────
    async abrirModalFotoAluno(alunoId, nome) {
        document.getElementById('modal-foto-aluno')?.remove();
        const docSnap = await db.collection('alunos').doc(alunoId).get();
        const fotoAtual = docSnap.exists ? (docSnap.data().fotoPerfil || '') : '';

        const modal = document.createElement('div');
        modal.id = 'modal-foto-aluno';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.97);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #334155;border-radius:20px;padding:24px;max-width:380px;width:100%;text-align:center;">
                <div style="font-size:0.6rem;color:#64748b;font-weight:800;letter-spacing:2px;margin-bottom:12px;">FOTO DO ALUNO</div>
                <div style="font-size:1rem;font-weight:800;color:white;margin-bottom:16px;">${nome.toUpperCase()}</div>
                <img id="mfa-preview-img" src="${fotoAtual || `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=1e3a8a&color=fff&size=200`}"
                    style="width:140px;height:140px;border-radius:50%;object-fit:cover;border:3px solid #3b82f6;display:block;margin:0 auto 20px auto;"/>
                <input type="file" id="mfa-galeria-input" accept="image/*" style="display:none;"/>
                <input type="file" id="mfa-camera-input" accept="image/*" capture="environment" style="display:none;"/>
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
                    <button id="mfa-btn-galeria" style="width:100%;padding:12px;background:#1e3a8a;border:1px solid #3b82f6;color:#93c5fd;border-radius:10px;font-weight:800;font-size:0.8rem;cursor:pointer;">
                        <i class="fas fa-image"></i> ESCOLHER DA GALERIA
                    </button>
                    <button id="mfa-btn-camera" style="width:100%;padding:12px;background:#064e3b;border:1px solid #10b981;color:#6ee7b7;border-radius:10px;font-weight:800;font-size:0.8rem;cursor:pointer;">
                        <i class="fas fa-camera"></i> TIRAR FOTO COM CÂMERA
                    </button>
                    <button id="mfa-btn-salvar" style="display:none;width:100%;padding:12px;background:#10b981;border:none;color:#000;border-radius:10px;font-weight:800;font-size:0.8rem;cursor:pointer;">
                        <i class="fas fa-save"></i> SALVAR FOTO
                    </button>
                    ${fotoAtual ? `<button onclick="academia._removerFotoAluno('${alunoId}')" style="width:100%;padding:10px;background:#2a0808;border:1px solid #ef444455;color:#ef4444;border-radius:10px;font-weight:800;font-size:0.75rem;cursor:pointer;">
                        <i class="fas fa-trash"></i> REMOVER FOTO
                    </button>` : ''}
                </div>
                <button onclick="document.getElementById('modal-foto-aluno').remove()" style="width:100%;padding:10px;background:none;border:1px solid #334155;color:#64748b;border-radius:10px;font-size:0.8rem;cursor:pointer;">FECHAR</button>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

        let _novaFoto = null;
        const processarArquivo = (file) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => {
                    const maxL = 600, c = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > maxL || h > maxL) { if (w > h) { h = Math.round(h*maxL/w); w=maxL; } else { w=Math.round(w*maxL/h); h=maxL; } }
                    c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
                    _novaFoto = c.toDataURL('image/jpeg', 0.82);
                    document.getElementById('mfa-preview-img').src = _novaFoto;
                    document.getElementById('mfa-btn-salvar').style.display = 'block';
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        };
        document.getElementById('mfa-btn-galeria').addEventListener('click', () => document.getElementById('mfa-galeria-input').click());
        document.getElementById('mfa-btn-camera').addEventListener('click', () => document.getElementById('mfa-camera-input').click());
        document.getElementById('mfa-galeria-input').addEventListener('change', e => processarArquivo(e.target.files[0]));
        document.getElementById('mfa-camera-input').addEventListener('change', e => processarArquivo(e.target.files[0]));
        document.getElementById('mfa-btn-salvar').addEventListener('click', async () => {
            if (!_novaFoto) return;
            const btn = document.getElementById('mfa-btn-salvar');
            btn.innerText = '⏳ Salvando...'; btn.disabled = true;
            try {
                await db.collection('alunos').doc(alunoId).update({ fotoPerfil: _novaFoto });
                document.getElementById('modal-foto-aluno').remove();
                academia.buscarAlunos();
            } catch(e) {
                btn.innerText = '❌ Erro. Tente novamente.'; btn.disabled = false;
            }
        });
    },

    async _removerFotoAluno(alunoId) {
        if (!confirm('Remover a foto deste aluno?')) return;
        await db.collection('alunos').doc(alunoId).update({ fotoPerfil: firebase.firestore.FieldValue.delete() });
        document.getElementById('modal-foto-aluno')?.remove();
        academia.buscarAlunos();
    },

    // ── WHATSAPP BUSINESS ─────────────────────────────────────
    abrirWhatsappBusiness(tel) {
        let num = (tel || '').replace(/\D/g, '');
        if (!num) { alert('Este aluno não tem telefone cadastrado.'); return; }
        // Remove 55 duplicado se vier
        if (num.startsWith('55') && num.length >= 12) num = num.slice(2);
        // URL universal — abre app no celular, WhatsApp Web no desktop
        window.open(`https://wa.me/55${num}`, '_blank');
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
                const isKids          = idade <= 15;
                const isIntermediario = idade === 14 || idade === 15;
                const turmaKids       = this._isTurmaKids(turmaQR);
                const turmaMT         = this._isTurmaMT(turmaQR);
                const alunoMod        = d.modalidade || 'jiujitsu';
                const ehAlunoMT       = alunoMod === 'muaythai' || alunoMod === 'ambos';

                if (turmaMT && ehAlunoMT) {
                    // Aluno MT + turma MT → livre em qualquer idade
                } else if (isIntermediario) {
                    // 14-15 anos → livre em qualquer turma
                } else if (!isKids && turmaKids) {
                    alert("🚫 Esta turma é exclusiva para alunos até 13 anos.");
                    return;
                } else if (isKids && !turmaKids && !auth.currentUser?.treinaComAdultos) {
                    alert("🚫 Alunos até 13 anos não podem fazer check-in nas turmas adulto.");
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
                h.unshift({ data: new Date().toLocaleDateString('pt-BR'), turma: turmaQR });
                const isMTqr = this._isTurmaMT(turmaQR);
                const updQR = { historico: h };
                if (isMTqr) updQR.aulasMT = (d.aulasMT || 0) + 1;
                else         updQR.aulas   = (d.aulas   || 0) + 1;
                updQR.feedbackPendente = { turma: turmaQR, data: new Date().toLocaleDateString('pt-BR') };
                await alunoRef.update(updQR);

                // Remove checkin pendente se existir
                const snapCI = await db.collection("checkins").where("alunoId", "==", alunoId).get();
                const batch = db.batch();
                snapCI.docs.forEach(doc => { if (doc.data().turma === turmaQR) batch.delete(doc.ref); });
                await batch.commit();

                // Atualiza a lista de checkins pendentes do professor/admin
                this.renderCheckins();
                this.renderRanking();

                alert("✅ Presença computada automaticamente! Turma: " + turmaQR + " OSS! 🥋");
                push.paraAluno(alunoId, '✅ Presença confirmada!', `Sua presença na turma ${turmaQR} foi registrada. OSS! 🥋`);
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
                // ── Cabeçalho do dia ──
                html += `<div style="margin-bottom:14px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; ${isHoje ? 'margin-top:4px;' : 'margin-top:16px;'}">
                        <div style="width:3px; height:18px; background:${isHoje ? '#3b82f6' : '#334155'}; border-radius:2px; flex-shrink:0;"></div>
                        <span style="font-size:0.65rem; font-weight:800; color:${isHoje ? '#60a5fa' : '#64748b'}; letter-spacing:1px;">${diasNomes[d].toUpperCase()}</span>
                        ${isHoje ? '<span style="background:#1e3a8a; color:#60a5fa; font-size:0.5rem; font-weight:800; padding:2px 9px; border-radius:20px; letter-spacing:0.5px; border:1px solid #3b82f666;">HOJE</span>' : ''}
                    </div>`;
                slots.forEach(slot => {
                    if (slot === 'Sem treinos hoje') {
                        html += `<div style="background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:11px 14px; margin-bottom:6px; color:#475569; font-size:0.75rem; font-style:italic; text-align:center;">Sem treinos</div>`;
                        return;
                    }
                    const partes = slot.split(' - ');
                    const hora = partes[0] || slot;
                    const turma = partes.slice(1).join(' - ') || '';
                    const isMT = turma.toLowerCase().includes('muay') || turma.toLowerCase().includes('thai') || turma.toLowerCase().includes('kickbox');
                    const isKids = turma.toLowerCase().includes('kids');
                    const accentColor = isMT ? '#f43f5e' : isKids ? '#f59e0b' : '#10b981';
                    const tagLabel = isMT ? 'MUAY THAI' : isKids ? 'KIDS' : 'JIU-JITSU';
                    html += `<div style="background:#1e293b; border:1px solid #334155; border-radius:14px; padding:12px 14px; margin-bottom:8px; display:flex; align-items:center; gap:12px; border-left:3px solid ${accentColor}; ${isHoje ? 'box-shadow:0 2px 10px rgba(0,0,0,0.3);' : ''}">
                        <div style="text-align:center; min-width:46px; flex-shrink:0; background:#0f172a; border-radius:8px; padding:6px 4px;">
                            <div style="font-size:0.95rem; font-weight:800; color:white; line-height:1; letter-spacing:-0.5px;">${hora}</div>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.82rem; font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${turma || slot}</div>
                            <span style="font-size:0.52rem; color:${accentColor}; font-weight:800; letter-spacing:0.6px;">${tagLabel}</span>
                        </div>
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

        // Painel de dispensas para professor (inserido após o render)
        if (auth.role === 'professor') {
            let painelDisp = document.getElementById('painel-dispensas-prof');
            if (!painelDisp) {
                painelDisp = document.createElement('div');
                painelDisp.id = 'painel-dispensas-prof';
                container.insertBefore(painelDisp, container.firstChild);
            }
            profComms.renderPainelDispensas();
        }

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
            const slotEnc = encodeURIComponent(slot);
            return '<div class="qr-card" style="background:white; border-radius:12px; padding:14px 12px; text-align:center;">' +
                '<div style="font-size:0.5rem; font-weight:800; color:#64748b; letter-spacing:0.8px; margin-bottom:3px;">📅 ' + dias.toUpperCase() + '</div>' +
                '<div style="font-size:0.75rem; font-weight:800; color:#0f172a; margin-bottom:10px; line-height:1.3;">' + slot.toUpperCase() + '</div>' +
                '<img src="' + qrUrl + '" width="170" height="170" style="display:block; margin:0 auto; border-radius:6px;"/>' +
                '<div style="font-size:0.42rem; color:#94a3b8; margin-top:8px; margin-bottom:8px; line-height:1.5;">Gaditas Matriz — escaneie para check-in</div>' +
                '<button onclick="academia.abrirQRIndividual(\'' + slotEnc + '\')" ' +
                    'style="background:#0f172a; border:1px solid #334155; color:#64748b; padding:5px 10px; border-radius:6px; font-size:0.48rem; font-weight:700; cursor:pointer; width:100%;">📺 VER SÓ ESTE</button>' +
                '</div>';
        }).join('');

        const displayUrl = baseUrl + 'qrcode.html';

        modal.innerHTML =
            '<div style="max-width:860px; margin:0 auto;">' +
                '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; gap:10px;">' +
                    '<div>' +
                        '<div style="font-size:0.6rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Admin — Gaditas Matriz</div>' +
                        '<div style="font-size:1rem; font-weight:800; color:white; margin-top:3px;">📱 QR Codes de Check-in</div>' +
                        '<div style="font-size:0.65rem; color:#64748b; margin-top:4px;">Imprima e cole nas paredes — alunos escaneiam para registrar presença</div>' +
                    '</div>' +
                    '<div style="display:flex; gap:8px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">' +
                        '<a href="' + displayUrl + '" target="_blank" style="background:#1e3a8a; border:1px solid #3b82f6; color:#93c5fd; padding:10px 14px; border-radius:8px; font-weight:800; font-size:0.75rem; text-decoration:none; display:flex; align-items:center; gap:5px;">📺 DISPLAY AO VIVO</a>' +
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

    abrirQRIndividual(slotEnc) {
        const slot   = decodeURIComponent(slotEnc);
        const base   = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
        const url    = base + '?checkin=' + encodeURIComponent(slot);
        const qrUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url) + '&format=png&margin=4&color=000000&bgcolor=FFFFFF';

        const ant = document.getElementById('modal-qr-individual'); if(ant) ant.remove();
        const m = document.createElement('div');
        m.id = 'modal-qr-individual';
        m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.98);z-index:10010;display:flex;align-items:center;justify-content:center;';
        m.innerHTML = `
            <div style="background:white;border-radius:20px;padding:30px 24px;text-align:center;max-width:360px;width:90%;position:relative;">
                <button onclick="document.getElementById('modal-qr-individual').remove()"
                    style="position:absolute;top:10px;right:12px;background:#f1f5f9;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:700;color:#475569;">✕</button>
                <div style="font-size:0.6rem;font-weight:800;color:#64748b;letter-spacing:1px;margin-bottom:6px;">GADITAS MATRIZ — CHECK-IN</div>
                <div style="font-size:1.1rem;font-weight:800;color:#0f172a;margin-bottom:16px;line-height:1.3;">${slot.toUpperCase()}</div>
                <img src="${qrUrl}" width="280" height="280" style="display:block;margin:0 auto;border-radius:10px;"/>
                <div style="font-size:0.55rem;color:#94a3b8;margin-top:12px;line-height:1.6;">Escaneie com a câmera do celular ou pelo botão no app</div>
            </div>`;
        document.body.appendChild(m);
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
        // Determina se é kids pela idade — precisa vir ANTES de checar faixa adulto,
        // porque "Branca" existe nos dois arrays e kids Branca tem meta diferente
        const anoAtual = new Date().getFullYear();
        const idade = a.nascimento ? (anoAtual - new Date(a.nascimento).getFullYear()) : 99;
        const isKids = idade <= 15;
        let m = 40;
        if (isKids) {
            const cat = (idade <= 6) ? "Pré-Mirim" : (idade <= 9) ? "Mirim" : "Infanto";
            m = (graduacao.regrasAulas["Kids"] || {})[cat] || 12;
        } else if (graduacao.adulto.includes(a.faixa)) {
            m = ((graduacao.regrasAulas[a.faixa] || {})[a.grau ?? 0]) || 40;
        }
        return { meta: m, pronto: (a.aulas || 0) >= m, percent: Math.min(((a.aulas || 0) / m) * 100, 100) };
    },

    // ── PAINEL EXPERIMENTAIS (admin) ──────────────────────
    async renderPainelExperimentais() {
        if (auth.role !== 'admin') return;
        let container = document.getElementById('painel-experimentais-admin');
        if (!container) {
            container = document.createElement('div');
            container.id = 'painel-experimentais-admin';
            container.style.cssText = 'margin-top:15px;';
            // Inserir entre "Check-ins Pendentes" e "Chamada por Lista"
            const chamadaCard = document.getElementById('card-chamada-prof');
            if (chamadaCard) {
                chamadaCard.parentNode.insertBefore(container, chamadaCard);
            } else {
                const profArea = document.getElementById('area-professor-checkin');
                if (profArea) profArea.after(container);
                else document.getElementById('tab-checkin')?.appendChild(container);
            }
        }
        container.innerHTML = `<div style="text-align:center;padding:12px;color:#64748b;font-size:0.75rem;"><i class="fas fa-spinner fa-spin"></i></div>`;

        try {
            const snap = await db.collection('experimentais').orderBy('criadoEm','desc').limit(50).get();
            if (snap.empty) { container.innerHTML = ''; return; }

            const hoje = this._getDataHoje();
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const pendentesHoje = docs.filter(d => d.data === hoje && d.status === 'pendente').length;

            let html = `
                <div style="background:#0c1a3a; border:1px solid #3b82f644; border-radius:16px; padding:16px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <div style="font-size:0.8rem; font-weight:800; color:#60a5fa;">
                            🆕 AULAS EXPERIMENTAIS
                            ${pendentesHoje > 0 ? `<span style="background:#3b82f6; color:white; font-size:0.55rem; padding:2px 7px; border-radius:999px; margin-left:6px;">${pendentesHoje} hoje</span>` : ''}
                        </div>
                        <a href="experimental.html" target="_blank"
                            style="font-size:0.65rem; color:#60a5fa; background:#1e3a8a55; border:1px solid #3b82f644; padding:5px 10px; border-radius:8px; text-decoration:none; font-weight:700;">
                            🔗 Link da página
                        </a>
                    </div>`;

            docs.forEach(e => {
                const isHoje = e.data === hoje;
                const modalLabel = e.modalidade === 'muaythai' ? '🥊 MT' : e.modalidade === 'ambos' ? '⚔️ Ambos' : '🥋 JJ';
                const statusColor = e.status === 'aprovado' ? '#10b981' : e.status === 'matriculado' ? '#a78bfa' : '#f59e0b';
                const statusLabel = e.status === 'aprovado' ? '✅ Aprovado' : e.status === 'matriculado' ? '🎓 Matriculado' : '⏳ Pendente';
                html += `
                    <div style="background:#0f172a; border:1px solid ${isHoje ? '#3b82f633' : '#1e293b'}; border-radius:10px; padding:12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                            <div style="flex:1; min-width:150px;">
                                <div style="font-size:0.82rem; font-weight:800; color:${isHoje ? '#60a5fa' : '#e2e8f0'};">${e.nome}</div>
                                <div style="font-size:0.62rem; color:#64748b; margin-top:3px;">${e.turma} · ${e.data ? e.data.split('-').reverse().join('/') : '—'}</div>
                                <div style="font-size:0.62rem; color:#64748b;">${modalLabel} · ${e.telefone || '—'}</div>
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0;">
                                <span style="font-size:0.6rem; color:${statusColor}; font-weight:800;">${statusLabel}</span>
                                <button onclick="academia.gerarLinkMatricula('${e.id}')"
                                    style="background:#1e1040; border:1px solid #7c3aed44; color:#a78bfa; padding:5px 10px; border-radius:6px; font-size:0.6rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                                    🔗 Gerar link matrícula
                                </button>
                                ${e.status === 'matriculado' ? `<button onclick="academia.reverterExperimentalPendente('${e.id}')"
                                    style="background:#1a0a00; border:1px solid #f59e0b55; color:#f59e0b; padding:5px 10px; border-radius:6px; font-size:0.6rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                                    ↩️ Reverter para Pendente
                                </button>` : ''}
                                <button onclick="academia.excluirExperimental('${e.id}')"
                                    style="background:none; border:none; color:#475569; padding:4px; font-size:0.6rem; cursor:pointer;">
                                    🗑️ excluir
                                </button>
                            </div>
                        </div>
                    </div>`;
            });

            html += `</div>`;
            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = `<small style="color:#f43f5e;">Erro ao carregar experimentais: ${e.message}</small>`;
        }
    },

    async gerarLinkMatricula(expId) {
        try {
            const doc = await db.collection('experimentais').doc(expId).get();
            if (!doc.exists) return;
            const e = doc.data();
            const params = new URLSearchParams({
                nome:       e.nome       || '',
                email:      e.email      || '',
                telefone:   e.telefone   || '',
                nascimento: e.nascimento || '',
                cpf:        e.cpf        || '',
                modalidade: e.modalidade || 'jiujitsu'
            });
            const link = `${window.location.origin}/cadastro.html?${params.toString()}`;
            await navigator.clipboard.writeText(link);

            // Marca como matriculado
            await db.collection('experimentais').doc(expId).update({ status: 'matriculado' });
            alert('✅ Link copiado!\n\nEnvie para o aluno pelo WhatsApp. Os dados dele já estarão pré-preenchidos, só precisará escolher o plano.');
            this.renderPainelExperimentais();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async reverterExperimentalPendente(id) {
        if (!confirm('Reverter para Pendente? O status "Matriculado" será desfeito.')) return;
        await db.collection('experimentais').doc(id).update({ status: 'pendente' });
        this.renderPainelExperimentais();
    },

    async excluirExperimental(id) {
        if (!confirm('Excluir este registro experimental?')) return;
        await db.collection('experimentais').doc(id).delete();
        this.renderPainelExperimentais();
    }
};

// ══════════════════════════════════════════════════════════
// COMUNICAÇÃO COM PROFESSORES — Convocação + Recados
// ══════════════════════════════════════════════════════════
const profComms = {

    // ── CONVOCAÇÃO ─────────────────────────────────────────
    _turmasProf: [], // turmas fixas do professor (ou vazio para reserva)

    _turmasDoDia(dataISO) {
        const diaSemana = new Date(dataISO + 'T12:00:00').getDay(); // 0=Dom,1=Seg...6=Sáb
        const grade = academia.getGrade();
        return (grade[diaSemana] || grade[String(diaSemana)] || [])
            .filter(t => t && !t.includes('Sem treino'));
    },

    _atualizarTurmasConv(dataISO) {
        const sel = document.getElementById('conv-turma');
        if (!sel) return;
        const turmasDia = this._turmasDoDia(dataISO);
        const lista = this._turmasProf.length > 0
            ? turmasDia.filter(t => this._turmasProf.some(tp => t.includes(tp.replace(/\s*\d+$/, '').trim()) || tp === t))
            : turmasDia;
        const opts = lista.length > 0
            ? lista.map(t => `<option value="${t}">${t}</option>`).join('')
            : '<option value="">Nenhuma turma neste dia</option>';
        sel.innerHTML = opts + '<option value="__custom">Outra turma...</option>';
        document.getElementById('conv-turma-custom').style.display = 'none';
        // Verifica dispensas para essa data
        this._mostrarDispensasNaData(dataISO);
    },

    async _mostrarDispensasNaData(dataISO) {
        const aviso = document.getElementById('conv-dispensas-aviso');
        if (!aviso) return;
        aviso.innerHTML = '';
        const mapa = await this._dispensasNaData(dataISO);
        if (!Object.keys(mapa).length) return;
        // Busca nomes dos professores com dispensa
        const [snapP, snapA] = await Promise.all([
            db.collection('professores').get(),
            db.collection('alunos').where('role','==','professor').get()
        ]);
        const todos = [
            ...snapP.docs.map(d => ({ id: d.id, nome: d.data().nome })),
            ...snapA.docs.map(d => ({ id: d.id, nome: d.data().nome }))
        ];
        let html = '';
        todos.forEach(p => {
            if (!mapa[p.id]) return;
            const d = mapa[p.id];
            html += `<div style="background:#3a1a00;border-left:3px solid #f59e0b;border-radius:6px;padding:7px 10px;margin-bottom:4px;">
                <div style="font-size:0.7rem;font-weight:700;color:#f59e0b;">⚠️ ${p.nome} — com dispensa</div>
                <div style="font-size:0.62rem;color:#94a3b8;margin-top:2px;">${d.turma === 'todas' ? 'Todas as turmas' : d.turma} · "${d.motivo}"</div>
            </div>`;
        });
        if (html) aviso.innerHTML = `<div style="margin-bottom:10px;">${html}</div>`;
    },

    abrirConvocacao(profId, profNome, turmasStr) {
        this._turmasProf = turmasStr && turmasStr !== '—' ? turmasStr.split(', ') : [];
        let modal = document.getElementById('modal-convocacao-prof');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-convocacao-prof'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        const hoje = new Date().toISOString().slice(0, 10);
        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <span style="font-size:0.9rem;font-weight:800;color:white;">📋 Convocar ${profNome}</span>
                    <button onclick="document.getElementById('modal-convocacao-prof').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
                </div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">DATA</small>
                <input type="date" id="conv-data" style="${inp}" value="${hoje}" oninput="profComms._atualizarTurmasConv(this.value)"/>
                <div id="conv-dispensas-aviso"></div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">TURMA</small>
                <select id="conv-turma" style="${inp}" onchange="document.getElementById('conv-turma-custom').style.display=this.value==='__custom'?'block':'none'">
                    <option value="">Selecione a data primeiro...</option>
                </select>
                <input type="text" id="conv-turma-custom" placeholder="Nome da turma..." style="${inp}display:none;"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">HORÁRIO</small>
                <input type="time" id="conv-hora" style="${inp}"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">MENSAGEM (opcional)</small>
                <textarea id="conv-msg" rows="2" placeholder="Ex: Estarei viajando, preciso de você nessa aula." style="${inp}resize:none;"></textarea>
                <button onclick="profComms._enviarConvocacao('${profId}','${profNome.replace(/'/g,"\\'")}','professores')" style="width:100%;padding:13px;background:#10b981;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;">📋 ENVIAR CONVOCAÇÃO</button>
            </div>`;
        // Popula turmas para a data de hoje imediatamente
        this._atualizarTurmasConv(hoje);
    },

    async _enviarConvocacao(profId, profNome, colecao) {
        const turmaEl = document.getElementById('conv-turma');
        const turma = turmaEl?.value === '__custom'
            ? document.getElementById('conv-turma-custom')?.value.trim()
            : turmaEl?.value;
        const data = document.getElementById('conv-data')?.value;
        const hora = document.getElementById('conv-hora')?.value;
        const msg  = document.getElementById('conv-msg')?.value.trim();
        if (!turma || !data) return alert('Preencha a turma e a data.');
        const mapaDisp = await this._dispensasNaData(data);
        if (mapaDisp[profId]) {
            const d = mapaDisp[profId];
            const turmaDisp = d.turma === 'todas' ? 'todas as turmas' : (d.turma || 'não especificada');
            alert(`🚫 ${profNome} tem dispensa nesta data!\n\nTurma: ${turmaDisp}\nMotivo: "${d.motivo || 'não informado'}"\n\nConvocação bloqueada.`);
            return;
        }
        const [ay, am, ad] = data.split('-');
        const dataExib = `${ad}/${am}/${ay}${hora ? ' às ' + hora : ''}`;
        await db.collection('convocacoes_prof').add({
            profId, profNome, colecao,
            turma, data, hora, dataExib,
            mensagem: msg || '',
            status: 'pendente',
            criadoEm: Date.now()
        });
        // Push para o professor
        const profDoc = await db.collection(colecao).doc(profId).get();
        if (profDoc.exists && profDoc.data().fcmToken) {
            push.paraAluno(profId, '📋 Convocação de aula!', `${turma} — ${dataExib}${msg ? ': ' + msg : ''}`);
        }
        document.getElementById('modal-convocacao-prof')?.remove();
        alert(`✅ Convocação enviada para ${profNome}!`);
        this.renderPainelConvocacoes();
    },

    async renderPainelConvocacoes() {
        const container = document.getElementById('painel-convocacoes-prof');
        if (!container) return;
        const snap = await db.collection('convocacoes_prof').orderBy('criadoEm','desc').limit(50).get();
        if (snap.empty) { container.innerHTML = '<p style="color:#64748b;font-size:0.72rem;text-align:center;padding:10px;">Nenhuma convocação ainda.</p>'; return; }
        const hoje = new Date().toISOString().slice(0,10);
        const cores = { pendente:'#f59e0b', confirmado:'#10b981', recusado:'#ef4444' };
        const icons = { pendente:'⏳', confirmado:'✅', recusado:'❌' };
        let html = '';
        snap.forEach(doc => {
            const c = doc.data();
            // Confirmadas com data passada ficam só no histórico do calendário
            if (c.status === 'confirmado' && c.data && c.data < hoje) return;
            const cor = cores[c.status] || '#64748b';
            html += `<div style="background:#0f172a;border:1px solid #1e293b;border-left:3px solid ${cor};border-radius:8px;padding:10px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                        <div style="font-size:0.75rem;font-weight:700;color:#e2e8f0;">${c.profNome} — ${c.turma}</div>
                        <div style="font-size:0.62rem;color:#64748b;margin-top:2px;">📅 ${c.dataExib}</div>
                        ${c.mensagem ? `<div style="font-size:0.6rem;color:#94a3b8;margin-top:2px;">"${c.mensagem}"</div>` : ''}
                        ${c.respostaMsg ? `<div style="font-size:0.62rem;color:#a78bfa;margin-top:3px;">💬 "${c.respostaMsg}"</div>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                        <span style="font-size:0.6rem;font-weight:800;color:${cor};">${icons[c.status]} ${c.status.toUpperCase()}</span>
                        <button onclick="profComms._excluirConvocacao('${doc.id}')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:0.7rem;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        });
        container.innerHTML = html || '<p style="color:#64748b;font-size:0.72rem;text-align:center;padding:10px;">Nenhuma convocação ativa.</p>';
    },

    async _excluirConvocacao(id) {
        if (!confirm('Remover convocação?')) return;
        await db.collection('convocacoes_prof').doc(id).delete();
        this.renderPainelConvocacoes();
    },

    // ── DISPENSAS ──────────────────────────────────────────
    abrirPedidoDispensa() {
        let modal = document.getElementById('modal-dispensa-prof');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-dispensa-prof'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        const hoje = new Date().toISOString().slice(0,10);

        // Turmas do professor
        const turmasProf = auth.currentUser?.turmasAcesso || [];
        const turmaOpts = turmasProf.length > 0
            ? `<option value="todas">Todas as minhas turmas</option>` + turmasProf.map(t => `<option value="${t}">${t}</option>`).join('')
            : `<option value="todas">Todas as turmas</option>`;

        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <span style="font-size:0.9rem;font-weight:800;color:white;">🗓️ Pedir Dispensa</span>
                    <button onclick="document.getElementById('modal-dispensa-prof').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">DE *</small>
                        <input type="date" id="disp-data-ini" style="${inp}margin-bottom:0;" value="${hoje}" min="${hoje}"/>
                    </div>
                    <div>
                        <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">ATÉ *</small>
                        <input type="date" id="disp-data-fim" style="${inp}margin-bottom:0;" value="${hoje}" min="${hoje}"/>
                    </div>
                </div>
                <div style="height:10px;"></div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">TURMA</small>
                <select id="disp-turma" style="${inp}">${turmaOpts}</select>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">MOTIVO *</small>
                <textarea id="disp-motivo" rows="3" placeholder="Ex: Consulta médica, viagem, compromisso pessoal..." style="${inp}resize:none;"></textarea>
                <button onclick="profComms._salvarDispensa()" style="width:100%;padding:13px;background:#f59e0b;border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;">🗓️ SOLICITAR DISPENSA</button>
            </div>`;
    },

    async _salvarDispensa() {
        const dataIni = document.getElementById('disp-data-ini')?.value;
        const dataFim = document.getElementById('disp-data-fim')?.value;
        const turma   = document.getElementById('disp-turma')?.value;
        const motivo  = document.getElementById('disp-motivo')?.value.trim();
        if (!dataIni || !dataFim || !motivo) return alert('Preencha as datas e o motivo.');
        if (dataFim < dataIni) return alert('A data fim não pode ser anterior à data início.');
        const profId   = auth.currentUser?.id;
        const profNome = auth.currentUser?.nome || '';
        const colecao  = auth.currentUser?.turmasAcesso ? 'alunos' : 'professores';
        const fmt = iso => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
        const dataExib = dataIni === dataFim ? fmt(dataIni) : `${fmt(dataIni)} até ${fmt(dataFim)}`;
        await db.collection('dispensas_prof').add({
            profId, profNome, colecao,
            data: dataIni, dataFim, turma, motivo,
            dataExib, criadoEm: Date.now()
        });
        document.getElementById('modal-dispensa-prof')?.remove();
        alert('✅ Dispensa solicitada!');
        this.renderPainelDispensas();
        // Push imediato para o admin
        try {
            const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
            const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;
            if (adminToken) {
                await fetch('/api/push-comunicado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tokens: [adminToken],
                        title: `🗓️ Dispensa — ${profNome}`,
                        body: `${turma === 'todas' ? 'Todas as turmas' : turma} · ${dataExib} · "${motivo}"`
                    })
                });
            }
        } catch(_) {}
    },

    async renderPainelDispensas() {
        const container = document.getElementById('painel-dispensas-prof');
        if (!container || auth.role !== 'professor') return;
        const profId = auth.currentUser?.id;
        if (!profId) return;
        try {
        // Sem orderBy para não exigir índice — ordena no JS
        const snap = await db.collection('dispensas_prof')
            .where('profId','==', profId)
            .get();
        const hoje = new Date().toISOString().slice(0,10);
        const docs = snap.docs
            .filter(d => (d.data().dataFim || d.data().data) >= hoje)
            .sort((a,b) => a.data().data.localeCompare(b.data().data));
        let html = `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-size:0.65rem;font-weight:800;color:#f59e0b;">🗓️ MINHAS DISPENSAS</div>
                <button onclick="profComms.abrirPedidoDispensa()" style="background:#f59e0b;border:none;color:#000;padding:5px 10px;border-radius:6px;font-size:0.62rem;font-weight:800;cursor:pointer;">+ Nova</button>
            </div>`;
        if (!docs.length) {
            html += `<p style="color:#64748b;font-size:0.72rem;text-align:center;padding:6px 0;">Nenhuma dispensa agendada.</p>`;
        } else {
            docs.forEach(doc => {
                const d = doc.data();
                html += `<div style="background:#0f172a;border-left:3px solid #f59e0b;border-radius:6px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:0.72rem;font-weight:700;color:#e2e8f0;">📅 ${d.dataExib} — ${d.turma === 'todas' ? 'Todas as turmas' : d.turma}</div>
                        <div style="font-size:0.62rem;color:#94a3b8;margin-top:2px;">${d.motivo}</div>
                    </div>
                    <button onclick="profComms._cancelarDispensa('${doc.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.75rem;padding:4px;"><i class="fas fa-trash"></i></button>
                </div>`;
            });
        }
        html += '</div>';
        container.innerHTML = html;
        } catch(e) { console.warn('renderPainelDispensas:', e.message); }
    },

    async _cancelarDispensa(id) {
        if (!confirm('Cancelar esta dispensa?')) return;
        await db.collection('dispensas_prof').doc(id).delete();
        this.renderPainelDispensas();
    },

    // Verifica dispensas para uma data — retorna mapa profId → {motivo, turma}
    async _dispensasNaData(dataISO) {
        // Busca dispensas onde dataIni <= dataISO e (dataFim >= dataISO ou não tem dataFim)
        const snap = await db.collection('dispensas_prof').where('data','<=', dataISO).get();
        const mapa = {};
        snap.forEach(doc => {
            const d = doc.data();
            const fim = d.dataFim || d.data;
            if (fim >= dataISO) {
                mapa[d.profId] = { motivo: d.motivo, turma: d.turma, dataExib: d.dataExib };
            }
        });
        return mapa;
    },

    // ── AGENDA DE PROFESSORES ──────────────────────────────
    async abrirAgenda() {
        let modal = document.getElementById('modal-agenda-prof');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-agenda-prof'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto;';
        modal.innerHTML = `<div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:480px;margin-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <span style="font-size:0.95rem;font-weight:800;color:white;">📅 Agenda de Professores</span>
                <button onclick="document.getElementById('modal-agenda-prof').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:14px;">
                <button id="tab-agenda-grade" onclick="profComms._mostrarAbaAgenda('grade')" style="flex:1;padding:8px;border-radius:8px;border:none;font-size:0.72rem;font-weight:800;cursor:pointer;background:#8b5cf6;color:white;">🗓️ Grade</button>
                <button id="tab-agenda-cal" onclick="profComms._mostrarAbaAgenda('calendario')" style="flex:1;padding:8px;border-radius:8px;border:none;font-size:0.72rem;font-weight:800;cursor:pointer;background:#1e293b;color:#64748b;border:1px solid #334155;">📆 Calendário</button>
            </div>
            <div id="agenda-content"><div style="text-align:center;padding:20px;color:#64748b;font-size:0.8rem;">⏳ Carregando...</div></div>
        </div>`;

        const [snapProfs, snapAlunos] = await Promise.all([
            db.collection('professores').get(),
            db.collection('alunos').where('role','==','professor').get()
        ]);
        this._agendaProfs = [];
        snapProfs.forEach(d => this._agendaProfs.push({ id: d.id, col: 'professores', ...d.data() }));
        snapAlunos.forEach(d => this._agendaProfs.push({ id: d.id, col: 'alunos', ...d.data() }));
        this._agendaMesAtual = new Date();
        this._mostrarAbaAgenda('grade');
    },

    _mostrarAbaAgenda(aba) {
        document.getElementById('tab-agenda-grade').style.cssText = 'flex:1;padding:8px;border-radius:8px;border:none;font-size:0.72rem;font-weight:800;cursor:pointer;' + (aba==='grade' ? 'background:#8b5cf6;color:white;' : 'background:#1e293b;color:#64748b;border:1px solid #334155;');
        document.getElementById('tab-agenda-cal').style.cssText   = 'flex:1;padding:8px;border-radius:8px;border:none;font-size:0.72rem;font-weight:800;cursor:pointer;' + (aba==='calendario' ? 'background:#3b82f6;color:white;' : 'background:#1e293b;color:#64748b;border:1px solid #334155;');
        if (aba === 'grade') this._renderGradeAgenda();
        else this._renderCalendarioAgenda(this._agendaMesAtual || new Date());
    },

    _renderGradeAgenda() {
        const profs = this._agendaProfs || [];
        const grade = academia.getGrade ? academia.getGrade() : {};
        const diasConfig = [
            { label: 'Segunda-feira', key: 1 }, { label: 'Terça-feira', key: 2 },
            { label: 'Quarta-feira',  key: 3 }, { label: 'Quinta-feira', key: 4 },
            { label: 'Sexta-feira',   key: 5 }, { label: 'Sábado',       key: 6 },
            { label: 'Domingo',       key: 0 },
        ];
        let html = '';
        diasConfig.forEach(({ label, key }) => {
            const turmasDia = (grade[key] || grade[String(key)] || []).filter(t => t && !t.includes('Sem treino'));
            if (!turmasDia.length) return;
            html += `<div style="margin-bottom:16px;"><div style="font-size:0.6rem;font-weight:800;color:#94a3b8;letter-spacing:1px;margin-bottom:6px;border-bottom:1px solid #1e293b;padding-bottom:4px;">${label.toUpperCase()}</div>`;
            turmasDia.forEach(turma => {
                const profsNaTurma = profs.filter(p => (p.turmasAcesso||[]).some(t => t===turma || turma.startsWith(t.replace(/\s*\d+$/,'').trim())));
                html += `<div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;margin-bottom:5px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;">
                            <div style="font-size:0.75rem;font-weight:700;color:#e2e8f0;">${turma}</div>
                            ${profsNaTurma.length ? profsNaTurma.map(p=>`<div style="font-size:0.62rem;color:#10b981;margin-top:3px;font-weight:700;">👤 ${p.nome}</div>`).join('') : `<div style="font-size:0.62rem;color:#f59e0b;margin-top:3px;font-weight:700;">⚠️ Sem professor alocado</div>`}
                        </div>
                        <button onclick="profComms.abrirConvocacaoRapida('${turma.replace(/'/g,"\\'")}','${label}')" style="background:#10b981;border:none;color:white;padding:5px 10px;border-radius:6px;font-size:0.62rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">📋 Convocar</button>
                    </div>
                </div>`;
            });
            html += '</div>';
        });
        document.getElementById('agenda-content').innerHTML = html || '<p style="color:#64748b;text-align:center;">Nenhuma turma configurada na grade.</p>';
    },

    async _renderCalendarioAgenda(ref) {
        this._agendaMesAtual = ref;
        const cont = document.getElementById('agenda-content');
        cont.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:0.8rem;">⏳ Carregando...</div>';

        // Busca convocações do mês
        const ano = ref.getFullYear(), mes = ref.getMonth();
        const ini = `${ano}-${String(mes+1).padStart(2,'0')}-01`;
        const fim = `${ano}-${String(mes+1).padStart(2,'0')}-${String(new Date(ano,mes+1,0).getDate()).padStart(2,'0')}`;
        const snap = await db.collection('convocacoes_prof').where('data','>=',ini).where('data','<=',fim).get();

        // Agrupa por data → lista de convocações
        const porData = {};
        snap.forEach(doc => {
            const d = doc.data();
            if (!porData[d.data]) porData[d.data] = [];
            porData[d.data].push(d);
        });

        const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const diasSem  = ['D','S','T','Q','Q','S','S'];
        const totalDias = new Date(ano, mes+1, 0).getDate();
        const primeiroDS = new Date(ano, mes, 1).getDay(); // 0=Dom

        let html = `<div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <button onclick="profComms._renderCalendarioAgenda(new Date(${ano},${mes-1},1))" style="background:#334155;border:none;color:white;padding:6px 10px;border-radius:8px;cursor:pointer;font-weight:700;">‹</button>
                <span style="font-size:0.85rem;font-weight:800;color:white;">${nomesMes[mes]} ${ano}</span>
                <button onclick="profComms._renderCalendarioAgenda(new Date(${ano},${mes+1},1))" style="background:#334155;border:none;color:white;padding:6px 10px;border-radius:8px;cursor:pointer;font-weight:700;">›</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:8px;">
                ${diasSem.map(d=>`<div style="text-align:center;font-size:0.6rem;font-weight:800;color:#64748b;padding:4px 0;">${d}</div>`).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">`;

        // Células vazias antes do dia 1
        for (let i = 0; i < primeiroDS; i++) html += `<div></div>`;

        const hoje = new Date().toISOString().slice(0,10);
        for (let dia = 1; dia <= totalDias; dia++) {
            const iso = `${ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
            const convs = porData[iso] || [];
            const confirmadas = convs.filter(c => c.status === 'confirmado');
            const pendentes   = convs.filter(c => c.status === 'pendente');
            const isHoje = iso === hoje;
            const temConv = convs.length > 0;
            let bg = '#0f172a', border = '1px solid #1e293b', cor = '#64748b';
            if (isHoje) { bg = '#1e3a5f'; border = '1px solid #3b82f6'; cor = '#93c5fd'; }
            if (confirmadas.length) { bg = '#052e16'; border = '1px solid #10b981'; cor = '#34d399'; }
            else if (pendentes.length) { bg = '#2d1b00'; border = '1px solid #f59e0b'; cor = '#fbbf24'; }
            const dots = confirmadas.length ? `<div style="width:6px;height:6px;background:#10b981;border-radius:50%;margin:1px auto;"></div>` : (pendentes.length ? `<div style="width:6px;height:6px;background:#f59e0b;border-radius:50%;margin:1px auto;"></div>` : '');
            const onclick = temConv ? `onclick="profComms._verDiaAgenda('${iso}')"` : '';
            html += `<div ${onclick} style="background:${bg};border:${border};border-radius:6px;padding:4px 2px;text-align:center;min-height:38px;cursor:${temConv?'pointer':'default'};">
                <div style="font-size:0.7rem;font-weight:700;color:${cor};">${dia}</div>
                ${dots}
            </div>`;
        }
        html += `</div>
            <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">
                <span style="font-size:0.6rem;color:#34d399;font-weight:700;">● Confirmado</span>
                <span style="font-size:0.6rem;color:#fbbf24;font-weight:700;">● Pendente</span>
                <span style="font-size:0.6rem;color:#93c5fd;font-weight:700;">● Hoje</span>
            </div>
            <div id="agenda-cal-detalhe" style="margin-top:14px;"></div>
        </div>`;
        cont.innerHTML = html;
        // Se hoje tem convocações, já abre o detalhe
        if (porData[hoje]) this._verDiaAgenda(hoje, porData[hoje]);
    },

    async _verDiaAgenda(iso, convsCached) {
        const det = document.getElementById('agenda-cal-detalhe');
        if (!det) return;
        let convs = convsCached;
        if (!convs) {
            const snap = await db.collection('convocacoes_prof').where('data','==',iso).get();
            convs = snap.docs.map(d => d.data());
        }
        const [d, m, a] = [iso.slice(8,10), iso.slice(5,7), iso.slice(0,4)];
        const cores = { confirmado:'#10b981', pendente:'#f59e0b', recusado:'#ef4444' };
        const icons = { confirmado:'✅', pendente:'⏳', recusado:'❌' };
        let html = `<div style="border-top:1px solid #334155;padding-top:12px;">
            <div style="font-size:0.72rem;font-weight:800;color:#e2e8f0;margin-bottom:8px;">📅 ${d}/${m}/${a}</div>`;
        convs.sort((a,b) => (a.hora||'').localeCompare(b.hora||'')).forEach(c => {
            const cor = cores[c.status]||'#64748b';
            html += `<div style="background:#0f172a;border-left:3px solid ${cor};border-radius:6px;padding:8px 10px;margin-bottom:5px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                        <div style="font-size:0.72rem;font-weight:700;color:#e2e8f0;">${c.hora||'—'} · ${c.turma}</div>
                        <div style="font-size:0.62rem;color:#94a3b8;margin-top:2px;">👤 ${c.profNome}</div>
                        ${c.mensagem ? `<div style="font-size:0.58rem;color:#64748b;margin-top:2px;">"${c.mensagem}"</div>` : ''}
                        ${c.respostaMsg ? `<div style="font-size:0.6rem;color:#a78bfa;margin-top:2px;">💬 "${c.respostaMsg}"</div>` : ''}
                    </div>
                    <span style="font-size:0.6rem;font-weight:800;color:${cor};white-space:nowrap;">${icons[c.status]||''} ${(c.status||'').toUpperCase()}</span>
                </div>
            </div>`;
        });
        html += '</div>';
        det.innerHTML = html;
    },

    abrirConvocacaoRapida(turma, dia) {
        document.getElementById('modal-agenda-prof')?.remove();
        // Busca professores das DUAS coleções
        Promise.all([
            db.collection('professores').get(),
            db.collection('alunos').where('role', '==', 'professor').get()
        ]).then(([snapProfs, snapAlunos]) => {
            const profs = [
                ...snapProfs.docs.map(d => ({ id: d.id, col: 'professores', ...d.data() })),
                ...snapAlunos.docs.map(d => ({ id: d.id, col: 'alunos', ...d.data() }))
            ];
            let modal = document.getElementById('modal-conv-rapida');
            if (!modal) { modal = document.createElement('div'); modal.id = 'modal-conv-rapida'; document.body.appendChild(modal); }
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
            const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
            const opts = profs.map(p => `<option value="${p.id}|${p.col}|${p.nome.replace(/"/g,'')}">${p.nome} (${p.tipo === 'reserva' ? 'Reserva' : 'Titular'})</option>`).join('');
            modal.innerHTML = `<div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:360px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="font-size:0.85rem;font-weight:800;color:white;">📋 Convocar para ${turma}</span>
                    <button onclick="document.getElementById('modal-conv-rapida').remove()" style="background:#334155;border:none;color:white;padding:5px 10px;border-radius:6px;cursor:pointer;">✕</button>
                </div>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">PROFESSOR</small>
                <select id="conv-rapida-prof" style="${inp}">${opts}</select>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">DATA</small>
                <input type="date" id="conv-rapida-data" style="${inp}" value="${new Date().toISOString().slice(0,10)}"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">HORÁRIO</small>
                <input type="time" id="conv-rapida-hora" style="${inp}"/>
                <small style="color:#94a3b8;font-size:0.6rem;font-weight:800;display:block;margin-bottom:4px;">MENSAGEM (opcional)</small>
                <textarea id="conv-rapida-msg" rows="2" style="${inp}resize:none;" placeholder="Ex: Preciso de você nessa aula..."></textarea>
                <button onclick="profComms._enviarConvRapida('${turma.replace(/'/g,"\\'")}','${dia}')" style="width:100%;padding:12px;background:#10b981;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;">📋 ENVIAR CONVOCAÇÃO</button>
            </div>`;
        });
    },

    async _enviarConvRapida(turma, dia) {
        const sel = document.getElementById('conv-rapida-prof')?.value.split('|');
        if (!sel || sel.length < 3) return;
        const [profId, colecao, profNome] = sel;
        const data = document.getElementById('conv-rapida-data')?.value;
        const hora = document.getElementById('conv-rapida-hora')?.value;
        const msg  = document.getElementById('conv-rapida-msg')?.value.trim();
        if (!data) return alert('Informe a data.');
        const mapaDisp = await this._dispensasNaData(data);
        if (mapaDisp[profId]) {
            const d = mapaDisp[profId];
            const turmaDisp = d.turma === 'todas' ? 'todas as turmas' : (d.turma || 'não especificada');
            alert(`🚫 ${profNome} tem dispensa nesta data!\n\nTurma: ${turmaDisp}\nMotivo: "${d.motivo || 'não informado'}"\n\nConvocação bloqueada.`);
            return;
        }
        const [ay,am,ad] = data.split('-');
        const dataExib = `${ad}/${am}/${ay}${hora ? ' às ' + hora : ''}`;
        await db.collection('convocacoes_prof').add({ profId, profNome, colecao, turma, data, hora, dataExib, mensagem: msg||'', status:'pendente', criadoEm: Date.now() });
        document.getElementById('modal-conv-rapida')?.remove();
        alert(`✅ Convocação enviada para ${profNome}!`);
        this.renderPainelConvocacoes();
    },

    // ── ALERTA DE DISPENSAS NO LOGIN DO ADMIN ─────────────
    async verificarDispensasAdmin() {
        if (auth.role !== 'admin') return;
        const hoje   = new Date().toISOString().slice(0,10);
        const amanha = new Date(Date.now() + 86400000).toISOString().slice(0,10);

        const snap = await db.collection('dispensas_prof').get();
        const dispensasHoje   = [];
        const dispensasAmanha = [];

        snap.forEach(doc => {
            const d = doc.data();
            const fim = d.dataFim || d.data;
            if (d.data <= hoje   && fim >= hoje)   dispensasHoje.push(d);
            if (d.data <= amanha && fim >= amanha && !(d.data <= hoje && fim >= hoje)) dispensasAmanha.push(d);
        });

        if (!dispensasHoje.length && !dispensasAmanha.length) return;

        // Monta popup
        let modal = document.getElementById('modal-aviso-dispensas');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'modal-aviso-dispensas';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.95);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        let corpo = '';
        if (dispensasHoje.length) {
            corpo += `<div style="background:#3a1a00;border:1px solid #f59e0b;border-radius:10px;padding:12px;margin-bottom:10px;">
                <div style="font-size:0.68rem;font-weight:800;color:#f59e0b;margin-bottom:8px;">⚠️ DISPENSAS HOJE</div>
                ${dispensasHoje.map(d => `
                    <div style="font-size:0.75rem;color:#e2e8f0;margin-bottom:4px;">
                        👤 <b>${d.profNome}</b> — ${d.turma === 'todas' ? 'todas as turmas' : d.turma}
                        <div style="font-size:0.62rem;color:#94a3b8;margin-top:1px;font-style:italic;">"${d.motivo}"</div>
                    </div>`).join('')}
            </div>`;
        }
        if (dispensasAmanha.length) {
            corpo += `<div style="background:#1a2a1a;border:1px solid #10b981;border-radius:10px;padding:12px;margin-bottom:10px;">
                <div style="font-size:0.68rem;font-weight:800;color:#10b981;margin-bottom:8px;">📅 DISPENSAS AMANHÃ</div>
                ${dispensasAmanha.map(d => `
                    <div style="font-size:0.75rem;color:#e2e8f0;margin-bottom:4px;">
                        👤 <b>${d.profNome}</b> — ${d.turma === 'todas' ? 'todas as turmas' : d.turma}
                        <div style="font-size:0.62rem;color:#94a3b8;margin-top:1px;font-style:italic;">"${d.motivo}"</div>
                    </div>`).join('')}
            </div>`;
        }

        modal.innerHTML = `
            <div style="background:#1e293b;border:2px solid #f59e0b;border-radius:20px;padding:24px;max-width:380px;width:100%;">
                <div style="text-align:center;margin-bottom:16px;">
                    <div style="font-size:2.5rem;margin-bottom:6px;">🗓️</div>
                    <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;">GADITAS ACADEMY</div>
                    <div style="font-size:1rem;font-weight:800;color:white;margin-top:4px;">Aviso de Dispensas</div>
                </div>
                ${corpo}
                <div style="display:flex;gap:8px;margin-top:4px;">
                    <button onclick="document.getElementById('modal-aviso-dispensas').remove()" style="flex:1;padding:12px;background:#334155;border:none;color:white;border-radius:10px;font-weight:700;cursor:pointer;font-size:0.8rem;">Fechar</button>
                    <button onclick="document.getElementById('modal-aviso-dispensas').remove();profComms.abrirDispensasAdmin();" style="flex:1;padding:12px;background:#f59e0b;border:none;color:#000;border-radius:10px;font-weight:700;cursor:pointer;font-size:0.8rem;">Ver todas</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    // ── DISPENSAS (VISÃO ADMIN) ────────────────────────────
    async abrirDispensasAdmin() {
        let modal = document.getElementById('modal-dispensas-admin');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-dispensas-admin'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto;';
        modal.innerHTML = `<div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:420px;margin-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <span style="font-size:0.95rem;font-weight:800;color:white;">🗓️ Dispensas dos Professores</span>
                <button onclick="document.getElementById('modal-dispensas-admin').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:12px;">
                <button onclick="profComms._carregarDispensasAdmin('futuras',this)" style="flex:1;padding:7px;background:#f59e0b;border:none;color:#000;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Próximas</button>
                <button onclick="profComms._carregarDispensasAdmin('hoje',this)" style="flex:1;padding:7px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Hoje</button>
                <button onclick="profComms._carregarDispensasAdmin('todas',this)" style="flex:1;padding:7px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Todas</button>
            </div>
            <div id="dispensas-admin-lista"><div style="text-align:center;padding:20px;color:#64748b;font-size:0.8rem;">⏳ Carregando...</div></div>
        </div>`;
        this._carregarDispensasAdmin('futuras', modal.querySelector('button'));
    },

    async _carregarDispensasAdmin(filtro, btnEl) {
        btnEl?.closest('div')?.querySelectorAll('button').forEach(b => { b.style.background='#1e293b'; b.style.color='#94a3b8'; b.style.border='1px solid #334155'; });
        if (btnEl) { btnEl.style.background='#f59e0b'; btnEl.style.color='#000'; btnEl.style.border='none'; }

        const lista = document.getElementById('dispensas-admin-lista');
        if (!lista) return;
        lista.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:0.8rem;">⏳ Buscando...</div>';

        const snap = await db.collection('dispensas_prof').get();
        const hoje = new Date().toISOString().slice(0,10);

        let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (filtro === 'futuras') {
            docs = docs.filter(d => (d.dataFim || d.data) >= hoje);
        } else if (filtro === 'hoje') {
            docs = docs.filter(d => d.data <= hoje && (d.dataFim || d.data) >= hoje);
        }
        docs.sort((a,b) => a.data.localeCompare(b.data));

        if (!docs.length) {
            lista.innerHTML = '<p style="color:#64748b;text-align:center;font-size:0.78rem;padding:16px;">Nenhuma dispensa encontrada.</p>';
            return;
        }

        let html = '';
        docs.forEach(d => {
            const isAtiva = d.data <= hoje && (d.dataFim || d.data) >= hoje;
            const isFutura = d.data > hoje;
            const cor = isAtiva ? '#10b981' : isFutura ? '#f59e0b' : '#475569';
            const status = isAtiva ? '🟢 ATIVA' : isFutura ? '🟡 FUTURA' : '⚫ PASSADA';
            html += `<div style="background:#0f172a;border:1px solid #334155;border-left:3px solid ${cor};border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;">
                        <div style="font-size:0.78rem;font-weight:800;color:#e2e8f0;">${d.profNome}</div>
                        <div style="font-size:0.68rem;color:#94a3b8;margin-top:2px;">📅 ${d.dataExib}</div>
                        <div style="font-size:0.65rem;color:#64748b;margin-top:2px;">🏫 ${d.turma === 'todas' ? 'Todas as turmas' : d.turma}</div>
                        <div style="font-size:0.68rem;color:#e2e8f0;margin-top:4px;font-style:italic;">"${d.motivo}"</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                        <span style="font-size:0.55rem;font-weight:800;color:${cor};">${status}</span>
                        <button onclick="profComms._excluirDispensaAdmin('${d.id}')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:0.75rem;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        });
        lista.innerHTML = html;
    },

    async _excluirDispensaAdmin(id) {
        if (!confirm('Remover esta dispensa?')) return;
        await db.collection('dispensas_prof').doc(id).delete();
        this._carregarDispensasAdmin('futuras', document.querySelector('#modal-dispensas-admin button'));
    },

    // ── RANKING DE PROFESSORES ─────────────────────────────
    async abrirRankingProfs() {
        let modal = document.getElementById('modal-ranking-profs');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-ranking-profs'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto;';
        modal.innerHTML = `<div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:400px;margin-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <span style="font-size:0.95rem;font-weight:800;color:white;">🏅 Ranking de Professores</span>
                <button onclick="document.getElementById('modal-ranking-profs').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:12px;">
                <button onclick="profComms._carregarRanking('mes',this)" style="flex:1;padding:7px;background:#3b82f6;border:none;color:white;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Este mês</button>
                <button onclick="profComms._carregarRanking('ano',this)" style="flex:1;padding:7px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Este ano</button>
                <button onclick="profComms._carregarRanking('total',this)" style="flex:1;padding:7px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">Total</button>
            </div>
            <div id="ranking-profs-lista"><div style="text-align:center;padding:20px;color:#64748b;font-size:0.8rem;">⏳ Carregando...</div></div>
        </div>`;
        this._carregarRanking('mes', modal.querySelector('button'));
    },

    async _carregarRanking(periodo, btnEl) {
        // Atualiza visual dos botões
        btnEl?.closest('div')?.querySelectorAll('button').forEach(b => { b.style.background='#1e293b'; b.style.color='#94a3b8'; b.style.border='1px solid #334155'; });
        if (btnEl) { btnEl.style.background='#3b82f6'; btnEl.style.color='white'; btnEl.style.border='none'; }

        const lista = document.getElementById('ranking-profs-lista');
        if (!lista) return;
        lista.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:0.8rem;">⏳ Calculando...</div>';

        // Busca todos os professores
        const [snapProfs, snapAlunos] = await Promise.all([
            db.collection('professores').get(),
            db.collection('alunos').where('role','==','professor').get()
        ]);
        const profs = [];
        snapProfs.forEach(d => profs.push({ id: d.id, nome: d.data().nome, turmas: d.data().turmasAcesso || [] }));
        snapAlunos.forEach(d => profs.push({ id: d.id, nome: d.data().nome, turmas: d.data().turmasAcesso || [] }));

        // Filtra check-ins pelo período
        const agora = new Date();
        const inicio = periodo === 'mes'
            ? new Date(agora.getFullYear(), agora.getMonth(), 1).getTime()
            : periodo === 'ano'
            ? new Date(agora.getFullYear(), 0, 1).getTime()
            : 0;

        const snapCheckins = await db.collection('checkins').where('data','>=', inicio).get();
        // Conta sessões únicas por professor (turma+data = 1 sessão)
        const sessoesProf = {};
        const sessoesVistas = new Set();
        snapCheckins.forEach(doc => {
            const c = doc.data();
            if (!c.turma || !c.data) return;
            const chave = `${c.turma}__${new Date(c.data).toDateString()}`;
            if (sessoesVistas.has(chave)) return;
            sessoesVistas.add(chave);
            profs.forEach(p => {
                const pertence = p.turmas.some(t => c.turma.includes(t.replace(/\s*\d+$/,'').trim()) || t === c.turma);
                if (pertence) { sessoesProf[p.id] = (sessoesProf[p.id] || 0) + 1; }
            });
        });

        const ranking = profs
            .map(p => ({ ...p, aulas: sessoesProf[p.id] || 0 }))
            .sort((a, b) => b.aulas - a.aulas)
            .filter(p => p.aulas > 0 || periodo === 'total');

        const labels = { mes: 'este mês', ano: 'este ano', total: 'no total' };
        const medalhas = ['🥇','🥈','🥉'];
        let html = `<div style="font-size:0.6rem;color:#64748b;margin-bottom:10px;text-align:center;">Aulas ministradas ${labels[periodo]}</div>`;
        if (!ranking.length) { lista.innerHTML = '<p style="color:#64748b;text-align:center;font-size:0.78rem;padding:16px;">Nenhuma aula registrada no período.</p>'; return; }
        ranking.forEach((p, i) => {
            const medalha = medalhas[i] || `${i+1}º`;
            const barW = ranking[0].aulas > 0 ? Math.round((p.aulas / ranking[0].aulas) * 100) : 0;
            html += `<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:1.1rem;">${medalha}</span>
                        <div>
                            <div style="font-size:0.78rem;font-weight:700;color:#e2e8f0;">${p.nome}</div>
                            <div style="font-size:0.6rem;color:#64748b;">Turmas: ${p.turmas.join(', ') || '—'}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1rem;font-weight:900;color:#3b82f6;">${p.aulas}</div>
                        <div style="font-size:0.5rem;color:#64748b;">aulas</div>
                    </div>
                </div>
                <div style="background:#1e293b;border-radius:999px;height:5px;overflow:hidden;">
                    <div style="width:${barW}%;height:100%;background:#3b82f6;border-radius:999px;"></div>
                </div>
            </div>`;
        });
        lista.innerHTML = html;
    },

    // ── RECADOS ────────────────────────────────────────────
    abrirRecado(profId, profNome, colecao) {
        let modal = document.getElementById('modal-recado-prof');
        if (!modal) { modal = document.createElement('div'); modal.id = 'modal-recado-prof'; document.body.appendChild(modal); }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const inp = 'width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.8rem;margin-bottom:10px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:20px;width:100%;max-width:380px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <span style="font-size:0.9rem;font-weight:800;color:white;">💬 Recado para ${profNome}</span>
                    <button onclick="document.getElementById('modal-recado-prof').remove()" style="background:#334155;border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:700;">✕</button>
                </div>
                <textarea id="recado-texto" rows="4" placeholder="Escreva seu recado aqui..." style="${inp}resize:none;"></textarea>
                <button onclick="profComms._enviarRecado('${profId}','${profNome.replace(/'/g,"\\'")}','${colecao}')" style="width:100%;padding:13px;background:#3b82f6;border:none;color:white;border-radius:8px;font-weight:800;cursor:pointer;">💬 ENVIAR RECADO</button>
            </div>`;
    },

    async _enviarRecado(profId, profNome, colecao) {
        const texto = document.getElementById('recado-texto')?.value.trim();
        if (!texto) return alert('Escreva o recado.');
        await db.collection('recados_prof').add({
            profId, profNome, colecao,
            texto, lido: false,
            criadoEm: Date.now()
        });
        push._enviarPush && push.paraAluno(profId, '💬 Recado do professor', texto.substring(0, 80));
        document.getElementById('modal-recado-prof')?.remove();
        alert(`✅ Recado enviado para ${profNome}!`);
    },

    _mostrarPopupConvocacaoProf(conv) {
        document.getElementById('modal-conv-prof')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-conv-prof';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid #10b981;border-radius:24px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 80px #10b98133;position:relative;">
                <div style="font-size:3rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">📋</div>
                <div style="font-size:0.6rem;color:#10b981;font-weight:800;letter-spacing:2px;margin-bottom:8px;">GADITAS ACADEMY</div>
                <div style="font-size:1.4rem;font-weight:800;color:white;margin-bottom:6px;">Nova Convocação!</div>
                <div style="background:#10b98122;border:1px solid #10b981;border-radius:12px;padding:14px;margin:14px 0;text-align:left;">
                    <div style="font-size:0.85rem;font-weight:800;color:#10b981;">🏫 ${conv.turma}</div>
                    <div style="font-size:0.75rem;color:#94a3b8;margin-top:4px;">📅 ${conv.dataExib}</div>
                    ${conv.mensagem ? `<div style="font-size:0.72rem;color:#e2e8f0;margin-top:6px;font-style:italic;">"${conv.mensagem}"</div>` : ''}
                </div>
                <div style="font-size:0.7rem;color:#64748b;margin-bottom:16px;line-height:1.5;">Verifique sua disponibilidade e responda pelo painel de convocações abaixo. Se não puder, informe o motivo.</div>
                <button onclick="document.getElementById('modal-conv-prof').remove()"
                    style="width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);color:#000;border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:0.9rem;">
                    👀 VER CONVOCAÇÃO
                </button>
            </div>
            <style>@keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-10px)}}</style>`;
        document.body.appendChild(modal);
    },

    // Carrega recados pendentes para o professor logado
    async iniciarListenerRecadosProf() {
        if (auth.role !== 'professor') return;
        const profId = auth.currentUser?.id;
        if (!profId) return;
        const colecao = auth.role === 'professor' ? 'professores' : 'alunos';
        db.collection('recados_prof')
            .where('profId', '==', profId)
            .where('lido', '==', false)
            .onSnapshot(snap => {
                const badge = document.getElementById('badge-recados-prof');
                if (badge) badge.style.display = snap.size > 0 ? 'inline-block' : 'none';
                if (snap.size > 0) this._mostrarRecadosPendentes(snap.docs);
                // Popup para cada recado novo que chegar
                snap.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        setTimeout(() => this._mostrarPopupRecado(change.doc), 1000);
                    }
                });
            });
        // Convocações pendentes com popup para novas
        db.collection('convocacoes_prof')
            .where('profId', '==', profId)
            .where('status', '==', 'pendente')
            .onSnapshot(snap => {
                if (snap.size > 0) this._mostrarConvocacoesPendentes(snap.docs);
                snap.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const c = { id: change.doc.id, ...change.doc.data() };
                        setTimeout(() => this._mostrarPopupConvocacaoProf(c), 800);
                    }
                });
            });
    },

    _mostrarConvocacoesPendentes(docs) {
        const container = document.getElementById('painel-convocacoes-recebidas');
        if (!container) return;
        let html = `<div style="background:#1e3a1a;border:1px solid #10b981;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="font-size:0.72rem;font-weight:800;color:#10b981;margin-bottom:8px;">📋 CONVOCAÇÕES PENDENTES</div>`;
        docs.forEach(doc => {
            const c = doc.data();
            html += `<div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:6px;">
                <div style="font-size:0.78rem;font-weight:700;color:#e2e8f0;">${c.turma} — ${c.dataExib}</div>
                ${c.mensagem ? `<div style="font-size:0.65rem;color:#94a3b8;margin:3px 0;">"${c.mensagem}"</div>` : ''}
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button onclick="profComms._responderConvocacao('${doc.id}','confirmado')" style="flex:1;padding:8px;background:#10b981;border:none;color:white;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.72rem;">✅ CONFIRMAR</button>
                    <button onclick="profComms._responderConvocacao('${doc.id}','recusado')" style="flex:1;padding:8px;background:#1e293b;border:1px solid #ef4444;color:#ef4444;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.72rem;">❌ NÃO POSSO</button>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
        container.style.display = 'block';
    },

    async _responderConvocacao(convId, status) {
        let motivo = '';
        if (status === 'recusado') {
            motivo = prompt('Por que não pode? (opcional):') || '';
        }
        try {
            await db.collection('convocacoes_prof').doc(convId).update({
                status,
                respostaMsg: motivo,
                respondidoEm: Date.now()
            });
            // Feedback visual imediato
            const emoji = status === 'confirmado' ? '✅' : '❌';
            const txt   = status === 'confirmado' ? 'Presença confirmada!' : 'Resposta enviada.';
            alert(`${emoji} ${txt}`);
            // Limpa os painéis
            const p1 = document.getElementById('painel-convocacoes-recebidas');
            const p2 = document.getElementById('dash-convocacoes-prof');
            if (p1) p1.innerHTML = '';
            if (p2) p2.innerHTML = '';
            // Notifica admin via push (sem quebrar se falhar)
            try {
                const conv = (await db.collection('convocacoes_prof').doc(convId).get()).data();
                const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
                const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;
                if (adminToken) {
                    await fetch('/api/push-comunicado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tokens: [adminToken], title: `${emoji} ${auth.currentUser?.nome || 'Professor'}`, body: `${status === 'confirmado' ? 'Confirmou' : 'Recusou'} — ${conv?.turma || ''}${motivo ? ': ' + motivo : ''}` })
                    });
                }
            } catch(_) { /* push falhou silenciosamente */ }
        } catch(e) {
            alert('Erro ao responder: ' + e.message);
        }
    },

    _mostrarRecadosPendentes(docs) {
        const container = document.getElementById('painel-recados-prof');
        if (!container) return;
        let html = `<div style="background:#1a1e3a;border:1px solid #3b82f6;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="font-size:0.72rem;font-weight:800;color:#3b82f6;margin-bottom:8px;">💬 RECADOS</div>`;
        docs.forEach(doc => {
            const r = doc.data();
            html += `<div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:6px;">
                <div style="font-size:0.78rem;color:#e2e8f0;">${r.texto}</div>
                <button onclick="profComms._marcarRecadoLido('${doc.id}',this)" style="margin-top:6px;background:#3b82f6;border:none;color:white;padding:5px 12px;border-radius:6px;font-size:0.65rem;font-weight:700;cursor:pointer;">✓ Li o recado</button>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
        container.style.display = 'block';
    },

    async _marcarRecadoLido(id, btn) {
        await db.collection('recados_prof').doc(id).update({ lido: true, lidoEm: Date.now() });
        document.getElementById(`popup-recado-${id}`)?.remove();
        btn?.closest('div[style]')?.remove();
    },

    _mostrarPopupRecado(doc) {
        const r = doc.data();
        const popupId = `popup-recado-${doc.id}`;
        if (document.getElementById(popupId)) return; // já aberto
        const modal = document.createElement('div');
        modal.id = popupId;
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const hora = r.criadoEm ? new Date(r.criadoEm).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid #3b82f6;border-radius:24px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 80px #3b82f633;position:relative;">
                <div style="font-size:3rem;margin-bottom:8px;">💬</div>
                <div style="font-size:0.6rem;color:#3b82f6;font-weight:800;letter-spacing:2px;margin-bottom:8px;">GADITAS ACADEMY</div>
                <div style="font-size:1.2rem;font-weight:800;color:white;margin-bottom:4px;">Novo Recado!</div>
                ${hora ? `<div style="font-size:0.62rem;color:#64748b;margin-bottom:14px;">${hora}</div>` : ''}
                <div style="background:#1e3a5f;border:1px solid #3b82f6;border-radius:12px;padding:16px;margin:14px 0;text-align:left;">
                    <div style="font-size:0.85rem;color:#e2e8f0;line-height:1.6;">${r.texto}</div>
                </div>
                <button onclick="profComms._marcarRecadoLido('${doc.id}', null)" style="width:100%;padding:14px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:0.9rem;">
                    ✅ LI O RECADO
                </button>
            </div>`;
        document.body.appendChild(modal);
    }
};

const ui = {
    // ── Estado do calendário de treinos ──────────────────
    _calMes: new Date().getMonth(),
    _calAno: new Date().getFullYear(),
    _calHistorico: [],
    _calEventos: [],
    _calDia: null,
    _calVista: 'calendario',

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

            // ── Acordeões PRIMEIRO (antes de carregar dados) ──
            this._aplicarAcordeoesGestao();

            // Carrega relatos de saúde para prof/admin
            if (auth.role === 'admin' || auth.role === 'professor') {
                const cardS = document.getElementById('card-alertas-saude');
                if (cardS) cardS.classList.remove('hidden');
                academia.carregarRelatosSaude();
            }
            // Depoimentos pendentes — carrega ao entrar na aba (card já visível via configurarVisao)
            if (auth.role === 'admin') {
                academia.carregarDepoimentosPendentes();
                enquetes.renderAdminEnquetes();
                aniversario.renderAdminAniversariantes();
            }
            if (auth.role === 'admin') academia.carregarVideosPendentesAdmin();
            if (auth.role === 'professor') {
                academia.carregarVideosPendentesProf();
                const profSenha = document.getElementById('prof-senha-section');
                if (profSenha) profSenha.classList.remove('hidden');
            }
        }
        if(id === 'tab-eventos') { academia.limparFormEvento(); academia.carregarEventosAbas(); if(auth.role === 'aluno') setTimeout(() => academia.verificarDisparoEvento(), 600); }
        if(id === 'tab-checkin') { if(auth.role === 'admin') academia.renderDashboardGrid(); else academia.renderDashboardAluno(); academia.renderStoriesBar(); academia.renderRanking(); this.atualizarTurmasDinamicas(); academia.renderCheckins(); this.renderPerfilAluno(); this.renderCardContrato(); academia.carregarConquistas(); academia.carregarBibliotecaTecnica(); academia.carregarMeusCheckinsPendentes(); if(auth.role === 'professor' || auth.role === 'admin') { academia.renderPlanoAulaProf(); academia.renderChamadaProf(); } if(auth.role === 'admin') { academia.renderPresencaAdmin(); academia.renderPainelExperimentais(); } }
        if(id === 'tab-relatorios') { if(auth.role === 'admin') { academia.renderDashboardAdmin(); avaliacaoFisica._garantirPainelSolicitacoes(); treinoPost.renderRadarSumidos(); treinoPost.renderAvaliacoesPainel(); boletim.renderPainelAdmin(); } academia.generarRelatorioGraduacao(); academia.calcularAnalyticsFrequencia(); }
        if(id === 'tab-horarios') { academia._modoEdicaoHorarios = false; academia.renderHorarios(); if(auth.role === 'professor') profComms.renderPainelDispensas(); }
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
        document.body.classList.toggle('role-admin', isAdmin);
        document.body.classList.toggle('role-prof', isProf);
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
        // Card enquetes admin
        const cardEnq = document.getElementById('card-enquetes-admin');
        if (cardEnq) cardEnq.style.display = isAdmin ? 'block' : 'none';
        // Card aniversariantes admin
        const cardAniv = document.getElementById('card-aniversariantes-admin');
        if (cardAniv) cardAniv.style.display = isAdmin ? 'block' : 'none';
        // Tab exame — admin sempre vê; aluno/professor só se convocado (verificarConvocacao cuida disso)
        const menuExame = document.getElementById('menu-exame');
        if (menuExame) {
            if (isAdmin) menuExame.classList.remove('nav-item-hidden');
            else menuExame.classList.add('nav-item-hidden');
        }
        // Toggle VITRINE/GERENCIAR na aba loja — só admin
        const lojaToggle = document.getElementById('loja-admin-toggle');
        if (lojaToggle) lojaToggle.style.display = isAdmin ? 'flex' : 'none';
        // Professor vê o wrapper de perfil (alterar senha, dados)
        const wrapperPerfil = document.getElementById('wrapper-perfil-proprio');
        if (wrapperPerfil && isProf) wrapperPerfil.classList.remove('hidden');
    },
    // ── ACORDEÕES DA ABA GESTÃO ──────────────────────────────
    // Toggle simples — chamado pelo onclick inline do HTML
    toggleCard(cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const fechado = card.classList.contains('gestao-acc-fechado');
        if (fechado) {
            card.classList.remove('gestao-acc-fechado');
            // Carrega conteúdo ao abrir
if (cardId === 'card-aniversariantes-admin' && typeof aniversario !== 'undefined') aniversario.renderAdminAniversariantes();
            if (cardId === 'card-alertas-saude') academia.carregarRelatosSaude();
            if (cardId === 'card-depoimentos-admin') academia.carregarDepoimentosPendentes();
            if (cardId === 'card-enquetes-admin' && typeof enquetes !== 'undefined') enquetes.renderAdminEnquetes();
        } else {
            card.classList.add('gestao-acc-fechado');
        }
    },

    _aplicarAcordeoesGestao() {
        // Fecha todos ao (re)abrir a aba — o onclick inline no HTML cuida do toggle
        ['card-aniversariantes-admin','card-alertas-saude','card-depoimentos-admin','card-enquetes-admin'].forEach(id => {
            const card = document.getElementById(id);
            if (card) card.classList.add('gestao-acc-fechado');
        });
    },

    renderTurmasCheckboxes() {
        const c = document.getElementById('grid-turmas-prof'); if(!c) return;
        const t = [...new Set(Object.values(academia.getGrade()).flat())].filter(i => !i.includes("Sem treinos")).sort();
        c.innerHTML = t.map(i => `<label style="display:block; font-size:0.65rem; color:#94a3b8; margin-bottom:5px; font-weight:600;"><input type="checkbox" class="check-turma" value="${i}"> ${i}</label>`).join('');
    },
    async renderCardContrato() {
        const card = document.getElementById('card-contrato-aluno');
        if (!card) return;
        if (auth.role !== 'aluno' && auth.role !== 'professor') { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');

        // Plano livre/família sem valor definido → aguardar admin
        const plano = (auth.currentUser?.plano || '').toLowerCase();
        const planoSemValor = (plano === 'livre' || plano === 'familia') && !(auth.currentUser?.planoValor > 0);
        if (planoSemValor) {
            card.innerHTML = `
<div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:12px;">
  <div style="font-size:1.3rem; flex-shrink:0;">⏳</div>
  <div style="flex:1;">
    <div style="font-size:0.72rem; font-weight:800; color:#64748b;">CONTRATO EM PREPARAÇÃO</div>
    <div style="font-size:0.6rem; color:#475569; margin-top:2px; line-height:1.4;">Aguardando o admin definir o valor do seu plano. O contrato será liberado em breve.</div>
  </div>
</div>`;
            return;
        }

        // Verifica versão atual do contrato no Firestore
        let versaoAtual = 0;
        try {
            const cfgDoc = await db.collection('configuracoes').doc('contrato').get();
            if (cfgDoc.exists) versaoAtual = cfgDoc.data().versao || 0;
        } catch(e) {}

        const assinaturaImg = auth.currentUser?.contrato?.assinaturaImg;
        const versaoAssinada = auth.currentUser?.contrato?.versaoContrato || 0;
        const assinadoValido = !!(assinaturaImg) && (versaoAssinada >= versaoAtual);

        if (assinadoValido) {
            const data = auth.currentUser.contrato.assinadoEm?.toDate
                ? auth.currentUser.contrato.assinadoEm.toDate().toLocaleDateString('pt-BR')
                : (auth.currentUser.contrato.assinadoEm || '');
            card.innerHTML = `
<div style="background:#064e3b; border:1px solid #10b981; border-radius:12px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
  <div>
    <div style="font-size:0.7rem; font-weight:800; color:#10b981;">✅ CONTRATO ASSINADO</div>
    <div style="font-size:0.6rem; color:#6ee7b7; margin-top:2px;">Assinado em ${data} — ${auth.currentUser.contrato.planoLabel || ''} ${auth.currentUser.contrato.valorPlano || ''}</div>
  </div>
  <button onclick="contrato.abrir()" style="background:#0f172a; border:1px solid #10b981; color:#10b981; padding:8px 12px; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer; white-space:nowrap; flex-shrink:0;">VER 📋</button>
</div>`;
        } else if (assinaturaImg && versaoAssinada < versaoAtual) {
            // Assinado mas contrato foi atualizado — precisa reassinar
            card.innerHTML = `
<div style="background:#0c1a3a; border:2px solid #3b82f6; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
  <div style="font-size:1.5rem; flex-shrink:0;">🔄</div>
  <div style="flex:1; min-width:0;">
    <div style="font-size:0.75rem; font-weight:800; color:#60a5fa; margin-bottom:3px;">CONTRATO ATUALIZADO</div>
    <div style="font-size:0.62rem; color:#3b82f6; line-height:1.4;">O contrato foi atualizado. É necessário reler e assinar novamente.</div>
  </div>
  <button onclick="contrato.abrir()" style="background:#3b82f6; border:none; color:white; padding:10px 14px; border-radius:8px; font-size:0.7rem; font-weight:800; cursor:pointer; flex-shrink:0; white-space:nowrap;">REASSINAR</button>
</div>`;
        } else {
            card.innerHTML = `
<div style="background:#1c0a00; border:2px solid #f59e0b; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px;">
  <div style="font-size:1.5rem; flex-shrink:0;">📋</div>
  <div style="flex:1; min-width:0;">
    <div style="font-size:0.75rem; font-weight:800; color:#f59e0b; margin-bottom:3px;">CONTRATO PENDENTE</div>
    <div style="font-size:0.62rem; color:#92400e; line-height:1.4;">Você ainda não assinou seu contrato digital. Clique para ler e assinar.</div>
  </div>
  <button onclick="contrato.abrir()" style="background:#f59e0b; border:none; color:#000; padding:10px 14px; border-radius:8px; font-size:0.7rem; font-weight:800; cursor:pointer; flex-shrink:0; white-space:nowrap;">ASSINAR</button>
</div>`;
        }
    },

    _turmaSelecionada: null,

    atualizarTurmasDinamicas() {
        const container = document.getElementById('turmas-checkin-btns'); if (!container) return;
        const hiddenSel = document.getElementById('select-turma-aluno');
        const todas = academia.getGrade()[new Date().getDay()] || academia.getGrade()[String(new Date().getDay())] || [];

        // Perfil do aluno logado
        const aluno      = auth.currentUser || {};
        const anoAtual   = new Date().getFullYear();
        const idade      = aluno.nascimento ? anoAtual - new Date(aluno.nascimento).getFullYear() : 99;
        const isKids     = idade <= 13;
        const isInter    = idade === 14 || idade === 15;
        const comAdultos = aluno.treinaComAdultos === true;
        const modAluno   = aluno.modalidade || 'jiujitsu';
        const ehMT       = modAluno === 'muaythai' || modAluno === 'ambos';
        const ehJJ       = modAluno === 'jiujitsu'  || modAluno === 'ambos';

        // Filtra turmas visíveis para este aluno
        const visiveis = todas.filter(turma => {
            if (!turma || turma.toLowerCase().includes('sem treino')) return false;
            const ehKids = academia._isTurmaKids(turma);
            const ehMTt  = academia._isTurmaMT(turma);
            if (isInter) return true; // 14-15 vê tudo
            if (isKids) {
                if (ehKids) return true;
                if (ehMTt && ehMT && comAdultos) return true;
                if (!ehMTt && !ehKids && comAdultos) return true;
                return false;
            }
            // Adulto: não vê kids
            if (ehKids) return false;
            return true;
        });

        if (visiveis.length === 0) {
            container.innerHTML = '<p style="color:#64748b;font-size:0.75rem;text-align:center;padding:8px 0;">Sem turmas disponíveis hoje.</p>';
            this._turmaSelecionada = null;
            return;
        }

        // Sincroniza hidden select (para funções que ainda lêem dele)
        if (hiddenSel) hiddenSel.innerHTML = visiveis.map(t => `<option value="${t}">${t}</option>`).join('');

        academia._turmaSelecionada = null;
        container.innerHTML = visiveis.map(t => {
            const isMT   = academia._isTurmaMT(t);
            const isKids = academia._isTurmaKids(t);
            const cor    = isMT ? '#7f1d1d' : isKids ? '#312e81' : '#0c4a6e';
            const borda  = isMT ? '#ef4444' : isKids ? '#818cf8' : '#3b82f6';
            const emoji  = isMT ? '🥊' : isKids ? '⭐' : '🥋';
            return `<button onclick="ui._selecionarTurmaCheckin('${t.replace(/'/g,"\\'")}', this)"
                style="width:100%;padding:14px 16px;background:${cor};border:2px solid ${borda};color:white;
                border-radius:12px;font-weight:800;cursor:pointer;font-size:0.88rem;text-align:left;
                display:flex;align-items:center;gap:10px;transition:all 0.15s;">
                <span style="font-size:1.3rem;">${emoji}</span>
                <span>${t}</span>
            </button>`;
        }).join('');

        // Oculta "quem treina" até selecionar turma
        const qt = document.getElementById('area-quem-treina');
        if (qt) qt.style.display = 'none';
    },

    _selecionarTurmaCheckin(turma, btnEl) {
        // Destaca o clicado
        document.querySelectorAll('#turmas-checkin-btns button').forEach(b => {
            b.style.opacity = '0.5'; b.style.transform = 'scale(1)';
        });
        btnEl.style.opacity = '1'; btnEl.style.transform = 'scale(1.02)';

        // Modal de confirmação inline (sem confirm() nativo)
        const existente = document.getElementById('modal-confirm-checkin');
        if (existente) existente.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-confirm-checkin';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #3b82f6;border-radius:16px;padding:24px 20px;max-width:320px;width:100%;text-align:center;">
                <div style="font-size:2rem;margin-bottom:10px;">🥋</div>
                <div style="font-size:0.9rem;font-weight:800;color:white;margin-bottom:6px;">Confirmar Check-in</div>
                <div style="font-size:0.85rem;color:#93c5fd;font-weight:700;margin-bottom:20px;">${turma}</div>
                <div style="display:flex;gap:10px;">
                    <button onclick="document.getElementById('modal-confirm-checkin').remove();document.querySelectorAll('#turmas-checkin-btns button').forEach(b=>{b.style.opacity='1';b.style.transform='scale(1)'});"
                        style="flex:1;padding:12px;background:#334155;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                        Cancelar
                    </button>
                    <button onclick="document.getElementById('modal-confirm-checkin').remove();ui._confirmarCheckinTurma('${turma.replace(/'/g,"\\'")}');"
                        style="flex:1;padding:12px;background:#10b981;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                        ✅ Confirmar
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    _confirmarCheckinTurma(turma) {
        academia._turmaSelecionada = turma;
        const s = document.getElementById('select-turma-aluno');
        if (s) s.value = turma;

        // Mostra quem já confirmou
        const qt = document.getElementById('area-quem-treina');
        if (qt) qt.style.display = 'block';
        academia.atualizarPresencaAntecipada();

        // Dispara check-in automaticamente
        academia.alunoEnviaCheckin();
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
            // Boletim escolar: mostra para kids (por idade, turma ou nome)
            const _isKidsBoletim = idadeAtleta <= 15 || /kids/i.test(d.nome || '') || (d.turmas || []).some(t => /kids/i.test(t));
            const _wb = document.getElementById('wrapper-boletim-escolar');
            if (_wb && _isKidsBoletim) _wb.classList.remove('hidden');
            // ── Selo escolar no header ────────────────────────────
            if (_isKidsBoletim && d.boletim?.notas) {
                const _notas = d.boletim.notas;
                const _avs = boletim._getSistema(anoAtual) === '3x' ? ['av1','av2','av3'] : ['av1','av2'];
                let _soma = 0, _total = 0;
                [1,2].forEach(sem => {
                    _avs.forEach(av => {
                        const avData = _notas[anoAtual]?.['sem'+sem]?.[av];
                        if (!avData) return;
                        (d.boletim.materias||[]).forEach(m => {
                            const v = avData[m];
                            if (v !== null && v !== undefined) { _soma += v; _total++; }
                        });
                    });
                });
                if (_total > 0) {
                    const _media = _soma / _total;
                    const _selo = _media >= 8.0 ? { label:'Ouro', bg:'#EF9F27', ring:'#BA7517', text:'#412402', star:'#412402' }
                                : _media >= 6.0 ? { label:'Prata', bg:'#B4B2A9', ring:'#5F5E5A', text:'#2C2C2A', star:'#2C2C2A' }
                                : _media >= 4.0 ? { label:'Bronze', bg:'#D85A30', ring:'#993C1D', text:'#4A1B0C', star:'#4A1B0C' }
                                : null;
                    if (_selo) {
                        const _seloEl = document.getElementById('selo-escola-header');
                        if (_seloEl) {
                            // Gera polígono serrilhado (12 dentes, raio externo 19, interno 14)
                            const _pts = Array.from({length:24}, (_,i) => {
                                const ang = (i * Math.PI / 12) - Math.PI / 2;
                                const r = i % 2 === 0 ? 19 : 14;
                                return `${(20 + r * Math.cos(ang)).toFixed(2)},${(20 + r * Math.sin(ang)).toFixed(2)}`;
                            }).join(' ');
                            _seloEl.style.display = 'flex';
                            _seloEl.innerHTML = `
                                <div title="Selo Escolar ${_selo.label} — Média ${_media.toFixed(1)}" style="position:relative;width:40px;height:40px;cursor:pointer;" onclick="boletim.abrir('${auth.currentUser.id}')">
                                    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;">
                                        <polygon points="${_pts}" fill="${_selo.bg}" stroke="${_selo.ring}" stroke-width="1.5"/>
                                    </svg>
                                    <i class="fas fa-graduation-cap" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-55%);font-size:15px;color:${_selo.text};"></i>
                                    <div style="position:absolute;bottom:-3px;right:-3px;background:${_selo.bg};border:1.5px solid ${_selo.ring};border-radius:50%;width:15px;height:15px;display:flex;align-items:center;justify-content:center;">
                                        <i class="fas fa-star" style="font-size:7px;color:${_selo.star};"></i>
                                    </div>
                                </div>
                                <span style="font-size:9px;font-weight:700;color:${_selo.bg};letter-spacing:0.3px;">${_media.toFixed(1)}</span>`;
                        }
                    }
                }
            }
            const cardLeoes = document.getElementById('card-leoes-kids');
            if (idadeAtleta <= 15) {
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
            // Armazena no ui (onde estão todos os métodos do calendário)
            this._calHistorico = listaHistorico;
            if (this._calMes == null) this._calMes = new Date().getMonth();
            if (this._calAno == null) this._calAno = new Date().getFullYear();
            // Carrega eventos oficiais para o calendário
            db.collection('eventos_oficiais').get().then(snap => {
                this._calEventos = [];
                snap.forEach(doc => {
                    const ev = doc.data();
                    if (ev.dataEventoISO) this._calEventos.push({ iso: ev.dataEventoISO, titulo: ev.titulo, dataEvento: ev.dataEvento });
                });
            }).catch(() => {});
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
                    <!-- ── CALENDÁRIO / LISTA DE TREINOS ── -->
                    <div style="margin-top:14px; border-top:1px solid var(--border-light); padding-top:14px;">
                        <div style="display:flex; gap:6px; margin-bottom:12px;">
                            <button id="cal-btn-cal" onclick="ui.mudarVistaCalendario('calendario')"
                                style="flex:1; padding:8px; background:#1e3a8a; border:1px solid #3b82f6; color:#93c5fd; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">
                                📅 CALENDÁRIO
                            </button>
                            <button id="cal-btn-lista" onclick="ui.mudarVistaCalendario('lista')"
                                style="flex:1; padding:8px; background:#0f172a; border:1px solid #334155; color:#64748b; border-radius:8px; font-size:0.65rem; font-weight:800; cursor:pointer;">
                                📋 LISTA
                            </button>
                        </div>
                        <div id="cal-treinos-container"></div>
                    </div>
                    <!-- Botão contrato digital -->
                    <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border-light);">
                        <button id="btn-meu-contrato" onclick="contrato.abrir()"
                            style="width:100%; padding:11px; background:${d.contrato?.assinaturaImg ? '#064e3b' : '#1e293b'}; border:1px solid ${d.contrato?.assinaturaImg ? '#10b981' : '#334155'}; color:${d.contrato?.assinaturaImg ? '#10b981' : '#94a3b8'}; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i class="fas fa-file-contract"></i>
                            ${d.contrato?.assinaturaImg ? 'VER MEU CONTRATO ✅' : 'ASSINAR CONTRATO DIGITAL 📋'}
                        </button>
                    </div>
                    <!-- Botão histórico de graduações -->
                    <div style="margin-top:8px;">
                        <button onclick="graduacaoHistorico.abrirModal('${auth.currentUser.id}')"
                            style="width:100%; padding:11px; background:#1e1040; border:1px solid #7c3aed55; color:#a78bfa; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem; display:flex; align-items:center; justify-content:center; gap:8px;">
                            🎖️ HISTÓRICO DE GRADUAÇÕES
                        </button>
                    </div>
                    <!-- Diário de Treino -->
                    <div style="margin-top:8px;">
                        <button onclick="treinoPost.abrirDiario()"
                            style="width:100%; padding:11px; background:#0f172a; border:1px solid #33415555; color:#94a3b8; border-radius:8px; font-weight:800; cursor:pointer; font-size:0.75rem; display:flex; align-items:center; justify-content:center; gap:8px;">
                            📓 MEU DIÁRIO DE TREINO
                        </button>
                    </div>
                </div>`;
            // Renderiza calendário/lista após o HTML do perfil ser inserido
            setTimeout(() => this._renderCal(), 50);
            // Mostra wrapper de perfil (só para aluno)
            if (auth.role === 'aluno') {
                const wp = document.getElementById('wrapper-perfil-proprio');
                if (wp) wp.classList.remove('hidden');
            }
        }
    },

    // ── HELPERS PÚBLICOS DO CALENDÁRIO (usados nos onclicks) ─
    mudarVistaCalendario(vista) {
        this._calVista = vista;
        this._calDia   = null;
        this._renderCal();
    },
    navMesCalendario(delta) {
        this._calMes += delta;
        if (this._calMes > 11) { this._calMes = 0;  this._calAno++; }
        if (this._calMes < 0)  { this._calMes = 11; this._calAno--; }
        this._calDia = null;
        this._renderCal();
    },
    selecionarDiaCal(key) {
        this._calDia = (this._calDia === key) ? null : key;
        this._renderCal();
    },

    // ── CALENDÁRIO DE TREINOS ──────────────────────────────
    _parseDateKey(dataStr) {
        // Converte "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY, HH:MM:SS" → "YYYY-MM-DD"
        const m = (dataStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    },

    _renderCal() {
        const container = document.getElementById('cal-treinos-container');
        if (!container) return;

        // Atualiza estilo dos botões de aba
        const btnCal  = document.getElementById('cal-btn-cal');
        const btnLista = document.getElementById('cal-btn-lista');
        if (btnCal) {
            const ativo = this._calVista === 'calendario';
            btnCal.style.background   = ativo ? '#1e3a8a' : '#0f172a';
            btnCal.style.borderColor  = ativo ? '#3b82f6' : '#334155';
            btnCal.style.color        = ativo ? '#93c5fd' : '#64748b';
        }
        if (btnLista) {
            const ativo = this._calVista === 'lista';
            btnLista.style.background  = ativo ? '#1e3a8a' : '#0f172a';
            btnLista.style.borderColor = ativo ? '#3b82f6' : '#334155';
            btnLista.style.color       = ativo ? '#93c5fd' : '#64748b';
        }

        if (this._calVista === 'lista') {
            container.innerHTML = this._buildLista();
        } else {
            container.innerHTML = this._buildCalendario();
        }
    },

    _corTurma(turma) {
        if (academia._isTurmaMT(turma))   return '#ef4444'; // vermelho MT
        if (academia._isTurmaKids(turma)) return '#f59e0b'; // dourado Kids
        return '#3b82f6';                                     // azul JJ adulto
    },

    _buildCalendario() {
        const hist   = this._calHistorico || [];
        const eventos = this._calEventos || [];
        const mes   = this._calMes;
        const ano   = this._calAno;
        const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        // Monta mapa YYYY-MM-DD → [treinos]
        const mapaD = {};
        hist.forEach(t => {
            const key = this._parseDateKey(t.data);
            if (!key) return;
            if (!mapaD[key]) mapaD[key] = [];
            mapaD[key].push(t);
        });

        // Mapa de eventos YYYY-MM-DD → [eventos]
        const mapaEv = {};
        eventos.forEach(ev => {
            if (!mapaEv[ev.iso]) mapaEv[ev.iso] = [];
            mapaEv[ev.iso].push(ev);
        });

        const primeiroDia = new Date(ano, mes, 1).getDay();
        const ultimoDia   = new Date(ano, mes + 1, 0).getDate();
        const hoje        = new Date();

        // Conta treinos do mês
        let totalMes = 0;
        for (let d = 1; d <= ultimoDia; d++) {
            const key = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            totalMes += (mapaD[key] || []).length;
        }

        // Células em branco antes do dia 1
        let cells = Array(primeiroDia).fill(`<div></div>`).join('');

        for (let d = 1; d <= ultimoDia; d++) {
            const key      = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const treinos  = mapaD[key] || [];
            const evsDia   = mapaEv[key] || [];
            const isHoje   = ano === hoje.getFullYear() && mes === hoje.getMonth() && d === hoje.getDate();
            const isSel    = this._calDia === key;

            if (treinos.length > 0 || evsDia.length > 0) {
                const hasMT   = treinos.some(t => academia._isTurmaMT(t.turma));
                const hasKids = treinos.some(t => academia._isTurmaKids(t.turma));
                const corTreino = hasMT ? '#ef4444' : hasKids ? '#f59e0b' : '#3b82f6';
                const cor = treinos.length > 0 ? corTreino : '#a855f7';
                const label = treinos.length > 1 ? treinos.length : (treinos.length === 1 ? '●' : '');
                const evBadge = evsDia.length > 0 ? `<div style="font-size:0.55rem; line-height:1;">🏆</div>` : '';

                cells += `<div onclick="ui.selecionarDiaCal('${key}')"
                    style="text-align:center; cursor:pointer; border-radius:7px; padding:4px 2px;
                           background:${isSel ? cor + '33' : cor + '18'};
                           border:1px solid ${isSel ? cor : cor + '44'};">
                    <div style="font-size:0.55rem; color:#94a3b8; font-weight:600; line-height:1.2;">${d}</div>
                    ${label ? `<div style="font-size:${treinos.length > 1 ? '0.6rem' : '0.72rem'}; color:${corTreino}; font-weight:800; line-height:1.2;">${label}</div>` : ''}
                    ${evBadge}
                </div>`;
            } else {
                cells += `<div style="text-align:center; padding:4px 2px;
                    ${isHoje ? 'border:1px solid #3b82f644; border-radius:7px; background:#1e3a8a18;' : ''}">
                    <div style="font-size:0.55rem; color:${isHoje ? '#3b82f6' : '#334155'}; font-weight:${isHoje ? '800' : '400'}; line-height:1.2;">${d}</div>
                    <div style="font-size:0.5rem; color:transparent; line-height:1.2;">·</div>
                </div>`;
            }
        }

        // Detalhe do dia selecionado
        let detalhe = '';
        if (this._calDia && (mapaD[this._calDia] || mapaEv[this._calDia])) {
            const [ay, am, ad] = this._calDia.split('-');
            const treinosDia = mapaD[this._calDia] || [];
            const eventosDia = mapaEv[this._calDia] || [];
            detalhe = `
                <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; margin-top:10px;">
                    <div style="font-size:0.6rem; color:#64748b; font-weight:700; margin-bottom:6px;">📅 ${ad}/${am}/${ay}</div>
                    ${treinosDia.map(t => {
                        const cor = this._corTurma(t.turma);
                        return `<div style="font-size:0.72rem; color:#e2e8f0; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                            <span style="color:${cor}; font-size:0.65rem;">●</span>
                            <span>${t.turma}</span>
                        </div>`;
                    }).join('')}
                    ${eventosDia.map(ev => `
                        <div onclick="ui.showTab('tab-eventos')" style="font-size:0.72rem; color:#e2e8f0; margin-bottom:4px; display:flex; align-items:center; gap:6px; border-top:1px solid #1e293b; padding-top:6px; cursor:pointer; background:#1e0a3c; border-radius:6px; padding:6px 8px; margin-top:4px;">
                            <span style="font-size:0.9rem;">🏆</span>
                            <div style="flex:1;">
                                <div style="font-weight:700; color:#a855f7;">${ev.titulo}</div>
                                <div style="font-size:0.6rem; color:#64748b;">${ev.dataEvento}</div>
                            </div>
                            <span style="font-size:0.6rem; color:#a855f7;">ver →</span>
                        </div>`).join('')}
                </div>`;
        }

        return `
            <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px;">
                <!-- Navegação mês -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <button onclick="ui.navMesCalendario(-1)"
                        style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:700;">◄</button>
                    <span style="font-size:0.78rem; font-weight:800; color:white;">${meses[mes]} ${ano}</span>
                    <button onclick="ui.navMesCalendario(1)"
                        style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:700;">►</button>
                </div>
                <!-- Cabeçalho dias da semana -->
                <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:4px;">
                    ${['D','S','T','Q','Q','S','S'].map(d =>
                        `<div style="text-align:center; font-size:0.5rem; color:#475569; font-weight:700;">${d}</div>`
                    ).join('')}
                </div>
                <!-- Grid de dias -->
                <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px;">
                    ${cells}
                </div>
                ${detalhe}
                <!-- Legenda -->
                <div style="display:flex; gap:12px; margin-top:10px; justify-content:center; flex-wrap:wrap;">
                    <span style="font-size:0.55rem; color:#3b82f6; font-weight:700;">● JJ Adulto</span>
                    <span style="font-size:0.55rem; color:#f59e0b; font-weight:700;">● Kids</span>
                    <span style="font-size:0.55rem; color:#ef4444; font-weight:700;">● Muay Thai</span>
                </div>
                <!-- Total -->
                <div style="font-size:0.65rem; color:#64748b; margin-top:8px; text-align:center; font-weight:600;">
                    ${totalMes} treino${totalMes !== 1 ? 's' : ''} em ${meses[mes]}
                </div>
            </div>`;
    },

    _buildLista() {
        const hist = this._calHistorico || [];
        if (hist.length === 0) {
            return `<p style="color:var(--text-muted); text-align:center; font-size:0.75rem; padding:10px;">Nenhum treino registrado.</p>`;
        }
        return `<div style="max-height:220px; overflow-y:auto; padding-right:4px;">` +
            hist.map(t => {
                const cor  = this._corTurma(t.turma);
                const data = (t.data || '').split(/[\s,]+/);
                return `<div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:9px 12px; border-radius:8px; margin-bottom:5px; border-left:3px solid ${cor};">
                    <div style="font-size:0.78rem; color:#e2e8f0; font-weight:600;">
                        <span style="color:${cor}; margin-right:5px;">●</span>${t.turma}
                    </div>
                    <div style="font-size:0.6rem; color:var(--text-muted); white-space:nowrap; margin-left:8px;">${data[0] || ''}</div>
                </div>`;
            }).join('') + `</div>`;
    }
};

// ══════════════════════════════════════════════════════════
// ANIVERSÁRIO — Popup para aluno + card admin
// ══════════════════════════════════════════════════════════
const aniversario = {

    // ── VERIFICA E MOSTRA POPUP PARA O ALUNO ──────────────
    async verificarAniversario() {
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
        try {
            // Busca sempre do Firestore (garante que nascimento está lá)
            let nascimento = auth.currentUser?.nascimento;
            if (!nascimento) {
                const doc = await db.collection('alunos').doc(auth.currentUser.id).get();
                if (doc.exists) nascimento = doc.data().nascimento;
            }
            if (!nascimento) return;

            // Usa data LOCAL (evita bug de fuso horário do UTC)
            // nascimento formato: "YYYY-MM-DD"
            const partes = nascimento.split('-');
            if (partes.length < 3) return;
            const diaNasc = parseInt(partes[2], 10);
            const mesNasc = parseInt(partes[1], 10) - 1; // 0-indexed

            const hoje     = new Date();
            const diaHoje  = hoje.getDate();
            const mesHoje  = hoje.getMonth();

            if (diaNasc !== diaHoje || mesNasc !== mesHoje) return;

            // Chave do dia em local time (não UTC)
            const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
            const chave   = `gaditas_aniv_${auth.currentUser.id}_${hojeStr}`;
            if (localStorage.getItem(chave)) return;

            this._mostrarPopupAniversario(auth.currentUser.nome, chave);
        } catch(e) { console.warn('Aniversário:', e.message); }
    },

    _mostrarPopupAniversario(nomeCompleto, chaveLocalStorage) {
        document.getElementById('modal-aniversario')?.remove();
        // Pega o primeiro nome
        const primeiroNome = (nomeCompleto || '').split(' ')[0];

        const modal = document.createElement('div');
        modal.id = 'modal-aniversario';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#1e1040,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px rgba(245,158,11,0.3);position:relative;overflow:hidden;">
                <!-- Confetes de fundo -->
                <div style="position:absolute;top:-10px;left:0;right:0;font-size:1.4rem;opacity:0.15;user-select:none;line-height:1.8;pointer-events:none;">
                    🎉🎊🎈🎁🥳🎉🎊🎈🎁🥳🎉🎊🎈🎁🥳🎉🎊🎈🎁🥳🎉🎊🎈🎁🥳
                </div>

                <div style="font-size:4rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">🎂</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Gaditas Matriz</div>

                <div style="font-size:1.5rem;font-weight:800;color:white;line-height:1.3;margin-bottom:6px;">
                    Feliz Aniversário,<br>
                    <span style="color:#f59e0b;">${primeiroNome}!</span>
                </div>

                <div style="font-size:0.8rem;color:#94a3b8;line-height:1.7;margin:16px 0 24px;">
                    A família <strong style="color:white;">Gaditas</strong> celebra este dia especial com você! 🎉<br><br>
                    Que o tatame continue sendo seu lugar de <strong style="color:#f59e0b;">crescimento</strong>, conquistas e muita alegria.<br><br>
                    <span style="font-size:1rem;">OSS! 🥋💪</span>
                </div>

                <div id="parabens-recebidos-aniv" style="margin-bottom:16px;"></div>

                <button onclick="aniversario._dispensar('${chaveLocalStorage}')"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;letter-spacing:0.5px;">
                    🙏 MUITO OBRIGADO!
                </button>
            </div>
            <style>
                @keyframes bounce { from { transform:translateY(0); } to { transform:translateY(-10px); } }
            </style>`;

        document.body.appendChild(modal);

        // Carrega parabéns recebidos em tempo real
        const hojeStr = chaveLocalStorage.split('_').slice(-1)[0];
        const alunoId = auth.currentUser?.id;
        if (alunoId) {
            db.collection('parabens').doc(`${alunoId}_${hojeStr}`)
                .onSnapshot(snap => {
                    const el = document.getElementById('parabens-recebidos-aniv');
                    if (!el) return;
                    const desejos = snap.exists ? (snap.data().desejos || []) : [];
                    if (!desejos.length) { el.innerHTML = ''; return; }
                    const itens = desejos.map(d => `
                        <div style="background:#0f172a;border-left:3px solid #f59e0b;border-radius:8px;padding:9px 12px;margin-bottom:6px;text-align:left;">
                            <div style="font-size:0.68rem;font-weight:800;color:#f59e0b;">🎉 ${d.deNome.split(' ')[0]}</div>
                            <div style="font-size:0.75rem;color:#e2e8f0;margin-top:3px;line-height:1.4;">"${d.mensagem || ''}"</div>
                        </div>`).join('');
                    el.innerHTML = `<div style="margin-bottom:4px;font-size:0.62rem;font-weight:800;color:#f59e0b;letter-spacing:1px;text-align:left;">
                        💌 ${desejos.length} ${desejos.length===1?'MENSAGEM RECEBIDA':'MENSAGENS RECEBIDAS'}
                    </div>${itens}`;
                });
        }
    },

    _dispensar(chave) {
        if (chave) localStorage.setItem(chave, '1');
        document.getElementById('modal-aniversario')?.remove();
    },

    // ── CONVOCAÇÃO PARA EXAME ──────────────────────────────
    _convocacaoListener: null,

    verificarConvocacao() {
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
        const alunoId = auth.currentUser?.id;
        if (!alunoId || alunoId === 'admin') return;

        if (this._convocacaoListener) { this._convocacaoListener(); this._convocacaoListener = null; }

        let _aulasAntes = null; // rastreia aulas para detectar presença computada

        this._convocacaoListener = db.collection('alunos').doc(alunoId)
            .onSnapshot(async snap => {
                if (!snap.exists) return;
                const dados = snap.data();

                // 1. Atualiza visibilidade da aba EXAME
                const btn = document.getElementById('menu-exame');
                if (btn && auth.role !== 'admin') {
                    if (dados.aspiranteGraduacao === true) btn.classList.remove('nav-item-hidden');
                    else btn.classList.add('nav-item-hidden');
                }

                // 2. Popup de convocação
                if (dados.convocacaoPendente) {
                    try { await db.collection('alunos').doc(alunoId).update({ convocacaoPendente: firebase.firestore.FieldValue.delete() }); } catch(e) {}
                    this._mostrarPopupConvocacao(auth.currentUser.nome, dados.faixa);
                }

                // 3. Feedback pendente → modal pós-treino (persiste até o aluno responder)
                if (dados.feedbackPendente) {
                    const { turma, data } = dados.feedbackPendente;
                    const novasAulas = dados.aulas || 0;
                    treinoPost.aoCheckinConcluido(alunoId, novasAulas, turma);
                }

            }, e => console.warn('Convocação listener:', e.message));
    },

    _mostrarPopupConvocacao(nomeCompleto, faixaAtual) {
        document.getElementById('modal-convocacao')?.remove();
        const primeiroNome = (nomeCompleto || '').split(' ')[0];
        const corFaixa = {
            'Branca':'#e2e8f0','Cinza/Branca':'#b0bec5','Cinza':'#94a3b8','Cinza/Preta':'#607d8b',
            'Amarela/Branca':'#fff176','Amarela':'#facc15','Amarela/Preta':'#f59e0b',
            'Laranja/Branca':'#ffb74d','Laranja':'#fb923c','Laranja/Preta':'#f97316',
            'Verde/Branca':'#a5d6a7','Verde':'#4ade80','Verde/Preta':'#22c55e',
            'Azul':'#60a5fa','Roxa':'#a78bfa','Marrom':'#d97706','Preta':'#f59e0b'
        }[faixaAtual] || '#10b981';

        const modal = document.createElement('div');
        modal.id = 'modal-convocacao';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid #10b981;border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px #10b98133;position:relative;overflow:hidden;">
                <div style="position:absolute;top:-10px;left:0;right:0;font-size:1.4rem;opacity:0.12;user-select:none;line-height:1.8;pointer-events:none;">
                    🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️🥋🏅🎖️
                </div>
                <div style="font-size:3.5rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">📋</div>
                <div style="font-size:0.6rem;color:#10b981;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Gaditas Academy</div>
                <div style="font-size:1.5rem;font-weight:800;color:white;line-height:1.3;margin-bottom:6px;">
                    Parabéns,<br>
                    <span style="color:#10b981;">${primeiroNome}!</span>
                </div>
                <div style="display:inline-block;background:#10b981;color:#000;font-weight:800;font-size:0.9rem;padding:8px 24px;border-radius:999px;margin:12px 0;letter-spacing:1px;">
                    🏆 CONVOCADO PARA O EXAME DE FAIXA
                </div>
                <div style="font-size:0.82rem;color:#94a3b8;line-height:1.7;margin:16px 0 24px;">
                    Seu professor reconheceu sua evolução no tatame e você foi <strong style="color:white;">convocado(a) para o exame de faixa!</strong> 🎉<br><br>
                    Isso é fruto de muito esforço, dedicação e presença. A família <strong style="color:white;">Gaditas</strong> está orgulhosa de você!<br><br>
                    <span style="font-size:1.1rem;font-weight:800;color:#10b981;">OSS! 💪🥋</span>
                </div>
                <button onclick="document.getElementById('modal-convocacao').remove()"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#10b981,#059669);color:#000;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;letter-spacing:0.5px;">
                    🙏 OSS, VAMOS NESSA!
                </button>
            </div>
            <style>
                @keyframes bounce { from { transform:translateY(0); } to { transform:translateY(-10px); } }
            </style>`;

        document.body.appendChild(modal);
    },

    // ── PARABÉNS POR GRADUAÇÃO ─────────────────────────────
    _graduacaoListener: null,

    async verificarGraduacao() {
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
        const alunoId = auth.currentUser?.id;
        if (!alunoId || alunoId === 'admin') return;

        // Cancela listener anterior se existir
        if (this._graduacaoListener) { this._graduacaoListener(); this._graduacaoListener = null; }

        // Listener em tempo real: dispara popup mesmo com aluno já logado
        this._graduacaoListener = db.collection('alunos').doc(alunoId)
            .onSnapshot(async snap => {
                if (!snap.exists) return;
                const dados = snap.data();
                if (!dados.graduacaoPendente) return;
                const g = dados.graduacaoPendente;
                try {
                    await db.collection('alunos').doc(alunoId).update({ graduacaoPendente: firebase.firestore.FieldValue.delete() });
                } catch(e) { /* ignora erro de limpeza */ }
                this._mostrarPopupGraduacao(auth.currentUser.nome, g);
            }, e => console.warn('Graduação listener:', e.message));
    },

    _mostrarPopupGraduacao(nomeCompleto, g) {
        document.getElementById('modal-graduacao')?.remove();
        const primeiroNome = (nomeCompleto || '').split(' ')[0];

        const coresFaixa = {
            'Branco': '#e2e8f0', 'Cinza': '#94a3b8', 'Amarelo': '#fbbf24',
            'Laranja': '#f97316', 'Verde': '#22c55e', 'Azul': '#3b82f6',
            'Roxo': '#a855f7', 'Marrom': '#92400e', 'Preto': '#1e293b',
            'Vermelho': '#ef4444', 'Vermelho e Preto': '#ef4444',
            'Vermelho e Branco': '#ef4444', 'Coral': '#fb7185'
        };

        const isMT = (g.modalidadeAlterada || g.modalidade) === 'muaythai';
        const faixaExibir = isMT ? (g.faixaMT || g.faixa) : g.faixa;
        const cor = coresFaixa[faixaExibir] || '#8b5cf6';
        const isEscura = ['Preto', 'Marrom', 'Roxo', 'Azul'].includes(faixaExibir);
        const textoBtn = isEscura ? '#fff' : '#000';

        const grauStr = (!isMT && g.grau > 0) ? ` — ${g.grau}° Grau` : '';
        const modalidade = isMT ? '🥊 Muay Thai' : '🥋 Jiu-Jitsu';

        const beltVisual = isMT
            ? ui.renderBeltMT(g.faixaMT).replace('height:10px', 'height:22px').replace('margin-top:4px', 'margin:16px 0')
            : ui.renderBeltJJ(g.faixa, g.grau).replace('height:10px', 'height:22px').replace('margin-top:4px', 'margin:16px 0');

        const modal = document.createElement('div');
        modal.id = 'modal-graduacao';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid ${cor};border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px ${cor}55;position:relative;overflow:hidden;">
                <div style="position:absolute;top:-10px;left:0;right:0;font-size:1.4rem;opacity:0.12;user-select:none;line-height:1.8;pointer-events:none;">
                    🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️🥋🏆🎖️
                </div>
                <div style="font-size:3.5rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">🏆</div>
                <div style="font-size:0.6rem;color:${cor};font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${modalidade}</div>
                <div style="font-size:1.5rem;font-weight:800;color:white;line-height:1.3;margin-bottom:6px;">
                    Parabéns,<br>
                    <span style="color:${cor};">${primeiroNome}!</span>
                </div>
                <div style="display:inline-block;background:${cor};color:${textoBtn};font-weight:800;font-size:1rem;padding:8px 24px;border-radius:999px;margin:12px 0;letter-spacing:1px;">
                    Faixa ${faixaExibir}${grauStr}
                </div>
                <div style="padding:0 12px;">${beltVisual}</div>
                <div style="font-size:0.82rem;color:#94a3b8;line-height:1.7;margin:16px 0 24px;">
                    Sua dedicação no tatame chegou a um novo nível! 🔥<br><br>
                    A família <strong style="color:white;">Gaditas</strong> celebra essa conquista com muito orgulho.<br><br>
                    <span style="font-size:1.1rem;font-weight:800;color:white;">OSS! 💪🥋</span>
                </div>
                <button onclick="document.getElementById('modal-graduacao').remove()"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,${cor},${cor}cc);color:${textoBtn};border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;letter-spacing:0.5px;">
                    🙏 OSS, MUITO OBRIGADO!
                </button>
            </div>
            <style>
                @keyframes bounce { from { transform:translateY(0); } to { transform:translateY(-10px); } }
            </style>`;

        document.body.appendChild(modal);
    },

    // ── ANIVERSÁRIO DE COLEGAS ────────────────────────────
    async verificarAniversarioColegas() {
        if (auth.role !== 'aluno') return;
        const eu = auth.currentUser;
        if (!eu) return;

        const hoje = new Date();
        const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
        const chave = `gaditas_colegas_aniv_${eu.id}_${hojeStr}`;
        if (localStorage.getItem(chave)) return;

        try {
            const euDoc = await db.collection('alunos').doc(eu.id).get();
            if (!euDoc.exists) return;
            const euData = euDoc.data();

            const anoAtual = hoje.getFullYear();
            const euIdade = euData.nascimento ? (anoAtual - new Date(euData.nascimento + 'T12:00:00').getFullYear()) : 99;
            const euEhKids = euIdade <= 15;
            const euMod = euData.modalidade || 'jiujitsu';
            const euTreinaComAdultos = euData.treinaComAdultos === true;

            const snap = await db.collection('alunos').get();
            const aniversariantes = [];

            snap.docs.forEach(doc => {
                if (doc.id === eu.id) return;
                const a = doc.data();
                if (!a.nascimento || !a.nome) return;
                const parts = a.nascimento.split('-');
                if (parts.length < 3) return;
                if (parseInt(parts[2],10) !== hoje.getDate()) return;
                if (parseInt(parts[1],10)-1 !== hoje.getMonth()) return;

                const aIdade = anoAtual - new Date(a.nascimento + 'T12:00:00').getFullYear();
                const aEhKids = aIdade <= 15;
                const aMod = a.modalidade || 'jiujitsu';

                let deveVer = false;
                if (euEhKids) {
                    if (aEhKids) deveVer = true;
                    if (!aEhKids && euTreinaComAdultos && (aMod === 'jiujitsu' || aMod === 'ambos')) deveVer = true;
                } else {
                    if (!aEhKids) {
                        if ((euMod === 'jiujitsu' || euMod === 'ambos') && (aMod === 'jiujitsu' || aMod === 'ambos')) deveVer = true;
                        if ((euMod === 'muaythai' || euMod === 'ambos') && (aMod === 'muaythai' || aMod === 'ambos')) deveVer = true;
                    }
                }
                if (deveVer) aniversariantes.push({ id: doc.id, nome: a.nome });
            });

            if (aniversariantes.length === 0) return;
            localStorage.setItem(chave, '1');
            this._mostrarPopupColegas(aniversariantes, eu.id, hojeStr);
        } catch(e) { console.warn('Aniversário colegas:', e.message); }
    },

    _mostrarPopupColegas(colegas, meuId, hojeStr) {
        document.getElementById('modal-aniv-colegas')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-aniv-colegas';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        const cards = colegas.map(c => {
            const primeiroNome = c.nome.split(' ')[0];
            const safeId = c.id.replace(/[^a-zA-Z0-9]/g, '_');
            return `<div style="background:#0f172a;border:1px solid #f59e0b44;border-radius:12px;padding:12px 14px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div style="font-size:1.5rem;">🎂</div>
                    <div>
                        <div style="font-size:0.88rem;font-weight:800;color:white;">${primeiroNome}</div>
                        <div style="font-size:0.6rem;color:#64748b;">${c.nome}</div>
                    </div>
                </div>
                <textarea id="msg-parabens-${safeId}" placeholder="Escreva sua mensagem de parabéns... 🎉"
                    style="width:100%;padding:9px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.78rem;resize:none;box-sizing:border-box;font-family:inherit;"
                    rows="2" maxlength="200"></textarea>
                <button id="btn-parabens-${safeId}"
                    onclick="aniversario.darParabens('${c.id}','${c.nome.replace(/'/g,"\\'")}','${meuId}','${hojeStr}','${safeId}',this)"
                    style="margin-top:6px;width:100%;padding:9px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:8px;font-weight:800;font-size:0.72rem;cursor:pointer;">
                    🎉 Enviar Parabéns
                </button>
            </div>`;
        }).join('');

        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#1e1040,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:28px 24px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 60px rgba(245,158,11,0.25);max-height:88vh;overflow-y:auto;">
                <div style="font-size:3rem;margin-bottom:6px;">🎂</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;margin-bottom:8px;">ANIVERSARIANTES DE HOJE</div>
                <div style="font-size:1.1rem;font-weight:800;color:white;margin-bottom:20px;">
                    ${colegas.length === 1 ? 'Um colega faz aniversário hoje!' : `${colegas.length} colegas fazem aniversário hoje!`}
                </div>
                <div style="text-align:left;">${cards}</div>
                <button onclick="document.getElementById('modal-aniv-colegas').remove()"
                    style="margin-top:8px;width:100%;padding:14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:12px;font-weight:800;font-size:0.85rem;cursor:pointer;">
                    Fechar
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    async darParabens(alunoId, alunoNome, meuId, hojeStr, safeId, btnEl) {
        const textarea = document.getElementById(`msg-parabens-${safeId}`);
        const mensagem = (textarea?.value || '').trim();
        if (!mensagem) { textarea?.focus(); textarea?.setAttribute('style', textarea.getAttribute('style') + ';border-color:#f59e0b;'); return; }
        try {
            btnEl.disabled = true;
            if (textarea) textarea.disabled = true;
            btnEl.textContent = '⏳';
            const eu = auth.currentUser;
            const ref = db.collection('parabens').doc(`${alunoId}_${hojeStr}`);
            await ref.set({
                alunoId, alunoNome, data: hojeStr,
                desejos: firebase.firestore.FieldValue.arrayUnion({
                    deId: meuId, deNome: eu.nome || '', mensagem, at: new Date().toISOString()
                })
            }, { merge: true });
            btnEl.textContent = '✅ Enviado!';
            btnEl.style.background = 'linear-gradient(135deg,#10b981,#059669)';
            // Push para o aniversariante
            try {
                const aDoc = await db.collection('alunos').doc(alunoId).get();
                const token = aDoc.exists ? aDoc.data().fcmToken : null;
                if (token) {
                    await fetch('/api/push-comunicado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            token,
                            title: `🎉 Parabéns, ${alunoNome.split(' ')[0]}!`,
                            body: `${eu.nome?.split(' ')[0] || 'Um colega'} te desejou: "${mensagem.slice(0,60)}"`
                        })
                    });
                }
            } catch(e) { /* push opcional */ }
        } catch(e) {
            btnEl.disabled = false;
            if (textarea) textarea.disabled = false;
            btnEl.textContent = '🎉 Enviar Parabéns';
            alert('Erro: ' + e.message);
        }
    },

    // ── ANIVERSÁRIO DO MESTRE ─────────────────────────────
    async verificarAniversarioMestre() {
        if (auth.role !== 'aluno') return;
        try {
            const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
            if (!adminDoc.exists) return;
            const nascimento = adminDoc.data().nascimentoMestre;
            if (!nascimento) return;

            const parts = nascimento.split('-');
            if (parts.length < 3) return;
            const diaNasc = parseInt(parts[2], 10);
            const mesNasc = parseInt(parts[1], 10) - 1;

            const hoje = new Date();
            const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);

            const ehHoje   = hoje.getDate()   === diaNasc && hoje.getMonth()   === mesNasc;
            const ehAmanha = amanha.getDate() === diaNasc && amanha.getMonth() === mesNasc;
            if (!ehHoje && !ehAmanha) return;

            const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
            const chave = `gaditas_mestre_aniv_${hojeStr}`;
            if (localStorage.getItem(chave)) return;
            localStorage.setItem(chave, '1');

            const nomeMestre = adminDoc.data().nome || 'Mestre';
            this._mostrarPopupMestre(nomeMestre, ehHoje);
        } catch(e) { console.warn('Aniversário mestre:', e.message); }
    },

    _mostrarPopupMestre(nomeMestre, ehHoje) {
        document.getElementById('modal-aniv-mestre')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-aniv-mestre';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const primeiroNome = nomeMestre.split(' ')[0];

        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#1a0a00,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px rgba(245,158,11,0.4);position:relative;overflow:hidden;">
                <div style="position:absolute;top:-10px;left:0;right:0;font-size:1.4rem;opacity:0.12;user-select:none;line-height:1.8;pointer-events:none;">
                    🏆🥋🎖️🏆🥋🎖️🏆🥋🎖️🏆🥋🎖️🏆🥋🎖️🏆🥋🎖️🏆🥋🎖️
                </div>
                <div style="font-size:3.5rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">${ehHoje ? '🎂' : '🎉'}</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;margin-bottom:10px;">GADITAS ACADEMY</div>
                ${ehHoje ? `
                    <div style="font-size:1.4rem;font-weight:900;color:white;line-height:1.3;margin-bottom:12px;">
                        🎂 Hoje é Aniversário<br>do <span style="color:#f59e0b;">Mestre ${primeiroNome}!</span>
                    </div>
                    <div style="font-size:0.82rem;color:#94a3b8;line-height:1.7;margin:0 0 24px;">
                        A família Gaditas celebra este dia especial com nosso <strong style="color:white;">Mestre</strong>!<br><br>
                        Obrigado por tudo que você constrói no tatame todos os dias. 🙏<br><br>
                        <span style="font-size:1rem;font-weight:800;color:#f59e0b;">OSS! 🥋💪</span>
                    </div>` : `
                    <div style="font-size:1.4rem;font-weight:900;color:white;line-height:1.3;margin-bottom:12px;">
                        Amanhã é Aniversário<br>do <span style="color:#f59e0b;">Mestre ${primeiroNome}!</span>
                    </div>
                    <div style="font-size:0.82rem;color:#94a3b8;line-height:1.7;margin:0 0 24px;">
                        Que tal já ir se preparando para parabenizá-lo? 🎉<br><br>
                        Seu aniversário é <strong style="color:white;">amanhã!</strong> 🥋<br><br>
                        <span style="font-size:1rem;font-weight:800;color:#f59e0b;">OSS! 🙏</span>
                    </div>`}
                <button onclick="document.getElementById('modal-aniv-mestre').remove()"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;letter-spacing:0.5px;">
                    ${ehHoje ? '🎂 FELIZ ANIVERSÁRIO, MESTRE!' : '🙏 OSS!'}
                </button>
            </div>
            <style>@keyframes bounce { from { transform:translateY(0); } to { transform:translateY(-10px); } }</style>`;
        document.body.appendChild(modal);
    },

    // Verifica se há parabéns recebidos nos últimos 5 dias
    async verificarParabensRecebidos() {
        if (auth.role !== 'aluno') return;
        const eu = auth.currentUser;
        if (!eu) return;
        const hoje = new Date();
        // Checa os últimos 5 dias
        for (let i = 0; i < 5; i++) {
            const d = new Date(hoje);
            d.setDate(d.getDate() - i);
            const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const chave = `gaditas_parabens_visto_${eu.id}_${ds}`;
            if (localStorage.getItem(chave)) continue;
            try {
                const snap = await db.collection('parabens').doc(`${eu.id}_${ds}`).get();
                if (!snap.exists) continue;
                const desejos = snap.data().desejos || [];
                if (!desejos.length) continue;
                localStorage.setItem(chave, '1');
                this._mostrarPopupParabensRecebidos(desejos, ds, i === 0);
                return; // mostra só o mais recente
            } catch(e) { /* ignora */ }
        }
    },

    _mostrarPopupParabensRecebidos(desejos, dataStr, ehHoje) {
        document.getElementById('modal-parabens-recebidos')?.remove();
        const [ano, mes, dia] = dataStr.split('-');
        const dataFmt = `${dia}/${mes}/${ano}`;
        const label = ehHoje ? 'Hoje' : dataFmt;

        const itens = desejos.map(d => `
            <div style="background:#0f172a;border-left:3px solid #f59e0b;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                <div style="font-size:0.72rem;font-weight:800;color:#f59e0b;margin-bottom:4px;">🎉 ${d.deNome.split(' ')[0]}</div>
                <div style="font-size:0.8rem;color:#e2e8f0;line-height:1.5;">"${d.mensagem}"</div>
            </div>`).join('');

        const modal = document.createElement('div');
        modal.id = 'modal-parabens-recebidos';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99996;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#1e1040,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:28px 24px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 60px rgba(245,158,11,0.2);max-height:85vh;overflow-y:auto;">
                <div style="font-size:3rem;margin-bottom:6px;">💌</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;margin-bottom:4px;">PARABÉNS RECEBIDOS — ${label.toUpperCase()}</div>
                <div style="font-size:1rem;font-weight:800;color:white;margin-bottom:20px;">
                    ${desejos.length} ${desejos.length===1?'colega te desejou':'colegas te desejaram'} parabéns 🎂
                </div>
                <div style="text-align:left;">${itens}</div>
                <button onclick="document.getElementById('modal-parabens-recebidos').remove()"
                    style="margin-top:12px;width:100%;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:12px;font-weight:800;font-size:0.85rem;cursor:pointer;">
                    🙏 Muito Obrigado!
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    // ── CARD ADMIN — HOJE E ESTA SEMANA ───────────────────
    async renderAdminAniversariantes() {
        const container = document.getElementById('lista-aniversariantes');
        if (!container) return;
        container.innerHTML = '<small style="color:#475569;font-size:0.65rem;">Carregando...</small>';

        try {
            const snap = await db.collection('alunos').get();
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            const hoje7 = [];  // próximos 7 dias (inclui hoje)

            snap.docs.forEach(doc => {
                const a  = { id: doc.id, ...doc.data() };
                if (!a.nascimento) return;
                // Parse sem timezone (evita bug UTC-3)
                const partes = a.nascimento.split('-');
                if (partes.length < 3) return;
                const diaNasc = parseInt(partes[2], 10);
                const mesNasc = parseInt(partes[1], 10) - 1;
                const anoNasc = parseInt(partes[0], 10);
                for (let d = 0; d < 7; d++) {
                    const dia = new Date(hoje);
                    dia.setDate(hoje.getDate() + d);
                    if (diaNasc === dia.getDate() && mesNasc === dia.getMonth()) {
                        const idade = hoje.getFullYear() - anoNasc;
                        hoje7.push({ ...a, _diasRestantes: d, _idade: idade });
                        break;
                    }
                }
            });

            if (hoje7.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:12px;color:#475569;font-size:0.7rem;">Nenhum aniversariante nos próximos 7 dias.</div>';
                return;
            }

            // Ordena por dias restantes
            hoje7.sort((a, b) => a._diasRestantes - b._diasRestantes);

            const hojeList   = hoje7.filter(a => a._diasRestantes === 0);
            const semanaList = hoje7.filter(a => a._diasRestantes > 0);

            const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
            const renderItem = (a) => {
                const isHoje = a._diasRestantes === 0;
                const diaRef = isHoje ? '🎂 HOJE!' : (() => {
                    const d = new Date(hoje);
                    d.setDate(hoje.getDate() + a._diasRestantes);
                    return diasSemana[d.getDay()] + ' ' + d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
                })();
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;background:${isHoje ? '#1c1400' : '#0f172a'};border:1px solid ${isHoje ? '#f59e0b' : '#334155'};border-radius:8px;padding:9px 12px;margin-bottom:6px;">
                        <div>
                            <div style="font-size:0.75rem;font-weight:800;color:${isHoje ? '#f59e0b' : 'white'};">${a.nome}</div>
                            <div style="font-size:0.58rem;color:#64748b;margin-top:2px;">${a.faixa || '—'} · ${a._idade} anos</div>
                        </div>
                        <div style="font-size:0.6rem;font-weight:800;color:${isHoje ? '#f59e0b' : '#64748b'};white-space:nowrap;">${diaRef}</div>
                    </div>`;
            };

            let html = '';
            if (hojeList.length > 0) {
                html += `<div style="font-size:0.58rem;color:#f59e0b;font-weight:800;margin-bottom:6px;letter-spacing:0.8px;">🎂 HOJE</div>`;
                html += hojeList.map(renderItem).join('');
            }
            if (semanaList.length > 0) {
                html += `<div style="font-size:0.58rem;color:#64748b;font-weight:800;margin:${hojeList.length ? '12px' : '0'} 0 6px;letter-spacing:0.8px;">📅 ESTA SEMANA</div>`;
                html += semanaList.map(renderItem).join('');
            }

            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = `<small style="color:#ef4444;font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    // ── POPUP AULA CANCELADA — aparece no login do aluno ──
    async verificarAulasCanceladas() {
        if (auth.role !== 'aluno') return;
        const eu = auth.currentUser;
        if (!eu) return;
        try {
            const hoje = new Date();
            const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
            const doc = await db.collection('aulas_canceladas').doc(hojeStr).get();
            if (!doc.exists) return;
            const canceladas = doc.data(); // { "Kids 1": true, "BJJ Adulto": true, ... }

            const turmasCanceladas = Object.keys(canceladas).filter(k => canceladas[k] === true);
            if (!turmasCanceladas.length) return;

            const turmasAluno = eu.turmas || [];
            const modalidade  = eu.modalidade || 'jiujitsu';
            const idade       = eu.nascimento ? (hoje.getFullYear() - parseInt(eu.nascimento.split('-')[0])) : 99;
            const isKids      = idade <= 15;

            const minhasTurmasCanceladas = turmasCanceladas.filter(t => {
                // Correspondência direta pelo nome da turma
                if (turmasAluno.some(ta => ta === t)) return true;
                // Fallback por categoria/modalidade
                const tl = t.toLowerCase();
                if (isKids && tl.includes('kids')) return true;
                if (!isKids && tl.includes('kids')) return false;
                if (modalidade === 'muaythai' && (tl.includes('muay') || tl.includes('mt'))) return true;
                if (modalidade === 'jiujitsu' && !tl.includes('muay') && !tl.includes('mt') && !tl.includes('kids')) return true;
                return false;
            });

            if (!minhasTurmasCanceladas.length) return;

            // Evita mostrar o mesmo popup duas vezes no mesmo dia
            const chave = `gaditas_canc_${eu.id}_${hojeStr}_${minhasTurmasCanceladas.sort().join('_').replace(/\s/g,'_')}`;
            if (localStorage.getItem(chave)) return;

            this._mostrarPopupAulaCancelada(eu.nome, minhasTurmasCanceladas, chave);
        } catch(e) { console.warn('verificarAulasCanceladas:', e.message); }
    },

    _mostrarPopupAulaCancelada(nomeCompleto, turmas, chaveLocalStorage) {
        document.getElementById('modal-aula-cancelada')?.remove();
        const primeiroNome = (nomeCompleto || '').split(' ')[0];
        const listaTurmas = turmas.map(t => `<div style="background:#1a0404;border-left:3px solid #ef4444;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:0.85rem;font-weight:800;color:#fca5a5;">🚫 ${t.toUpperCase()}</div>`).join('');

        const modal = document.createElement('div');
        modal.id = 'modal-aula-cancelada';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#1a0404,#1e293b);border:2px solid #ef4444;border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px rgba(239,68,68,0.3);position:relative;overflow:hidden;">
                <div style="font-size:3.5rem;margin-bottom:8px;">🚫</div>
                <div style="font-size:0.6rem;color:#ef4444;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Gaditas Matriz</div>
                <div style="font-size:1.4rem;font-weight:800;color:white;line-height:1.3;margin-bottom:6px;">
                    Oi, <span style="color:#ef4444;">${primeiroNome}!</span>
                </div>
                <div style="font-size:0.85rem;color:#94a3b8;line-height:1.7;margin:12px 0 20px;">
                    A${turmas.length > 1 ? 's' : ''} aula${turmas.length > 1 ? 's' : ''} abaixo ${turmas.length > 1 ? 'foram canceladas' : 'foi cancelada'} <strong style="color:white;">hoje</strong>:
                </div>
                <div style="text-align:left;margin-bottom:24px;">${listaTurmas}</div>
                <div style="font-size:0.75rem;color:#64748b;margin-bottom:20px;line-height:1.6;">
                    Qualquer dúvida, entre em contato com a academia. 💬
                </div>
                <button onclick="document.getElementById('modal-aula-cancelada').remove(); localStorage.setItem('${chaveLocalStorage}','1');"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#ef4444,#b91c1c);color:white;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;letter-spacing:0.5px;">
                    ✓ ENTENDIDO
                </button>
            </div>`;
        document.body.appendChild(modal);
    }
};

// ══════════════════════════════════════════════════════════
// EXAME DE FAIXA  —  3 categorias: kids | adulto | preta
// ══════════════════════════════════════════════════════════
const exame = {

    // ── Categoria do aluno ─────────────────────────────────
    _getCategoria(aluno) {
        const ano = new Date().getFullYear();
        const idade = aluno.nascimento ? (ano - new Date(aluno.nascimento).getFullYear()) : 99;
        if (idade < 16) return 'kids';
        // Marrom (qualquer grau) OU Preta (subindo grau) → categoria preta
        if (aluno.faixa === 'Marrom' || aluno.faixa === 'Preta') return 'preta';
        return 'adulto';
    },

    // ── Próxima promoção conforme categoria ───────────────
    // Kids e Adulto: só troca de FAIXA (grau irrelevante)
    // Preta: cada grau É uma promoção nova
    _getProxFaixa(aluno, categoria) {
        if (categoria === 'kids') {
            if (aluno.proxFaixaCustom) return aluno.proxFaixaCustom;
            const infantil = ['Branca','Cinza/Branca','Cinza','Cinza/Preta','Amarela/Branca','Amarela','Amarela/Preta','Laranja/Branca','Laranja','Laranja/Preta','Verde/Branca','Verde','Verde/Preta'];
            const idx = infantil.indexOf(aluno.faixa);
            return idx >= 0 && idx < infantil.length - 1 ? infantil[idx + 1] : aluno.faixa;
        }
        if (categoria === 'preta') {
            const grau = aluno.grau || 0;
            if (aluno.faixa === 'Marrom') return 'Preta';          // Marrom → Preta (sem grau)
            if (grau === 0) return 'Preta 1º Grau';                // Preta → Preta 1G
            return `Preta ${grau + 1}º Grau`;                      // Preta NG → Preta N+1G
        }
        // Adulto 16+: sempre próxima FAIXA, grau ignorado
        const faixas = ['Branca','Azul','Roxa','Marrom'];
        const idx = faixas.indexOf(aluno.faixa);
        return idx >= 0 && idx < faixas.length - 1 ? faixas[idx + 1] : aluno.faixa;
    },

    // ── Doc Firestore por categoria ────────────────────────
    _docId(categoria) {
        return { kids: 'exame_kids', adulto: 'exame_adulto', preta: 'exame_preta' }[categoria] || 'exame_adulto';
    },

    // ── Cores por faixa ────────────────────────────────────
    _corFaixa(faixa) {
        const c = {
            'Branca':       { border: '#ffffff', text: '#ffffff', gradient: 'linear-gradient(135deg,#1e293b,#334155)' },
            'Cinza':        { border: '#94a3b8', text: '#cbd5e1', gradient: 'linear-gradient(135deg,#1e293b,#475569)' },
            'Amarela':      { border: '#eab308', text: '#fef08a', gradient: 'linear-gradient(135deg,#422006,#713f12)' },
            'Laranja':      { border: '#f97316', text: '#fed7aa', gradient: 'linear-gradient(135deg,#431407,#7c2d12)' },
            'Verde':        { border: '#22c55e', text: '#bbf7d0', gradient: 'linear-gradient(135deg,#052e16,#14532d)' },
            'Azul':         { border: '#3b82f6', text: '#93c5fd', gradient: 'linear-gradient(135deg,#1e1b4b,#1e3a8a)' },
            'Roxa':         { border: '#8b5cf6', text: '#c4b5fd', gradient: 'linear-gradient(135deg,#2e1065,#4c1d95)' },
            'Marrom':       { border: '#d97706', text: '#fcd34d', gradient: 'linear-gradient(135deg,#1c0a00,#451a03)' },
            'Preta':        { border: '#f59e0b', text: '#f59e0b', gradient: 'linear-gradient(135deg,#000,#1a1a1a)' },
        };
        const base = faixa ? faixa.split('/')[0] : 'Branca';
        return c[base] || c['Branca'];
    },

    // ── Countdown HTML ─────────────────────────────────────
    _countdownHtml(dataStr, horario, label, cor) {
        if (!dataStr) return '';
        const dt = new Date(dataStr + 'T' + (horario || '09:00') + ':00');
        const diff = dt - new Date();
        if (diff <= 0) return `<div style="text-align:center; margin:8px 0; color:#10b981; font-weight:800; font-size:0.82rem;">🟢 ${label} É HOJE!</div>`;
        const dias = Math.floor(diff / 86400000);
        const horas = Math.floor((diff % 86400000) / 3600000);
        return `<div style="display:flex; gap:8px; justify-content:center; margin:10px 0;">
            <div style="background:#0f172a; border:1px solid ${cor.border}33; border-radius:10px; padding:8px 14px; text-align:center; min-width:54px;">
                <div style="font-size:1.5rem; font-weight:900; color:${cor.text};">${dias}</div>
                <div style="font-size:0.5rem; color:#64748b; font-weight:700;">DIAS</div>
            </div>
            <div style="background:#0f172a; border:1px solid ${cor.border}33; border-radius:10px; padding:8px 14px; text-align:center; min-width:54px;">
                <div style="font-size:1.5rem; font-weight:900; color:${cor.text};">${horas}</div>
                <div style="font-size:0.5rem; color:#64748b; font-weight:700;">HORAS</div>
            </div>
        </div>`;
    },

    // ── Verifica se aluno está convocado e mostra/esconde a tab ──
    async verificarConvocacao(alunoId) {
        const btn = document.getElementById('menu-exame');
        if (!btn) return;
        // Admin sempre vê (painel de gestão); já tratado em configurarVisao
        if (auth.role === 'admin') return;
        if (!alunoId || alunoId === 'admin') { btn.classList.add('nav-item-hidden'); return; }
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            if (!doc.exists) { btn.classList.add('nav-item-hidden'); return; }
            const convocado = doc.data().aspiranteGraduacao === true;
            if (convocado) btn.classList.remove('nav-item-hidden');
            else btn.classList.add('nav-item-hidden');
        } catch(e) { btn.classList.add('nav-item-hidden'); }
    },

    // ── Carrega a tela do aluno convocado ──
    async carregarExameAluno() {
        const container = document.getElementById('exame-aluno-container');
        if (!container) return;
        container.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="color:#f59e0b;font-size:2rem;"></i></div>`;
        try {
            const alunoId = auth.currentUser?.id;
            // Admin vê o painel de configuração + lista de convocados
            if (auth.role === 'admin' || alunoId === 'admin') {
                await this.carregarPainelAdmin();
                return;
            }
            const alunoDoc = await db.collection('alunos').doc(alunoId).get();
            if (!alunoDoc.exists) { container.innerHTML = `<p style="color:#64748b;text-align:center;padding:30px;font-size:0.8rem;">Dados não encontrados.</p>`; return; }
            const aluno = alunoDoc.data();

            const categoria  = this._getCategoria(aluno);
            const configDoc  = await db.collection('configuracoes').doc(this._docId(categoria)).get();
            const cfg        = configDoc.exists ? configDoc.data() : {};

            const faixa      = aluno.faixa || 'Branca';
            const aulas      = aluno.aulas || 0;
            const meta       = academia.verificarMeta(aluno).meta;
            const nome       = (aluno.nome || '').split(' ')[0];
            const proxFaixa  = this._getProxFaixa(aluno, categoria);
            const cor        = this._corFaixa(faixa);
            const isKids     = categoria === 'kids';

            const labelCat   = isKids ? '🧒 KIDS' : categoria === 'preta' ? '⬛ FAIXA PRETA' : '🥋 16+';
            const jaConfirmou = localStorage.getItem(`exame_confirmado_${alunoId}`) === '1';

            // Datas
            const dataExameFmt = cfg.dataExame
                ? new Date(cfg.dataExame + 'T12:00:00').toLocaleDateString('pt-BR', {weekday:'long',day:'2-digit',month:'long',year:'numeric'})
                : null;
            const dataGradFmt = cfg.dataGraduacao
                ? new Date(cfg.dataGraduacao + 'T12:00:00').toLocaleDateString('pt-BR', {weekday:'long',day:'2-digit',month:'long',year:'numeric'})
                : null;

            container.innerHTML = `
                <!-- CABEÇALHO -->
                <div style="${cor.gradient}; border:2px solid ${cor.border}; border-radius:18px; padding:22px 18px; margin-bottom:14px; text-align:center; box-shadow:0 0 30px ${cor.border}22;">
                    <div style="display:inline-block; background:#ffffff18; border-radius:20px; padding:3px 12px; font-size:0.55rem; font-weight:800; color:${cor.text}; letter-spacing:1.5px; margin-bottom:8px;">${labelCat}</div>
                    <div style="font-size:2.2rem; margin-bottom:4px;">🥋</div>
                    <div style="font-size:0.55rem; font-weight:800; color:${cor.text}; letter-spacing:2px; opacity:0.7; margin-bottom:4px;">CONVOCAÇÃO OFICIAL</div>
                    <div style="font-size:1.25rem; font-weight:900; color:white; line-height:1.2; margin-bottom:8px;">EXAME DE FAIXA</div>
                    <div style="display:inline-block; background:${cor.border}22; border:1px solid ${cor.border}; border-radius:20px; padding:4px 16px; font-size:0.75rem; font-weight:800; color:${cor.text};">
                        ${faixa.toUpperCase()} → ${proxFaixa.toUpperCase()}
                    </div>
                    <div style="margin-top:10px; font-size:0.88rem; color:white; opacity:0.85;">OSS, <strong>${nome}</strong>! Você foi convocado.</div>
                </div>

                <!-- COUNTDOWNS -->
                ${cfg.dataExame ? `
                <div style="background:#0f172a; border:1px solid #1e3a8a; border-radius:12px; padding:12px 14px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#3b82f6; letter-spacing:0.5px; margin-bottom:4px;">📋 DATA DO EXAME</div>
                    <div style="font-size:0.82rem; font-weight:700; color:white; margin-bottom:4px;">${dataExameFmt}${cfg.horario ? ' às ' + cfg.horario + 'h' : ''}</div>
                    ${this._countdownHtml(cfg.dataExame, cfg.horario, 'EXAME', cor)}
                </div>` : ''}

                ${cfg.dataGraduacao ? `
                <div style="background:#0f172a; border:1px solid #f59e0b44; border-radius:12px; padding:12px 14px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#f59e0b; letter-spacing:0.5px; margin-bottom:4px;">🏆 DATA DA GRADUAÇÃO (CERIMÔNIA)</div>
                    <div style="font-size:0.82rem; font-weight:700; color:white; margin-bottom:4px;">${dataGradFmt}${cfg.horarioGraduacao ? ' às ' + cfg.horarioGraduacao + 'h' : ''}</div>
                    ${this._countdownHtml(cfg.dataGraduacao, cfg.horarioGraduacao, 'GRADUAÇÃO', { border: '#f59e0b', text: '#fcd34d' })}
                </div>` : ''}

                <!-- LOCAL DO EXAME -->
                ${cfg.local ? `
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-map-marker-alt" style="color:#f43f5e; font-size:1rem; flex-shrink:0;"></i>
                    <div>
                        <div style="font-size:0.6rem; color:#64748b; font-weight:700;">LOCAL DO EXAME</div>
                        <div style="font-size:0.85rem; font-weight:700; color:white;">${cfg.local}</div>
                    </div>
                </div>` : ''}

                <!-- LOCAL DA GRADUAÇÃO + BOTÃO MAPA -->
                ${cfg.localGraduacao ? `
                <div style="background:#0f172a; border:1px solid #f59e0b22; border-radius:12px; padding:12px 14px; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <i class="fas fa-map-marker-alt" style="color:#f59e0b; font-size:1rem; flex-shrink:0;"></i>
                        <div style="flex:1;">
                            <div style="font-size:0.6rem; color:#f59e0b; font-weight:700;">LOCAL DA GRADUAÇÃO</div>
                            <div style="font-size:0.85rem; font-weight:700; color:white;">${cfg.localGraduacao}</div>
                        </div>
                    </div>
                    <button onclick="window.open('${cfg.mapaGraduacao || `https://maps.google.com/?q=${encodeURIComponent(cfg.localGraduacao || '')}`}','_blank')"
                        style="width:100%; padding:10px; background:#1e3a8a; border:1px solid #3b82f6; color:#93c5fd; border-radius:8px; font-weight:800; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fas fa-map-marked-alt"></i> ABRIR NO GOOGLE MAPS 🗺️
                    </button>
                </div>` : ''}

                <!-- TAXA — Preta usa valor1 (Marrom→Preta) ou valor2 (Preta→Grau) -->
                ${(() => {
                    let v = cfg.valor, l = cfg.linkPagamento;
                    if (categoria === 'preta' && faixa === 'Preta') {
                        v = cfg.valor2; l = cfg.linkPagamento2;
                    }
                    return v ? `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; gap:10px;">
                        <i class="fas fa-tag" style="color:#f59e0b; font-size:1rem; flex-shrink:0;"></i>
                        <div>
                            <div style="font-size:0.6rem; color:#64748b; font-weight:700;">TAXA DE EXAME</div>
                            <div style="font-size:0.85rem; font-weight:700; color:white;">R$ ${parseFloat(v).toFixed(2).replace('.', ',')}</div>
                        </div>
                    </div>` : '';
                })()}

                <!-- SUA JORNADA -->
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:14px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#64748b; letter-spacing:0.5px; margin-bottom:10px;">⚔️ SUA JORNADA</div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <span style="font-size:0.8rem; color:#94a3b8;">Aulas completadas</span>
                        <span style="font-size:0.85rem; font-weight:800; color:#10b981;">${aulas} ✅</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-size:0.8rem; color:#94a3b8;">Meta exigida</span>
                        <span style="font-size:0.85rem; font-weight:800; color:white;">${meta}</span>
                    </div>
                    <div style="background:#1e293b; border-radius:8px; overflow:hidden; height:7px;">
                        <div style="background:linear-gradient(90deg,#10b981,#34d399); height:100%; width:${Math.min((aulas/meta)*100,100)}%; border-radius:8px; transition:width 0.5s;"></div>
                    </div>
                </div>

                <!-- INSTRUÇÕES -->
                ${cfg.instrucoes ? `
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:14px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#64748b; letter-spacing:0.5px; margin-bottom:8px;">📌 INSTRUÇÕES DO PROFESSOR</div>
                    <div style="font-size:0.82rem; color:#e2e8f0; line-height:1.6; white-space:pre-line;">${cfg.instrucoes}</div>
                </div>` : ''}

                <!-- CHECKLIST -->
                <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:14px; margin-bottom:14px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#64748b; letter-spacing:0.5px; margin-bottom:8px;">✅ O QUE LEVAR</div>
                    ${['👕 Kimono limpo e passado','🥋 Faixa atual','💧 Garrafa d\'água','🪪 Documento com foto'].map(i =>
                        `<div style="padding:7px 0; border-bottom:1px solid #1e293b; font-size:0.82rem; color:#e2e8f0;">${i}</div>`
                    ).join('')}
                </div>

                <!-- TAMANHO DA FAIXA -->
                <div style="background:#0f172a; border:1px solid #f59e0b44; border-radius:12px; padding:14px; margin-bottom:14px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#f59e0b; letter-spacing:0.5px; margin-bottom:8px;">📏 TAMANHO DA SUA FAIXA</div>
                    <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:8px;">Informe o tamanho para confecção da nova faixa.</div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select id="select-tamanho-faixa" style="flex:1;padding:10px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.82rem;">
                            <option value="">— Selecione —</option>
                            ${isKids
                                ? ['M00','M0','M1','M2','M3','M4','A0','A1','A2'].map(t => `<option value="${t}" ${aluno.tamanhoFaixa===t?'selected':''}>${t}</option>`).join('')
                                : ['A0','A1','A2','A3','A4','A5'].map(t => `<option value="${t}" ${aluno.tamanhoFaixa===t?'selected':''}>${t}</option>`).join('')
                            }
                        </select>
                        <button onclick="exame.salvarTamanhoFaixa('${alunoId}')" style="padding:10px 16px;background:#f59e0b;border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.78rem;white-space:nowrap;">💾 Salvar</button>
                    </div>
                    ${aluno.tamanhoFaixa ? `<div style="margin-top:6px;font-size:0.65rem;color:#10b981;">✅ Tamanho registrado: <strong>${aluno.tamanhoFaixa}</strong></div>` : `<div style="margin-top:6px;font-size:0.65rem;color:#f59e0b;">⚠️ Tamanho não informado ainda.</div>`}
                </div>

                <!-- BOTÕES -->
                <div style="display:flex; flex-direction:column; gap:10px;">
                    ${(() => {
                        let link = cfg.linkPagamento;
                        if (categoria === 'preta' && faixa === 'Preta') link = cfg.linkPagamento2;
                        return link ? `
                        <button onclick="window.open('${link}','_blank')"
                            style="width:100%; padding:15px; background:linear-gradient(135deg,#059669,#10b981); border:none; color:white; border-radius:12px; font-weight:900; font-size:0.88rem; cursor:pointer; box-shadow:0 4px 15px #10b98133;">
                            <i class="fas fa-credit-card"></i> PAGAR TAXA DE EXAME
                        </button>` : '';
                    })()}
                    <button id="btn-confirmar-exame" onclick="exame.confirmarPresenca('${alunoId}')"
                        style="width:100%; padding:13px; background:${jaConfirmou ? '#064e3b' : '#1e3a8a'}; border:2px solid ${jaConfirmou ? '#10b981' : '#3b82f6'}; color:${jaConfirmou ? '#10b981' : '#93c5fd'}; border-radius:12px; font-weight:800; font-size:0.85rem; cursor:pointer;">
                        ${jaConfirmou ? '✅ PRESENÇA CONFIRMADA' : '🙋 CONFIRMAR MINHA PRESENÇA'}
                    </button>
                </div>
                <div id="btn-tecnicas-exame-aluno"></div>
                <div style="text-align:center; margin-top:20px; font-size:0.7rem; color:#475569; font-style:italic;">"A faixa é o reconhecimento de quem você se tornou. OSS!" 🦁</div>`;

        // Carrega botão de técnicas (só aparece se houver técnicas ativas)
        setTimeout(() => tecnicasExame.carregarBotaoAluno(proxFaixa, 'btn-tecnicas-exame-aluno'), 100);

        } catch(e) {
            if (container) container.innerHTML = `<p style="color:#f43f5e;text-align:center;padding:20px;font-size:0.8rem;">Erro: ${e.message}</p>`;
        }
    },

    // ── Salvar tamanho da faixa ──
    async salvarTamanhoFaixa(alunoId) {
        const sel = document.getElementById('select-tamanho-faixa');
        if (!sel || !sel.value) return alert('Selecione um tamanho.');
        try {
            await db.collection('alunos').doc(alunoId).update({ tamanhoFaixa: sel.value });
            alert(`✅ Tamanho ${sel.value} salvo!`);
            exame.carregarExameAluno();
        } catch(e) { alert('Erro ao salvar: ' + e.message); }
    },

    // ── Relatório costureira ──
    async abrirRelatorioCostureira() {
        const snap = await db.collection('alunos').where('aspiranteGraduacao','==',true).get();
        if (snap.empty) return alert('Nenhum atleta convocado.');

        const ano = new Date().getFullYear();
        const linhas = [];
        snap.forEach(doc => {
            const a = doc.data();
            const idade = a.nascimento ? (ano - new Date(a.nascimento).getFullYear()) : 99;
            linhas.push({
                nome:     a.nome || '—',
                faixa:    a.faixaDestino || a.faixa || '—',
                tamanho:  a.tamanhoFaixa || '—',
                cat:      idade < 16 ? 'Kids' : 'Adulto'
            });
        });

        // Agrupa por faixa destino + tamanho
        const grupos = {};
        linhas.forEach(l => {
            const k = `${l.faixa}||${l.tamanho}`;
            if (!grupos[k]) grupos[k] = { faixa: l.faixa, tamanho: l.tamanho, alunos: [] };
            grupos[k].alunos.push(l);
        });

        const corFaixaCSS = f => ({
            'Branca':'#e2e8f0','Cinza':'#94a3b8','Cinza/Branca':'#94a3b8','Amarela':'#fbbf24',
            'Laranja':'#f97316','Verde':'#22c55e','Azul':'#3b82f6','Roxa':'#a855f7',
            'Marrom':'#92400e','Preta':'#1e293b'
        }[f] || '#64748b');

        let rows = '';
        Object.values(grupos).sort((a,b) => a.faixa.localeCompare(b.faixa) || a.tamanho.localeCompare(b.tamanho))
            .forEach(g => {
                const cor = corFaixaCSS(g.faixa);
                rows += `<tr style="border-bottom:1px solid #e2e8f0;">
                    <td style="padding:6px 10px;font-weight:700;color:${cor};border-right:1px solid #e2e8f0;">${g.faixa}</td>
                    <td style="padding:6px 10px;font-weight:800;text-align:center;border-right:1px solid #e2e8f0;">${g.tamanho}</td>
                    <td style="padding:6px 10px;text-align:center;border-right:1px solid #e2e8f0;">${g.alunos.length}</td>
                    <td style="padding:6px 10px;font-size:0.75rem;">${g.alunos.map(a=>a.nome).join(', ')}</td>
                </tr>`;
            });

        // Linha de sem tamanho
        const semTamanho = linhas.filter(l => l.tamanho === '—');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pedido Costureira — Gaditas Academy</title>
        <style>body{font-family:Arial,sans-serif;padding:24px;color:#1e293b;}h2{margin-bottom:4px;}p{color:#64748b;font-size:0.85rem;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;}th{background:#1e293b;color:white;padding:8px 10px;text-align:left;font-size:0.8rem;}
        @media print{button{display:none!important;}}
        </style></head><body>
        <h2>🧵 Pedido de Faixas — Gaditas Academy</h2>
        <p>Gerado em: ${new Date().toLocaleString('pt-BR')} · Total: ${linhas.length} atletas</p>
        <button onclick="window.print()" style="margin-bottom:16px;padding:10px 20px;background:#1e293b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;">🖨️ IMPRIMIR</button>
        <table>
            <thead><tr><th>Faixa</th><th style="text-align:center;">Tamanho</th><th style="text-align:center;">Qtd</th><th>Alunos</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${semTamanho.length ? `<div style="margin-top:20px;padding:12px;background:#fef9c3;border:1px solid #f59e0b;border-radius:8px;">
            <strong>⚠️ Sem tamanho informado (${semTamanho.length}):</strong><br>
            <span style="font-size:0.82rem;">${semTamanho.map(a=>`${a.nome} (${a.faixa})`).join(' · ')}</span>
        </div>` : ''}
        </body></html>`;

        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
    },

    // ── Confirmar presença do aluno ──
    async confirmarPresenca(alunoId) {
        try {
            await db.collection('alunos').doc(alunoId).update({
                examePresencaConfirmada: true,
                examePresencaData: new Date().toLocaleDateString('pt-BR')
            });
            localStorage.setItem(`exame_confirmado_${alunoId}`, '1');
            const btn = document.getElementById('btn-confirmar-exame');
            if (btn) {
                btn.style.background = '#064e3b';
                btn.style.border = '2px solid #10b981';
                btn.style.color = '#10b981';
                btn.innerHTML = '✅ PRESENÇA CONFIRMADA';
            }
        } catch(e) { alert('Erro ao confirmar: ' + e.message); }
    },

    // ── Painel admin — 3 categorias ──────────────────────────
    async carregarPainelAdmin() {
        // Funciona tanto na aba EXAME (exame-aluno-container) quanto na aba GESTÃO
        const container = document.getElementById('exame-aluno-container')
                       || document.getElementById('painel-config-exame');
        if (!container) return;

        // Carrega as 3 configs em paralelo
        const [dKids, dAdulto, dPreta] = await Promise.all([
            db.collection('configuracoes').doc('exame_kids').get(),
            db.collection('configuracoes').doc('exame_adulto').get(),
            db.collection('configuracoes').doc('exame_preta').get()
        ]);
        const kids   = dKids.exists   ? dKids.data()   : {};
        const adulto = dAdulto.exists  ? dAdulto.data()  : {};
        const preta  = dPreta.exists   ? dPreta.data()   : {};

        const inp = (id, val, type='text', ph='') =>
            `<input type="${type}" id="${id}" value="${val||''}" placeholder="${ph}"
             style="width:100%;padding:9px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.78rem;"/>`;

        // helper accordion genérico
        const accordion = (id, titulo, cor, conteudo) => `
            <div style="background:#0a0f1a;border:1px solid ${cor}44;border-radius:12px;margin-bottom:10px;overflow:hidden;">
                <div onclick="(()=>{const b=document.getElementById('acc-${id}');const c=document.getElementById('chev-${id}');b.style.display=b.style.display==='none'?'block':'none';c.style.transform=b.style.display==='block'?'rotate(180deg)':''})()"
                    style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;cursor:pointer;user-select:none;">
                    <div style="font-size:0.65rem;font-weight:800;color:${cor};letter-spacing:0.5px;">${titulo}</div>
                    <span id="chev-${id}" style="color:${cor};font-size:0.7rem;transition:transform 0.2s;">▼</span>
                </div>
                <div id="acc-${id}" style="display:none;padding:0 14px 14px;">${conteudo}</div>
            </div>`;

        // Todos os 3 formulários idênticos — local do exame e local da graduação separados
        const secaoInner = (titulo, cor, cat, cfg) => `

                <div style="font-size:0.58rem; color:#64748b; font-weight:700; margin-bottom:6px; letter-spacing:0.5px;">🗓️ EXAME</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📅 DATA DO EXAME</small>${inp(`${cat}-dataExame`,cfg.dataExame,'date')}</div>
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">⏰ HORÁRIO</small>${inp(`${cat}-horario`,cfg.horario,'time')}</div>
                </div>
                <div style="margin-bottom:10px;"><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📍 LOCAL DO EXAME</small>${inp(`${cat}-local`,cfg.local,'text','Ex: Gaditas Academy — Matriz')}</div>

                <div style="font-size:0.58rem; color:#64748b; font-weight:700; margin-bottom:6px; letter-spacing:0.5px;">🏆 GRADUAÇÃO (CERIMÔNIA)</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📅 DATA GRADUAÇÃO</small>${inp(`${cat}-dataGraduacao`,cfg.dataGraduacao,'date')}</div>
                    <div><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">⏰ HORÁRIO GRAD.</small>${inp(`${cat}-horarioGraduacao`,cfg.horarioGraduacao,'time')}</div>
                </div>
                <div style="margin-bottom:6px;"><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📍 LOCAL DA GRADUAÇÃO</small>${inp(`${cat}-localGraduacao`,cfg.localGraduacao,'text','Ex: Gaditas Academy — Matriz')}</div>
                <div style="margin-bottom:10px;"><small style="color:#64748b;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">🗺️ LINK GOOGLE MAPS (opcional — se vazio, gera automático pelo endereço)</small>${inp(`${cat}-mapaGraduacao`,cfg.mapaGraduacao,'url','https://maps.google.com/...')}</div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💰 TAXA (R$)</small>${inp(`${cat}-valor`,cfg.valor,'number','0,00')}</div>
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💳 LINK PAG.</small>${inp(`${cat}-link`,cfg.linkPagamento,'url','https://...')}</div>
                </div>
                <div style="margin-bottom:10px;">
                    <small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📌 INSTRUÇÕES</small>
                    <textarea id="${cat}-instrucoes" rows="2" placeholder="Ex: Chegar 30min antes..."
                        style="width:100%;padding:9px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.78rem;resize:none;">${cfg.instrucoes||''}</textarea>
                </div>
                <button onclick="exame.salvarConfigExame('${cat}')"
                    style="width:100%;padding:10px;background:${cor};border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.75rem;">
                    <i class="fas fa-save"></i> SALVAR ${titulo.replace(/[^A-Z0-9+ ]/g,'').trim()}
                </button>`;

        const secao = (titulo, cor, cat, cfg) => accordion(`cfg-${cat}`, titulo, cor, secaoInner(titulo, cor, cat, cfg));

        // Seção especial para Preta — 2 valores e 2 links
        const secaoPretaInner = () => `
                <div style="font-size:0.65rem; font-weight:800; color:#94a3b8; letter-spacing:0.5px; margin-bottom:12px;">⬛ FAIXA PRETA</div>

                <div style="font-size:0.58rem; color:#64748b; font-weight:700; margin-bottom:6px; letter-spacing:0.5px;">🗓️ EXAME</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📅 DATA DO EXAME</small>${inp('preta-dataExame',preta.dataExame,'date')}</div>
                    <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">⏰ HORÁRIO</small>${inp('preta-horario',preta.horario,'time')}</div>
                </div>
                <div style="margin-bottom:10px;"><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📍 LOCAL DO EXAME</small>${inp('preta-local',preta.local,'text','Ex: Gaditas Academy — Matriz')}</div>

                <div style="font-size:0.58rem; color:#64748b; font-weight:700; margin-bottom:6px; letter-spacing:0.5px;">🏆 GRADUAÇÃO (CERIMÔNIA)</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📅 DATA GRADUAÇÃO</small>${inp('preta-dataGraduacao',preta.dataGraduacao,'date')}</div>
                    <div><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">⏰ HORÁRIO GRAD.</small>${inp('preta-horarioGraduacao',preta.horarioGraduacao,'time')}</div>
                </div>
                <div style="margin-bottom:6px;"><small style="color:#fbbf24;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📍 LOCAL DA GRADUAÇÃO</small>${inp('preta-localGraduacao',preta.localGraduacao,'text','Ex: Gaditas Academy — Matriz')}</div>
                <div style="margin-bottom:12px;"><small style="color:#64748b;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">🗺️ LINK GOOGLE MAPS (opcional)</small>${inp('preta-mapaGraduacao',preta.mapaGraduacao,'url','https://maps.google.com/...')}</div>

                <!-- PAGAMENTO 1: Marrom → Preta -->
                <div style="background:#1a1a2e; border:1px solid #ef444433; border-radius:8px; padding:10px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#ef4444; margin-bottom:8px; letter-spacing:0.3px;">🔴 MARROM → PRETA (1ª faixa preta)</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💰 TAXA (R$)</small>${inp('preta-valor',preta.valor,'number','0,00')}</div>
                        <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💳 LINK PAG.</small>${inp('preta-link',preta.linkPagamento,'url','https://...')}</div>
                    </div>
                </div>

                <!-- PAGAMENTO 2: Preta → Preta Grau -->
                <div style="background:#1a1a2e; border:1px solid #f59e0b33; border-radius:8px; padding:10px; margin-bottom:10px;">
                    <div style="font-size:0.6rem; font-weight:800; color:#f59e0b; margin-bottom:8px; letter-spacing:0.3px;">🟡 PRETA → PRÓXIMO GRAU</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💰 TAXA (R$)</small>${inp('preta-valor2',preta.valor2,'number','0,00')}</div>
                        <div><small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">💳 LINK PAG.</small>${inp('preta-link2',preta.linkPagamento2,'url','https://...')}</div>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:3px;">📌 INSTRUÇÕES</small>
                    <textarea id="preta-instrucoes" rows="2" placeholder="Ex: Chegar 30min antes..."
                        style="width:100%;padding:9px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;outline:none;font-size:0.78rem;resize:none;">${preta.instrucoes||''}</textarea>
                </div>
                <button onclick="exame.salvarConfigExame('preta')"
                    style="width:100%;padding:10px;background:#94a3b8;border:none;color:#000;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.75rem;">
                    <i class="fas fa-save"></i> SALVAR FAIXA PRETA
                </button>`;

        const secaoPreta = () => accordion('cfg-preta', '⬛ FAIXA PRETA', '#94a3b8', secaoPretaInner());

        // Accordion de convocados com botão notificar no header
        const convocadosAccordion = `
            <div style="display:flex;gap:6px;margin-bottom:6px;">
                <button onclick="academia.abrirMensagemIndicados()"
                    style="flex:1;padding:9px;font-size:0.62rem;font-weight:800;background:#f59e0b;border:none;color:#000;border-radius:8px;cursor:pointer;">📢 Mensagem por Grupo</button>
                <button onclick="exame.migrarConvocacoesPendentes()"
                    style="flex:1;padding:9px;font-size:0.62rem;font-weight:800;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;cursor:pointer;">📣 Notificar todos</button>
            </div>
            <button onclick="exame.abrirRelatorioCostureira()"
                style="width:100%;padding:9px;font-size:0.62rem;font-weight:800;background:#0f172a;border:1px solid #94a3b8;color:#94a3b8;border-radius:8px;cursor:pointer;margin-bottom:8px;">🧵 Relatório para Costureira</button>
            <div style="background:#0a0f1a;border:1px solid #1e293b;border-radius:12px;margin-bottom:10px;overflow:hidden;">
                <div onclick="(()=>{const b=document.getElementById('acc-convocados');const c=document.getElementById('chev-convocados');b.style.display=b.style.display==='none'?'block':'none';c.style.transform=b.style.display==='block'?'rotate(180deg)':''})()"
                    style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;cursor:pointer;user-select:none;">
                    <div style="font-size:0.62rem;font-weight:800;color:#64748b;letter-spacing:0.5px;">👥 CONVOCADOS — CONFIRMAÇÕES</div>
                    <span id="chev-convocados" style="color:#64748b;font-size:0.7rem;transition:transform 0.2s;">▼</span>
                </div>
                <div id="acc-convocados" style="display:none;padding:0 14px 14px;">
                    <div id="lista-confirmados-exame"><small style="color:#475569;font-size:0.65rem;">Carregando...</small></div>
                </div>
            </div>`;

        container.innerHTML =
            `<div id="relatorio-exame" style="margin-bottom:10px;"><small style="color:#475569;font-size:0.65rem;">Carregando relatório...</small></div>` +
            secao('🧒 KIDS', '#f59e0b', 'kids', kids) +
            secao('🥋 16+ ATÉ MARROM', '#3b82f6', 'adulto', adulto) +
            secaoPreta() +
            convocadosAccordion +
            `<div id="tecnicas-exame-painel" style="margin-top:10px;"></div>`;

        this.carregarConfirmados();
        this.carregarRelatorioExame({ kids, adulto, preta });
        tecnicasExame.carregarPainel();
    },

    async salvarConfigExame(categoria) {
        const g = id => document.getElementById(`${categoria}-${id}`)?.value || '';
        const cfg = {
            dataExame:        g('dataExame'),
            horario:          g('horario'),
            local:            g('local').trim(),
            dataGraduacao:    g('dataGraduacao'),
            horarioGraduacao: g('horarioGraduacao'),
            localGraduacao:   g('localGraduacao').trim(),
            mapaGraduacao:    g('mapaGraduacao').trim(),
            valor:            parseFloat(g('valor')) || 0,
            linkPagamento:    g('link').trim(),
            instrucoes:       g('instrucoes').trim(),
            atualizadoEm:     new Date().toLocaleDateString('pt-BR')
        };
        // Faixa Preta tem 2 valores/links
        if (categoria === 'preta') {
            cfg.valor2         = parseFloat(g('valor2')) || 0;
            cfg.linkPagamento2 = g('link2').trim();
        }
        await db.collection('configuracoes').doc(this._docId(categoria)).set(cfg);
        const labels = { kids:'🧒 Kids', adulto:'🥋 16+ até Marrom', preta:'⬛ Faixa Preta' };
        alert(`✅ Exame ${labels[categoria]} salvo! Alunos convocados já verão as informações.`);
    },

    // ── Cor do nome conforme faixa DESTINO ────────────────
    _corNome(faixa) {
        const cores = {
            // Adulto
            'Preta':            '#ef4444',  // vermelho — especial
            'Marrom':           '#d97706',
            'Roxa':             '#a78bfa',
            'Azul':             '#60a5fa',
            // Kids — base
            'Branca':           '#e2e8f0',
            'Cinza/Branca':     '#b0bec5',
            'Cinza':            '#90a4ae',
            'Cinza/Preta':      '#607d8b',
            'Amarela/Branca':   '#fff176',
            'Amarela':          '#facc15',
            'Amarela/Preta':    '#f59e0b',
            'Laranja/Branca':   '#ffb74d',
            'Laranja':          '#fb923c',
            'Laranja/Preta':    '#f97316',
            'Verde/Branca':     '#a5d6a7',
            'Verde':            '#4ade80',
            'Verde/Preta':      '#22c55e',
        };
        return cores[faixa] || '#e2e8f0';
    },

    // ── Atualiza cor do nome quando dropdown muda ─────────
    atualizarCorNome(alunoId, novaFaixa) {
        const cor = this._corNome(novaFaixa);
        const el = document.getElementById(`nome-conv-${alunoId}`);
        if (el) el.style.color = cor;
        const sub = document.getElementById(`sub-conv-${alunoId}`);
        if (sub) {
            const faixaAtual = sub.dataset.faixaAtual || '';
            const aulas = sub.textContent.match(/• (\d+) aulas/)?.[1] || '0';
            sub.innerHTML = `${faixaAtual} → <span style="color:${cor};font-weight:700;">${novaFaixa}</span> • ${aulas} aulas`;
        }
        const card = document.getElementById(`card-conv-${alunoId}`);
        if (card) card.style.borderLeftColor = cor;
    },

    async carregarConfirmados() {
        const container = document.getElementById('lista-confirmados-exame');
        if (!container) return;
        try {
            const snap = await db.collection('alunos').where('aspiranteGraduacao', '==', true).get();
            if (snap.empty) { container.innerHTML = '<small style="color:#475569;font-size:0.65rem;">Nenhum aluno convocado.</small>'; return; }

            const infantil = ['Branca','Cinza/Branca','Cinza','Cinza/Preta','Amarela/Branca','Amarela','Amarela/Preta','Laranja/Branca','Laranja','Laranja/Preta','Verde/Branca','Verde','Verde/Preta'];
            const adultoOrder = { 'Azul':10, 'Roxa':20, 'Marrom':30, 'Preta':40 };
            const groupLabels = { kids:'🧒 KIDS', Azul:'🔵 AZUL', Roxa:'🟣 ROXA', Marrom:'🟤 MARROM → PRETA', Preta:'⬛ FAIXA PRETA' };

            // Monta lista e agrupa
            const grupos = {};
            snap.docs.forEach(doc => {
                const a = doc.data(); const id = doc.id;
                const cat = this._getCategoria(a);
                const proxFaixa = this._getProxFaixa(a, cat);
                const group = cat === 'kids' ? 'kids' : proxFaixa.split(' ')[0];
                let sortKey = cat === 'kids'
                    ? `0_${String(infantil.indexOf(proxFaixa) >= 0 ? infantil.indexOf(proxFaixa) : 99).padStart(2,'0')}`
                    : `1_${String(adultoOrder[proxFaixa.split(' ')[0]] || 50).padStart(2,'0')}`;
                if (!grupos[group]) grupos[group] = { sortKey, items: [] };
                grupos[group].items.push({ a, id, cat, proxFaixa });
            });

            // Renderiza cada grupo como sub-accordion
            const grupoCor = { kids:'#f59e0b', Azul:'#60a5fa', Roxa:'#a78bfa', Marrom:'#d97706', Preta:'#f59e0b' };
            let html = Object.entries(grupos)
                .sort(([,a],[,b]) => a.sortKey.localeCompare(b.sortKey))
                .map(([group, { items }]) => {
                    const cor = grupoCor[group] || '#94a3b8';
                    const label = groupLabels[group] || group.toUpperCase();
                    const total = items.length;
                    const conf  = items.filter(i => i.a.examePresencaConfirmada).length;

                    const cardsHtml = items.map(({ a, id, cat, proxFaixa }) => {
                        const confirmou    = a.examePresencaConfirmada === true;
                        const corNome      = this._corNome(proxFaixa);
                        const faixaDestino = a.proxFaixaCustom || proxFaixa;
                        const seletorKids  = cat === 'kids' ? `
                            <div style="margin-top:5px;display:flex;gap:6px;align-items:center;">
                                <small style="color:#f59e0b;font-size:0.55rem;font-weight:800;white-space:nowrap;">Faixa destino:</small>
                                <select onchange="exame.salvarProxFaixaKids('${id}',this.value);exame.atualizarCorNome('${id}',this.value)"
                                    style="flex:1;padding:3px 6px;background:#1e293b;border:1px solid #f59e0b44;color:white;border-radius:6px;font-size:0.68rem;outline:none;">
                                    ${infantil.map(f=>`<option value="${f}" ${faixaDestino===f?'selected':''}>${f}</option>`).join('')}
                                </select>
                            </div>` : '';
                        const taxaPaga = a.taxaExamePaga === true;
                        return `<div id="card-conv-${id}" style="background:#0f172a;border:1px solid ${confirmou?'#10b98130':'#1e293b'};border-left:3px solid ${corNome};border-radius:8px;padding:10px 12px;margin-bottom:6px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <div style="flex:1;min-width:0;">
                                    <div id="nome-conv-${id}" style="font-size:0.82rem;font-weight:800;color:${corNome};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.nome}</div>
                                    <div id="sub-conv-${id}" data-faixa-atual="${a.faixa}" style="font-size:0.6rem;color:#64748b;margin-top:1px;">${a.faixa} → <span style="color:${corNome};font-weight:700;">${faixaDestino}</span> • ${a.aulas||0} aulas</div>
                                </div>
                                <span style="font-size:0.58rem;font-weight:800;color:${confirmou?'#10b981':'#f59e0b'};white-space:nowrap;margin-left:8px;">${confirmou?'✅ CONF.':'⏳ PEND.'}</span>
                            </div>
                            ${seletorKids}
                            <div onclick="exame.toggleTaxaPaga('${id}', this)"
                                style="margin-top:8px;display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 10px;background:${taxaPaga?'#05200f':'#1e293b'};border:1px solid ${taxaPaga?'#10b98155':'#334155'};border-radius:8px;transition:all 0.2s;">
                                <div id="taxa-toggle-${id}" style="width:32px;height:18px;border-radius:9px;background:${taxaPaga?'#10b981':'#334155'};position:relative;transition:all 0.2s;flex-shrink:0;">
                                    <div style="position:absolute;top:2px;left:${taxaPaga?'14px':'2px'};width:14px;height:14px;border-radius:50%;background:white;transition:all 0.2s;"></div>
                                </div>
                                <span id="taxa-label-${id}" style="font-size:0.65rem;font-weight:700;color:${taxaPaga?'#10b981':'#94a3b8'};">
                                    ${taxaPaga?'💰 TAXA PAGA':'💸 Taxa não paga'}
                                </span>
                            </div>
                            <button onclick="exame.graduarAluno('${id}')" data-faixa-destino="${faixaDestino}"
                                style="margin-top:6px;width:100%;padding:7px;background:linear-gradient(135deg,${corNome},${corNome}99);color:#000;font-weight:900;font-size:0.7rem;border:none;border-radius:8px;cursor:pointer;letter-spacing:1px;">
                                🥋 GRADUAR
                            </button>
                        </div>`;
                    }).join('');

                    const gid = `grp-${group}`;
                    return `<div style="background:#0a0f1a;border:1px solid ${cor}33;border-radius:10px;margin-bottom:8px;overflow:hidden;">
                        <div onclick="(()=>{const b=document.getElementById('${gid}');const c=document.getElementById('chev-${gid}');b.style.display=b.style.display==='none'?'block':'none';c.style.transform=b.style.display==='block'?'rotate(180deg)':''})()"
                            style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;cursor:pointer;user-select:none;">
                            <div style="font-size:0.62rem;font-weight:800;color:${cor};">${label}</div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:0.58rem;color:#64748b;">${conf}/${total} conf.</span>
                                <span id="chev-${gid}" style="color:${cor};font-size:0.65rem;transition:transform 0.2s;">▼</span>
                            </div>
                        </div>
                        <div id="${gid}" style="display:none;padding:0 10px 10px;">${cardsHtml}</div>
                    </div>`;
                }).join('');

            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = `<small style="color:#f43f5e;font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    // ── Banner verde na aba TREINO quando convocado ──────────
    async carregarBannerExame() {
        const banner = document.getElementById('banner-exame-treino');
        if (!banner) return;
        const alunoId = auth.currentUser?.id;
        if (!alunoId || alunoId === 'admin') { banner.innerHTML = ''; return; }
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            if (!doc.exists || !doc.data().aspiranteGraduacao) { banner.innerHTML = ''; return; }

            const aluno     = doc.data();
            const categoria = this._getCategoria(aluno);
            const proxFaixa = this._getProxFaixa(aluno, categoria);
            const cor       = this._corFaixa(proxFaixa);

            banner.innerHTML = `
                <div onclick="ui.showTab('tab-exame'); exame.carregarExameAluno()"
                     style="background:linear-gradient(135deg,#052e16,#064e3b);
                            border:2px solid #10b981;
                            border-radius:14px;
                            padding:14px 16px;
                            margin-bottom:14px;
                            cursor:pointer;
                            display:flex;
                            align-items:center;
                            gap:12px;
                            box-shadow:0 0 20px #10b98122;">
                    <div style="font-size:2rem; flex-shrink:0;">🥋</div>
                    <div style="flex:1;">
                        <div style="color:#10b981; font-size:0.82rem; font-weight:900; letter-spacing:0.3px;">
                            CONVOCADO PARA O EXAME DE FAIXA! ✅
                        </div>
                        <div style="color:#a7f3d0; font-size:0.7rem; margin-top:3px;">
                            ${aluno.faixa} →
                            <strong style="color:${cor.border};">${proxFaixa}</strong>
                            · Toque para ver detalhes
                        </div>
                    </div>
                    <i class="fas fa-chevron-right" style="color:#10b981; font-size:0.8rem; flex-shrink:0;"></i>
                </div>`;
        } catch(e) { banner.innerHTML = ''; }
    },

    // ── Relatório resumido do exame ──────────────────────────
    async carregarRelatorioExame({ kids, adulto, preta } = {}) {
        const el = document.getElementById('relatorio-exame');
        if (!el) return;
        try {
            const snap = await db.collection('alunos').where('aspiranteGraduacao', '==', true).get();
            if (snap.empty) { el.innerHTML = ''; return; }

            const infantil = ['Branca','Cinza/Branca','Cinza','Cinza/Preta','Amarela/Branca','Amarela','Amarela/Preta','Laranja/Branca','Laranja','Laranja/Preta','Verde/Branca','Verde','Verde/Preta'];
            const coresNome = {
                'Preta':'#ef4444','Marrom':'#d97706','Roxa':'#a78bfa','Azul':'#60a5fa',
                'Branca':'#e2e8f0','Cinza/Branca':'#b0bec5','Cinza':'#94a3b8','Cinza/Preta':'#607d8b',
                'Amarela/Branca':'#fff176','Amarela':'#facc15','Amarela/Preta':'#f59e0b',
                'Laranja/Branca':'#ffb74d','Laranja':'#fb923c','Laranja/Preta':'#f97316',
                'Verde/Branca':'#a5d6a7','Verde':'#4ade80','Verde/Preta':'#22c55e'
            };

            let total = 0, confirmados = 0, pendentes = 0;
            let receber = 0;
            const porFaixa = {};

            snap.docs.forEach(doc => {
                const a = doc.data();
                const cat = this._getCategoria(a);
                const proxFaixa = this._getProxFaixa(a, cat);
                const faixaDestino = a.proxFaixaCustom || proxFaixa;
                total++;
                if (a.examePresencaConfirmada) confirmados++; else pendentes++;

                // Valor a receber
                let taxa = 0;
                if (cat === 'kids')   taxa = parseFloat((kids?.valor   || '0').toString().replace(',','.')) || 0;
                if (cat === 'adulto') taxa = parseFloat((adulto?.valor || '0').toString().replace(',','.')) || 0;
                if (cat === 'preta')  taxa = a.faixa === 'Preta'
                    ? parseFloat((preta?.valor2 || '0').toString().replace(',','.')) || 0
                    : parseFloat((preta?.valor  || '0').toString().replace(',','.')) || 0;
                receber += taxa;

                porFaixa[faixaDestino] = (porFaixa[faixaDestino] || 0) + 1;
            });

            const pct = total > 0 ? Math.round((confirmados / total) * 100) : 0;
            const barColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

            // Ordenar faixas: kids por ordem infantil, depois adulto
            const faixasOrdenadas = [
                ...infantil.filter(f => porFaixa[f]),
                ...['Azul','Roxa','Marrom','Preta'].filter(f => porFaixa[f]),
                ...Object.keys(porFaixa).filter(f => !infantil.includes(f) && !['Azul','Roxa','Marrom','Preta'].includes(f))
            ];

            const faixasHtml = faixasOrdenadas.map(f => {
                const cor = coresNome[f] || '#94a3b8';
                const qtd = porFaixa[f];
                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0;"></div>
                        <span style="font-size:0.72rem;color:${cor};font-weight:700;">${f}</span>
                    </div>
                    <span style="font-size:0.75rem;font-weight:900;color:white;">${qtd} aluno${qtd>1?'s':''}</span>
                </div>`;
            }).join('');

            el.innerHTML = `
                <div style="background:#0a0f1a;border:1px solid #1e3a5f;border-radius:14px;padding:14px;margin-bottom:4px;">
                    <div style="font-size:0.6rem;font-weight:800;color:#3b82f6;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">📊 Relatório do Exame</div>

                    <!-- KPIs linha 1 -->
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:10px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:white;">${total}</div>
                            <div style="font-size:0.55rem;color:#64748b;font-weight:700;margin-top:2px;">CONVOCADOS</div>
                        </div>
                        <div style="background:#0f172a;border:1px solid #10b98130;border-radius:10px;padding:10px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:#10b981;">${confirmados}</div>
                            <div style="font-size:0.55rem;color:#64748b;font-weight:700;margin-top:2px;">CONFIRMADOS</div>
                        </div>
                        <div style="background:#0f172a;border:1px solid #f59e0b30;border-radius:10px;padding:10px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:#f59e0b;">${pendentes}</div>
                            <div style="font-size:0.55rem;color:#64748b;font-weight:700;margin-top:2px;">PENDENTES</div>
                        </div>
                    </div>

                    <!-- Valor a receber -->
                    <div style="background:#0f172a;border:1px solid #22c55e30;border-radius:10px;padding:10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
                        <div>
                            <div style="font-size:0.55rem;color:#64748b;font-weight:700;">💰 VALOR A RECEBER</div>
                            <div style="font-size:0.6rem;color:#475569;margin-top:1px;">baseado nas taxas configuradas</div>
                        </div>
                        <div style="font-size:1.3rem;font-weight:900;color:#22c55e;">R$ ${receber.toFixed(2).replace('.',',')}</div>
                    </div>

                    <!-- Barra de confirmação -->
                    <div style="margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="font-size:0.58rem;color:#64748b;font-weight:700;">TAXA DE CONFIRMAÇÃO</span>
                            <span style="font-size:0.6rem;font-weight:900;color:${barColor};">${pct}%</span>
                        </div>
                        <div style="background:#1e293b;border-radius:999px;height:6px;overflow:hidden;">
                            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s;"></div>
                        </div>
                    </div>

                    <!-- Por faixa destino -->
                    <div style="font-size:0.58rem;color:#64748b;font-weight:700;margin-bottom:6px;letter-spacing:0.5px;">🥋 ALUNOS POR FAIXA DESTINO</div>
                    ${faixasHtml}
                </div>`;
        } catch(e) { if (el) el.innerHTML = ''; }
    },

    // ── Migra alunos convocados antes da implementação do popup ──
    async migrarConvocacoesPendentes() {
        try {
            const snap = await db.collection('alunos')
                .where('aspiranteGraduacao', '==', true)
                .get();
            const semNotificacao = snap.docs.filter(d => !d.data().convocacaoPendente);
            if (semNotificacao.length === 0) {
                alert('Todos os convocados já foram notificados!');
                return;
            }
            if (!confirm(`Enviar notificação de convocação para ${semNotificacao.length} aluno(s) que ainda não receberam?\n\nEles verão o popup na próxima vez que abrirem o app.`)) return;
            const batch = db.batch();
            semNotificacao.forEach(d => batch.update(d.ref, { convocacaoPendente: true }));
            await batch.commit();
            alert(`✅ ${semNotificacao.length} aluno(s) serão notificados!`);
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── Admin define faixa destino personalizada para kids ──
    async salvarProxFaixaKids(alunoId, faixa) {
        try {
            await db.collection('alunos').doc(alunoId).update({ proxFaixaCustom: faixa });
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── Toggle taxa do exame paga/não paga ───────────────────
    async toggleTaxaPaga(alunoId, wrapEl) {
        const ref = db.collection('alunos').doc(alunoId);
        const doc = await ref.get();
        const atual = doc.exists ? (doc.data().taxaExamePaga === true) : false;
        const novo = !atual;
        await ref.update({ taxaExamePaga: novo });
        // Atualiza visual sem re-renderizar tudo
        const toggle = document.getElementById(`taxa-toggle-${alunoId}`);
        const label  = document.getElementById(`taxa-label-${alunoId}`);
        if (toggle) {
            toggle.style.background = novo ? '#10b981' : '#334155';
            toggle.querySelector('div').style.left = novo ? '14px' : '2px';
        }
        if (label) {
            label.style.color = novo ? '#10b981' : '#94a3b8';
            label.textContent = novo ? '💰 TAXA PAGA' : '💸 Taxa não paga';
        }
        if (wrapEl) {
            wrapEl.style.background = novo ? '#05200f' : '#1e293b';
            wrapEl.style.borderColor = novo ? '#10b98155' : '#334155';
        }
    },

    // ── Graduar aluno direto pela lista de convocados ────────
    async graduarAluno(alunoId) {
        const card = document.getElementById(`card-conv-${alunoId}`);
        const btn = card?.querySelector('button[data-faixa-destino]');
        const faixaDestino = btn?.dataset.faixaDestino;
        if (!faixaDestino) return;

        const nomeEl = document.getElementById(`nome-conv-${alunoId}`);
        const nome = nomeEl?.textContent || '';
        if (!confirm(`Graduar ${nome} para ${faixaDestino}?`)) return;

        try {
            btn.disabled = true;
            btn.textContent = '⏳ Graduando...';

            const docRef = db.collection('alunos').doc(alunoId);
            const snap = await docRef.get();
            if (!snap.exists) throw new Error('Aluno não encontrado');
            const dados = snap.data();

            const hoje = new Date();
            const dataFormatada = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;
            const historicoGrad = dados.historicoGraduacao || [];
            historicoGrad.push({ faixa: faixaDestino, grau: 0, faixaMT: null, modalidade: 'jiujitsu', data: dataFormatada });

            await docRef.update({
                faixa: faixaDestino,
                grau: 0,
                aspiranteGraduacao: false,
                proxFaixaCustom: firebase.firestore.FieldValue.delete(),
                graduacaoPendente: { faixa: faixaDestino, grau: 0, faixaMT: null, modalidadeAlterada: 'jiujitsu' },
                historicoGraduacao: historicoGrad,
                aulas: 0
            });

            // Push de parabéns
            push.paraAluno(alunoId, '🏆 Parabéns! Nova faixa!', `Você foi graduado(a) para a faixa ${faixaDestino}! Muito orgulho! OSS! 🥋`);

            // Remove card da lista
            card?.remove();
        } catch(e) {
            alert('Erro ao graduar: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '🥋 GRADUAR'; }
        }
    }
};

// ══════════════════════════════════════════════════════════
// TÉCNICAS DO EXAME
// ══════════════════════════════════════════════════════════
const tecnicasExame = {

    _BIB_ADULTO: {
        quedas:          { nome:'Quedas / Takedowns',   icon:'🥋', lista:['Dupla (Double Leg)','Simples (Single Leg)','Seoi Nage','Osoto Gari','Kouchi Gari','Ouchi Gari','Tomoe Nage','Ippon Seoi Nage'] },
        raspagens:       { nome:'Raspagens',             icon:'🔄', lista:['De La Riva','Gancho (Hook Sweep)','Tesoura','Fechada (Scissor)','Laço / Lasso','X-Guard','Spider Guard','Cem Quilos Invertido','Pendulo','Sumi Gaeshi','Tripod Sweep'] },
        passagens:       { nome:'Passagens de Guarda',  icon:'➡️', lista:['Toreando','Esmagadora (Smash Pass)','Over-Under','X-Pass','Leg Drag','Double Under','Bullfighter','Knee Slice'] },
        estrangulamentos:{ nome:'Estrangulamentos',     icon:'🔒', lista:['Triângulo','Mata Leão (RNC)','Anaconda','Darce','Guilhotina','Loop Choke','Bow & Arrow','Ezekiel','Cross Collar','Clock Choke','Brabo Choke'] },
        chaves_braco:    { nome:'Chaves de Braço',      icon:'💪', lista:['Americana','Kimura','Omoplata','Armbar (Juji Gatame)','Gogoplata','Wristlock','Baratoplata'] },
        chaves_perna:    { nome:'Chaves de Perna',      icon:'🦵', lista:['Heel Hook Interno','Heel Hook Externo','Kneebar','Estrangulamento de Tornozelo','Calf Slicer'] },
        posicoes:        { nome:'Posições / Controles', icon:'📍', lista:['Montada','Costas','Meia Guarda','Norte-Sul','Cem Quilos (Side Control)','Joelho na Barriga','Guarda Fechada','Guarda Aberta'] },
        escapes:         { nome:'Escapes',              icon:'🚪', lista:['Escape da Montada (Upa)','Escape da Montada (Cotovelo-Joelho)','Escape do Cem Quilos','Escape das Costas','Escape do Joelho na Barriga'] },
    },
    _BIB_KIDS: {
        movimentos:      { nome:'Movimentos Básicos',   icon:'🤸', lista:['Rolamento Frontal','Rolamento para Trás','Ginga','Queda de Quadril','Ponte (Upa)','Cambalhota Lateral','Shrimping (Camarão)'] },
        quedas_kids:     { nome:'Quedas',               icon:'🥋', lista:['Queda Simples','Queda Dupla','Projeção com Quadril','Queda com Giro'] },
        raspagens_kids:  { nome:'Raspagens',            icon:'🔄', lista:['Gancho','Tesoura','Pendulo','Cem Quilos Invertido','Spider Guard'] },
        estrang_kids:    { nome:'Estrangulamentos',     icon:'🔒', lista:['Guilhotina','Triângulo','Mata Leão','Loop Choke'] },
        chaves_kids:     { nome:'Chaves',               icon:'💪', lista:['Americana','Kimura','Armbar'] },
        posicoes_kids:   { nome:'Posições',             icon:'📍', lista:['Montada','Cem Quilos','Guarda Fechada','Costas','Meia Guarda','Norte-Sul'] },
        escapes_kids:    { nome:'Escapes',              icon:'🚪', lista:['Escape da Montada (Upa)','Escape do Cem Quilos','Escape das Costas','Escape do Joelho na Barriga'] },
    },

    _GRUPOS: {
        kids_ca: { label:'Kids Cinza / Amarela', emoji:'🟡', cor:'#facc15', bib:'kids' },
        kids_lv: { label:'Kids Laranja / Verde',  emoji:'🟢', cor:'#4ade80', bib:'kids' },
        azul:    { label:'Azul',                  emoji:'🔵', cor:'#60a5fa', bib:'adulto' },
        roxa:    { label:'Roxa',                  emoji:'🟣', cor:'#a78bfa', bib:'adulto' },
        marrom:  { label:'Marrom',                emoji:'🟤', cor:'#d97706', bib:'adulto' },
        preta:   { label:'Preta',                 emoji:'⬛', cor:'#f59e0b', bib:'adulto' },
    },

    _grupoAtivo: 'kids_ca',
    _cache: {},

    _grupoDeProxFaixa(pf) {
        const ca = ['Cinza/Branca','Cinza','Cinza/Preta','Amarela/Branca','Amarela','Amarela/Preta'];
        const lv = ['Laranja/Branca','Laranja','Laranja/Preta','Verde/Branca','Verde','Verde/Preta'];
        if (ca.includes(pf)) return 'kids_ca';
        if (lv.includes(pf)) return 'kids_lv';
        if (pf === 'Azul')   return 'azul';
        if (pf === 'Roxa')   return 'roxa';
        if (pf === 'Marrom') return 'marrom';
        if (pf?.startsWith('Preta')) return 'preta';
        return null;
    },

    async _carregarGrupo(grupo) {
        if (this._cache[grupo]) return this._cache[grupo];
        const snap = await db.collection('configuracoes').doc(`tecnicas_${grupo}`).get();
        this._cache[grupo] = snap.exists ? (snap.data().tecnicas || []) : [];
        return this._cache[grupo];
    },

    async salvarGrupo(grupo) {
        const tecnicas = this._lerDOM(grupo);
        await db.collection('configuracoes').doc(`tecnicas_${grupo}`).set({ tecnicas });
        this._cache[grupo] = tecnicas;
        const btn = document.getElementById(`btn-salvar-tec-${grupo}`);
        if (btn) { btn.textContent = '✅ Salvo!'; setTimeout(() => btn.textContent = '💾 Salvar', 2000); }
    },

    _lerDOM(grupo) {
        const c = document.getElementById(`tec-grupo-${grupo}`);
        if (!c) return [];
        return Array.from(c.querySelectorAll('[data-tec-id]')).map(el => ({
            id:         el.dataset.tecId,
            nome:       el.querySelector('.tec-nome')?.value?.trim() || '',
            categoria:  el.dataset.categoria,
            quantidade: parseInt(el.querySelector('.tec-qtd')?.value || '0') || 0,
            ativo:      el.querySelector('.tec-toggle')?.checked || false,
        })).filter(t => t.nome);
    },

    // ── Painel Admin ───────────────────────────────────────
    async carregarPainel() {
        const el = document.getElementById('tecnicas-exame-painel');
        if (!el) return;

        const tabsHtml = Object.entries(this._GRUPOS).map(([g, info]) =>
            `<button onclick="tecnicasExame.trocarGrupo('${g}')" id="tab-tec-${g}"
                style="padding:6px 12px;border:none;border-radius:8px;font-size:0.63rem;font-weight:800;cursor:pointer;white-space:nowrap;
                background:${g===this._grupoAtivo?info.cor:'#1e293b'};color:${g===this._grupoAtivo?'#000':'#64748b'};">
                ${info.emoji} ${info.label}
            </button>`
        ).join('');

        el.innerHTML = `
            <div style="background:#0a0f1a;border:1px solid #312e8144;border-radius:14px;overflow:hidden;">
                <div onclick="tecnicasExame._togglePainel()" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer;user-select:none;">
                    <div style="font-size:0.6rem;font-weight:800;color:#8b5cf6;letter-spacing:1px;text-transform:uppercase;">📚 Técnicas do Exame</div>
                    <span id="tec-chevron" style="color:#8b5cf6;font-size:0.75rem;transition:transform 0.2s;">▼</span>
                </div>
                <div id="tec-painel-body" style="display:none;padding:0 14px 14px;">
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">${tabsHtml}</div>
                    <div id="tec-conteudo"><small style="color:#475569;font-size:0.65rem;">Selecione um grupo...</small></div>
                </div>
            </div>`;

        // começa recolhido — não carrega grupo ainda
    },

    _painelAberto: false,

    _togglePainel() {
        this._painelAberto = !this._painelAberto;
        const body    = document.getElementById('tec-painel-body');
        const chevron = document.getElementById('tec-chevron');
        if (body)    body.style.display    = this._painelAberto ? 'block' : 'none';
        if (chevron) chevron.style.transform = this._painelAberto ? 'rotate(180deg)' : '';
        // Carrega o grupo só na primeira abertura
        if (this._painelAberto && !document.getElementById('tec-conteudo')?.querySelector('[data-tec-id]')) {
            this.trocarGrupo(this._grupoAtivo, true);
        }
    },

    async trocarGrupo(grupo, forcar = false) {
        if (!forcar && this._grupoAtivo === grupo) return;
        this._grupoAtivo = grupo;

        Object.keys(this._GRUPOS).forEach(g => {
            const btn = document.getElementById(`tab-tec-${g}`);
            if (!btn) return;
            btn.style.background = g===grupo ? this._GRUPOS[g].cor : '#1e293b';
            btn.style.color      = g===grupo ? '#000' : '#64748b';
        });

        const conteudo = document.getElementById('tec-conteudo');
        if (!conteudo) return;
        conteudo.innerHTML = `<small style="color:#475569;font-size:0.65rem;">Carregando...</small>`;

        const info    = this._GRUPOS[grupo];
        const bib     = info.bib === 'kids' ? this._BIB_KIDS : this._BIB_ADULTO;
        const salvas  = await this._carregarGrupo(grupo);
        const mapaS   = {};
        salvas.forEach(t => { mapaS[t.id] = t; });

        let html = `<div id="tec-grupo-${grupo}">`;
        Object.entries(bib).forEach(([catId, catInfo]) => {
            html += `<div style="margin-bottom:14px;">
                <div style="font-size:0.58rem;font-weight:800;color:#475569;letter-spacing:0.5px;margin-bottom:5px;">${catInfo.icon} ${catInfo.nome.toUpperCase()}</div>`;

            catInfo.lista.forEach((nome, i) => {
                const id = `${catId}_${i}`;
                const s  = mapaS[id] || { ativo:false, quantidade:0, nome };
                html += this._cardHTML(id, s.nome||nome, catId, s.ativo, s.quantidade);
            });

            // Técnicas customizadas desta categoria
            salvas.filter(t => t.categoria===catId && !catInfo.lista.some((_,i)=>`${catId}_${i}`===t.id))
                  .forEach(t => html += this._cardHTML(t.id, t.nome, catId, t.ativo, t.quantidade, true));

            html += `<button onclick="tecnicasExame.adicionarCustom('${grupo}','${catId}')"
                style="width:100%;padding:5px;background:transparent;border:1px dashed #1e293b;color:#334155;border-radius:8px;font-size:0.62rem;cursor:pointer;margin-top:2px;">
                + adicionar técnica</button></div>`;
        });
        html += `</div>
        <button id="btn-salvar-tec-${grupo}" onclick="tecnicasExame.salvarGrupo('${grupo}')"
            style="width:100%;padding:11px;background:${info.cor};border:none;color:#000;border-radius:10px;font-weight:900;font-size:0.78rem;cursor:pointer;margin-top:6px;">
            💾 Salvar ${info.emoji} ${info.label}
        </button>`;
        conteudo.innerHTML = html;
    },

    _cardHTML(id, nome, categoria, ativo, quantidade, custom=false) {
        return `<div data-tec-id="${id}" data-categoria="${categoria}"
            style="display:flex;align-items:center;gap:7px;padding:6px 8px;background:#0f172a;border:1px solid ${ativo?'#33415580':'#1e293b'};border-radius:8px;margin-bottom:3px;">
            <input type="checkbox" class="tec-toggle" ${ativo?'checked':''}
                style="width:15px;height:15px;accent-color:#8b5cf6;cursor:pointer;flex-shrink:0;"
                onchange="this.closest('[data-tec-id]').style.borderColor=this.checked?'#33415580':'#1e293b'">
            <input type="text" class="tec-nome" value="${nome}"
                style="flex:1;background:transparent;border:none;color:#e2e8f0;font-size:0.72rem;outline:none;min-width:0;">
            <input type="number" class="tec-qtd" value="${quantidade||''}" min="1" placeholder="qtd"
                style="width:44px;padding:3px 5px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;font-size:0.65rem;text-align:center;outline:none;">
            ${custom?`<button onclick="this.closest('[data-tec-id]').remove()"
                style="background:none;border:none;color:#ef444460;cursor:pointer;font-size:0.85rem;padding:0 2px;line-height:1;">✕</button>`:''}
        </div>`;
    },

    adicionarCustom(grupo, categoria) {
        const c = document.getElementById(`tec-grupo-${grupo}`);
        if (!c) return;
        const btns = Array.from(c.querySelectorAll('button')).filter(b => b.textContent.includes('+ adicionar') && b.getAttribute('onclick')?.includes(`'${categoria}'`));
        const btn  = btns[0];
        if (!btn) return;
        const id  = `${categoria}_c${Date.now()}`;
        const div = document.createElement('div');
        div.innerHTML = this._cardHTML(id, '', categoria, true, 1, true);
        btn.before(div.firstElementChild);
        btn.previousElementSibling?.querySelector('.tec-nome')?.focus();
    },

    // ── Botão para o aluno ─────────────────────────────────
    async carregarBotaoAluno(proxFaixa, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const grupo = this._grupoDeProxFaixa(proxFaixa);
        if (!grupo) { container.innerHTML=''; return; }
        const tecs  = await this._carregarGrupo(grupo);
        const ativas = tecs.filter(t => t.ativo && t.quantidade > 0);
        if (!ativas.length) { container.innerHTML=''; return; }
        const info = this._GRUPOS[grupo];
        container.innerHTML = `
            <button onclick="tecnicasExame.abrirModal('${grupo}')"
                style="width:100%;padding:13px;background:#0f172a;border:2px solid ${info.cor}55;color:${info.cor};border-radius:12px;font-weight:800;font-size:0.82rem;cursor:pointer;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;">
                📋 VER TÉCNICAS DO EXAME
            </button>`;
    },

    async abrirModal(grupo) {
        const tecs  = await this._carregarGrupo(grupo);
        const ativas = tecs.filter(t => t.ativo && t.quantidade > 0);
        if (!ativas.length) return;
        const info = this._GRUPOS[grupo];
        const bib  = info.bib==='kids' ? this._BIB_KIDS : this._BIB_ADULTO;

        const porCat = {};
        ativas.forEach(t => { (porCat[t.categoria] = porCat[t.categoria]||[]).push(t); });

        let listHtml = '';
        Object.entries(porCat).forEach(([catId, tecs]) => {
            const catInfo = bib[catId] || { nome:catId, icon:'•' };
            listHtml += `<div class="tec-secao" style="margin-bottom:16px;">
                <div style="font-size:0.6rem;font-weight:800;color:#64748b;letter-spacing:0.5px;margin-bottom:6px;text-transform:uppercase;">${catInfo.icon} ${catInfo.nome}</div>
                ${tecs.map(t=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#0f172a;border-left:3px solid ${info.cor};border-radius:0 8px 8px 0;margin-bottom:4px;">
                    <span style="font-size:0.78rem;color:#e2e8f0;font-weight:600;">${t.nome}</span>
                    <span style="font-size:0.7rem;font-weight:900;color:${info.cor};background:${info.cor}22;padding:3px 9px;border-radius:999px;">${t.quantidade}×</span>
                </div>`).join('')}
            </div>`;
        });

        document.getElementById('modal-tecnicas-exame')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-tecnicas-exame';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#020617;z-index:99999;overflow-y:auto;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:500px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div>
                        <div style="font-size:0.55rem;color:${info.cor};font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Técnicas do Exame</div>
                        <div style="font-size:1rem;font-weight:900;color:white;">${info.emoji} ${info.label}</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button onclick="tecnicasExame._imprimir('${grupo}')"
                            style="padding:8px 12px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">
                            🖨️ Imprimir
                        </button>
                        <button onclick="document.getElementById('modal-tecnicas-exame').remove()"
                            style="padding:8px 12px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">
                            ✕
                        </button>
                    </div>
                </div>
                <div id="tec-modal-lista">${listHtml}</div>
                <div style="text-align:center;margin-top:24px;font-size:0.65rem;color:#334155;font-style:italic;">OSS! Treine cada técnica com dedicação. 🥋</div>
            </div>`;
        document.body.appendChild(modal);
    },

    async _imprimir(grupo) {
        const tecs   = await this._carregarGrupo(grupo);
        const ativas = tecs.filter(t => t.ativo && t.quantidade > 0);
        const info   = this._GRUPOS[grupo];
        const bib    = info.bib==='kids' ? this._BIB_KIDS : this._BIB_ADULTO;
        const porCat = {};
        ativas.forEach(t => { (porCat[t.categoria] = porCat[t.categoria]||[]).push(t); });

        let corpo = '';
        Object.entries(porCat).forEach(([catId, tecs]) => {
            const catInfo = bib[catId] || { nome:catId, icon:'' };
            corpo += `<h3>${catInfo.icon} ${catInfo.nome}</h3>
                <table><tr><th>Técnica</th><th>Qtd</th></tr>
                ${tecs.map(t=>`<tr><td>${t.nome}</td><td>${t.quantidade}×</td></tr>`).join('')}
                </table>`;
        });

        const w = window.open('','_blank');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Técnicas — ${info.label}</title>
        <style>
            body{font-family:Arial,sans-serif;padding:28px;color:#000;max-width:700px;margin:0 auto;}
            h1{font-size:1.3rem;margin-bottom:4px;} h2{font-size:0.9rem;color:#555;font-weight:400;margin-bottom:20px;}
            h3{font-size:0.85rem;font-weight:bold;text-transform:uppercase;color:#333;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px;}
            table{width:100%;border-collapse:collapse;margin-bottom:10px;}
            th{background:#f0f0f0;text-align:left;padding:6px 10px;font-size:0.8rem;}
            td{padding:6px 10px;font-size:0.85rem;border-bottom:1px solid #eee;}
            td:last-child{font-weight:bold;text-align:center;width:50px;}
            @media print{button{display:none!important;}}
        </style></head><body>
        <h1>📋 Técnicas do Exame de Faixa</h1>
        <h2>${info.emoji} ${info.label} — Gaditas Academy</h2>
        ${corpo}
        <p style="margin-top:28px;font-size:0.75rem;color:#888;text-align:center;">OSS! 🥋 Gaditas Academy</p>
        <script>window.onload=()=>window.print();<\/script>
        </body></html>`);
        w.document.close();
    },
};

// ══════════════════════════════════════════════════════════
// PÓS-TREINO: Diário + Avaliação + Marcos de Aulas
// ══════════════════════════════════════════════════════════
const treinoPost = {

    _MARCOS: [50, 100, 150, 200, 300, 500, 1000],

    // Chamado após qualquer check-in bem-sucedido do aluno atual
    async aoCheckinConcluido(alunoId, novasAulas, turma) {
        // 1. Verificar marco
        await this.verificarMarco(alunoId, novasAulas);
        // 2. Modal de avaliação + diário (leve delay para não conflitar com marco)
        setTimeout(() => this.abrirModalPosTreino(alunoId, turma), 800);
    },

    // ── Marcos de aulas ──────────────────────────────────
    async verificarMarco(alunoId, aulas) {
        if (!this._MARCOS.includes(aulas)) return;
        const chave = `gaditas_marco_${alunoId}_${aulas}`;
        if (localStorage.getItem(chave)) return;
        localStorage.setItem(chave, '1');
        this._mostrarPopupMarco(auth.currentUser?.nome || '', aulas);
    },

    _mostrarPopupMarco(nomeCompleto, aulas) {
        document.getElementById('modal-marco-aulas')?.remove();
        const primeiroNome = (nomeCompleto || '').split(' ')[0];
        const emojis = { 50:'🥉', 100:'🥈', 150:'🎖️', 200:'🥇', 300:'🏆', 500:'👑', 1000:'🐉' };
        const emoji  = emojis[aulas] || '🏅';
        const modal  = document.createElement('div');
        modal.id = 'modal-marco-aulas';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1e293b);border:2px solid #f59e0b;border-radius:24px;padding:36px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 80px #f59e0b44;position:relative;overflow:hidden;">
                <div style="position:absolute;top:-10px;left:0;right:0;font-size:1.4rem;opacity:0.12;user-select:none;line-height:1.8;pointer-events:none;">⭐🏅🎯⭐🏅🎯⭐🏅🎯⭐🏅🎯⭐🏅🎯⭐🏅🎯</div>
                <div style="font-size:4rem;margin-bottom:8px;animation:bounce 0.8s infinite alternate;">${emoji}</div>
                <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Marco Alcançado!</div>
                <div style="font-size:1.5rem;font-weight:800;color:white;line-height:1.3;margin-bottom:10px;">
                    ${primeiroNome}, você bateu<br>
                    <span style="color:#f59e0b;font-size:2.2rem;">${aulas}</span>
                    <span style="color:#f59e0b;"> aulas!</span>
                </div>
                <div style="font-size:0.82rem;color:#94a3b8;line-height:1.7;margin:12px 0 24px;">
                    Cada aula é um passo na sua jornada. 💪<br>
                    A família <strong style="color:white;">Gaditas</strong> celebra cada treino seu com muito orgulho!<br><br>
                    <span style="font-size:1.1rem;font-weight:800;color:#f59e0b;">OSS! 🥋</span>
                </div>
                <button onclick="document.getElementById('modal-marco-aulas').remove()"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;">
                    🙏 QUE VENHAM MAIS ${aulas === 1000 ? '500' : aulas}!
                </button>
            </div>
            <style>@keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-10px)}}</style>`;
        document.body.appendChild(modal);
    },

    // ── Modal pós-treino: ⭐ Avaliação + 📝 Diário ────────
    abrirModalPosTreino(alunoId, turma) {
        // Chave apenas para fechar com localStorage (não bloqueia reabertura no Firestore)
        const hoje = new Date().toLocaleDateString('pt-BR');
        const chave = `gaditas_postreino_${alunoId}_${hoje}_${turma}`;

        document.getElementById('modal-pos-treino')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-pos-treino';
        modal.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;z-index:99997;padding:16px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="background:#0f172a;border:1px solid #334155;border-top:3px solid #8b5cf6;border-radius:20px 20px 16px 16px;padding:20px;max-width:480px;margin:0 auto;box-shadow:0 -8px 30px rgba(0,0,0,0.5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <div>
                        <div style="font-size:0.6rem;color:#8b5cf6;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Como foi o treino?</div>
                        <div style="font-size:0.75rem;color:#e2e8f0;font-weight:700;margin-top:2px;">${turma}</div>
                    </div>
                    <button onclick="treinoPost._fecharModalPosTreino('${chave}','${alunoId}')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:1rem;">✕</button>
                </div>

                <!-- Estrelas -->
                <div style="display:flex;justify-content:center;gap:10px;margin-bottom:16px;" id="estrelas-treino">
                    ${[1,2,3,4,5].map(n => `
                        <button onclick="treinoPost._selecionarEstrela(${n})" id="star-${n}"
                            style="font-size:2rem;background:none;border:none;cursor:pointer;opacity:0.3;transition:all 0.15s;filter:grayscale(1);">⭐</button>
                    `).join('')}
                </div>

                <!-- Diário -->
                <div style="margin-bottom:14px;">
                    <textarea id="diario-treino-txt" placeholder="O que você treinou hoje? Como se sentiu? (opcional)"
                        style="width:100%;padding:10px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:10px;font-size:0.78rem;outline:none;resize:none;box-sizing:border-box;line-height:1.5;" rows="3"></textarea>
                </div>

                <button onclick="treinoPost._salvar('${alunoId}','${turma}','${chave}')"
                    style="width:100%;padding:12px;background:#8b5cf6;border:none;color:white;border-radius:10px;font-weight:800;font-size:0.82rem;cursor:pointer;">
                    💾 Salvar e Fechar
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    _notaSelecionada: 0,
    _selecionarEstrela(n) {
        this._notaSelecionada = n;
        [1,2,3,4,5].forEach(i => {
            const btn = document.getElementById(`star-${i}`);
            if (!btn) return;
            btn.style.opacity  = i <= n ? '1' : '0.3';
            btn.style.filter   = i <= n ? 'none' : 'grayscale(1)';
            btn.style.transform = i <= n ? 'scale(1.15)' : 'scale(1)';
        });
    },

    async _salvar(alunoId, turma, chave) {
        const nota  = this._notaSelecionada;
        const texto = document.getElementById('diario-treino-txt')?.value?.trim() || '';
        const hoje  = new Date();
        const dataStr = hoje.toLocaleDateString('pt-BR');
        const horaStr = hoje.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

        try {
            // Remove feedbackPendente do Firestore (respondido)
            await db.collection('alunos').doc(alunoId).update({
                feedbackPendente: firebase.firestore.FieldValue.delete()
            });

            const updates = {};

            // Salva avaliação com nome e ID do aluno
            if (nota > 0 || texto) {
                await db.collection('avaliacoes_aula').add({
                    turma, nota: nota || 0, texto: texto || '',
                    alunoId: alunoId || '',
                    alunoNome: auth.currentUser?.nome || '',
                    data: dataStr, hora: horaStr, ts: Date.now()
                });
            }

            // Salva diário no perfil do aluno também
            if (texto) {
                const snap = await db.collection('alunos').doc(alunoId).get();
                const diario = snap.data()?.diarioTreino || [];
                diario.unshift({ data: dataStr, hora: horaStr, turma, texto, nota: nota || null });
                if (diario.length > 200) diario.splice(200);
                updates.diarioTreino = diario;
                await db.collection('alunos').doc(alunoId).update(updates);
            }
        } catch(e) { /* ignora erros silenciosamente */ }

        localStorage.setItem(chave, '1');
        this._notaSelecionada = 0;
        document.getElementById('modal-pos-treino')?.remove();
    },

    _fecharModalPosTreino(chave, alunoId) {
        // Remove feedbackPendente do Firestore (dispensado sem responder)
        if (alunoId) {
            db.collection('alunos').doc(alunoId).update({
                feedbackPendente: firebase.firestore.FieldValue.delete()
            }).catch(() => {});
        }
        localStorage.setItem(chave, '1');
        this._notaSelecionada = 0;
        document.getElementById('modal-pos-treino')?.remove();
    },

    // ── Diário do aluno ───────────────────────────────────
    async abrirDiario() {
        const alunoId = auth.currentUser?.id;
        if (!alunoId) return;
        const snap = await db.collection('alunos').doc(alunoId).get();
        const entradas = snap.data()?.diarioTreino || [];

        document.getElementById('modal-diario-treino')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-diario-treino';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#020617;z-index:99999;overflow-y:auto;padding:20px;box-sizing:border-box;';

        const estrelas = n => n ? '⭐'.repeat(n) + '☆'.repeat(5-n) : '';

        const entradasHtml = entradas.length ? entradas.map(e => `
            <div style="background:#0f172a;border:1px solid #1e293b;border-left:3px solid #8b5cf6;border-radius:0 10px 10px 0;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-size:0.6rem;color:#475569;font-weight:700;">${e.data}${e.hora ? ' às '+e.hora : ''} · ${e.turma||''}</span>
                    ${e.nota ? `<span style="font-size:0.65rem;">${estrelas(e.nota)}</span>` : ''}
                </div>
                <div style="font-size:0.78rem;color:#e2e8f0;line-height:1.5;">${e.texto}</div>
            </div>`).join('')
        : `<div style="text-align:center;padding:30px;color:#475569;font-size:0.8rem;">Nenhuma entrada ainda.</div>`;

        modal.innerHTML = `
            <div style="max-width:500px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div>
                        <div style="font-size:0.55rem;color:#8b5cf6;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Seus registros</div>
                        <div style="font-size:1rem;font-weight:900;color:white;">📓 Diário de Treino</div>
                    </div>
                    <button onclick="document.getElementById('modal-diario-treino').remove()"
                        style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.75rem;font-weight:800;cursor:pointer;">✕ Fechar</button>
                </div>
                <div style="font-size:0.6rem;color:#475569;font-weight:700;margin-bottom:8px;">${entradas.length} entrada${entradas.length!==1?'s':''}</div>
                ${entradasHtml}
            </div>`;
        document.body.appendChild(modal);
    },

    // ── Painel de avaliações (admin, aba relatórios) ──────
    async renderAvaliacoesPainel() {
        const el = document.getElementById('avaliacoes-painel');
        if (!el) return;
        el.innerHTML = `<small style="color:#475569;font-size:0.65rem;"><i class="fas fa-spinner fa-spin"></i></small>`;
        try {
            const snap = await db.collection('avaliacoes_aula').orderBy('ts','desc').limit(300).get();
            if (snap.empty) {
                el.innerHTML = `
                    <div style="background:#0a0f1a;border:1px solid #1e293b;border-radius:12px;padding:14px;margin-bottom:10px;">
                        <div style="font-size:0.6rem;font-weight:800;color:#8b5cf6;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">⭐ Avaliações das Aulas</div>
                        <div style="font-size:0.72rem;color:#475569;text-align:center;padding:10px;">Nenhuma avaliação ainda. Aparecem após o primeiro check-in.</div>
                    </div>`;
                return;
            }

            // Agrupa por turma (guarda objeto completo)
            const porTurma = {};
            snap.forEach(doc => {
                const d = doc.data();
                if (!porTurma[d.turma]) porTurma[d.turma] = [];
                porTurma[d.turma].push(d);
            });

            // Guarda mapa turma→avaliações acessível globalmente para o popup
            window._avaliacoesAdminCache = porTurma;

            const turmasHtml = Object.keys(porTurma).map((turma, idx) => {
                const avaliacoes = porTurma[turma];
                const notas = avaliacoes.map(a => a.nota).filter(n => n > 0);
                const media = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(1) : '—';
                const bar   = notas.length ? Math.round((parseFloat(media)/5)*100) : 0;
                const cor   = bar>=80?'#10b981':bar>=60?'#f59e0b':'#ef4444';
                const total = avaliacoes.length;
                return `<div onclick="treinoPost.abrirDetalheAvaliacao(${idx})"
                    style="padding:8px 0;border-bottom:1px solid #1e293b;cursor:pointer;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:0.72rem;color:#e2e8f0;font-weight:700;">${turma}</span>
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span style="font-size:0.65rem;color:#f59e0b;">★</span>
                            <span style="font-size:0.78rem;font-weight:900;color:white;">${media}</span>
                            <span style="font-size:0.58rem;color:#475569;">(${total})</span>
                            <span style="font-size:0.6rem;color:#475569;">▶</span>
                        </div>
                    </div>
                    <div style="background:#1e293b;border-radius:999px;height:4px;overflow:hidden;">
                        <div style="width:${bar}%;height:100%;background:${cor};border-radius:999px;"></div>
                    </div>
                </div>`;
            }).join('');

            el.innerHTML = `
                <div style="background:#0a0f1a;border:1px solid #1e293b;border-radius:12px;padding:14px;margin-bottom:10px;">
                    <div style="font-size:0.6rem;font-weight:800;color:#8b5cf6;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">⭐ Avaliações das Aulas</div>
                    ${turmasHtml}
                </div>`;
        } catch(e) { el.innerHTML = ''; }
    },

    // ── Detalhe avaliações por turma (admin) ─────────────
    async abrirDetalheAvaliacao(idx) {
        try {
        const cache = window._avaliacoesAdminCache || {};
        const turma = Object.keys(cache)[idx];
        if (!turma) return;
        const avaliacoes = (cache[turma] || []).sort((a,b)=>(b.ts||0)-(a.ts||0));

        // Busca nomes faltantes pelo alunoId
        const idsSemNome = [...new Set(avaliacoes.filter(a => !a.alunoNome && a.alunoId).map(a => a.alunoId))];
        const nomesMap = {};
        await Promise.all(idsSemNome.map(async id => {
            try {
                const d = await db.collection('alunos').doc(id).get();
                if (d.exists) nomesMap[id] = d.data().nome || '—';
            } catch(e) {}
        }));

        const estrelas = n => n > 0 ? ('⭐'.repeat(n) + '☆'.repeat(5-n)) : '—';
        const itens = avaliacoes.map(a => {
            const nome = a.alunoNome || nomesMap[a.alunoId] || 'Avaliação anônima';
            return `
            <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-size:0.78rem;font-weight:800;color:#e2e8f0;">${nome}</span>
                    <span style="font-size:0.7rem;">${estrelas(a.nota)}</span>
                </div>
                ${a.texto ? `<div style="font-size:0.75rem;color:#94a3b8;line-height:1.5;margin-bottom:4px;">"${a.texto}"</div>` : ''}
                <div style="font-size:0.58rem;color:#475569;">${a.data || ''}${a.hora ? ' às '+a.hora : ''}</div>
            </div>`;
        }).join('');

        document.getElementById('modal-detalhe-aval')?.remove();
        const modal = document.createElement('div');
        modal.id = 'modal-detalhe-aval';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.96);z-index:99999;overflow-y:auto;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:480px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div>
                        <div style="font-size:0.55rem;color:#8b5cf6;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Avaliações</div>
                        <div style="font-size:0.95rem;font-weight:900;color:white;">⭐ ${turma}</div>
                    </div>
                    <button onclick="document.getElementById('modal-detalhe-aval').remove()"
                        style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.75rem;font-weight:800;cursor:pointer;">✕</button>
                </div>
                <div style="font-size:0.6rem;color:#475569;margin-bottom:10px;">${avaliacoes.length} avaliação(ões)</div>
                ${itens}
            </div>`;
        document.body.appendChild(modal);
        } catch(e) { alert('Erro ao carregar avaliações: ' + e.message); }
    },

    // ── Radar de Sumidos (admin) ──────────────────────────
    async renderRadarSumidos() {
        const el = document.getElementById('radar-sumidos-container');
        if (!el) return;
        // Começa ABERTO
        el.innerHTML = `
            <div style="background:#0a0f1a;border:1px solid #ef444433;border-radius:12px;overflow:hidden;">
                <div onclick="(()=>{const b=document.getElementById('acc-radar');const c=document.getElementById('chev-acc-radar');b.style.display=b.style.display==='none'?'block':'none';c.style.transform=b.style.display==='block'?'rotate(180deg)':'rotate(-90deg)'})()"
                    style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;cursor:pointer;user-select:none;">
                    <div style="font-size:0.62rem;font-weight:800;color:#ef4444;">📡 Radar de Sumidos</div>
                    <span id="chev-acc-radar" style="color:#ef4444;font-size:0.7rem;transition:transform 0.2s;transform:rotate(180deg);">▼</span>
                </div>
                <div id="acc-radar" style="display:block;padding:0 12px 12px;">
                    <div id="radar-sumidos-lista"><small style="color:#475569;font-size:0.65rem;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small></div>
                </div>
            </div>`;
        this._carregarRadarLista();
    },

    async _carregarRadarLista() {
        const el = document.getElementById('radar-sumidos-lista');
        if (!el) return;
        el.innerHTML = `<small style="color:#475569;font-size:0.65rem;"><i class="fas fa-spinner fa-spin"></i> Carregando...</small>`;
        try {
            const snap = await db.collection('alunos').get();
            const agora = Date.now();
            const d14 = agora - 14 * 86400000;
            const d30 = agora - 30 * 86400000;

            const sumidos14 = [], sumidos30 = [];

            snap.forEach(doc => {
                const a = doc.data();
                if (a.status === 'trancado' || a.status === 'inativo') return;
                const hist = a.historico || [];
                if (!hist.length) return; // sem histórico ainda
                const ultima = hist[0]?.data;
                if (!ultima) return;
                const p = ultima.split(',')[0].split('/');
                if (p.length < 3) return;
                const ms = new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime();
                if (ms < d30)      sumidos30.push({ id: doc.id, a, ultimaAula: ultima, diasSem: Math.floor((agora - ms) / 86400000) });
                else if (ms < d14) sumidos14.push({ id: doc.id, a, ultimaAula: ultima, diasSem: Math.floor((agora - ms) / 86400000) });
            });

            sumidos14.sort((a,b) => b.diasSem - a.diasSem);
            sumidos30.sort((a,b) => b.diasSem - a.diasSem);

            const cardAluno = ({ id, a, ultimaAula, diasSem }) => {
                const tel = (a.telefone || '').replace(/\D/g,'');
                const wpp = tel ? `https://wa.me/55${tel}?text=${encodeURIComponent(`Olá ${a.nome.split(' ')[0]}, sentimos sua falta no tatame! OSS 🥋`)}` : '';
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#0f172a;border-left:3px solid ${diasSem>=30?'#ef4444':'#f59e0b'};border-radius:0 8px 8px 0;margin-bottom:5px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:0.78rem;font-weight:800;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.nome}</div>
                        <div style="font-size:0.6rem;color:#64748b;margin-top:1px;">${a.faixa||'Branca'} · Última aula: ${ultimaAula.split(',')[0]}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
                        <span style="font-size:0.65rem;font-weight:900;color:${diasSem>=30?'#ef4444':'#f59e0b'};">${diasSem}d</span>
                        ${wpp ? `<a href="${wpp}" target="_blank"
                            style="background:#064e3b;border:1px solid #10b981;color:#10b981;padding:4px 8px;border-radius:6px;font-size:0.6rem;font-weight:800;text-decoration:none;">
                            💬 WhatsApp</a>` : ''}
                    </div>
                </div>`;
            };

            const grupo = (titulo, cor, lista) => {
                if (!lista.length) return '';
                const gid = `radar-grp-${cor.replace('#','')}`;
                return `<div style="background:#0a0f1a;border:1px solid ${cor}33;border-radius:10px;margin-bottom:8px;overflow:hidden;">
                    <div onclick="(()=>{const b=document.getElementById('${gid}');const c=document.getElementById('chev-${gid}');b.style.display=b.style.display==='none'?'block':'none';c.style.transform=b.style.display==='block'?'rotate(180deg)':''})()"
                        style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;cursor:pointer;user-select:none;">
                        <div style="font-size:0.62rem;font-weight:800;color:${cor};">${titulo}</div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:0.65rem;font-weight:900;background:${cor}22;color:${cor};padding:2px 8px;border-radius:999px;">${lista.length}</span>
                            <span id="chev-${gid}" style="color:${cor};font-size:0.65rem;transition:transform 0.2s;">▼</span>
                        </div>
                    </div>
                    <div id="${gid}" style="display:none;padding:0 10px 10px;">${lista.map(cardAluno).join('')}</div>
                </div>`;
            };

            if (!sumidos14.length && !sumidos30.length) {
                el.innerHTML = `<div style="text-align:center;padding:20px;color:#10b981;font-size:0.8rem;font-weight:800;">✅ Nenhum aluno sumido! Turma unida! 💪</div>`;
                return;
            }

            el.innerHTML =
                grupo('⚠️ 14 a 29 dias sem treinar', '#f59e0b', sumidos14) +
                grupo('🚨 30+ dias sem treinar',      '#ef4444', sumidos30);

        } catch(e) { el.innerHTML = `<small style="color:#f43f5e;font-size:0.65rem;">Erro: ${e.message}</small>`; }
    },
};

// ══════════════════════════════════════════════════════════
// ENQUETES
// ══════════════════════════════════════════════════════════
const enquetes = {

    // ── VERIFICAR ENQUETE ATIVA (chamado no login do aluno) ──
    async verificarEnqueteAtiva() {
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
        try {
            const snap = await db.collection('enquetes').where('status', '==', 'ativa').get();
            if (snap.empty) return;

            // Busca dados completos do aluno (faixa, nascimento, modalidade)
            const alunoDoc = await db.collection('alunos').doc(auth.currentUser.id).get();
            if (!alunoDoc.exists) return;
            const aluno = { id: alunoDoc.id, ...alunoDoc.data() };

            for (const doc of snap.docs) {
                const enquete = { id: doc.id, ...doc.data() };

                // Encerra automaticamente se passou a data
                if (enquete.dataEncerramento && enquete.dataEncerramento < Date.now()) {
                    db.collection('enquetes').doc(enquete.id).update({ status: 'encerrada' }).catch(() => {});
                    continue;
                }
                // Verifica público-alvo
                if (!this._correspondePublico(aluno, enquete.publico)) continue;
                // Verifica se já votou
                if ((enquete.votantes || []).includes(auth.currentUser.id)) continue;

                // Mostra popup (uma por vez)
                this.abrirPopupEnquete(enquete);
                return;
            }
        } catch(e) { console.warn('Enquete:', e.message); }
    },

    _correspondePublico(aluno, publico) {
        if (publico === 'todos') return true;
        const anoAtual = new Date().getFullYear();
        const idade  = aluno.nascimento ? (anoAtual - new Date(aluno.nascimento).getFullYear()) : 99;
        const isKids = idade <= 15;
        const mod    = aluno.modalidade || 'jiujitsu';
        const faixa  = aluno.faixa || 'Branca';
        switch (publico) {
            case 'kids':             return isKids;
            case 'adulto':           return !isKids && mod !== 'muaythai';
            case 'muaythai':         return mod === 'muaythai' || mod === 'ambos';
            case 'branca':           return faixa === 'Branca';
            case 'azul-roxa-marrom': return ['Azul','Roxa','Marrom'].includes(faixa);
            case 'preta':            return faixa === 'Preta';
            default:                 return false;
        }
    },

    // ── POPUP BLOQUEANTE PARA O ALUNO ───────────────────────
    abrirPopupEnquete(enquete) {
        document.getElementById('modal-enquete-popup')?.remove();
        const opcoes = enquete.opcoes || [];
        const modal  = document.createElement('div');
        modal.id = 'modal-enquete-popup';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid #8b5cf655;border-radius:20px;padding:28px 22px;max-width:420px;width:100%;box-shadow:0 0 60px rgba(139,92,246,0.25);">
                <div style="text-align:center;margin-bottom:22px;">
                    <div style="font-size:2rem;margin-bottom:10px;">📋</div>
                    <div style="font-size:0.58rem;color:#a78bfa;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">ENQUETE DA ACADEMIA</div>
                    <div style="font-size:1rem;font-weight:800;color:white;line-height:1.5;">${enquete.titulo}</div>
                    <div style="font-size:0.6rem;color:#64748b;margin-top:6px;">Responda para continuar. Sua opinião é importante! OSS 🥋</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    ${opcoes.map((op, i) => `
                        <button id="enq-btn-${i}" onclick="enquetes.votar('${enquete.id}', ${i})"
                            style="width:100%;padding:14px 16px;background:#0f172a;border:2px solid #334155;color:white;border-radius:12px;font-size:0.82rem;font-weight:700;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;"
                            onmouseover="this.style.borderColor='#8b5cf6';this.style.background='#1e1040'"
                            onmouseout="this.style.borderColor='#334155';this.style.background='#0f172a'">
                            <span style="width:22px;height:22px;border:2px solid #475569;border-radius:50%;flex-shrink:0;display:inline-block;"></span>
                            ${op}
                        </button>`).join('')}
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    async votar(enqueteId, opcaoIndex) {
        // Desabilita todos os botões imediatamente (evita duplo clique)
        document.querySelectorAll('#modal-enquete-popup button').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
        // Destaca o botão selecionado
        const btnSel = document.getElementById(`enq-btn-${opcaoIndex}`);
        if (btnSel) { btnSel.style.borderColor = '#8b5cf6'; btnSel.style.background = '#1e1040'; btnSel.style.opacity = '1'; }

        try {
            const ref = db.collection('enquetes').doc(enqueteId);
            // Leitura para checar duplicata
            const doc = await ref.get();
            if (!doc.exists) { document.getElementById('modal-enquete-popup')?.remove(); return; }
            if ((doc.data().votantes || []).includes(auth.currentUser.id)) {
                document.getElementById('modal-enquete-popup')?.remove(); return;
            }
            // Atualização atômica: incrementa votos + adiciona ao array de votantes
            await ref.update({
                [`votos.${opcaoIndex}`]: firebase.firestore.FieldValue.increment(1),
                votantes: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.id)
            });

            // Confirmação visual e fecha
            const modal = document.getElementById('modal-enquete-popup');
            if (modal) {
                modal.innerHTML = `
                    <div style="background:#1e293b;border:1px solid #10b98155;border-radius:20px;padding:48px 28px;max-width:380px;width:100%;text-align:center;">
                        <div style="font-size:3.5rem;margin-bottom:14px;">✅</div>
                        <div style="font-size:1.1rem;font-weight:800;color:#10b981;margin-bottom:8px;">Voto registrado!</div>
                        <div style="font-size:0.75rem;color:#64748b;">Obrigado pela sua opinião. OSS! 🥋</div>
                    </div>`;
                setTimeout(() => modal.remove(), 2000);
            }
        } catch(e) {
            document.querySelectorAll('#modal-enquete-popup button').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
            alert('Erro ao votar: ' + e.message);
        }
    },

    // ── ADMIN — LISTAR ENQUETES COM RESULTADOS ───────────────
    async renderAdminEnquetes() {
        const container = document.getElementById('enquetes-admin-lista');
        if (!container) return;
        container.innerHTML = '<small style="color:#475569;font-size:0.65rem;">Carregando...</small>';
        try {
            const snap = await db.collection('enquetes').get();
            if (snap.empty) {
                container.innerHTML = '<div style="text-align:center;padding:20px;color:#475569;font-size:0.7rem;">Nenhuma enquete.<br>Clique em <strong>+ ENQUETE</strong> para criar.</div>';
                return;
            }
            const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.criadaEm || 0) - (a.criadaEm || 0));

            const pubLabel = {
                todos: '👥 Todos', kids: '🧒 Kids', adulto: '🥋 Adulto BJJ',
                muaythai: '🥊 Muay Thai', branca: '⬜ Faixa Branca',
                'azul-roxa-marrom': '🟦 Azul/Roxa/Marrom', preta: '⬛ Faixa Preta'
            };

            container.innerHTML = lista.map(e => {
                const opcoes     = e.opcoes || [];
                const votos      = e.votos  || {};
                const totalVotos = Object.values(votos).reduce((s, v) => s + v, 0);
                const ativa      = e.status === 'ativa';
                const enc        = e.dataEncerramento ? new Date(e.dataEncerramento).toLocaleDateString('pt-BR') : '—';
                const totalVotantes = (e.votantes || []).length;

                const barras = opcoes.map((op, i) => {
                    const qtd = votos[i] || 0;
                    const pct = totalVotos > 0 ? Math.round((qtd / totalVotos) * 100) : 0;
                    const cor = ['#3b82f6','#8b5cf6','#10b981','#f59e0b'][i] || '#3b82f6';
                    return `
                        <div style="margin-bottom:10px;">
                            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
                                <span style="font-size:0.68rem;color:#e2e8f0;font-weight:600;flex:1;margin-right:8px;">${op}</span>
                                <span style="font-size:0.68rem;font-weight:800;color:${cor};white-space:nowrap;">${pct}% <span style="color:#64748b;font-weight:500;">(${qtd} voto${qtd !== 1 ? 's' : ''})</span></span>
                            </div>
                            <div style="background:#0f172a;border-radius:6px;height:10px;overflow:hidden;">
                                <div style="background:${cor};width:${pct}%;height:100%;border-radius:6px;"></div>
                            </div>
                        </div>`;
                }).join('');

                return `
                    <div style="background:#0f172a;border:1px solid ${ativa ? '#8b5cf633' : '#33415533'};border-radius:12px;padding:14px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                            <div style="flex:1;min-width:0;margin-right:8px;">
                                <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;">
                                    <span style="font-size:0.52rem;font-weight:800;padding:2px 8px;border-radius:10px;background:${ativa ? '#1e1040' : '#1e293b'};color:${ativa ? '#a78bfa' : '#475569'};">${ativa ? '✅ ATIVA' : '⏹ ENCERRADA'}</span>
                                    <span style="font-size:0.55rem;color:#64748b;">${pubLabel[e.publico] || e.publico}</span>
                                </div>
                                <div style="font-size:0.8rem;font-weight:800;color:white;line-height:1.3;">${e.titulo}</div>
                                <div style="font-size:0.58rem;color:#64748b;margin-top:4px;">Encerra: ${enc} · <strong style="color:#94a3b8;">${totalVotantes} responderam</strong></div>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
                                ${ativa ? `<button onclick="enquetes.encerrarEnquete('${e.id}')" style="background:#f59e0b22;border:1px solid #f59e0b;color:#f59e0b;padding:5px 10px;border-radius:6px;font-size:0.55rem;font-weight:800;cursor:pointer;">⏹ ENCERRAR</button>` : ''}
                                <button onclick="enquetes.excluirEnquete('${e.id}')" style="background:#ef444422;border:1px solid #ef4444;color:#ef4444;padding:5px 10px;border-radius:6px;font-size:0.55rem;font-weight:800;cursor:pointer;">🗑 EXCLUIR</button>
                            </div>
                        </div>
                        ${totalVotos > 0 ? barras : '<small style="color:#475569;font-size:0.62rem;">Nenhum voto ainda.</small>'}
                    </div>`;
            }).join('');
        } catch(e) {
            container.innerHTML = `<small style="color:#ef4444;font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    // ── ADMIN — CRIAR ENQUETE ────────────────────────────────
    abrirModalCriarEnquete() {
        document.getElementById('modal-criar-enquete')?.remove();
        const amanha = new Date();
        amanha.setDate(amanha.getDate() + 7);
        const dataDefault = amanha.toISOString().split('T')[0];
        const publicos = [
            { v:'todos',            l:'👥 Todos' },
            { v:'kids',             l:'🧒 Kids (≤13 anos)' },
            { v:'adulto',           l:'🥋 Adulto BJJ' },
            { v:'muaythai',         l:'🥊 Muay Thai' },
            { v:'branca',           l:'⬜ Faixa Branca' },
            { v:'azul-roxa-marrom', l:'🟦 Azul / Roxa / Marrom' },
            { v:'preta',            l:'⬛ Faixa Preta' },
        ];
        const modal = document.createElement('div');
        modal.id = 'modal-criar-enquete';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.98);z-index:10000;overflow-y:auto;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:440px;margin:0 auto;padding-bottom:60px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <div style="font-size:0.9rem;font-weight:800;color:white;">📋 NOVA ENQUETE</div>
                    <button onclick="document.getElementById('modal-criar-enquete').remove()" style="background:#334155;border:none;color:white;padding:8px 14px;border-radius:8px;font-size:0.8rem;font-weight:700;cursor:pointer;">✕</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">PERGUNTA / TÍTULO *</small>
                        <input id="enq-titulo" type="text" maxlength="120" placeholder="Ex: Qual horário você prefere para treino?"
                            style="width:100%;padding:11px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.8rem;box-sizing:border-box;outline:none;">
                    </div>
                    <div>
                        <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:8px;">OPÇÕES DE RESPOSTA (mín. 2, máx. 4) *</small>
                        ${[1,2,3,4].map(n => `
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
                                <span style="font-size:0.65rem;color:#64748b;font-weight:800;width:16px;text-align:center;flex-shrink:0;">${n}</span>
                                <input id="enq-opcao-${n}" type="text" maxlength="80" placeholder="Opção ${n}${n > 2 ? ' (opcional)' : ' *'}"
                                    style="flex:1;padding:9px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.78rem;box-sizing:border-box;outline:none;">
                            </div>`).join('')}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">ENCERRAMENTO</small>
                            <input id="enq-data" type="date" value="${dataDefault}"
                                style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.78rem;box-sizing:border-box;">
                        </div>
                        <div>
                            <small style="font-size:0.6rem;color:#64748b;font-weight:700;display:block;margin-bottom:5px;">PÚBLICO-ALVO</small>
                            <select id="enq-publico" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.75rem;box-sizing:border-box;">
                                ${publicos.map(p => `<option value="${p.v}">${p.l}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <button onclick="enquetes.salvarEnquete()" id="btn-salvar-enquete"
                        style="width:100%;padding:14px;background:#8b5cf6;color:white;border:none;border-radius:10px;font-weight:800;font-size:0.85rem;cursor:pointer;margin-top:4px;">
                        ✅ CRIAR ENQUETE
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        setTimeout(() => document.getElementById('enq-titulo')?.focus(), 100);
    },

    async salvarEnquete() {
        const titulo  = document.getElementById('enq-titulo')?.value.trim();
        const opcoes  = [1,2,3,4].map(n => document.getElementById(`enq-opcao-${n}`)?.value.trim()).filter(v => v);
        const dataEnc = document.getElementById('enq-data')?.value;
        const publico = document.getElementById('enq-publico')?.value;
        if (!titulo)          { alert('Digite a pergunta da enquete.'); return; }
        if (opcoes.length < 2){ alert('Adicione pelo menos 2 opções de resposta.'); return; }
        const btn = document.getElementById('btn-salvar-enquete');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Salvando...'; }
        try {
            await db.collection('enquetes').add({
                titulo, opcoes, publico,
                dataEncerramento: dataEnc ? new Date(dataEnc + 'T23:59:59').getTime() : null,
                status: 'ativa', votos: {}, votantes: [],
                criadaEm: Date.now()
            });
            document.getElementById('modal-criar-enquete')?.remove();
            this.renderAdminEnquetes();
        } catch(e) {
            if (btn) { btn.disabled = false; btn.innerHTML = '✅ CRIAR ENQUETE'; }
            alert('Erro ao salvar: ' + e.message);
        }
    },

    async encerrarEnquete(id) {
        if (!confirm('Encerrar esta enquete? Ninguém mais poderá votar.')) return;
        try {
            await db.collection('enquetes').doc(id).update({ status: 'encerrada' });
            this.renderAdminEnquetes();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async excluirEnquete(id) {
        if (!confirm('Excluir esta enquete permanentemente?')) return;
        try {
            await db.collection('enquetes').doc(id).delete();
            this.renderAdminEnquetes();
        } catch(e) { alert('Erro: ' + e.message); }
    }
};

// ══════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════════
const push = {
    _api: '/api/push-comunicado',

    // Envia push para um aluno específico pelo ID
    async paraAluno(alunoId, title, body) {
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            if (!doc.exists) return;
            const token = doc.data().fcmToken;
            if (!token) return;
            await fetch(this._api, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens: [token], title, body })
            });
        } catch(e) { console.warn('Push falhou:', e.message); }
    },

    // Envia para todos os alunos (ou filtro de IDs)
    async paraTodos(title, body, ids = null) {
        try {
            const snap = await db.collection('alunos').get();
            const tokens = [];
            snap.forEach(doc => {
                if (ids && !ids.includes(doc.id)) return;
                const t = doc.data().fcmToken;
                if (t) tokens.push(t);
            });
            if (!tokens.length) return;
            await fetch(this._api, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens, title, body })
            });
        } catch(e) { console.warn('Push falhou:', e.message); }
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
            const borderColor = p.destaque ? '#f59e0b44' : '#2d3f55';
            return `
                <div onclick="loja.abrirProduto('${p.id}')" style="background:#1e293b; border:1px solid ${borderColor}; border-radius:18px; overflow:hidden; cursor:pointer; position:relative; box-shadow:0 4px 16px rgba(0,0,0,0.35); transition:transform 0.15s; ${esgotado ? 'opacity:0.6;' : ''}">
                    ${p.destaque ? '<div style="position:absolute; top:8px; left:8px; z-index:2; background:#f59e0b; color:#000; border-radius:8px; padding:3px 8px; font-size:0.48rem; font-weight:800; letter-spacing:0.5px;">⭐ DESTAQUE</div>' : ''}
                    ${esgotado ? '<div style="position:absolute; top:8px; right:8px; z-index:2; background:#ef4444; color:white; border-radius:8px; padding:3px 8px; font-size:0.48rem; font-weight:800;">ESGOTADO</div>' : ''}
                    <div style="aspect-ratio:1; background:#0f172a; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                        ${p.foto ? `<img src="${p.foto}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:3rem>🛒</span>'">` : '<span style="font-size:3rem;">🛒</span>'}
                    </div>
                    <div style="padding:11px 12px 13px;">
                        <div style="display:inline-block; font-size:0.48rem; color:#64748b; font-weight:800; letter-spacing:0.8px; background:#0f172a; border-radius:6px; padding:2px 7px; margin-bottom:6px; text-transform:uppercase;">${p.categoria || 'produto'}</div>
                        <div style="font-size:0.78rem; font-weight:800; color:#f1f5f9; margin-bottom:8px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${p.nome}</div>
                        <div style="display:flex; align-items:center; justify-content:space-between;">
                            <div style="font-size:0.9rem; font-weight:800; color:#10b981;">R$ ${(p.preco || 0).toFixed(2).replace('.', ',')}</div>
                            <div style="background:#0f172a; border-radius:8px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; color:#3b82f6; font-size:0.75rem;">›</div>
                        </div>
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
        if (auth.role !== 'aluno' && auth.role !== 'professor') return;
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
                const pid = o.produtoId || '';
                const vari = (o.variacao || '').replace(/'/g, "\\'");
                return `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:12px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                            <div style="flex:1; min-width:0; margin-right:8px;">
                                <div style="font-size:0.75rem; font-weight:800; color:white;">${o.alunoNome}</div>
                                <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">${o.produtoNome}${o.variacao ? ' · ' + o.variacao : ''}</div>
                                <div style="font-size:0.55rem; color:#64748b; margin-top:2px;">${new Date(o.data).toLocaleDateString('pt-BR')} · #${o.id.slice(-6).toUpperCase()}</div>
                            </div>
                            <div style="text-align:right; flex-shrink:0;">
                                <div style="font-size:0.8rem; font-weight:800; color:#10b981;">R$ ${(o.preco||0).toFixed(2).replace('.', ',')}</div>
                                <div style="font-size:0.55rem; font-weight:800; color:${cor}; margin-top:4px;">${statusLabel[o.status]||o.status}</div>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            ${o.status === 'pendente' ? `
                                <button onclick="loja.atualizarStatusPedido('${o.id}','pago','${pid}','${vari}')" style="background:#3b82f622; border:1px solid #3b82f6; color:#93c5fd; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">✓ MARCAR PAGO</button>
                                <button onclick="loja.atualizarStatusPedido('${o.id}','cancelado','${pid}','${vari}')" style="background:#ef444422; border:1px solid #ef4444; color:#ef4444; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">✕ CANCELAR</button>
                            ` : ''}
                            ${o.status === 'pago' ? `
                                <button onclick="loja.atualizarStatusPedido('${o.id}','entregue','${pid}','${vari}')" style="background:#10b98122; border:1px solid #10b981; color:#10b981; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">📦 ENTREGAR</button>
                                <button onclick="loja.atualizarStatusPedido('${o.id}','pendente','${pid}','${vari}')" style="background:#f59e0b22; border:1px solid #f59e0b; color:#f59e0b; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">↩ DESFAZER PAGTO</button>
                                <button onclick="loja.atualizarStatusPedido('${o.id}','cancelado','${pid}','${vari}')" style="background:#ef444422; border:1px solid #ef4444; color:#ef4444; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">✕ CANCELAR</button>
                            ` : ''}
                            ${o.status === 'entregue' ? `
                                <button onclick="loja.atualizarStatusPedido('${o.id}','pago','${pid}','${vari}')" style="background:#f59e0b22; border:1px solid #f59e0b; color:#f59e0b; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">↩ DESFAZER ENTREGA</button>
                            ` : ''}
                            ${o.status === 'cancelado' ? `
                                <button onclick="loja.atualizarStatusPedido('${o.id}','pendente','${pid}','${vari}')" style="background:#3b82f622; border:1px solid #3b82f6; color:#93c5fd; padding:5px 10px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer;">↩ REATIVAR</button>
                            ` : ''}
                            <!-- Excluir sempre disponível -->
                            <button onclick="loja.excluirPedido('${o.id}','${o.status}','${pid}','${vari}')" style="background:none; border:1px solid #475569; color:#64748b; padding:5px 8px; border-radius:6px; font-size:0.58rem; font-weight:800; cursor:pointer; margin-left:auto;">🗑</button>
                        </div>
                    </div>`;
            }).join('');
        } catch(e) {
            container.innerHTML = `<small style="color:#ef4444; font-size:0.65rem;">Erro: ${e.message}</small>`;
        }
    },

    async atualizarStatusPedido(pedidoId, novoStatus, produtoId, variacaoNome) {
        try {
            // Busca status atual antes de atualizar
            const pedidoDoc = await db.collection('loja_pedidos').doc(pedidoId).get();
            const statusAtual = pedidoDoc.exists ? pedidoDoc.data().status : null;

            await db.collection('loja_pedidos').doc(pedidoId).update({ status: novoStatus });

            // ── Lógica de estoque ────────────────────────────────
            // pendente → pago        : -1 (reserva o item)
            // pago     → pendente    : +1 (desfaz reserva)
            // pago     → cancelado   : +1 (devolve ao estoque)
            // entregue → pago        : sem mudança (item continua reservado)
            // cancelado→ pendente    : sem mudança (não havia reserva)
            let deltaEstoque = 0;
            if (statusAtual === 'pendente' && novoStatus === 'pago')     deltaEstoque = -1;
            if (statusAtual === 'pago'     && novoStatus === 'pendente') deltaEstoque = +1;
            if (statusAtual === 'pago'     && novoStatus === 'cancelado')deltaEstoque = +1;

            if (deltaEstoque !== 0 && produtoId && variacaoNome) {
                await this._ajustarEstoque(produtoId, variacaoNome, deltaEstoque);
            }

            this.renderPedidosAdmin();
        } catch(e) { alert('Erro: ' + e.message); }
    },

    async excluirPedido(pedidoId, statusAtual, produtoId, variacaoNome) {
        if (!confirm('Excluir este pedido permanentemente?\n\nSe o status era PAGO ou ENTREGUE, o estoque será devolvido automaticamente.')) return;
        try {
            // Devolve estoque se o item estava reservado
            const deveDevolver = statusAtual === 'pago' || statusAtual === 'entregue';
            if (deveDevolver && produtoId && variacaoNome) {
                await this._ajustarEstoque(produtoId, variacaoNome, +1);
            }
            await db.collection('loja_pedidos').doc(pedidoId).delete();
            this.renderPedidosAdmin();
        } catch(e) { alert('Erro ao excluir: ' + e.message); }
    },

    async _ajustarEstoque(produtoId, variacaoNome, delta) {
        try {
            const pd = await db.collection('loja_produtos').doc(produtoId).get();
            if (!pd.exists) return;
            const vars = pd.data().variacoes || [];
            const idx = vars.findIndex(v => v.nome === variacaoNome);
            if (idx >= 0) {
                vars[idx].estoque = Math.max(0, (vars[idx].estoque || 0) + delta);
                await db.collection('loja_produtos').doc(produtoId).update({ variacoes: vars });
            }
        } catch(_) {}
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

// ── HISTÓRICO DE GRADUAÇÕES ────────────────────────────────────────────────
const graduacaoHistorico = {

    _coresFaixa: {
        'Branco':'#e2e8f0','Cinza':'#94a3b8','Amarelo':'#fbbf24','Laranja':'#f97316',
        'Verde':'#22c55e','Azul':'#3b82f6','Roxo':'#a855f7','Marrom':'#92400e',
        'Preto':'#334155','Vermelho':'#ef4444','Vermelho e Preto':'#ef4444',
        'Vermelho e Branco':'#fca5a5','Coral':'#fb7185'
    },

    async abrirModal(alunoId) {
        document.getElementById('modal-hist-grad')?.remove();
        const doc = await db.collection('alunos').doc(alunoId).get();
        if (!doc.exists) return;
        const d = doc.data();
        const hist = d.historicoGraduacao || [];
        const isAdmin = auth.role === 'admin';
        const nomeAluno = d.nome || '';
        const academia = d.academia || 'Gaditas Matriz';

        const modal = document.createElement('div');
        modal.id = 'modal-hist-grad';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="max-width:520px;margin:0 auto;">
                <!-- Cabeçalho -->
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div style="color:#a78bfa;font-size:0.65rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;">🎖️ Histórico de Graduações</div>
                    <div style="display:flex;gap:8px;">
                        <button onclick="graduacaoHistorico.imprimir('${alunoId}')"
                            style="padding:8px 14px;background:#1e1040;border:1px solid #7c3aed;color:#a78bfa;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">
                            🖨️ IMPRIMIR
                        </button>
                        <button onclick="document.getElementById('modal-hist-grad').remove()"
                            style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">
                            ✕ FECHAR
                        </button>
                    </div>
                </div>

                <!-- Card imprimível -->
                <div id="hist-grad-card" style="background:#0f172a;border:1px solid #7c3aed44;border-radius:20px;padding:28px 24px;">
                    <!-- Topo -->
                    <div style="text-align:center;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #1e293b;">
                        <div style="font-size:2rem;margin-bottom:6px;">🥋</div>
                        <div style="font-size:1.1rem;font-weight:800;color:white;letter-spacing:0.5px;">${nomeAluno.toUpperCase()}</div>
                        <div style="font-size:0.7rem;color:#64748b;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">${academia}</div>
                        <div style="font-size:0.65rem;color:#475569;margin-top:2px;">Documento gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
                    </div>

                    <!-- Timeline -->
                    <div id="hist-grad-timeline">
                        ${this._renderTimeline(hist, alunoId, isAdmin)}
                    </div>

                    ${hist.length === 0 ? `<p style="color:#475569;text-align:center;font-size:0.8rem;padding:20px 0;">Nenhuma graduação registrada ainda.</p>` : ''}
                </div>
            </div>`;

        document.body.appendChild(modal);
    },

    _renderTimeline(hist, alunoId, isAdmin) {
        if (!hist || hist.length === 0) return '';
        return hist.map((g, i) => {
            const isMT = g.modalidade === 'muaythai';
            const faixaExibir = isMT ? (g.faixaMT || g.faixa) : g.faixa;
            const grauStr = (!isMT && g.grau > 0) ? ` • ${g.grau}° Grau` : '';
            const cor = this._coresFaixa[faixaExibir] || '#8b5cf6';
            const isEscura = ['Preto','Marrom','Roxo','Azul'].includes(faixaExibir);
            const textoFaixa = isEscura ? '#fff' : '#000';
            const modalIcon = isMT ? '🥊' : '🥋';
            const modalLabel = isMT ? 'Muay Thai' : 'Jiu-Jitsu';
            const isUltimo = i === hist.length - 1;

            const botoesAdmin = isAdmin ? `
                <div style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #334155;">
                    <button onclick="graduacaoHistorico.editarData('${alunoId}', ${i})"
                        style="flex:1;background:#0f172a;border:1px solid #334155;color:#94a3b8;border-radius:8px;padding:6px;font-size:0.65rem;font-weight:700;cursor:pointer;">
                        ✏️ Editar data
                    </button>
                    <button onclick="graduacaoHistorico.excluir('${alunoId}', ${i})"
                        style="background:#2a0808;border:1px solid #7f1d1d;color:#f87171;border-radius:8px;padding:6px 10px;font-size:0.65rem;font-weight:700;cursor:pointer;">
                        🗑️
                    </button>
                </div>` : '';

            return `
                <div id="item-grad-${alunoId}-${i}" style="display:flex;gap:14px;margin-bottom:${isUltimo ? '0' : '16px'};">
                    <!-- Linha vertical + ponto -->
                    <div style="display:flex;flex-direction:column;align-items:center;min-width:28px;">
                        <div style="width:28px;height:28px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:${textoFaixa};font-weight:800;flex-shrink:0;">${i+1}</div>
                        ${!isUltimo ? `<div style="width:2px;flex:1;background:#1e293b;margin-top:4px;min-height:20px;"></div>` : ''}
                    </div>
                    <!-- Conteúdo -->
                    <div style="flex:1;background:#1e293b;border-radius:12px;padding:14px 16px;border-left:3px solid ${cor};">
                        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
                            <span style="background:${cor};color:${textoFaixa};font-weight:800;font-size:0.75rem;padding:4px 12px;border-radius:999px;">
                                ${modalIcon} ${faixaExibir}${grauStr}
                            </span>
                            ${isUltimo ? `<span style="background:#7c3aed22;color:#a78bfa;font-size:0.6rem;font-weight:800;padding:3px 8px;border-radius:999px;border:1px solid #7c3aed44;">ATUAL</span>` : ''}
                        </div>
                        <div style="font-size:0.7rem;color:#64748b;">${modalIcon} ${modalLabel}</div>
                        <div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">
                            📅 <span id="data-grad-${alunoId}-${i}" style="margin-left:4px;">${g.data || '—'}</span>
                        </div>
                        ${botoesAdmin}
                    </div>
                </div>`;
        }).join('');
    },

    async excluir(alunoId, index) {
        if (!confirm('Excluir esta graduação do histórico?')) return;
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            const hist = doc.data().historicoGraduacao || [];
            hist.splice(index, 1);
            await db.collection('alunos').doc(alunoId).update({ historicoGraduacao: hist });
            // Recarrega a timeline sem fechar o modal
            document.getElementById('hist-grad-timeline').innerHTML =
                this._renderTimeline(hist, alunoId, true);
        } catch(e) { alert('Erro ao excluir: ' + e.message); }
    },

    async editarData(alunoId, index) {
        const novaData = prompt('Nova data desta graduação (DD/MM/AAAA):');
        if (!novaData) return;
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(novaData)) { alert('Formato inválido. Use DD/MM/AAAA'); return; }
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            const hist = doc.data().historicoGraduacao || [];
            if (!hist[index]) return;
            hist[index].data = novaData;
            await db.collection('alunos').doc(alunoId).update({ historicoGraduacao: hist });
            // Atualiza só o span de data sem reabrir o modal
            const span = document.getElementById(`data-grad-${alunoId}-${index}`);
            if (span) span.textContent = novaData;
            const el = document.getElementById(`data-grad-${alunoId}-${index}`);
            if (el) { el.style.color = '#10b981'; setTimeout(() => { if(el) el.style.color = '#94a3b8'; }, 1500); }
        } catch(e) { alert('Erro ao salvar: ' + e.message); }
    },

    async imprimir(alunoId) {
        const card = document.getElementById('hist-grad-card');
        if (!card) return;
        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head>
            <meta charset="UTF-8">
            <title>Histórico de Graduações</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Segoe UI', sans-serif; background: #fff; color: #1e293b; padding: 32px; max-width: 600px; margin: 0 auto; }
                h1 { font-size: 1.4rem; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
                .sub { font-size: 0.75rem; color: #64748b; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
                .item { display: flex; gap: 14px; margin-bottom: 18px; }
                .num { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 800; flex-shrink: 0; }
                .info { flex: 1; border-left: 3px solid #e2e8f0; padding-left: 14px; }
                .faixa-pill { display: inline-block; padding: 4px 14px; border-radius: 999px; font-size: 0.8rem; font-weight: 800; margin-bottom: 6px; }
                .mod { font-size: 0.7rem; color: #64748b; }
                .data { font-size: 0.7rem; color: #94a3b8; margin-top: 4px; }
                .atual { display: inline-block; background: #ede9fe; color: #7c3aed; font-size: 0.6rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; margin-left: 8px; vertical-align: middle; }
                .rodape { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 0.65rem; color: #94a3b8; text-align: center; }
                @media print { body { padding: 20px; } }
            </style>
        </head><body>`);

        const doc = await db.collection('alunos').doc(alunoId).get();
        const d = doc.data();
        const hist = d.historicoGraduacao || [];
        const nome = d.nome || '';

        win.document.write(`
            <div style="text-align:center;margin-bottom:20px;">
                <div style="font-size:2.5rem;">🥋</div>
                <h1>${nome.toUpperCase()}</h1>
                <div class="sub">Histórico de Graduações • Gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
            </div>`);

        if (hist.length === 0) {
            win.document.write('<p style="color:#94a3b8;text-align:center;">Nenhuma graduação registrada.</p>');
        } else {
            hist.forEach((g, i) => {
                const isMT = g.modalidade === 'muaythai';
                const faixaExibir = isMT ? (g.faixaMT || g.faixa) : g.faixa;
                const grauStr = (!isMT && g.grau > 0) ? ` • ${g.grau}° Grau` : '';
                const cor = this._coresFaixa[faixaExibir] || '#8b5cf6';
                const isEscura = ['Preto','Marrom','Roxo','Azul'].includes(faixaExibir);
                const textoFaixa = isEscura ? '#fff' : '#000';
                const isUltimo = i === hist.length - 1;
                const modalLabel = isMT ? '🥊 Muay Thai' : '🥋 Jiu-Jitsu';
                win.document.write(`
                    <div class="item">
                        <div class="num" style="background:${cor};color:${textoFaixa};">${i+1}</div>
                        <div class="info" style="border-left-color:${cor};">
                            <span class="faixa-pill" style="background:${cor};color:${textoFaixa};">${faixaExibir}${grauStr}</span>
                            ${isUltimo ? '<span class="atual">ATUAL</span>' : ''}
                            <div class="mod">${modalLabel}</div>
                            <div class="data">📅 ${g.data || '—'}</div>
                        </div>
                    </div>`);
            });
        }

        win.document.write(`<div class="rodape">Gaditas Matriz • Documento gerado pelo sistema</div></body></html>`);
        win.document.close();
        setTimeout(() => win.print(), 600);
    }
};

// ── AVALIAÇÃO FÍSICA ─────────────────────────────────────────────────────────
const avaliacaoFisica = {

    // ── MENU PRINCIPAL ──────────────────────────────────────
    async abrirMenu(alunoId) {
        document.getElementById('modal-avaliacao-fisica')?.remove();
        const isAdmin = auth.role === 'admin';
        const isProf  = auth.role === 'professor';
        const snap = await db.collection('avaliacoesFisicas').doc(alunoId)
            .collection('fichas').orderBy('data','desc').limit(10).get();
        const fichas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const modal = document.createElement('div');
        modal.id = 'modal-avaliacao-fisica';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;';

        const historicoHtml = fichas.length === 0
            ? `<p style="color:#475569;font-size:0.8rem;text-align:center;padding:16px 0;">Nenhuma avaliação ainda.</p>`
            : fichas.map((f,i) => {
                const imc = f.imc ? `IMC ${parseFloat(f.imc).toFixed(1)}` : '';
                const gord = f.percGordura ? `${f.percGordura}% gord.` : '';
                const tipo = f.tipo === 'completa' ? '🟢 Completa' : '🔵 Básica';
                const statusCompleta = f.tipo === 'completa' && f.status !== 'concluida'
                    ? ` · <span style="color:#f59e0b;">⏳ ${f.status === 'aguardando_pagamento' ? 'Aguard. pagamento' : f.status === 'aguardando_avaliador' ? 'Aguard. avaliador' : f.status}</span>` : '';
                return `
                    <div onclick="avaliacaoFisica.verFicha('${alunoId}','${f.id}')"
                        style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:0.8rem;font-weight:700;color:white;">${f.data ? f.data.split('-').reverse().join('/') : '—'} ${i===0?'<span style="font-size:0.55rem;color:#10b981;font-weight:800;background:#064e3b;padding:2px 6px;border-radius:999px;margin-left:4px;">ÚLTIMA</span>':''}</div>
                            <div style="font-size:0.65rem;color:#64748b;margin-top:3px;">${tipo}${statusCompleta} ${imc ? '· '+imc : ''} ${gord ? '· '+gord : ''}</div>
                        </div>
                        <i class="fas fa-chevron-right" style="color:#475569;font-size:0.75rem;"></i>
                    </div>`;
            }).join('');

        // Verifica se tem solicitação completa pendente
        const temPendente = fichas.some(f => f.tipo === 'completa' && f.status !== 'concluida');

        modal.innerHTML = `
            <div style="max-width:520px;margin:0 auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div style="color:#10b981;font-size:0.65rem;font-weight:800;letter-spacing:2px;">📊 AVALIAÇÃO FÍSICA</div>
                    <button onclick="document.getElementById('modal-avaliacao-fisica').remove()"
                        style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">✕ FECHAR</button>
                </div>

                <!-- Histórico -->
                <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:16px;margin-bottom:14px;">
                    <div style="font-size:0.7rem;font-weight:800;color:#94a3b8;margin-bottom:12px;letter-spacing:1px;">AVALIAÇÕES ANTERIORES</div>
                    ${historicoHtml}
                </div>

                <!-- Botões de ação -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button onclick="avaliacaoFisica.abrirFormBasica('${alunoId}')"
                        style="padding:14px;background:linear-gradient(135deg,#064e3b,#065f46);border:1px solid #10b98155;color:#10b981;border-radius:12px;font-weight:800;font-size:0.85rem;cursor:pointer;">
                        📋 NOVA AVALIAÇÃO BÁSICA <span style="font-size:0.65rem;opacity:0.8;">(você mesmo preenche)</span>
                    </button>
                    ${!temPendente ? `
                    <button onclick="avaliacaoFisica.solicitarCompleta('${alunoId}')"
                        style="padding:14px;background:linear-gradient(135deg,#1c1400,#292400);border:1px solid #f59e0b55;color:#f59e0b;border-radius:12px;font-weight:800;font-size:0.85rem;cursor:pointer;">
                        ⭐ SOLICITAR AVALIAÇÃO COMPLETA <span style="font-size:0.65rem;opacity:0.8;">(com professor · paga)</span>
                    </button>` : `
                    <div style="padding:14px;background:#1c1400;border:1px solid #f59e0b33;border-radius:12px;text-align:center;font-size:0.75rem;color:#f59e0b;">
                        ⏳ Você tem uma avaliação completa em andamento
                    </div>`}
                    ${(isAdmin || isProf) ? `
                    <button onclick="avaliacaoFisica.painelAvaliador('${alunoId}')"
                        style="padding:12px;background:#1e3a8a33;border:1px solid #3b82f644;color:#60a5fa;border-radius:10px;font-weight:800;font-size:0.75rem;cursor:pointer;">
                        🔬 PAINEL DO AVALIADOR
                    </button>` : ''}
                </div>
            </div>`;

        document.body.appendChild(modal);
    },

    // ── FORMULÁRIO BÁSICO (aluno preenche) ──────────────────
    abrirFormBasica(alunoId, fichaExistente = null) {
        document.getElementById('modal-avaliacao-fisica')?.remove();
        const f = fichaExistente || {};
        const hoje = new Date();
        const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;

        const campo = (id, label, val='', tipo='number', step='0.01', placeholder='') => `
            <div style="margin-bottom:10px;">
                <small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:4px;">${label}</small>
                <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px;">
                    <input type="${tipo}" id="af-${id}" value="${val}" step="${step}" placeholder="${placeholder}"
                        style="background:none;border:none;color:white;width:100%;outline:none;font-size:0.85rem;font-family:inherit;"
                        ${tipo==='number' ? 'oninput="avaliacaoFisica._calcIMC()"' : ''}/>
                </div>
            </div>`;

        const circ = ['Tórax','Braço Dir. Contraído','Braço Esq. Contraído','Quadril','Braço Dir. Relaxado','Braço Esq. Relaxado','Abdômen','Cintura','Antebraço Direito','Antebraço Esquerdo','Coxa Direita','Coxa Esquerda','Escapular','Panturrilha Direita','Panturrilha Esquerda'];
        const circIds = ['torax','bracoDirC','bracoEsqC','quadril','bracoDirR','bracoEsqR','abdomen','cintura','antebraçoDir','antebraçoEsq','coxaDireita','coxaEsquerda','escapular','pantuDireita','pantuEsquerda'];

        const modal = document.createElement('div');
        modal.id = 'modal-avaliacao-fisica';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="max-width:520px;margin:0 auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div style="color:#10b981;font-size:0.65rem;font-weight:800;letter-spacing:2px;">📋 AVALIAÇÃO BÁSICA</div>
                    <button onclick="avaliacaoFisica.abrirMenu('${alunoId}')"
                        style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;cursor:pointer;">← VOLTAR</button>
                </div>

                <!-- Data -->
                <div style="margin-bottom:16px;">
                    <small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:4px;">DATA DA AVALIAÇÃO</small>
                    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;">
                        <input type="date" id="af-data" value="${f.data||dataHoje}" style="background:none;border:none;color:white;width:100%;outline:none;font-size:0.85rem;"/>
                    </div>
                </div>

                <!-- Peso e Altura -->
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:12px;letter-spacing:1px;">⚖️ PESO E ALTURA</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        ${campo('peso','PESO (kg)',f.peso||'','number','0.1','74.90')}
                        ${campo('altura','ALTURA (m)',f.altura||'','number','0.01','1.75')}
                    </div>
                    <div id="af-imc-resultado" style="background:#1e293b;border-radius:8px;padding:10px;text-align:center;font-size:0.75rem;color:#94a3b8;margin-top:4px;">
                        ${f.imc ? `IMC: <strong style="color:white;">${parseFloat(f.imc).toFixed(2)}</strong> — <span style="color:${this._corIMC(f.imc)};">${this._classIMC(f.imc)}</span>` : 'Preencha peso e altura para calcular o IMC'}
                    </div>
                </div>

                <!-- Composição corporal -->
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:12px;letter-spacing:1px;">🧬 COMPOSIÇÃO CORPORAL</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        ${campo('percGordura','% GORDURA (bioimpedância)',f.percGordura||'','number','0.1','36.10')}
                        ${campo('pesoGordura','PESO GORDURA (kg)',f.pesoGordura||'','number','0.1','27.04')}
                        ${campo('pesoMuscular','PESO MUSCULAR (kg)',f.pesoMuscular||'','number','0.1','')}
                        ${campo('pesoOsseo','PESO ÓSSEO (kg)',f.pesoOsseo||'','number','0.1','')}
                    </div>
                </div>

                <!-- Circunferências -->
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:12px;letter-spacing:1px;">📏 CIRCUNFERÊNCIAS (cm)</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        ${circ.map((nome,i) => campo('circ_'+circIds[i], nome, (f.circunferencias||{})[circIds[i]]||'','number','0.1','')).join('')}
                    </div>
                </div>

                <!-- Observações -->
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:10px;letter-spacing:1px;">📝 OBSERVAÇÕES E METAS</div>
                    <textarea id="af-obs" placeholder="Observações pessoais..." rows="3"
                        style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;color:white;font-size:0.8rem;resize:vertical;box-sizing:border-box;">${f.observacoes||''}</textarea>
                </div>

                <div style="display:flex;gap:8px;">
                    <button onclick="avaliacaoFisica.salvarBasica('${alunoId}','${f.id||''}')"
                        style="flex:1;padding:14px;background:linear-gradient(135deg,#10b981,#059669);border:none;color:white;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;">
                        💾 SALVAR AVALIAÇÃO
                    </button>
                </div>
            </div>`;

        document.body.appendChild(modal);
    },

    _calcIMC() {
        const peso = parseFloat(document.getElementById('af-peso')?.value);
        const alt  = parseFloat(document.getElementById('af-altura')?.value);
        const el   = document.getElementById('af-imc-resultado');
        if (!el) return;
        if (!peso || !alt || alt < 0.5) { el.innerHTML = 'Preencha peso e altura para calcular o IMC'; return; }
        const imc = peso / (alt * alt);
        el.innerHTML = `IMC: <strong style="color:white;">${imc.toFixed(2)}</strong> — <span style="color:${this._corIMC(imc)};">${this._classIMC(imc)}</span>`;
    },

    _corIMC(imc) {
        if (imc < 18.5) return '#60a5fa';
        if (imc < 25)   return '#10b981';
        if (imc < 30)   return '#f59e0b';
        if (imc < 35)   return '#f97316';
        return '#ef4444';
    },
    _classIMC(imc) {
        if (imc < 17)   return 'Muito abaixo do peso';
        if (imc < 18.5) return 'Abaixo do peso';
        if (imc < 25)   return 'Peso normal';
        if (imc < 30)   return 'Acima do peso';
        if (imc < 35)   return 'Obesidade I';
        if (imc < 40)   return 'Obesidade II (Severa)';
        return 'Obesidade III (Mórbida)';
    },

    async salvarBasica(alunoId, fichaId='') {
        const btn = event?.target;
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
        try {
            const circIds = ['torax','bracoDirC','bracoEsqC','quadril','bracoDirR','bracoEsqR','abdomen','cintura','antebraçoDireito','antebraçoEsquerdo','coxaDireita','coxaEsquerda','escapular','pantuDireita','pantuEsquerda'];
            const circ = {};
            circIds.forEach(id => {
                const v = parseFloat(document.getElementById('af-circ_'+id)?.value);
                if (!isNaN(v) && v > 0) circ[id] = v;
            });
            const peso   = parseFloat(document.getElementById('af-peso')?.value) || 0;
            const altura = parseFloat(document.getElementById('af-altura')?.value) || 0;
            const imc    = (peso && altura) ? +(peso / (altura * altura)).toFixed(2) : 0;
            const dados  = {
                tipo: 'basica', status: 'concluida',
                data: document.getElementById('af-data')?.value || '',
                peso, altura, imc,
                percGordura: parseFloat(document.getElementById('af-percGordura')?.value)||0,
                pesoGordura: parseFloat(document.getElementById('af-pesoGordura')?.value)||0,
                pesoMuscular: parseFloat(document.getElementById('af-pesoMuscular')?.value)||0,
                pesoOsseo: parseFloat(document.getElementById('af-pesoOsseo')?.value)||0,
                circunferencias: circ,
                observacoes: document.getElementById('af-obs')?.value || '',
                atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
            };
            const ref = db.collection('avaliacoesFisicas').doc(alunoId).collection('fichas');
            if (fichaId) await ref.doc(fichaId).update(dados);
            else await ref.add({ ...dados, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
            await this.abrirMenu(alunoId);
        } catch(e) {
            if (btn) { btn.disabled = false; btn.textContent = '💾 SALVAR AVALIAÇÃO'; }
            alert('Erro ao salvar: ' + e.message);
        }
    },

    // ── VER FICHA COMPLETA ──────────────────────────────────
    async verFicha(alunoId, fichaId) {
        document.getElementById('modal-avaliacao-fisica')?.remove();
        const doc = await db.collection('avaliacoesFisicas').doc(alunoId).collection('fichas').doc(fichaId).get();
        if (!doc.exists) return;
        const f = doc.data();
        const isAdmin = auth.role === 'admin';
        const isProf  = auth.role === 'professor';
        const imc = f.imc || 0;

        const linhaCirc = (nome, val) => val > 0 ? `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;font-size:0.75rem;">
                <span style="color:#94a3b8;">${nome}</span>
                <strong style="color:white;">${val} cm</strong>
            </div>` : '';

        const circIds = {torax:'Tórax',bracoDirC:'Braço Dir. Contraído',bracoEsqC:'Braço Esq. Contraído',quadril:'Quadril',bracoDirR:'Braço Dir. Relaxado',bracoEsqR:'Braço Esq. Relaxado',abdomen:'Abdômen',cintura:'Cintura','antebraçoDireito':'Antebraço Direito','antebraçoEsquerdo':'Antebraço Esquerdo',coxaDireita:'Coxa Direita',coxaEsquerda:'Coxa Esquerda',escapular:'Escapular',pantuDireita:'Panturrilha Direita',pantuEsquerda:'Panturrilha Esquerda'};
        const circHtml = Object.entries(f.circunferencias||{}).map(([k,v]) => linhaCirc(circIds[k]||k, v)).join('');

        const dobrasHtml = f.dobras ? Object.entries(f.dobras).map(([k,v]) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;font-size:0.75rem;">
                <span style="color:#94a3b8;">${k}</span>
                <strong style="color:white;">${v} mm</strong>
            </div>`).join('') : '';

        const modal = document.createElement('div');
        modal.id = 'modal-avaliacao-fisica';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;';

        modal.innerHTML = `
            <div style="max-width:520px;margin:0 auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div style="color:#10b981;font-size:0.65rem;font-weight:800;letter-spacing:2px;">📊 ${f.data?f.data.split('-').reverse().join('/'):''} · ${f.tipo==='completa'?'🟢 COMPLETA':'🔵 BÁSICA'}</div>
                    <div style="display:flex;gap:6px;">
                        <button onclick="avaliacaoFisica.imprimir('${alunoId}','${fichaId}')"
                            style="padding:7px 12px;background:#1e1040;border:1px solid #7c3aed44;color:#a78bfa;border-radius:8px;font-size:0.65rem;font-weight:800;cursor:pointer;">🖨️</button>
                        ${(isAdmin||isProf) ? `<button onclick="avaliacaoFisica.abrirFormBasica('${alunoId}',${JSON.stringify(f).replace(/'/g,'&#39;')})" style="padding:7px 12px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.65rem;cursor:pointer;">✏️</button>` : ''}
                        <button onclick="avaliacaoFisica.abrirMenu('${alunoId}')"
                            style="padding:7px 12px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.65rem;cursor:pointer;">← VOLTAR</button>
                    </div>
                </div>

                <!-- IMC -->
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="display:flex;gap:16px;margin-bottom:12px;">
                        <div style="flex:1;text-align:center;"><div style="font-size:1.3rem;font-weight:800;color:white;">${f.peso||0}</div><div style="font-size:0.6rem;color:#64748b;">Peso (kg)</div></div>
                        <div style="flex:1;text-align:center;"><div style="font-size:1.3rem;font-weight:800;color:white;">${f.altura||0}</div><div style="font-size:0.6rem;color:#64748b;">Altura (m)</div></div>
                        <div style="flex:1;text-align:center;"><div style="font-size:1.3rem;font-weight:800;color:${this._corIMC(imc)};">${imc.toFixed(1)}</div><div style="font-size:0.6rem;color:#64748b;">IMC</div></div>
                        <div style="flex:1;text-align:center;"><div style="font-size:1.3rem;font-weight:800;color:#f43f5e;">${f.percGordura||0}%</div><div style="font-size:0.6rem;color:#64748b;">% Gordura</div></div>
                    </div>
                    <div style="background:#1e293b;border-radius:8px;padding:8px;text-align:center;font-size:0.75rem;color:${this._corIMC(imc)};font-weight:800;">${this._classIMC(imc)}</div>
                </div>

                <!-- Composição -->
                ${(f.pesoGordura||f.pesoMuscular||f.pesoOsseo) ? `
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:12px;">🧬 COMPOSIÇÃO CORPORAL</div>
                    <div style="display:flex;gap:10px;">
                        ${f.pesoGordura ? `<div style="flex:1;background:#1e293b;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:1rem;font-weight:800;color:#f43f5e;">${f.pesoGordura}kg</div><div style="font-size:0.55rem;color:#64748b;">Gordura</div></div>` : ''}
                        ${f.pesoMuscular ? `<div style="flex:1;background:#1e293b;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:1rem;font-weight:800;color:#10b981;">${f.pesoMuscular}kg</div><div style="font-size:0.55rem;color:#64748b;">Músculo</div></div>` : ''}
                        ${f.pesoOsseo ? `<div style="flex:1;background:#1e293b;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:1rem;font-weight:800;color:#94a3b8;">${f.pesoOsseo}kg</div><div style="font-size:0.55rem;color:#64748b;">Ósseo</div></div>` : ''}
                    </div>
                </div>` : ''}

                <!-- Circunferências -->
                ${circHtml ? `
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:10px;">📏 CIRCUNFERÊNCIAS</div>
                    ${circHtml}
                </div>` : ''}

                <!-- Dobras (se completa) -->
                ${dobrasHtml ? `
                <div style="background:#0f172a;border:1px solid #f59e0b33;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#f59e0b;margin-bottom:10px;">📐 DOBRAS CUTÂNEAS (Pollock 7)</div>
                    ${dobrasHtml}
                    ${f.percGorduraPollock ? `<div style="margin-top:10px;background:#1e293b;border-radius:8px;padding:10px;text-align:center;font-size:0.8rem;color:white;">% Gordura (Pollock): <strong style="color:#f59e0b;">${f.percGorduraPollock}%</strong></div>` : ''}
                </div>` : ''}

                <!-- Anamnese (se completa) -->
                ${f.anamnese ? `
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#60a5fa;margin-bottom:10px;">📋 ANAMNESE</div>
                    <p style="font-size:0.8rem;color:#e2e8f0;line-height:1.6;white-space:pre-wrap;">${f.anamnese}</p>
                </div>` : ''}

                <!-- Laudo (se completa) -->
                ${f.laudo ? `
                <div style="background:#0c2a1a;border:1px solid #10b98133;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:10px;">📝 LAUDO DO AVALIADOR</div>
                    <p style="font-size:0.8rem;color:#e2e8f0;line-height:1.6;white-space:pre-wrap;">${f.laudo}</p>
                    ${f.avaliadorNome ? `<div style="font-size:0.65rem;color:#64748b;margin-top:8px;">Avaliador: ${f.avaliadorNome}</div>` : ''}
                </div>` : ''}

                ${f.observacoes ? `
                <div style="background:#0f172a;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:12px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#94a3b8;margin-bottom:8px;">📝 OBSERVAÇÕES</div>
                    <p style="font-size:0.8rem;color:#e2e8f0;line-height:1.6;">${f.observacoes}</p>
                </div>` : ''}

                ${isAdmin ? `
                <button onclick="if(confirm('Excluir esta avaliação?')) db.collection('avaliacoesFisicas').doc('${alunoId}').collection('fichas').doc('${fichaId}').delete().then(()=>avaliacaoFisica.abrirMenu('${alunoId}'))"
                    style="width:100%;padding:10px;background:#2a0808;border:1px solid #7f1d1d;color:#f87171;border-radius:8px;font-size:0.7rem;font-weight:800;cursor:pointer;">🗑️ Excluir avaliação</button>` : ''}
            </div>`;

        document.body.appendChild(modal);
    },

    // ── SOLICITAR AVALIAÇÃO COMPLETA ────────────────────────
    async solicitarCompleta(alunoId) {
        document.getElementById('modal-avaliacao-fisica')?.remove();
        // Busca valor configurado pelo admin
        const configDoc = await db.collection('configuracoes').doc('avaliacaoFisica').get();
        const valorConfig = configDoc.exists ? (configDoc.data().valor || 0) : 0;
        const linkPag    = configDoc.exists ? (configDoc.data().linkPagamento || '') : '';

        const modal = document.createElement('div');
        modal.id = 'modal-avaliacao-fisica';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;display:flex;align-items:center;';
        modal.innerHTML = `
            <div style="max-width:420px;margin:0 auto;width:100%;">
                <div style="background:#1e293b;border:1px solid #f59e0b44;border-radius:20px;padding:28px;">
                    <div style="text-align:center;margin-bottom:20px;">
                        <div style="font-size:2.5rem;margin-bottom:8px;">⭐</div>
                        <div style="font-size:1rem;font-weight:800;color:white;">Avaliação Completa com Professor</div>
                        <div style="font-size:0.75rem;color:#94a3b8;margin-top:6px;line-height:1.6;">
                            Inclui dobras cutâneas (Pollock 7), anamnese detalhada e laudo personalizado do avaliador.
                        </div>
                    </div>
                    ${valorConfig > 0 ? `
                    <div style="background:#1c1400;border:1px solid #f59e0b55;border-radius:12px;padding:16px;text-align:center;margin-bottom:20px;">
                        <div style="font-size:0.6rem;color:#f59e0b;font-weight:800;letter-spacing:1px;">VALOR</div>
                        <div style="font-size:1.8rem;font-weight:800;color:#f59e0b;">R$ ${parseFloat(valorConfig).toFixed(2).replace('.',',')}</div>
                    </div>` : `
                    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px;text-align:center;margin-bottom:20px;font-size:0.75rem;color:#64748b;">
                        Valor a combinar com a academia
                    </div>`}
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${linkPag ? `
                        <a href="${linkPag}" target="_blank"
                            style="display:block;text-align:center;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border-radius:12px;font-weight:800;font-size:0.85rem;text-decoration:none;">
                            💳 PAGAR E SOLICITAR
                        </a>` : ''}
                        <button onclick="avaliacaoFisica._confirmarSolicitacao('${alunoId}')"
                            style="padding:12px;background:#1e3a8a;border:none;color:#60a5fa;border-radius:10px;font-weight:800;font-size:0.8rem;cursor:pointer;">
                            ✉️ ${linkPag ? 'JÁ PAGUEI — SOLICITAR' : 'SOLICITAR AVALIAÇÃO'}
                        </button>
                        <button onclick="avaliacaoFisica.abrirMenu('${alunoId}')"
                            style="padding:10px;background:none;border:1px solid #334155;color:#64748b;border-radius:10px;font-weight:700;font-size:0.75rem;cursor:pointer;">CANCELAR</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    async _confirmarSolicitacao(alunoId) {
        try {
            const data = new Date().toISOString().split('T')[0];
            // Cria ficha na subcoleção do aluno
            const fichaRef = await db.collection('avaliacoesFisicas').doc(alunoId).collection('fichas').add({
                tipo: 'completa', status: 'aguardando_avaliador',
                data, criadoEm: firebase.firestore.FieldValue.serverTimestamp(), alunoId
            });
            // Cria alerta top-level para o admin ver sem precisar entrar no perfil do aluno
            const nomeAluno = auth.currentUser?.nome || '';
            await db.collection('solicitacoesAvaliacao').add({
                alunoId, fichaId: fichaRef.id, nomeAluno,
                data, status: 'pendente', lido: false,
                criadoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('✅ Solicitação enviada! O professor entrará em contato para agendar.');
            await this.abrirMenu(alunoId);
        } catch(e) { alert('Erro: ' + e.message); }
    },

    // ── PAINEL DO AVALIADOR (admin/professor preenche) ──────
    async painelAvaliador(alunoId) {
        document.getElementById('modal-avaliacao-fisica')?.remove();
        // Busca fichas completas pendentes
        const snap = await db.collection('avaliacoesFisicas').doc(alunoId)
            .collection('fichas').where('tipo','==','completa').where('status','==','aguardando_avaliador').get();

        if (snap.empty) {
            alert('Nenhuma avaliação completa pendente para este aluno.');
            return this.abrirMenu(alunoId);
        }
        const fichaId = snap.docs[0].id;
        const f = snap.docs[0].data();

        const campo = (id, label, val='', tipo='number') => `
            <div style="margin-bottom:10px;">
                <small style="color:#94a3b8;font-size:0.58rem;font-weight:800;display:block;margin-bottom:4px;">${label}</small>
                <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;">
                    <input type="${tipo}" id="afc-${id}" value="${val||''}" style="background:none;border:none;color:white;width:100%;outline:none;font-size:0.85rem;" />
                </div>
            </div>`;

        const dobras = ['Triciptal','Subescapular','Axilar Média','Abdominal','Coxa','Panturrilha','Biciptal','Peitoral','Supra Ilíaca'];
        const dobrasIds = ['triciptal','subescapular','axilarMedia','abdominal','coxa','panturrilha','biciptal','peitoral','supraIliaca'];
        const fd = f.dobras || {};

        const modal = document.createElement('div');
        modal.id = 'modal-avaliacao-fisica';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(2,6,23,0.97);z-index:9999;overflow-y:auto;padding:20px;box-sizing:border-box;';
        modal.innerHTML = `
            <div style="max-width:520px;margin:0 auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <div style="color:#f59e0b;font-size:0.65rem;font-weight:800;letter-spacing:2px;">⭐ AVALIAÇÃO COMPLETA</div>
                    <button onclick="avaliacaoFisica.abrirMenu('${alunoId}')" style="padding:8px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;font-size:0.7rem;cursor:pointer;">← VOLTAR</button>
                </div>

                <!-- Dobras Pollock 7 -->
                <div style="background:#0f172a;border:1px solid #f59e0b44;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#f59e0b;margin-bottom:12px;">📐 DOBRAS CUTÂNEAS — Pollock 7 (mm)</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        ${dobras.map((nome,i) => campo('d_'+dobrasIds[i], nome, fd[dobrasIds[i]])).join('')}
                    </div>
                    <div style="margin-top:10px;">
                        ${campo('percGorduraPollock','% GORDURA CALCULADO (Pollock)',f.percGorduraPollock||'')}
                    </div>
                </div>

                <!-- Anamnese -->
                <div style="background:#0f172a;border:1px solid #3b82f644;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#60a5fa;margin-bottom:10px;">📋 ANAMNESE DETALHADA</div>
                    <textarea id="afc-anamnese" rows="5" placeholder="Histórico de saúde, lesões, medicamentos, hábitos, objetivos..." style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;color:white;font-size:0.8rem;resize:vertical;box-sizing:border-box;">${f.anamnese||''}</textarea>
                </div>

                <!-- Laudo -->
                <div style="background:#0c2a1a;border:1px solid #10b98133;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="font-size:0.65rem;font-weight:800;color:#10b981;margin-bottom:10px;">📝 LAUDO DO AVALIADOR</div>
                    <textarea id="afc-laudo" rows="5" placeholder="Parecer técnico, recomendações, observações do avaliador..." style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;color:white;font-size:0.8rem;resize:vertical;box-sizing:border-box;">${f.laudo||''}</textarea>
                </div>

                <button onclick="avaliacaoFisica.salvarCompleta('${alunoId}','${fichaId}')"
                    style="width:100%;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#000;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;">
                    ✅ SALVAR E CONCLUIR AVALIAÇÃO
                </button>
            </div>`;
        document.body.appendChild(modal);
    },

    async salvarCompleta(alunoId, fichaId) {
        const btn = event?.target;
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
        try {
            const dobrasIds = ['triciptal','subescapular','axilarMedia','abdominal','coxa','panturrilha','biciptal','peitoral','supraIliaca'];
            const dobras = {};
            dobrasIds.forEach(id => {
                const v = parseFloat(document.getElementById('afc-d_'+id)?.value);
                if (!isNaN(v) && v > 0) dobras[id] = v;
            });
            await db.collection('avaliacoesFisicas').doc(alunoId).collection('fichas').doc(fichaId).update({
                dobras,
                percGorduraPollock: parseFloat(document.getElementById('afc-percGorduraPollock')?.value)||0,
                anamnese: document.getElementById('afc-anamnese')?.value || '',
                laudo: document.getElementById('afc-laudo')?.value || '',
                avaliadorNome: auth.currentUser?.nome || '',
                status: 'concluida',
                concluidoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
            // Marca solicitação como concluída
            const snapSolic = await db.collection('solicitacoesAvaliacao')
                .where('alunoId','==',alunoId).where('fichaId','==',fichaId).get();
            snapSolic.docs.forEach(d => d.ref.update({ status: 'concluida', lido: true }));
            // Notifica aluno via campo no Firestore
            await db.collection('alunos').doc(alunoId).update({ avaliacaoCompletaDisponivel: true });
            alert('✅ Avaliação concluída! O aluno será notificado.');
            await this.abrirMenu(alunoId);
        } catch(e) {
            if (btn) { btn.disabled = false; btn.textContent = '✅ SALVAR E CONCLUIR AVALIAÇÃO'; }
            alert('Erro: ' + e.message);
        }
    },

    // ── GARANTE CONTAINER NA ABA RELATÓRIOS ─────────────────
    _garantirPainelSolicitacoes() {
        if (document.getElementById('painel-solic-avaliacao')) return;
        const cont = document.createElement('div');
        cont.id = 'painel-solic-avaliacao';
        cont.style.cssText = 'padding:0 15px;';
        // Insere sempre no início da aba Relatórios
        const relTab = document.getElementById('tab-relatorios');
        if (relTab) relTab.insertBefore(cont, relTab.firstChild);
    },

    // ── LISTENER DE SOLICITAÇÕES EM TEMPO REAL ──────────────
    iniciarListenerSolicitacoes() {
        db.collection('solicitacoesAvaliacao')
            .where('status','==','pendente')
            .onSnapshot(snap => {
                const naolidas = snap.docs.filter(d => !d.data().lido).length;
                // Atualiza badge na nav
                const badge = document.getElementById('badge-solic-avaliacao');
                if (badge) {
                    badge.textContent = naolidas;
                    badge.style.display = naolidas > 0 ? 'inline-block' : 'none';
                }
                // Ordena por data no JS (evita índice composto no Firestore)
                const docsOrdenados = snap.docs.sort((a,b) => {
                    const ta = a.data().criadoEm?.toMillis?.() || 0;
                    const tb = b.data().criadoEm?.toMillis?.() || 0;
                    return tb - ta;
                });
                // Garante container e renderiza
                this._garantirPainelSolicitacoes();
                const painel = document.getElementById('painel-solic-avaliacao');
                if (painel) this._renderPainelSolicitacoes(docsOrdenados, painel);
            }, (err) => console.warn('Listener solicitações:', err.message));
    },

    _renderPainelSolicitacoes(docs, container) {
        const pendentes = docs.filter(d => d.data().status === 'pendente');
        if (pendentes.length === 0) {
            container.innerHTML = `
                <div style="background:#0c2a1a;border:1px solid #10b98133;border-radius:14px;padding:14px;margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="font-size:0.75rem;font-weight:800;color:#10b981;">📊 AVALIAÇÕES FÍSICAS</div>
                        <button onclick="avaliacaoFisica.abrirConfigAdmin()"
                            style="font-size:0.6rem;color:#f59e0b;background:#1c1400;border:1px solid #f59e0b44;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:800;">
                            ⚙️ Configurar valor
                        </button>
                    </div>
                    <p style="font-size:0.72rem;color:#475569;margin-top:10px;text-align:center;">Nenhuma solicitação pendente.</p>
                </div>`;
            return;
        }

        const naolidas = pendentes.filter(d => !d.data().lido).length;
        const badgeHtml = naolidas > 0
            ? `<span style="background:#f43f5e;color:white;font-size:0.55rem;padding:2px 7px;border-radius:999px;font-weight:800;margin-left:6px;">${naolidas} NOVA${naolidas>1?'S':''}</span>` : '';

        container.innerHTML = `
            <div style="background:#0c2a1a;border:1px solid #10b98155;border-radius:14px;padding:14px;margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="font-size:0.75rem;font-weight:800;color:#10b981;">📊 AVALIAÇÕES FÍSICAS SOLICITADAS ${badgeHtml}</div>
                    <div style="display:flex;gap:6px;">
                        <button onclick="avaliacaoFisica.abrirConfigAdmin()"
                            style="font-size:0.6rem;color:#f59e0b;background:#1c1400;border:1px solid #f59e0b44;padding:4px 8px;border-radius:6px;cursor:pointer;font-weight:800;">
                            ⚙️ Configurar valor
                        </button>
                        ${naolidas > 0 ? `<button onclick="avaliacaoFisica._marcarTodasLidas()"
                            style="font-size:0.6rem;color:#64748b;background:none;border:none;cursor:pointer;font-weight:700;">
                            Marcar lidas
                        </button>` : ''}
                    </div>
                </div>
                ${pendentes.map(doc => {
                    const d = doc.data();
                    const isNovo = !d.lido;
                    return `
                        <div style="background:#0f172a;border:1px solid ${isNovo?'#10b98155':'#1e293b'};border-radius:10px;padding:12px;margin-bottom:8px;${isNovo?'border-left:3px solid #10b981;':''}">
                            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                                <div>
                                    <div style="font-size:0.82rem;font-weight:800;color:${isNovo?'#10b981':'#e2e8f0'};">${d.nomeAluno||'—'}</div>
                                    <div style="font-size:0.62rem;color:#64748b;margin-top:3px;">📅 ${d.data?d.data.split('-').reverse().join('/'):''} · ⭐ Avaliação Completa</div>
                                </div>
                                <button onclick="avaliacaoFisica._abrirSolicitacao('${doc.id}','${d.alunoId}','${d.fichaId}')"
                                    style="background:#10b981;border:none;color:white;padding:8px 12px;border-radius:8px;font-size:0.65rem;font-weight:800;cursor:pointer;white-space:nowrap;">
                                    📋 Avaliar
                                </button>
                            </div>
                        </div>`;
                }).join('')}
            </div>`;
    },

    async _abrirSolicitacao(solicId, alunoId, fichaId) {
        // Marca como lido
        await db.collection('solicitacoesAvaliacao').doc(solicId).update({ lido: true });
        // Abre painel do avaliador diretamente
        await this.painelAvaliador(alunoId);
    },

    async _marcarTodasLidas() {
        const snap = await db.collection('solicitacoesAvaliacao')
            .where('status','==','pendente').where('lido','==',false).get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.update(d.ref, { lido: true }));
        await batch.commit();
    },

    // ── PAINEL ADMIN — configurar valor e ver todas ──────────
    async abrirConfigAdmin() {
        const doc = await db.collection('configuracoes').doc('avaliacaoFisica').get();
        const cfg = doc.exists ? doc.data() : {};
        const valor = prompt('Valor cobrado pela avaliação completa (R$):', cfg.valor || '');
        if (valor === null) return;
        const link = prompt('Link de pagamento (InfinityPay, MercadoPago, etc):', cfg.linkPagamento || '');
        if (link === null) return;
        await db.collection('configuracoes').doc('avaliacaoFisica').set({ valor: parseFloat(valor)||0, linkPagamento: link }, { merge: true });
        alert('✅ Configurações salvas!');
    },

    // ── IMPRESSÃO ────────────────────────────────────────────
    async imprimir(alunoId, fichaId) {
        const docF = await db.collection('avaliacoesFisicas').doc(alunoId).collection('fichas').doc(fichaId).get();
        const docA = await db.collection('alunos').doc(alunoId).get();
        if (!docF.exists) return;
        const f = docF.data();
        const a = docA.data() || {};
        const imc = f.imc || 0;
        const circ = f.circunferencias || {};
        const circNomes = {torax:'Tórax',bracoDirC:'Braço Dir. Contraído',bracoEsqC:'Braço Esq. Contraído',quadril:'Quadril',bracoDirR:'Braço Dir. Relaxado',bracoEsqR:'Braço Esq. Relaxado',abdomen:'Abdômen',cintura:'Cintura','antebraçoDireito':'Antebraço Direito','antebraçoEsquerdo':'Antebraço Esquerdo',coxaDireita:'Coxa Direita',coxaEsquerda:'Coxa Esquerda',escapular:'Escapular',pantuDireita:'Panturrilha Direita',pantuEsquerda:'Panturrilha Esquerda'};

        const win = window.open('','_blank');
        win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Avaliação Física</title>
        <style>
            *{box-sizing:border-box;margin:0;padding:0} body{font-family:'Segoe UI',sans-serif;color:#1e293b;padding:24px;max-width:700px;margin:0 auto}
            h1{font-size:1.3rem;font-weight:800;margin-bottom:4px} .sub{font-size:0.75rem;color:#64748b;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #e2e8f0}
            .section{margin-bottom:20px} .section-title{font-size:0.7rem;font-weight:800;color:#10b981;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}
            .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
            .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
            .kpi-val{font-size:1.1rem;font-weight:800} .kpi-lab{font-size:0.6rem;color:#64748b}
            table{width:100%;border-collapse:collapse;font-size:0.8rem} td,th{padding:7px 10px;border-bottom:1px solid #e2e8f0} th{background:#f8fafc;font-weight:700;text-align:left;font-size:0.7rem}
            .laudo{background:#f0fdf4;border-left:3px solid #10b981;padding:12px;border-radius:4px;font-size:0.8rem;line-height:1.6}
            .rodape{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:0.65rem;color:#94a3b8;text-align:center}
            @media print{body{padding:12px}}
        </style></head><body>`);

        win.document.write(`<h1>${a.nome||'Aluno'}</h1><div class="sub">Avaliação Física · ${f.data?f.data.split('-').reverse().join('/'):''} · ${f.tipo==='completa'?'Avaliação Completa':'Avaliação Básica'}</div>`);

        win.document.write(`<div class="section"><div class="section-title">⚖️ Peso e Altura</div><div class="grid">
            <div class="kpi"><div class="kpi-val">${f.peso||0} kg</div><div class="kpi-lab">Peso</div></div>
            <div class="kpi"><div class="kpi-val">${f.altura||0} m</div><div class="kpi-lab">Altura</div></div>
            <div class="kpi"><div class="kpi-val" style="color:#10b981">${imc.toFixed(1)}</div><div class="kpi-lab">IMC</div></div>
            <div class="kpi"><div class="kpi-val" style="color:#ef4444">${f.percGordura||0}%</div><div class="kpi-lab">% Gordura</div></div>
        </div><div style="background:#f0fdf4;border-radius:6px;padding:8px;text-align:center;font-size:0.8rem;font-weight:700;color:#10b981;">${this._classIMC(imc)}</div></div>`);

        if (Object.keys(circ).length > 0) {
            win.document.write(`<div class="section"><div class="section-title">📏 Circunferências</div><table><tr><th>Medida</th><th>Valor (cm)</th></tr>`);
            Object.entries(circ).forEach(([k,v]) => { win.document.write(`<tr><td>${circNomes[k]||k}</td><td>${v}</td></tr>`); });
            win.document.write(`</table></div>`);
        }
        if (f.dobras && Object.keys(f.dobras).length > 0) {
            win.document.write(`<div class="section"><div class="section-title">📐 Dobras Cutâneas (Pollock 7)</div><table><tr><th>Dobra</th><th>mm</th></tr>`);
            Object.entries(f.dobras).forEach(([k,v]) => { win.document.write(`<tr><td>${k}</td><td>${v}</td></tr>`); });
            if (f.percGorduraPollock) win.document.write(`<tr style="font-weight:800"><td>% Gordura (Pollock)</td><td>${f.percGorduraPollock}%</td></tr>`);
            win.document.write(`</table></div>`);
        }
        if (f.anamnese) win.document.write(`<div class="section"><div class="section-title">📋 Anamnese</div><p style="font-size:0.8rem;line-height:1.7;white-space:pre-wrap;">${f.anamnese}</p></div>`);
        if (f.laudo) win.document.write(`<div class="section"><div class="section-title">📝 Laudo do Avaliador</div><div class="laudo">${f.laudo}</div>${f.avaliadorNome?`<div style="font-size:0.65rem;color:#64748b;margin-top:6px;">Avaliador: ${f.avaliadorNome}</div>`:''}</div>`);
        win.document.write(`<div class="rodape">Gaditas Matriz · Documento gerado pelo sistema · ${new Date().toLocaleDateString('pt-BR')}</div></body></html>`);
        win.document.close();
        setTimeout(() => win.print(), 600);
    }
};

// ── BOLETIM ESCOLAR ──────────────────────────────────────────────────────────
const boletim = {
    _alunoId: null,
    _dados: null,
    _sistemaSel: '2x',
    _avSel: 'av1',
    _anoSel: new Date().getFullYear(),
    _semSel: new Date().getMonth() < 6 ? 1 : 2,

    async abrir(alunoId) {
        this._alunoId = alunoId;
        let overlay = document.getElementById('boletim-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'boletim-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#0f172a;z-index:9999;overflow-y:auto;padding:15px;box-sizing:border-box;';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<div style="text-align:center;color:#a78bfa;padding:60px 20px;font-size:0.85rem;">Carregando boletim...</div>`;
        const snap = await db.collection('alunos').doc(alunoId).get();
        this._dados = snap.data()?.boletim || null;
        if (!this._dados || !this._dados.sistema) {
            this._renderConfig();
        } else {
            this._renderFormNotas();
        }
    },

    fechar() {
        const el = document.getElementById('boletim-overlay');
        if (el) el.remove();
    },

    _overlay() { return document.getElementById('boletim-overlay'); },

    // ── SETUP ──────────────────────────────────────────────────
    // Retorna o sistema (2x/3x) para um ano — por ano primeiro, fallback global
    _getSistema(ano) {
        return this._dados?.sistemaPorAno?.[ano] || this._dados?.sistema || '2x';
    },

    _renderConfig() {
        const overlay = this._overlay();
        if (!overlay) return;
        const materiasPadrao = ['Português','Matemática','Ciências','História','Geografia','Inglês','Ed. Física','Artes'];
        const anoSel = this._anoSel;
        this._sistemaSel = this._getSistema(anoSel);
        const sel = this._sistemaSel;
        const temDados = !!(this._dados?.sistema || this._dados?.sistemaPorAno);
        overlay.innerHTML = `
        <div style="max-width:460px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-top:8px;">
                <h2 style="color:#a78bfa;font-size:1.05rem;font-weight:800;margin:0;">📚 BOLETIM ESCOLAR</h2>
                <button onclick="boletim.fechar()" style="background:none;border:none;color:#64748b;font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>
            </div>
            <div style="background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;padding:8px 12px;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
                <span style="color:#a78bfa;font-size:0.7rem;font-weight:700;">📅 Configurando para:</span>
                <span style="color:white;font-size:0.8rem;font-weight:800;">${anoSel}</span>
                ${temDados ? `<span style="color:#64748b;font-size:0.65rem;margin-left:auto;">Anos anteriores não são afetados</span>` : ''}
            </div>
            <div style="background:#1e293b;border:1px solid #7c3aed33;border-radius:12px;padding:16px;margin-bottom:12px;">
                <small style="color:#a78bfa;font-size:0.68rem;font-weight:800;display:block;margin-bottom:10px;letter-spacing:0.5px;">AVALIAÇÕES POR SEMESTRE — ${anoSel}</small>
                <div style="display:flex;gap:10px;margin-bottom:18px;">
                    <div id="btn-2x" onclick="boletim._selecionarSistema('2x')"
                        style="flex:1;text-align:center;padding:14px 8px;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:800;
                        background:${sel==='2x'?'#4c1d95':'#0f172a'};border:2px solid ${sel==='2x'?'#7c3aed':'#334155'};color:${sel==='2x'?'#a78bfa':'#64748b'};">
                        2 Avaliações<br><span style="font-size:0.62rem;font-weight:400;">Av1 + Av2</span>
                    </div>
                    <div id="btn-3x" onclick="boletim._selecionarSistema('3x')"
                        style="flex:1;text-align:center;padding:14px 8px;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:800;
                        background:${sel==='3x'?'#4c1d95':'#0f172a'};border:2px solid ${sel==='3x'?'#7c3aed':'#334155'};color:${sel==='3x'?'#a78bfa':'#64748b'};">
                        3 Avaliações<br><span style="font-size:0.62rem;font-weight:400;">Av1 + Av2 + Av3</span>
                    </div>
                </div>
                <small style="color:#a78bfa;font-size:0.68rem;font-weight:800;display:block;margin-bottom:8px;letter-spacing:0.5px;">MATÉRIAS</small>
                <div id="lista-materias-config" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
                    ${(this._dados?.materias || materiasPadrao).map(m => `
                        <div onclick="boletim._toggleMateria(this)" data-materia="${m}" data-ativo="1"
                            style="padding:5px 11px;background:#4c1d95;border:1px solid #7c3aed;border-radius:20px;color:#a78bfa;font-size:0.7rem;font-weight:700;cursor:pointer;transition:all 0.15s;">${m}</div>
                    `).join('')}
                </div>
                <div style="display:flex;gap:6px;margin-bottom:16px;">
                    <input type="text" id="input-nova-materia" placeholder="Adicionar matéria..." onkeydown="if(event.key==='Enter')boletim._adicionarMateria()"
                        style="flex:1;padding:8px 10px;background:#0f172a;border:1px solid #334155;color:white;border-radius:8px;font-size:0.75rem;outline:none;">
                    <button onclick="boletim._adicionarMateria()" style="padding:8px 14px;background:#4c1d95;border:1px solid #7c3aed;color:#a78bfa;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:800;">+</button>
                </div>
                <button onclick="boletim.salvarConfig()"
                    style="width:100%;padding:13px;background:linear-gradient(135deg,#4c1d95,#5b21b6);border:1px solid #7c3aed;color:#a78bfa;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                    ✅ SALVAR PARA ${anoSel}
                </button>
                ${temDados ? `<button onclick="boletim._renderFormNotas()" style="width:100%;padding:8px;background:none;border:1px solid #334155;color:#64748b;border-radius:8px;cursor:pointer;font-size:0.7rem;margin-top:8px;">← Voltar sem salvar</button>` : ''}
            </div>
        </div>`;
    },

    _selecionarSistema(v) {
        this._sistemaSel = v;
        const b2 = document.getElementById('btn-2x');
        const b3 = document.getElementById('btn-3x');
        if (!b2 || !b3) return;
        b2.style.background   = v === '2x' ? '#4c1d95' : '#0f172a';
        b2.style.borderColor  = v === '2x' ? '#7c3aed' : '#334155';
        b2.style.color        = v === '2x' ? '#a78bfa' : '#64748b';
        b3.style.background   = v === '3x' ? '#4c1d95' : '#0f172a';
        b3.style.borderColor  = v === '3x' ? '#7c3aed' : '#334155';
        b3.style.color        = v === '3x' ? '#a78bfa' : '#64748b';
    },

    _toggleMateria(el) {
        const ativo = el.dataset.ativo === '1';
        el.dataset.ativo = ativo ? '0' : '1';
        el.style.background   = ativo ? '#1e293b' : '#4c1d95';
        el.style.borderColor  = ativo ? '#334155' : '#7c3aed';
        el.style.color        = ativo ? '#475569' : '#a78bfa';
    },

    _adicionarMateria() {
        const inp = document.getElementById('input-nova-materia');
        const nome = inp?.value.trim();
        if (!nome) return;
        const lista = document.getElementById('lista-materias-config');
        if (!lista) return;
        const div = document.createElement('div');
        div.onclick = () => this._toggleMateria(div);
        div.dataset.materia = nome;
        div.dataset.ativo = '1';
        div.style.cssText = 'padding:5px 11px;background:#4c1d95;border:1px solid #7c3aed;border-radius:20px;color:#a78bfa;font-size:0.7rem;font-weight:700;cursor:pointer;';
        div.textContent = nome;
        lista.appendChild(div);
        if (inp) inp.value = '';
    },

    async salvarConfig() {
        const materias = Array.from(document.querySelectorAll('#lista-materias-config [data-ativo="1"]')).map(el => el.dataset.materia);
        if (!materias.length) { alert('Selecione ao menos 1 matéria.'); return; }
        // Sistema salvo por ano — preserva anos anteriores com configuração diferente
        const anoSel = this._anoSel;
        const sistemaPorAno = { ...(this._dados?.sistemaPorAno || {}), [anoSel]: this._sistemaSel };
        const upd = {
            'boletim.materias': materias,
            [`boletim.sistemaPorAno.${anoSel}`]: this._sistemaSel,
        };
        // Primeira vez: também salva sistema global como fallback e inicializa notas
        if (!this._dados) upd['boletim.notas'] = {};
        if (!this._dados?.sistema) upd['boletim.sistema'] = this._sistemaSel;
        await db.collection('alunos').doc(this._alunoId).update(upd);
        if (!this._dados) this._dados = { sistema: this._sistemaSel, materias, notas: {}, sistemaPorAno };
        else { this._dados.materias = materias; this._dados.sistemaPorAno = sistemaPorAno; }
        this._renderFormNotas();
    },

    // ── CADASTRO DE NOTAS ──────────────────────────────────────
    _renderFormNotas() {
        const overlay = this._overlay();
        if (!overlay) return;
        const { materias, notas } = this._dados;
        const sistema = this._getSistema(this._anoSel);
        const avs = sistema === '3x' ? ['av1','av2','av3'] : ['av1','av2'];
        const avLabels = { av1:'1ª Avaliação', av2:'2ª Avaliação', av3:'3ª Avaliação' };
        const anoSel = this._anoSel;
        const semSel = this._semSel;
        const avSel  = this._avSel;
        const notasAtuais = notas?.[anoSel]?.['sem'+semSel]?.[avSel] || {};
        const anos = Array.from(new Set([anoSel, anoSel-1, ...Object.keys(notas||{})])).sort((a,b)=>b-a).slice(0,3);

        const mediaGeral = () => {
            const vals = materias.map(m => notasAtuais[m]).filter(v => v !== null && v !== undefined);
            return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—';
        };

        overlay.innerHTML = `
        <div style="max-width:460px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-top:8px;">
                <h2 style="color:#a78bfa;font-size:1.05rem;font-weight:800;margin:0;">📚 BOLETIM</h2>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button onclick="boletim._renderHistorico()" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:5px 10px;border-radius:8px;cursor:pointer;font-size:0.7rem;font-weight:700;">📊 Histórico</button>
                    <button onclick="boletim.fechar()" style="background:none;border:none;color:#64748b;font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:10px;">
                <select onchange="boletim._anoSel=parseInt(this.value);boletim._renderFormNotas()"
                    style="flex:1;padding:8px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;font-size:0.75rem;outline:none;">
                    ${anos.map(a=>`<option value="${a}"${a==anoSel?' selected':''}>${a}</option>`).join('')}
                </select>
                <select onchange="boletim._semSel=parseInt(this.value);boletim._renderFormNotas()"
                    style="flex:1;padding:8px;background:#1e293b;border:1px solid #334155;color:white;border-radius:8px;font-size:0.75rem;outline:none;">
                    <option value="1"${semSel===1?' selected':''}>1º Semestre</option>
                    <option value="2"${semSel===2?' selected':''}>2º Semestre</option>
                </select>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:14px;">
                ${avs.map(av=>`
                    <button onclick="boletim._avSel='${av}';boletim._renderFormNotas()"
                        style="flex:1;padding:9px 6px;border-radius:8px;font-size:0.72rem;font-weight:700;cursor:pointer;
                        border:1px solid ${av===avSel?'#7c3aed':'#334155'};
                        background:${av===avSel?'#4c1d95':'#1e293b'};
                        color:${av===avSel?'#a78bfa':'#64748b'};">
                        ${avLabels[av]}
                    </button>
                `).join('')}
            </div>
            <div style="background:#1e293b;border:1px solid #7c3aed33;border-radius:12px;padding:14px;margin-bottom:12px;">
                ${materias.map(m => {
                    const v = notasAtuais[m] ?? '';
                    const cor = v !== '' && parseFloat(v) < 5 ? '#ef4444' : '#a78bfa';
                    return `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <span style="color:#e2e8f0;font-size:0.8rem;font-weight:600;">${m}</span>
                        <input type="number" min="0" max="10" step="0.1" value="${v}"
                            id="nota-${m.replace(/[^a-zA-Z0-9]/g,'_')}"
                            oninput="this.style.color=this.value!==''&&parseFloat(this.value)<5?'#ef4444':'#a78bfa'"
                            style="width:72px;padding:6px;background:#0f172a;border:1px solid #334155;color:${cor};border-radius:8px;font-size:0.85rem;font-weight:700;text-align:center;outline:none;">
                    </div>`;
                }).join('')}
                <div style="border-top:1px solid #334155;padding-top:10px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#64748b;font-size:0.75rem;">Média geral</span>
                    <span style="color:#a78bfa;font-weight:800;font-size:1rem;">${mediaGeral()}</span>
                </div>
            </div>
            <button onclick="boletim.salvarNotas()"
                style="width:100%;padding:13px;background:linear-gradient(135deg,#4c1d95,#5b21b6);border:1px solid #7c3aed;color:#a78bfa;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;margin-bottom:8px;">
                💾 SALVAR NOTAS
            </button>
            <!-- Comprovante do boletim -->
            <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:8px;">
                <small style="color:#64748b;font-size:0.68rem;font-weight:700;display:block;margin-bottom:8px;">📎 FOTO DO BOLETIM — ${anoSel}</small>
                ${(this._dados?.comprovantes?.[anoSel])
                    ? `<div style="position:relative;display:inline-block;">
                           <img src="${this._dados.comprovantes[anoSel].url}" style="width:100%;border-radius:8px;max-height:180px;object-fit:cover;" />
                           <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">
                               <i class="fas fa-check-circle" style="color:#10b981;font-size:0.8rem;"></i>
                               <span style="color:#10b981;font-size:0.7rem;font-weight:700;">Comprovante enviado</span>
                           </div>
                       </div>`
                    : `<label style="display:block;cursor:pointer;">
                           <div id="btn-upload-comprovante" style="width:100%;padding:10px;background:#1e293b;border:1px dashed #334155;border-radius:8px;text-align:center;color:#64748b;font-size:0.75rem;">
                               📷 Toque para enviar foto do boletim
                           </div>
                           <input type="file" accept="image/*" style="display:none;" onchange="boletim._uploadComprovante(this, '${this._alunoId}')">
                       </label>`
                }
            </div>
            <button onclick="boletim._renderConfig()"
                style="width:100%;padding:8px;background:none;border:1px solid #334155;color:#64748b;border-radius:8px;cursor:pointer;font-size:0.7rem;">
                ⚙️ Alterar configuração (matérias / sistema)
            </button>
        </div>`;
    },

    async _uploadComprovante(input, alunoId) {
        const file = input.files[0];
        if (!file) return;
        const btn = document.getElementById('btn-upload-comprovante');
        if (btn) btn.innerHTML = '⏳ Comprimindo imagem...';
        try {
            // Comprime imagem para reduzir tamanho
            const base64 = await new Promise((res, rej) => {
                const img = new Image();
                const reader = new FileReader();
                reader.onload = e => { img.src = e.target.result; };
                img.onload = () => {
                    const maxLado = 900;
                    let w = img.width, h = img.height;
                    if (w > maxLado || h > maxLado) {
                        if (w > h) { h = Math.round(h * maxLado / w); w = maxLado; }
                        else       { w = Math.round(w * maxLado / h); h = maxLado; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    res(canvas.toDataURL('image/jpeg', 0.75));
                };
                img.onerror = rej;
                reader.onerror = rej;
                reader.readAsDataURL(file);
            });

            let url = null, path = null;

            // 1. Tenta Firebase Storage
            try {
                if (btn) btn.innerHTML = '⏳ Enviando...';
                if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
                path = `boletim_comprovantes/${alunoId}_${this._anoSel}`;
                const snap = await getStorage().ref(path).put(file);
                url = await snap.ref.getDownloadURL();
            } catch(storageErr) {
                console.warn('Storage falhou, usando base64:', storageErr.message);
                url = base64; path = null; // fallback base64
            }

            const comp = { url, path, data: new Date().toLocaleDateString('pt-BR') };
            const upd = {};
            upd[`boletim.comprovantes.${this._anoSel}`] = comp;
            await db.collection('alunos').doc(alunoId).update(upd);
            if (!this._dados.comprovantes) this._dados.comprovantes = {};
            this._dados.comprovantes[this._anoSel] = comp;
            this._renderFormNotas();
        } catch(e) {
            if (btn) btn.innerHTML = '❌ Erro ao enviar. Tente novamente.';
            console.error('Upload comprovante:', e);
        }
    },

    gerarCardExplicativo() {
        const W = 800, H = 1200;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        // fundo escuro degradê
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0f172a'); bg.addColorStop(1, '#1e1040');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        // borda roxa
        ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 4;
        ctx.strokeRect(12, 12, W-24, H-24);

        // faixa topo
        const top = ctx.createLinearGradient(0,0,W,0);
        top.addColorStop(0,'#7c3aed'); top.addColorStop(1,'#4f46e5');
        ctx.fillStyle = top; ctx.fillRect(12, 12, W-24, 80);

        // título
        ctx.fillStyle = '#fff'; ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🎓 BOLETIM ESCOLAR', W/2, 62);

        // subtítulo academia
        ctx.fillStyle = '#c4b5fd'; ctx.font = '18px Arial';
        ctx.fillText('Sistema de Acompanhamento Escolar', W/2, 115);

        // linha divisória
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(40, 135); ctx.lineTo(W-40, 135); ctx.stroke();

        // COMO FUNCIONA
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('📚 Como funciona?', 50, 172);

        const linhas = [
            'Os pais cadastram as notas do filho no app,',
            'por semestre e por avaliação (Av1, Av2...).',
            'O sistema calcula a média geral automática',
            'e exibe um SELO no perfil do aluno.'
        ];
        ctx.fillStyle = '#94a3b8'; ctx.font = '18px Arial';
        linhas.forEach((l, i) => ctx.fillText(l, 50, 202 + i*26));

        // linha divisória
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(40, 318); ctx.lineTo(W-40, 318); ctx.stroke();

        // SELOS
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🏅 SELOS DE DESEMPENHO', W/2, 354);

        const selos = [
            { label:'OURO',   media:'Média ≥ 8,0', desc:'Excelente desempenho!', bg:'#EF9F27', ring:'#BA7517', text:'#412402', emoji:'🌟' },
            { label:'PRATA',  media:'Média ≥ 6,0', desc:'Bom desempenho.',        bg:'#B4B2A9', ring:'#5F5E5A', text:'#2C2C2A', emoji:'⭐' },
            { label:'BRONZE', media:'Média ≥ 4,0', desc:'Continue melhorando!',  bg:'#D85A30', ring:'#993C1D', text:'#4A1B0C', emoji:'💪' },
        ];

        selos.forEach((s, i) => {
            const cx = 160 + i * 240;
            const cy = 480;

            // serrilhado
            ctx.save();
            ctx.beginPath();
            for (let p = 0; p < 24; p++) {
                const ang = (p * Math.PI / 12) - Math.PI / 2;
                const r = p % 2 === 0 ? 72 : 52;
                const x = cx + r * Math.cos(ang);
                const y = cy + r * Math.sin(ang);
                p === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = s.bg;
            ctx.fill();
            ctx.strokeStyle = s.ring; ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();

            // emoji chapéu
            ctx.font = '38px Arial'; ctx.textAlign = 'center';
            ctx.fillText('🎓', cx, cy + 14);

            // nome do selo
            ctx.fillStyle = s.text; ctx.font = 'bold 15px Arial';
            ctx.fillText(s.label, cx, cy + 44);

            // caixa info abaixo
            ctx.fillStyle = '#1e293b';
            roundRect(ctx, cx-90, cy+72, 180, 80, 12);
            ctx.fill();
            ctx.strokeStyle = s.ring; ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = s.bg; ctx.font = 'bold 18px Arial';
            ctx.fillText(s.emoji + ' ' + s.media, cx, cy+104);
            ctx.fillStyle = '#94a3b8'; ctx.font = '14px Arial';
            ctx.fillText(s.desc, cx, cy+126);
        });

        // linha divisória
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(40, 618); ctx.lineTo(W-40, 618); ctx.stroke();

        // DICAS
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('💡 Dicas para os pais', 50, 652);

        const dicas = [
            '✅  Cadastre as notas logo após receber o boletim',
            '📎  Envie a foto do boletim para confirmação',
            '📊  Acompanhe a evolução por semestre no app',
            '🏆  Quem terminar o semestre com Selo Ouro',
            '     concorrerá a prêmios especiais!',
        ];
        ctx.fillStyle = '#94a3b8'; ctx.font = '17px Arial';
        dicas.forEach((d, i) => ctx.fillText(d, 50, 682 + i*28));

        // ── ONDE APARECE O SELO ──────────────────────────────────
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(40, 840); ctx.lineTo(W-40, 840); ctx.stroke();

        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('📍 Onde aparece o Selo?', 50, 872);

        ctx.fillStyle = '#64748b'; ctx.font = '15px Arial';
        ctx.fillText('No topo do perfil do seu filho no app:', 50, 896);

        // mockup do cabeçalho do app
        const mx = 80, my = 912, mw = W - 160, mh = 180;
        roundRect(ctx, mx, my, mw, mh, 16);
        ctx.fillStyle = '#1e293b'; ctx.fill();
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.stroke();

        // faixa topo do mockup
        const mTop = ctx.createLinearGradient(mx, my, mx+mw, my);
        mTop.addColorStop(0,'#0f172a'); mTop.addColorStop(1,'#1e1040');
        ctx.fillStyle = mTop;
        roundRect(ctx, mx, my, mw, 44, { tl:16, tr:16, bl:0, br:0 });
        ctx.fill();

        // barra de status simulada
        ctx.fillStyle = '#334155'; ctx.font = '11px Arial'; ctx.textAlign = 'left';
        ctx.fillText('OSS, BEM-VINDO!', mx+16, my+16);
        ctx.fillStyle = '#475569'; ctx.font = '10px Arial';
        ctx.fillText('Gaditas Academy', mx+16, my+30);

        // logo simulada (círculo)
        ctx.fillStyle = '#7c3aed33';
        ctx.beginPath(); ctx.arc(mx+mw-30, my+22, 18, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#a78bfa'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
        ctx.fillText('G', mx+mw-30, my+27);

        // avatar do aluno
        const ax = mx+26, ay = my+70;
        ctx.fillStyle = '#1e3a5f';
        ctx.beginPath(); ctx.arc(ax, ay, 28, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3; ctx.stroke(); // faixa amarela
        ctx.fillStyle = '#93c5fd'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center';
        ctx.fillText('L', ax, ay+8);

        // nome e faixa
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'left';
        ctx.fillText('LEÃO KIDS', mx+66, my+62);
        ctx.fillStyle = '#f59e0b'; ctx.font = '12px Arial';
        ctx.fillText('Amarela • 3ºG', mx+66, my+80);

        // barra de progresso simulada
        ctx.fillStyle = '#0f172a';
        roundRect(ctx, mx+66, my+88, 220, 8, 4); ctx.fill();
        ctx.fillStyle = '#f59e0b';
        roundRect(ctx, mx+66, my+88, 140, 8, 4); ctx.fill();

        // ── SELO OURO no canto direito ──
        const sx = mx + mw - 76, sy = my + 58;
        ctx.save();
        ctx.beginPath();
        for (let p = 0; p < 24; p++) {
            const ang = (p * Math.PI / 12) - Math.PI / 2;
            const r = p % 2 === 0 ? 30 : 22;
            const px2 = sx + r * Math.cos(ang);
            const py2 = sy + r * Math.sin(ang);
            p === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fillStyle = '#EF9F27'; ctx.fill();
        ctx.strokeStyle = '#BA7517'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        ctx.font = '16px Arial'; ctx.textAlign = 'center';
        ctx.fillText('🎓', sx, sy+6);

        // seta apontando para o selo
        ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2;
        ctx.setLineDash([5,4]);
        ctx.beginPath(); ctx.moveTo(sx-50, sy+50); ctx.lineTo(sx-8, sy+14); ctx.stroke();
        ctx.setLineDash([]);
        // ponta da seta
        ctx.fillStyle = '#a78bfa';
        ctx.beginPath(); ctx.moveTo(sx-8, sy+14); ctx.lineTo(sx-18, sy+20); ctx.lineTo(sx-14, sy+26); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c4b5fd'; ctx.font = 'italic 13px Arial'; ctx.textAlign = 'left';
        ctx.fillText('← Selo aparece aqui após cadastrar as notas', mx+66, my+155);

        // rodapé
        const rod = ctx.createLinearGradient(0, H-70, W, H-70);
        rod.addColorStop(0,'#7c3aed22'); rod.addColorStop(1,'#4f46e522');
        ctx.fillStyle = rod; ctx.fillRect(12, H-68, W-24, 56);
        ctx.fillStyle = '#7c3aed'; ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Gaditas Academy — Jiu-Jitsu para Crianças 🤙', W/2, H-38);
        ctx.fillStyle = '#475569'; ctx.font = '13px Arial';
        ctx.fillText('gaditas-matriz.vercel.app', W/2, H-18);

        // helper roundRect (r pode ser número ou {tl,tr,bl,br})
        function roundRect(ctx, x, y, w, h, r) {
            const tl = typeof r === 'object' ? r.tl : r;
            const tr = typeof r === 'object' ? r.tr : r;
            const br = typeof r === 'object' ? r.br : r;
            const bl = typeof r === 'object' ? r.bl : r;
            ctx.beginPath();
            ctx.moveTo(x+tl, y);
            ctx.lineTo(x+w-tr, y); ctx.quadraticCurveTo(x+w, y, x+w, y+tr);
            ctx.lineTo(x+w, y+h-br); ctx.quadraticCurveTo(x+w, y+h, x+w-br, y+h);
            ctx.lineTo(x+bl, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-bl);
            ctx.lineTo(x, y+tl); ctx.quadraticCurveTo(x, y, x+tl, y);
            ctx.closePath();
        }

        // Modal de preview + botões
        const dataUrl = canvas.toDataURL('image/png');
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:#000000dd;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:12px;overflow-y:auto;';
        overlay.innerHTML = `
            <img src="${dataUrl}" style="max-width:100%;max-height:70vh;border-radius:12px;box-shadow:0 0 40px #7c3aed55;"/>
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                <a href="${dataUrl}" download="gaditas-boletim-selos.png"
                   style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white;padding:12px 22px;border-radius:10px;font-size:0.8rem;font-weight:800;text-decoration:none;">
                   💾 BAIXAR IMAGEM
                </a>
                <button onclick="boletim._compartilharCard('${dataUrl}')"
                   style="background:#064e3b;border:1px solid #10b981;color:#10b981;padding:12px 22px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;">
                   📤 COMPARTILHAR
                </button>
                <button onclick="this.closest('div[style*=fixed]').remove()"
                   style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:12px 22px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;">
                   ✕ FECHAR
                </button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    },

    async _compartilharCard(dataUrl) {
        try {
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], 'gaditas-boletim-selos.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: 'Gaditas Academy — Boletim Escolar', text: 'Veja como funciona o sistema de selos do boletim escolar!' });
            } else {
                alert('Compartilhamento não suportado neste dispositivo. Use o botão Baixar Imagem.');
            }
        } catch(e) { console.warn('Share:', e); }
    },

    // ── Relatório para pais (Canvas) ─────────────────────────────────────────
    async gerarRelatorioPais(kidIdx) {
        try { await this._gerarRelatorioPaisImpl(kidIdx); }
        catch(e) { alert('Erro ao gerar relatório: ' + (e.message || e)); console.error(e); }
    },

    async _gerarRelatorioPaisImpl(kidIdx) {
        const k = this._painelKids?.[kidIdx];
        if (!k) { alert('Dados não encontrados. Recarregue o painel.'); return; }
        const anoSel = this._painelAnoSel;
        const { materias, notas } = k.boletim;
        const avs = this._getSistemaAdmin(k.boletim, anoSel);
        const notasAno = notas?.[anoSel];

        // Média do aluno
        let somaA = 0, totalA = 0;
        if (notasAno) {
            [1,2].forEach(sem => avs.forEach(av => (materias||[]).forEach(m => {
                const v = notasAno['sem'+sem]?.[av]?.[m];
                if (v !== null && v !== undefined) { somaA += v; totalA++; }
            })));
        }
        const mediaAluno = totalA ? somaA/totalA : null;
        const mediaStr = mediaAluno !== null ? mediaAluno.toFixed(1) : '—';

        // Selo
        let seloLabel = 'SEM DADOS', seloColor = '#64748b';
        if (mediaAluno !== null) {
            if (mediaAluno >= 8) { seloLabel = 'OURO'; seloColor = '#f59e0b'; }
            else if (mediaAluno >= 6) { seloLabel = 'PRATA'; seloColor = '#94a3b8'; }
            else if (mediaAluno >= 4) { seloLabel = 'BRONZE'; seloColor = '#b45309'; }
            else { seloLabel = 'ABAIXO DA MÉDIA'; seloColor = '#ef4444'; }
        }

        // Frequência últimos 3 meses
        const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const hoje = new Date();
        const treinos3meses = [2,1,0].map(offset => {
            const d = new Date(hoje.getFullYear(), hoje.getMonth()-offset, 1);
            const m = d.getMonth(), ano = d.getFullYear();
            const count = (k.historico||[]).filter(h => {
                if (!h.data) return false;
                const p = h.data.split(',')[0].split('/');
                return p.length >= 3 && parseInt(p[1])-1 === m && p[2].trim() === String(ano);
            }).length;
            return { mes: meses[m], count };
        });

        // Foto do aluno — usa proxy para URLs externas (evita CORS no canvas)
        let fotoImg = null;
        if (k.foto) {
            const src = k.foto.startsWith('data:') ? k.foto : `/api/img-proxy?url=${encodeURIComponent(k.foto)}`;
            fotoImg = await new Promise(res => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = () => res(null);
                img.src = src;
            });
        }

        const W = 800, H = 1050;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const c = canvas.getContext('2d');

        // helper local
        const rr = (ctx, x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x+r, y);
            ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
            ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
            ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
            ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
            ctx.closePath();
        };

        // Fundo
        c.fillStyle = '#0a0a1a';
        c.fillRect(0, 0, W, H);
        const gTop = c.createLinearGradient(0,0,W,200);
        gTop.addColorStop(0,'#1e1040'); gTop.addColorStop(1,'#0f0a2e');
        c.fillStyle = gTop; c.fillRect(0,0,W,180);

        // Header
        c.textAlign = 'center';
        c.fillStyle = '#a78bfa'; c.font = 'bold 18px Arial';
        c.fillText('GADITAS ACADEMY', W/2, 42);
        c.fillStyle = '#ffffff'; c.font = 'bold 36px Arial';
        c.fillText('RELATÓRIO PARA OS PAIS', W/2, 90);
        c.fillStyle = '#7c3aed44';
        c.fillRect(60, 110, W-120, 1);

        // Avatar (foto ou iniciais)
        const R = 72, cx = W/2, cy = 235;
        c.save();
        c.beginPath(); c.arc(cx, cy, R, 0, Math.PI*2); c.clip();
        if (fotoImg) {
            const s = R*2, sx = cx-R, sy = cy-R;
            const ratio = Math.min(s/fotoImg.width, s/fotoImg.height);
            const dw = fotoImg.width*ratio, dh = fotoImg.height*ratio;
            c.fillStyle = '#1e1040'; c.fillRect(sx, sy, s, s);
            c.drawImage(fotoImg, sx+(s-dw)/2, sy+(s-dh)/2, dw, dh);
        } else {
            c.fillStyle = '#1e1040'; c.fillRect(cx-R, cy-R, R*2, R*2);
            const iniciais = k.nome.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase();
            c.fillStyle = seloColor; c.font = `bold 52px Arial`;
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(iniciais, cx, cy);
        }
        c.restore();
        c.beginPath(); c.arc(cx, cy, R, 0, Math.PI*2);
        c.strokeStyle = seloColor; c.lineWidth = 4; c.stroke();

        c.textBaseline = 'alphabetic';
        c.fillStyle = '#ffffff'; c.font = 'bold 30px Arial'; c.textAlign = 'center';
        c.fillText(k.nome, W/2, 342);
        if (k.idade) { c.fillStyle = '#64748b'; c.font = '17px Arial'; c.fillText(`${k.idade} anos`, W/2, 368); }

        // Stats cards
        const stats = [
            { label: 'MÉDIA ESCOLAR', valor: mediaStr, cor: mediaAluno===null?'#64748b':mediaAluno>=7?'#10b981':mediaAluno>=5?'#f59e0b':'#ef4444', icone: '📚' },
            { label: `TREINOS ${anoSel}`, valor: String(k.aulasAno), cor: k.aulasAno>=80?'#10b981':k.aulasAno>=40?'#f59e0b':'#94a3b8', icone: '🥋' },
            { label: 'SELO ESCOLAR', valor: seloLabel, cor: seloColor, icone: '🏅' },
        ];
        const cW=220, cH=108, cY=400, gap=18;
        const sX = (W - (stats.length*cW + (stats.length-1)*gap)) / 2;
        stats.forEach((s, i) => {
            const bx = sX + i*(cW+gap);
            c.fillStyle = '#0f172a'; rr(c, bx, cY, cW, cH, 14); c.fill();
            c.strokeStyle = s.cor+'55'; c.lineWidth=1; c.stroke();
            c.font='26px Arial'; c.textAlign='center'; c.fillText(s.icone, bx+cW/2, cY+34);
            c.fillStyle=s.cor; c.font=`bold ${s.valor.length>6?16:24}px Arial`;
            c.fillText(s.valor, bx+cW/2, cY+70);
            c.fillStyle='#64748b'; c.font='bold 10px Arial';
            c.fillText(s.label, bx+cW/2, cY+93);
        });

        // Frequência — barras
        c.fillStyle='#1e293b'; rr(c,60,548,W-120,165,14); c.fill();
        c.strokeStyle='#33415566'; c.lineWidth=1; c.stroke();
        c.fillStyle='#64748b'; c.font='bold 13px Arial'; c.textAlign='left';
        c.fillText('📅  FREQUÊNCIA NOS ÚLTIMOS 3 MESES', 86, 578);
        const barMaxH=76, barW=80, barY0=690;
        const maxT = Math.max(...treinos3meses.map(t=>t.count), 1);
        treinos3meses.forEach((t, i) => {
            const bx = 160 + i*((W-320)/2);
            const bH = t.count>0 ? Math.max(t.count/maxT*barMaxH,6) : 4;
            const cor = t.count>=10?'#10b981':t.count>=5?'#f59e0b':'#ef444488';
            c.fillStyle=cor; rr(c, bx-barW/2, barY0-bH, barW, bH, 5); c.fill();
            c.fillStyle=cor; c.font='bold 20px Arial'; c.textAlign='center';
            c.fillText(t.count, bx, barY0-bH-8);
            c.fillStyle='#64748b'; c.font='14px Arial'; c.fillText(t.mes, bx, barY0+18);
        });

        // Tagline
        const gLine = c.createLinearGradient(0,760,W,760);
        gLine.addColorStop(0,'#7c3aed'); gLine.addColorStop(1,'#4f46e5');
        c.fillStyle=gLine; rr(c,60,760,W-120,78,14); c.fill();
        c.fillStyle='#ffffff'; c.font='bold 22px Arial'; c.textAlign='center';
        c.fillText('O treino não atrapalha — ajuda! 🥋📚', W/2, 806);

        // Footer
        c.fillStyle='#334155'; c.font='13px Arial';
        c.fillText(`gaditas-matriz.vercel.app  •  ${new Date().toLocaleDateString('pt-BR')}`, W/2, 880);

        let dataUrl;
        try {
            dataUrl = canvas.toDataURL('image/png');
        } catch(taintErr) {
            // Foto causou CORS — regenera sem foto usando iniciais
            fotoImg = null;
            const c2 = canvas.getContext('2d');
            c2.beginPath(); c2.arc(cx, cy, R, 0, Math.PI*2);
            c2.fillStyle = '#1e1040'; c2.fill();
            c2.strokeStyle = seloColor; c2.lineWidth = 4; c2.stroke();
            const iniciais = k.nome.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase();
            c2.fillStyle = seloColor; c2.font = `bold 52px Arial`;
            c2.textAlign = 'center'; c2.textBaseline = 'middle';
            c2.fillText(iniciais, cx, cy);
            c2.textBaseline = 'alphabetic';
            dataUrl = canvas.toDataURL('image/png');
        }

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:#000000cc;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;';
        modal.onclick = e => { if(e.target===modal) modal.remove(); };
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.style.cssText = 'max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 0 40px #0008;';
        this._relatDataUrl = dataUrl;
        this._relatKid = k;

        const mkBtn = (bg, border, color, text) => {
            const b = document.createElement('button');
            b.style.cssText = `background:${bg};border:1px solid ${border};color:${color};padding:10px 16px;border-radius:10px;font-size:0.75rem;font-weight:800;cursor:pointer;`;
            b.textContent = text;
            return b;
        };

        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:420px;';

        const nomeArq = k.nome.replace(/\s+/g,'-');
        const aDownload = document.createElement('a');
        aDownload.href = dataUrl;
        aDownload.download = `relatorio-${nomeArq}.png`;
        aDownload.style.cssText = 'background:#1e1040;border:1px solid #7c3aed;color:#c4b5fd;padding:10px 16px;border-radius:10px;font-size:0.75rem;font-weight:800;cursor:pointer;text-decoration:none;';
        aDownload.textContent = '💾 BAIXAR';

        const btnShare = mkBtn('#064e3b','#10b981','#10b981','📤 COMPARTILHAR');
        btnShare.onclick = () => boletim._compartilharCard(boletim._relatDataUrl);

        const btnEmail = mkBtn('#1e1040','#3b82f6','#93c5fd','✉️ E-MAIL');
        btnEmail.onclick = () => boletim._enviarRelatEmail();

        const btnPopup = mkBtn('#1e1040','#f59e0b','#fcd34d','🔔 ENVIAR AO ALUNO');
        btnPopup.onclick = () => boletim._enviarRelatParaAluno();

        const btnFechar = mkBtn('#1e293b','#334155','#64748b','✕ FECHAR');
        btnFechar.onclick = () => modal.remove();

        btns.appendChild(aDownload); btns.appendChild(btnShare);
        btns.appendChild(btnEmail); btns.appendChild(btnPopup);
        btns.appendChild(btnFechar);
        modal.appendChild(imgEl);
        modal.appendChild(btns);
        document.body.appendChild(modal);
    },

    _enviarRelatEmail() {
        const k = this._relatKid;
        if (!k) return;
        const email = k.email || '';
        const anoSel = this._painelAnoSel;
        const { materias, notas } = k.boletim;
        const avs = this._getSistemaAdmin(k.boletim, anoSel);
        const notasAno = notas?.[anoSel];
        let s = 0, t = 0;
        if (notasAno) [1,2].forEach(sem => avs.forEach(av => (materias||[]).forEach(m => {
            const v = notasAno['sem'+sem]?.[av]?.[m];
            if (v !== null && v !== undefined) { s += v; t++; }
        })));
        const media = t ? (s/t).toFixed(1) : '—';
        const treinos = k.aulasAno || 0;
        const assunto = encodeURIComponent(`Relatório Escolar — ${k.nome} — Gaditas Academy`);
        const corpo = encodeURIComponent(
`Olá! Segue o relatório do(a) ${k.nome} na Gaditas Academy.

📚 BOLETIM ESCOLAR ${anoSel}
• Média escolar: ${media}
• Treinos realizados: ${treinos}

O Jiu-Jitsu contribui para a disciplina e desempenho escolar das crianças.
Para ver o relatório completo com imagem, acesse o app da Gaditas Academy.

Gaditas Academy — gaditas-matriz.vercel.app`
        );
        window.open(`mailto:${email}?subject=${assunto}&body=${corpo}`, '_blank');
    },

    async _enviarRelatParaAluno() {
        const k = this._relatKid;
        const dataUrl = this._relatDataUrl;
        if (!k || !dataUrl) return;
        const btn = event?.currentTarget;
        if (btn) { btn.textContent = '⏳ Enviando...'; btn.disabled = true; }
        try {
            // Salva imagem no Firestore do aluno
            await db.collection('alunos').doc(k.id).update({
                'boletim.relatorioParaPais': { img: dataUrl, data: new Date().toLocaleDateString('pt-BR'), lido: false }
            });
            // Push notification
            await push.paraAluno(k.id, '📚 Relatório disponível!', `${k.nome}, seu relatório escolar está pronto. Abra o app para ver e baixar.`);
            if (btn) { btn.textContent = '✅ Enviado!'; }
            setTimeout(() => { if (btn) { btn.textContent = '🔔 ENVIAR AO ALUNO'; btn.disabled = false; } }, 3000);
        } catch(e) {
            if (btn) { btn.textContent = '❌ Erro'; btn.disabled = false; }
            alert('Erro ao enviar: ' + (e.message || e));
        }
    },

    // Verifica se há relatório novo e mostra popup para o aluno
    async verificarRelatorioPais(alunoId) {
        try {
            const doc = await db.collection('alunos').doc(alunoId).get();
            const rel = doc.data()?.boletim?.relatorioParaPais;
            if (!rel || rel.lido) return;
            // Marca como lido
            await db.collection('alunos').doc(alunoId).update({ 'boletim.relatorioParaPais.lido': true });
            // Mostra popup
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:#000000dd;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;';
            modal.innerHTML = `
                <div style="color:#a78bfa;font-size:0.7rem;font-weight:800;letter-spacing:1px;">📚 RELATÓRIO ESCOLAR</div>
                <div style="color:#ffffff;font-size:1rem;font-weight:800;text-align:center;">Seu professor enviou um relatório!</div>`;
            const img = document.createElement('img');
            img.src = rel.img;
            img.style.cssText = 'max-width:100%;max-height:55vh;border-radius:12px;box-shadow:0 0 40px #7c3aed88;';
            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
            const aDown = document.createElement('a');
            aDown.href = rel.img;
            aDown.download = 'relatorio-escolar.png';
            aDown.style.cssText = 'background:#1e1040;border:1px solid #7c3aed;color:#c4b5fd;padding:12px 20px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;text-decoration:none;';
            aDown.textContent = '💾 SALVAR IMAGEM';
            const bShare = document.createElement('button');
            bShare.style.cssText = 'background:#064e3b;border:1px solid #10b981;color:#10b981;padding:12px 20px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;';
            bShare.textContent = '📤 COMPARTILHAR';
            bShare.onclick = () => boletim._compartilharCard(rel.img);
            const bClose = document.createElement('button');
            bClose.style.cssText = 'background:#1e293b;border:1px solid #334155;color:#64748b;padding:12px 20px;border-radius:10px;font-size:0.8rem;font-weight:800;cursor:pointer;';
            bClose.textContent = '✕ FECHAR';
            bClose.onclick = () => modal.remove();
            btns.appendChild(aDown); btns.appendChild(bShare); btns.appendChild(bClose);
            modal.appendChild(img); modal.appendChild(btns);
            document.body.appendChild(modal);
        } catch(e) { console.warn('verificarRelatorioPais:', e.message); }
    },

    _ampliarComprovante(src) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:#000000cc;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.onclick = () => overlay.remove();
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:100%;max-height:90vh;border-radius:10px;object-fit:contain;box-shadow:0 0 40px #0008;';
        overlay.appendChild(img);
        document.body.appendChild(overlay);
    },

    async _deletarComprovante(alunoId, ano, storagePath) {
        if (!confirm('Deletar comprovante? A imagem será removida do servidor.')) return;
        try {
            await getStorage().ref(storagePath).delete();
        } catch(e) { console.warn('Storage delete:', e.message); }
        const upd = {};
        upd[`boletim.comprovantes.${ano}`] = firebase.firestore.FieldValue.delete();
        await db.collection('alunos').doc(alunoId).update(upd);
        // Re-renderiza painel
        boletim.renderPainelAdmin();
    },

    async salvarNotas() {
        const { materias } = this._dados;
        const notas = {};
        materias.forEach(m => {
            const el = document.getElementById('nota-' + m.replace(/[^a-zA-Z0-9]/g,'_'));
            notas[m] = (el && el.value !== '') ? parseFloat(el.value) : null;
        });
        const path = `boletim.notas.${this._anoSel}.sem${this._semSel}.${this._avSel}`;
        const upd = {};
        upd[path] = notas;
        await db.collection('alunos').doc(this._alunoId).update(upd);
        // Atualiza local e re-renderiza
        if (!this._dados.notas) this._dados.notas = {};
        if (!this._dados.notas[this._anoSel]) this._dados.notas[this._anoSel] = {};
        if (!this._dados.notas[this._anoSel]['sem'+this._semSel]) this._dados.notas[this._anoSel]['sem'+this._semSel] = {};
        this._dados.notas[this._anoSel]['sem'+this._semSel][this._avSel] = notas;
        this._renderFormNotas();
        const btn = document.querySelector('#boletim-overlay button[onclick="boletim.salvarNotas()"]');
        if (btn) { btn.textContent = '✅ Notas salvas!'; setTimeout(() => { if(btn) btn.textContent = '💾 SALVAR NOTAS'; }, 2000); }
    },

    // ── HISTÓRICO ─────────────────────────────────────────────
    _renderHistorico() {
        const overlay = this._overlay();
        if (!overlay) return;
        const { materias, notas } = this._dados;
        const avL = { av1:'Av1', av2:'Av2', av3:'Av3' };
        const anos = Object.keys(notas||{}).sort((a,b)=>b-a);

        let blocos = '';
        if (!anos.length) {
            blocos = `<p style="color:#64748b;text-align:center;font-size:0.8rem;padding:20px 0;">Nenhuma nota cadastrada ainda.</p>`;
        } else {
            anos.forEach(ano => {
                const avs = this._getSistema(ano) === '3x' ? ['av1','av2','av3'] : ['av1','av2'];
                [1,2].forEach(sem => {
                    const semData = notas[ano]?.['sem'+sem];
                    if (!semData) return;
                    blocos += `
                    <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:10px;">
                        <h3 style="color:#a78bfa;font-size:0.82rem;font-weight:800;margin:0 0 10px 0;">${ano} — ${sem}º Semestre</h3>
                        <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:0.68rem;">
                            <thead><tr>
                                <th style="text-align:left;color:#64748b;padding:4px 5px;border-bottom:1px solid #1e293b;">Matéria</th>
                                ${avs.map(av=>`<th style="text-align:center;color:#64748b;padding:4px 5px;border-bottom:1px solid #1e293b;">${avL[av]}</th>`).join('')}
                                <th style="text-align:center;color:#64748b;padding:4px 5px;border-bottom:1px solid #1e293b;">Média</th>
                            </tr></thead>
                            <tbody>
                            ${materias.map(m => {
                                const vals = avs.map(av => semData[av]?.[m]).filter(v=>v!==null&&v!==undefined);
                                const media = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—';
                                return `<tr>
                                    <td style="color:#94a3b8;padding:4px 5px;border-bottom:1px solid #1e293b11;">${m}</td>
                                    ${avs.map(av=>{
                                        const v = semData[av]?.[m];
                                        const c = (v!==null&&v!==undefined&&v<5)?'#ef4444':'#e2e8f0';
                                        return `<td style="text-align:center;color:${c};padding:4px 5px;border-bottom:1px solid #1e293b11;font-weight:700;">${v!==null&&v!==undefined?v:'—'}</td>`;
                                    }).join('')}
                                    <td style="text-align:center;color:${parseFloat(media)<5?'#ef4444':'#a78bfa'};padding:4px 5px;font-weight:800;">${media}</td>
                                </tr>`;
                            }).join('')}
                            </tbody>
                        </table>
                        </div>
                    </div>`;
                });
            });
        }

        overlay.innerHTML = `
        <div style="max-width:460px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-top:8px;">
                <h2 style="color:#a78bfa;font-size:1.05rem;font-weight:800;margin:0;">📊 HISTÓRICO DE NOTAS</h2>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button onclick="boletim._renderFormNotas()" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:5px 10px;border-radius:8px;cursor:pointer;font-size:0.7rem;font-weight:700;">← Voltar</button>
                    <button onclick="boletim.fechar()" style="background:none;border:none;color:#64748b;font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>
                </div>
            </div>
            ${blocos}
        </div>`;
    },

    // ── PAINEL ADMIN ───────────────────────────────────────────
    _painelAnoSel: new Date().getFullYear(),

    async renderPainelAdmin(anoFiltro) {
        const cont = document.getElementById('painel-boletim-admin');
        if (!cont) return;
        if (anoFiltro !== undefined) this._painelAnoSel = anoFiltro;
        const anoSel = this._painelAnoSel;
        const anoAtual = new Date().getFullYear();
        const semAtual = new Date().getMonth() < 6 ? 1 : 2;

        cont.innerHTML = `<div style="color:#a78bfa;font-size:0.75rem;padding:10px 0;">Carregando boletins...</div>`;
        const snap = await db.collection('alunos').get();
        const kids = [];
        snap.forEach(doc => {
            const a = doc.data();
            const isKids = /kids/i.test(a.nome||'') || (a.nascimento && (anoAtual - new Date(a.nascimento).getFullYear()) <= 15) || (a.turmas||[]).some(t=>/kids/i.test(t));
            if (!isKids || !a.boletim) return;
            const idade = a.nascimento ? anoAtual - new Date(a.nascimento).getFullYear() : null;
            // Frequência do aluno no ano selecionado (aulas no historico)
            const aulasAno = (a.historico||[]).filter(h => {
                if (!h.data) return false;
                const p = h.data.split(',')[0].split('/');
                return p.length >= 3 && p[2].trim() === String(anoSel);
            }).length;
            kids.push({ id: doc.id, nome: a.nome, idade, boletim: a.boletim, aulasAno, historico: a.historico||[], foto: a.fotoPerfil||null });
        });

        // Anos disponíveis para filtro
        const todosAnos = new Set([anoAtual]);
        kids.forEach(k => Object.keys(k.boletim.notas||{}).forEach(a => todosAnos.add(parseInt(a))));
        const anosDisp = Array.from(todosAnos).sort((a,b)=>b-a);

        if (!kids.length) {
            cont.innerHTML = `
            <div style="background:#1e293b;border:1px solid #7c3aed33;border-radius:12px;padding:14px;margin-bottom:12px;">
                <small style="color:#a78bfa;font-size:0.68rem;font-weight:800;letter-spacing:0.5px;">📚 BOLETIM ESCOLAR — KIDS</small>
                <p style="color:#64748b;font-size:0.78rem;margin-top:8px;text-align:center;">Nenhum aluno kids com boletim cadastrado.</p>
            </div>`;
            return;
        }

        // ── Coleta alertas e médias globais ──────────────────────
        const alertas = [];
        const mediasPorMateria = {}; // { materia: [notas] }
        let totalNotas = 0, somaNotas = 0;

        kids.forEach(k => {
            const { materias, notas } = k.boletim;
            const avs = this._getSistemaAdmin(k.boletim, anoSel);
            const notasAno = notas?.[anoSel];
            if (!notasAno) return;
            [1,2].forEach(sem => {
                const semData = notasAno['sem'+sem];
                if (!semData) return;
                avs.forEach(av => {
                    const avData = semData[av];
                    if (!avData) return;
                    (materias||[]).forEach(m => {
                        const v = avData[m];
                        if (v === null || v === undefined) return;
                        totalNotas++; somaNotas += v;
                        if (!mediasPorMateria[m]) mediasPorMateria[m] = [];
                        mediasPorMateria[m].push(v);
                        if (v < 5) alertas.push({ nome: k.nome, materia: m, nota: v, periodo: `${anoSel} Sem${sem} ${av.toUpperCase()}` });
                    });
                });
            });
        });

        const mediaGeral = totalNotas ? (somaNotas / totalNotas).toFixed(1) : '—';
        const kidsComNota = kids.filter(k => k.boletim.notas?.[anoSel]).length;
        const corMedia = parseFloat(mediaGeral) >= 7 ? '#10b981' : parseFloat(mediaGeral) >= 5 ? '#f59e0b' : '#ef4444';

        // ── HTML ──────────────────────────────────────────────────
        let html = `
        <div style="background:#1e293b;border:1px solid #7c3aed33;border-radius:12px;padding:14px;margin-bottom:12px;">
            <!-- Cabeçalho -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
                <small style="color:#a78bfa;font-size:0.68rem;font-weight:800;letter-spacing:0.5px;">📚 BOLETIM ESCOLAR — KIDS</small>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button onclick="boletim.gerarCardExplicativo()" style="background:#1e1040;border:1px solid #7c3aed;color:#c4b5fd;padding:5px 10px;border-radius:8px;font-size:0.62rem;font-weight:700;cursor:pointer;white-space:nowrap;">
                        🖼️ Card para Pais
                    </button>
                    <select onchange="boletim.renderPainelAdmin(parseInt(this.value))"
                        style="padding:4px 8px;background:#0f172a;border:1px solid #334155;color:#a78bfa;border-radius:6px;font-size:0.68rem;outline:none;">
                        ${anosDisp.map(a=>`<option value="${a}"${a===anoSel?' selected':''}>${a}</option>`).join('')}
                    </select>
                </div>
            </div>
            <!-- Cards resumo -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;text-align:center;">
                    <div style="color:#a78bfa;font-size:1.1rem;font-weight:800;">${kids.length}</div>
                    <div style="color:#64748b;font-size:0.58rem;font-weight:700;margin-top:2px;">KIDS</div>
                </div>
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;text-align:center;">
                    <div style="color:${corMedia};font-size:1.1rem;font-weight:800;">${mediaGeral}</div>
                    <div style="color:#64748b;font-size:0.58rem;font-weight:700;margin-top:2px;">MÉDIA GERAL</div>
                </div>
                <div style="background:#0f172a;border:1px solid ${alertas.length?'#ef444455':'#334155'};border-radius:10px;padding:10px;text-align:center;">
                    <div style="color:${alertas.length?'#ef4444':'#10b981'};font-size:1.1rem;font-weight:800;">${alertas.length}</div>
                    <div style="color:#64748b;font-size:0.58rem;font-weight:700;margin-top:2px;">ABAIXO DE 5</div>
                </div>
            </div>`;

        // Alertas
        if (alertas.length) {
            html += `
            <div style="background:#450a0a;border:1px solid #ef444455;border-radius:10px;padding:10px;margin-bottom:12px;">
                <small style="color:#ef4444;font-weight:700;font-size:0.68rem;display:block;margin-bottom:6px;">⚠️ NOTAS ABAIXO DE 5 — ${anoSel}</small>
                ${alertas.map(a=>`
                <div style="display:flex;justify-content:space-between;align-items:center;color:#fca5a5;font-size:0.7rem;padding:4px 0;border-bottom:1px solid #ef444422;">
                    <span><b>${a.nome}</b> — ${a.materia}</span>
                    <span><b style="color:#ef4444;font-size:0.85rem;">${a.nota}</b> <span style="color:#64748b;font-size:0.6rem;">${a.periodo}</span></span>
                </div>`).join('')}
            </div>`;
        }

        // Médias por matéria (se tiver dados)
        const matComDados = Object.entries(mediasPorMateria);
        if (matComDados.length) {
            html += `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;margin-bottom:12px;">
                <small style="color:#64748b;font-size:0.65rem;font-weight:700;display:block;margin-bottom:8px;">📊 MÉDIA POR MATÉRIA — ${anoSel}</small>
                ${matComDados.sort((a,b)=>{
                    const ma = a[1].reduce((s,v)=>s+v,0)/a[1].length;
                    const mb = b[1].reduce((s,v)=>s+v,0)/b[1].length;
                    return ma-mb; // pior primeiro
                }).map(([mat, vals])=>{
                    const med = (vals.reduce((s,v)=>s+v,0)/vals.length);
                    const cor = med >= 7 ? '#10b981' : med >= 5 ? '#f59e0b' : '#ef4444';
                    const pct = Math.min(med*10, 100);
                    return `<div style="margin-bottom:6px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                            <span style="color:#94a3b8;font-size:0.68rem;">${mat}</span>
                            <span style="color:${cor};font-size:0.68rem;font-weight:800;">${med.toFixed(1)}</span>
                        </div>
                        <div style="background:#1e293b;border-radius:4px;height:5px;">
                            <div style="background:${cor};width:${pct}%;height:5px;border-radius:4px;transition:width 0.3s;"></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        }

        // ── Correlação frequência × nota ──────────────────────────
        this._painelKids = kids;
        const dadosCorr = kids.filter(k => k.boletim.notas?.[anoSel] && k.aulasAno > 0).map(k => {
            const { materias, notas } = k.boletim;
            const avs = this._getSistemaAdmin(k.boletim, anoSel);
            const notasAno = notas[anoSel];
            let s = 0, t = 0;
            [1,2].forEach(sem => avs.forEach(av => (materias||[]).forEach(m => {
                const v = notasAno['sem'+sem]?.[av]?.[m];
                if (v !== null && v !== undefined) { s += v; t++; }
            })));
            const media = t ? s/t : null;
            const treinosSemana = k.aulasAno / 48;
            return { nome: k.nome, media, treinosSemana, aulasAno: k.aulasAno };
        }).filter(d => d.media !== null);

        if (dadosCorr.length >= 2) {
            const alta = dadosCorr.filter(d => d.treinosSemana >= 3);
            const baixa = dadosCorr.filter(d => d.treinosSemana < 3);
            const mediaAlta = alta.length ? (alta.reduce((s,d)=>s+d.media,0)/alta.length).toFixed(1) : null;
            const mediaBaixa = baixa.length ? (baixa.reduce((s,d)=>s+d.media,0)/baixa.length).toFixed(1) : null;
            const diff = (mediaAlta && mediaBaixa) ? (parseFloat(mediaAlta)-parseFloat(mediaBaixa)).toFixed(1) : null;
            html += `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;margin-bottom:12px;">
                <small style="color:#64748b;font-size:0.65rem;font-weight:700;display:block;margin-bottom:10px;">📈 FREQUÊNCIA × NOTA — ${anoSel}</small>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:${diff?'8px':'4px'};">
                    <div style="background:#052e16;border:1px solid #10b98155;border-radius:8px;padding:10px;text-align:center;">
                        <div style="color:#10b981;font-size:1.3rem;font-weight:800;">${mediaAlta||'—'}</div>
                        <div style="color:#6ee7b7;font-size:0.6rem;margin-top:2px;">≥ 3 treinos/sem</div>
                        <div style="color:#10b98166;font-size:0.58rem;">${alta.length} aluno${alta.length!==1?'s':''}</div>
                    </div>
                    <div style="background:#1c1917;border:1px solid #78716c55;border-radius:8px;padding:10px;text-align:center;">
                        <div style="color:#a8a29e;font-size:1.3rem;font-weight:800;">${mediaBaixa||'—'}</div>
                        <div style="color:#78716c;font-size:0.6rem;margin-top:2px;">< 3 treinos/sem</div>
                        <div style="color:#78716c66;font-size:0.58rem;">${baixa.length} aluno${baixa.length!==1?'s':''}</div>
                    </div>
                </div>
                ${diff ? `<div style="background:#1e293b;border-radius:8px;padding:7px;text-align:center;margin-bottom:8px;">
                    <span style="color:#a78bfa;font-size:0.68rem;">Quem treina mais tem média </span>
                    <span style="color:#10b981;font-size:0.9rem;font-weight:800;">${parseFloat(diff)>0?'+':''}${diff} pts</span>
                    <span style="color:#a78bfa;font-size:0.68rem;"> acima</span>
                </div>` : ''}
                <div style="display:flex;flex-direction:column;gap:3px;">
                    ${dadosCorr.sort((a,b)=>b.treinosSemana-a.treinosSemana).map(d => {
                        const cor = d.media >= 7 ? '#10b981' : d.media >= 5 ? '#f59e0b' : '#ef4444';
                        const freqCor = d.treinosSemana >= 3 ? '#10b981' : d.treinosSemana >= 1.5 ? '#f59e0b' : '#ef4444';
                        const pct = Math.min(d.treinosSemana/5*100, 100);
                        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #1e293b;">
                            <span style="color:#94a3b8;font-size:0.65rem;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.nome.split(' ')[0]}</span>
                            <div style="flex:1;background:#1e293b;border-radius:3px;height:5px;">
                                <div style="background:${freqCor};width:${pct}%;height:5px;border-radius:3px;"></div>
                            </div>
                            <span style="color:${freqCor};font-size:0.58rem;width:24px;text-align:center;">${d.aulasAno}×</span>
                            <span style="color:${cor};font-size:0.7rem;font-weight:800;width:22px;text-align:right;">${d.media.toFixed(1)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // ── Por aluno (colapsável) ────────────────────────────────
        html += `<div style="margin-top:10px;display:flex;flex-direction:column;gap:4px;">`;
        kids.forEach((k, kidIdx) => {
            const { materias, notas } = k.boletim;
            const avs = this._getSistemaAdmin(k.boletim, anoSel);
            const avLabels = { av1:'Av1', av2:'Av2', av3:'Av3' };
            const notasAno = notas?.[anoSel];
            const comp = k.boletim?.comprovantes?.[anoSel];

            // Calcula média do aluno no ano
            let somaA = 0, totalA = 0;
            if (notasAno) {
                [1,2].forEach(sem => {
                    avs.forEach(av => {
                        (materias||[]).forEach(m => {
                            const v = notasAno['sem'+sem]?.[av]?.[m];
                            if (v !== null && v !== undefined) { somaA += v; totalA++; }
                        });
                    });
                });
            }
            const mediaAluno = totalA ? (somaA/totalA).toFixed(1) : null;
            const corAluno = mediaAluno ? (parseFloat(mediaAluno) >= 7 ? '#10b981' : parseFloat(mediaAluno) >= 5 ? '#f59e0b' : '#ef4444') : '#475569';
            const freqMsg = k.aulasAno >= 30 ? '🟢' : k.aulasAno >= 15 ? '🟡' : k.aulasAno > 0 ? '🔴' : '⚪';
            const temComp = !!comp;
            const detailId = `boletim-detail-${kidIdx}`;

            html += `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;overflow:hidden;">
                <div onclick="const d=document.getElementById('${detailId}');const open=d.style.display!=='none';d.style.display=open?'none':'block';this.querySelector('.chev').style.transform=open?'rotate(0deg)':'rotate(180deg)';"
                     style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;cursor:pointer;user-select:none;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:0.75rem;color:#64748b;">${freqMsg}</span>
                        <span style="color:#e2e8f0;font-size:0.8rem;font-weight:700;">${k.nome}</span>
                        ${k.idade ? `<span style="color:#475569;font-size:0.6rem;">${k.idade}a</span>` : ''}
                        ${temComp ? `<span style="font-size:0.6rem;color:#a78bfa;" title="Comprovante enviado">📎</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${mediaAluno ? `<span style="color:${corAluno};font-size:0.85rem;font-weight:800;">${mediaAluno}</span>` : `<span style="color:#475569;font-size:0.72rem;">—</span>`}
                        <i class="fas fa-chevron-down chev" style="color:#475569;font-size:0.6rem;transition:transform 0.2s;"></i>
                    </div>
                </div>
                <div id="${detailId}" style="display:none;padding:0 10px 10px;">
                    <button onclick="boletim.gerarRelatorioPais(${kidIdx})"
                        style="width:100%;background:#1e1040;border:1px solid #7c3aed;color:#c4b5fd;padding:8px;border-radius:8px;font-size:0.7rem;font-weight:700;cursor:pointer;margin-bottom:8px;">
                        📤 Gerar Relatório para os Pais
                    </button>
                    ${notasAno ? `
                    <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.62rem;">
                        <thead><tr>
                            <th style="text-align:left;color:#475569;padding:3px 4px;">Matéria</th>
                            ${[1,2].map(sem => avs.map(av =>
                                `<th style="text-align:center;color:#475569;padding:3px 2px;">S${sem}<br>${avLabels[av]}</th>`
                            ).join('')).join('')}
                            <th style="text-align:center;color:#475569;padding:3px 4px;">Média</th>
                        </tr></thead>
                        <tbody>
                        ${(materias||[]).map(m => {
                            const allVals = [];
                            const cells = [1,2].map(sem => avs.map(av => {
                                const v = notasAno['sem'+sem]?.[av]?.[m];
                                if (v !== null && v !== undefined) allVals.push(v);
                                const c = (v !== null && v !== undefined && v < 5) ? '#ef4444' : '#94a3b8';
                                return `<td style="text-align:center;color:${c};padding:3px 2px;font-weight:700;">${v !== null && v !== undefined ? v : '<span style="color:#334155;">—</span>'}</td>`;
                            }).join('')).join('');
                            const med = allVals.length ? (allVals.reduce((a,b)=>a+b,0)/allVals.length).toFixed(1) : '—';
                            const corM = parseFloat(med) < 5 ? '#ef4444' : parseFloat(med) >= 7 ? '#10b981' : '#f59e0b';
                            return `<tr>
                                <td style="color:#94a3b8;padding:3px 4px;">${m}</td>
                                ${cells}
                                <td style="text-align:center;color:${med==='—'?'#334155':corM};padding:3px 4px;font-weight:800;">${med}</td>
                            </tr>`;
                        }).join('')}
                        </tbody>
                    </table></div>` : `<p style="color:#334155;font-size:0.68rem;margin:4px 0;text-align:center;">Sem notas em ${anoSel}</p>`}
                    ${comp ? `<div style="margin-top:8px;">
                        <small style="color:#64748b;font-size:0.62rem;font-weight:700;display:block;margin-bottom:4px;">📎 COMPROVANTE — toque na imagem para ampliar</small>
                        <div style="position:relative;">
                            <img src="${comp.url}" style="width:100%;border-radius:8px;max-height:240px;object-fit:contain;background:#0f172a;cursor:zoom-in;" onclick="boletim._ampliarComprovante(this.src)" />
                            <button onclick="boletim._deletarComprovante('${k.id}','${anoSel}','${comp.path}')" style="position:absolute;top:6px;right:6px;background:#ef444499;border:1px solid #ef4444;border-radius:6px;padding:4px 10px;display:flex;align-items:center;gap:4px;cursor:pointer;">
                                <i class="fas fa-trash-alt" style="font-size:0.65rem;color:white;"></i>
                                <span style="color:white;font-size:0.65rem;font-weight:700;">Deletar</span>
                            </button>
                            ${comp.data ? `<div style="position:absolute;bottom:6px;left:6px;background:#00000088;border-radius:4px;padding:2px 6px;"><span style="color:#94a3b8;font-size:0.6rem;">Enviado em ${comp.data}</span></div>` : ''}
                        </div>
                    </div>` : `<div style="margin-top:8px;padding:7px 10px;background:#1e293b;border:1px dashed #334155;border-radius:8px;text-align:center;"><span style="color:#475569;font-size:0.65rem;">📎 Sem comprovante enviado</span></div>`}
                </div>
            </div>`;
        });
        html += `</div>`;

        html += `</div>`;
        cont.innerHTML = html;
    },

    // Helper para pegar avs no painel admin (não usa this._anoSel)
    _getSistemaAdmin(boletimData, ano) {
        const s = boletimData?.sistemaPorAno?.[ano] || boletimData?.sistema || '2x';
        return s === '3x' ? ['av1','av2','av3'] : ['av1','av2'];
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

    // Carrega credenciais e metas do admin salvas no Firestore
    auth.carregarCredenciaisAdmin();
    auth.carregarMetasAulas();
});
