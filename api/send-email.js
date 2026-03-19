export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { html, to } = req.body;
    const key = process.env.VITE_RESEND_API_KEY || process.env.RESEND_API_KEY;

    if (!key) {
      return res.status(401).json({ error: "Missing RESEND_API_KEY in Vercel environment" });
    }

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
    if (!response.ok) throw new Error(data.message || "Resend API error");

    res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message });
  }
}
