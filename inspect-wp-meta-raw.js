const run = async () => {
  try {
    const url = 'https://visitexpo.in/wp-json/visitexpo/v1/inspect-event-meta';
    console.log(`Querying: ${url}`);
    const response = await fetch(url);
    const json = await response.json();
    console.log('JSON keys:', Object.keys(json));
    console.log('JSON structure:', JSON.stringify(json).slice(0, 1000));
  } catch (err) {
    console.error(err);
  }
};

run();
