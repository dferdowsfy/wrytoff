import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.post("/api/chat", async (req, res) => {
  try {
    const { system, messages, model } = req.body;
    
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    const openRouterMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || model || "openai/gpt-5.4-nano",
        messages: openRouterMessages,
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "OpenRouter API error");
    }

    res.json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("Chatbot API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/parse-w2", async (req, res) => {
  try {
    const { messages, model } = req.body;

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    // Convert Anthropic multimodal payload to OpenAI standard
    const openRouterMessages = messages.map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content) ? msg.content.map(block => {
        if (block.type === "image" && block.source?.type === "base64") {
          return {
            type: "image_url",
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
          };
        }
        if (block.type === "document") {
            // If PDF parsing isn't supported inherently, you might just do image
            // Actually Openrouter/gpt-4o and similar support pdf natively? 
            // Better to pass as image_url or text, but we'll try image_url for now or openrouter docs
            return {
                type: "image_url",
                image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
            };
        }
        return { type: "text", text: block.text };
      }) : msg.content
    }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || model || "openai/gpt-5.4-nano",
        messages: openRouterMessages,
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "OpenRouter API error");
    }

    res.json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("W-2 Parse Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { html, to } = req.body;
    
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "Server missing RESEND_API_KEY" });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Wrytoff Tax <onboarding@resend.dev>",
        to: to || "dferdows@gmail.com",
        subject: "CPA Handoff: 2026 Draft Profile",
        html: html
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Resend API error");

    res.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`API Server running on port ${PORT}`));
