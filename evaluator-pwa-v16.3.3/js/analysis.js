/* Evaluator: analysis.js
 *
 * The four analyses (Support, Challenge, Evaluate, Verify), the exact
 * logic and arithmetic checks, and runAnalysis(), the single entry point.
 *
 * The js/ files are plain scripts loaded in order by index.html and share
 * one scope, so anything declared here is visible to the files after it.
 */
'use strict';

/* =====================================================================
 * Modes
 * ===================================================================== */
function builtinArgPrompt(statement, stance, scope) {
  const list = scope.web.map((s) => `- ${s.label} (${s.domain}) [${s.category}]`).join('\n');
  return `Statement:\n"""${statement}"""\n\nTask: build the strongest evidence-based case ${direction(stance)} this statement.\n\nTrusted websites you can search:\n${list}`;
}

/** One side's case. Returns { parsed, resolve, searches, found }. */
async function caseFor({ stance, statement, scope, cfg, route, pack, signal, progress }) {
  if (route === 'builtin') {
    const local = await localPages(scope, [statement], 6, progress);
    progress(`${PROVIDERS[cfg.provider].name} is searching for ${stance === 'support' ? 'supporting' : 'challenging'} evidence. This usually takes 30 to 90 seconds.`);
    const out = await builtinSearchCall({ cfg, system: ARG_BUILTIN_SYSTEM, user: builtinArgPrompt(statement, stance, scope) + localBlock(local), scope, signal });
    const parsed = extractJson(out.text, 'summary');
    if (!parsed) throw builtinFailure(out) || new ProviderError('The answer couldn\'t be read as a structured argument. Run it again.');
    return { parsed, resolve: builtinResolver(parsed, out.retrieved, local), searches: out.searches, found: out.retrieved.size + local.length };
  }
  if (!pack.pages.length) {
    return {
      parsed: { summary: 'None of the sources searched returned anything for this statement. Try rephrasing it, choosing another topic, or adding sources to this topic.', verdict: 'insufficient', verdictReason: 'The search found nothing to work with.', arguments: [], counterConsiderations: [], gaps: `Searched for: ${pack.queries.join('; ')}` },
      resolve: () => null, searches: 0, found: 0,
    };
  }
  progress(`Building the case ${stance === 'support' ? 'in support' : 'against'} from ${pack.pages.length} passages…`);
  const text = await chat({
    ...cfg, system: ARG_PACK_SYSTEM, json: true, signal,
    user: `Statement:\n"""${statement}"""\n\nTask: build the strongest evidence-based case ${direction(stance)} this statement, using only these sources.\n\n${packListing(pack, scopeMatcher(scope))}`,
  });
  return { parsed: parseOrThrow(text, 'summary', 'argument'), resolve: packResolver(pack), searches: 0, found: pack.pages.length };
}

async function runArgument(stance, ctx) {
  const { statement, scope, cfg, route, signal, progress, fresh } = ctx;
  const intent = cfg.searchFocus === 'own' ? stance : 'both';
  const pack = route === 'pack' ? await gatherPack({ cfg, statement, scope, signal, progress, fresh, intent }) : null;
  const out = await caseFor({ stance, statement, scope, cfg, route, pack, signal, progress });
  const cites = makeCitations(scopeMatcher(scope));
  const side = cites.argumentSide(out.parsed, out.resolve);
  return {
    version: 3, mode: stance, stance, ...side, pages: cites.pages, sites: cites.sites,
    meta: {
      searches: (pack && !pack.reused ? pack.searches : 0) + out.searches, pagesRead: pack ? pack.pages.length : out.found, dropped: cites.dropped,
      reusedEvidence: pack && pack.reused ? pack.createdAt : null, searchFocus: route === 'pack' ? intent : 'own',
    },
  };
}

/** Renders a finished side as plain text for the judge, citing S{n}. */
function sideForJudge(side) {
  const refs = (t) => String(t || '').replace(new RegExp(REF_RE.source, 'g'), (m, ns) => `[${ns.split(',').map((n) => `S${n}`).join(', ')}]`);
  const lines = [`Summary: ${refs(side.summary)}`, `Advocate's own rating of the evidence: ${side.verdict}. ${side.verdictReason}`];
  side.arguments.forEach((a, i) => {
    lines.push(`Point ${i + 1}: ${a.point}`, `Reasoning: ${refs(a.reasoning)}`);
    a.evidence.forEach((ev) => lines.push(`  Evidence [S${ev.n}] (${ev.sourceType}): ${ev.excerpt}`));
  });
  if (side.counterConsiderations.length) lines.push(`Concedes: ${side.counterConsiderations.map(refs).join(' ')}`);
  if (side.gaps) lines.push(`Gaps: ${side.gaps}`);
  return lines.join('\n');
}

