// One-off: widen the candidate registry. `npm run seed` then verifies every entry
// and keeps only the boards that actually answer.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db.js';

const FILE = join(ROOT, 'data', 'companies.json');

const ADD = {
  greenhouse: [
    ['Zomato', 'zomato'], ['Paytm', 'paytm'], ['PayU', 'payu'], ['Pine Labs', 'pinelabs'],
    ['Setu', 'setu'], ['M2P Fintech', 'm2pfintech'], ['Perfios', 'perfios'], ['Yubi', 'yubi'],
    ['KreditBee', 'kreditbee'], ['Acko', 'acko'], ['Digit Insurance', 'godigit'],
    ['Policybazaar', 'policybazaar'], ['Wakefit', 'wakefit'], ['Mamaearth', 'mamaearth'],
    ['BigBasket', 'bigbasket'], ['Blinkit', 'blinkit'], ['Porter', 'porter'], ['Rapido', 'rapido'],
    ['BlackBuck', 'blackbuck'], ['Locus', 'locus'], ['Shipsy', 'shipsy'], ['FarEye', 'fareye'],
    ['Ninjacart', 'ninjacart'], ['DeHaat', 'dehaat'], ['Jumbotail', 'jumbotail'],
    ['ElasticRun', 'elasticrun'], ['Vedantu', 'vedantu'], ['Physics Wallah', 'physicswallah'],
    ['Emeritus', 'emeritus'], ['Great Learning', 'greatlearning'], ['Simplilearn', 'simplilearn'],
    ['Eightfold', 'eightfold'], ['Gainsight', 'gainsight'], ['Icertis', 'icertis'],
    ['HackerRank', 'hackerrank'], ['HackerEarth', 'hackerearth'], ['Zenoti', 'zenoti'],
    ['Capillary', 'capillarytech'], ['WebEngage', 'webengage'], ['Amagi', 'amagi'],
    ['Glance', 'glance'], ['Pocket FM', 'pocketfm'], ['Zerodha', 'zerodha'],
    ['Smallcase', 'smallcase'], ['INDmoney', 'indmoney'], ['Epifi', 'epifi'],
    ['Atlassian', 'atlassian'], ['Adobe', 'adobe'], ['Salesforce', 'salesforce'],
    ['Workday', 'workday'], ['Splunk', 'splunk'], ['Palo Alto Networks', 'paloaltonetworks'],
    ['CrowdStrike', 'crowdstrike'], ['Okta', 'okta'], ['Datadog', 'datadog'],
    ['New Relic', 'newrelic'], ['PagerDuty', 'pagerduty'], ['Amplitude', 'amplitude'],
    ['Mixpanel', 'mixpanel'], ['Airbyte', 'airbyte'], ['dbt Labs', 'dbtlabs'],
    ['Fivetran', 'fivetran'], ['Starburst', 'starburst'], ['ClickHouse', 'clickhouse'],
    ['Redis', 'redis'], ['Neo4j', 'neo4j'], ['Cockroach Labs', 'cockroachlabs'],
    ['Grafana Labs', 'grafanalabs'], ['Sentry', 'sentry'], ['Netlify', 'netlify'],
    ['Cloudflare', 'cloudflare'], ['DigitalOcean', 'digitalocean'], ['Zapier', 'zapier'],
    ['HubSpot', 'hubspot'], ['Klaviyo', 'klaviyo'], ['Braze', 'braze'],
    ['Contentful', 'contentful'], ['Miro', 'miro'], ['Airtable', 'airtable'],
    ['Asana', 'asana'], ['Smartsheet', 'smartsheet'], ['Box', 'box'], ['Dropbox', 'dropbox'],
    ['Wise', 'wise'], ['Revolut', 'revolut'], ['Adyen', 'adyen'],
    ['Booking.com', 'bookingcom'], ['Expedia Group', 'expediagroup'], ['Agoda', 'agoda'],
    ['Grab', 'grab'], ['Delivery Hero', 'deliveryhero'], ['ThoughtSpot', 'thoughtspot'],
    ['Sigmoid', 'sigmoid'], ['Tiger Analytics', 'tigeranalytics'], ['Quantiphi', 'quantiphi'],
    ['LatentView', 'latentview'],
  ],
  lever: [
    ['Swiggy', 'swiggy'], ['Meesho', 'meesho'], ['Groww', 'groww'], ['Razorpay', 'razorpay'],
    ['CRED', 'cred'], ['Slice', 'sliceit'], ['Jupiter Money', 'jupitermoney'], ['Navi', 'navi'],
    ['Ather Energy', 'atherenergy'], ['Ola Electric', 'olaelectric'], ['Yulu', 'yulu'],
    ['Zomato', 'zomato'], ['Nykaa', 'nykaa'], ['Purplle', 'purplle'], ['Lenskart', 'lenskart'],
    ['FirstCry', 'firstcry'], ['Pepperfry', 'pepperfry'], ['Cult.fit', 'cult'],
    ['HealthifyMe', 'healthifyme'], ['Pristyn Care', 'pristyncare'], ['MediBuddy', 'medibuddy'],
    ['Practo', 'practo'], ['Innovaccer', 'innovaccer'], ['Qure.ai', 'qure'],
    ['Observe.AI', 'observeai'], ['Verloop', 'verloop'], ['Haptik', 'haptik'],
    ['Wingify', 'wingify'], ['Freshworks', 'freshworks'], ['Zoho', 'zoho'],
    ['Kissflow', 'kissflow'], ['Facilio', 'facilio'], ['Whatfix', 'whatfix'],
    ['Mindtickle', 'mindtickle'], ['Fractal Analytics', 'fractalanalytics'],
    ['Course5i', 'course5i'], ['TheMathCompany', 'themathcompany'], ['Tredence', 'tredence'],
    ['Affine', 'affine'],
  ],
  ashby: [
    ['Zepto', 'zeptonow'], ['Rippling', 'rippling'], ['Deel', 'deel'], ['Notion', 'notion'],
    ['Scale AI', 'scaleai'], ['OpenAI', 'openai'], ['Anthropic', 'anthropic'],
    ['Perplexity', 'perplexity'], ['Cohere', 'cohere'], ['Together AI', 'together'],
    ['Weights and Biases', 'wandb'], ['LangChain', 'langchain'], ['Pinecone', 'pinecone'],
    ['Neon', 'neon'], ['PlanetScale', 'planetscale'], ['Railway', 'railway'],
    ['Render', 'render'], ['Warp', 'warp'], ['Loom', 'loom'], ['Retool', 'retool'],
    ['Mercury', 'mercury'], ['Brex', 'brex'], ['Cars24', 'cars24'], ['CoinDCX', 'coindcx'],
    ['CoinSwitch', 'coinswitch'], ['Zluri', 'zluri'], ['Rocketlane', 'rocketlane'],
    ['SpotDraft', 'spotdraft'], ['Leap Finance', 'leapfinance'], ['Nova Benefits', 'novabenefits'],
  ],
  smartrecruiters: [
    ['Bosch', 'Bosch'], ['Continental AG', 'ContinentalAG'], ['ZF Group', 'ZFGroup'],
    ['MAHLE', 'MAHLE'], ['Valeo', 'Valeo'], ['Faurecia', 'Faurecia'], ['Forvia', 'Forvia'],
    ['Magna', 'Magna'], ['Aptiv', 'Aptiv'], ['BorgWarner', 'BorgWarner'],
    ['Cummins', 'Cummins'], ['Caterpillar', 'Caterpillar'], ['John Deere', 'JohnDeere'],
    ['Danfoss', 'Danfoss'], ['ABB', 'ABB'], ['Alstom', 'Alstom'],
    ['Hitachi Energy', 'HitachiEnergy'], ['Vestas', 'Vestas'], ['Signify', 'Signify'],
    ['Philips', 'Philips'], ['Ericsson', 'Ericsson'], ['Nokia', 'Nokia'], ['Atos', 'Atos'],
    ['Capgemini', 'Capgemini'], ['Sopra Steria', 'SopraSteria'], ['Adecco', 'Adecco'],
    ['Randstad', 'Randstad'], ['ManpowerGroup', 'ManpowerGroup'], ['Reckitt', 'Reckitt'],
    ['Unilever', 'Unilever'], ['Nestle', 'Nestle'], ['Danone', 'Danone'],
    ['Heineken', 'Heineken'], ['Beiersdorf', 'Beiersdorf'], ['Henkel', 'Henkel'],
    ['BASF', 'BASF'], ['Evonik', 'Evonik'], ['Merck Group', 'MerckGroup'],
    ['Fresenius', 'Fresenius'], ['AstraZeneca', 'AstraZeneca'], ['GSK', 'GSK'],
    ['Takeda', 'Takeda'], ['Zoetis', 'Zoetis'], ['IQVIA', 'IQVIA'],
    ['Wipro', 'Wipro'], ['Infosys', 'Infosys'], ['Tech Mahindra', 'TechMahindra'],
    ['LTIMindtree', 'LTIMindtree'], ['Mphasis', 'Mphasis'], ['Hexaware', 'Hexaware'],
    ['Zensar', 'Zensar'], ['Birlasoft', 'Birlasoft'], ['Genpact', 'Genpact'],
    ['WNS', 'WNS'], ['Firstsource', 'Firstsource'], ['Concentrix', 'Concentrix'],
  ],
};

const cfg = JSON.parse(readFileSync(FILE, 'utf8'));
let added = 0;

for (const [ats, list] of Object.entries(ADD)) {
  if (!cfg[ats]) cfg[ats] = [];
  const have = new Set(cfg[ats].map((x) => x.slug.toLowerCase()));
  for (const [name, slug] of list) {
    if (have.has(slug.toLowerCase())) continue;
    cfg[ats].push({ name, slug });
    have.add(slug.toLowerCase());
    added++;
  }
}

writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');

const total = Object.entries(cfg)
  .filter(([k]) => !k.startsWith('_'))
  .reduce((s, [, v]) => s + v.length, 0);

console.log(`\n  added ${added} candidates · registry now ${total} entries`);
for (const [k, v] of Object.entries(cfg)) {
  if (!k.startsWith('_')) console.log(`    ${k.padEnd(18)} ${String(v.length).padStart(4)}`);
}
console.log('\n  Next: npm run seed\n');
