// /api/tts.js - Vercel serverless function for Google Cloud TTS
// Supports single text or batch (array of texts)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { texts, speed } = req.body || {};
  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'No texts array provided' });
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_TTS_API_KEY not set' });

  const speakingRate = speed === 'slow' ? 0.85 : speed === 'fast' ? 1.3 : speed === 'veryfast' ? 1.6 : 1.0;

  try {
    // Batch: synthesize all texts in parallel
    const promises = texts.map(text =>
      fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
          audioConfig: { audioEncoding: 'MP3', speakingRate, pitch: -2.0 }
        })
      }).then(r => r.json()).then(d => d.audioContent || null)
    );

    const audioContents = await Promise.all(promises);
    return res.status(200).json({ audioContents });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
