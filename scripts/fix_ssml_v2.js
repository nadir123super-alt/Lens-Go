/**
 * Fix SSML buildSsml() function in edgeTtsService.ts
 * 
 * Problem: The current SSML uses mstts:express-as style="cheerful" which
 * is not supported by en-US-AnaNeural voice, causing WebSocket close code 1007.
 * 
 * Fix: Match Python edge-tts v7.2.8 mkssml() format exactly:
 * - Remove mstts:express-as wrapper
 * - Remove xmlns:mstts from speak element
 * - Use +0Hz pitch (matching Python default)
 * - Add volume='+0%' (matching Python default)
 * 
 * NOTE: This script avoids HTML entities in source code by using
 * String.fromCharCode to build them at runtime.
 */
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "services", "edgeTtsService.ts");
let content = fs.readFileSync(filePath, "utf8");

const AMP = String.fromCharCode(38); // &
const N = String.fromCharCode(10);   // newline

// Find the old buildSsml function
const oldStart = "function buildSsml(text: string): string {";
const idx = content.indexOf(oldStart);
if (idx < 0) {
  console.log("ERROR: buildSsml not found");
  process.exit(1);
}

// Find end of function (next function declaration or end of file)
let endIdx = content.indexOf(N + "function", idx + 1);
if (endIdx < 0) endIdx = content.length;

const oldFunc = content.substring(idx, endIdx);
console.log("Old function found, length:", oldFunc.length);
console.log("Old function first line:", oldFunc.split(N)[0]);

// Build new function matching Python edge-tts v7.2.8 mkssml()
// Using String.fromCharCode for & to avoid write_to_file HTML entity decoding
const newFunc = 
  "function buildSsml(text: string): string {" + N +
  "  const escaped = text" + N +
  "    .replace(/" + AMP + "/g, '" + AMP + AMP + "mp;')" + N +
  "    .replace(/</g, '" + AMP + "lt;')" + N +
  "    .replace(/>/g, '" + AMP + "gt;')" + N +
  '    .replace(/\\"/g, "' + AMP + 'quot;")' + N +
  "    .replace(/'/g, '" + AMP + "apos;');" + N +
  N +
  "  // 完全匹配 Python edge-tts v7.2.8 的 mkssml() 格式" + N +
  "  // 使用 +0Hz pitch、+0% volume、无 mstts:express-as" + N +
  "  return (" + N +
  "    '<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"en-US\">'" + N +
  "    '<voice name=\"en-US-AnaNeural\">'" + N +
  "    '<prosody pitch=\"+0Hz\" rate=\"+0%\" volume=\"+0%\">'" + N +
  "    '        ' + escaped," + N +
  "    '</prosody>'" + N +
  "    '</voice>'" + N +
  "    '</speak>'" + N +
  "  ].join('\\\\n');" + N +
  "}" + N;

const newContent = content.substring(0, idx) + newFunc + content.substring(endIdx);
fs.writeFileSync(filePath, newContent, "utf8");
console.log("SUCCESS: File written successfully");
console.log("New function length:", newFunc.length);

// Verify
const verify = fs.readFileSync(filePath, "utf8");
const verifyIdx = verify.indexOf("function buildSsml");
const verifyEnd = verify.indexOf(N + "function", verifyIdx + 1);
if (verifyEnd < 0) {
  // Just read to end
  const verifyFunc = verify.substring(verifyIdx);
  console.log("Verification - new function starts with:", verifyFunc.substring(0, 60));
  console.log("Has mstts:express-as:", verifyFunc.indexOf("mstts:express-as") >= 0);
  console.log("Has xmlns:mstts:", verifyFunc.indexOf("xmlns:mstts") >= 0);
  console.log("Has +0Hz:", verifyFunc.indexOf("+0Hz") >= 0);
  console.log("Has volume:", verifyFunc.indexOf("volume") >= 0);
} else {
  const verifyFunc = verify.substring(verifyIdx, verifyEnd);
  console.log("Verification - new function starts with:", verifyFunc.substring(0, 60));
  console.log("Has mstts:express-as:", verifyFunc.indexOf("mstts:express-as") >= 0);
  console.log("Has xmlns:mstts:", verifyFunc.indexOf("xmlns:mstts") >= 0);
  console.log("Has +0Hz:", verifyFunc.indexOf("+0Hz") >= 0);
  console.log("Has volume:", verifyFunc.indexOf("volume") >= 0);
}
