const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const requiredEnv = [
  "BW_ACCOUNT_ID",
  "BW_APPLICATION_ID",
  "BW_NUMBER",
  "BW_CLIENT_ID",
  "BW_CLIENT_SECRET",
  "BASE_URL",
  "AGENT_NUMBER"
];

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function missingEnv() {
  return requiredEnv.filter((name) => !env(name));
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePhone(input) {
  const s = String(input || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    throw new Error(`Invalid E.164 phone number: ${s || "(blank)"}`);
  }
  return s;
}

async function getBandwidthToken() {
  const clientId = env("BW_CLIENT_ID");
  const clientSecret = env("BW_CLIENT_SECRET");

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");

  const response = await axios.post(
    "https://api.bandwidth.com/api/v1/oauth2/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    }
  );

  if (!response.data?.access_token) {
    throw new Error("Bandwidth returned no access_token");
  }
  return response.data.access_token;
}

async function createCall(to) {
  const token = await getBandwidthToken();
  const accountId = encodeURIComponent(env("BW_ACCOUNT_ID"));

  const response = await axios.post(
    `https://voice.bandwidth.com/api/v2/accounts/${accountId}/calls`,
    {
      from: normalizePhone(env("BW_NUMBER")),
      to: normalizePhone(to),
      applicationId: env("BW_APPLICATION_ID"),
      answerUrl: `${env("BASE_URL").replace(/\/+$/, "")}/callbacks/answer`,
      answerMethod: "POST",
      disconnectUrl: `${env("BASE_URL").replace(/\/+$/, "")}/callbacks/disconnect`,
      disconnectMethod: "POST",
      callTimeout: 30
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`Bandwidth Voice API returned ${response.status}`);
    err.details = response.data;
    throw err;
  }
  return response.data;
}

app.get("/health", (req, res) => {
  const missing = missingEnv();
  res.json({
    ok: missing.length === 0,
    service: "storm-dialer-clean",
    missing
  });
});

// Safe credential test. Never returns the secret or token.
app.get("/debug/auth", async (req, res) => {
  const missing = missingEnv();
  if (missing.length) {
    return res.status(500).json({ ok: false, stage: "environment", missing });
  }

  try {
    await getBandwidthToken();
    res.json({
      ok: true,
      stage: "oauth",
      message: "Bandwidth accepted the Client ID and Client Secret.",
      clientId: env("BW_CLIENT_ID"),
      secretLength: env("BW_CLIENT_SECRET").length
    });
  } catch (error) {
    const status = error.response?.status || 500;
    res.status(status).json({
      ok: false,
      stage: "oauth",
      status,
      bandwidth: error.response?.data || null,
      clientId: env("BW_CLIENT_ID"),
      secretLength: env("BW_CLIENT_SECRET").length
    });
  }
});

app.post("/api/call", async (req, res) => {
  try {
    const to = normalizePhone(req.body?.to);
    console.log("Calling:", to);
    const data = await createCall(to);
    res.json({ ok: true, to, callId: data?.callId || null });
  } catch (error) {
    const status = error.response?.status || 500;
    const details = error.details || error.response?.data || error.message;
    console.error("CALL ERROR:", status, details);
    res.status(status).json({ ok: false, error: details });
  }
});

app.post("/api/campaign", async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
    const concurrency = Math.max(1, Math.min(Number(req.body?.concurrency || 1), 3));
    const numbers = [...new Set(raw.map(normalizePhone))];

    if (!numbers.length) {
      return res.status(400).json({ ok: false, error: "No valid numbers supplied." });
    }
    if (numbers.length > 100) {
      return res.status(400).json({ ok: false, error: "Maximum 100 numbers per campaign." });
    }

    const results = [];
    let index = 0;

    async function worker() {
      while (index < numbers.length) {
        const i = index++;
        const to = numbers[i];
        try {
          const data = await createCall(to);
          results[i] = { to, ok: true, callId: data?.callId || null };
        } catch (error) {
          results[i] = {
            to,
            ok: false,
            error: error.details || error.response?.data || error.message
          };
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    res.json({ ok: true, results });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// When the lead answers, transfer that answered call to the agent.
app.post("/callbacks/answer", (req, res) => {
  const agent = normalizePhone(env("AGENT_NUMBER"));
  const callerId = normalizePhone(env("BW_NUMBER"));

  const bxml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <SpeakSentence>Please hold while I connect you.</SpeakSentence>
  <Transfer transferCallerId="${xmlEscape(callerId)}" callTimeout="30">
    <PhoneNumber>${xmlEscape(agent)}</PhoneNumber>
  </Transfer>
</Response>`;

  res.type("application/xml").send(bxml);
});

app.post("/callbacks/disconnect", (req, res) => {
  console.log("Disconnected:", req.body?.callId || req.body?.to || "unknown");
  res.sendStatus(200);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Storm Dialer listening on port ${PORT}`);
  const missing = missingEnv();
  if (missing.length) console.log("Missing environment variables:", missing.join(", "));
});
