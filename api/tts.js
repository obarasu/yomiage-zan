// /api/tts.js - Vercel serverless function for Gemini Pro TTS
// Uses Generative Language API with Orus voice
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, speed } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.GEMINI_TTS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_TTS_API_KEY not set' });

  // Build prompt based on speed
  const speedPrompt = speed === 'slow' ? 'ゆっくりめのペースで。'
    : speed === 'fast' ? 'やや速いペースで。'
    : speed === 'veryfast' ? '速いペースで。'
    : 'ふつうのペースで。';

  const prompt = `そろばんの読み上げ算の読み手として読んでください。${speedPrompt}桁を間違えないように注意して。`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-tts:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt + '\n\n' + text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Orus' }
              }
            }
          }
        })
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(502).json({ error: 'Gemini TTS error', detail: err.slice(0, 300) });
    }

    const result = await resp.json();
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(p => p.inlineData);

    if (!audioPart) {
      return res.status(422).json({ error: 'No audio in response' });
    }

    return res.status(200).json({
      audioContent: audioPart.inlineData.data,
      mimeType: audioPart.inlineData.mimeType
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
