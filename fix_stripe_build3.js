const fs = require("fs");

let checkout = fs.readFileSync("src/app/api/checkout/route.ts", "utf8");
checkout = checkout.replace(/'sk_test_mock''/g, "'sk_test_mock'"); 
fs.writeFileSync("src/app/api/checkout/route.ts", checkout, "utf8");

let webhook = fs.readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
webhook = webhook.replace(/'sk_test_mock''/g, "'sk_test_mock'");
fs.writeFileSync("src/app/api/webhooks/stripe/route.ts", webhook, "utf8");
