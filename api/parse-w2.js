// W-2 vision parser — uses OPENROUTER_VISION_MODEL env var (e.g. qwen/qwen2.5-vl-72b-instruct:free)
// Accepts: POST { imageBase64: string, mediaType: string }
// Returns: { wages, federalWithholding, employerName, stateName, stateWithholding, zipCode }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  const visionModel =
    process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen2.5-vl-72b-instruct:free';

  if (!key) {
    return res.status(500).json({ error: 'Server missing OPENROUTER_API_KEY' });
  }

  const { imageBase64, mediaType = 'image/jpeg' } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64 in request body' });
  }

  const prompt =
    'You are a W-2 tax document parser. Look at this W-2 image and extract the key fields. ' +
    'Return ONLY a valid JSON object with no extra text, no markdown, no code fences:\n' +
    '{"wages":number,"federalWithholding":number,"employerName":"string","stateName":"string","stateWithholding":number,"zipCode":"string"}\n' +
    'Use 0 for any numeric field you cannot read. Use empty string for text fields you cannot read.';

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wrytofftax.vercel.app',
        'X-Title': 'Wrytoff',
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 400,
        temperature: 0.0,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenRouter W-2 error:', JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || 'Vision model error',
        model: visionModel,
        upstream: data,
      });
    }

    const raw = data?.choices?.[0]?.message?.content || '';
    console.log('W-2 raw response:', raw);

    // Parse JSON from model output — try multiple extraction strategies
    let parsed = null;

    try { parsed = JSON.parse(raw.trim()); } catch (_) {}

    if (!parsed) {
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) try { parsed = JSON.parse(fence[1].trim()); } catch (_) {}
    }

    if (!parsed) {
      const start = raw.indexOf('{');
      if (start !== -1) {
        let depth = 0, end = -1;
        for (let i = start; i < raw.length; i++) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
      }
    }

    if (!parsed) {
      return res.status(422).json({
        error: 'Could not extract JSON from model response',
        raw,
        model: visionModel,
      });
    }

    // Normalise fields and return structured data
    return res.status(200).json({
      wages: Number(parsed.wages) || 0,
      federalWithholding: Number(parsed.federalWithholding) || 0,
      employerName: parsed.employerName || '',
      stateName: parsed.stateName || '',
      stateWithholding: Number(parsed.stateWithholding) || 0,
      zipCode: parsed.zipCode || '',
      model: visionModel,
    });
  } catch (error) {
    console.error('W-2 Parse Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
