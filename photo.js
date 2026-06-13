export default async function handler(req, res) {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing photo reference' });

  try {
    const photoRes = await fetch(
      `https://google-map-places.p.rapidapi.com/maps/api/place/photo?maxwidth=600&photoreference=${ref}`,
      {
        headers: {
          'x-rapidapi-key':  'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c',
          'x-rapidapi-host': 'google-map-places.p.rapidapi.com',
        },
      }
    );

    if (!photoRes.ok) return res.status(photoRes.status).json({ error: 'Upstream failed' });

    const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image')) return res.status(502).json({ error: 'Not an image' });

    const buffer = await photoRes.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
