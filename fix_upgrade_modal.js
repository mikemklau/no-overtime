const fs = require("fs");
let c = fs.readFileSync("src/components/UpgradeModal.tsx", "utf8");

const oldBtn = `          <button
            type="button"
            onClick={() => {
              triggerHaptic('success');
              alert('Stripe Pro checkout integration will be connected with your live subscription tier!');`;

const newBtn = `          <button
            type="button"
            onClick={async () => {
              triggerHaptic('success');
              try {
                const { supabase } = await import('@/lib/supabase');
                const { data: { session } } = await supabase.auth.getSession();
                
                const res = await fetch('/api/checkout', {
                  method: 'POST',
                  headers: session?.access_token ? { Authorization: \`Bearer \${session.access_token}\` } : {}
                });
                
                const data = await res.json();
                if (data.url) {
                  window.location.href = data.url;
                } else {
                  alert(data.error || 'Checkout failed');
                }
              } catch(e) {
                console.error(e);
                alert('Could not initiate checkout');
              }
`;

c = c.replace(oldBtn, newBtn);

fs.writeFileSync("src/components/UpgradeModal.tsx", c, "utf8");
