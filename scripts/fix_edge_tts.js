const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'services', 'edgeTtsService.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Line 124 (index 123) - .replace(/\\"/g, '"') -> .replace(/\\"/g, '"')
// Use line-specific replacement with character codes to avoid write_to_file HTML decoding
const lines = content.split('\n');
const line124 = lines[123];

// Build the replacement string using character codes
// '"' = char(39) + char(38) + 'quot;' + char(39)
const replacement = String.fromCharCode(39, 38) + 'quot;' + String.fromCharCode(39);

// Find '"' (single-quote, double-quote, single-quote) in the line
const searchStr = String.fromCharCode(39, 34, 39); // ' " '
const idx = line124.indexOf(searchStr);
if (idx !== -1) {
  lines[123] = line124.substring(0, idx) + replacement + line124.substring(idx + 3);
}

content = lines.join('\n');

// Fix 2: Line 137 - .join('\\u0026apos;'n') -> .join('\\n')
content = content.replace(
  "].join('\\u0026apos;'n')",
  "].join('\\n')"
);

// Fix 3: Line 145 - \\u0026apos;'r\\n' -> \\r\\n'
content = content.replace(
  "'\\u0026apos;'r\\n'",
  "'\\r\\n'"
);

// Fix 4: Line 160 - same as Fix 3
content = content.replace(
  "'\\u0026apos;'r\\n'",
  "'\\r\\n'"
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed edgeTtsService.ts');
