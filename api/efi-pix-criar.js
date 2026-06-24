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

const EFI_HOST = 'pix.api.efipay.com.br';

function httpsReq(hostname, path, method, headers, pfx, passphrase, bodyStr) {
    return new Promise((resolve, reject) => {
        const opts = { hostname, path, method, headers, pfx, passphrase };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
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
        const certBase64 = process.env.EFI_CERT_BASE64 || '';
        const certPass   = (process.env.EFI_CERT_PASS || '').trim();
        const clientId   = (process.env.EFI_CLIENT_ID || '').trim();
        const clientSec  = (process.env.EFI_CLIENT_SECRET || '').trim();

        console.log('[efi] cert len:', certBase64.length, 'pass len:', certPass.length, 'clientId ok:', !!clientId);

        const pfx = Buffer.from(certBase64, 'base64');
        const creds = Buffer.from(`${clientId}:${clientSec}`).toString('base64');

        // 1. Token
        const tokenBody = JSON.stringify({ grant_type: 'client_credentials' });
        const tokenResp = await httpsReq(EFI_HOST, '/oauth/token', 'POST', {
            'Authorization': `Basic ${creds}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(tokenBody)
        }, pfx, certPass, tokenBody);

        console.log('[efi] token status:', tokenResp.status);
        if (!tokenResp.data?.access_token) {
            console.error('[efi] token erro:', JSON.stringify(tokenResp.data));
            return res.status(500).json({ error: `Erro token: ${JSON.stringify(tokenResp.data)}` });
        }
        const token = tokenResp.data.access_token;

        // 2. Chave PIX
        const efiDoc = await db.collection('configuracoes').doc('efi_config').get();
        const chave = ((efiDoc.exists && efiDoc.data().chavePix) || process.env.EFI_PIX_KEY || '').trim();
        console.log('[efi] chave:', chave);

        // 3. Criar cobrança
        const cobBody = JSON.stringify({
            calendario: { expiracao: 3600 },
            valor: { original: parseFloat(valor).toFixed(2) },
            chave,
            solicitacaoPagador: `Taxa de Exame - ${nomeAluno || 'Aluno'}`
        });
        const cobResp = await httpsReq(EFI_HOST, '/v2/cob', 'POST', {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(cobBody)
        }, pfx, certPass, cobBody);

        console.log('[efi] cob status:', cobResp.status, 'loc:', JSON.stringify(cobResp.data?.loc));
        if (!cobResp.data?.loc?.id) {
            console.error('[efi] cob erro:', JSON.stringify(cobResp.data));
            return res.status(500).json({ error: `Efí: ${JSON.stringify(cobResp.data)}` });
        }

        const { txid, loc } = cobResp.data;

        // 4. QR Code
        const qrResp = await httpsReq(EFI_HOST, `/v2/loc/${loc.id}/qrcode`, 'GET', {
            'Authorization': `Bearer ${token}`
        }, pfx, certPass, null);

        console.log('[efi] qr status:', qrResp.status);

        // 5. Salvar no Firestore
        await db.collection('exame_cobrancas').doc(txid).set({
            alunoId, valor: parseFloat(valor), status: 'pendente',
            criadoEm: new Date().toISOString()
        });

        // 6. Registrar webhook (silencia erro se já existir)
        try {
            const whBody = JSON.stringify({ webhookUrl: 'https://gaditas-matriz.vercel.app/api/efi-webhook' });
            await httpsReq(EFI_HOST, `/v2/webhook/${chave}`, 'PUT', {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(whBody)
            }, pfx, certPass, whBody);
        } catch {}

        return res.status(200).json({
            txid,
            qrcode: qrResp.data.qrcode,
            imagemQrcode: qrResp.data.imagemQrcode
        });

    } catch (e) {
        console.error('[efi] exceção:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
