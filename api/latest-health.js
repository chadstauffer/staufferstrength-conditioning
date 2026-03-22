const { get } = require("@vercel/edge-config");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const stored = await get("health-data");

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
