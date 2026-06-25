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

    const { alunoId, valor, nomeAluno, tipo } = req.body || {};
    if (!alunoId || !valor) return res.status(400).json({ error: 'alunoId e valor obrigatórios' });

    const certBase64 = process.env.EFI_CERT_BASE64 || '';
    const certPass   = (process.env.EFI_CERT_PASS || '').trim();
    const clientId   = (process.env.EFI_CLIENT_ID || '').trim();
    const clientSec  = (process.env.EFI_CLIENT_SECRET || '').trim();
    const pfx = Buffer.from(certBase64, 'base64');
    const creds = Buffer.from(`${clientId}:${clientSec}`).toString('base64');

    // ── CARTÃO ───────────────────────────────────────────────────────────────
    if (tipo === 'cartao') {
        try {
            const EFI_COB_HOST = 'cobrancas.api.efipay.com.br';
            const tokenBody = JSON.stringify({ grant_type: 'client_credentials' });
            const tokenResp = await httpsReq(EFI_COB_HOST, '/v1/authorize', 'POST', {
                'Authorization': `Basic ${creds}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(tokenBody)
            }, pfx, certPass, tokenBody);

            if (!tokenResp.data?.access_token) {
                console.error('[efi-cartao] token erro:', JSON.stringify(tokenResp.data));
                return res.status(500).json({ error: `Erro token: ${JSON.stringify(tokenResp.data)}` });
            }
            const token = tokenResp.data.access_token;

            const valorCentavos = Math.round(parseFloat(valor) * 100);
            const cobBody = JSON.stringify({
                items: [{ name: `Taxa de Exame - ${nomeAluno || 'Aluno'}`, value: valorCentavos, amount: 1 }],
                metadata: {
                    custom_id: alunoId,
                    notification_url: 'https://gaditas-matriz.vercel.app/api/efi-webhook'
                }
            });
            const cobResp = await httpsReq(EFI_COB_HOST, '/v1/charge/one-step', 'POST', {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(cobBody)
            }, pfx, certPass, cobBody);

            console.log('[efi-cartao] cob status:', cobResp.status, JSON.stringify(cobResp.data).slice(0, 200));

            let chargeData = cobResp.data?.data;
            if (!chargeData?.charge_id) {
                const cobBody2 = JSON.stringify({
                    items: [{ name: `Taxa de Exame - ${nomeAluno || 'Aluno'}`, value: valorCentavos, amount: 1 }],
                    metadata: { custom_id: alunoId, notification_url: 'https://gaditas-matriz.vercel.app/api/efi-webhook' }
                });
                const cobResp2 = await httpsReq(EFI_COB_HOST, '/v1/charge', 'POST', {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(cobBody2)
                }, pfx, certPass, cobBody2);
                console.log('[efi-cartao] cob2 status:', cobResp2.status, JSON.stringify(cobResp2.data).slice(0, 300));
                chargeData = cobResp2.data?.data;
                if (!chargeData?.charge_id) {
                    return res.status(500).json({ error: `Efí cartão: ${JSON.stringify(cobResp2.data)}` });
                }
            }

            // Gerar link de pagamento (hosted checkout para boleto + cartão + PIX)
            const expire_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const linkBody = JSON.stringify({
                message: '',
                expire_at,
                request_delivery_address: false,
                payment_method: 'all'
            });
            const linkResp = await httpsReq(EFI_COB_HOST, `/v1/charge/${chargeData.charge_id}/link`, 'POST', {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(linkBody)
            }, pfx, certPass, linkBody);

            console.log('[efi-cartao] link status:', linkResp.status, JSON.stringify(linkResp.data).slice(0, 300));

            const payLink = linkResp.data?.data?.payment_url || linkResp.data?.data?.link || linkResp.data?.link || '';
            if (!payLink) {
                return res.status(500).json({ error: `Sem link. Resp: ${JSON.stringify(linkResp.data).slice(0, 400)}` });
            }

            await db.collection('exame_cobrancas').doc(`c${chargeData.charge_id}`).set({
                alunoId, valor: parseFloat(valor), tipo: 'cartao', status: 'pendente',
                chargeId: chargeData.charge_id, criadoEm: new Date().toISOString()
            });

            return res.status(200).json({ link: payLink });
        } catch (e) {
            console.error('[efi-cartao] exceção:', e.message);
            return res.status(500).json({ error: e.message });
        }
    }

    // ── PIX ──────────────────────────────────────────────────────────────────
    try {
        const EFI_HOST = 'pix.api.efipay.com.br';

        console.log('[efi] cert len:', certBase64.length, 'pass len:', certPass.length, 'clientId ok:', !!clientId);

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

        const efiDoc = await db.collection('configuracoes').doc('efi_config').get();
        const chave = ((efiDoc.exists && efiDoc.data().chavePix) || process.env.EFI_PIX_KEY || '').trim();
        console.log('[efi] chave:', chave);

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

        const qrResp = await httpsReq(EFI_HOST, `/v2/loc/${loc.id}/qrcode`, 'GET', {
            'Authorization': `Bearer ${token}`
        }, pfx, certPass, null);

        console.log('[efi] qr status:', qrResp.status);

        await db.collection('exame_cobrancas').doc(txid).set({
            alunoId, valor: parseFloat(valor), status: 'pendente',
            criadoEm: new Date().toISOString()
        });

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
