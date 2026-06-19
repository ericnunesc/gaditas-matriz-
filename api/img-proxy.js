export default async function handler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');

    // Só permite Firebase Storage da Gaditas
    if (!url.startsWith('https://firebasestorage.googleapis.com/')) {
        return res.status(403).send('Forbidden');
    }

    try {
        const response = await fetch(url);
        if (!response.ok) return res.status(response.status).send('Upstream error');
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const buffer = await response.arrayBuffer();
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(Buffer.from(buffer));
    } catch (e) {
        res.status(500).send('Proxy error: ' + e.message);
    }
}
