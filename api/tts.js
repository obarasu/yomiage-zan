// /api/tts.js - Vercel serverless function for Google Cloud TTS
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, speed } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_TTS_API_KEY not set' });

  // Speed mapping
  const speakingRate = speed === 'slow' ? 0.85 : speed === 'fast' ? 1.3 : speed === 'veryfast' ? 1.6 : 1.0;

  try {
    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate,
            pitch: -2.0
          }
        })
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(502).json({ error: 'TTS API error', detail: err.slice(0, 300) });
    }

    const result = await resp.json();
    return res.status(200).json({ audioContent: result.audioContent });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
