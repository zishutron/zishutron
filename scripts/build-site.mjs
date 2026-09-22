#!/usr/bin/env node
/**
 * ZISHU TRON Portal — Static Site Builder
 *
 * Fetches products + updates from Firebase, generates:
 *   - /products/<slug>/index.html  (one per published product)
 *   - /updates/<slug>/index.html   (one per published update)
 *   - /sitemap.xml                 (all public URLs)
 *   - /rss.xml                     (recent updates)
 *   - SSR injection into index.html (products + updates sections)
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- Config ----------
const FIREBASE_DB = (process.env.FIREBASE_DB_URL || 'https://zishu-tron-default-rtdb.asia-southeast1.firebasedatabase.app')
  .trim().replace(/\/+$/, '');
const BASE_URL = (process.env.SITE_BASE_URL || 'https://zishutron.zishuai.cloud')
  .trim().replace(/\/+$/, '');

const SITE_NAME = 'ZISHU TRON';
const PRODUCTS_DIR = join(ROOT, 'products');
const UPDATES_DIR = join(ROOT, 'updates');
const PRODUCT_TEMPLATE = join(ROOT, 'product.html');
const UPDATE_TEMPLATE = join(ROOT, 'update.html');
const INDEX_HTML = join(ROOT, 'index.html');

// ---------- Helpers ----------
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const escapeXml = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({
  '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'
}[c]));

const slugify = (s) => String(s || '')
  .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-')
  .replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,90);

const sanitizeUrl = (u) => {
  if(!u) return '';
  u = String(u).trim();
  if(/^(https?:|mailto:|tel:|\/|#)/i.test(u)) return u;
  return 'https://' + u;
};

// ---------- Firebase REST ----------
async function fetchProducts(){
  const url = `${FIREBASE_DB}/products.json?orderBy="published"&equalTo=true`;
  const res = await fetch(url);
  if(!res.ok){
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase products fetch failed: ${res.status} ${res.statusText} ${text}`);
  }
  const data = await res.json() || {};
  return Object.entries(data).map(([id, p]) => ({ id, ...p }));
}

async function fetchUpdates(){
  const url = `${FIREBASE_DB}/updates.json?orderBy="published"&equalTo=true`;
  const res = await fetch(url);
  if(!res.ok){
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase updates fetch failed: ${res.status} ${res.statusText} ${text}`);
  }
  const data = await res.json() || {};
  return Object.entries(data).map(([id, u]) => ({ id, ...u }));
}

// ---------- Template renderer ----------
function renderTemplate(tpl, data){
  let out = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => data[key] ? inner : '');
  out = out.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => data[key] ? '' : inner);
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v === undefined || v === null ? '' : String(v);
  });
  return out;
}

// ---------- Status badge class ----------
function statusClass(s){
  s = (s || '').toLowerCase();
  if(s === 'available') return 'badge-available';
  if(s === 'coming soon' || s === 'soon') return 'badge-soon';
  return 'badge-beta';
}

// ---------- Related items ----------
function renderRelatedProducts(currentId, allProducts, limit = 3){
  return allProducts
    .filter(p => p.id !== currentId)
    .slice(0, limit)
    .map(p => {
      const slug = p.slug || slugify(p.title || p.id);
      const icon = p.icon
        ? `<img src="${escapeHtml(p.icon)}" alt="" loading="lazy">`
        : `<span class="fallback">${escapeHtml((p.title||'P').charAt(0).toUpperCase())}</span>`;
      return `<a class="rel-card" href="/products/${encodeURIComponent(slug)}/">
        <div class="rc-icon">${icon}</div>
        <div>
          <h3>${escapeHtml(p.title || 'Product')}</h3>
          <p>${escapeHtml((p.description || '').slice(0, 100))}</p>
        </div>
      </a>`;
    }).join('');
}

function renderRelatedUpdates(currentId, allUpdates, limit = 3){
  return allUpdates
    .filter(u => u.id !== currentId)
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
    .slice(0, limit)
    .map(u => {
      const slug = u.slug || slugify(u.title || u.id);
      const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) : '';
      return `<a class="rel-card" href="/updates/${encodeURIComponent(slug)}/">
        <h3>${escapeHtml(u.title || 'Update')}</h3>
        <p>${escapeHtml((u.description || '').slice(0, 120))}</p>
        <div class="m">${escapeHtml(date)}</div>
      </a>`;
    }).join('');
}

// ---------- Render one product ----------
async function renderProduct(product, template, allProducts){
  const slug = product.slug || slugify(product.title || product.id);
  const canonical = `${BASE_URL}/products/${slug}/`;
  const url = sanitizeUrl(product.url || '#');
  const isExternal = /^https?:/i.test(url) && !url.includes('zishutron.zishuai.cloud');
  const embedUrl = sanitizeUrl(product.embedUrl || '');
  const hasEmbed = !!(embedUrl && product.embedMode === 'embedded');
  const icon = product.icon || '';
  const banner = product.banner || '';
  const category = product.category || 'Product';
  const status = product.status || 'Available';
  const longDesc = product.description || product.title || '';

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": product.title,
    "description": longDesc,
    "applicationCategory": category,
    "operatingSystem": "Web",
    "url": canonical,
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    "publisher": {
      "@type": "Organization",
      "name": "ZISHU TRON",
      "url": BASE_URL
    },
    "datePublished": new Date(product.createdAt || Date.now()).toISOString(),
    "dateModified": new Date(product.updatedAt || product.createdAt || Date.now()).toISOString()
  };
  if(icon) jsonLd.image = icon;

  const data = {
    TITLE: escapeHtml(product.title || 'Untitled'),
    DESCRIPTION: escapeHtml((product.description || '').slice(0, 200)),
    LONG_DESCRIPTION: escapeHtml(longDesc),
    CATEGORY: escapeHtml(category),
    STATUS: escapeHtml(status),
    STATUS_CLASS: statusClass(status),
    FEATURED: !!product.featured,
    INITIAL: escapeHtml((product.title || 'Z').charAt(0).toUpperCase()),
    ICON: escapeHtml(icon),
    BANNER: escapeHtml(banner),
    URL: escapeHtml(url),
    EXTERNAL: isExternal,
    EMBED_URL: escapeHtml(embedUrl),
    HAS_EMBED: hasEmbed,
    CANONICAL_URL: canonical,
    RELATED_HTML: renderRelatedProducts(product.id, allProducts),
    JSONLD: JSON.stringify(jsonLd)
  };

  return {
    html: renderTemplate(template, data),
    slug, canonical,
    id: product.id,
    title: product.title || 'Untitled',
    description: (product.description || '').slice(0, 200),
    category, status,
    icon, banner,
    url,
    featured: !!product.featured,
    displayOrder: product.displayOrder == null ? 9999 : Number(product.displayOrder),
    createdAt: product.createdAt || Date.now(),
    updatedAt: product.updatedAt || product.createdAt || Date.now()
  };
}

// ---------- Render one update ----------
async function renderUpdate(update, template, allUpdates){
  const slug = update.slug || slugify(update.title || update.id);
  const canonical = `${BASE_URL}/updates/${slug}/`;
  const url = sanitizeUrl(update.url || '');
  const isExternal = /^https?:/i.test(url);
  const image = update.image || '';
  const category = update.category || 'Update';
  const publishedAt = update.createdAt || Date.now();
  const updatedAt = update.updatedAt || publishedAt;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": update.title,
    "description": update.description || '',
    "author": { "@type": "Organization", "name": "ZISHU TRON" },
    "publisher": {
      "@type": "Organization",
      "name": "ZISHU TRON",
      "url": BASE_URL
    },
    "datePublished": new Date(publishedAt).toISOString(),
    "dateModified": new Date(updatedAt).toISOString(),
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonical },
    "url": canonical
  };
  if(image) jsonLd.image = [image];

  // Content: use description as-is (already text), or fall back to title
  const contentHtml = update.content
    ? String(update.content)
    : `<p>${escapeHtml(update.description || '')}</p>`;

  const data = {
    TITLE: escapeHtml(update.title || 'Untitled'),
    DESCRIPTION: escapeHtml(update.description || ''),
    CATEGORY: escapeHtml(category),
    IMAGE: escapeHtml(image),
    URL: escapeHtml(url),
    EXTERNAL: isExternal,
    PUBLISHED_HUMAN: new Date(publishedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),
    UPDATED_HUMAN: updatedAt !== publishedAt ? new Date(updatedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : '',
    CONTENT_HTML: contentHtml,
    CANONICAL_URL: canonical,
    RELATED_HTML: renderRelatedUpdates(update.id, allUpdates),
    JSONLD: JSON.stringify(jsonLd)
  };

  return {
    html: renderTemplate(template, data),
    slug, canonical,
    id: update.id,
    title: update.title || 'Untitled',
    description: update.description || '',
    category,
    image,
    url,
    displayOrder: update.displayOrder == null ? 9999 : Number(update.displayOrder),
    publishedAt,
    updatedAt
  };
}

// ---------- Homepage SSR ----------
function renderHomepageProducts(products){
  return products.slice(0, 12).map(p => {
    const slug = p.slug;
    const url = `/products/${encodeURIComponent(slug)}/`;
    const iconHtml = p.icon
      ? `<img src="${escapeHtml(p.icon)}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.innerHTML='<span class=&quot;pc-initial&quot;>${escapeHtml((p.title||'P').charAt(0).toUpperCase())}</span>';" />`
      : `<span class="pc-initial">${escapeHtml((p.title||'P').charAt(0).toUpperCase())}</span>`;
    const featuredBadge = p.featured ? `<span class="badge badge-featured">Featured</span>` : '';
    const status = p.status ? `<span class="badge ${statusClass(p.status)}">${escapeHtml(p.status)}</span>` : '';
    return `<article class="product-card reveal">
      <div class="pc-top">
        <div class="pc-icon">${iconHtml}</div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">${featuredBadge}${status}</div>
      </div>
      <div class="pc-cat">${escapeHtml(p.category || 'Product')}</div>
      <h3 class="pc-title">${escapeHtml(p.title || 'Untitled')}</h3>
      <p class="pc-desc">${escapeHtml(p.description || '')}</p>
      <div class="pc-foot">
        <a href="${url}" class="pc-link">Learn More
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    </article>`;
  }).join('\n');
}

function renderHomepageUpdates(updates){
  return updates.slice(0, 6).map(u => {
    const slug = u.slug;
    const url = `/updates/${encodeURIComponent(slug)}/`;
    const date = new Date(u.publishedAt).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
    const imgHtml = u.image
      ? `<img src="${escapeHtml(u.image)}" alt="" loading="lazy" />`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--accent-glow),transparent);"></div>`;
    return `<a href="${url}" class="update-card reveal">
      <div class="uc-img">${imgHtml}</div>
      <div class="uc-body">
        ${u.category ? `<span class="uc-cat">${escapeHtml(u.category)}</span>` : ''}
        <h3 class="uc-title">${escapeHtml(u.title)}</h3>
        <p class="uc-desc">${escapeHtml(u.description)}</p>
        <div class="uc-date">${escapeHtml(date)}</div>
      </div>
    </a>`;
  }).join('\n');
}

function renderHomepageEco(products){
  return products.slice(0, 8).map(p => {
    const slug = p.slug;
    const url = `/products/${encodeURIComponent(slug)}/`;
    const iconHtml = p.icon
      ? `<img src="${escapeHtml(p.icon)}" alt="" loading="lazy" />`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>`;
    return `<a href="${url}" class="eco-card reveal">
      <div class="ec-icon">${iconHtml}</div>
      <div>
        <h4>${escapeHtml(p.title)}</h4>
        <p>${escapeHtml((p.description || '').slice(0, 80))}</p>
      </div>
    </a>`;
  }).join('\n');
}

// ---------- Sitemap / RSS ----------
function buildSitemap(products, updates){
  const now = new Date().toISOString();
  const urls = [
    { loc: `${BASE_URL}/`, lastmod: now, prio: '1.0', freq: 'daily' },
    { loc: `${BASE_URL}/developer.html`, lastmod: now, prio: '0.8', freq: 'monthly' },
    { loc: `${BASE_URL}/privacy.html`, lastmod: now, prio: '0.4', freq: 'yearly' },
    { loc: `${BASE_URL}/terms.html`, lastmod: now, prio: '0.4', freq: 'yearly' },
    ...products.map(p => ({ loc: p.canonical, lastmod: new Date(p.updatedAt).toISOString(), prio: '0.9', freq: 'weekly' })),
    ...updates.map(u => ({ loc: u.canonical, lastmod: new Date(u.updatedAt).toISOString(), prio: '0.7', freq: 'weekly' }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.prio}</priority>
  </url>`).join('\n')}
</urlset>`;
}

function buildRss(updates){
  const items = updates.sort((a,b) => b.publishedAt - a.publishedAt).slice(0, 30).map(u => `    <item>
      <title>${escapeXml(u.title)}</title>
      <link>${escapeXml(u.canonical)}</link>
      <guid isPermaLink="true">${escapeXml(u.canonical)}</guid>
      <pubDate>${new Date(u.publishedAt).toUTCString()}</pubDate>
      <description>${escapeXml(u.description)}</description>
      ${u.category ? `<category>${escapeXml(u.category)}</category>` : ''}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)} Updates</title>
    <link>${escapeXml(BASE_URL)}/</link>
    <description>Product and company updates from ZISHU TRON.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(BASE_URL)}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

// ---------- Main ----------
async function main(){
  console.log('[build] Fetching from Firebase…');
  console.log(`[build] Firebase: ${FIREBASE_DB}`);
  console.log(`[build] Base URL: ${BASE_URL}`);

  const [products, updates] = await Promise.all([fetchProducts(), fetchUpdates()]);
  console.log(`[build] ${products.length} product(s), ${updates.length} update(s)`);

  // Sort products by displayOrder then createdAt
  products.sort((a,b) => {
    const ao = a.displayOrder == null ? 9999 : Number(a.displayOrder);
    const bo = b.displayOrder == null ? 9999 : Number(b.displayOrder);
    if(ao !== bo) return ao - bo;
    return (b.createdAt||0) - (a.createdAt||0);
  });
  updates.sort((a,b) => {
    const ao = a.displayOrder == null ? 9999 : Number(a.displayOrder);
    const bo = b.displayOrder == null ? 9999 : Number(b.displayOrder);
    if(ao !== bo) return ao - bo;
    return (b.createdAt||0) - (a.createdAt||0);
  });

  const productTpl = await readFile(PRODUCT_TEMPLATE, 'utf8');
  const updateTpl = await readFile(UPDATE_TEMPLATE, 'utf8');

  // Clean previous dirs
  if(existsSync(PRODUCTS_DIR)) await rm(PRODUCTS_DIR, { recursive: true, force: true });
  if(existsSync(UPDATES_DIR)) await rm(UPDATES_DIR, { recursive: true, force: true });
  await mkdir(PRODUCTS_DIR, { recursive: true });
  await mkdir(UPDATES_DIR, { recursive: true });

  // Render products
  const renderedProducts = [];
  for(const p of products){
    const out = await renderProduct(p, productTpl, products);
    const dir = join(PRODUCTS_DIR, out.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), out.html, 'utf8');
    renderedProducts.push(out);
    console.log(`  ✓ /products/${out.slug}/`);
  }

  // Render updates
  const renderedUpdates = [];
  for(const u of updates){
    const out = await renderUpdate(u, updateTpl, updates);
    const dir = join(UPDATES_DIR, out.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), out.html, 'utf8');
    renderedUpdates.push(out);
    console.log(`  ✓ /updates/${out.slug}/`);
  }

  // Sitemap + RSS
  await writeFile(join(ROOT, 'sitemap.xml'), buildSitemap(renderedProducts, renderedUpdates), 'utf8');
  await writeFile(join(ROOT, 'rss.xml'), buildRss(renderedUpdates), 'utf8');

  // Homepage SSR injection
  console.log('[build] Injecting SSR into index.html…');
  let homeHtml = await readFile(INDEX_HTML, 'utf8');

  // Products grid
  const productsHtml = renderHomepageProducts(renderedProducts);
  if(homeHtml.includes('<!-- PRODUCTS_START -->')){
    homeHtml = homeHtml.replace(
      /<!-- PRODUCTS_START -->[\s\S]*?<!-- PRODUCTS_END -->/,
      `<!-- PRODUCTS_START -->\n${productsHtml}\n<!-- PRODUCTS_END -->`
    );
    console.log(`[build] Injected ${renderedProducts.length} products`);
  } else {
    console.warn('[build] WARNING: PRODUCTS_START marker not found in index.html');
  }

  // Updates grid
  const updatesHtml = renderHomepageUpdates(renderedUpdates);
  if(homeHtml.includes('<!-- UPDATES_START -->')){
    homeHtml = homeHtml.replace(
      /<!-- UPDATES_START -->[\s\S]*?<!-- UPDATES_END -->/,
      `<!-- UPDATES_START -->\n${updatesHtml}\n<!-- UPDATES_END -->`
    );
    console.log(`[build] Injected ${renderedUpdates.length} updates`);
  } else {
    console.warn('[build] WARNING: UPDATES_START marker not found in index.html');
  }

  // Eco grid
  const ecoHtml = renderHomepageEco(renderedProducts);
  if(homeHtml.includes('<!-- ECO_START -->')){
    homeHtml = homeHtml.replace(
      /<!-- ECO_START -->[\s\S]*?<!-- ECO_END -->/,
      `<!-- ECO_START -->\n${ecoHtml}\n<!-- ECO_END -->`
    );
    console.log(`[build] Injected ecosystem`);
  } else {
    console.warn('[build] WARNING: ECO_START marker not found in index.html');
  }

  await writeFile(INDEX_HTML, homeHtml, 'utf8');

  console.log(`[build] Done. ${renderedProducts.length} product pages, ${renderedUpdates.length} update pages.`);
}

main().catch((e) => {
  console.error('[build] FAILED:', e);
  process.exit(1);
});
