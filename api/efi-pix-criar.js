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

function efiRequest({ method, path, token, body, certBuffer, certPass }) {
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const bodyStr = body ? JSON.stringify(body) : undefined;
        if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

        const req = https.request({
            hostname: EFI_HOST,
            path,
            method,
            headers,
            pfx: certBuffer,
            passphrase: certPass
        }, (res) => {
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

async function getToken(certBuffer, certPass) {
    const creds = Buffer.from(`${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`).toString('base64');
    const body = 'grant_type=client_credentials';
    const result = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: EFI_HOST,
            path: '/oauth/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${creds}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify({ grant_type: 'client_credentials' }))
            },
            pfx: certBuffer,
            passphrase: certPass
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ grant_type: 'client_credentials' }));
        req.end();
    });
    return result.access_token;
}

async function registrarWebhook(token, certBuffer, certPass) {
    const chave = process.env.EFI_PIX_KEY;
    const webhookUrl = process.env.EFI_WEBHOOK_URL || 'https://gaditas-matriz.vercel.app/api/efi-webhook';
    await efiRequest({
        method: 'PUT',
        path: `/v2/webhook/${chave}`,
        token,
        body: { webhookUrl },
        certBuffer,
        certPass
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
        const certBuffer = Buffer.from(process.env.EFI_CERT_BASE64, 'base64');
        const certPass = process.env.EFI_CERT_PASS;
        // Chave PIX: prioriza Firestore, cai no env var como fallback
        const efiDoc = await db.collection('configuracoes').doc('efi_config').get();
        const chave = (efiDoc.exists && efiDoc.data().chavePix) || process.env.EFI_PIX_KEY;

        const token = await getToken(certBuffer, certPass);

        // Registrar webhook (silencia erro se já registrado)
        try { await registrarWebhook(token, certBuffer, certPass); } catch {}

        // Criar cobrança imediata PIX
        const cobResp = await efiRequest({
            method: 'POST',
            path: '/v2/cob',
            token,
            body: {
                calendario: { expiracao: 3600 },
                valor: { original: parseFloat(valor).toFixed(2) },
                chave,
                solicitacaoPagador: `Taxa de Exame - ${nomeAluno || 'Aluno'}`,
            },
            certBuffer,
            certPass
        });

        if (!cobResp.data?.loc?.id) {
            return res.status(500).json({ error: 'Erro ao criar cobrança', detail: cobResp.data });
        }

        const { txid, loc } = cobResp.data;

        // Buscar QR Code
        const qrResp = await efiRequest({
            method: 'GET',
            path: `/v2/loc/${loc.id}/qrcode`,
            token,
            certBuffer,
            certPass
        });

        // Salvar no Firestore para o webhook identificar o aluno
        await db.collection('exame_cobrancas').doc(txid).set({
            alunoId,
            valor: parseFloat(valor),
            status: 'pendente',
            criadoEm: new Date().toISOString()
        });

        return res.status(200).json({
            txid,
            qrcode: qrResp.data.qrcode,
            imagemQrcode: qrResp.data.imagemQrcode
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
