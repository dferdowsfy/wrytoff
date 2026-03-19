export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { system, messages, model } = req.body;
    const key = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    
    if (!key) {
      return res.status(401).json({ error: "Missing OPENROUTER_API_KEY in Vercel environment" });
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
    if (!response.ok) throw new Error(data.error?.message || "OpenRouter API error");

    res.status(200).json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("Chat API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
