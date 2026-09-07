// Second registry expansion.
//
// Targets what the first seed showed actually pays off:
//   * SmartRecruiters — large industrial and pharma multinationals. Bosch alone
//     returned 540 India roles, Wabtec 101, Continental 99. This tier has by
//     far the best India yield per board.
//   * Greenhouse — global software companies with Indian engineering centres.
//     Databricks 86, MongoDB 66, Zscaler 57, InMobi 44, GitLab 37, Stripe 36.
//   * Lever / Ashby — Indian startups and scale-ups.
//
// Every entry here is a guess. `npm run seed` probes each one and keeps only
// the boards that answer, so a wrong slug costs one HTTP request and nothing
// else. Slugs already present are skipped.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db/driver.js';

const FILE = join(ROOT, 'data', 'companies.json');

const ADD = {
  smartrecruiters: [
    // industrial / automotive — the highest-yield group so far
    ['Siemens Energy', 'SiemensEnergy'], ['Siemens Healthineers', 'SiemensHealthineers'],
    ['Schaeffler', 'Schaeffler'], ['ThyssenKrupp', 'thyssenkrupp'],
    ['Knorr-Bremse', 'KnorrBremse'], ['Hitachi Vantara', 'HitachiVantara'],
    ['Emerson', 'Emerson'], ['Honeywell', 'Honeywell'], ['Rockwell Automation', 'RockwellAutomation'],
    ['Eaton', 'Eaton'], ['Parker Hannifin', 'ParkerHannifin'], ['Flowserve', 'Flowserve'],
    ['SKF', 'SKF'], ['Atlas Copco', 'AtlasCopco'], ['Sandvik', 'Sandvik'], ['Epiroc', 'Epiroc'],
    ['Alfa Laval', 'AlfaLaval'], ['Trelleborg', 'Trelleborg'], ['Autoliv', 'Autoliv'],
    ['Brose', 'Brose'], ['Webasto', 'Webasto'], ['HELLA', 'HELLA'], ['Marelli', 'Marelli'],
    ['DENSO', 'DENSO'], ['Lear Corporation', 'LearCorporation'], ['Adient', 'Adient'],
    ['Dana Incorporated', 'DanaIncorporated'], ['Garrett Motion', 'GarrettMotion'],
    ['Nexteer', 'Nexteer'], ['Tenneco', 'Tenneco'], ['Vitesco', 'VitescoTechnologies'],
    ['Liebherr', 'Liebherr'], ['Wacker Neuson', 'WackerNeuson'], ['Bobcat', 'Bobcat'],
    ['Volvo Group', 'VolvoGroup'], ['Scania', 'Scania'], ['MAN', 'MANEnergySolutions'],
    ['Wartsila', 'Wartsila'], ['Kone', 'KONE'], ['Schindler', 'Schindler'], ['Otis', 'Otis'],
    // energy / chemicals
    ['Air Liquide', 'AirLiquide'], ['Linde', 'Linde'], ['Solvay', 'Solvay'],
    ['Clariant', 'Clariant'], ['Lanxess', 'LANXESS'], ['Covestro', 'Covestro'],
    ['Arkema', 'Arkema'], ['Syensqo', 'Syensqo'], ['DSM', 'dsm-firmenich'],
    // pharma / medtech
    ['Novo Nordisk', 'NovoNordisk'], ['Lundbeck', 'Lundbeck'], ['UCB', 'UCB'],
    ['Ipsen', 'Ipsen'], ['Servier', 'Servier'], ['B Braun', 'BBraun'],
    ['Baxter', 'Baxter'], ['Becton Dickinson', 'BD'], ['Stryker', 'Stryker'],
    ['Medtronic', 'Medtronic'], ['Alcon', 'Alcon'], ['Straumann', 'StraumannGroup'],
    ['Galderma', 'Galderma'], ['Grifols', 'Grifols'], ['Recordati', 'Recordati'],
    // FMCG / retail
    ['PepsiCo', 'PepsiCo'], ['Mondelez', 'MondelezInternational'], ['Mars', 'Mars'],
    ['Ferrero', 'Ferrero'], ['Barilla', 'Barilla'], ['Perfetti', 'PerfettiVanMelle'],
    ['Decathlon', 'Decathlon'], ['Adidas', 'adidas'], ['Puma', 'PUMA'],
    ['H&M', 'HM'], ['Inditex', 'Inditex'], ['Lidl', 'Lidl'], ['Aldi', 'ALDI'],
    ['Carrefour', 'Carrefour'], ['Ahold Delhaize', 'AholdDelhaize'],
    // services / consulting / tech services
    ['NTT DATA', 'NTTDATA'], ['DXC Technology', 'DXCTechnology'], ['Kyndryl', 'Kyndryl'],
    ['Devoteam', 'Devoteam'], ['Amdocs', 'Amdocs'], ['Nagarro', 'Nagarro'],
    ['GFT', 'GFT'], ['Endava', 'Endava'], ['Globant', 'Globant'], ['EPAM', 'EPAM'],
    ['Thoughtworks', 'Thoughtworks'], ['Sutherland', 'Sutherland'], ['Teleperformance', 'Teleperformance'],
    ['TaskUs', 'TaskUs'], ['Startek', 'Startek'], ['HGS', 'HGS'],
    // banking / insurance with India GCCs
    ['Deutsche Bank', 'DeutscheBank'], ['UBS', 'UBS'], ['Julius Baer', 'JuliusBaer'],
    ['Allianz', 'Allianz'], ['AXA', 'AXA'], ['Zurich Insurance', 'ZurichInsurance'],
    ['Swiss Re', 'SwissRe'], ['Munich Re', 'MunichRe'], ['ING', 'ING'],
    ['Rabobank', 'Rabobank'], ['Nordea', 'Nordea'], ['Danske Bank', 'DanskeBank'],
    // travel / logistics
    ['DHL', 'DHL'], ['Kuehne Nagel', 'KuehneNagel'], ['DB Schenker', 'DBSchenker'],
    ['Maersk', 'Maersk'], ['DSV', 'DSV'], ['Geodis', 'GEODIS'],
    ['Lufthansa', 'LufthansaGroup'], ['Booking Holdings', 'BookingHoldings'],
  ],

  greenhouse: [
    // global software with India engineering centres
    ['ServiceNow', 'servicenow'], ['VMware', 'vmware'], ['Pure Storage', 'purestorage'],
    ['Veeam', 'veeam'], ['Commvault', 'commvault'], ['NetApp', 'netapp'],
    ['Akamai', 'akamai'], ['Fastly', 'fastly'], ['Imperva', 'imperva'],
    ['Tenable', 'tenable'], ['Rapid7', 'rapid7'], ['Sophos', 'sophos'],
    ['Snyk', 'snyk'], ['JFrog', 'jfrog'], ['Sonar', 'sonarsource'],
    ['Postman API', 'postmanlabs'], ['Temporal', 'temporal'], ['Vercel', 'vercel'],
    ['Supabase', 'supabase'], ['Hasura Inc', 'hasurainc'], ['Chainguard', 'chainguard'],
    ['Sourcegraph', 'sourcegraph'], ['Sentry Inc', 'sentryio'], ['Algolia', 'algolia'],
    ['Twilio Segment', 'segment'], ['Plivo', 'plivo'], ['Sinch', 'sinch'],
    ['LaunchDarkly', 'launchdarkly'], ['Split', 'split'], ['Statsig', 'statsig'],
    ['Chainalysis', 'chainalysis'], ['Bolt Financial', 'bolt'], ['Airwallex', 'airwallex'],
    ['Nium', 'nium'], ['Rapyd', 'rapyd'], ['Thunes', 'thunes'],
    // Indian startups and scale-ups
    ['Cashfree', 'cashfree'], ['Juspay', 'juspay'], ['Zeta Suite', 'zetasuite'],
    ['Shiprocket', 'shiprocket'], ['XpressBees', 'xpressbees'], ['LoadShare', 'loadshare'],
    ['Apna', 'apna'], ['Dukaan', 'dukaan'], ['Classplus', 'classplus'],
    ['Teachmint', 'teachmint'], ['Cuemath', 'cuemath'], ['LEAD School', 'leadschool'],
    ['MPL', 'mpl'], ['Gameskraft', 'gameskraft'], ['Zupee', 'zupee'],
    ['Skyflow', 'skyflow'], ['Appsmith', 'appsmith'], ['ToolJet', 'tooljet'],
    ['Frappe', 'frappe'], ['Zolve', 'zolve'], ['MoneyView', 'moneyview'],
    ['Lendingkart', 'lendingkart'], ['Aye Finance', 'ayefinance'],
    ['CoinDCX Labs', 'coindcx'], ['Bluestone', 'bluestone'], ['CaratLane', 'caratlane'],
    ['Noise', 'noise'], ['Wow Skin', 'wowskinscience'], ['Sugar Cosmetics', 'sugarcosmetics'],
    ['Country Delight', 'countrydelight'], ['Licious Foods', 'liciousfoods'],
    ['Chaayos', 'chaayos'], ['Third Wave Coffee', 'thirdwavecoffee'],
    ['Groww Invest', 'growwinvest'], ['Smallcase Tech', 'smallcasetech'],
    ['Fisdom', 'fisdom'], ['Kuvera', 'kuvera'], ['Dezerv', 'dezerv'],
    ['Jar App', 'jarapp'], ['Slice Pay', 'slicepay'], ['Uni Cards', 'unicards'],
  ],

  lever: [
    ['Meesho Tech', 'meeshotech'], ['Groww Tech', 'growwtech'],
    ['Cars24 India', 'cars24india'], ['Spinny Cars', 'spinnycars'],
    ['CoinSwitch Kuber', 'coinswitchkuber'], ['WazirX', 'wazirx'],
    ['Bharatpe Tech', 'bharatpetech'], ['Khatabook Tech', 'khatabooktech'],
    ['Zolve Finance', 'zolvefinance'], ['Jupiter Fintech', 'jupiterfintech'],
    ['Rupeek', 'rupeek'], ['Slice It', 'sliceit'], ['CredAvenue', 'credavenue'],
    ['Yubi Finance', 'yubifinance'], ['Perfios Software', 'perfiossoftware'],
    ['Signzy Tech', 'signzytech'], ['IDfy', 'idfy'], ['HyperVerge', 'hyperverge'],
    ['Bureau', 'bureau'], ['Setu Fintech', 'setufintech'],
    ['Postman Labs', 'postmanlabs'], ['BrowserStack Tech', 'browserstacktech'],
    ['Chargebee Inc', 'chargebeeinc'], ['Whatfix Inc', 'whatfixinc'],
    ['MoEngage Inc', 'moengageinc'], ['CleverTap Inc', 'clevertapinc'],
    ['Amagi Media', 'amagimedia'], ['Glance InMobi', 'glanceinmobi'],
    ['Sprinklr India', 'sprinklrindia'], ['Innovaccer Inc', 'innovaccerinc'],
  ],

  ashby: [
    ['Zepto Now', 'zepto'], ['Rocketlane Corp', 'rocketlanecorp'],
    ['Zluri Tech', 'zluritech'], ['SpotDraft Legal', 'spotdraftlegal'],
    ['Plum Insurance', 'plumhq'], ['Onsurity Health', 'onsurityhealth'],
    ['Nova Benefits Health', 'novabenefitshealth'], ['Jar Savings', 'jarsavings'],
    ['Fi Money App', 'fimoneyapp'], ['Refyne India', 'refyneindia'],
    ['Tracxn Technologies', 'tracxntechnologies'], ['Leap Scholar', 'leapscholar'],
    ['Eightfold AI Inc', 'eightfoldai'], ['Observe AI', 'observeai'],
    ['Skit AI', 'skitai'], ['Yellow AI', 'yellowai'], ['Haptik Tech', 'haptiktech'],
    ['Uniphore Tech', 'uniphoretech'], ['Gupshup Tech', 'gupshuptech'],
    ['Atlan Data', 'atlandata'], ['Hevo', 'hevo'], ['Nanonets', 'nanonets'],
    ['Mem0', 'mem0'], ['Sarvam AI', 'sarvamai'], ['Krutrim', 'krutrim'],
  ],
};

const cfg = JSON.parse(readFileSync(FILE, 'utf8'));
let added = 0;
const perAts = {};

for (const [ats, list] of Object.entries(ADD)) {
  if (!cfg[ats]) cfg[ats] = [];
  const have = new Set(cfg[ats].map((x) => x.slug.toLowerCase()));
  perAts[ats] = 0;
  for (const [name, slug] of list) {
    if (have.has(slug.toLowerCase())) continue;
    cfg[ats].push({ name, slug });
    have.add(slug.toLowerCase());
    added++;
    perAts[ats]++;
  }
}

writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');

const total = Object.entries(cfg)
  .filter(([k]) => !k.startsWith('_'))
  .reduce((s, [, v]) => s + v.length, 0);

console.log('');
console.log(`  added ${added} new candidates`);
for (const [k, n] of Object.entries(perAts)) console.log(`    ${k.padEnd(18)} +${n}`);
console.log('');
console.log(`  registry now ${total} candidates:`);
for (const [k, v] of Object.entries(cfg)) {
  if (!k.startsWith('_')) console.log(`    ${k.padEnd(18)} ${String(v.length).padStart(4)}`);
}
console.log('');
console.log('  Next: npm run seed');
console.log('');