async function runBalanced(ctx) {
  const { statement, scope, cfg, route, signal, progress, fresh } = ctx;
  let pack = null;
  if (route === 'pack') {
    if (!fresh) {
      pack = await mergedOwnSidePacks(statement, scope, cfg);
      if (pack) progress('Reusing the evidence gathered by your earlier Support and Challenge runs…');
    }
    if (!pack) pack = await gatherPack({ cfg, statement, scope, signal, progress, fresh, intent: 'both' });
  }
  const cites = makeCitations(scopeMatcher(scope));
  // Both cases are written at the same time from the same evidence.
  const status = { for: 'working', against: 'working' };
  const say = () => progress(`Writing both cases at once: for ${status.for}, against ${status.against}…`);
  say();
  const quiet = () => {};
  const [forOut, againstOut] = await Promise.all([
    caseFor({ stance: 'support', statement, scope, cfg, route, pack, signal, progress: quiet }).then((o) => { status.for = 'done'; say(); return o; }),
    caseFor({ stance: 'contest', statement, scope, cfg, route, pack, signal, progress: quiet }).then((o) => { status.against = 'done'; say(); return o; }),
  ]);
  const support = cites.argumentSide(forOut.parsed, forOut.resolve);
  const contest = cites.argumentSide(againstOut.parsed, againstOut.resolve);

  progress('Weighing both cases and writing the report…');
  const sourcesList = cites.pages.map((p) => `[S${p.n}] ${p.title} (${cites.sites[p.site].category === 'local' ? 'local file' : `${cites.sites[p.site].label}, ${cites.sites[p.site].category}`})`).join('\n');
  const cases = [['FOR', support], ['AGAINST', contest]];
  if (Math.random() < 0.5) cases.reverse();
  const judgeText = await chat({
    ...cfg, system: JUDGE_SYSTEM, json: true, signal,
    user: `Statement:\n"""${statement}"""\n\n${cases.map(([label, side], i) => `=== Case ${i + 1}: argues ${label} the statement ===\n${sideForJudge(side)}`).join('\n\n')}\n\n=== Sources ===\n${sourcesList || '(none)'}`,
  });
  const j = parseOrThrow(judgeText, 'assessment', 'evaluation');
  const nr = numberResolver(cites);
  const leanings = ['well supported', 'leans towards support', 'evenly balanced', 'leans against', 'not supported', 'insufficient evidence'];
  const anyEvidence = support.arguments.length || contest.arguments.length;
  const judgment = {
    assessment: cites.mark(j.assessment, nr),
    leaning: anyEvidence ? (leanings.includes(j.leaning) ? j.leaning : 'evenly balanced') : 'insufficient evidence',
    leaningReason: String(j.leaningReason || ''),
    strongestFor: (j.strongestFor || []).map((t) => cites.mark(t, nr)),
    strongestAgainst: (j.strongestAgainst || []).map((t) => cites.mark(t, nr)),
    conflicts: (j.conflicts || []).map((c) => ({ issue: String(c.issue || ''), assessment: cites.mark(c.assessment, nr), favours: ['for', 'against'].includes(c.favours) ? c.favours : 'neither' })),
    agreements: (j.agreements || []).map((t) => cites.mark(t, nr)),
    gaps: cites.unmark(j.gaps),
  };
  return {
    version: 3, mode: 'balanced', support, contest, judgment, verdict: judgment.leaning,
    pages: cites.pages, sites: cites.sites,
    meta: {
      searches: (pack && !pack.reused ? pack.searches : 0) + forOut.searches + againstOut.searches,
      pagesRead: pack ? pack.pages.length : forOut.found + againstOut.found, dropped: cites.dropped,
      reusedEvidence: pack && pack.reused ? pack.createdAt : null,
    },
  };
}

