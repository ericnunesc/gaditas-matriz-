import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { uid, novaSenha } = req.body || {};
    if (!uid || !novaSenha || novaSenha.length < 6) {
        return res.status(400).json({ error: 'uid e novaSenha (mín. 6 chars) são obrigatórios' });
    }

    try {
        await admin.auth().updateUser(uid, { password: novaSenha });
        return res.status(200).json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
