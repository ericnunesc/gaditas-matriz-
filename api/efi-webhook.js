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
const db = admin.firestore();

export default async function handler(req, res) {
    // Efí valida o webhook com GET primeiro
    if (req.method === 'GET') {
        return res.status(200).send('ok');
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { pix } = req.body || {};
        if (!pix || !Array.isArray(pix)) return res.status(200).json({ ok: true });

        for (const p of pix) {
            const { txid } = p;
            if (!txid) continue;

            const cobDoc = await db.collection('exame_cobrancas').doc(txid).get();
            if (!cobDoc.exists) continue;

            const { alunoId } = cobDoc.data();
            await Promise.all([
                db.collection('alunos').doc(alunoId).update({
                    taxaExamePaga: true,
                    txidExame: txid,
                    taxaExamePagaEm: new Date().toISOString()
                }),
                cobDoc.ref.update({ status: 'pago', pagoEm: new Date().toISOString() })
            ]);
        }

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('efi-webhook error:', e.message);
        return res.status(200).json({ ok: true }); // sempre 200 para Efí não retentar
    }
}
