
const fs = require("fs");

let checkout = fs.readFileSync("src/app/api/checkout/route.ts", "utf8");
checkout = checkout.replace("process.env.STRIPE_SECRET_KEY || '", "process.env.STRIPE_SECRET_KEY || 'sk_test_mock'"); 
fs.writeFileSync("src/app/api/checkout/route.ts", checkout, "utf8");

let webhook = fs.readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
webhook = webhook.replace("process.env.STRIPE_SECRET_KEY || '", "process.env.STRIPE_SECRET_KEY || 'sk_test_mock'");
fs.writeFileSync("src/app/api/webhooks/stripe/route.ts", webhook, "utf8");

