
const fs = require("fs");
let c = fs.readFileSync("src/lib/excel-export.ts", "utf8");
c = c.replace(
  "sourceFile?: File | Blob;",
  "sourceFile?: File | Blob;\n  imageBase64?: string;"
);
fs.writeFileSync("src/lib/excel-export.ts", c, "utf8");

