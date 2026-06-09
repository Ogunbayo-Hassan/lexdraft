const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const API_KEY = process.env.GROQ_API_KEY || "";
const PORT = process.env.PORT || 3000;

function callGroq(userMessage, retries = 3) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 2000,
      temperature: 0.3,
    });

    const options = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => (data += chunk));
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error)
            return reject(new Error(parsed.error.message || "Groq API error"));
          const text = parsed?.choices?.[0]?.message?.content || "";
          if (!text) return reject(new Error("Empty response from Groq"));
          resolve(text);
        } catch (e) {
          reject(new Error("Failed to parse Groq response"));
        }
      });
    });

    apiReq.on("timeout", () => {
      apiReq.destroy();
      reject(new Error("Request timed out"));
    });

    apiReq.on("error", (e) => {
      if (retries > 1) {
        console.log(`Retrying... (${retries - 1} attempts left)`);
        setTimeout(() => {
          callGroq(userMessage, retries - 1)
            .then(resolve)
            .catch(reject);
        }, 1500);
      } else {
        reject(new Error("Connection failed after retries: " + e.message));
      }
    });

    apiReq.write(postData);
    apiReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve frontend
  if (req.method === "GET" && req.url === "/") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // API proxy
  if (req.method === "POST" && req.url === "/api/generate") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const userMessage = payload.messages[0].content;
        console.log("Generating document...");
        const text = await callGroq(userMessage);
        console.log("Success — length:", text.length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: [{ text }] }));
      } catch (e) {
        console.error("Error:", e.message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n✦ LexDraft is running at http://localhost:${PORT}\n`);
  if (!API_KEY) console.warn("⚠  WARNING: GROQ_API_KEY is not set.\n");
});
