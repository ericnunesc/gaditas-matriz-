// api/notificacoes-cobranca.js
// Cron Job do Vercel — roda todo dia às 8h
// 1. Verifica faturas vencidas (1º e 4º dia de atraso)
// 2. Parabeniza aniversariantes do dia

import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    const isDry = req.query.dry === 'true';

    if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
        // autenticação normal do cron — ok
    } else if (isDry && authHeader?.startsWith('Bearer ')) {
        // modo diagnóstico: valida token Firebase do admin logado
        try {
            const idToken = authHeader.split('Bearer ')[1];
            const decoded = await admin.auth().verifyIdToken(idToken);
            if (!decoded.uid) throw new Error('UID inválido');
            // verifica se é admin no Firestore
            const adminDoc = await db.collection('admins').doc(decoded.uid).get();
            if (!adminDoc.exists) return res.status(403).json({ error: 'Usuário não é admin' });
        } catch(e) {
            return res.status(401).json({ error: 'Token inválido: ' + e.message });
        }
    } else {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const diaHoje = hoje.getDate();
    const mesHoje = hoje.getMonth() + 1;

    const asaasUrl = process.env.ASAAS_URL?.replace(/\/$/, '');
    const asaasKey = process.env.ASAAS_API_KEY;

    let enviadas = 0;
    let erros = 0;
    const relatorio = []; // usado só no modo dry

    // ── LOCK ANTI-DUPLICATA (pula no modo dry) ─────────────────
    if (!isDry) {
        const lockId = `cobranca_${hoje.toISOString().split('T')[0]}`;
        const lockRef = db.collection('cron_locks').doc(lockId);
        try {
            await db.runTransaction(async (tx) => {
                const lockDoc = await tx.get(lockRef);
                if (lockDoc.exists) throw new Error('JA_EXECUTOU');
                tx.set(lockRef, { executadoEm: new Date().toISOString() });
            });
        } catch(eLock) {
            if (eLock.message === 'JA_EXECUTOU') {
                console.log(`🔒 Cron cobrança já executou hoje. Abortando duplicata.`);
                return res.status(200).json({ ok: true, msg: 'Já executou hoje', duplicata: true });
            }
            console.warn('⚠️ Falha no lock, continuando:', eLock.message);
        }
    }

    try {
        const alunosSnap = await db.collection('alunos')
            .where('fcmToken', '!=', null)
            .get();

        for (const doc of alunosSnap.docs) {
            const aluno = doc.data();
            const token = aluno.fcmToken;
            const email = aluno.email;
            const nome = (aluno.nome || 'Atleta').split(' ')[0];

            if (!token) continue;

            // ── 1. NOTIFICAÇÃO DE ANIVERSÁRIO ──────────────────
            try {
                if (aluno.nascimento) {
                    const partes = aluno.nascimento.split('-');
                    const diaNasc = parseInt(partes[2]);
                    const mesNasc = parseInt(partes[1]);

                    if (diaNasc === diaHoje && mesNasc === mesHoje) {
                        if (!isDry) {
                            await admin.messaging().send({
                                token,
                                notification: {
                                    title: '🎂 Feliz Aniversário!',
                                    body: `Parabéns, ${nome}! A família Gaditas deseja a você um dia incrível. OSS! 🦁🥋`
                                },
                                webpush: {
                                    notification: {
                                        icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                        badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                        vibrate: [200, 100, 200, 100, 200]
                                    }
                                }
                            });
                        }
                        enviadas++;
                        if (isDry) relatorio.push({ nome, email, acao: '🎂 Aniversário — push seria enviado' });
                        console.log(`🎂 Aniversário ${isDry?'(dry)':''} para ${nome}`);
                    }
                }
            } catch(e) {
                console.error(`Erro aniversário ${email}:`, e.message);
                erros++;
            }

            // ── 2. NOTIFICAÇÃO DE INADIMPLÊNCIA ────────────────
            if (aluno.responsavelId) {
                if (isDry) relatorio.push({ nome, email: email||'—', acao: '⏭️ Dependente — ignorado' });
                continue;
            }

            if (!email) continue;

            try {
                const headers = {
                    'access_token': asaasKey.trim(),
                    'Content-Type': 'application/json',
                    'User-Agent': 'GaditasMatrizApp'
                };

                const respOver = await fetch(
                    `${asaasUrl}/payments?customerEmail=${encodeURIComponent(email)}&status=OVERDUE&limit=50`,
                    { headers }
                );
                const dadosOver = await respOver.json();

                if (!dadosOver.data || dadosOver.data.length === 0) {
                    if (isDry) relatorio.push({ nome, email, acao: '✅ Sem faturas OVERDUE no Asaas' });
                    continue;
                }

                const limite60 = new Date(hoje);
                limite60.setDate(limite60.getDate() - 60);

                let maiorAtraso = 0;
                const faturasDry = [];

                for (const fatura of dadosOver.data) {
                    const vencimento = new Date(fatura.dueDate + 'T00:00:00');
                    vencimento.setHours(0, 0, 0, 0);

                    if (vencimento < limite60) {
                        faturasDry.push(`  ⏭️ ${fatura.dueDate} — antiga (>60 dias), ignorada`);
                        continue;
                    }

                    const respFatura = await fetch(`${asaasUrl}/payments/${fatura.id}`, { headers });
                    const faturaAtual = await respFatura.json();
                    const statusAtual = faturaAtual.status;

                    if (['RECEIVED', 'CONFIRMED', 'REFUNDED',
                         'CHARGEBACK_DISPUTE', 'CHARGEBACK_REQUESTED'].includes(statusAtual)) {
                        faturasDry.push(`  ✅ ${fatura.dueDate} — status=${statusAtual}, ignorada`);
                        continue;
                    }

                    const dias = Math.floor((hoje - vencimento) / (1000 * 60 * 60 * 24));
                    if (dias > 0 && dias > maiorAtraso) maiorAtraso = dias;
                    faturasDry.push(`  ⚠️ ${fatura.dueDate} — status=${statusAtual}, ${dias} dias de atraso`);
                }

                if (maiorAtraso === 0) {
                    if (isDry) relatorio.push({ nome, email, acao: '✅ Sem atraso real após filtros', faturas: faturasDry });
                    continue;
                }

                // Bloqueio
                let acaoBloqueio = '';
                if (maiorAtraso >= 10) {
                    if (aluno.status === 'trancado') {
                        acaoBloqueio = `🔒 Já trancado no Firestore`;
                    } else {
                        acaoBloqueio = `🔴 SERIA BLOQUEADO (${maiorAtraso} dias)`;
                        if (!isDry) {
                            try {
                                await db.collection('alunos').doc(doc.id).update({ status: 'trancado' });
                            } catch(eBlock) {
                                console.error(`Erro ao bloquear ${nome}:`, eBlock.message);
                            }
                        }
                    }
                }

                // Push
                let mensagem = null;
                if (maiorAtraso === 1) {
                    mensagem = {
                        title: '⚠️ Fatura em atraso',
                        body: `Olá ${nome}! Sua mensalidade venceu ontem. Regularize para continuar treinando sem problemas.`
                    };
                } else if (maiorAtraso >= 4 && maiorAtraso % 2 === 0) {
                    mensagem = {
                        title: '⚠️ Regularize sua fatura',
                        body: `${nome}, sua mensalidade está em atraso há ${maiorAtraso} dias. Regularize para continuar treinando. OSS!`
                    };
                }

                if (mensagem) {
                    if (!isDry) {
                        await admin.messaging().send({
                            token,
                            notification: mensagem,
                            webpush: {
                                notification: {
                                    icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                    badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                    vibrate: [200, 100, 200]
                                }
                            }
                        });
                    }
                    enviadas++;
                    if (isDry) relatorio.push({
                        nome, email,
                        maiorAtraso,
                        acao: `📲 PUSH SERIA ENVIADO — "${mensagem.title}"`,
                        bloqueio: acaoBloqueio || 'sem bloqueio',
                        faturas: faturasDry
                    });
                } else {
                    if (isDry) relatorio.push({
                        nome, email,
                        maiorAtraso,
                        acao: `🔕 Atraso de ${maiorAtraso} dias — dia sem push (${maiorAtraso===1?'dia 1':maiorAtraso%2!==0?'dia ímpar':''})`,
                        bloqueio: acaoBloqueio || 'sem bloqueio',
                        faturas: faturasDry
                    });
                }

            } catch(e) {
                console.error(`Erro inadimplência ${email}:`, e.message);
                if (isDry) relatorio.push({ nome, email, acao: `❌ ERRO: ${e.message}` });
                erros++;
            }
        }

        if (isDry) {
            return res.status(200).json({
                dry: true,
                data: hoje.toLocaleDateString('pt-BR'),
                totalAlunos: alunosSnap.size,
                pushsQueSeriam: enviadas,
                erros,
                relatorio
            });
        }

        return res.status(200).json({
            ok: true,
            notificacoesEnviadas: enviadas,
            erros,
            data: hoje.toLocaleDateString('pt-BR')
        });

    } catch(e) {
        console.error('Erro geral:', e);
        return res.status(500).json({ error: e.message });
    }
}
