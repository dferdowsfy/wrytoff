// W-2 parsing requires a vision-capable model.
// Nemotron does NOT support image input — use OPENROUTER_VISION_MODEL env var.
// Default: meta-llama/llama-3.2-11b-vision-instruct:free (free, vision-capable)
// To change: set OPENROUTER_VISION_MODEL in Vercel environment variables.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  const visionModel =
    process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3.5-flash-02-23';

  if (!key) {
    return res.status(500).json({ error: 'Server missing OPENROUTER_API_KEY' });
  }

  try {
    const { messages = [] } = req.body || {};
    
    // Log the incoming request for transparency
    console.log(`[W-2 Parse] Calling model: ${visionModel}`);
    console.log(`[W-2 Parse] Multimodal blocks found: ${messages[0]?.content?.length || 0}`);

    const openRouterMessages = messages.map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map(block => {
            if (
              (block.type === 'image' || block.type === 'document') &&
              block.source?.type === 'base64'
            ) {
              const mime = block.source.media_type || 'image/png';
              
              // If it's a PDF, we use the Anthropic-style 'document' block which OpenRouter better handles for PDF-capable models
              if (mime === 'application/pdf' || block.type === 'document') {
                console.log(`[W-2 Parse] Passing document block (${mime})`);
                return {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mime,
                    data: block.source.data
                  }
                };
              }
              
              // Standard images use OpenAI style image_url
              console.log(`[W-2 Parse] Passing image_url block (${mime})`);
              return {
                type: 'image_url',
                image_url: {
                  url: `data:${mime};base64,${block.source.data}`,
                },
              };
            }
            return { type: 'text', text: block.text || '' };
          })
        : msg.content,
    }));

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
          { role: "system", content: "You are a professional tax document parser. Extract W-2 data with 100% accuracy. Always provide output in a strict JSON block. Identify wages, federal withholding, employer, state, and other boxes clearly." },
          ...openRouterMessages
        ],
        response_format: { type: "json_object" }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'OpenRouter Error',
        upstreamStatus: response.status,
        upstream: data,
      });
    }

    return res.status(200).json({
      content: data?.choices?.[0]?.message?.content || '',
    });
  } catch (error) {
    console.error('W-2 Parse Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
