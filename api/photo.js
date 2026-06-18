module.exports = async function handler(req, res) {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref' });

  try {
    const upstream = await fetch(
      `https://google-map-places.p.rapidapi.com/maps/api/place/photo?maxwidth=600&photoreference=${encodeURIComponent(ref)}`,
      {
        headers: {
          'x-rapidapi-key':  'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c',
          'x-rapidapi-host': 'google-map-places.p.rapidapi.com',
        },
      }
    );

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Upstream failed', status: upstream.status });
    }

    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image')) {
      return res.status(502).json({ error: 'Not an image', ct });
    }

    const buf = await upstream.arrayBuffer();
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(Buffer.from(buf));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};