// ══════════════════════════════════════════════
//  GADITAS ACADEMY — CONTRATO DIGITAL
// ══════════════════════════════════════════════

const contrato = {
    _canvas: null,
    _ctx: null,
    _desenhando: false,
    _viewingAlunoId: null,   // admin visualizando contrato de outro aluno

    // ── Abrir modal ──────────────────────────────────────────
    async abrir(alunoIdParam) {
        this._viewingAlunoId = alunoIdParam || null;

        const modal = document.getElementById('modal-contrato');
        modal.style.display = 'flex';
        document.getElementById('contrato-body').innerHTML =
            '<div style="text-align:center;padding:40px;color:#94a3b8;">Carregando contrato...</div>';
        document.getElementById('contrato-footer').innerHTML = '';

        try {
            const alunoId = alunoIdParam || auth.currentUser?.id;
            const [alunoDoc, planos, configContrato] = await Promise.all([
                db.collection('alunos').doc(alunoId).get(),
                academia.carregarConfiguracaoPlanos(),
                db.collection('configuracoes').doc('contrato').get()
            ]);
            const aluno = { id: alunoId, ...alunoDoc.data() };
            const versaoAtual = configContrato.exists ? (configContrato.data().versao || 0) : 0;
            this._versaoAtual = versaoAtual;
            this._renderizar(aluno, planos, versaoAtual);
        } catch (e) {
            document.getElementById('contrato-body').innerHTML =
                `<div style="color:#f43f5e;padding:20px;">Erro ao carregar: ${e.message}</div>`;
        }
    },

    fechar() {
        document.getElementById('modal-contrato').style.display = 'none';
        this._canvas = null;
        this._ctx = null;
        this._viewingAlunoId = null;
    },

    // ── Renderizar contrato + footer ─────────────────────────
    _renderizar(aluno, planos, versaoAtual = 0) {
        const versaoAssinada = aluno.contrato?.versaoContrato || 0;
        const assinaturaValida = !!(aluno.contrato?.assinaturaImg) && (versaoAssinada >= versaoAtual);
        const jaAssinou = assinaturaValida;
        const soVisualizando = !!(this._viewingAlunoId) || jaAssinou;

        const planoKey   = (aluno.plano || 'mensal').toLowerCase();
        const planoInfo  = planos[planoKey] || planos.mensal;
        // Usa o valor salvo no aluno (planoValor) se disponível e > 0, senão usa config global
        const valorNumerico = (aluno.planoValor > 0) ? aluno.planoValor : (planoInfo.valor || 120);
        const valorStr   = `R$ ${parseFloat(valorNumerico).toFixed(2).replace('.', ',')}`;
        const duracoes   = { mensal: '1 mês', trimestral: '3 meses', semestral: '6 meses', anual: '12 meses' };
        const duracaoStr = duracoes[planoKey] || '1 mês';
        const hoje       = new Date().toLocaleDateString('pt-BR');

        const nascFormatado = aluno.nascimento
            ? aluno.nascimento.split('-').reverse().join('/') : '___/___/______';
        const enderecoStr = [aluno.rua, aluno.numero, aluno.complemento, aluno.bairro]
            .filter(Boolean).join(', ') || '______________________________________';
        const cepCidadeStr = [aluno.cep ? `CEP ${aluno.cep}` : '', aluno.cidade, aluno.estado]
            .filter(Boolean).join(' — ') || '______________________________________';

        const campoVazio = (v) => v || '______________________________';

        document.getElementById('contrato-body').innerHTML = `
<div style="color:#e2e8f0; font-size:0.78rem; line-height:1.7; padding:4px 0;">

  <div style="text-align:center; margin-bottom:16px;">
    <div style="font-size:1rem; font-weight:800; color:white; letter-spacing:1px;">GADITAS ACADEMY</div>
    <div style="font-size:0.65rem; color:#94a3b8;">Rua José Pacheco, 448 Jabutiana – Aracaju/SE</div>
  </div>

  <p style="margin-bottom:12px;">
    <strong>GADITAS ACADEMY</strong> inscrita no CNPJ sob o n. <strong>07.932.950/0001-01</strong>,
    com sede na Rua José Pacheco, 448 Jabutiana Aracaju SE, neste ato representada por seu
    Sócio/Administrador, <strong>ERIC NUNES COSTA</strong>, CPF: 805.425.655-87, RG: 3.002.775-6,
    casado, Rua José Pereira da Silva, 589 Edf. SANDRA RAQUEL Apt 402 Luzia Aracaju SE,
    ora denominado <strong>CONTRATADA</strong>, e o abaixo qualificado, denominado
    <strong>CONTRATANTE</strong>, têm, entre si, justo e contratado o presente contrato
    particular de prestação de serviços por prazo determinado.
  </p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">DADOS DO (A) CONTRATANTE</div>
  ${this._tabela([
      ['Nome do (a) Contratante:', campoVazio(aluno.nome)],
      ['Data de Nascimento:', nascFormatado, 'Estado Civil:', '___________', 'Sexo:', '___'],
      ['CPF:', campoVazio(aluno.cpf), 'RG:', '___________', 'Órgão Expedidor:', '______'],
      ['Endereço / Bairro / Complemento:', enderecoStr],
      ['CEP / Cidade / UF:', cepCidadeStr],
      ['Fone:', campoVazio(aluno.telefone), 'e-Mail:', campoVazio(aluno.email)],
      ['Profissão:', '______________________________'],
      ['Em caso de Emergência Ligar para:', '______________________________', 'Contato 2:', '______________________________'],
  ])}

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">DADOS DO RESPONSÁVEL EM CASO DE MENOR</div>
  ${this._tabela([
      ['Responsável:', '______________________________________'],
      ['Parentesco:', '_______________', 'CPF:', '______________________'],
      ['Fone:', '_______________', 'Local de Trabalho:', '______________________'],
  ])}

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">DADOS DO CONTRATO</div>
  ${this._tabela([
      ['Valor:', `${valorStr}/mês`, 'Duração:', duracaoStr],
      ['Valor pago:', valorStr, 'Data de início:', hoje],
      ['Desconto:', '—', 'Data de término:', '______________________'],
      ['Número de parcelas:', '1', 'Plano:', planoInfo.label || planoKey],
      ['Forma de pagamento:', 'Cartão / PIX / Dinheiro', 'Data:', hoje],
  ])}

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">CONDIÇÕES GERAIS DE PRESTAÇÃO DE SERVIÇOS</div>

  <p>A CONTRATADA tem como objetivo oferecer aos alunos todos os recursos disponíveis, no espaço da academia, para que estes possam desenvolver suas capacidades físicas atendendo às suas necessidades e contribuindo para uma melhor qualidade de vida, mediante orientação dos instrutores.</p>

  <p>Assim sendo, os direitos e obrigações do CONTRATANTE são independentes da frequência à CONTRATADA, uma vez que o objeto deste Contrato é o direito de utilização dos serviços pactuados no presente termo, não havendo qualquer relação entre frequência e pagamento das mensalidades que vencerão normalmente a cada mês. O não comparecimento/usufruto dos serviços, pelo CLIENTE-CONTRATANTE não o abstêm das responsabilidades financeiras mensais pactuadas no item anterior, possibilitando inclusive, mediante a inadimplência, sua inscrição nos órgãos de proteção ao crédito e/ou cartório de protestos, independentemente de notificação prévia.</p>

  <p>Este instrumento regula a contratação, pelo CONTRATANTE, do direito de utilização dos serviços e instalações da CONTRATADA, conforme plano escolhido, mediante os seguintes termos e condições:</p>

  <p><strong>1)</strong> A CONTRATADA dispõe dos seguintes planos: Plano Mensal, Plano Trimestral, Plano Semestral, Plano Anual.</p>
  <p><strong>2)</strong> O (A) CONTRATANTE somente poderá usufruir do espaço disponibilizado pela CONTRATADA pelo período do plano contratado, devendo respeitar as normas de utilização das instalação e condições do plano.</p>
  <p><strong>3)</strong> Os planos apresentam datas bem definidas entre início e término, sendo que após esta data extinguem-se automaticamente todos os direitos inerentes ao presente contrato, dispensando-se a necessidade de aviso prévio, salvo os casos em que ocorram a renovação do plano.</p>
  <p><strong>4)</strong> Em todos os planos contratados o pagamento poderá ser feito pelo (a) próprio (a) aluno (a), CONTRATANTE ou outra pessoa que for indicada, por escrito, desde que especifique o objeto (plano) a ser renovado, identificação da parte (contratante) e mediante o pagamento no ato, através de cartão, PIX e/ou dinheiro.</p>
  <p><strong>5)</strong> Os planos são válidos para as atividades, horários e frequências designadas no ato da matrícula, podendo haver alternância nos horários de turma, mediante o interesse e possibilidade no quadro programático da CONTRATADA.</p>
  <p><strong>6)</strong> A CONTRATADA poderá efetuar alterações necessárias nos seus horários, professores e/ou aulas, comunicando ao aluno através de cartazes colocado no quadro de avisos.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">CANCELAMENTO</div>
  <p><strong>7)</strong> Em caso de cancelamento dos planos trimestrais, semestrais ou anuais antes do término de seu período de vigência, por iniciativa do CONTRATANTE ou em decorrência do descumprimento de suas obrigações contratuais, será devido à CONTRATADA, a título de cláusula penal, o equivalente à metade do valor dos meses vincendos, seja por boleto, pix, cartão ou credito recorrente, conforme o artigo 603 da Lei nº 10.406/2002 (Código Civil Brasileiro), o valor resultante poderá ser compensado com eventual restituição a que o aluno tenha direito.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">TRANSFERÊNCIA. CESSÃO DE DIREITO DE USO</div>
  <p><strong>8)</strong> O (A) CONTRATANTE que não pretender mais utilizar seu plano poderá ceder o direto de utilização dos serviços e instalações da CONTRATADA para outra pessoa, mediante requisição escrita. O contratante do plano NÃO deixará de ser o responsável financeiro pelo plano, sendo que TODOS os pagamentos devidos continuarão sob sua responsabilidade.</p>
  <p><strong>9)</strong> Na Cessão de direito de uso, o CESSIONÁRIO (AQUELE QUE IRÁ SE BENEFICIAR) fará jus à utilização dos dias vincendos, considerado tal período como a diferença entre a quantidade de dias decorridos desde o início da vigência do plano e o período total inicialmente contratado.</p>
  <p><strong>10)</strong> Caso a pessoa que recebeu o direito de cessão de uso já seja aluno matriculado na CONTRATADA, deverá cumprir seu plano até o final e somente depois passará a usufruir o direito de uso cedido, sendo-lhe creditados os dias vincendos do cedente e vedado efetuar nova cessão de direito de uso dos dias recebidos.</p>
  <p><strong>11)</strong> Caso O/A CESSIONÁRIO(A) que vier a receber o direito de cessão de uso não seja aluno matriculado na GADITAS ACADEMY, ficará ela obrigada a cumprir todas as normas da GADITAS ACADEMY, devendo arcar com as despesas referente à taxa de matrícula, sendo-lhe vedado efetuar nova cessão de direito de uso dos duas recebidos.</p>
  <p><strong>12)</strong> A GADITAS ACADEMY não interfere e nem intermedia a CESSÃO DE DIREITO DE USO e está isenta de qualquer responsabilidade no acordo entre as partes.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">RENOVAÇÃO</div>
  <p><strong>13)</strong> Na hipótese de o aluno renovar o plano, o presente contrato renovar-se-á, automaticamente, nos termos e condições que estiverem vigentes na data da renovação.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">TRANCAMENTO</div>
  <p><strong>14)</strong> A CONTRATADA oferece a opção de trancamento para o período de 1 (um) à 30 (trinta) dias em alguns dos planos semestral e anual, devendo o aluno, para usufruir desde direito, comunicar o interesse à recepção por escrito com antecedência mínima de 01 (um) dia, com as datas pré-estabelecidas, permanecendo inalteradas as obrigações financeiras mensais pactuadas, que será prorrogado pelo mesmo período do trancamento. DURANTE O PERÍODO DE TRANCAMENTO, SERÁ VEDADO O ACESSO DO ALUNO ÀS DEPENDÊNCIAS DA GADITAS ACADEMY E NÃO SERÃO SUSPENSOS OS PAGAMENTOS.</p>
  <p><strong>15)</strong> A CONTRATADA não efetuará o trancamento retroativo dos planos.</p>
  <p><strong>16)</strong> Se O (A) CONTRATANTE ficar impossibilitado de frequentar a academia por ordem médica, a CONTRATADA trancará o plano pelo prazo estipulado em atestado médico, desde que o aluno apresente à CONTRATADA, a via original do atestado acompanhado do relatório médico indicando o motivo do impedimento, assinado e carimbado com o número de inscrição do médico junto Conselho Regional de Medicina, em até 20 (vinte) dias a contar da data em que ficou impossibilitado de frequentar a CONTRATADA. EM CASO DE NÃO APRESENTAÇÃO DA DOCUMENTAÇÃO ACIMA CITADA, A CONTRATADA SE RESERVA O DIREITO DE NÃO TRANCAR O PLANO.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">HORÁRIO DAS AULAS</div>
  <p><strong>17)</strong> A CONTRATADA poderá impedir a participação do aluno em aulas que não seja recomendada pela sua avaliação médica ou se o aluno não estiver devidamente trajado e/ou equipado, quando a aula assim o requerer.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">NORMAS DE UTILIZAÇÃO DOS SERVIÇOS</div>
  <p><strong>18)</strong> É expressamente proibida qualquer conduta do aluno que não esteja de acordo com o objeto deste instrumento, que seja contrária à moral e aos bons costumes ou que, por qualquer forma, cause perturbação ao ambiente da CONTRATADA, aos funcionários, instrutores, professores ou frequentadores, como, exemplificativamente: (I) a comercialização de produtos ou serviços nas dependências da academia; (II) o uso inadequado ou impróprio dos equipamentos; (III) atos ou atitudes que perturbem outros clientes e que pelos mesmos sejam repelidas; e, (IV) atitudes agressivas com outros clientes ou com funcionários das academias.</p>
  <p><strong>19)</strong> Além das condutas acima referidas, reserva-se a CONTRATADA o direito de considerar como inadequadas e proibidas outras condutas que não estejam de acordo com o objeto deste instrumento.</p>
  <p><strong>20)</strong> É vedado ao aluno retirar equipamentos ou qualquer outro bem de propriedade da CONTRATADA de suas instalações.</p>
  <p><strong>21)</strong> O (A) CONTRATANTE deve zelar e utilizar adequadamente os equipamentos e bens da GADITAS ACADEMY, ficando obrigado a reparar quaisquer danos por ele causados a equipamentos, funcionários e/ou terceiros, podendo ter as suas atividades suspensas até a efetiva reparação do dano.</p>
  <p><strong>22)</strong> OS DANOS DE QUALQUER NATUREZA DECORRENTES DE ATIVIDADES EXECUTADAS SEM A SOLICITAÇÃO DE ORIENTAÇÃO OU COM INOBSERVÂNCIA DAS INSTRUÇÕES DOS PROFESSORES DA CONTRATADA NÃO SERÃO DE RESPONSABILIDADE DA MESMA E CARACTERIZARÃO CULPA EXCLUSIVA DO ALUNO.</p>
  <p><strong>23)</strong> O (A) CONTRATANTE que cometer qualquer atitude, ofensa, agressão física e demais atos que infrinjam a lei e/ou que resultem em prejuízo para a academia, deverá ressarcir a mesma, mediante apresentação dos custos.</p>
  <p><strong>24)</strong> É vedada a entrada e a circulação de animais na academia.</p>
  <p><strong>25)</strong> Não é permitido fumar ou ingerir bebida alcoólica no interior da academia.</p>
  <p><strong>26)</strong> É terminantemente proibido o ingresso de pessoas portando armas de fogo no interior da academia.</p>
  <p><strong>27)</strong> É estritamente vedado o consumo de alimentos e líquidos, exceto água, sobre os limites do tatame.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">RESCISÃO</div>
  <p><strong>28)</strong> O aluno que mantiver conduta em desacordo com o objeto deste instrumento, estará sujeito à advertência verbal e, no caso de reincidência, ao cancelamento de sua matrícula com a rescisão antecipada do contrato ou à não renovação do mesmo, a critério da CONTRATADA, sem prejuízo da apuração de perdas e danos.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">EXAME MÉDICO</div>
  <p><strong>29)</strong> O (A) CONTRATANTE declara, neste ato, estar em plenas condições de saúde, apto (a) a realizar atividades físicas, e não portar nenhuma moléstia contagiosa que possa prejudicar os demais frequentadores da academia, isentando a CONTRATADA de responsabilidades sobre qualquer problema ocorrido dentro de suas dependências em razão das circunstâncias acima.</p>
  <p><strong>30)</strong> Não obstante a declaração de saúde, o (a) CONTRATANTE deverá, obrigatoriamente, submeter-se à avaliação física antes do início de qualquer atividade física, devendo tal exame ser renovado a cada período de 06 (seis) meses, sob pena de suspensão do plano até a regularização.</p>
  <p><strong>31)</strong> A Responsabilidade da CONTRATADA pela perda, dano ou extravio de objetos e pertences pessoais ou de valor do O (A) CONTRATANTE, estará limitada aos termos abaixo.</p>
  <p><strong>32)</strong> A utilização de guarda-volumes não implica em dever de guarda da CONTRATADA.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">RESPONSABILIDADE E AUTORIZAÇÃO – MENORES</div>
  <p><strong>33)</strong> No caso do O (A) CONTRATANTE ser menor de 16 anos e menor de 18 anos, o mesmo será assistido por seu pai, mãe ou responsável legal, sendo presente termo assinado conjuntamente pelo CLIENTE e por seu responsável legal.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">DISPOSIÇÕES FINAIS</div>
  <p><strong>34)</strong> As normas constantes dos avisos e orientações afixados no interior das instalações da Academia, que não estiverem contempladas neste instrumento, passam a fazer parte integrante do mesmo, sendo certo que o seu não cumprimento poderá acarretar na rescisão antecipada ou a não renovação do mesmo.</p>
  <p><strong>35)</strong> Toda e qualquer sugestão, reclamação ou alteração dever ser encaminhada, por escrito, à Administração, que analisará cada caso conforme critérios estabelecidos pela Direção.</p>
  <p><strong>36)</strong> Os casos omissos neste regulamento deverão ser analisados pela Direção da CONTRATADA.</p>
  <p><strong>37)</strong> A CONTRATADA poderá utilizar-se da imagem do (a) CONTRATANTE, seja na internet, em jornais, revistas, ou qualquer outro meio de comunicação, seja público ou privado, para, única e exclusivamente, auxiliar na divulgação da CONTRATADA e de suas atividades mercantis.</p>

  <div style="font-weight:800; color:white; font-size:0.8rem; text-align:center; margin:16px 0 10px;">FORO</div>
  <p><strong>38)</strong> Fica eleito pelas partes contratantes o foro da cidade de Aracaju para dirimir as questões oriundas da interpelação ou aplicação deste contrato, renunciando a qualquer outro por mais privilegiado que seja.</p>
  <p><strong>39)</strong> Por assim estarem justas e contratadas assinam o presente instrumento particular.</p>
  <p style="text-align:right; color:#94a3b8;">Aracaju/SE, ${hoje}</p>

  <div id="contrato-assinatura-section">
    ${jaAssinou ? this._htmlAssinaturaExistente(aluno.contrato) : (soVisualizando ? '' : this._htmlCanvasAssinatura())}
  </div>
</div>`;

        // Footer
        const footer = document.getElementById('contrato-footer');
        if (jaAssinou || this._viewingAlunoId) {
            footer.innerHTML = `
<button onclick="contrato.fechar()" style="width:100%;padding:14px;background:#334155;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
  FECHAR
</button>`;
        } else {
            footer.innerHTML = `
<div style="display:flex;gap:8px;">
  <button onclick="contrato.limparCanvas()" style="flex:1;padding:14px;background:#334155;border:none;color:white;border-radius:10px;font-weight:700;cursor:pointer;font-size:0.8rem;">
    🗑️ LIMPAR
  </button>
  <button onclick="contrato.salvar()" style="flex:2;padding:14px;background:#10b981;border:none;color:white;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
    ✅ ASSINAR E SALVAR CONTRATO
  </button>
</div>`;
        }

        if (!jaAssinou && !this._viewingAlunoId) {
            this._iniciarCanvas();
        }
    },

    _htmlCanvasAssinatura() {
        return `
<div style="margin-top:24px; padding-top:16px; border-top:1px solid #334155;">
  <div style="font-size:0.7rem; color:#94a3b8; font-weight:700; margin-bottom:8px; text-align:center; letter-spacing:0.5px;">
    ASSINATURA DO CONTRATANTE
  </div>
  <div style="font-size:0.65rem; color:#64748b; text-align:center; margin-bottom:10px;">
    Desenhe sua assinatura no campo abaixo com o dedo ou mouse
  </div>
  <canvas id="canvas-assinatura"
    style="width:100%; height:130px; background:#0f172a; border:1px solid #3b82f6; border-radius:10px; touch-action:none; display:block; cursor:crosshair;">
  </canvas>
  <div style="font-size:0.6rem; color:#475569; text-align:center; margin-top:6px;">
    Ao assinar, declaro que li e concordo com todas as cláusulas acima.
  </div>
</div>`;
    },

    _htmlAssinaturaExistente(c) {
        const data = c.assinadoEm?.toDate
            ? c.assinadoEm.toDate().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
            : (c.assinadoEm || '—');
        return `
<div style="margin-top:24px; padding-top:16px; border-top:1px solid #334155;">
  <div style="background:#064e3b; border:1px solid #10b981; border-radius:10px; padding:12px; margin-bottom:12px; text-align:center;">
    <div style="color:#10b981; font-weight:800; font-size:0.75rem;">✅ CONTRATO ASSINADO DIGITALMENTE</div>
    <div style="color:#6ee7b7; font-size:0.65rem; margin-top:4px;">Assinado em: ${data}</div>
    <div style="color:#6ee7b7; font-size:0.65rem;">Plano: ${c.planoLabel || c.plano} — ${c.valorPlano}</div>
  </div>
  <div style="font-size:0.65rem; color:#94a3b8; text-align:center; margin-bottom:6px;">ASSINATURA REGISTRADA:</div>
  <div style="background:#0f172a; border:1px solid #334155; border-radius:10px; padding:8px; text-align:center;">
    <img src="${c.assinaturaImg}" style="max-width:100%; max-height:130px; border-radius:6px;" alt="Assinatura">
  </div>
</div>`;
    },

    _tabela(linhas) {
        let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">';
        linhas.forEach(cells => {
            html += '<tr>';
            for (let i = 0; i < cells.length; i += 2) {
                const label = cells[i];
                const value = cells[i + 1] !== undefined ? cells[i + 1] : '';
                const colSpan = cells.length === 2 ? ' colspan="3"' : '';
                html += `<td style="border:1px solid #334155;padding:6px 8px;color:#64748b;font-size:0.65rem;font-weight:700;white-space:nowrap;">${label}</td>`;
                html += `<td${colSpan} style="border:1px solid #334155;padding:6px 8px;color:#e2e8f0;font-size:0.72rem;">${value}</td>`;
            }
            html += '</tr>';
        });
        html += '</table>';
        return html;
    },

    // ── Canvas de assinatura ─────────────────────────────────
    _iniciarCanvas() {
        // Espera o DOM renderizar
        setTimeout(() => {
            const canvas = document.getElementById('canvas-assinatura');
            if (!canvas) return;

            // Ajusta resolução física
            const rect   = canvas.getBoundingClientRect();
            canvas.width  = rect.width  * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;

            this._canvas = canvas;
            this._ctx    = canvas.getContext('2d');
            this._ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            this._ctx.strokeStyle = '#ffffff';
            this._ctx.lineWidth   = 2;
            this._ctx.lineCap     = 'round';
            this._ctx.lineJoin    = 'round';
            this._desenhando      = false;

            const pos = (e) => {
                const r = canvas.getBoundingClientRect();
                const src = e.touches ? e.touches[0] : e;
                return { x: src.clientX - r.left, y: src.clientY - r.top };
            };

            canvas.addEventListener('mousedown',  (e) => { this._desenhando = true;  this._ctx.beginPath(); const p = pos(e); this._ctx.moveTo(p.x, p.y); });
            canvas.addEventListener('mousemove',  (e) => { if (!this._desenhando) return; const p = pos(e); this._ctx.lineTo(p.x, p.y); this._ctx.stroke(); });
            canvas.addEventListener('mouseup',    ()  => { this._desenhando = false; });
            canvas.addEventListener('mouseleave', ()  => { this._desenhando = false; });

            canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._desenhando = true;  this._ctx.beginPath(); const p = pos(e); this._ctx.moveTo(p.x, p.y); }, { passive: false });
            canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); if (!this._desenhando) return; const p = pos(e); this._ctx.lineTo(p.x, p.y); this._ctx.stroke(); }, { passive: false });
            canvas.addEventListener('touchend',   ()  => { this._desenhando = false; });
        }, 150);
    },

    limparCanvas() {
        if (!this._canvas || !this._ctx) return;
        const r = this._canvas.getBoundingClientRect();
        this._ctx.clearRect(0, 0, r.width, r.height);
    },

    _canvasVazio() {
        if (!this._canvas) return true;
        const data = this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height).data;
        return !data.some(v => v !== 0);
    },

    // ── Salvar ────────────────────────────────────────────────
    async salvar() {
        if (this._canvasVazio()) {
            alert('Por favor, desenhe sua assinatura antes de confirmar.');
            return;
        }

        const btn = document.querySelector('#contrato-footer button:last-child');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

        try {
            const alunoId  = auth.currentUser.id;
            const alunoDoc = await db.collection('alunos').doc(alunoId).get();
            const aluno    = alunoDoc.data();
            const planos   = await academia.carregarConfiguracaoPlanos();
            const planoKey = (aluno.plano || 'mensal').toLowerCase();
            const planoInfo = planos[planoKey] || planos.mensal;
            const valorNumerico = (aluno.planoValor > 0) ? aluno.planoValor : (planoInfo.valor || 120);
            const valorStr = `R$ ${parseFloat(valorNumerico).toFixed(2).replace('.', ',')}/mês`;
            const versaoContrato = this._versaoAtual || 0;

            const imgBase64 = this._canvas.toDataURL('image/png');

            await db.collection('alunos').doc(alunoId).update({
                contrato: {
                    assinaturaImg:   imgBase64,
                    assinadoEm:      firebase.firestore.FieldValue.serverTimestamp(),
                    plano:           planoKey,
                    planoLabel:      planoInfo.label || planoKey,
                    valorPlano:      valorStr,
                    versaoContrato:  versaoContrato,
                }
            });

            // Atualiza currentUser em memória
            if (auth.currentUser) {
                auth.currentUser.contrato = {
                    assinaturaImg:   imgBase64,
                    assinadoEm:      new Date(),
                    plano:           planoKey,
                    planoLabel:      planoInfo.label || planoKey,
                    valorPlano:      valorStr,
                    versaoContrato:  versaoContrato,
                };
            }

            alert('✅ Contrato assinado e salvo com sucesso! OSS!');
            this.fechar();
            // Atualiza botão no card do aluno
            this._atualizarBotaoContrato();
        } catch (e) {
            console.error('Erro ao salvar contrato:', e);
            alert('Erro ao salvar: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '✅ ASSINAR E SALVAR CONTRATO'; }
        }
    },

    _atualizarBotaoContrato() {
        // Atualiza botão dentro da ficha de perfil (se existir)
        const btn = document.getElementById('btn-meu-contrato');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-file-contract"></i> VER MEU CONTRATO ✅';
            btn.style.background = '#064e3b';
            btn.style.color = '#10b981';
            btn.style.border = '1px solid #10b981';
        }
        // Atualiza card de destaque no topo da aba TREINO
        if (typeof ui !== 'undefined') ui.renderCardContrato();
    },

    // ── Badge para listagem de alunos (admin) ────────────────
    badgeContrato(aluno) {
        if (aluno.contrato?.assinaturaImg) {
            return `<span title="Contrato assinado" style="background:#064e3b;color:#10b981;font-size:0.55rem;padding:2px 6px;border-radius:5px;font-weight:800;border:1px solid #10b98155;cursor:pointer;" onclick="contrato.abrir('${aluno.id || ''}')">📋✅</span>`;
        }
        return `<span title="Contrato não assinado" style="background:#1e293b;color:#f59e0b;font-size:0.55rem;padding:2px 6px;border-radius:5px;font-weight:800;border:1px solid #f59e0b55;cursor:pointer;" onclick="contrato.abrir('${aluno.id || ''}')">📋</span>`;
    },
};
