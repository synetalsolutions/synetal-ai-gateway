const { execSync } = require('child_process');

// Get last 500 lines of logs, extract Headroom lines
const raw = execSync('pm2 logs multi-model-proxy --lines 500 --nostream 2>&1', { encoding: 'utf8', maxBuffer: 10*1024*1024 });
const lines = raw.split('\n').filter(l => l.includes('Headroom:'));

let totalIn = 0, totalOut = 0, totalSaved = 0, count = 0;
let buckets = { noop: 0, s725: 0, s5351: 0, other: 0 };

for (const line of lines) {
  const m = line.match(/Headroom:\s*(\d+)\s*\u2192\s*(\d+)\s*tokens\s*\(saved\s*(\d+)/);
  if (!m) continue;
  const before = +m[1], after = +m[2], saved = +m[3];
  totalIn += before;
  totalOut += after;
  totalSaved += saved;
  count++;
  if (saved === 0) buckets.noop++;
  else if (saved === 725) buckets.s725++;
  else if (saved === 5351) buckets.s5351++;
  else buckets.other++;
}

if (count === 0) {
  console.log('No Headroom data found');
  process.exit(0);
}

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  TOKEN SAVINGS REPORT (last ' + count + ' requests)');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('');
console.log('  Total tokens IN:       ' + (totalIn / 1000000).toFixed(2) + 'M');
console.log('  Total tokens AFTER:    ' + (totalOut / 1000000).toFixed(2) + 'M');
console.log('  Total tokens SAVED:    ' + (totalSaved / 1000).toFixed(1) + 'K');
console.log('');
console.log('  Avg saved per request: ' + Math.round(totalSaved / count) + ' tokens');
console.log('  Savings rate:          ' + ((totalSaved / totalIn) * 100).toFixed(2) + '%');
console.log('');
console.log('\u2500\u2500\u2500 Breakdown \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('  No savings (noop):     ' + buckets.noop + ' req (' + Math.round(buckets.noop / count * 100) + '%)');
console.log('  725 tokens saved:      ' + buckets.s725 + ' req (' + Math.round(buckets.s725 / count * 100) + '%)');
console.log('  5,351 tokens saved:    ' + buckets.s5351 + ' req (' + Math.round(buckets.s5351 / count * 100) + '%)');
console.log('  Other:                 ' + buckets.other + ' req');
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2550');

// Cost estimate (rough - GLM/DeepSeek ~$0.50/MTok input, Kimi ~$1.10/MTok)
const costPerMTok = 1.00; // blended estimate
const costSaved = (totalSaved / 1000000) * costPerMTok;
console.log('');
console.log('  Est. cost saved:       $' + costSaved.toFixed(4) + ' (at ~$1/MTok)');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
