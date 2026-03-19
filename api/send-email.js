export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(401).json({ error: "Missing RESEND_API_KEY in server environment" });
  }

  try {
    const { html, to } = req.body;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Wrytoff Tax <onboarding@resend.dev>",
        to: to || "dferdows@gmail.com",
        subject: "CPA Handoff: 2026 Draft Profile",
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(response.status).json({
        error: data.message || "Resend API error",
        details: data,
      });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error("Email send error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
