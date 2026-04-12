/**
 * Migration script: transforms RWW v1 MDX frontmatter to Astro Rocket schema
 * Run once with: node scripts/migrate-content.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const OLD_POSTS = 'C:/Projects/rowingwithwatts/src/content/posts';
const OLD_PAGES = 'C:/Projects/rowingwithwatts/src/content/pages';
const NEW_POSTS = path.join(root, 'src/content/blog/en');
const NEW_PAGES = path.join(root, 'src/content/pages');

fs.mkdirSync(NEW_POSTS, { recursive: true });
fs.mkdirSync(NEW_PAGES, { recursive: true });

/** Parse YAML-ish frontmatter (simple, handles our specific fields) */
function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // array field
    const arrMatch = line.match(/^(\w+):\s*$/);
    if (arrMatch) {
      const key = arrMatch[1];
      const items = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        items.push(lines[i].replace(/^\s+-\s+/, '').trim());
        i++;
      }
      obj[key] = items;
      continue;
    }
    // scalar field
    const scalarMatch = line.match(/^(\w+):\s*(.*)$/);
    if (scalarMatch) {
      const key = scalarMatch[1];
      let val = scalarMatch[2].trim();
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      obj[key] = val;
    }
    i++;
  }
  return obj;
}

/** Split file into frontmatter + body */
function splitFile(content) {
  // Normalise line endings (handle Windows CRLF)
  const normalised = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: normalised };
  return { fm: parseFrontmatter(match[1]), body: match[2] };
}

/** Truncate string to maxLen at word boundary */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

/** Render new YAML frontmatter */
function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${item}`);
      }
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      // Quote strings that contain special chars or colons
      const needsQuotes = typeof v === 'string' && (v.includes(':') || v.includes('"') || v.includes("'") || v.includes('%') || v.includes('#'));
      if (needsQuotes) {
        lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ─── Migrate Posts ────────────────────────────────────────────────────────────
const postFiles = fs.readdirSync(OLD_POSTS).filter(f => f.endsWith('.mdx'));
let postCount = 0;

for (const filename of postFiles) {
  const content = fs.readFileSync(path.join(OLD_POSTS, filename), 'utf8');
  const { fm, body } = splitFile(content);

  const tags = [
    ...(Array.isArray(fm.categories) ? fm.categories : []),
    ...(Array.isArray(fm.tags) ? fm.tags : []),
  ].filter(t => t && t.toLowerCase() !== 'uncategorized');

  const description = truncate(fm.excerpt || '', 200) || '';
  const isDraft = !fm.status || fm.status === 'draft' || fm.status === 'private';

  const newFm = {
    title: fm.title || '',
    description,
    publishedAt: fm.date || new Date().toISOString().slice(0, 10),
    author: 'Tarquin Stapa',
    ...(fm.featuredImage ? { image: fm.featuredImage } : {}),
    ...(fm.imageAlt ? { imageAlt: fm.imageAlt } : {}),
    tags,
    draft: isDraft,
    featured: false,
    locale: 'en',
    ...(fm.seoTitle && !fm.seoTitle.includes('%') ? { seoTitle: fm.seoTitle } : {}),
    ...(fm.seoDescription ? { seoDescription: fm.seoDescription } : {}),
  };

  const newContent = buildFrontmatter(newFm) + '\n' + body;
  fs.writeFileSync(path.join(NEW_POSTS, filename), newContent);
  postCount++;
  console.log(`  ✓ post: ${filename}`);
}

// ─── Migrate Pages ────────────────────────────────────────────────────────────
const pageFiles = fs.readdirSync(OLD_PAGES).filter(f => f.endsWith('.mdx'));
let pageCount = 0;

for (const filename of pageFiles) {
  const content = fs.readFileSync(path.join(OLD_PAGES, filename), 'utf8');
  const { fm, body } = splitFile(content);

  const newFm = {
    title: fm.title || '',
    description: fm.excerpt || fm.seoDescription || '',
    ...(fm.date ? { updatedAt: fm.date } : {}),
    locale: 'en',
  };

  const newContent = buildFrontmatter(newFm) + '\n' + body;
  fs.writeFileSync(path.join(NEW_PAGES, filename), newContent);
  pageCount++;
  console.log(`  ✓ page: ${filename}`);
}

console.log(`\nMigrated ${postCount} posts and ${pageCount} pages.`);
