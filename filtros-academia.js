/**
 * GADITAS MATRIZ - Extensão Unificada V14: Multi-Faturas Asaas & Suporte a Complemento/Edifício
 * Sincronizado para gerenciar endereço completo com CEP e Complemento (Apt, Bloco, Prédio) no Firebase e Asaas.
 * ORDENAÇÃO: Faturas ordenadas da mais antiga/vencida para a mais nova no topo.
 * SEGURANÇA: Bloqueio automático de check-in para inadimplência superior a 3 dias.
 */

const GaditasFiltros = {
    faixaFiltroAtual: "all",
    asaasUrl: "/api/asaas", 
    cobrancasAbertas: [],
    statusBloqueado: false, // 🆕 Rastreia se o aluno atual está travado por débito

    init() {
        if (typeof ui !== 'undefined' && ui.showTab) {
            const originalShowTab = ui.showTab;
            ui.showTab = function(id) {
                document.querySelectorAll('.nav-item').forEach(btn => {
                    btn.classList.remove('active');
                    btn.style.color = "var(--text-muted)";
                });
                const btnFin = document.getElementById('nav-financeiro');
                
                if (id === 'tab-financeiro') {
                    document.querySelectorAll('.tab-content, .container').forEach(c => {
                        if(c.id !== 'screen-dashboard') c.classList.add('hidden');
                    });

                    if (typeof auth !== 'undefined' && auth.role === 'admin' && typeof GaditasPainelAdm !== 'undefined') {
                        // Admin vê painel de inadimplência
                        let tabFin = document.getElementById('tab-financeiro');
                        if (!tabFin) {
                            tabFin = document.createElement('div');
                            tabFin.id = 'tab-financeiro';
                            tabFin.className = 'tab-content';
                            tabFin.style.cssText = 'padding:15px; padding-bottom:120px;';
                            document.getElementById('screen-dashboard').appendChild(tabFin);
                        }
                        tabFin.classList.remove('hidden');
                        if (btnFin) { btnFin.classList.add('active'); btnFin.style.color = "#3b82f6"; }
                        GaditasPainelAdm.carregar();
                    } else {
                        // Aluno vê suas faturas (ou card de dependente)
                        let tabFin = document.getElementById('tab-financeiro');
                        if (!tabFin) tabFin = GaditasFiltros.criarTelaFinanceiraMovel();
                        tabFin.classList.remove('hidden');
                        if (btnFin) { btnFin.classList.add('active'); btnFin.style.color = "#3b82f6"; }

                        // Dependente de plano família — não tem financeiro próprio
                        if (auth.currentUser?.responsavelId) {
                            GaditasFiltros.renderTelaFinanceiroDependente();
                        } else {
                            GaditasFiltros.carregarDadosFinanceirosReal();
                        }
                    }
                } else {
                    const tabFin = document.getElementById('tab-financeiro');
                    if (tabFin) tabFin.classList.add('hidden');
                    originalShowTab.apply(this, arguments);
                    setTimeout(() => {
                        const activeNav = document.querySelector('.nav-item.active');
                        if (activeNav) activeNav.style.color = "#3b82f6";
                    }, 50);
                }
                if (id === 'tab-alunos') GaditasFiltros.injetarElementosVisuais();
            };
        }

        setInterval(() => {
            const wrapper = document.getElementById('wrapper-perfil-proprio');
            if (wrapper && typeof auth !== 'undefined' && auth.currentUser) {
                if (auth.role === 'admin') {
                    wrapper.classList.add('hidden');
                } else {
                    wrapper.classList.remove('hidden');
                }
            }
            GaditasFiltros.injetarBotaoRodapeNativo();
        }, 1000);

        if (typeof academia !== 'undefined') {
            const originalSalvarAluno = academia.salvarAluno;
            academia.salvarAluno = async function() {
                const id = document.getElementById('edit-aluno-id').value;
                const cpfValue = document.getElementById('cpf-aluno') ? document.getElementById('cpf-aluno').value.replace(/\D/g, '') : "";
                const telValue = document.getElementById('telefone-aluno') ? document.getElementById('telefone-aluno').value.replace(/\D/g, '') : "";
                const cepValue = document.getElementById('cep-aluno') ? document.getElementById('cep-aluno').value.replace(/\D/g, '') : "";
                const ruaValue = document.getElementById('rua-aluno') ? document.getElementById('rua-aluno').value.trim() : "";
                const numValue = document.getElementById('numero-aluno') ? document.getElementById('numero-aluno').value.trim() : "";
                const compValue = document.getElementById('complemento-aluno') ? document.getElementById('complemento-aluno').value.trim() : "";
                const baiValue = document.getElementById('bairro-aluno') ? document.getElementById('bairro-aluno').value.trim() : "";
                const cidValue = document.getElementById('cidade-aluno') ? document.getElementById('cidade-aluno').value.trim() : "";
                const estValue = document.getElementById('estado-aluno') ? document.getElementById('estado-aluno').value.trim().toUpperCase() : "";

                await originalSalvarAluno.apply(this, arguments);

                const upData = {};
                if (cpfValue) upData.cpf = cpfValue;
                if (telValue) upData.telefone = telValue;
                if (cepValue) upData.cep = cepValue;
                if (ruaValue) upData.rua = ruaValue;
                if (numValue) upData.numero = numValue;
                if (compValue) upData.complemento = compValue;
                if (baiValue) upData.bairro = baiValue;
                if (cidValue) upData.cidade = cidValue;
                if (estValue) upData.estado = estValue;

                if (Object.keys(upData).length > 0) {
                    if (id) {
                        await db.collection("alunos").doc(id).update(upData);
                    }
                }
            };

            const originalEditarAluno = academia.editarAluno;
            academia.editarAluno = async function(id) {
                await originalEditarAluno.apply(this, arguments);
                const campos = ['cpf-aluno', 'telefone-aluno', 'cep-aluno', 'rua-aluno', 'numero-aluno', 'complemento-aluno', 'bairro-aluno', 'cidade-aluno', 'estado-aluno'];
                campos.forEach(c => { if(document.getElementById(c)) document.getElementById(c).value = ""; });

                const doc = await db.collection("alunos").doc(id).get();
                if (doc.exists) {
                    const d = doc.data();
                    if (d.cpf && document.getElementById('cpf-aluno')) document.getElementById('cpf-aluno').value = d.cpf;
                    if (d.telefone && document.getElementById('telefone-aluno')) document.getElementById('telefone-aluno').value = d.telefone;
                    if (d.cep && document.getElementById('cep-aluno')) document.getElementById('cep-aluno').value = d.cep;
                    if (d.rua && document.getElementById('rua-aluno')) document.getElementById('rua-aluno').value = d.rua;
                    if (d.numero && document.getElementById('numero-aluno')) document.getElementById('numero-aluno').value = d.numero;
                    if (d.complemento && document.getElementById('complemento-aluno')) document.getElementById('complemento-aluno').value = d.complemento;
                    if (d.bairro && document.getElementById('bairro-aluno')) document.getElementById('bairro-aluno').value = d.bairro;
                    if (d.cidade && document.getElementById('cidade-aluno')) document.getElementById('cidade-aluno').value = d.cidade;
                    if (d.estado && document.getElementById('estado-aluno')) document.getElementById('estado-aluno').value = d.estado;
                }
            };
        }
    },

    async buscarCEPAdmin(valor) {
        const cep = valor.replace(/\D/g, "");
        if (cep.length !== 8) return;

        try {
            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const data = await response.json();
            
            if (!data.erro) {
                if (document.getElementById('rua-aluno')) document.getElementById('rua-aluno').value = data.logradouro;
                if (document.getElementById('bairro-aluno')) document.getElementById('bairro-aluno').value = data.bairro;
                if (document.getElementById('cidade-aluno')) document.getElementById('cidade-aluno').value = data.localidade;
                if (document.getElementById('estado-aluno')) document.getElementById('estado-aluno').value = data.uf;
                if (document.getElementById('numero-aluno')) document.getElementById('numero-aluno').focus();
            }
        } catch (err) {
            console.error("Erro ao buscar CEP", err);
        }
    },

    injetarBotaoRodapeNativo() {
        if (document.getElementById('nav-financeiro')) return;
        // Professor não vê o financeiro
        if (typeof auth !== 'undefined' && auth.role === 'professor') return;
        const nav = document.querySelector('.bottom-nav');
        if (nav) {
            const btn = document.createElement('button');
            btn.id = 'nav-financeiro'; btn.className = 'nav-item';
            btn.style = 'background: transparent; border: none; color: #94a3b8; display: flex; flex-direction: column; align-items: center; font-size: 0.65rem; cursor: pointer; flex: 1;';
            btn.setAttribute('onclick', "ui.showTab('tab-financeiro')");
            btn.innerHTML = `<i class="fas fa-dollar-sign" style="font-size: 1.2rem; margin-bottom: 4px;"></i><span>FINANCEIRO</span>`;
            nav.insertBefore(btn, nav.children[2]);
        }
    },

    redimensionarImagem(file, maxSize = 400) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
                    else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(resolve, 'image/jpeg', 0.8);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    async uploadFotoPerfil(alunoId) {
        const input = document.getElementById('input-foto-perfil');
        if (!input || !input.files || !input.files[0]) return alert("Nenhuma foto selecionada.");
        const file = input.files[0];
        const btnUpload = document.getElementById('btn-upload-foto');
        if (btnUpload) { btnUpload.innerText = "Enviando..."; btnUpload.disabled = true; }
        try {
            if (typeof firebase.storage !== 'function') return alert("Firebase Storage não carregado.");
            const blobReduzido = await this.redimensionarImagem(file, 400);
            const storage = firebase.storage();
            const storageRef = storage.ref().child(`fotos_perfil/${alunoId}.jpg`);
            const snapshot = await storageRef.put(blobReduzido, { contentType: 'image/jpeg' });
            const url = await snapshot.ref.getDownloadURL();
            await db.collection("alunos").doc(alunoId).update({ fotoPerfil: url });
            const imgEl = document.getElementById('foto-perfil-preview');
            if (imgEl) imgEl.src = url;
            GaditasFiltros.atualizarFotoHeader(url);
            alert("✅ Foto atualizada com sucesso! OSS!");
        } catch (e) {
            alert("Erro ao enviar foto: " + e.message);
        } finally {
            if (btnUpload) { btnUpload.innerText = "ENVIAR FOTO"; btnUpload.disabled = false; }
        }
    },

    atualizarFotoHeader(url) {
        if (!url) return;
        const headerUser = document.querySelector('.header-user');
        if (!headerUser) return;
        const iconExistente = headerUser.querySelector('i.fa-user-circle');
        const fotoExistente = headerUser.querySelector('img.foto-header');
        const img = document.createElement('img');
        img.src = url;
        img.className = 'foto-header';
        img.style.cssText = 'width:38px; height:38px; border-radius:50%; object-fit:cover; border:2px solid #3b82f6; flex-shrink:0;';
        if (iconExistente) iconExistente.replaceWith(img);
        else if (fotoExistente) fotoExistente.src = url;
        else headerUser.insertBefore(img, headerUser.firstChild);
    },

    async abrirFormPerfilAlunoHome() {
        const container = document.getElementById('home-perfil-container');
        if (!container) return;

        if (!container.classList.contains('hidden')) {
            container.classList.add('hidden');
            return;
        }

        container.innerHTML = `<div style="color:#64748b; text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Buscando seus dados...</div>`;
        container.classList.remove('hidden');

        try {
            const doc = await db.collection("alunos").doc(auth.currentUser.id).get();
            const d = doc.exists ? doc.data() : {};

            const fotoAtual = d.fotoPerfil || '';
            container.innerHTML = `
                <div style="padding: 0;">
                    <span style="font-size: 0.7rem; font-weight: 800; color: #60a5fa; display: block; margin-bottom: 12px; text-transform: uppercase;"><i class="fas fa-id-card"></i> Atualizar Informações de Perfil</span>

                    <!-- FOTO DE PERFIL -->
                    <div style="text-align:center; margin-bottom:16px;">
                        <img id="foto-perfil-preview" src="${fotoAtual || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(d.nome || 'A') + '&background=1e3a8a&color=fff&size=120'}"
                            style="width:90px; height:90px; border-radius:50%; object-fit:cover; border:3px solid #3b82f6; display:block; margin:0 auto 10px auto;"/>
                        <input type="file" id="input-foto-perfil" accept="image/*" style="display:none;"/>
                        <button id="btn-escolher-foto" style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:8px 16px; border-radius:8px; font-size:0.7rem; font-weight:700; cursor:pointer; margin-bottom:8px;">
                            <i class="fas fa-camera"></i> ESCOLHER FOTO
                        </button>
                        <br/>
                        <button id="btn-upload-foto" style="display:none; margin-top:6px; padding:10px 24px; background:#3b82f6; border:none; color:white; border-radius:8px; font-size:0.75rem; font-weight:800; cursor:pointer;">
                            <i class="fas fa-upload"></i> ENVIAR FOTO
                        </button>
                    </div>

                    <!-- CPF — somente leitura -->
                    <small style="color:#64748b; font-size:0.6rem; font-weight:800; display:block; margin-bottom:2px;">CPF <span style="color:#f43f5e;">(somente o administrador pode alterar)</span></small>
                    <input type="text" value="${d.cpf ? d.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : ''}" readonly disabled
                        style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0a0f1a; border: 1px solid #1e293b; border-radius: 8px; color:#475569; width:100%; outline:none; cursor:not-allowed;">

                    <input type="text" id="my-cpf" placeholder="CPF" value="${d.cpf || ''}" maxlength="14" style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; width:100%; outline:none;">
                    <input type="text" id="my-telefone" placeholder="Telefone com DDD" value="${d.telefone || ''}" maxlength="15" style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; width:100%; outline:none;">
                    <input type="text" id="my-cep" placeholder="CEP" value="${d.cep || ''}" maxlength="9" style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; width:100%; outline:none;">
                    <input type="text" id="my-rua" placeholder="Rua / Logradouro" value="${d.rua || ''}" style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; width:100%; outline:none;">
                    
                    <div style="display:flex; gap:8px; margin-bottom:10px;">
                        <input type="text" id="my-numero" placeholder="Nº" value="${d.numero || ''}" style="font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; flex:1; outline:none; margin:0;">
                        <input type="text" id="my-bairro" placeholder="Bairro" value="${d.bairro || ''}" style="font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; flex:2; outline:none; margin:0;">
                    </div>

                    <input type="text" id="my-complemento" placeholder="Complemento (Ex: Apt 402, Bloco C, Edifício Solar)" value="${d.complemento || ''}" style="margin-bottom: 10px; font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; width:100%; outline:none;">

                    <div style="display:flex; gap:8px; margin-bottom:14px;">
                        <input type="text" id="my-cidade" placeholder="Cidade" value="${d.cidade || ''}" style="font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; flex:3; outline:none; margin:0;">
                        <input type="text" id="my-estado" placeholder="UF" maxlength="2" value="${d.estado || ''}" style="font-size: 0.8rem; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color:#fff; flex:1; outline:none; text-align:center; text-transform:uppercase; margin:0;">
                    </div>
                    <button onclick="GaditasFiltros.salvarPerfilAlunoProprioHome()" class="btn-login" style="background: #10b981; margin: 0; font-size: 0.75rem; padding: 12px; width:100%; border:none; border-radius:8px; color:white; font-weight:700; cursor:pointer;"><i class="fas fa-check"></i> SALVAR ALTERAÇÕES</button>
                </div>
            `;

            // Eventos da foto
            const btnEscolher = document.getElementById('btn-escolher-foto');
            const inputFoto = document.getElementById('input-foto-perfil');
            const btnEnviar = document.getElementById('btn-upload-foto');
            if (btnEscolher && inputFoto) {
                btnEscolher.addEventListener('click', () => inputFoto.click());
                inputFoto.addEventListener('change', () => {
                    if (!inputFoto.files || !inputFoto.files[0]) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = document.getElementById('foto-perfil-preview');
                        if (img) img.src = e.target.result;
                        if (btnEnviar) btnEnviar.style.display = 'inline-block';
                    };
                    reader.readAsDataURL(inputFoto.files[0]);
                });
            }
            if (btnEnviar) {
                btnEnviar.addEventListener('click', () => GaditasFiltros.uploadFotoPerfil(auth.currentUser.id));
            }

            document.getElementById('my-cpf').addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g, "");
                v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                e.target.value = v;
            });
            document.getElementById('my-telefone').addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g, "");
                v = v.replace(/^(\d{2})(\d)/g, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
                e.target.value = v;
            });
            document.getElementById('my-cep').addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g, "");
                e.target.value = v.replace(/^(\d{5})(\d)/, "$1-$2");
            });
            document.getElementById('my-cep').addEventListener('blur', async (e) => {
                const cep = e.target.value.replace(/\D/g, ""); if (cep.length !== 8) return;
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    document.getElementById('my-rua').value = data.logradouro;
                    document.getElementById('my-bairro').value = data.bairro;
                    document.getElementById('my-cidade').value = data.localidade;
                    document.getElementById('my-estado').value = data.uf;
                    document.getElementById('my-numero').focus();
                }
            });

        } catch (err) { console.error(err); }
    },

    async salvarPerfilAlunoProprioHome() {
        const cpf = document.getElementById('my-cpf').value.replace(/\D/g, '');
        const telefone = document.getElementById('my-telefone').value.replace(/\D/g, '');
        const cep = document.getElementById('my-cep').value.replace(/\D/g, '');
        const rua = document.getElementById('my-rua').value.trim();
        const numero = document.getElementById('my-numero').value.trim();
        const complemento = document.getElementById('my-complemento') ? document.getElementById('my-complemento').value.trim() : "";
        const bairro = document.getElementById('my-bairro').value.trim();
        const cidade = document.getElementById('my-cidade').value.trim();
        const estado = document.getElementById('my-estado').value.trim().toUpperCase();

        if (!cpf || !telefone || !cep || !rua || !numero || !bairro || !cidade || !estado) {
            alert("Preencha os campos obrigatórios para salvar.");
            return;
        }

        try {
            // Unificado e corrigido de 'city' para 'cidade' para manter consistência total com o banco
            const upData = { cpf, telefone, cep, rua, numero, complemento, bairro, cidade, estado };
            await db.collection("alunos").doc(auth.currentUser.id).update(upData);
            alert("Dados salvos com sucesso no teu perfil! OSS.");
            document.getElementById('home-perfil-container').classList.add('hidden');
        } catch(e) { alert("Erro ao gravar alterações."); }
    },

    async renderTelaFinanceiroDependente() {
        const conteudo = document.getElementById('financeiro-conteudo');
        if (!conteudo) return;
        if (document.getElementById('financeiro-loading')) document.getElementById('financeiro-loading').classList.add('hidden');

        let nomeResponsavel = 'Titular do plano';
        try {
            const doc = await db.collection('alunos').doc(auth.currentUser.responsavelId).get();
            if (doc.exists) nomeResponsavel = doc.data().nome || nomeResponsavel;
        } catch(e) {}

        conteudo.classList.remove('hidden');
        conteudo.innerHTML = `
            <div style="text-align:center; padding:24px 16px; background:linear-gradient(135deg,#0c1a3a,#1e293b); border:1px solid #3b82f655; border-radius:16px;">
                <div style="font-size:2rem; margin-bottom:10px;">👨‍👩‍👧‍👦</div>
                <div style="font-size:0.55rem; color:#60a5fa; font-weight:800; letter-spacing:1.2px; margin-bottom:6px;">PLANO FAMÍLIA</div>
                <div style="font-size:0.95rem; font-weight:800; color:white; margin-bottom:8px;">Pagamento Gerenciado pelo Titular</div>
                <div style="background:#0f172a; border-radius:10px; padding:10px 14px; margin:10px 0; text-align:left;">
                    <div style="font-size:0.58rem; color:#64748b; font-weight:700; margin-bottom:3px;">TITULAR DO PLANO:</div>
                    <div style="font-size:0.85rem; font-weight:800; color:#60a5fa;">${nomeResponsavel.toUpperCase()}</div>
                </div>
                <div style="font-size:0.68rem; color:#475569; line-height:1.6;">
                    Você faz parte de um plano família.<br>
                    O pagamento é de responsabilidade do titular.
                </div>
            </div>`;
    },

    criarTelaFinanceiraMovel() {
        let tab = document.getElementById('tab-financeiro'); if (tab) return tab;
        const mainContent = document.getElementById('screen-dashboard');
        tab = document.createElement('div'); tab.id = 'tab-financeiro'; tab.className = 'tab-content hidden'; tab.style = 'padding: 15px; padding-bottom: 120px;';
        tab.innerHTML = `
            <div style="padding: 4px 0 18px;">
                <div style="font-size: 0.55rem; color: #475569; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 3px;">Gaditas Matriz</div>
                <div style="font-size: 1.05rem; font-weight: 800; color: #f8fafc; letter-spacing: -0.3px;">
                    <i class="fas fa-wallet" style="color: #3b82f6; margin-right: 8px; font-size: 0.9rem;"></i>MEU FINANCEIRO
                </div>
            </div>
            <div style="background:#1e293b; border:1px solid #2d3f55; border-radius:20px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.4); margin-bottom:14px;">
                <div style="height:3px; background:linear-gradient(90deg,#3b82f6,#8b5cf6);"></div>
                <div style="padding:16px;">
                    <div style="font-size:0.58rem; color:#64748b; font-weight:800; letter-spacing:0.8px; text-transform:uppercase; margin-bottom:12px;">SITUAÇÃO FINANCEIRA</div>
                    <div id="financeiro-loading" style="color:#64748b; text-align:center; font-size:0.82rem; padding:20px 0;">
                        <i class="fas fa-spinner fa-spin" style="display:block; font-size:1.4rem; color:#3b82f6; margin-bottom:8px;"></i>Consultando cobranças...
                    </div>
                    <div id="financeiro-conteudo" class="hidden"></div>
                </div>
            </div>
        `;
        mainContent.appendChild(tab); return tab;
    },

    // 🆕 FUNÇÃO DE CONFIANÇA SILENCIOSA PARA VERIFICAR BLOQUEIO DE INADIMPLÊNCIA ANTES DO CHECK-IN
    async verificarBloqueioInadimplencia(emailAtleta) {
        try {
            const resCliente = await fetch(`${this.asaasUrl}?endpoint=customers&email=${encodeURIComponent(emailAtleta.trim())}`);
            const dadosCliente = await resCliente.json();
            if (!dadosCliente.data || dadosCliente.data.length === 0) return false;

            const customerId = dadosCliente.data[0].id;
            const resCobrancas = await fetch(`${this.asaasUrl}?endpoint=payments&customer=${customerId}&status=PENDING&limit=20`);
            const dadosCobrancas = await resCobrancas.json();
            if (!dadosCobrancas.data || dadosCobrancas.data.length === 0) {
                this.statusBloqueado = false; return false;
            }

            const dataHoje = new Date(); dataHoje.setHours(0,0,0,0);
            let bloqueado = false;

            dadosCobrancas.data.forEach(cobranca => {
                const dataFatura = new Date(cobranca.dueDate + "T00:00:00"); dataFatura.setHours(0,0,0,0);
                // Calcula a diferença em dias corridos entre hoje e o vencimento
                const diferencaTempo = dataHoje.getTime() - dataFatura.getTime();
                const diferencaDias = Math.floor(diferencaTempo / (1000 * 60 * 60 * 24));

                // 🟥 Trava activa: Se a fatura está vencida há mais de 3 dias
                if (diferencaDias > 3) { bloqueado = true; }
            });

            this.statusBloqueado = bloqueado;
            return bloqueado;
        } catch (e) {
            console.error("Falha ao verificar inadimplência preventivamente", e);
            return this.statusBloqueado; // Em caso de erro de API, mantém o último status conhecido por segurança
        }
    },

    async carregarDadosFinanceirosReal() {
        const conteudo = document.getElementById('financeiro-conteudo');
        if (!conteudo) return;
        if(document.getElementById('financeiro-loading')) document.getElementById('financeiro-loading').classList.remove('hidden'); 
        conteudo.classList.add('hidden');

        try {
            const emailAtleta = auth.currentUser.email.trim();
            const resCliente = await fetch(`${this.asaasUrl}?endpoint=customers&email=${encodeURIComponent(emailAtleta)}`);
            const dadosCliente = await resCliente.json();

            if (!dadosCliente.data || dadosCliente.data.length === 0) {
                if(document.getElementById('financeiro-loading')) document.getElementById('financeiro-loading').classList.add('hidden'); 
                conteudo.classList.remove('hidden');
                conteudo.innerHTML = `<p style="text-align:center; color:var(--text-secondary); font-size:0.8rem; padding:15px;"><i class="fas fa-user-slash" style="color:#f59e0b; display:block; font-size:1.5rem; margin-bottom:8px;"></i>Atleta não localizado no Asaas.</p>`;
                return;
            }

            const customerId = dadosCliente.data[0].id;
            const resCobrancas = await fetch(`${this.asaasUrl}?endpoint=payments&customer=${customerId}&status=PENDING&limit=20`);
            const dadosCobrancas = await resCobrancas.json();

            if(document.getElementById('financeiro-loading')) document.getElementById('financeiro-loading').classList.add('hidden'); 
            conteudo.classList.remove('hidden');

            if (!dadosCobrancas.data || dadosCobrancas.data.length === 0) {
                this.statusBloqueado = false;
                conteudo.innerHTML = `
                    <div style="text-align:center; padding:24px 16px; background:linear-gradient(135deg,#064e3b,#065f46); border:1px solid #10b981; border-radius:16px; margin-bottom:12px;">
                        <div style="font-size:2.2rem; margin-bottom:10px;">✅</div>
                        <div style="font-size:0.55rem; color:#34d399; font-weight:800; letter-spacing:1.2px; margin-bottom:6px;">SITUAÇÃO FINANCEIRA</div>
                        <div style="font-size:1.1rem; font-weight:800; color:white;">MENSALIDADE EM DIA!</div>
                        <div style="font-size:0.72rem; color:#6ee7b7; margin-top:6px; font-weight:500;">Continue assim, campeão! 💪</div>
                    </div>
                    <button onclick="GaditasFiltros.carregarHistoricoPagamentos()" style="width:100%; padding:13px; background:#1e293b; border:1px solid #334155; color:#94a3b8; border-radius:14px; font-size:0.75rem; font-weight:700; cursor:pointer; letter-spacing:0.3px;">
                        <i class="fas fa-history" style="margin-right:6px;"></i>VER HISTÓRICO DE PAGAMENTOS
                    </button>`;
                return;
            }

            dadosCobrancas.data.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

            this.cobrancasAbertas = dadosCobrancas.data;
            let htmlFaturas = `<div style="font-size:0.55rem; color:#f59e0b; font-weight:800; letter-spacing:0.8px; margin-bottom:14px; display:flex; align-items:center; gap:6px;"><i class="fas fa-exclamation-triangle"></i>${this.cobrancasAbertas.length} FATURA(S) PENDENTE(S)</div>`;
            
            const dataHoje = new Date(); dataHoje.setHours(0,0,0,0);
            let algumBloqueioAtivo = false;

            this.cobrancasAbertas.forEach((cobranca) => {
                const valorFormatado = cobranca.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const dataVencimento = cobranca.dueDate.split('-').reverse().join('/');
                const dataFatura = new Date(cobranca.dueDate + "T00:00:00"); dataFatura.setHours(0,0,0,0);

                const diferencaTempo = dataHoje.getTime() - dataFatura.getTime();
                const diferencaDias = Math.floor(diferencaTempo / (1000 * 60 * 60 * 24));

                let corFundo = "#064e3b"; let corBorda = "#10b981"; let corTextoTag = "#34d399"; let textoTag = "⏳ MENSALIDADE A VENCER";
                
                if (dataFatura.getTime() < dataHoje.getTime()) {
                    corFundo = "#4c0519"; corBorda = "#f43f5e"; corTextoTag = "#f43f5e"; 
                    // Se passou de 3 dias, destaca que o aplicativo bloqueou o check-in
                    if (diferencaDias > 3) {
                        textoTag = `⚠️ BLOQUEADO (VENCIDO HÁ ${diferencaDias} DIAS)`; algumBloqueioAtivo = true;
                    } else {
                        textoTag = `⚠️ MENSALIDADE VENCIDA (ATRASO: ${diferencaDias}D)`;
                    }
                } else if (dataFatura.getTime() === dataHoje.getTime()) {
                    corFundo = "#451a03"; corBorda = "#f59e0b"; corTextoTag = "#fbbf24"; textoTag = "⚡ VENCE HOJE!";
                }

                htmlFaturas += `
                    <div style="background:${corFundo}; border:1px solid ${corBorda}; border-radius:20px; overflow:hidden; margin-bottom:14px; box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <div style="padding:12px 16px 10px; border-bottom:1px solid ${corBorda}44; display:flex; align-items:center; justify-content:space-between;">
                            <span style="font-size:0.52rem; font-weight:800; color:${corTextoTag}; letter-spacing:0.8px;">${textoTag}</span>
                            <span style="font-size:0.55rem; font-weight:700; color:#94a3b8;">VENCE ${dataVencimento}</span>
                        </div>
                        <div style="padding:16px 16px 14px; display:flex; justify-content:space-between; align-items:flex-end;">
                            <div>
                                <div style="font-size:0.55rem; color:#64748b; font-weight:700; margin-bottom:4px; letter-spacing:0.5px;">VALOR DA FATURA</div>
                                <div style="font-size:1.9rem; font-weight:800; color:white; letter-spacing:-1px; line-height:1;">${valorFormatado}</div>
                            </div>
                            <div style="background:rgba(0,0,0,0.2); border-radius:10px; padding:6px 10px; text-align:center;">
                                <i class="fas fa-file-invoice-dollar" style="color:${corTextoTag}; font-size:1.2rem;"></i>
                            </div>
                        </div>
                        <div style="display:flex; gap:8px; padding:0 14px 14px;">
                            <button onclick="GaditasFiltros.gerarPixReal('${cobranca.id}')" style="flex:1; background:#10b981; border:none; padding:12px; color:white; font-weight:800; border-radius:12px; font-size:0.72rem; cursor:pointer; letter-spacing:0.3px;"><i class="fas fa-qrcode" style="margin-right:5px;"></i>PIX</button>
                            <button onclick="GaditasFiltros.abrirFormularioCartaoReal('${cobranca.id}')" style="flex:1; background:#3b82f6; border:none; padding:12px; color:white; font-weight:800; border-radius:12px; font-size:0.72rem; cursor:pointer; letter-spacing:0.3px;"><i class="fas fa-credit-card" style="margin-right:5px;"></i>CARTÃO</button>
                        </div>
                    </div>`;
            });
            
            this.statusBloqueado = algumBloqueioAtivo;
            htmlFaturas += `
                <button onclick="GaditasFiltros.carregarHistoricoPagamentos()" style="width:100%; padding:13px; background:#1e293b; border:1px solid #334155; color:#94a3b8; border-radius:14px; font-size:0.75rem; font-weight:700; cursor:pointer; letter-spacing:0.3px;">
                    <i class="fas fa-history" style="margin-right:6px;"></i>VER HISTÓRICO DE PAGAMENTOS
                </button>`;
            conteudo.innerHTML = htmlFaturas;
        } catch (error) { console.error(error); }
    },

    // ── HISTÓRICO DE PAGAMENTOS PAGOS ────────────────────────────
    async carregarHistoricoPagamentos() {
        const conteudo = document.getElementById('financeiro-conteudo');
        if (!conteudo) return;
        conteudo.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:#3b82f6; display:block; margin-bottom:8px;"></i>Buscando histórico...</div>`;

        try {
            const emailAtleta = auth.currentUser.email.trim();
            const resCliente = await fetch(`${this.asaasUrl}?endpoint=customers&email=${encodeURIComponent(emailAtleta)}`);
            const dadosCliente = await resCliente.json();
            if (!dadosCliente.data || dadosCliente.data.length === 0) {
                conteudo.innerHTML = `<p style="color:#94a3b8; text-align:center; padding:15px;">Atleta não localizado no Asaas.</p>
                    <button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" style="width:100%; padding:12px; background:#334155; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer;">← VOLTAR</button>`;
                return;
            }

            const customerId = dadosCliente.data[0].id;
            const resPagos = await fetch(`${this.asaasUrl}?endpoint=payments&customer=${customerId}&status=RECEIVED&limit=30`);
            const dadosPagos = await resPagos.json();

            if (!dadosPagos.data || dadosPagos.data.length === 0) {
                conteudo.innerHTML = `<p style="color:#94a3b8; text-align:center; padding:15px;">Nenhum pagamento confirmado encontrado.</p>
                    <button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" style="width:100%; padding:12px; background:#334155; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer;">← VOLTAR</button>`;
                return;
            }

            dadosPagos.data.sort((a, b) => new Date(b.paymentDate || b.dueDate) - new Date(a.paymentDate || a.dueDate));

            let html = `<p style="font-size:0.8rem; color:#94a3b8; font-weight:600; margin-bottom:12px;">✅ ${dadosPagos.data.length} pagamento(s) confirmado(s):</p>`;
            dadosPagos.data.forEach(p => {
                const valor = p.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const dataBruta = p.paymentDate || p.dueDate;
                const data = dataBruta ? dataBruta.split('-').reverse().join('/') : '—';
                const desc = p.description || 'Mensalidade';
                html += `
                    <div style="background:#0f172a; border:1px solid #1e3a2e; border-radius:14px; padding:13px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                        <div style="width:34px; height:34px; background:#064e3b; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="fas fa-check" style="color:#10b981; font-size:0.8rem;"></i>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <span style="font-size:0.72rem; color:#e2e8f0; font-weight:700; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${desc}</span>
                            <span style="font-size:0.58rem; color:#475569; font-weight:600;">${data}</span>
                        </div>
                        <div style="text-align:right; flex-shrink:0;">
                            <span style="font-size:0.88rem; font-weight:800; color:#10b981; display:block;">${valor}</span>
                            <span style="font-size:0.5rem; color:#34d399; font-weight:800; letter-spacing:0.5px;">PAGO</span>
                        </div>
                    </div>`;
            });
            html += `<button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" style="width:100%; padding:12px; background:#334155; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer; margin-top:8px;">← VOLTAR</button>`;
            conteudo.innerHTML = html;
        } catch (e) {
            console.error(e);
            conteudo.innerHTML = `<p style="color:#f43f5e; text-align:center;">Erro ao carregar histórico.</p>
                <button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" style="width:100%; padding:12px; background:#334155; border:none; color:white; border-radius:8px; font-weight:700; cursor:pointer; margin-top:8px;">← VOLTAR</button>`;
        }
    },

    async gerarPixReal(idCobranca) {
        const conteudo = document.getElementById('financeiro-conteudo');
        try {
            const resPix = await fetch(`${this.asaasUrl}?endpoint=payments/${idCobranca}/pixQrCode`);
            const dadosPix = await resPix.json();
            conteudo.innerHTML = `
                <div style="text-align: center; background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                    <div style="background: white; width: 160px; height: 160px; margin: 0 auto 12px auto; padding: 10px; border-radius: 8px;"><img src="data:image/jpeg;base64,${dadosPix.encodedImage}" style="width:100%; height:100%;"></div>
                    <input type="text" id="pix-copia-cola-real" value="${dadosPix.payload}" readonly style="margin-bottom: 8px; text-align: center; font-size: 0.7rem; background: #1e293b; border: 1px solid #334155; padding: 10px; width: 100%; border-radius: 6px; color:#fff; outline:none;">
                    <button onclick="navigator.clipboard.writeText(document.getElementById('pix-copia-cola-real').value); alert('Copiado!');" class="btn-save" style="background:#334155; width:100%; padding:12px; border-radius:10px; color:white; border:none; font-weight:700; cursor:pointer;">COPIAR PIX</button>
                    <button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" class="btn-save" style="background: #f43f5e; width:100%; padding:12px; border-radius:10px; color:white; border:none; font-weight:700; cursor:pointer; margin-top:8px;">VOLTAR</button>
                </div>`;
        } catch (e) { this.carregarDadosFinanceirosReal(); }
    },

    abrirFormularioCartaoReal(idCobranca) {
        const conteudo = document.getElementById('financeiro-conteudo');
        conteudo.innerHTML = `
            <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                <input type="text" id="cartao-holder" placeholder="Nome no cartão" style="margin-bottom: 8px; font-size: 0.8rem; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color:#fff; width:100%; outline:none;">
                <input type="text" id="cartao-number" placeholder="Número do Cartão" style="margin-bottom: 8px; font-size: 0.8rem; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color:#fff; width:100%; outline:none;">
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <input type="text" id="cartao-exp-m" placeholder="MM" maxlength="2" style="font-size: 0.8rem; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color:#fff; flex: 1; outline:none; margin:0;">
                    <input type="text" id="cartao-exp-a" placeholder="AAAA" maxlength="4" style="font-size: 0.8rem; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color:#fff; flex: 1; outline:none; margin:0;">
                    <input type="text" id="cartao-cvv" placeholder="CVV" maxlength="4" style="font-size: 0.8rem; padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color:#fff; flex: 1; outline:none; margin:0;">
                </div>
                <button onclick="GaditasFiltros.processarAssinaturaCartaoReal('${idCobranca}')" class="btn-save" style="background: #10b981; width:100%; padding:14px; border:none; border-radius:10px; color:white; font-weight:700; cursor:pointer;">CONFIRMAR RECORRÊNCIA</button>
                <button onclick="GaditasFiltros.carregarDadosFinanceirosReal()" class="btn-save" style="background:#334155; width:100%; padding:14px; border:none; border-radius:10px; color:white; font-weight:700; cursor:pointer; margin-top:8px;">VOLTAR</button>
            </div>`;
    },

    async processarAssinaturaCartaoReal(idCobranca) {
        const holder = document.getElementById('cartao-holder').value.trim();
        const number = document.getElementById('cartao-number').value.trim().replace(/\s/g, '');
        const month = document.getElementById('cartao-exp-m').value.trim();
        const year = document.getElementById('cartao-exp-a').value.trim();
        const cvv = document.getElementById('cartao-cvv').value.trim();
        
        try {
            // Valores padrão de contingência para evitar que campos nulos quebrem o Asaas
            let cpfAluno = "00000000000"; let telAluno = "79999999999"; let cepAluno = "49000000"; 
            let ruaAluno = "Rua não informada"; let numAluno = "SN"; let compAluno = "";

            const alunoDoc = await db.collection("alunos").doc(auth.currentUser.id).get();
            if (alunoDoc.exists) {
                const data = alunoDoc.data();
                if (data.cpf) cpfAluno = data.cpf.replace(/\D/g, ''); 
                if (data.telefone) telAluno = data.telefone.replace(/\D/g, '');
                if (data.cep) cepAluno = data.cep.replace(/\D/g, ''); 
                if (data.rua) ruaAluno = data.rua; 
                if (data.numero) numAluno = data.numero;
                if (data.complemento) compAluno = data.complemento;
            }

            // Payload estritamente formatado com as regras de API do Asaas
            const payload = {
                creditCard: { 
                    holderName: holder, 
                    number: number, 
                    expiryMonth: month, 
                    expiryYear: year, 
                    ccv: cvv 
                },
                creditCardHolderInfo: { 
                    name: auth.currentUser.name || holder, 
                    email: auth.currentUser.email, 
                    cpfCnpj: cpfAluno, 
                    mobilePhone: telAluno, 
                    postalCode: cepAluno,
                    address: ruaAluno, 
                    addressNumber: numAluno, 
                    complement: compAluno
                }
            };

            // Rota de POST corrigida apontando para a API local (Vercel Serverless)
            const urlPagamento = `${this.asaasUrl}?endpoint=payments/${idCobranca}/payWithCreditCard`;
            
            const resCartao = await fetch(urlPagamento, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json'
                }, 
                body: JSON.stringify(payload) 
            });
            
            const dadosPagamento = await resCartao.json();
            
            if (dadosPagamento.errors && dadosPagamento.errors.length > 0) { 
                alert("Erro no Asaas: " + dadosPagamento.errors[0].description); 
                return; 
            }
            
            alert("Pagamento/Assinatura realizada com sucesso! OSS."); 
            this.carregarDadosFinanceirosReal();
        } catch (e) { 
            console.error("Erro no processamento do cartão:", e);
            alert("Falha ao se conectar à API. Verifique os logs.");
            this.carregarDadosFinanceirosReal(); 
        }
    },

    injetarElementosVisuais() {
        if (document.getElementById('container-botoes-dinamicos')) return;
        const inputBusca = document.getElementById('input-busca-aluno');
        if (inputBusca) {
            const btnContainer = document.createElement('div');
            btnContainer.id = 'container-botoes-dinamicos'; btnContainer.style = 'display: flex; gap: 8px; margin-bottom: 12px; width: 100%;';
            btnContainer.innerHTML = `<button id="filter-btn-all" onclick="academia.filtrarCategoriaAlunos('all')" style="flex: 1; padding: 10px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; border: 1px solid var(--border-light);">TODOS</button><button id="filter-btn-adult" onclick="academia.filtrarCategoriaAlunos('adult')" style="flex: 1; padding: 10px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; border: 1px solid var(--border-light);">ADULTOS</button><button id="filter-btn-kids" onclick="academia.filtrarCategoriaAlunos('kids')" style="flex: 1; padding: 10px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; border: 1px solid var(--border-light);">KIDS</button>`;
            inputBusca.parentNode.insertBefore(btnContainer, inputBusca);
            this.anonymousStyles();
        }
    },

    anonymousStyles() {
        const tipo = academia.categoriaFiltroAtual || "all";
        const botoes = { all: "filter-btn-all", adult: "filter-btn-adult", kids: "filter-btn-kids" };
        for (const key in botoes) {
            const btn = document.getElementById(botoes[key]); if (!btn) continue;
            if (key === tipo) { btn.style.backgroundColor = "var(--accent-blue)"; btn.style.color = "white"; } 
            else { btn.style.backgroundColor = "var(--bg-main)"; btn.style.color = "var(--text-secondary)"; }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { GaditasFiltros.init(); }, 400); });
