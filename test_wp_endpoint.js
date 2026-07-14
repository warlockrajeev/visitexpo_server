const run = async () => {
  const url = 'https://visitexpo.in/wp-json/visitexpo/v1/create-event';
  const wpKey = 'visitexpo_custom_secret_key_12345';
  
  const payload = {
    title: "Cancer Awareness",
    slug: "cancer-awareness-1",
    content: "<!-- wp:paragraph -->\n<p>Cancer Awareness is the premier B2B gathering for Healthcare & Pharma pioneers, industry innovators, and global corporate leaders. Held in New Delhi, this landmark event features live technology demonstrations, strategic keynote panels, high-impact networking lounges, and exclusive B2B matching sessions designed to accelerate commercial growth. Join over 5,000+ registered delegates and top exhibitor brands shaping the future of global trade.</p>\n<!-- /wp:paragraph -->",
    wpPostId: "19165",
    startDate: 1783987200,
    endDate: 1783987200,
    address: "Pt Dindayal upadhaya, New Delhi",
    banner: "https://res.cloudinary.com/dxb5snl0o/image/upload/v1783943409/visitexpo/tk60axqt83sap2neqqbu.png",
    orgName: "Global Tech Events Ltd",
    orgEmail: "rajeevhaldar8265@gmail.com",
    orgPhone: "+91 98765 43210",
    orgWebsite: "https://globaltechevents.com",
    orgDesc: "",
    orgLogo: "",
    schedules: [
      { name: "Event Day", date: "" },
      { name: "Day 1: Main Panel", date: "14 nov 2026" }
    ],
    faqs: [
      { question: "Where can i collect the pass", answer: "at the centre" }
    ],
    contactShortcode: "",
    sponsorsLogos: [
      "https://res.cloudinary.com/dxb5snl0o/image/upload/v1783939818/visitexpo/hvppoqdnfq841bukfjnk.png"
    ],
    sponsorLevels: [ "Platinum" ],
    sponsorGroups: [
      [ { link: "https://www.google.com/", logoIndex: 10 } ]
    ]
  };

  console.log(`Sending POST to ${url}`);
  try {
    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VisitExpo-Key': wpKey
      },
      body: JSON.stringify(payload)
    });
    
    console.log('STATUS:', res.status);
    const text = await res.text();
    console.log('RESPONSE:', text);
    console.log(`Time taken: ${(Date.now() - start) / 1000}s`);
  } catch (err) {
    console.error('ERROR:', err);
  }
};

run();
