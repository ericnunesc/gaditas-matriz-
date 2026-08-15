// api/push-comunicado.js
// Endpoint chamado pelo frontend quando admin publica um comunicado
// Envia push notification para lista de tokens
// Também aceita { novaMatricula: true, nome } para notificar admin de nova matrícula

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
    // Permite CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { tokens, title, body, novaMatricula, nome } = req.body;

    // ── Caso especial: nova matrícula → notifica admin server-side ──
    if (novaMatricula && nome) {
        try {
            const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
            const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;
            if (!adminToken) return res.status(200).json({ ok: true, msg: 'Admin sem token' });

            await admin.messaging().send({
                token: adminToken,
                notification: {
                    title: '🎉 Nova Matrícula!',
                    body: `${nome} acabou de se matricular na Gaditas Matriz!`
                },
                webpush: {
                    notification: {
                        icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                        badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                        vibrate: [200, 100, 200]
                    }
                }
            });
            console.log(`🎉 Push matrícula enviado — ${nome}`);
            return res.status(200).json({ ok: true });
        } catch(e) {
            console.error('Erro push matrícula:', e.message);
            return res.status(500).json({ error: e.message });
        }
    }

    // ── Caso normal: envio para lista de tokens ──
    if (!tokens || tokens.length === 0) {
        return res.status(400).json({ error: 'Nenhum token fornecido' });
    }

    let sucesso = 0;
    let falha = 0;

    for (const token of tokens) {
        try {
            await admin.messaging().send({
                token,
                notification: { title, body },
                webpush: {
                    notification: {
                        icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                        badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                        vibrate: [200, 100, 200]
                    }
                }
            });
            sucesso++;
        } catch(e) {
            console.error(`Falha token ${token}:`, e.message);
            falha++;
        }
    }

    return res.status(200).json({ ok: true, sucesso, falha });
}
