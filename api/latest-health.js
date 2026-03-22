module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    console.error("KV_REST_API_URL or KV_REST_API_TOKEN not set");
    return res.status(500).json({
      data: null,
      timestamp: null,
      error: "Server misconfigured — Vercel KV credentials not set",
    });
  }

  try {
    const kvResp = await fetch(`${kvUrl}/get/health-data`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    if (!kvResp.ok) {
      const errText = await kvResp.text();
      console.error("Vercel KV get failed:", kvResp.status, errText);
      return res.status(200).json({
        data: null,
        timestamp: null,
        error: "Failed to read from KV store: " + kvResp.status,
      });
    }

    const kvBody = await kvResp.json();
    const stored = kvBody.result;

    if (!stored) {
      return res.status(200).json({
        data: null,
        timestamp: null,
        error: "No health data synced yet. Run your Apple Health Shortcut first.",
      });
    }

    // stored is a JSON string — parse it
    let parsed;
    try {
      parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    } catch {
      parsed = { data: null, timestamp: null };
    }

    console.log("Serving health data synced at", parsed.timestamp, "—", Object.keys(parsed.data || {}).length, "dates");
    return res.status(200).json({
      data: parsed.data || null,
      timestamp: parsed.timestamp || null,
    });
  } catch (err) {
    console.error("Error fetching health data:", err.message);
    return res.status(200).json({
      data: null,
      timestamp: null,
      error: "Server error: " + err.message,
    });
  }
};
