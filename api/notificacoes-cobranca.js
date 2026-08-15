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
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // ── LOCK ANTI-DUPLICATA ────────────────────────────────────
    // Garante que o cron só executa UMA vez por dia (Vercel pode disparar 2x)
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
            console.log(`🔒 Cron cobrança já executou hoje (${lockId}). Abortando duplicata.`);
            return res.status(200).json({ ok: true, msg: 'Já executou hoje', duplicata: true });
        }
        // Erro de transação — continua mesmo assim para não perder notificações
        console.warn('⚠️ Falha no lock, continuando:', eLock.message);
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
                    const partes = aluno.nascimento.split('-'); // YYYY-MM-DD
                    const diaNasc = parseInt(partes[2]);
                    const mesNasc = parseInt(partes[1]);

                    if (diaNasc === diaHoje && mesNasc === mesHoje) {
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
                        enviadas++;
                        console.log(`🎂 Aniversário enviado para ${nome}`);
                    }
                }
            } catch(e) {
                console.error(`Erro aniversário ${email}:`, e.message);
                erros++;
            }

            // ── 2. NOTIFICAÇÃO DE INADIMPLÊNCIA ────────────────
            if (!email) continue;

            try {
                const headers = {
                    'access_token': asaasKey.trim(),
                    'Content-Type': 'application/json',
                    'User-Agent': 'GaditasMatrizApp'
                };

                // Busca faturas OVERDUE — filtramos por data NO CÓDIGO (não depende do Asaas aceitar dueDate[ge])
                const respOver = await fetch(
                    `${asaasUrl}/payments?customerEmail=${encodeURIComponent(email)}&status=OVERDUE&limit=50`,
                    { headers }
                );
                const dadosOver = await respOver.json();

                if (!dadosOver.data || dadosOver.data.length === 0) continue;

                // Filtra apenas faturas vencidas nos últimos 60 dias (ignora dívidas antigas esquecidas)
                const limite60 = new Date(hoje);
                limite60.setDate(limite60.getDate() - 60);

                // Considera o maior atraso entre as faturas RECENTES
                let maiorAtraso = 0;
                for (const fatura of dadosOver.data) {
                    const vencimento = new Date(fatura.dueDate + 'T00:00:00');
                    vencimento.setHours(0, 0, 0, 0);
                    if (vencimento < limite60) {
                        console.log(`⏭️ Ignorando fatura antiga de ${nome}: ${fatura.dueDate}`);
                        continue; // ignora faturas muito antigas
                    }
                    const dias = Math.floor((hoje - vencimento) / (1000 * 60 * 60 * 24));
                    if (dias > 0 && dias > maiorAtraso) maiorAtraso = dias; // só conta dias POSITIVOS (vencidas de verdade)
                }

                if (maiorAtraso === 0) continue; // nenhuma fatura recente vencida

                // Bloqueia acesso real no Firestore a partir do dia 10
                if (maiorAtraso >= 10 && aluno.status !== 'trancado') {
                    try {
                        await db.collection('alunos').doc(doc.id).update({ status: 'trancado' });
                        console.log(`🔒 Aluno ${nome} bloqueado no Firestore (${maiorAtraso} dias de atraso)`);
                    } catch(eBlock) {
                        console.error(`Erro ao bloquear ${nome}:`, eBlock.message);
                    }
                }

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
                    enviadas++;
                    console.log(`✅ Notificação enviada para ${nome} (${maiorAtraso} dias)`);
                }
            } catch(e) {
                console.error(`Erro inadimplência ${email}:`, e.message);
                erros++;
            }
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
