// /api/tts.js - Vercel serverless function for Gemini Pro TTS
// Uses Generative Language API with Orus voice
// Converts PCM to WAV for browser playback

function pcmToWav(pcmBase64, sampleRate, channels, bitsPerSample) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;
  const wav = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);

  // fmt chunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcm.copy(wav, 44);

  return wav.toString('base64');
}

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

  const speedPrompt = speed === 'slow' ? 'ゆっくりめのペースで。'
    : speed === 'fast' ? 'やや速いペースで。'
    : speed === 'veryfast' ? '速いペースで。'
    : 'ふつうのペースで。';

  const prompt = `以下のひらがなテキストを、そのまま一字一句正確に音読してください。${speedPrompt}読み上げ算の読み手の声色で、落ち着いたトーンで読んでください。テキストの内容を変えたり、数字を再解釈したりしないでください。書いてある通りに読むだけです。`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt + '\n\n' + text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Orus' }
        }
      }
    }
  });
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-tts:generateContent?key=${apiKey}`;

  // Try up to 2 times with delay
  async function tryGenerate() {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Gemini TTS error ' + resp.status + ': ' + err.slice(0, 200));
    }
    const result = await resp.json();
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(p => p.inlineData);
    if (!audioPart) throw new Error('No audio in response');
    return audioPart;
  }

  try {
    let audioPart;
    try {
      audioPart = await tryGenerate();
    } catch (firstErr) {
      // Retry once after 2 seconds
      await new Promise(r => setTimeout(r, 2000));
      audioPart = await tryGenerate();
    }

    const mime = audioPart.inlineData.mimeType || '';
    const pcmData = audioPart.inlineData.data;

    // Parse sample rate from mimeType (e.g., "audio/L16;codec=pcm;rate=24000")
    const rateMatch = mime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

    // Convert PCM to WAV
    const wavBase64 = pcmToWav(pcmData, sampleRate, 1, 16);

    return res.status(200).json({
      audioContent: wavBase64,
      mimeType: 'audio/wav'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