/** Runs the exact checks: truth table for the argument, recomputation for calculations. */
function appChecks(dec) {
  const out = { logic: null, calculations: [] };
  const lg = dec.logic;
  if (lg && lg.formalizable && lg.conclusion && lg.conclusion.formula) {
    const premises = (lg.premises || []).filter((p) => p && p.formula);
    try {
      const r = TracerLogic.checkArgument(premises.map((p) => p.formula), lg.conclusion.formula);
      out.logic = {
        ok: true, valid: r.valid, premisesConsistent: r.premisesConsistent, counterexample: r.counterexample,
        rows: r.rowsChecked, variables: lg.variables || {},
        premises: premises.map((p) => ({ text: String(p.text || ''), formula: String(p.formula) })),
        conclusion: { text: String(lg.conclusion.text || ''), formula: String(lg.conclusion.formula) },
      };
    } catch (err) {
      out.logic = { ok: false, error: err.message, premises: premises.map((p) => ({ text: String(p.text || ''), formula: String(p.formula) })), conclusion: lg.conclusion };
    }
  } else if (lg && lg.formalizable === false && lg.notFormalizableBecause) {
    out.logic = { ok: false, notFormalizable: true, reason: String(lg.notFormalizableBecause) };
  }
  (dec.calculations || []).forEach((c) => {
    const item = { claimId: c.claimId || '', description: String(c.description || ''), expression: String(c.expression || ''), claimed: c.claimed == null ? '' : String(c.claimed) };
    try {
      item.computed = TracerLogic.evalArithmetic(item.expression);
      Object.assign(item, TracerLogic.compareClaim(item.computed, item.claimed));
      item.ok = true;
    } catch (err) { item.ok = false; item.error = err.message; }
    out.calculations.push(item);
  });
  return out;
}

function appChecksForModel(checks) {
  const lines = [];
  if (checks.logic && checks.logic.ok) {
    const l = checks.logic;
    lines.push(`CHECKED BY THE APP (truth table, ${l.rows} rows): the argument is ${l.valid ? 'VALID' : 'INVALID'}.`);
    if (!l.valid) lines.push(`Counterexample where every premise is true and the conclusion false: ${Object.entries(l.counterexample).map(([k, v]) => `${k} = ${v}`).join(', ')}.`);
    if (!l.premisesConsistent) lines.push('The premises contradict each other, so the argument is only vacuously valid.');
  } else if (checks.logic && checks.logic.notFormalizable) {
    lines.push(`The argument could not be written in propositional logic (${checks.logic.reason}); judge its validity yourself and say so.`);
  } else if (checks.logic && !checks.logic.ok) {
    lines.push(`The app could not parse the argument's formulas (${checks.logic.error}); judge its validity yourself and say so.`);
  }
  checks.calculations.forEach((c) => {
    if (!c.ok) lines.push(`Calculation "${c.description}" could not be recomputed (${c.error}).`);
    else if (!c.comparable) lines.push(`CHECKED BY THE APP: ${c.expression} = ${c.computed}.`);
    else lines.push(`CHECKED BY THE APP: ${c.description}: ${c.expression} = ${c.computed}; the statement claims ${c.claimed}, which is ${c.matches ? (c.exact ? 'CORRECT' : 'CORRECT ONLY AFTER ROUNDING (the exact value differs slightly)') : c.looseMatch ? 'correct only if read as a percentage' : 'WRONG'}.`);
  });
  return lines.length ? lines.join('\n') : 'No exact checks applied.';
}

