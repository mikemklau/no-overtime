
const fs = require("fs");

let checkout = fs.readFileSync("src/app/api/checkout/route.ts", "utf8");
checkout = checkout.replace("2024-06-20", "2024-09-30.acacia"); 
checkout = checkout.replace(/payment_method_types:\s*\[\'card\'\],/, "");
fs.writeFileSync("src/app/api/checkout/route.ts", checkout, "utf8");

let webhook = fs.readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
webhook = webhook.replace("2024-06-20", "2024-09-30.acacia");
fs.writeFileSync("src/app/api/webhooks/stripe/route.ts", webhook, "utf8");

let modal = fs.readFileSync("src/components/UpgradeModal.tsx", "utf8");
modal = modal.replace(
  "const { supabase } = await import('@/lib/supabase');\n                const { data: { session } } = await supabase.auth.getSession();",
  "const { createClient } = await import('@/lib/supabase/client');\n                const supabase = createClient();\n                const { data: { session } } = await supabase.auth.getSession();"
);
fs.writeFileSync("src/components/UpgradeModal.tsx", modal, "utf8");

