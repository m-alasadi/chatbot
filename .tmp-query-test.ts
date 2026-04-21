import { understandQuery } from './lib/server/query-understanding.ts';
import { isOutOfScopeQuery } from './lib/server/runtime/query-scope-policy.ts';
const tests = ['ما عاصمة فرنسا','آخر الأخبار','من هو المتولي الشرعي','هل لدى العتبة العباسية مزارع','اشرح نظرية النسبية'];
for (const q of tests) {
  const u = understandQuery(q);
  console.log(JSON.stringify({ q, op: u.operation_intent, sources: u.hinted_sources, out: isOutOfScopeQuery(q, u) }));
}
