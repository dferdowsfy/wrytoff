export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(401).json({ error: "Missing OPENROUTER_API_KEY in server environment" });
  }

  try {
    const { system, messages, model } = req.body;

    const openRouterMessages = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || model || "openai/gpt-4o-mini",
        messages: openRouterMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", data);
      return res.status(response.status).json({
        error: data.error?.message || "OpenRouter API error",
        details: data.error,
      });
    }

    return res.status(200).json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("Chatbot API Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
