const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'dist');
const destDir = path.join(__dirname, 'dist', 'src');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const items = fs.readdirSync(srcDir);
for (const item of items) {
  if (item === 'src') continue;
  const srcPath = path.join(srcDir, item);
  const destPath = path.join(destDir, item);
  
  try {
    if (fs.statSync(srcPath).isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  } catch (err) {
    console.error(`Error copying ${item}:`, err);
  }
}
console.log('Successfully duplicated dist contents to dist/src for deployment compatibility.');
