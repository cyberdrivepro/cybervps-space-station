const fs = require('fs');
const html = fs.readFileSync('apps/dashboard/index.html', 'utf8');
const lines = html.split('\n');
let depth = 0;
lines.forEach((line, i) => {
  const opens = (line.match(/<div[\s>]/gi) || []).length;
  const closes = (line.match(/<\/div>/gi) || []).length;
  depth += opens - closes;
  if (line.includes('id="view-')) {
    console.log(`Line ${i + 1}: depth=${depth} | ${line.trim().slice(0, 45)}`);
  }
});
console.log('Final depth at end:', depth);
