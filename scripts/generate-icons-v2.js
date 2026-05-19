/**
 * Generate app icons - v2
 * Reads SVG paths directly from AppLogo.tsx to ensure 100% consistency.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images');

// Read the AppLogo.tsx file and extract the SVG path data
const appLogoSrc = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'AppLogo.tsx'),
  'utf-8'
);

// Extract the two path d attributes
const pathRegex = /d="([^"]+)"/g;
const paths = [];
let match;
while ((match = pathRegex.exec(appLogoSrc)) !== null) {
  paths.push(match[1]);
}

console.log(`Found ${paths.length} SVG paths in AppLogo.tsx`);

// Build the icon SVG: logo on top, "Lens Go" text below
// The original AppLogo has viewBox="0 0 800 800"
// We want the icon to be 1024x1024 with white rounded rect background
// Logo positioned in upper portion, text below

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="roundedSquare">
      <rect width="1024" height="1024" rx="225" ry="225"/>
    </clipPath>
  </defs>
  <!-- White rounded background -->
  <rect width="1024" height="1024" rx="225" ry="225" fill="#FFFFFF"/>
  <!-- Logo group: centered horizontally, positioned in upper portion -->
  <!-- Original viewBox 800x800, we scale to fit nicely -->
  <g transform="translate(512, 369) scale(0.95)">
    <!-- Center the 800x800 viewBox -->
    <g transform="translate(-400, -400)">
      <path fill="#FFB5C2" d="${paths[0]}"/>
      <path fill="#FFB5C2" d="${paths[1]}"/>
    </g>
  </g>
  <!-- "Lens Go" text below the logo -->
  <text x="512" y="770" font-family="Arial, Helvetica, sans-serif" font-size="110" font-weight="bold" fill="#FF6B6B" text-anchor="middle">Lens Go</text>
</svg>`;

async function main() {
  console.log('Generating icons from AppLogo.tsx paths...\n');
  
  // Generate main icon
  await sharp(Buffer.from(iconSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('Generated: icon.png');
  
  // Generate Android foreground
  await sharp(Buffer.from(iconSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-foreground.png'));
  console.log('Generated: android-icon-foreground.png');
  
  // Android background
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" fill="#FFB5C2"/>
  </svg>`;
  await sharp(Buffer.from(bgSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-background.png'));
  console.log('Generated: android-icon-background.png');
  
  // Splash icon (logo only, no text)
  const splashSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512, 512) scale(1.1)">
    <g transform="translate(-400, -400)">
      <path fill="#FFB5C2" d="${paths[0]}"/>
      <path fill="#FFB5C2" d="${paths[1]}"/>
    </g>
  </g>
</svg>`;
  await sharp(Buffer.from(splashSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS_DIR, 'splash-icon.png'));
  console.log('Generated: splash-icon.png');
  
  // Favicon
  await sharp(Buffer.from(iconSvg))
    .resize(48, 48)
    .png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('Generated: favicon.png');
  
  // Also save the SVG template for visual inspection
  fs.writeFileSync(path.join(__dirname, 'icon-preview.svg'), iconSvg);
  console.log('Generated: scripts/icon-preview.svg (for visual inspection)');
  
  console.log('\nAll icons generated successfully!');
  console.log('Open scripts/icon-preview.svg in a browser to preview the icon.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