async function runCheck(ctx) {
  const { statement, scope, cfg, route, signal, progress, fresh } = ctx;
  progress('Breaking the statement into checkable claims…');
  const dec = parseOrThrow(await chat({ ...cfg, system: DECOMPOSE_SYSTEM, json: true, signal, user: `Statement:\n"""${statement}"""` }), 'claims', 'analysis of the statement');
  const claims = (Array.isArray(dec.claims) ? dec.claims : []).map((c, i) => ({ id: String(c.id || `C${i + 1}`), text: String(c.text || ''), kind: ['empirical', 'logical', 'mathematical', 'definitional'].includes(c.kind) ? c.kind : 'empirical' }));
  const checks = appChecks(dec);
  const needsEvidence = claims.some((c) => c.kind === 'empirical' || c.kind === 'definitional') && (scope.web.length || scope.local.length);

  const claimList = claims.map((c) => `${c.id} (${c.kind}): ${c.text}`).join('\n');
  const appText = appChecksForModel(checks);
  const cites = makeCitations(scopeMatcher(scope));
  let parsed, resolve = () => null, searches = 0, pagesRead = 0, reusedEvidence = null;

  if (needsEvidence && route === 'builtin') {
    const local = await localPages(scope, [statement, ...(dec.searchQueries || [])], 6, progress);
    progress(`${PROVIDERS[cfg.provider].name} is searching your trusted sources for evidence…`);
    const out = await builtinSearchCall({
      cfg, system: GRADE_BUILTIN_SYSTEM, scope, signal,
      user: `Statement:\n"""${statement}"""\n\nClaims:\n${claimList}\n\nExact checks:\n${appText}\n\nTrusted websites you can search:\n${scope.web.map((s) => `- ${s.label} (${s.domain})`).join('\n')}${localBlock(local)}`,
    });
    parsed = extractJson(out.text, 'claims');
    if (!parsed) throw builtinFailure(out) || new ProviderError('The check couldn\'t be read. Run it again.');
    resolve = builtinResolver(parsed, out.retrieved, local);
    searches = out.searches; pagesRead = out.retrieved.size + local.length;
  } else {
    let pack = { pages: [], ids: new Map(), found: new Map(), searches: 0, queries: [] };
    if (needsEvidence) {
      const queries = (Array.isArray(dec.searchQueries) ? dec.searchQueries.map(String) : []).filter(Boolean);
      pack = await gatherPack({ cfg, statement, queries, scope, signal, progress, fresh });
      reusedEvidence = pack.reused ? pack.createdAt : null;
    }
    progress(pack.pages.length ? `Grading the claims against ${pack.pages.length} passages…` : 'Grading the claims…');
    const text = await chat({
      ...cfg, system: GRADE_PACK_SYSTEM, json: true, signal,
      user: `Statement:\n"""${statement}"""\n\nClaims:\n${claimList}\n\nExact checks:\n${appText}\n\nSources:\n${pack.pages.length ? packListing(pack, scopeMatcher(scope)) : '(no sources were searched or none were found; grade empirical claims "unverified" unless the exact checks settle them)'}`,
    });
    parsed = parseOrThrow(text, 'claims', 'grading');
    resolve = packResolver(pack);
    searches = pack.reused ? 0 : pack.searches; pagesRead = pack.pages.length;
  }

  const verdicts = ['true', 'mostly true', 'mixed', 'mostly false', 'false', 'unverified'];
  const graded = new Map((Array.isArray(parsed.claims) ? parsed.claims : []).map((c) => [String(c.id), c]));
  const summary = cites.mark(parsed.summary, resolve);
  const outClaims = claims.map((c) => {
    const g = graded.get(c.id) || {};
    const evidence = (Array.isArray(g.evidence) ? g.evidence : []).filter((ev) => cites.usable(resolve, ev)).map((ev) => ({
      n: cites.number(cites.lookup(resolve, ev)),
      stance: ['supports', 'contradicts', 'context'].includes(ev.stance) ? ev.stance : 'context',
      studyType: String(ev.studyType || 'other'), excerpt: String(ev.excerpt || ''),
    }));
    return {
      ...c,
      verdict: verdicts.includes(g.verdict) ? g.verdict : 'unverified',
      confidence: ['high', 'medium', 'low'].includes(g.confidence) ? g.confidence : 'low',
      explanation: cites.mark(g.explanation, resolve),
      scopeNotes: cites.unmark(g.scopeNotes),
      evidence,
    };
  });
  return {
    version: 3, mode: 'check', type: String(dec.type || 'mixed'),
    verdict: verdicts.includes(parsed.verdict) ? parsed.verdict : 'unverified',
    verdictReason: String(parsed.verdictReason || ''),
    summary, claims: outClaims, checks, gaps: cites.unmark(parsed.gaps),
    pages: cites.pages, sites: cites.sites,
    meta: { searches, pagesRead, dropped: cites.dropped, reusedEvidence },
  };
}

/* =====================================================================
 * Entry point
 * ===================================================================== */
function currentScope() {
  const topicId = selectedTopicId();
  const topic = SourceStore.topic(topicId);
  return { topic, web: SourceStore.forTopic(topicId), local: LibraryStore.forTopic(topicId) };
}

