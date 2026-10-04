// Close-equivalent skills. If a JD asks for one member of a family and the
// candidate has another, tailoring may add the asked-for skill (when the user
// allows "stretch" skills) — it is learnable before the interview and the
// underlying experience transfers. Every addition is reported back to the user
// as "prepare before interview".
//
// Families are deliberately tight: same job, different vendor. Docker and
// Kubernetes are NOT a family; neither are Python and Java.
import { canonicalize } from './skills.js';

export const FAMILIES = [
  ['AWS', 'Azure', 'GCP'],
  ['Power BI', 'Tableau', 'Looker', 'Qlik'],
  ['JIRA', 'ServiceNow', 'Zendesk', 'Freshdesk', 'BMC Remedy', 'Ticketing Systems'],
  ['Salesforce', 'HubSpot', 'Microsoft Dynamics', 'Zoho', 'CRM'],
  ['SAP', 'Oracle', 'Microsoft Dynamics', 'Tally'],
  ['SAP FICO', 'SAP S/4HANA'],
  ['MS Project', 'Smartsheet', 'Asana', 'Trello'],
  ['Confluence', 'SharePoint'],
  ['Excel', 'Google Sheets'],
  ['Agile', 'Scrum', 'Kanban'],
  ['Jenkins', 'Git'],
  ['TriZetto Facets', 'Claims Adjudication', 'Claims Processing'],
  ['Medical Billing', 'Revenue Cycle Management', 'Medical Coding'],
  ['Eligibility Verification', 'US Healthcare'],
  ['GT-Suite', 'AMESim', 'MATLAB / Simulink', 'CAE / Simulation'],
  ['ANSYS', 'CAE / Simulation'],
  ['Customer Support', 'BPO'],
  ['Incident Management', 'Ticketing Systems', 'ITIL'],
  ['Field Operations', 'Dispatch Coordination', 'Service Delivery'],
  ['General Ledger', 'Accounts Payable', 'Accounts Receivable', 'Financial Reporting'],
];

const FAMILY_OF = new Map();
for (const fam of FAMILIES) {
  for (const s of fam) {
    const set = FAMILY_OF.get(s) || new Set();
    fam.forEach((x) => x !== s && set.add(x));
    FAMILY_OF.set(s, set);
  }
}

/** Skills the candidate may claim by adjacency: JD skill -> candidate skill it rests on. */
export function adjacentSkills(jdSkills, candidateSkills) {
  const have = new Set(candidateSkills.map((s) => canonicalize(s)));
  const out = [];
  for (const raw of jdSkills) {
    const want = canonicalize(raw);
    if (!want || have.has(want)) continue;
    const base = [...(FAMILY_OF.get(want) || [])].find((x) => have.has(x));
    if (base) out.push({ skill: want, basedOn: base });
  }
  return out;
}
