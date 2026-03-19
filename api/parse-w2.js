export const config = {
  runtime: 'edge',
};

export default async function (req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { messages, model } = await req.json();
    const key = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 401 });
    }

    const openRouterMessages = messages.map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content) ? msg.content.map(block => {
        if (block.type === "image" && block.source?.type === "base64") {
          return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
        }
        if (block.type === "document") {
          return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
        }
        return { type: "text", text: block.text };
      }) : msg.content
    }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wrytofftax.vercel.app",
        "X-Title": "Wrytoff"
      },
      body: JSON.stringify({
        model: process.env.VITE_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || model || "openai/gpt-5.4-nano",
        messages: openRouterMessages,
      })
    });

    const data = await response.json();
    if (!response.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'OpenRouter Error' }), { status: response.status });
    }

    return new Response(JSON.stringify({ content: data.choices[0].message.content }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error("W-2 Parse Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
