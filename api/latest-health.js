const { createClient } = require("@vercel/edge-config");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const rawEdgeConfig = process.env.EDGE_CONFIG || "";
  console.log("EDGE_CONFIG:", rawEdgeConfig.substring(0, 80));

  if (!rawEdgeConfig) {
    console.error("EDGE_CONFIG env var not set");
    return res.status(500).json({ data: null, timestamp: null, error: "EDGE_CONFIG not configured" });
  }

  // Build connection string — EDGE_CONFIG may be just the ID (ecfg_xxx) or the full URL
  const connectionString = rawEdgeConfig.startsWith("ecfg_")
    ? `https://edge-config.vercel.com/${rawEdgeConfig}?token=${process.env.VERCEL_TOKEN}`
    : rawEdgeConfig;

  console.log("Connection string:", connectionString.substring(0, 80));

  try {
    const edgeConfig = createClient(connectionString);
    const stored = await edgeConfig.get("health-data");

    if (!stored || !stored.data) {
      console.log("No health data in Edge Config");
      return res.status(200).json({
        data: null,
        timestamp: null,
        error: "No health data synced yet. Run your Apple Health Shortcut first.",
      });
    }

    console.log("Serving health data synced at", stored.timestamp, "—", Object.keys(stored.data).length, "dates");
    return res.status(200).json({
      data: stored.data,
      timestamp: stored.timestamp,
    });
  } catch (err) {
    console.error("Edge Config read error:", err.message);
    return res.status(200).json({
      data: null,
      timestamp: null,
      error: "Failed to read health data: " + err.message,
    });
  }
};
