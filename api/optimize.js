const NEMOTRON = 'nvidia/nemotron-3-super-120b-a12b:free';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: 'Server missing OPENROUTER_API_KEY',
      debug: { vercelEnv: process.env.VERCEL_ENV || 'unknown' },
    });
  }

  try {
    const { bizIncome, w2Income, netSE, marginal, totalBizDed, expenses, scenario, position } =
      req.body || {};

    const expenseSummary =
      Array.isArray(expenses) && expenses.length > 0
        ? expenses
            .slice(0, 20)
            .map(
              e =>
                `${e.vendor} (${e.category}): $${Math.round(e.annualizedAmount || e.amount || 0)}`
            )
            .join(', ')
        : 'none tracked';

    const prompt = `You are a tax optimization AI. Analyze this user's tax profile and rank which strategies apply and matter most. Respond with only valid JSON, no markdown or extra text.

User profile:
- Business income: $${Math.round(bizIncome || 0)}
- W-2 income: $${Math.round(w2Income || 0)}
- Net SE income: $${Math.round(netSE || 0)}
- Total deductions: $${Math.round(totalBizDed || 0)}
- Marginal tax rate: ${Math.round((marginal || 0.22) * 100)}%
- Tax position: ${(position || 0) >= 0 ? 'refund of $' + Math.abs(Math.round(position || 0)) : 'owed $' + Math.abs(Math.round(position || 0))}
- SEP-IRA contribution already applied: $${Math.round(scenario?.sepIra || 0)}
- Health insurance deduction already applied: $${Math.round(scenario?.healthIns || 0)}
- Mileage already applied: ${scenario?.mileage || 0} miles
- Tracked expenses: ${expenseSummary}

Available strategies (return only IDs that still apply and would benefit this user, ordered by estimated tax impact):
- "sep-ira": SEP-IRA Contribution (max 25% of net SE income, up to $69,000)
- "health-ins": Self-Employed Health Insurance 100% above-the-line deduction
- "home-office": Simplified Home Office at $5/sqft up to 300sqft
- "mileage": Business Mileage at $0.70/mile in 2026
- "equipment-179": Section 179 Equipment Expensing for immediate full deduction

Return exactly this JSON structure with no additional text:
{"rankedIds":["id1","id2"],"topInsight":"one plain sentence about the single highest-impact move for this specific user","insights":{"id1":"brief plain sentence why this matters for their profile","id2":"brief plain sentence"}}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wrytofftax.vercel.app',
        'X-Title': 'Wrytoff',
      },
      body: JSON.stringify({
        model: NEMOTRON,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.3,
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

    const content = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return res.status(200).json(JSON.parse(jsonMatch[0]));
      } catch (_) {}
    }

    // Fallback: return raw content as topInsight
    return res.status(200).json({
      rankedIds: [],
      topInsight: content.slice(0, 300),
      insights: {},
    });
  } catch (error) {
    console.error('Optimize API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
