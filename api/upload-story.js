// api/upload-story.js
// Upload de imagem para Firebase Storage via Admin SDK (bypassa regras de segurança)
// Chamado pelo admin ao postar um story com imagem da galeria

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

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '6mb' // imagens redimensionadas ficam ~100-400 KB em base64
        }
    }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { imageBase64, fileName } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 obrigatório' });

    try {
        const bucket = admin.storage().bucket();
        const nome   = `stories/${Date.now()}_${(fileName || 'story.jpg').replace(/\s/g, '_')}`;
        const file   = bucket.file(nome);

        const buffer = Buffer.from(imageBase64, 'base64');

        await file.save(buffer, {
            metadata: { contentType: 'image/jpeg' }
        });

        // Torna o arquivo público via ACL (não depende das Storage Rules do Firebase)
        await file.makePublic();

        // URL pública permanente do Google Cloud Storage
        const url = `https://storage.googleapis.com/${bucket.name}/${nome}`;

        return res.status(200).json({ ok: true, url });
    } catch(e) {
        console.error('upload-story error:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
