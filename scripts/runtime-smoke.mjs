const agentBaseUrl = process.env.AGENT_API_URL ?? "http://127.0.0.1:3001";
const frontendUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:3000";

async function readJson(path, init) {
  const response = await fetch(`${agentBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload?.data;
}

function assertNoSecretLeak(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  const leaked = ["private_key", "agent_private_key", "groq_api_key", "deepseek_api_key", "telegram_bot_token"]
    .some((needle) => serialized.includes(needle));

  if (leaked) {
    throw new Error("Smoke check detected a secret-looking key in API output");
  }
}

const checks = [];

checks.push(["agent health", async () => {
  const health = await readJson("/api/health");
  assertNoSecretLeak(health);
  if (health.ok === false) {
    throw new Error("Agent health returned ok:false");
  }
  return "ok";
}]);

checks.push(["public chain", async () => {
  const chain = await readJson("/api/public-chain");
  if (!chain.chainId || !chain.rpcUrl || !chain.nativeCurrency?.symbol) {
    throw new Error("Public chain metadata is incomplete");
  }
  return `${chain.name} (${chain.chainId})`;
}]);

checks.push(["demo scenario", async () => {
  const result = await readJson("/api/demo/scenarios", {
    method: "POST",
    body: JSON.stringify({ scenario: "setup_ready" })
  });
  if (result.mode !== "simulation") {
    throw new Error("Demo scenario did not report simulation mode");
  }
  return result.walletAddress;
}]);

checks.push(["audit redaction", async () => {
  const result = await readJson("/api/audit-events/recent?limit=10");
  assertNoSecretLeak(result);
  return `${result.events.length} events`;
}]);

checks.push(["frontend http", async () => {
  const response = await fetch(frontendUrl);
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Frontend returned ${response.status}`);
  }
  for (const label of ["Overview", "Setup", "Risk", "Receipts"]) {
    if (!html.includes(label)) {
      throw new Error(`Frontend shell is missing ${label} navigation`);
    }
  }
  return response.status;
}]);

checks.push(["telegram connect", async () => {
  const result = await readJson("/api/telegram/connect/start", {
    method: "POST",
    body: JSON.stringify({ walletAddress: "0x1111111111111111111111111111111111111111" })
  });
  if (!result.code || result.status !== "waiting" || !result.botDeepLink.includes("t.me/")) {
    throw new Error("Telegram Connect start response is incomplete");
  }
  return result.status;
}]);

for (const [name, run] of checks) {
  try {
    const detail = await run();
    console.log(`ok - ${name}: ${detail}`);
  } catch (error) {
    console.error(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
