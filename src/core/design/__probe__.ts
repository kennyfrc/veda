/**
 * Backtest probe for the program-design parser + validator.
 * Run with: bun src/core/design/__probe__.ts
 *
 * Registered prediction: the fixture below parses to a complete
 * ProgramDesign and validates ok:true. If any field is missing or
 * any invariant trips, the model is wrong — return to Model.
 */
import { parseProgramDesign, validateDesign } from './index';

const FIXTURE = `<program name="user-cache" task="add time-based eviction to the LRU cache">
  <intent>One paragraph: what this change is for and the approach.</intent>
  <layout>
    <file path="src/cache.ts" role="LRU cache + eviction"/>
    <file path="src/types.ts" role="shared types"/>
  </layout>
  <context>
    <used file="src/types.ts"/>
    <omitted file="src/api.ts" reason="unaffected by eviction"/>
  </context>
  <types>
    <type name="CacheEntry" file="src/types.ts">
      key: string; value: V; insertedAt: number;
    </type>
  </types>
  <signatures>
    <signature name="evict" file="src/cache.ts" kind="function">
      <contract>evict entries older than ttlMs, then trim to maxSize oldest-first</contract>
      <param name="cache" type="LRU"/>
      <param name="now" type="number"/>
      <returns type="number">count evicted</returns>
    </signature>
  </signatures>
  <callstacks>
    <callstack name="cache-miss">
      <step ref="evict"/>
    </callstack>
  </callstacks>
  <invariants>
    <invariant>after evict, cache.size &lt;= maxSize</invariant>
  </invariants>
</program>`;

// Wrap it in prose to mimic a real response.
const response = `Here is the design.\n\n${FIXTURE}\n\nLet me know if this works.`;

const result = parseProgramDesign(response);

if (!result.ok) {
  console.error('PARSE FAILED:', result.reason, result.detail ?? '');
  process.exit(1);
}

const { design } = result;
console.log('--- PARSED ---');
console.log('name:', design.name);
console.log('task:', design.task);
console.log('intent:', design.intent);
console.log('layout:', design.layout);
console.log('context:', design.context);
console.log('types:', design.types);
console.log('signatures:', design.signatures);
console.log('callstacks:', design.callstacks);
console.log('invariants:', design.invariants);

console.log('\n--- VALIDATION ---');
const v = validateDesign(design);
console.log('ok:', v.ok);
console.log('errors:', v.errors);
console.log('warnings:', v.warnings);

// --- assertions (the pre-registered prediction) ---
const checks: [string, boolean][] = [
  ['name == user-cache', design.name === 'user-cache'],
  ['intent set', design.intent.length > 0],
  ['layout has 2 files', design.layout.length === 2],
  ['layout[0].path == src/cache.ts', design.layout[0].path === 'src/cache.ts'],
  ['context has 2 entries', design.context.length === 2],
  ['context omitted has reason', design.context[1].reason === 'unaffected by eviction'],
  ['types has 1', design.types.length === 1],
  ['types[0].name == CacheEntry', design.types[0].name === 'CacheEntry'],
  ['signatures has 1', design.signatures.length === 1],
  ['sig[0].name == evict', design.signatures[0].name === 'evict'],
  ['sig[0] has 2 params', design.signatures[0].params.length === 2],
  ['sig[0].returns.type == number', design.signatures[0].returns?.type === 'number'],
  ['sig[0].returns.description set', design.signatures[0].returns?.description === 'count evicted'],
  ['callstacks has 1', design.callstacks.length === 1],
  ['callstack[0] has 1 step', design.callstacks[0].steps.length === 1],
  ['invariants has 1', design.invariants.length === 1],
  ['invariant has text', design.invariants[0].text.length > 0],
  ['validation ok', v.ok === true],
  ['no errors', v.errors.length === 0],
];

let failed = 0;
console.log('\n--- ASSERTIONS ---');
for (const [label, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failed++;
}

console.log(`\n${failed === 0 ? 'ALL GREEN' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
