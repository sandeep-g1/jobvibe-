// Third registry expansion.
//
// Batch 1 and 2 established the two highest-yield patterns: industrial/pharma
// multinationals on SmartRecruiters, and global software firms with Indian
// engineering centres on Greenhouse/Lever/Ashby. This batch pushes deeper into
// both, plus Indian GCCs (global capability centres) and home-grown unicorns.
//
// Every entry is a guess. `npm run seed` probes each and keeps only the boards
// that answer with real India roles, so wrong slugs cost one HTTP request each.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db/driver.js';

const FILE = join(ROOT, 'data', 'companies.json');

const ADD = {
  greenhouse: [
    // Indian SaaS / product
    ['Chargebee HQ', 'chargebee'], ['Freshworks Inc', 'freshworksinc'], ['Postman Inc', 'postmaninc'],
    ['Zeta India', 'zetaindia'], ['Gupshup Inc', 'gupshupio'], ['Yellow AI', 'yellowai'],
    ['Locus Sh', 'locussh'], ['Fractal AI', 'fractalai'], ['Sprinklr Inc', 'sprinklrinc'],
    ['Highradius', 'highradius'], ['Icertis Inc', 'icertisinc'], ['Kissflow Inc', 'kissflowinc'],
    ['Rippling India', 'ripplingindia'], ['Chargebee Corp', 'chargebeecorp'], ['Whatfix Inc', 'whatfixinc'],
    ['Netradyne', 'netradyne'], ['Uniphore Inc', 'uniphoreinc'], ['Gong', 'gong'],
    ['Clari', 'clari'], ['People.ai', 'peopleai'], ['Aviso', 'aviso'],
    // Fintech / crypto
    ['Groww App', 'growwapp'], ['Zerodha Tech', 'zerodhatech'], ['Angel One', 'angelone'],
    ['Upstox', 'upstox'], ['Fi Money', 'fimoney'], ['Jupiter', 'jupiter'],
    ['Cred Labs', 'credlabs'], ['Razorpay Inc', 'razorpayinc'], ['Pine Labs Inc', 'pinelabsinc'],
    ['Cashfree', 'cashfree'], ['Juspay Tech', 'juspaytech'], ['Zeta Fintech', 'zetafintech'],
    ['CoinDCX', 'coindcx'], ['CoinSwitch', 'coinswitch'], ['WazirX', 'wazirx'],
    ['Mudrex', 'mudrex'], ['Vauld', 'vauld'], ['Onramp Money', 'onrampmoney'],
    // health / edtech / commerce
    ['PharmEasy Inc', 'pharmeasyinc'], ['Innovaccer Inc', 'innovaccerinc'], ['HealthifyMe', 'healthifyme'],
    ['Cure.fit Care', 'curefitcare'], ['Practo Tech', 'practotech'], ['MediBuddy', 'medibuddy'],
    ['Physics Wallah', 'physicswallah'], ['Vedantu Inc', 'vedantuinc'], ['upGrad Edu', 'upgradedu'],
    ['Scaler Academy', 'scaleracademy'], ['Newton School', 'newtonschool'], ['Masai School', 'masaischool'],
    ['Meesho Inc', 'meeshoinc'], ['Udaan Tech', 'udaantech'], ['DealShare', 'dealshare'],
    ['Zepto', 'zepto'], ['Blinkit', 'blinkit'], ['Zomato Inc', 'zomatoinc'],
    // GCC / global product with India centres
    ['Atlassian Inc', 'atlassianinc'], ['Confluent Inc', 'confluentinc'], ['HashiCorp Inc', 'hashicorpinc'],
    ['Cloudflare Inc', 'cloudflareinc'], ['DigitalOcean Inc', 'digitaloceaninc'], ['Redis Inc', 'redisinc'],
    ['Grafana', 'grafana'], ['Chronosphere', 'chronosphere'], ['Temporal Tech', 'temporaltech'],
    ['Airbyte Inc', 'airbyteinc'], ['dbt Labs Inc', 'dbtlabsinc'], ['Hex', 'hex'],
    ['Retool Inc', 'retoolinc'], ['Vanta', 'vanta'], ['Drata', 'drata'],
    ['Rippling Corp', 'ripplingcorp'], ['Gusto', 'gusto'], ['Deel Inc', 'deelinc'],
    ['Remote Com', 'remotecom'], ['Multiplier', 'usemultiplier'], ['Skuad', 'skuad'],
    ['Turing Com', 'turingcom'], ['Andela', 'andela'], ['Toptal', 'toptal'],
  ],

  lever: [
    ['Swiggy Inc', 'swiggyinc'], ['PhonePe', 'phonepe'], ['Groww Fin', 'growwfin'],
    ['Meesho Tech', 'meeshotech'], ['ShareChat', 'sharechat'], ['Moj', 'moj'],
    ['Dream11 Inc', 'dream11inc'], ['Games24x7', 'games24x7'], ['MPL', 'mpl'],
    ['Unacademy Inc', 'unacademyinc'], ['Cars24 Fin', 'cars24fin'], ['Spinny', 'spinny'],
    ['Rebel Foods Inc', 'rebelfoodsinc'], ['Licious Inc', 'liciousinc'], ['Country Delight', 'countrydelight'],
    ['Bizongo', 'bizongo'], ['Moglix', 'moglix'], ['OfBusiness', 'ofbusiness'],
    ['Zetwerk Inc', 'zetwerkinc'], ['Infra.Market', 'inframarket'], ['Jupiter Money', 'jupitermoney'],
    ['slice', 'slice'], ['KreditBee', 'kreditbee'], ['MoneyTap', 'moneytap'],
    ['Navi Tech', 'navitech'], ['Khatabook', 'khatabook'], ['OkCredit', 'okcredit'],
    ['Chargebee Lever', 'chargebeelever'], ['Postman Lever', 'postmanlever'], ['Hasura', 'hasura'],
  ],

  ashby: [
    ['Zepto Now', 'zeptonow'], ['Rocketlane', 'rocketlane'], ['Zluri', 'zluri'],
    ['SpotDraft', 'spotdraft'], ['Plum', 'plumhq'], ['Onsurity', 'onsurity'],
    ['Nova Benefits', 'novabenefits'], ['Jar', 'jar'], ['Fi', 'fi'],
    ['Refyne', 'refyne'], ['Tracxn', 'tracxn'], ['Leap Finance', 'leapfinance'],
    ['Sarvam AI', 'sarvamai'], ['Krutrim', 'krutrim'], ['Sarvam', 'sarvam'],
    ['CoRover', 'corover'], ['Wysa', 'wysa'], ['Mad Street Den', 'madstreetden'],
    ['Observe AI', 'observeai'], ['Skit', 'skit'], ['Verloop', 'verloop'],
    ['Locale AI', 'localeai'], ['Hasura Ashby', 'hasuraashby'], ['Avoma', 'avoma'],
    ['DevRev', 'devrev'], ['Nurix AI', 'nurixai'], ['Composio', 'composio'],
    ['Portkey', 'portkey'], ['Fibr', 'fibr'], ['AITable', 'aitable'],
  ],

  smartrecruiters: [
    // more industrial / automotive / energy
    ['Robert Bosch', 'RobertBosch'], ['ZF Friedrichshafen', 'ZFFriedrichshafen'],
    ['Vitesco', 'Vitesco'], ['Forvia Faurecia', 'ForviaFaurecia'], ['Valeo India', 'ValeoIndia'],
    ['Cummins Inc', 'CumminsInc'], ['Caterpillar Inc', 'CaterpillarInc'], ['Komatsu', 'Komatsu'],
    ['Ingersoll Rand', 'IngersollRand'], ['Xylem', 'Xylem'], ['Pentair', 'Pentair'],
    ['Dover', 'Dover'], ['Illinois Tool Works', 'IllinoisToolWorks'], ['Rockwell', 'Rockwell'],
    ['Yokogawa', 'Yokogawa'], ['Endress Hauser', 'EndressHauser'], ['Krohne', 'Krohne'],
    ['Grundfos', 'Grundfos'], ['Danfoss India', 'DanfossIndia'], ['Wilo', 'Wilo'],
    ['GEA', 'GEA'], ['Bucher', 'Bucher'], ['Sulzer', 'Sulzer'],
    // pharma / chemicals / FMCG
    ['Boehringer', 'Boehringer'], ['Merck KGaA', 'MerckKGaA'], ['Bayer AG', 'BayerAG'],
    ['Fresenius Kabi', 'FreseniusKabi'], ['Dr Reddys', 'DrReddys'], ['Cipla', 'Cipla'],
    ['Biocon', 'Biocon'], ['Glenmark', 'Glenmark'], ['Lupin', 'Lupin'],
    ['Evonik India', 'EvonikIndia'], ['BASF India', 'BASFIndia'], ['Croda', 'Croda'],
    ['Kerry', 'Kerry'], ['Tate Lyle', 'TateLyle'], ['Symrise', 'Symrise'],
    ['Givaudan', 'Givaudan'], ['Firmenich', 'Firmenich'], ['IFF', 'IFF'],
    // services / GCC
    ['Capgemini India', 'CapgeminiIndia'], ['Sopra Steria India', 'SopraSteriaIndia'],
    ['Atos India', 'AtosIndia'], ['Amdocs India', 'AmdocsIndia'], ['Nagarro SE', 'NagarroSE'],
    ['Publicis Sapient', 'PublicisSapient'], ['Merkle', 'Merkle'], ['Dentsu', 'Dentsu'],
    ['GroupM', 'GroupM'], ['WPP', 'WPP'], ['Ogilvy', 'Ogilvy'],
    ['Kantar', 'Kantar'], ['Nielsen', 'Nielsen'], ['Ipsos', 'Ipsos'],
    // banking / insurance GCC
    ['HSBC', 'HSBC'], ['Standard Chartered', 'StandardChartered'], ['Barclays', 'Barclays'],
    ['NatWest', 'NatWest'], ['Lloyds', 'LloydsBankingGroup'], ['Credit Suisse', 'CreditSuisse'],
    ['BNP Paribas', 'BNPParibas'], ['Societe Generale', 'SocieteGenerale'], ['Commerzbank', 'Commerzbank'],
    ['Generali', 'Generali'], ['Aviva', 'Aviva'], ['Prudential', 'Prudential'],
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
const total = Object.entries(cfg).filter(([k]) => !k.startsWith('_')).reduce((s, [, v]) => s + v.length, 0);

console.log('');
console.log(`  added ${added} new candidates`);
for (const [k, n] of Object.entries(perAts)) console.log(`    ${k.padEnd(18)} +${n}`);
console.log(`\n  registry now ${total} candidates`);
console.log('\n  Next: npm run seed\n');
