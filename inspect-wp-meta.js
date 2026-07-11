import fs from 'fs';

const run = async () => {
  try {
    const url = 'https://visitexpo.in/wp-json/visitexpo/v1/inspect-last-event';
    console.log(`Fetching: ${url}`);
    const response = await fetch(url);
    const data = await response.json();
    console.log('Writing results to wp-event-meta.json');
    fs.writeFileSync('wp-event-meta.json', JSON.stringify(data, null, 2));
    console.log('Done!');
  } catch (err) {
    console.error(err);
  }
};

run();
