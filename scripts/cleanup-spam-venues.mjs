import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { isValidRealVenueName, stripVenueSubLocation } from '../controllers/venueController.js';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const venuesCol = mongoose.connection.collection('venues');
  const eventsCol = mongoose.connection.collection('events');

  // 1. Normalize messy Event.venue strings (e.g. "ExCeL London (Hall N22" -> "ExCeL London")
  const excelSubEvents = await eventsCol.updateMany(
    { venue: { $regex: /^exce[l1]\s+london\s*(?:\(|-|hall|west|east|north|south)/i } },
    { $set: { venue: 'ExCeL London' } }
  );
  console.log(`[CleanupVenues] Normalized ${excelSubEvents.modifiedCount} ExCeL London sub-hall/entrance Event.venue fields.`);

  // 2. Gather live event counts per venue name
  const evAgg = await eventsCol
    .aggregate([
      { $match: { venue: { $exists: true, $ne: '' } } },
      { $group: { _id: { $toLower: { $trim: { input: '$venue' } } }, total: { $sum: 1 } } }
    ])
    .toArray();
  const countMap = new Map(evAgg.map((e) => [e._id, e.total]));

  const allVenues = await venuesCol.find({}).toArray();
  const existingCanonicalSlugs = new Set(
    allVenues
      .filter((v) => isValidRealVenueName(v.name, v.slug) && !/^Premier Convention & Exhibition Facility in India$/i.test(String(v.tagline || '')))
      .map((v) => String(v.slug || '').toLowerCase().trim())
  );

  const idsToDelete = [];
  const deletedSummary = {
    invalidOrSpamNameOrSlug: 0,
    autoCreatedZeroEventDummy: 0,
    subHallDuplicate: 0,
    samples: []
  };

  for (const v of allVenues) {
    const rawName = String(v.name || '').trim();
    const rawSlug = String(v.slug || '').trim();
    const vShort = stripVenueSubLocation(v.shortName || rawName).toLowerCase().trim();
    const vName = stripVenueSubLocation(rawName).toLowerCase().trim();

    let directMatches = 0;
    for (const [k, cnt] of countMap.entries()) {
      if (
        k === rawName.toLowerCase() ||
        k === vShort ||
        k === vName ||
        (vShort.length > 4 && k.includes(vShort)) ||
        (vName.length > 5 && k.includes(vName))
      ) {
        directMatches += cnt;
      }
    }

    // Rule A: Invalid / spam / URL / %20 / standalone hall / generic placeholder venue
    if (!isValidRealVenueName(rawName, rawSlug)) {
      idsToDelete.push(v._id);
      deletedSummary.invalidOrSpamNameOrSlug++;
      if (deletedSummary.samples.length < 30) deletedSummary.samples.push(`INVALID: ${rawSlug} (${rawName})`);
      continue;
    }

    // Rule B: Auto-created by legacy GET /api/venues/:slug bug (Premier Convention... in India, city=India, country=India)
    const isLegacyAutoSlug =
      !v.isFeatured &&
      /^Premier Convention & Exhibition Facility in India$/i.test(String(v.tagline || '').trim()) &&
      String(v.city || '').trim().toLowerCase() === 'india' &&
      String(v.country || '').trim().toLowerCase() === 'india';

    if (isLegacyAutoSlug) {
      idsToDelete.push(v._id);
      deletedSummary.autoCreatedZeroEventDummy++;
      if (deletedSummary.samples.length < 30) deletedSummary.samples.push(`AUTO_DUMMY: ${rawSlug} (${rawName})`);
      continue;
    }

    // Rule C: Sub-hall / entrance duplicate of a parent venue (e.g. "Excel London Hall N22", "Tokyo Big Sight (East Halls)")
    const stripped = stripVenueSubLocation(rawName);
    const parentSlug = slugify(stripped);
    const isSubHallVariant =
      stripped &&
      stripped.toLowerCase() !== rawName.toLowerCase() &&
      parentSlug &&
      parentSlug !== rawSlug.toLowerCase();

    if (isSubHallVariant && !v.isFeatured && (existingCanonicalSlugs.has(parentSlug) || directMatches === 0)) {
      idsToDelete.push(v._id);
      deletedSummary.subHallDuplicate++;
      if (deletedSummary.samples.length < 30) deletedSummary.samples.push(`SUBHALL_DUPE: ${rawSlug} (${rawName}) -> ${parentSlug}`);
      continue;
    }
  }

  let deletedCount = 0;
  if (idsToDelete.length > 0) {
    const res = await venuesCol.deleteMany({ _id: { $in: idsToDelete } });
    deletedCount = res.deletedCount || 0;
  }

  const remainingTotal = await venuesCol.countDocuments({});
  const remainingExcel = await venuesCol
    .find({ $or: [{ name: /excel/i }, { slug: /excel/i }] })
    .project({ slug: 1, name: 1, city: 1, country: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        beforeTotal: allVenues.length,
        deletedCount,
        remainingTotal,
        deletedSummary,
        remainingExcel
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[CleanupVenues] Error:', err);
  process.exit(1);
});
