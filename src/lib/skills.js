// Skill taxonomy + JD extraction.
// Canonical name -> aliases. Canonicalisation is what stops the skill bank
// filling with "K8s", "Kubernetes" and "kubernetes" as three separate entries.

export const TAXONOMY = {
  // ---- delivery / PM ----
  'Project Management': ['project management', 'project manager', 'project delivery', 'project planning'],
  'Program Management': ['program management', 'programme management', 'program manager', 'programme manager'],
  'PMO': ['pmo', 'project management office', 'programme management office'],
  'Agile': ['agile', 'agile methodology', 'agile delivery', 'agile practices'],
  'Scrum': ['scrum', 'scrum master', 'sprint planning', 'daily standup', 'sprint'],
  'Kanban': ['kanban'],
  'SAFe': ['safe', 'scaled agile', 'scaled agile framework'],
  'Waterfall': ['waterfall', 'sdlc waterfall'],
  'Stakeholder Management': ['stakeholder management', 'stakeholder engagement', 'stakeholder communication', 'stakeholders'],
  'Change Management': ['change management', 'organizational change', 'organisational change', 'ocm'],
  'Risk Management': ['risk management', 'risk mitigation', 'risk assessment', 'raid'],
  'Vendor Management': ['vendor management', 'supplier management', 'third party management'],
  'Transition Management': ['transition management', 'transition', 'knowledge transfer', 'transition planning'],
  'Resource Management': ['resource management', 'capacity planning', 'resource planning', 'resource allocation'],
  'Budget Management': ['budget management', 'budgeting', 'cost management', 'financial planning', 'p&l'],
  'Governance': ['governance', 'project governance', 'steering committee'],
  'Requirement Gathering': ['requirement gathering', 'requirements gathering', 'business requirements', 'brd', 'requirement analysis'],
  'Business Analysis': ['business analysis', 'business analyst', 'gap analysis'],
  'Product Management': ['product management', 'product manager', 'product owner', 'roadmap'],
  'Delivery Management': ['delivery management', 'delivery manager', 'service delivery'],
  'Client Management': ['client management', 'client servicing', 'client success', 'customer success', 'account management'],
  'Process Improvement': ['process improvement', 'continuous improvement', 'process optimization', 'process optimisation'],
  'Six Sigma': ['six sigma', 'lean six sigma', 'green belt', 'black belt'],
  'ITIL': ['itil', 'incident management', 'problem management', 'change control'],
  'PMP': ['pmp', 'project management professional'],
  'Prince2': ['prince2', 'prince 2'],

  // ---- tools ----
  'JIRA': ['jira', 'atlassian jira'],
  'Confluence': ['confluence'],
  'MS Project': ['ms project', 'microsoft project', 'msp'],
  'Asana': ['asana'],
  'Trello': ['trello'],
  'ServiceNow': ['servicenow', 'service now'],
  'SharePoint': ['sharepoint'],
  'Smartsheet': ['smartsheet'],
  'Excel': ['excel', 'advanced excel', 'ms excel', 'microsoft excel', 'pivot table', 'vlookup'],
  'PowerPoint': ['powerpoint', 'ms powerpoint'],
  'Visio': ['visio'],
  'Slack': ['slack'],
  'Figma': ['figma'],

  // ---- data / BI ----
  'Power BI': ['power bi', 'powerbi', 'power-bi'],
  'Tableau': ['tableau'],
  'Looker': ['looker', 'looker studio'],
  'SQL': ['sql', 'mysql', 'postgresql', 'postgres', 't-sql', 'plsql', 'pl/sql'],
  'Python': ['python', 'pandas', 'numpy'],
  'R': ['r programming'],
  'Data Analysis': ['data analysis', 'data analytics', 'analytics', 'data driven'],
  'Data Visualization': ['data visualization', 'data visualisation', 'dashboards', 'dashboarding'],
  'ETL': ['etl', 'elt', 'data pipeline', 'data pipelines'],
  'Snowflake': ['snowflake'],
  'Databricks': ['databricks'],
  'Machine Learning': ['machine learning', 'ml', 'predictive modeling', 'predictive modelling'],

  // ---- cloud / eng ----
  'Azure': ['azure', 'microsoft azure', 'azure devops', 'adf', 'azure data factory'],
  'AWS': ['aws', 'amazon web services', 'ec2', 's3', 'lambda'],
  'GCP': ['gcp', 'google cloud', 'google cloud platform', 'bigquery'],
  'Kubernetes': ['kubernetes', 'k8s', 'eks', 'aks', 'gke'],
  'Docker': ['docker', 'containerization', 'containerisation'],
  'DevOps': ['devops', 'ci/cd', 'cicd', 'continuous integration', 'continuous delivery'],
  'Terraform': ['terraform', 'infrastructure as code', 'iac'],
  'Jenkins': ['jenkins'],
  'Git': ['git', 'github', 'gitlab', 'bitbucket', 'version control'],
  'REST API': ['rest api', 'restful', 'api integration', 'apis'],
  'Microservices': ['microservices', 'micro services'],
  'Java': ['java', 'spring boot', 'j2ee'],
  'JavaScript': ['javascript', 'typescript', 'node.js', 'nodejs'],
  'React': ['react', 'react.js', 'reactjs'],
  'Salesforce': ['salesforce', 'sfdc', 'apex'],
  'SAP': ['sap', 'sap abap', 'sap mm', 'sap fico', 'sap bw', 's/4hana'],
  'Oracle': ['oracle', 'oracle erp', 'oracle fusion'],
  'Workday': ['workday'],
  'Zoho': ['zoho', 'zoho crm'],
  'Cloud Migration': ['cloud migration', 'cloud transformation', 'migration project'],
  'Cybersecurity': ['cybersecurity', 'cyber security', 'information security', 'infosec'],
  'Testing': ['testing', 'qa', 'quality assurance', 'test management', 'uat'],
  'Automation': ['automation', 'rpa', 'robotic process automation', 'uipath'],

  // ---- domain / soft ----
  'Telecom': ['telecom', 'telecommunications', '5g', 'ran'],
  'BFSI': ['bfsi', 'banking', 'financial services', 'fintech', 'insurance'],
  'Healthcare': ['healthcare', 'pharma', 'life sciences', 'hcp', 'clinical'],
  'Retail': ['retail', 'ecommerce', 'e-commerce'],
  'Manufacturing': ['manufacturing', 'supply chain', 'logistics'],
  'Hospitality': ['hospitality', 'travel', 'synxis'],
  'Compliance': ['compliance', 'regulatory', 'audit', 'sox', 'gdpr'],
  'Communication': ['communication skills', 'verbal and written', 'presentation skills'],
  'Leadership': ['leadership', 'team management', 'people management', 'mentoring', 'coaching'],
  'Problem Solving': ['problem solving', 'analytical skills', 'critical thinking'],
  'Negotiation': ['negotiation', 'conflict resolution'],
  'Documentation': ['documentation', 'sop', 'runbook', 'technical writing'],
  'Reporting': ['reporting', 'mis', 'status reporting', 'kpi', 'metrics'],
};

