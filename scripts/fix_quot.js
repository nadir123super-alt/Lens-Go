const fs = require('fs');
const path = 'c:/Users/Lenovo/Desktop/MyAIEnglishApp/services/edgeTtsService.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace the quote entity - use hex escape to avoid write_to_file decoding
const ampHex = '\\x26'; // This is & in hex
const oldStr = '.replace(/\\"/g, \'"\')';
const newStr = '.replace(/\\"/g, \'' + eval('"\\x26"') + 'quot;\')';

console.log('Old:', oldStr);
console.log('New:', newStr);

if (content.includes(oldStr)) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync(path, content);
  console.log('Fixed!');
} else {
  console.log('Pattern not found, searching for partial match...');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('replace') && lines[i].includes('\\"')) {
      console.log('Line ' + (i + 1) + ': ' + lines[i]);
    }
  }
}
