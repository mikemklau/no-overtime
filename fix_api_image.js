
const fs = require("fs");
let c = fs.readFileSync("src/app/api/process-receipt/route.ts", "utf8");
c = c.replace(
  "if (!imageFile) {",
  "if (!imageFile || imageFile.size === 0) {"
);
fs.writeFileSync("src/app/api/process-receipt/route.ts", c, "utf8");

let scanner = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");
scanner = scanner.replace(
  "const image = imageFile ?? new Blob([''], { type: 'image/jpeg' });",
  "if (!imageFile || imageFile.size === 0) { alert('Cannot enhance restored draft. Please upload the image again.'); setIsProcessing(false); return; }\n        const image = imageFile;"
);
fs.writeFileSync("src/components/ReceiptScanner.tsx", scanner, "utf8");

