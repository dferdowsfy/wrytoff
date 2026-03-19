export const config = {
  runtime: 'edge',
};

export default async function (req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { system, messages, model } = await req.json();
    const key = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    
    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 401 });
    }

    const openRouterMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

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
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
