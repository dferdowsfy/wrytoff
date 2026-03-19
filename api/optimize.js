// AI Scan — analyzes the user's full profile and ranks tax strategies.
// Model is configurable via OPENROUTER_MODEL env var in Vercel.
// Default: nvidia/nemotron-3-super-120b-a12b:free

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  const model =
    process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';

  if (!key) {
    return res.status(500).json({ error: 'Server missing OPENROUTER_API_KEY' });
  }

  try {
    const {
      bizIncome,
      w2Income,
      netSE,
      marginal,
      totalBizDed,
      expenses,
      scenario,
      position,
    } = req.body || {};

    const expenseSummary =
      Array.isArray(expenses) && expenses.length > 0
        ? expenses
            .slice(0, 20)
            .map(
              e =>
                `${e.vendor} (${e.category}): $${Math.round(
                  e.annualizedAmount || e.amount || 0
                )}`
            )
            .join(', ')
        : 'none tracked';

    const prompt = `You are a tax optimization AI. Analyze the user profile below and return ONLY a raw JSON object — no markdown, no code fences, no explanation.

User profile:
- Business income: $${Math.round(bizIncome || 0)}
- W-2 income: $${Math.round(w2Income || 0)}
- Net self-employment income: $${Math.round(netSE || 0)}
- Total deductions already tracked: $${Math.round(totalBizDed || 0)}
- Marginal tax rate: ${Math.round((marginal || 0.22) * 100)}%
- Tax position: ${
      (position || 0) >= 0
        ? 'refund of $' + Math.abs(Math.round(position || 0))
        : 'owed $' + Math.abs(Math.round(position || 0))
    }
- SEP-IRA already applied: $${Math.round(scenario?.sepIra || 0)}
- Health insurance deduction already applied: $${Math.round(scenario?.healthIns || 0)}
- Mileage already applied: ${scenario?.mileage || 0} miles
- Tracked expenses: ${expenseSummary}

Available strategy IDs to rank (include only those that still benefit this user):
sep-ira, health-ins, home-office, mileage, equipment-179

Return this exact JSON structure (fill with real values, no placeholders):
{"rankedIds":["sep-ira","health-ins"],"topInsight":"One plain sentence about the top priority move for this user.","insights":{"sep-ira":"Plain sentence reason.","health-ins":"Plain sentence reason."}}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wrytofftax.vercel.app',
        'X-Title': 'Wrytoff',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'OpenRouter Error',
        upstreamStatus: response.status,
      });
    }

    const content = data?.choices?.[0]?.message?.content || '';

    // Try multiple extraction strategies in order
    let parsed = null;

    // 1. Direct parse (model returned clean JSON)
    try {
      parsed = JSON.parse(content.trim());
    } catch (_) {}

    // 2. Strip markdown code fences: ```json {...} ``` or ``` {...} ```
    if (!parsed) {
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          parsed = JSON.parse(fenceMatch[1].trim());
        } catch (_) {}
      }
    }

    // 3. Extract first {...} block (greedy, handles trailing text)
    if (!parsed) {
      // Find outermost balanced braces
      const start = content.indexOf('{');
      if (start !== -1) {
        let depth = 0;
        let end = -1;
        for (let i = start; i < content.length; i++) {
          if (content[i] === '{') depth++;
          else if (content[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end !== -1) {
          try {
            parsed = JSON.parse(content.slice(start, end + 1));
          } catch (_) {}
        }
      }
    }

    if (parsed) {
      return res.status(200).json(parsed);
    }

    // Fallback: model returned non-JSON text — surface it as the insight
    return res.status(200).json({
      rankedIds: [],
      topInsight: content.slice(0, 250).replace(/[#*`]/g, '').trim(),
      insights: {},
    });
  } catch (error) {
    console.error('Optimize API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
