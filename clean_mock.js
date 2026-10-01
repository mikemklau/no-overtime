
const fs = require("fs");
let c = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");

// Remove SAMPLE_RECEIPTS array
c = c.replace(/\/\/ ---[\s\S]*?const SAMPLE_RECEIPTS = \[[\s\S]*?\];\s*/, "");

// Remove the UI buttons for sample receipts
c = c.replace(/<span className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">\s*Or try instant UK test receipts:\s*<\/span>\s*<div className="flex flex-wrap gap-2 justify-center">\s*\{SAMPLE_RECEIPTS\.map\(\(sample, idx\) => \([\s\S]*?<\/button>\s*\)\)\}\s*<\/div>/, "");

fs.writeFileSync("src/components/ReceiptScanner.tsx", c, "utf8");

