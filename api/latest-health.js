module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ecId = process.env.EDGE_CONFIG?.match(/ecfg_[a-z0-9]+/)?.[0] || process.env.EDGE_CONFIG_ID;
  const vercelToken = process.env.VERCEL_TOKEN;

  if (!ecId || !vercelToken) {
    console.error("Missing env:", ecId ? "" : "EDGE_CONFIG_ID", vercelToken ? "" : "VERCEL_TOKEN");
    return res.status(500).json({ data: null, timestamp: null, error: "Server misconfigured" });
  }

  try {
    const ecResp = await fetch(`https://api.vercel.com/v1/edge-config/${ecId}/item/health-data`, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });

    if (!ecResp.ok) {
      const errText = await ecResp.text();
      console.error("Edge Config read failed:", ecResp.status, errText);
      return res.status(200).json({ data: null, timestamp: null, error: "Read failed: " + ecResp.status });
    }

    const body = await ecResp.json();
    const stored = body.value || body;

    if (!stored || !stored.data) {
      return res.status(200).json({ data: null, timestamp: null, error: "No health data synced yet. Run your Apple Health Shortcut first." });
    }

    console.log("Serving health data synced at", stored.timestamp, "—", Object.keys(stored.data).length, "dates");
    return res.status(200).json({ data: stored.data, timestamp: stored.timestamp });
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({ data: null, timestamp: null, error: err.message });
  }
};
