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
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        messages: openRouterMessages,
        max_tokens: 1024,
        temperature: 0.7,
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
        model: "nvidia/nemotron-3-super-120b-a12b:free",
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

app.post("/api/optimize", async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Server missing OPENROUTER_API_KEY" });
    }

    const { bizIncome, w2Income, netSE, marginal, totalBizDed, expenses, scenario, position } = req.body;

    const expenseSummary = Array.isArray(expenses) && expenses.length > 0
      ? expenses.slice(0, 20).map(e => `${e.vendor} (${e.category}): $${Math.round(e.annualizedAmount || e.amount || 0)}`).join(", ")
      : "none tracked";

    const prompt = `You are a tax optimization AI. Analyze this user's tax profile and rank which strategies apply and matter most. Respond with only valid JSON, no markdown or extra text.

User profile:
- Business income: $${Math.round(bizIncome || 0)}
- W-2 income: $${Math.round(w2Income || 0)}
- Net SE income: $${Math.round(netSE || 0)}
- Total deductions: $${Math.round(totalBizDed || 0)}
- Marginal tax rate: ${Math.round((marginal || 0.22) * 100)}%
- Tax position: ${(position || 0) >= 0 ? "refund of $" + Math.abs(Math.round(position || 0)) : "owed $" + Math.abs(Math.round(position || 0))}
- SEP-IRA contribution: $${Math.round(scenario?.sepIra || 0)}
- Health insurance deduction: $${Math.round(scenario?.healthIns || 0)}
- Mileage miles: ${scenario?.mileage || 0}
- Tracked expenses: ${expenseSummary}

Available strategies (return only IDs that apply to this user, ordered by impact):
- "sep-ira": SEP-IRA Contribution (max 25% of net SE, up to $69,000)
- "health-ins": Self-Employed Health Insurance deduction
- "home-office": Simplified Home Office ($5/sqft, max 300sqft)
- "mileage": Business Mileage ($0.70/mile in 2026)
- "equipment-179": Section 179 Equipment Expensing

Return exactly this JSON structure:
{"rankedIds":["id1","id2"],"topInsight":"one plain sentence about the single best move for this user","insights":{"id1":"brief plain reason","id2":"brief plain reason"}}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wrytofftax.vercel.app",
        "X-Title": "Wrytoff"
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.3,
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "OpenRouter API error");
    }

    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return res.json(JSON.parse(jsonMatch[0]));
      } catch (_) {}
    }
    res.json({ rankedIds: [], topInsight: content.slice(0, 300), insights: {} });
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
