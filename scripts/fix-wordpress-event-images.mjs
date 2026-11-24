import fs from 'fs';
import os from 'os';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}
import {
  normalizeEventImageUrl,
  isGenuineEventImageUrl,
  isMismatchedPoolImage,
  fetchLiveWpEventImageWithStatus
} from '../utils/wpEventImageHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SERVER_JSON_PATH = path.resolve(__dirname, '../data/wordpress-event-images.json');
const CLIENT_JSON_PATH = path.resolve(__dirname, '../../client-dashboard/src/data/wordpress-event-images.json');
const DISK_CACHE_PATH = path.join(os.tmpdir(), 'visitexpo-all-directory-cache.json');

const toTitleSlug = (title) =>
  String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set in server/.env');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const eventsCol = mongoose.connection.collection('events');

  const allEvents = await eventsCol
    .find({}, { projection: { _id: 1, slug: 1, title: 1, banner: 1, wpPostId: 1 } })
    .toArray();

  console.log(`[FixImages] Loaded ${allEvents.length} events from MongoDB.`);

  // Build wpPostId -> event metadata map so numeric JSON keys are accurately validated
  const wpIdToEvent = new Map();
  for (const ev of allEvents) {
    if (ev.wpPostId) wpIdToEvent.set(String(ev.wpPostId).trim(), ev);
  }

  // 1. Load, merge, and purge poisoned entries from both JSON maps
  const mergedMap = {};
  for (const p of [SERVER_JSON_PATH, CLIENT_JSON_PATH]) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
      Object.assign(mergedMap, parsed);
    } catch {}
  }

  let removedPoisoned = 0;
  const cleanedMap = {};
  for (const [k, rawUrl] of Object.entries(mergedMap)) {
    const cleanUrl = normalizeEventImageUrl(rawUrl);
    const linkedEv = wpIdToEvent.get(String(k).trim());
    const slugHint = linkedEv ? linkedEv.slug : k;
    const titleHint = linkedEv ? linkedEv.title : '';
    if (isGenuineEventImageUrl(cleanUrl, slugHint, titleHint)) {
      cleanedMap[k] = cleanUrl;
    } else {
      removedPoisoned++;
    }
  }
  console.log(`[FixImages] Cleaned JSON image map: kept ${Object.keys(cleanedMap).length} genuine entries, removed ${removedPoisoned} poisoned/broken entries.`);

  // 2. Find all events needing a real banner in MongoDB
  const needsRepair = [];
  const quickBulkOps = [];
  let fixedFromCleanJson = 0;

  for (const ev of allEvents) {
    const slug = String(ev.slug || '').toLowerCase().trim();
    const wpId = ev.wpPostId ? String(ev.wpPostId).trim() : '';
    const title = String(ev.title || '').trim();
    const titleSlug = toTitleSlug(title);
    const currentBanner = normalizeEventImageUrl(ev.banner || '');

    if (currentBanner && isGenuineEventImageUrl(currentBanner, slug, title)) {
      // Already genuine in DB — make sure JSON map also has it!
      if (slug && !cleanedMap[slug]) cleanedMap[slug] = currentBanner;
      if (wpId && !cleanedMap[wpId]) cleanedMap[wpId] = currentBanner;
      continue;
    }

    // Check cleaned JSON map first (0 HTTP calls)
    const jsonHit =
      (slug && cleanedMap[slug]) ||
      (wpId && cleanedMap[wpId]) ||
      (titleSlug && cleanedMap[titleSlug]) ||
      '';

    if (jsonHit && isGenuineEventImageUrl(jsonHit, slug, title)) {
      fixedFromCleanJson++;
      quickBulkOps.push({
        updateOne: {
          filter: { _id: ev._id },
          update: { $set: { banner: jsonHit } }
        }
      });
      continue;
    }

    needsRepair.push({
      _id: ev._id,
      slug,
      wpId,
      title,
      titleSlug,
      hadWrongPoolBanner: Boolean(currentBanner) && isMismatchedPoolImage(currentBanner, slug, title)
    });
  }

  if (quickBulkOps.length > 0) {
    await eventsCol.bulkWrite(quickBulkOps, { ordered: false });
  }
  console.log(`[FixImages] Instantly repaired ${fixedFromCleanJson} MongoDB events from existing genuine JSON mappings.`);
  console.log(`[FixImages] Fetching live WordPress featured images for remaining ${needsRepair.length} events...`);

  // 3. Batch-fetch genuine WordPress images with gentle rate-limit-safe pacing
  const CONCURRENCY = 2;
  let recoveredLive = 0;
  let clearedPoolWithoutWpImg = 0;
  let noWpImg = 0;
  let stoppedByRateLimit = false;
  const startTs = Date.now();

  for (let i = 0; i < needsRepair.length; i += CONCURRENCY) {
    const chunk = needsRepair.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (item) => {
        const res = item.slug ? await fetchLiveWpEventImageWithStatus(item.slug, item.title, 7000) : { url: '', rateLimited: false };
        return { item, liveUrl: res.url, rateLimited: res.rateLimited };
      })
    );

    if (results.some((r) => r.rateLimited)) {
      stoppedByRateLimit = true;
      console.warn('[FixImages] Stopped live WordPress fetch because visitexpo.in returned HTTP 403/429 rate-limit. Deploy updated wordpress-integration.php to sync all images in 14 paginated requests.');
      break;
    }

    const chunkOps = [];
    for (const { item, liveUrl } of results) {
      if (liveUrl) {
        recoveredLive++;
        chunkOps.push({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: { banner: liveUrl } }
          }
        });
        if (item.slug) cleanedMap[item.slug] = liveUrl;
        if (item.wpId) cleanedMap[item.wpId] = liveUrl;
        if (item.titleSlug) cleanedMap[item.titleSlug] = liveUrl;
      } else {
        noWpImg++;
        if (item.hadWrongPoolBanner) {
          clearedPoolWithoutWpImg++;
          chunkOps.push({
            updateOne: {
              filter: { _id: item._id },
              update: { $set: { banner: '' } }
            }
          });
        }
      }
    }

    if (chunkOps.length > 0) {
      await eventsCol.bulkWrite(chunkOps, { ordered: false });
    }

    if ((i + chunk.length) % 40 === 0 || i + chunk.length >= needsRepair.length) {
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      console.log(
        `[FixImages] Progress ${Math.min(i + chunk.length, needsRepair.length)}/${needsRepair.length} | ` +
        `Recovered live: ${recoveredLive} | Cleared wrong pool: ${clearedPoolWithoutWpImg} | No WP img: ${noWpImg} | ${elapsed}s`
      );
    }

    if (i + CONCURRENCY < needsRepair.length) {
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  // 4. Write cleaned & enriched JSON maps to both server & client
  const jsonText = JSON.stringify(cleanedMap, null, 2);
  fs.writeFileSync(SERVER_JSON_PATH, jsonText, 'utf8');
  if (fs.existsSync(path.dirname(CLIENT_JSON_PATH))) {
    fs.writeFileSync(CLIENT_JSON_PATH, jsonText, 'utf8');
  }

  // 5. Clear local OS disk snapshot so Express reloads fresh banners from MongoDB
  try {
    if (fs.existsSync(DISK_CACHE_PATH)) {
      fs.unlinkSync(DISK_CACHE_PATH);
    }
  } catch {}

  console.log('\n=== WORDPRESS IMAGE REPAIR COMPLETE ===');
  console.log(
    JSON.stringify(
      {
        totalEvents: allEvents.length,
        removedPoisonedJsonEntries: removedPoisoned,
        fixedFromCleanJson,
        recoveredLiveFromWordPress: recoveredLive,
        clearedWrongPoolWithoutWpImage: clearedPoolWithoutWpImg,
        eventsWithoutWpImage: noWpImg,
        finalJsonKeys: Object.keys(cleanedMap).length
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[FixImages] Fatal error:', err);
  process.exit(1);
});
