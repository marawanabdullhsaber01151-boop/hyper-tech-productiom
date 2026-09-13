#!/usr/bin/env node

const baseUrl = process.env.PORTAL_ORDERS_RACE_URL;
const token = process.env.PORTAL_ORDERS_RACE_TOKEN;
const batchRef = process.env.PORTAL_ORDERS_RACE_BATCH_REF;
const action = process.env.PORTAL_ORDERS_RACE_ACTION || "confirm";
const rawBody = process.env.PORTAL_ORDERS_RACE_BODY;

if (!baseUrl || !token || !batchRef || !rawBody) {
  console.error(
    "Required env: PORTAL_ORDERS_RACE_URL, PORTAL_ORDERS_RACE_TOKEN, " +
      "PORTAL_ORDERS_RACE_BATCH_REF, PORTAL_ORDERS_RACE_BODY",
  );
  process.exit(2);
}

if (!["confirm", "reject"].includes(action)) {
  console.error("PORTAL_ORDERS_RACE_ACTION must be confirm or reject");
  process.exit(2);
}

let body;
try {
  body = JSON.parse(rawBody);
} catch {
  console.error("PORTAL_ORDERS_RACE_BODY must be valid JSON");
  process.exit(2);
}

const endpoint =
  `${baseUrl.replace(/\/$/, "")}/api/v1/portal-orders/` +
  `${encodeURIComponent(batchRef)}/${action}`;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

const responses = await Promise.all(
  [1, 2].map(async (requestNumber) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the status assertion useful even if an upstream proxy returns
      // a non-JSON error body.
    }
    return { requestNumber, status: response.status, payload };
  }),
);

for (const response of responses) {
  console.log(
    `request ${response.requestNumber}: ${response.status}`,
    JSON.stringify(response.payload),
  );
}

const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
if (statuses[0] !== 200 || statuses[1] !== 409) {
  console.error(
    `Expected one 200 and one 409, received: ${statuses.join(", ")}`,
  );
  process.exit(1);
}

const conflict = responses.find((response) => response.status === 409);
const conflictMessage = conflict?.payload?.error?.message;
if (conflictMessage !== "الإرسالية دي اتراجعت بالفعل من موظف تاني في نفس اللحظة") {
  console.error("The losing request did not return the expected conflict message");
  process.exit(1);
}

console.log("Portal order review race test passed.");