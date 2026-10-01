
const fs = require("fs");
let c = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");

const startMock = c.indexOf("const SAMPLE_RECEIPTS = [");
const endMock = c.indexOf("];", startMock) + 2;
c = c.substring(0, startMock) + c.substring(endMock);

const uiStartStr = `<span className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">`;
const uiStart = c.indexOf(uiStartStr);
const uiEndStr = `</div>`;
// Find the closing div of the SAMPLE_RECEIPTS map container
// Actually, let us just replace it via simpler regex
c = c.replace(/<span className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">[\s\S]*?\{SAMPLE_RECEIPTS\.map[\s\S]*?<\/div>/, "");

// also remove the comment header above SAMPLE_RECEIPTS
c = c.replace(/\/\/ [^\n]*\n\/\/ Sample UK receipts[^\n]*\n\/\/ [^\n]*\n/, "");

fs.writeFileSync("src/components/ReceiptScanner.tsx", c, "utf8");

