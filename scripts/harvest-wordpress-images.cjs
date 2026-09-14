const fs = require('fs');
const path = require('path');

const clientPath = path.resolve(__dirname, '../../client-dashboard/src/data/wordpress-event-images.json');
const serverPath = path.resolve(__dirname, '../data/wordpress-event-images.json');

const WP_URL = process.env.WORDPRESS_URL || 'https://visitexpo.in';
const WP_KEY = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';

async function fetchOgImage(slug, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${WP_URL}/event/${slug}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    if (!res.ok) {
      clearTimeout(timeout);
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let foundUrl = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const ogMatch = buffer.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                      buffer.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
      if (ogMatch) {
        foundUrl = ogMatch[1];
        controller.abort();
        break;
      }

      if (buffer.includes('</head>') || buffer.length > 28000) {
        controller.abort();
        break;
      }
    }

    clearTimeout(timeout);
    if (foundUrl && !foundUrl.includes('cropped-Untitled')) {
      return foundUrl.replace(/^http:/, 'https:');
    }
  } catch (err) {
    clearTimeout(timeout);
  }

  // Fallback to oEmbed if page stream did not return og:image
  try {
    const oembedUrl = `${WP_URL}/wp-json/oembed/1.0/embed?url=${encodeURIComponent(`${WP_URL}/event/${slug}/`)}`;
    const oRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (oRes.ok) {
      const oData = await oRes.json();
      if (oData.thumbnail_url && !oData.thumbnail_url.includes('cropped-Untitled')) {
        return oData.thumbnail_url.replace(/^http:/, 'https:');
      }
    }
  } catch (_) {}

  return null;
}

async function harvest() {
  console.log('=== VISITEXPO COMPREHENSIVE IMAGE HARVESTER ===');
  console.log(`Target client file: ${clientPath}`);
  console.log(`Target server file: ${serverPath}`);

  let imageMap = {};
  if (fs.existsSync(clientPath)) {
    try {
      imageMap = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
    } catch {}
  } else if (fs.existsSync(serverPath)) {
    try {
      imageMap = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
    } catch {}
  }

  console.log(`Loaded ${Object.keys(imageMap).length} initial image mappings.`);

  console.log('Fetching all WordPress events from inspect-event-meta...');
  let docs = [];
  try {
    const metaRes = await fetch(`${WP_URL}/wp-json/visitexpo/v1/inspect-event-meta`, {
      headers: { 'X-VisitExpo-Key': WP_KEY }
    });
    if (metaRes.ok) {
      const data = await metaRes.json();
      docs = data.data?.docs || [];
    }
  } catch (err) {
    console.error('Failed to fetch inspect-event-meta:', err.message);
    return;
  }

  console.log(`Total events in WordPress inspect-event-meta: ${docs.length}`);

  // Determine missing events
  const missing = docs.filter(d => {
    if (!d.slug) return false;
    const s = d.slug.toLowerCase().trim();
    const id = String(d.id);
    const titleSlug = (d.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return !imageMap[s] && !imageMap[id] && (!titleSlug || !imageMap[titleSlug]);
  });

  console.log(`Events requiring real WordPress images: ${missing.length}`);
  if (missing.length === 0) {
    console.log('All events already mapped!');
    return;
  }

  const BATCH_SIZE = 8;
  let recoveredCount = 0;
  let processedCount = 0;
  let failedCount = 0;

  const startTime = Date.now();

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    const chunkResults = await Promise.all(chunk.map(async (doc) => {
      const img = await fetchOgImage(doc.slug);
      return { doc, img };
    }));

    let chunkRecovered = 0;
    for (const { doc, img } of chunkResults) {
      processedCount++;
      if (img) {
        chunkRecovered++;
        recoveredCount++;
        const s = doc.slug.toLowerCase().trim();
        const id = String(doc.id);
        const titleSlug = (doc.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        imageMap[s] = img;
        imageMap[id] = img;
        if (titleSlug) imageMap[titleSlug] = img;
      } else {
        failedCount++;
      }
    }

    // Save after every chunk so progress is immediately live
    if (chunkRecovered > 0) {
      try {
        fs.writeFileSync(clientPath, JSON.stringify(imageMap, null, 2), 'utf8');
      } catch (err) {
        console.warn('Could not write clientPath:', err.message);
      }
      try {
        fs.writeFileSync(serverPath, JSON.stringify(imageMap, null, 2), 'utf8');
      } catch (err) {
        console.warn('Could not write serverPath:', err.message);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = (processedCount / (elapsed || 1)).toFixed(1);
    console.log(`[${processedCount}/${missing.length}] (${((processedCount/missing.length)*100).toFixed(1)}%) ` +
                `Recovered: ${recoveredCount} | No image on WP: ${failedCount} | Rate: ${rate} ev/s | Elapsed: ${elapsed}s`);
  }

  console.log('\n=== HARVESTING COMPLETED ===');
  console.log(`Total processed: ${processedCount}`);
  console.log(`Total successfully recovered real WordPress images: ${recoveredCount}`);
  console.log(`Total image keys in dictionary: ${Object.keys(imageMap).length}`);
}

harvest().catch(console.error);
