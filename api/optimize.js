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

    const expenseLines =
      Array.isArray(expenses) && expenses.length > 0
        ? expenses
            .map(
              e =>
                `  - ${e.vendor} [${e.category}]: $${Math.round(
                  e.annualizedAmount || e.amount || 0
                )}/yr (biz% ${Math.round((e.bizPct || 1) * 100)}%)`
            )
            .join('\n')
        : '  (none tracked yet)';

    // Group expense totals by category for the AI
    const catTotals = {};
    if (Array.isArray(expenses)) {
      for (const e of expenses) {
        const cat = e.category || 'Other';
        catTotals[cat] = (catTotals[cat] || 0) + Math.round(e.annualizedAmount || e.amount || 0);
      }
    }
    const catSummary = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, total]) => `  ${cat}: $${total.toLocaleString()}`)
      .join('\n') || '  (none)';

    console.log(`[Optimization Scan] Calling model: ${model}`);
    console.log(`[Optimization Scan] Profile analyzed: Biz Revenue $${bizIncome}, W-2 $${w2Income}, SE Profit $${netSE}`);

    const prompt = `You are a CPA-level tax optimization AI analyzing a real user's tax profile. Return ONLY a raw JSON object — no markdown, no code fences, no preamble.

USER PROFILE:
- Business income: $${Math.round(bizIncome || 0).toLocaleString()}
- W-2 / salary income: $${Math.round(w2Income || 0).toLocaleString()}
- Net self-employment income (after expenses): $${Math.round(netSE || 0).toLocaleString()}
- Total business deductions already tracked: $${Math.round(totalBizDed || 0).toLocaleString()}
- Marginal federal tax rate: ${Math.round((marginal || 0.22) * 100)}%
- Current tax position: ${(position || 0) >= 0 ? 'refund of $' + Math.abs(Math.round(position || 0)).toLocaleString() : 'OWED $' + Math.abs(Math.round(position || 0)).toLocaleString()}
- Optimizations already applied:
    SEP-IRA contribution: $${Math.round(scenario?.sepIra || 0).toLocaleString()}
    Self-employed health insurance: $${Math.round(scenario?.healthIns || 0).toLocaleString()}
    Business mileage: ${scenario?.mileage || 0} miles

TRACKED EXPENSES (${Array.isArray(expenses) ? expenses.length : 0} items):
${expenseLines}

EXPENSE TOTALS BY CATEGORY:
${catSummary}

AVAILABLE STRATEGY IDs (only include those NOT yet applied AND that genuinely benefit this user given their numbers):
- sep-ira: SEP-IRA retirement contribution (max 25% of net SE or $69,000) — only if sepIra is $0
- health-ins: Self-employed health insurance deduction — only if healthIns is $0 and bizIncome > 0
- home-office: Simplified home office ($5/sqft, max 300sqft = $1,500 deduction) — only if business income exists
- mileage: Business mileage at $0.70/mile — only if mileage is 0 and bizIncome > 0
- equipment-179: Section 179 immediate equipment expensing — only if Equipment & Hardware expenses exist

TASK: Based on the actual numbers above, rank the strategies by dollar impact for THIS specific user. Write specific, numbers-based insights (e.g., "With $${Math.round(netSE || 0).toLocaleString()} net SE income, a max SEP-IRA contribution of $${Math.min(69000, Math.round((netSE || 0) * 0.25)).toLocaleString()} would save $${Math.round(Math.min(69000, (netSE || 0) * 0.25) * (marginal || 0.22)).toLocaleString()} at your ${Math.round((marginal || 0.22) * 100)}% rate.").

Return this exact JSON (real values only, no example placeholders):
{"rankedIds":["sep-ira","health-ins"],"topInsight":"Specific one-sentence top move with dollar amounts.","insights":{"sep-ira":"Specific reason with dollar amounts.","health-ins":"Specific reason with dollar amounts."}}`;

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
        max_tokens: 800,
        temperature: 0.1,
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
