import https from 'https';
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

const EFI_COB_HOST = 'cobrancas.api.efipay.com.br';

function httpsReq(hostname, path, method, headers, body, pfx, passphrase) {
    return new Promise((resolve, reject) => {
        const opts = { hostname, path, method, headers };
        if (pfx) { opts.pfx = pfx; opts.passphrase = passphrase; }
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { alunoId, valor, nomeAluno } = req.body || {};
    if (!alunoId || !valor) return res.status(400).json({ error: 'alunoId e valor obrigatórios' });

    try {
        const clientId  = (process.env.EFI_CLIENT_ID || '').trim();
        const clientSec = (process.env.EFI_CLIENT_SECRET || '').trim();
        const certBuffer = Buffer.from((process.env.EFI_CERT_BASE64 || ''), 'base64');
        const certPass   = (process.env.EFI_CERT_PASS || '').trim();
        const creds = Buffer.from(`${clientId}:${clientSec}`).toString('base64');

        // 1. Token
        const tokenBody = JSON.stringify({ grant_type: 'client_credentials' });
        const tokenResp = await httpsReq(EFI_COB_HOST, '/oauth/token', 'POST', {
            'Authorization': `Basic ${creds}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(tokenBody)
        }, tokenBody, certBuffer, certPass);

        if (!tokenResp.data?.access_token) {
            console.error('[efi-cartao] token erro:', JSON.stringify(tokenResp.data));
            return res.status(500).json({ error: `Erro token: ${JSON.stringify(tokenResp.data)}` });
        }
        const token = tokenResp.data.access_token;

        // 2. Criar cobrança (cartão/link)
        const valorCentavos = Math.round(parseFloat(valor) * 100);
        const cobBody = JSON.stringify({
            items: [{ name: `Taxa de Exame - ${nomeAluno || 'Aluno'}`, value: valorCentavos, amount: 1 }],
            metadata: {
                custom_id: alunoId,
                notification_url: 'https://gaditas-matriz.vercel.app/api/efi-cartao-webhook'
            }
        });
        const cobResp = await httpsReq(EFI_COB_HOST, '/v1/charge/one-step', 'POST', {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(cobBody)
        }, cobBody, certBuffer, certPass);

        console.log('[efi-cartao] cob status:', cobResp.status, JSON.stringify(cobResp.data).slice(0, 200));

        const chargeData = cobResp.data?.data;
        if (!chargeData?.charge_id) {
            // Tenta endpoint alternativo /v1/charge
            const cobBody2 = JSON.stringify({
                items: [{ name: `Taxa de Exame - ${nomeAluno || 'Aluno'}`, value: valorCentavos, amount: 1 }],
                metadata: { custom_id: alunoId, notification_url: 'https://gaditas-matriz.vercel.app/api/efi-cartao-webhook' }
            });
            const cobResp2 = await httpsReq(EFI_COB_HOST, '/v1/charge', 'POST', {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(cobBody2)
            }, cobBody2, certBuffer, certPass);

            console.log('[efi-cartao] cob2 status:', cobResp2.status, JSON.stringify(cobResp2.data).slice(0, 300));
            const d2 = cobResp2.data?.data;
            if (!d2?.charge_id) {
                return res.status(500).json({ error: `Efí cartão: ${JSON.stringify(cobResp2.data)}` });
            }
            // Salvar e retornar link
            await db.collection('exame_cobrancas').doc(`c${d2.charge_id}`).set({
                alunoId, valor: parseFloat(valor), tipo: 'cartao', status: 'pendente',
                chargeId: d2.charge_id, criadoEm: new Date().toISOString()
            });
            return res.status(200).json({ link: d2.link || d2.payment?.banking_billet?.link || '' });
        }

        await db.collection('exame_cobrancas').doc(`c${chargeData.charge_id}`).set({
            alunoId, valor: parseFloat(valor), tipo: 'cartao', status: 'pendente',
            chargeId: chargeData.charge_id, criadoEm: new Date().toISOString()
        });

        return res.status(200).json({
            link: chargeData.link || chargeData.payment?.banking_billet?.link || ''
        });

    } catch (e) {
        console.error('[efi-cartao] exceção:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
