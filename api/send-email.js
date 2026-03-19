export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.RESEND_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: 'Server missing RESEND_API_KEY',
      debug: {
        hasResendKey: false,
        vercelEnv: process.env.VERCEL_ENV || 'unknown',
      },
    });
  }

  try {
    const { html, to } = req.body || {};

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key.trim()}`,
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
    if (!response.ok) {
        return res.status(response.status).json({
          error: data?.message || 'Resend API Error',
          upstreamStatus: response.status,
          upstream: data,
        });
    }

    res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