async function runAnalysis({ mode, statement, signal, progress, fresh = false }) {
  const started = performance.now();
  const settings = getSettings();
  const provider = settings.provider;
  const p = PROVIDERS[provider];
  const model = (settings.models[provider] || p.defaultModel || '').trim();
  if (!siteHasKey(provider)) throw new ProviderError(`There's no ${p.name} API key yet. Add it in Settings › AI model and search.`);
  if (!model) throw new ProviderError(`No ${p.name} model is chosen. Choose one in Settings; "Load models" lists them.`);

  const scope = currentScope();
  if (!scope.web.length && !scope.local.length) {
    throw new ProviderError(scope.topic
      ? `The topic "${scope.topic.name}" has nothing switched on. Add or switch on sources or local folders for it in Settings, or choose another topic.`
      : 'No trusted sources or local folders are switched on. Enable at least one in Settings.');
  }
  // Built-in search is used only when there are websites to search; local-only scopes go straight to the model.
  const route = effectiveSearch(settings) === 'builtin' && scope.web.length ? 'builtin' : 'pack';
  if (route === 'pack' && scope.web.length && !WP.tavily) {
    throw new ProviderError('There\'s no Tavily API key yet, so your trusted websites can\'t be searched. Add it in Settings › AI model and search, or choose a topic that has only local folders.');
  }
  if (route === 'builtin' && scope.web.length > BUILTIN_DOMAIN_LIMIT[provider]) {
    throw new ProviderError(`${scope.web.length} websites are in scope, but ${p.name}'s search accepts at most ${BUILTIN_DOMAIN_LIMIT[provider]}. Choose a topic or switch some off.`);
  }

  const helper = (settings.helperModels[provider] || '').trim();
  const cfg = { provider, model, helperModel: helper && helper !== model ? helper : '', maxSearches: settings.maxSearches, searchFocus: settings.searchFocus };
  const ctx = { statement, scope, cfg, route, signal, progress, fresh };
  meter.reset();
  let result;
  if (mode === 'balanced') result = await runBalanced(ctx);
  else if (mode === 'check') result = await runCheck(ctx);
  else result = await runArgument(mode, ctx);

  result.statement = statement;
  result.createdAt = new Date().toISOString();
  result.meta = {
    ...result.meta,
    provider: p.name, model,
    search: route === 'builtin' ? `${p.name} web search` : (scope.web.length ? 'Tavily' : 'local files only'),
    topic: scope.topic ? scope.topic.name : 'All sources',
    sourcesSearched: scope.web.length, foldersSearched: scope.local.length,
    usage: meter.snapshot(),
    helperModel: cfg.helperModel || null,
    durationMs: Math.round(performance.now() - started),
  };
  return result;
}

/** Older saved traces are converted on the fly. */
function upgradeResult(r) {
  if (r.version === 3) return r;
  if (r.version === 2) return { ...r, version: 3, mode: r.stance, meta: { ...r.meta, dropped: { evidence: (r.meta && r.meta.droppedEvidence) || 0, markers: (r.meta && r.meta.droppedMarkers) || 0 } } };
  const pages = [], sites = [], byUrl = new Map();
  const args = (r.arguments || []).map((a) => ({
    point: a.point, reasoning: a.reasoning,
    evidence: (a.evidence || []).map((ev) => {
      const key = normaliseUrl(ev.url);
      if (!byUrl.has(key)) {
        let host = ev.url;
        try { host = new URL(ev.url).hostname; } catch { /* keep url */ }
        const src = ev.source || { domain: host, label: host, category: 'other' };
        let site = sites.findIndex((s) => s.domain === src.domain);
        if (site === -1) { site = sites.length; sites.push({ ...src, color: site % 8 }); }
        pages.push({ n: pages.length + 1, url: ev.url, title: ev.title, site });
        byUrl.set(key, pages.length);
      }
      return { n: byUrl.get(key), excerpt: ev.excerpt, sourceType: ev.sourceType };
    }),
  }));
  return { ...r, version: 3, mode: r.stance, arguments: args, pages, sites, meta: { ...r.meta, dropped: { evidence: (r.meta && r.meta.droppedEvidence) || 0, markers: 0 } } };
}
