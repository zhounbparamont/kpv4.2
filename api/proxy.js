export default async function handler(req, res) {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).send("Missing url");
    }

    // Fetch LeanCloud file in server-side (HTTP allowed)
    const response = await fetch(targetUrl);

    if (!response.ok) {
      return res.status(response.status).send("Fetch failed: " + response.status);
    }

    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());

    // Important headers for file transfer
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).send("Proxy error: " + err.message);
  }
}
