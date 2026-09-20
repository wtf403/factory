import { gh } from './gh.js';

const STATUSES = ['TODO', 'Analytics', 'InProgress', 'Test', 'Review', 'Completed'];

function q(args) {
  const r = gh(['api', 'graphql', ...args]);
  const out = r.stdout || '';
  if (r.status !== 0) {
    if (/INSUFFICIENT_SCOPES|requires one of the following scopes/i.test(r.stderr + out)) {
      const e = new Error('NEED_PROJECT_SCOPE');
      e.detail = (r.stderr || out).slice(0, 1500);
      throw e;
    }
    throw new Error(((r.stderr || out) || 'graphql failed').slice(0, 2000));
  }
  return JSON.parse(out || '{}');
}

export async function createBoard({ owner, title = 'Agent Factory' }) {
  let ownerId = null;
  for (const kind of ['user', 'organization']) {
    try {
      const who = q(['-f', `query=query($l:String!){${kind}(login:$l){id}}`, '-f', `l=${owner}`]);
      ownerId = who.data?.[kind]?.id;
    } catch { /* try next kind */ }
    if (ownerId) break;
  }
  if (!ownerId) throw new Error(`owner not found: ${owner}`);
  const mk = q(['-f', 'query=mutation($o:ID!,$t:String!){createProjectV2(input:{ownerId:$o,title:$t}){projectV2{id number url}}}',
    '-f', `ownerId=${ownerId}`, '-f', `title=${title}`]);
  const proj = mk.data.createProjectV2.projectV2;

  const mkfield = (name, type) => q([
    '-f', 'query=mutation($p:ID!,$n:String!,$t:ProjectV2FieldType!){createProjectV2Field(input:{projectId:$p,name:$n,dataType:$t}){projectV2Field{... on ProjectV2Field{id} ... on ProjectV2SingleSelectField{id}}}}',
    '-f', `pid=${proj.id}`, '-f', `name=${name}`, '-f', `type=${type}`,
  ]).data.createProjectV2Field.projectV2Field.id;

  const setopts = (fid, opts) => q([
    '-f', 'query=mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}',
    '-f', `fid=${fid}`, '--raw-field', `opts=${JSON.stringify(opts.map((name) => ({ name })))}`,
  ]);

  setopts(mkfield('Status', 'SINGLE_SELECT'), STATUSES);
  setopts(mkfield('Priority', 'SINGLE_SELECT'), ['Low', 'Medium', 'High']);
  setopts(mkfield('Team', 'SINGLE_SELECT'), ['Platform', 'Docs', 'Product']);
  setopts(mkfield('CI Status', 'SINGLE_SELECT'), ['pending', 'passed', 'failed', 'timed_out']);
  for (const [n, t] of [['Attempt', 'NUMBER'], ['PR', 'TEXT'], ['Head SHA', 'TEXT'], ['Blocker Reason', 'TEXT'], ['Cost', 'TEXT']]) mkfield(n, t);
  return proj; // { id, number, url }
}

export { STATUSES };
