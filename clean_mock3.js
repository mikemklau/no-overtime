
const fs = require("fs");
let c = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");

c = c.replace(/\s*\{\/\* Sample receipts for demo testing \*\/\}\s*<div className="mt-6 flex flex-col items-center">[\s\S]*?<\/div>\s*<\/div>/, "");

fs.writeFileSync("src/components/ReceiptScanner.tsx", c, "utf8");

