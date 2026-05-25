// api/testar-notificacao.js
const admin = require('firebase-admin');

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

module.exports = async function handler(req, res) {
    const { email, secret } = req.query;

    if (secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    if (!email) {
        return res.status(400).json({ error: 'Parâmetro email é obrigatório' });
    }

    try {
        const snap = await db.collection('alunos')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (snap.empty) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }

        const aluno = snap.docs[0].data();
        const token = aluno.fcmToken;
        const nome = aluno.nome || aluno.name || 'Atleta';

        if (!token) {
            return res.status(400).json({ error: 'Aluno não tem fcmToken salvo. Faça login no app primeiro.' });
        }

        await admin.messaging().send({
            token: token,
            notification: {
                title: '🧪 Teste Gaditas',
                body: `Olá ${nome}! As notificações estão funcionando perfeitamente.`
            },
            webpush: {
                notification: {
                    icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                    badge: 'https://gaditas-matriz.vercel.app/gaditasstore.png',
                    vibrate: [200, 100, 200]
                }
            }
        });

        return res.status(200).json({
            ok: true,
            mensagem: `Notificação enviada para ${nome} (${email})`
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
