// api/push-comunicado.js
// Endpoint chamado pelo frontend quando admin publica um comunicado
// Envia push notification para lista de tokens

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

export default async function handler(req, res) {
    // Permite CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { tokens, title, body } = req.body;

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
