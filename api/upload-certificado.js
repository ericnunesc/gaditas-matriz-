// api/upload-certificado.js
// Upload de templates, assinaturas e certificados gerados via Admin SDK
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

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { imageBase64, path, contentType, firestoreDoc, firestoreData, skipStorage } = req.body || {};
    if (!imageBase64 || !path) return res.status(400).json({ error: 'imageBase64 e path obrigatórios' });

    try {
        let url = '';

        // 1. Faz upload no Storage (a menos que seja chamada só para salvar Firestore)
        if (!skipStorage) {
            const bucket = admin.storage().bucket();
            const file   = bucket.file(path);
            const buffer = Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            await file.save(buffer, { metadata: { contentType: contentType || 'image/png' } });
            await file.makePublic();
            url = `https://storage.googleapis.com/${bucket.name}/${path}`;
        }

        // 2. Salva no Firestore se solicitado
        if (firestoreDoc && firestoreData) {
            const db = admin.firestore();
            // firestoreDoc ex: "configuracoes/certificados" ou "alunos/alunoId"
            const parts = firestoreDoc.split('/');
            let ref = db;
            for (let i = 0; i < parts.length; i++) {
                ref = i % 2 === 0 ? ref.collection(parts[i]) : ref.doc(parts[i]);
            }
            // Substitui o placeholder __URL__ pelo URL real
            const data = JSON.parse(JSON.stringify(firestoreData).replace(/__URL__/g, url));
            await ref.set(data, { merge: true });
        }

        return res.status(200).json({ ok: true, url });
    } catch(e) {
        console.error('upload-certificado error:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
