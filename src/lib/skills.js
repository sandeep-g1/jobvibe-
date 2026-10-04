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
  'Delivery Management': ['delivery management', 'delivery manager'],
  'Client Management': ['client management', 'client servicing', 'client success', 'customer success', 'account management'],
  'Process Improvement': ['process improvement', 'continuous improvement', 'process optimization', 'process optimisation'],
  'Six Sigma': ['six sigma', 'lean six sigma', 'green belt', 'black belt'],
  'ITIL': ['itil', 'problem management', 'change control'],
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
  'SAP': ['sap', 'sap abap', 'sap bw'],
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
  'Manufacturing': ['manufacturing'],
  'Hospitality': ['hospitality', 'travel', 'synxis'],
  'Compliance': ['compliance', 'regulatory', 'audit', 'sox', 'gdpr'],
  'Communication': ['communication skills', 'verbal and written', 'presentation skills'],
  'Leadership': ['leadership', 'team management', 'people management', 'mentoring', 'coaching'],
  'Problem Solving': ['problem solving', 'analytical skills', 'critical thinking'],
  'Negotiation': ['negotiation', 'conflict resolution'],
  'Documentation': ['documentation', 'sop', 'runbook', 'technical writing'],
  'Reporting': ['reporting', 'mis', 'status reporting', 'kpi', 'metrics'],

  // ---- healthcare claims / RCM ----
  'Claims Adjudication': ['claims adjudication', 'claim adjudication', 'adjudicate claims', 'adjudicated claims', 'claims adjudicator', 'adjudicating'],
  'Claims Processing': ['claims processing', 'claim processing', 'claims processor', 'process claims', 'claims handling'],
  'Medical Billing': ['medical billing', 'healthcare billing', 'billing and coding'],
  'Medical Coding': ['medical coding', 'icd-10', 'icd 10', 'cpt', 'hcpcs', 'cpt codes'],
  'Revenue Cycle Management': ['revenue cycle', 'rcm', 'revenue cycle management', 'accounts receivable follow-up', 'ar follow up', 'denial management'],
  'Medicare / Medicaid': ['medicare', 'medicaid', 'mapd', 'medicare advantage'],
  'HIPAA': ['hipaa', 'phi', 'protected health information'],
  'TriZetto Facets': ['facets', 'trizetto', 'trizetto facets', 'qnxt'],
  'Eligibility Verification': ['eligibility verification', 'member eligibility', 'benefit verification', 'insurance verification', 'coordination of benefits', 'cob'],
  'US Healthcare': ['us healthcare', 'payer', 'health insurance', 'health plan', 'provider network'],

  // ---- operations / service delivery / field ----
  'Operations Management': ['operations management', 'business operations', 'operations analyst', 'operational excellence'],
  'Field Operations': ['field operations', 'field service', 'field engineer', 'field technician', 'onsite support'],
  'Dispatch Coordination': ['dispatch', 'technician dispatch', 'scheduling coordinator', 'appointment scheduling', 'workforce scheduling'],
  'Service Delivery': ['service delivery', 'service delivery management', 'service operations'],
  'SLA Management': ['sla', 'slas', 'service level agreement', 'turnaround time', 'tat'],
  'Incident Management': ['incident management', 'major incident', 'incident response', 'escalation management', 'escalations'],
  'Ticketing Systems': ['ticketing', 'ticketing system', 'ticket management', 'help desk', 'helpdesk', 'service desk'],
  'Zendesk': ['zendesk'],
  'Freshdesk': ['freshdesk', 'freshservice'],
  'BMC Remedy': ['remedy', 'bmc remedy', 'helix'],
  'Customer Support': ['customer support', 'customer service', 'technical support', 'client support'],
  'Quality Assurance (Process)': ['quality audit', 'qa audit', 'quality control', 'quality analyst'],
  'Facilities Management': ['facilities management', 'facility management', 'soft services', 'hard services', 'workplace services'],
  'Logistics': ['logistics', 'supply chain', 'inventory management', 'warehouse', 'procurement'],
  'Data Entry': ['data entry', 'data accuracy', 'back office'],
  'BPO': ['bpo', 'kpo', 'business process outsourcing', 'contact center', 'call center', 'call centre'],

  // ---- SAP / finance ----
  'SAP FICO': ['sap fico', 'sap fi', 'sap co', 'sap fi/co', 'sap finance', 'sap controlling'],
  'SAP S/4HANA': ['s/4hana', 's4hana', 's/4 hana', 'sap s/4'],
  'SAP MM / SD': ['sap mm', 'sap sd', 'sap materials management', 'sap sales and distribution'],
  'General Ledger': ['general ledger', 'gl accounting', 'record to report', 'r2r'],
  'Accounts Payable': ['accounts payable', 'procure to pay', 'p2p'],
  'Accounts Receivable': ['accounts receivable', 'order to cash', 'o2c'],
  'Financial Reporting': ['financial reporting', 'month end close', 'month-end close', 'financial statements', 'ifrs', 'gaap'],
  'FP&A': ['fp&a', 'budgeting and forecasting', 'forecasting'],
  'Tally': ['tally', 'tally erp'],

  // ---- engineering / simulation ----
  'CAE / Simulation': ['cae', 'simulation', 'fea', 'finite element', 'cfd', 'computational fluid dynamics'],
  'GT-Suite': ['gt-suite', 'gt suite', 'gt-power'],
  'ANSYS': ['ansys', 'ansys fluent', 'ansys mechanical'],
  'MATLAB / Simulink': ['matlab', 'simulink'],
  'AMESim': ['amesim', 'simcenter amesim'],
  'Powertrain': ['powertrain', 'engine calibration', 'vehicle dynamics', 'drivetrain'],
  'CAD': ['cad', 'catia', 'solidworks', 'creo', 'nx cad', 'autocad'],
  'Production Engineering': ['production engineering', 'manufacturing engineering', 'lean manufacturing', 'process engineering'],

  // ---- HR / sales ----
  'Recruitment': ['recruitment', 'talent acquisition', 'sourcing candidates', 'recruiter'],
  'HR Operations': ['hr operations', 'onboarding', 'payroll', 'hris', 'employee lifecycle'],
  'Sales': ['sales', 'business development', 'lead generation', 'inside sales'],
  'CRM': ['crm', 'customer relationship management'],
  'HubSpot': ['hubspot'],
  'Microsoft Dynamics': ['dynamics 365', 'microsoft dynamics', 'dynamics crm'],
  'Google Sheets': ['google sheets', 'google workspace', 'g suite'],
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