// Build alias -> canonical lookup, longest alias first for greedy matching.
const ALIASES = [];
for (const [canon, list] of Object.entries(TAXONOMY)) {
  for (const alias of list) ALIASES.push({ alias, canon, len: alias.length });
}
ALIASES.sort((a, b) => b.len - a.len);

const ALIAS_TO_CANON = new Map(ALIASES.map((a) => [a.alias, a.canon]));

/** Map any free-text skill string onto a canonical name (or title-case it). */
export function canonicalize(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return null;
  if (ALIAS_TO_CANON.has(s)) return ALIAS_TO_CANON.get(s);
  for (const { alias, canon } of ALIASES) {
    if (s === alias) return canon;
  }
  return raw.trim();
}

function wordBoundaryRegex(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // \b fails around "c++"/"c#"; use lookarounds on word chars instead.
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

const REQUIRED_CUE =
  /(must have|must-have|required|requirement|essential|mandatory|you have|you should have|qualification|what you.{0,10}bring|we.{0,5}re looking for|minimum)/i;
const NICE_CUE = /(nice to have|good to have|preferred|plus|bonus|desirable|advantage)/i;

/**
 * Extract skills from JD text, split into required vs nice-to-have.
 * A skill is "required" unless the only place it appears is under a
 * nice-to-have cue.
 */
export function extractSkills(jdText) {
  const text = String(jdText || '');
  if (!text.trim()) return { required: [], nice: [], all: [] };

  const lines = text.split(/\n+/);
  // Track section context line by line: JDs are written as headed lists.
  let section = 'body';
  const hits = new Map(); // canon -> { required: bool, nice: bool }

  const record = (canon, ctx) => {
    const cur = hits.get(canon) || { required: false, nice: false };
    if (ctx === 'nice') cur.nice = true;
    else cur.required = true;
    hits.set(canon, cur);
  };

  for (const line of lines) {
    if (NICE_CUE.test(line) && line.length < 120) section = 'nice';
    else if (REQUIRED_CUE.test(line) && line.length < 160) section = 'required';

    for (const { alias, canon } of ALIASES) {
      if (hits.has(canon) && hits.get(canon).required) continue;
      if (wordBoundaryRegex(alias).test(line)) {
        const inlineNice = NICE_CUE.test(line);
        record(canon, inlineNice || section === 'nice' ? 'nice' : 'required');
      }
    }
  }

  const required = [];
  const nice = [];
  for (const [canon, flag] of hits) {
    if (flag.required) required.push(canon);
    else nice.push(canon);
  }
  return { required: required.sort(), nice: nice.sort(), all: [...required, ...nice].sort() };
}

/** Pull an experience requirement out of a JD. Returns { min, max } in years. */
export function extractExperience(jdText) {
  const text = String(jdText || '').toLowerCase().replace(/\s+/g, ' ');
  const patterns = [
    /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–|—)\s*(\d{1,2})\s*(?:\+)?\s*(?:years|yrs|year)/,
    /(?:minimum|min|at least|atleast|over)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years|yrs|year)/,
    /(\d{1,2})\s*\+\s*(?:years|yrs|year)/,
    /(\d{1,2})\s*(?:years|yrs)\s*(?:of\s*)?(?:relevant\s*|total\s*|overall\s*)?experience/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (!m) continue;
    if (i === 0) {
      const min = Number(m[1]);
      const max = Number(m[2]);
      if (min <= max && max <= 40) return { min, max };
    } else {
      const min = Number(m[1]);
      if (min <= 40) return { min, max: null };
    }
  }
  return { min: null, max: null };
}

export function extractEmploymentType(jdText, hint) {
  const t = `${hint || ''} ${String(jdText || '').slice(0, 2000)}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return 'Internship';
  if (/\bcontract|contractor|c2h|fixed term\b/.test(t)) return 'Contract';
  if (/\bpart[- ]time\b/.test(t)) return 'Part-time';
  return 'Full-time';
}
