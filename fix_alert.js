
const fs = require("fs");
let scanner = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");
scanner = scanner.replace(
  "const errData = await response.json().catch(() => ({}));\n          throw new Error(errData.message || `API error ${response.status}`);",
  "const errData = await response.json().catch(() => ({}));\n          alert(errData.message || `API error ${response.status}`);\n          throw new Error(\"API Error Handled\");"
);
fs.writeFileSync("src/components/ReceiptScanner.tsx", scanner, "utf8");

