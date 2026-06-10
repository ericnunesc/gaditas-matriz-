// api/notificacoes-dispensas.js
// Cron diário: notifica admin sobre dispensas de hoje e amanhã

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

function dataISO(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
    if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}` &&
        req.query.secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        // Busca token do admin
        const adminDoc = await db.collection('configuracoes').doc('admin_config').get();
        const adminToken = adminDoc.exists ? adminDoc.data().fcmToken : null;
        if (!adminToken) return res.status(200).json({ ok: true, msg: 'Admin sem FCM token' });

        const hoje    = dataISO(0);
        const amanha  = dataISO(1);

        // Busca dispensas de hoje e amanhã
        const [snapHoje, snapAmanha] = await Promise.all([
            db.collection('dispensas_prof').where('data', '==', hoje).get(),
            db.collection('dispensas_prof').where('data', '==', amanha).get()
        ]);

        const envios = [];

        if (!snapHoje.empty) {
            const lista = snapHoje.docs.map(d => {
                const v = d.data();
                return `${v.profNome} — ${v.turma === 'todas' ? 'todas as turmas' : v.turma}`;
            }).join(', ');
            envios.push(admin.messaging().send({
                token: adminToken,
                notification: {
                    title: '🗓️ Dispensa HOJE',
                    body: lista
                },
                webpush: { notification: { icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png' } }
            }));
        }

        if (!snapAmanha.empty) {
            const lista = snapAmanha.docs.map(d => {
                const v = d.data();
                return `${v.profNome} — ${v.turma === 'todas' ? 'todas as turmas' : v.turma}`;
            }).join(', ');
            envios.push(admin.messaging().send({
                token: adminToken,
                notification: {
                    title: '🗓️ Dispensa AMANHÃ',
                    body: lista
                },
                webpush: { notification: { icon: 'https://gaditas-matriz.vercel.app/gaditasstore.png' } }
            }));
        }

        await Promise.all(envios);
        return res.status(200).json({ ok: true, hoje: snapHoje.size, amanha: snapAmanha.size });
    } catch(e) {
        return res.status(500).json({ error: e.message });
    }
}
