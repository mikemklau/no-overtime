
const fs = require("fs");

let checkout = fs.readFileSync("src/app/api/checkout/route.ts", "utf8");
checkout = checkout.replace("2024-09-30.acacia", "2026-09-30.endive"); 
fs.writeFileSync("src/app/api/checkout/route.ts", checkout, "utf8");

let webhook = fs.readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
webhook = webhook.replace("2024-09-30.acacia", "2026-09-30.endive");
fs.writeFileSync("src/app/api/webhooks/stripe/route.ts", webhook, "utf8");

