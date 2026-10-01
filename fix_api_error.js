
const fs = require("fs");
let c = fs.readFileSync("src/app/api/process-receipt/route.ts", "utf8");

c = c.replace(
  "return NextResponse.json(\r\n      { error: 'INTERNAL_ERROR', message: 'Failed to process receipt.' },",
  "return NextResponse.json(\r\n      { error: 'INTERNAL_ERROR', message: 'Failed to process receipt. Details: ' + (error instanceof Error ? error.message : String(error)) },"
);
c = c.replace(
  "return NextResponse.json(\n      { error: 'INTERNAL_ERROR', message: 'Failed to process receipt.' },",
  "return NextResponse.json(\n      { error: 'INTERNAL_ERROR', message: 'Failed to process receipt. Details: ' + (error instanceof Error ? error.message : String(error)) },"
);

fs.writeFileSync("src/app/api/process-receipt/route.ts", c, "utf8");

let scanner = fs.readFileSync("src/components/ReceiptScanner.tsx", "utf8");
scanner = scanner.replace(
  "throw new Error(`API error ${response.status}`);",
  "const errData = await response.json().catch(() => ({}));\n          throw new Error(errData.message || `API error ${response.status}`);"
);
fs.writeFileSync("src/components/ReceiptScanner.tsx", scanner, "utf8");

