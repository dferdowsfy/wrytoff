import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Model env vars — change in .env or Vercel to swap models without code changes:
//   OPENROUTER_MODEL       → chat + AI scan  (default: nvidia/nemotron-3-super-120b-a12b:free)
//   OPENROUTER_VISION_MODEL → W-2 parsing    (default: meta-llama/llama-3.2-11b-vision-instruct:free)
const CHAT_MODEL   = process.env.OPENROUTER_MODEL        || "nvidia/nemotron-3-super-120b-a12b:free";
const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "meta-llama/llama-3.2-11b-vision-instruct:free";

app.post("/api/chat", async (req, res) => {
  try {
    const { system, messages } = req.body;

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    const openRouterMessages = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: openRouterMessages,
        max_tokens: 300,
        temperature: 0.7,
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenRouter API error");

    res.json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("Chatbot API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/parse-w2", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    // Convert to OpenAI image_url format — vision models require this
    const openRouterMessages = messages.map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map(block => {
            if (
              (block.type === "image" || block.type === "document") &&
              block.source?.type === "base64"
            ) {
              return {
                type: "image_url",
                image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
              };
            }
            return { type: "text", text: block.text || "" };
          })
        : msg.content
    }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: openRouterMessages,
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenRouter API error");

    res.json({ content: data.choices[0].message.content });
  } catch (error) {
    console.error("W-2 Parse Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/optimize", async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    const { bizIncome, w2Income, netSE, marginal, totalBizDed, expenses, scenario, position } = req.body;

    const expenseSummary = Array.isArray(expenses) && expenses.length > 0
      ? expenses.slice(0, 20).map(e =>
          `${e.vendor} (${e.category}): $${Math.round(e.annualizedAmount || e.amount || 0)}`
        ).join(", ")
      : "none tracked";

    const prompt = `You are a tax optimization AI. Analyze the user profile below and return ONLY a raw JSON object — no markdown, no code fences, no explanation.

User profile:
- Business income: $${Math.round(bizIncome || 0)}
- W-2 income: $${Math.round(w2Income || 0)}
- Net self-employment income: $${Math.round(netSE || 0)}
- Total deductions already tracked: $${Math.round(totalBizDed || 0)}
- Marginal tax rate: ${Math.round((marginal || 0.22) * 100)}%
- Tax position: ${(position || 0) >= 0 ? "refund of $" + Math.abs(Math.round(position || 0)) : "owed $" + Math.abs(Math.round(position || 0))}
- SEP-IRA already applied: $${Math.round(scenario?.sepIra || 0)}
- Health insurance deduction already applied: $${Math.round(scenario?.healthIns || 0)}
- Mileage already applied: ${scenario?.mileage || 0} miles
- Tracked expenses: ${expenseSummary}

Available strategy IDs to rank (include only those that still benefit this user):
sep-ira, health-ins, home-office, mileage, equipment-179

Return this exact JSON structure (fill with real values, no placeholders):
{"rankedIds":["sep-ira","health-ins"],"topInsight":"One plain sentence about the top priority move for this user.","insights":{"sep-ira":"Plain sentence reason.","health-ins":"Plain sentence reason."}}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wrytofftax.vercel.app",
        "X-Title": "Wrytoff"
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenRouter API error");

    const content = data.choices?.[0]?.message?.content || "";

    // Try multiple extraction strategies
    let parsed = null;

    try { parsed = JSON.parse(content.trim()); } catch (_) {}

    if (!parsed) {
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) try { parsed = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }

    if (!parsed) {
      const start = content.indexOf("{");
      if (start !== -1) {
        let depth = 0, end = -1;
        for (let i = start; i < content.length; i++) {
          if (content[i] === "{") depth++;
          else if (content[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) try { parsed = JSON.parse(content.slice(start, end + 1)); } catch (_) {}
      }
    }

    if (parsed) return res.json(parsed);

    res.json({
      rankedIds: [],
      topInsight: content.slice(0, 250).replace(/[#*`]/g, "").trim(),
      insights: {}
    });
  } catch (error) {
    console.error("Optimize API Error:", error);
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
