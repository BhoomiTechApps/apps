/* Checks community list files and writes index.json for a catalogue.
 *
 *   node community/validate.mjs [folder] [base-url]
 *
 * folder:   where the list files are (default: this folder)
 * base-url: the https:// address the folder is published at; each entry in
 *           index.json then gets its full address. Leave it out for lists
 *           published next to index.json (addresses relative to it).
 *
 * Exits with an error, and writes nothing, if any list has a problem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.argv[2] || path.dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[3] || '').replace(/\/+$/, '');
const CATEGORIES = ['primary', 'academic', 'reference', 'archive', 'journalism', 'other'];
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}(\/[A-Za-z0-9._~%\-/]*)?$/;
const problems = [];
const entries = [];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json').sort()) {
  const say = (m) => problems.push(`${f}: ${m}`);
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { say(`not valid JSON (${e.message})`); continue; }
  if (d.kind !== 'evaluator-list' || d.v !== 1) say('"kind" must be "evaluator-list" and "v" must be 1');
  if (!/^[a-z0-9-]{3,64}$/.test(d.id || '')) say('"id" must be 3-64 lowercase letters, digits or hyphens');
  if (`${d.id}.json` !== f) say(`file name should be ${d.id}.json`);
  if (!d.name || String(d.name).length > 60) say('"name" is needed (60 characters at most)');
  if (!d.description || String(d.description).length > 400) say('"description" is needed (400 characters at most)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.updated || '')) say('"updated" must be a date like 2026-10-26');
  if (!d.topic || !d.topic.name) say('"topic.name" is needed');
  if (!Array.isArray(d.sources) || !d.sources.length || d.sources.length > 60) say('"sources" must list 1 to 60 websites');
  const seen = new Set();
  (d.sources || []).forEach((s, i) => {
    if (!DOMAIN.test(s.domain || '')) say(`source ${i + 1}: "${s.domain}" isn't a domain like britannica.com or archive.org/details`);
    if (seen.has(s.domain)) say(`source ${i + 1}: ${s.domain} is listed twice`);
    seen.add(s.domain);
    if (!CATEGORIES.includes(s.category)) say(`source ${i + 1}: "category" must be one of ${CATEGORIES.join(', ')}`);
    if (!s.label) say(`source ${i + 1}: "label" is needed`);
  });
  entries.push({ id: d.id, name: d.name, description: d.description, author: d.author || '', language: d.language || '', updated: d.updated, count: (d.sources || []).length, url: base ? `${base}/${f}` : f });
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const index = { kind: 'evaluator-list-index', v: 1, name: process.env.CATALOGUE_NAME || 'Evaluator community lists', updated: new Date().toISOString().slice(0, 10), lists: entries };
fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`${entries.length} list(s) OK; wrote ${path.join(dir, 'index.json')}`);
