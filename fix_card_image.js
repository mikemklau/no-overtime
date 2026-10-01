
const fs = require("fs");
let c = fs.readFileSync("src/components/ReceiptCard.tsx", "utf8");

c = c.replace(
  `  useEffect(() => {
    if (r.sourceFile && r.sourceFile instanceof Blob) {
      const url = URL.createObjectURL(r.sourceFile);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setImageUrl(null);
    }
  }, [r.sourceFile]);`,
  `  useEffect(() => {
    if (r.sourceFile && r.sourceFile instanceof Blob) {
      const url = URL.createObjectURL(r.sourceFile);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (r.imageBase64) {
      setImageUrl(r.imageBase64);
    } else {
      setImageUrl(null);
    }
  }, [r.sourceFile, r.imageBase64]);`
);

fs.writeFileSync("src/components/ReceiptCard.tsx", c, "utf8");

