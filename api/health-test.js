module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/plain");
  res.status(200).send("https://staufferstrength-conditioning.vercel.app/?data=test123");
};
