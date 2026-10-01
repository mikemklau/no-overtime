const fs = require("fs");
let c = fs.readFileSync("src/components/ReceiptCard.tsx", "utf8");

const newGetConfidenceBadge = `function getConfidenceBadge(
  confidence: number,
  userVerified: boolean,
  hasMathWarning: boolean,
  essentialsConfidence?: number
) {
  if (userVerified) {
    return {
      text: '✓ User Verified',
      score: 100,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }

  const score = essentialsConfidence ?? confidence;

  if (score >= 90) {
    return {
      text: '✓ HMRC Ready',
      score,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }
  if (score >= 70) {
    return {
      text: hasMathWarning ? '⚠️ Check Totals' : '⚠️ Review Details',
      score,
      style:
        'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    };
  }
  return {
    text: '❌ Needs Attention',
    score,
    style:
      'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
  };
}`;

const oldGetConfidenceBadgeRegex = /function getConfidenceBadge\([\s\S]*?return \{\s*text: '.*? Needs Attention'[\s\S]*?\};\s*\}/;
c = c.replace(oldGetConfidenceBadgeRegex, newGetConfidenceBadge);

c = c.replace(/const badge = getConfidenceBadge\(r\.confidence, userVerified, !!mathWarning, r\.essentialsConfidence, activeMode\);/, `const badge = getConfidenceBadge(r.confidence, userVerified, !!mathWarning, r.essentialsConfidence);`);

const subTextJsxRegex = /\{badge\.subText && \([\s\S]*?\{badge\.subText\}\s*<\/span>\s*\)\}/;
c = c.replace(subTextJsxRegex, '');

fs.writeFileSync("src/components/ReceiptCard.tsx", c, "utf8");
