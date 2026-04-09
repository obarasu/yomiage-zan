// /api/tts.js - Vercel serverless function
// Cloud TTS (fast) with Gemini TTS fallback

function pcmToWav(pcmBase64, sampleRate, channels, bitsPerSample) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
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

  const { text, speed, engine } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const cloudKey = process.env.GOOGLE_TTS_API_KEY;
  const geminiKey = process.env.GEMINI_TTS_API_KEY;

  const speakingRate = speed === 'slow' ? 0.85 : speed === 'fast' ? 1.3 : 1.0;

  // Try Cloud TTS first (fast), fallback to Gemini TTS
  try {
    if (cloudKey && engine !== 'gemini') {
      // Cloud TTS - fast, reliable
      // Detect SSML (starts with <speak>)
      const isSSML = text.trim().startsWith('<speak>');
      const input = isSSML ? { ssml: text } : { text };

      const resp = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${cloudKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input,
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-C' },
            audioConfig: { audioEncoding: 'MP3', speakingRate, pitch: -2.0 }
          })
        }
      );

      if (resp.ok) {
        const result = await resp.json();
        return res.status(200).json({
          audioContent: result.audioContent,
          mimeType: 'audio/mp3'
        });
      }
      // If Cloud TTS fails, fall through to Gemini
    }

    // Gemini TTS fallback
    if (geminiKey) {
      const speedPrompt = speed === 'slow' ? 'ゆっくりめのペースで。'
        : speed === 'fast' ? 'やや速いペースで。'
        : 'ふつうのペースで。';

      const prompt = `そろばんの読み上げ算の読み手として読んでください。${speedPrompt}桁を間違えないように注意して。数字はカンマ区切りで書いてあります。正確に読んでください。「よん」は「よ」に省略しないでください。`;

      const models = ['gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts'];

      for (const model of models) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt + '\n\n' + text }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } }
                }
              })
            }
          );

          if (!resp.ok) continue;
          const result = await resp.json();
          const audioPart = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (!audioPart) continue;

          const mime = audioPart.inlineData.mimeType || '';
          const rateMatch = mime.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
          const wavBase64 = pcmToWav(audioPart.inlineData.data, sampleRate, 1, 16);

          return res.status(200).json({ audioContent: wavBase64, mimeType: 'audio/wav' });
        } catch (e) { continue; }
      }
    }

    return res.status(502).json({ error: 'All TTS engines failed' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
