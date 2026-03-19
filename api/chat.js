export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  const defaultModel = process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5';

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
    const { system, messages = [], model } = req.body || {};

    const openRouterMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wrytofftax.vercel.app',
        'X-Title': 'Wrytoff',
      },
      body: JSON.stringify({
        model: model || defaultModel,
        messages: openRouterMessages,
        max_tokens: 1024,
        temperature: 0.7,
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
    console.error('Chat API Error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}