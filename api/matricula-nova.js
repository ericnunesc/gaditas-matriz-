// api/matricula-nova.js
// Chamado pelo cadastro.js após novo aluno se matricular
// Lê o token do admin no Firestore (server-side) e envia push

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });

    try {
        const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
        const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;

        if (!adminToken) {
            return res.status(200).json({ ok: true, msg: 'Admin sem FCM token' });
        }

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

        console.log(`🎉 Push de matrícula enviado para admin — ${nome}`);
        return res.status(200).json({ ok: true });

    } catch(e) {
        console.error('Erro push matrícula:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
