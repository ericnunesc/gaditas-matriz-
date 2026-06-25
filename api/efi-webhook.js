import admin from 'firebase-admin';
import https from 'https';

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
        const body = req.body || {};

        // PIX webhook: payload tem campo "pix"
        if (body.pix && Array.isArray(body.pix)) {
            for (const p of body.pix) {
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
        }

        // Cartão webhook: payload tem campo "notification"
        if (body.notification) {
            const clientId  = (process.env.EFI_CLIENT_ID || '').trim();
            const clientSec = (process.env.EFI_CLIENT_SECRET || '').trim();
            const certBuffer = Buffer.from((process.env.EFI_CERT_BASE64 || ''), 'base64');
            const certPass   = (process.env.EFI_CERT_PASS || '').trim();
            const creds = Buffer.from(`${clientId}:${clientSec}`).toString('base64');

            const tokenBody = JSON.stringify({ grant_type: 'client_credentials' });
            const tokenResp = await new Promise((resolve, reject) => {
                const r = https.request({
                    hostname: 'cobrancas.api.efipay.com.br', path: '/v1/authorize', method: 'POST',
                    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tokenBody) },
                    pfx: certBuffer, passphrase: certPass
                }, (resp) => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(JSON.parse(d))); });
                r.on('error', reject); r.write(tokenBody); r.end();
            });

            const token = tokenResp.access_token;
            const notifResp = await new Promise((resolve, reject) => {
                const r = https.request({
                    hostname: 'cobrancas.api.efipay.com.br', path: `/v1/notification/${body.notification}`, method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                    pfx: certBuffer, passphrase: certPass
                }, (resp) => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(JSON.parse(d))); });
                r.on('error', reject); r.end();
            });

            const data = notifResp.data;
            if (!data) return res.status(200).json({ ok: true });

            for (const item of (Array.isArray(data) ? data : [data])) {
                if (item.status?.current === 'paid' || item.status?.current === 'settled') {
                    const chargeId = item.charge?.id || item.id;
                    if (!chargeId) continue;
                    const snap = await db.collection('exame_cobrancas').doc(`c${chargeId}`).get();
                    if (!snap.exists) continue;
                    const { alunoId } = snap.data();
                    await Promise.all([
                        db.collection('alunos').doc(alunoId).update({ taxaExamePaga: true, taxaExamePagaEm: new Date().toISOString() }),
                        snap.ref.update({ status: 'pago', pagoEm: new Date().toISOString() })
                    ]);
                }
            }
        }

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('efi-webhook error:', e.message);
        return res.status(200).json({ ok: true });
    }
}
