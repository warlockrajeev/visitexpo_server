const run = async () => {
  try {
    const url = 'https://visitexpo.in/wp-json/visitexpo/v1/inspect-event-meta';
    console.log(`Querying: ${url}`);
    const response = await fetch(url);
    const events = await response.json();
    
    const list = Array.isArray(events) ? events : (events.data || []);
    console.log('Total events fetched:', list.length);
    console.log('Titles list:', list.map(e => e.title));
    
    // Find an event that has some meta keys with ovaem_
    const target = list.find(e => {
      return Object.keys(e.meta).some(k => k.includes('ovaem_faq') || k.includes('ovaem_sponsor') || k.includes('ovaem_schedule'));
    }) || list[0];
    
    if (target) {
      console.log('TARGET EVENT FOUND:', target.title, `(ID: ${target.id})`);
      console.log('ALL METADATA FOR TARGET:');
      for (const [key, val] of Object.entries(target.meta)) {
        if (key.includes('ovaem_') || key.includes('em4u_') || key === '_thumbnail_id') {
          console.log(`"${key}": ${JSON.stringify(val)}`);
        }
      }
    } else {
      console.log('No events found at all');
    }
  } catch (err) {
    console.error(err);
  }
};

run();
