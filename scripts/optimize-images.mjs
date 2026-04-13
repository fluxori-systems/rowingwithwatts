/**
 * Image optimization script for public/uploads/
 * - Converts PNG to WebP
 * - Compresses large WebP/JPG files
 * - Resizes images wider than 1600px
 * - Updates MDX references if filenames change
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads');
const SRC_DIR = path.join(ROOT, 'src');
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;
const JPG_QUALITY = 82;

let totalBefore = 0;
let totalAfter = 0;
let conversions = 0;
let renames = [];

function getSize(filepath) {
  return fs.statSync(filepath).size;
}

function findFiles(dir, exts) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, exts));
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

async function optimizeImage(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const sizeBefore = getSize(filepath);
  totalBefore += sizeBefore;

  try {
    // Read into buffer first so sharp releases the file handle before we delete
    const inputBuffer = fs.readFileSync(filepath);
    const img = sharp(inputBuffer);
    const meta = await img.metadata();

    let pipeline = img;

    // Resize if too wide
    if (meta.width > MAX_WIDTH) {
      pipeline = pipeline.resize(MAX_WIDTH, null, {
        withoutEnlargement: true,
        fit: 'inside'
      });
    }

    if (ext === '.png') {
      const newPath = filepath.replace(/\.png$/i, '.webp');
      const webpBuffer = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();

      if (webpBuffer.length < sizeBefore) {
        // WebP is smaller — write it and delete the PNG
        fs.writeFileSync(newPath, webpBuffer);
        fs.unlinkSync(filepath);
        totalAfter += webpBuffer.length;
        conversions++;
        const relOld = filepath.replace(path.join(ROOT, 'public'), '').replace(/\\/g, '/');
        const relNew = newPath.replace(path.join(ROOT, 'public'), '').replace(/\\/g, '/');
        renames.push({ old: relOld, new: relNew });
        console.log(`  PNG→WebP: ${path.basename(filepath)} (${(sizeBefore/1024).toFixed(0)}KB → ${(webpBuffer.length/1024).toFixed(0)}KB)`);
      } else {
        // Keep PNG but optimize it
        const pngBuffer = await sharp(inputBuffer).png({ compressionLevel: 9, palette: true }).toBuffer();
        if (pngBuffer.length < sizeBefore) {
          fs.writeFileSync(filepath, pngBuffer);
          totalAfter += pngBuffer.length;
          console.log(`  PNG opt: ${path.basename(filepath)} (${(sizeBefore/1024).toFixed(0)}KB → ${(pngBuffer.length/1024).toFixed(0)}KB)`);
        } else {
          totalAfter += sizeBefore;
        }
      }
    } else if (ext === '.webp') {
      const webpBuffer = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
      if (webpBuffer.length < sizeBefore) {
        fs.writeFileSync(filepath, webpBuffer);
        totalAfter += webpBuffer.length;
        const saved = sizeBefore - webpBuffer.length;
        if (saved > 10240) {
          console.log(`  WebP: ${path.basename(filepath)} (${(sizeBefore/1024).toFixed(0)}KB → ${(webpBuffer.length/1024).toFixed(0)}KB, saved ${(saved/1024).toFixed(0)}KB)`);
        }
      } else {
        totalAfter += sizeBefore;
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      const jpgBuffer = await pipeline.jpeg({ quality: JPG_QUALITY, progressive: true, mozjpeg: true }).toBuffer();
      if (jpgBuffer.length < sizeBefore) {
        fs.writeFileSync(filepath, jpgBuffer);
        totalAfter += jpgBuffer.length;
        console.log(`  JPG: ${path.basename(filepath)} (${(sizeBefore/1024).toFixed(0)}KB → ${(jpgBuffer.length/1024).toFixed(0)}KB)`);
      } else {
        totalAfter += sizeBefore;
      }
    } else {
      totalAfter += sizeBefore;
    }
  } catch (err) {
    console.error(`  ERROR: ${path.basename(filepath)}: ${err.message}`);
    totalAfter += sizeBefore;
  }
}

function updateMdxReferences(renames) {
  if (renames.length === 0) return;

  const srcFiles = findFiles(SRC_DIR, ['.mdx', '.md', '.astro', '.tsx', '.ts']);
  let updatedFiles = 0;

  for (const srcFile of srcFiles) {
    let content = fs.readFileSync(srcFile, 'utf-8');
    let changed = false;
    for (const { old: oldRef, new: newRef } of renames) {
      if (content.includes(oldRef)) {
        content = content.replaceAll(oldRef, newRef);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(srcFile, content, 'utf-8');
      console.log(`  Updated refs in: ${path.relative(ROOT, srcFile)}`);
      updatedFiles++;
    }
  }

  if (updatedFiles > 0) {
    console.log(`\nUpdated ${updatedFiles} source files with new image paths.`);
  }
}

// Main
console.log('=== Image Optimization ===\n');
console.log(`Settings: max width=${MAX_WIDTH}px, WebP quality=${WEBP_QUALITY}, JPG quality=${JPG_QUALITY}\n`);

const imageFiles = findFiles(UPLOADS_DIR, ['.webp', '.jpg', '.jpeg', '.png']);
console.log(`Found ${imageFiles.length} images to process...\n`);

for (const file of imageFiles) {
  await optimizeImage(file);
}

updateMdxReferences(renames);

const savedBytes = totalBefore - totalAfter;
const savedPct = ((savedBytes / totalBefore) * 100).toFixed(1);

console.log('\n=== Results ===');
console.log(`Total before:  ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
console.log(`Total after:   ${(totalAfter / 1024 / 1024).toFixed(2)} MB`);
console.log(`Saved:         ${(savedBytes / 1024 / 1024).toFixed(2)} MB (${savedPct}%)`);
console.log(`PNG→WebP:      ${conversions} conversions`);
if (renames.length > 0) {
  console.log('\nRenamed files:');
  renames.forEach(({ old, new: n }) => console.log(`  ${old} → ${n}`));
}
