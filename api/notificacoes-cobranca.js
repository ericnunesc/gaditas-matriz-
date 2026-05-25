// api/notificacoes-cobranca.js
// Cron Job do Vercel — roda todo dia às 8h
// Verifica faturas vencidas e envia push notification no 1º e 4º dia de atraso

import { initializeApp, cert, getApps } = require('firebase-admin/app');
import { getFirestore } = require('firebase-admin/firestore');
import { getMessaging } = require('firebase-admin/messaging');

// Inicializa o Firebase Admin apenas uma vez
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

const db = getFirestore();

export default async function handler(req, res) {
    // Segurança: só aceita chamada do próprio Vercel Cron
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    try {
        // Busca todos os alunos que têm fcmToken salvo
        const alunosSnap = await db.collection('alunos')
            .where('fcmToken', '!=', null)
            .get();

        const asaasUrl = process.env.ASAAS_URL?.replace(/\/$/, '');
        const asaasKey = process.env.ASAAS_API_KEY;

        let enviadas = 0;
        let erros = 0;

        for (const doc of alunosSnap.docs) {
            const aluno = doc.data();
            const token = aluno.fcmToken;
            const email = aluno.email;
            const nome = aluno.nome || aluno.name || 'Atleta';

            if (!token || !email) continue;

            try {
                // Busca faturas abertas do aluno no Asaas
                const resp = await fetch(
                    `${asaasUrl}/payments?customerEmail=${encodeURIComponent(email)}&status=OVERDUE&limit=10`,
                    {
                        headers: {
                            'access_token': asaasKey.trim(),
                            'Content-Type': 'application/json',
                            'User-Agent': 'GaditasMatrizApp'
                        }
                    }
                );

                const dados = await resp.json();
                if (!dados.data || dados.data.length === 0) continue;

                for (const fatura of dados.data) {
                    const vencimento = new Date(fatura.dueDate + 'T00:00:00');
                    vencimento.setHours(0, 0, 0, 0);

                    const diasAtraso = Math.floor((hoje - vencimento) / (1000 * 60 * 60 * 24));

                    let mensagem = null;

                    if (diasAtraso === 1) {
                        // 1 dia após vencer → lembrete de atraso
                        mensagem = {
                            title: '⚠️ Fatura em atraso',
                            body: `Olá ${nome}! Sua mensalidade venceu ontem. Regularize para continuar treinando sem problemas.`
                        };
                    } else if (diasAtraso === 4) {
                        // 4º dia → aviso de bloqueio (bloqueio acontece no 3º dia)
                        mensagem = {
                            title: '🔒 Acesso bloqueado',
                            body: `${nome}, seu check-in foi bloqueado por inadimplência. Pague sua mensalidade para reativar o acesso.`
                        };
                    }

                    if (mensagem) {
                        await getMessaging().send({
                            token: token,
                            notification: {
                                title: mensagem.title,
                                body: mensagem.body
                            },
                            webpush: {
                                notification: {
                                    icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                    badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                                    vibrate: [200, 100, 200]
                                }
                            }
                        });
                        enviadas++;
                    }
                }
            } catch (e) {
                console.error(`Erro ao processar aluno ${email}:`, e.message);
                erros++;
            }
        }

        return res.status(200).json({
            ok: true,
            notificacoesEnviadas: enviadas,
            erros: erros
        });

    } catch (e) {
        console.error('Erro geral no cron de notificações:', e);
        return res.status(500).json({ error: e.message });
    }
}
