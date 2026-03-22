const fs = require("fs");

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Read from /tmp file written by /api/health-sync
  try {
    const raw = fs.readFileSync("/tmp/health-data.json", "utf-8");
    const cached = JSON.parse(raw);
    console.log("Serving cached health data from", cached.timestamp, "—", Object.keys(cached.data || {}).length, "dates");
    return res.status(200).json(cached);
  } catch (err) {
    console.log("No cached health data found:", err.message);
    return res.status(200).json({ data: null, timestamp: null, error: "No health data synced yet. Run your Apple Health Shortcut first." });
  }
};
