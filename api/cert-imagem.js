// api/cert-imagem.js
// Proxy para carregar imagens do Storage no Canvas (evita CORS)
import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gaditasmatriz.firebasestorage.app'
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { path } = req.query;
    if (!path) return res.status(400).json({ error: 'path obrigatório' });

    try {
        const bucket = admin.storage().bucket();
        const file   = bucket.file(path);
        const [buffer] = await file.download();
        const [meta]   = await file.getMetadata();
        const mime     = meta.contentType || 'image/jpeg';
        const b64      = buffer.toString('base64');
        return res.status(200).json({ ok: true, dataUrl: `data:${mime};base64,${b64}` });
    } catch(e) {
        return res.status(500).json({ error: e.message });
    }
}
