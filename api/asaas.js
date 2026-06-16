// api/asaas.js
export default async function handler(req, res) {
    // 🛡️ CORREÇÃO DE OURO: Adicionado explicitamente 'access_token' nos cabeçalhos permitidos do CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, access_token, Access_Token, ACCESS_TOKEN');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { endpoint } = req.query;

    if (!endpoint) {
        return res.status(400).json({ error: "O parâmetro 'endpoint' é obrigatório na requisição." });
    }

    const asaasApiKey = process.env.ASAAS_API_KEY;
    const asaasUrl = process.env.ASAAS_URL;

    if (!asaasApiKey || !asaasUrl) {
        return res.status(500).json({ error: "Variáveis de ambiente ASAAS_API_KEY ou ASAAS_URL em falta na Vercel." });
    }

    try {
        const queryParams = new URLSearchParams(req.query);
        queryParams.delete('endpoint'); 

        // Limpa barras duplas acidentais na rota final para evitar rejeição no gateway
        const urlBaseLimpa = asaasUrl.endsWith('/') ? asaasUrl.slice(0, -1) : asaasUrl;
        const endpointLimpo = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const stringParams = queryParams.toString();
        
        const urlFinal = `${urlBaseLimpa}/${endpointLimpo}${stringParams ? '?' + stringParams : ''}`;

        const config = {
            method: req.method,
            headers: {
                'access_token': asaasApiKey.trim(), // Remove espaços invisíveis automáticos do token
                'Content-Type': 'application/json',
                'User-Agent': 'GaditasMatrizApp' // Obrigatório pelo Asaas para evitar o erro 401
            }
        };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            config.body = JSON.stringify(req.body);
        }

        const respostaAsaas = await fetch(urlFinal, config);

        // DELETE e alguns endpoints retornam 204 sem body — não tentar parsear JSON
        const text = await respostaAsaas.text();
        const dados = text ? JSON.parse(text) : { success: true };

        return res.status(respostaAsaas.status).json(dados);

    } catch (error) {
        console.error("❌ Erro Proxy Asaas:", error);
        return res.status(500).json({ error: "Erro interno na ponte com o Asaas", details: error.message });
    }
}
