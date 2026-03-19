export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(401).json({ error: "Missing OPENROUTER_API_KEY in server environment" });
  }

  try {
    const { messages, model } = req.body;

    // Convert Anthropic multimodal payload to OpenAI standard format
    const openRouterMessages = messages.map((msg) => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map((block) => {
            if (block.type === "image" && block.source?.type === "base64") {
              return {
                type: "image_url",
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              };
            }
            if (block.type === "document") {
              return {
                type: "image_url",
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              };
            }
            return { type: "text", text: block.text };
          })
        : msg.content,
    }));

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
      console.error("OpenRouter error (parse-w2):", data);
      return res.status(response.status).json({
        error: data.error?.message || "OpenRouter API error",
        details: data.error,
      });
    }

    return res.status(200).json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("W-2 Parse Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
