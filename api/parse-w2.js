const NEMOTRON = 'nvidia/nemotron-3-super-120b-a12b:free';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: 'Server missing OPENROUTER_API_KEY',
      debug: {
        hasOpenRouterKey: false,
        vercelEnv: process.env.VERCEL_ENV || 'unknown',
      },
    });
  }

  try {
    const { messages = [] } = req.body || {};

    // Convert Anthropic-style multimodal payload to OpenAI/OpenRouter format.
    // Nemotron supports image_url blocks; it does NOT support native document blocks.
    const openRouterMessages = messages.map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map(block => {
            if (block.type === 'image' && block.source?.type === 'base64') {
              return {
                type: 'image_url',
                image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
              };
            }
            if (block.type === 'document' && block.source?.type === 'base64') {
              // Nemotron does not support native document blocks — convert to image_url
              return {
                type: 'image_url',
                image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
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
        model: NEMOTRON,
        messages: openRouterMessages,
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
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
