// Product features stay independent of the engine and work without accounts.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}
const DRILLS = {
  hung: ['Board vision', 'Before moving, name every undefended piece for both sides. Then check checks, captures and threats.', 'https://lichess.org/training/hangingPiece'],
  missed_tactic: ['Forcing moves', 'Solve slowly. List every check and capture before choosing. Write the opponent’s best reply before revealing the answer.', 'https://lichess.org/training/mix'],
  endgame: ['Endgame fundamentals', 'Practice king activity, opposition and basic rook endings. Repeat a position from both sides until you can explain the plan.', 'https://lichess.org/practice'],
  opening: ['Opening decisions', 'Review your first mistake in the opening. Write the development or king-safety principle you missed, then replay the line.', 'https://lichess.org/study'],
  positional: ['Piece activity', 'Choose three quiet positions from your games. Identify your worst piece, the opponent’s threat and one useful improving move.', 'https://lichess.org/study'],
};
export function trainingPlan(report) {
  const key = report.weaknesses?.[0]?.key;
  const focus = DRILLS[key] || DRILLS.missed_tactic;
  const second = DRILLS[report.weaknesses?.[1]?.key] || DRILLS.endgame;
  return [
    { day: 1, title: 'Understand the pattern', task: `Review up to three flagged positions. Hide the answer, find a candidate move, then compare with the engine. Focus: ${focus[0].toLowerCase()}.`, minutes: 15 },
    { day: 2, title: focus[0], task: focus[1], url: focus[2], minutes: 15 },
    { day: 3, title: 'Practice in one slow game', task: 'Play one 10+5 game. Before each move, check the opponent’s threat. Afterward, note one decision you would change.', minutes: 30 },
    { day: 4, title: second[0], task: second[1], url: second[2], minutes: 15 },
    { day: 5, title: 'Replay without the answer', task: 'Revisit your saved mistake positions. Write a candidate move and a short continuation before looking at the engine’s suggestion.', minutes: 15 },
    { day: 6, title: 'Build a pre-move habit', task: report.time_trouble?.pct >= 40 ? 'Play one 10+5 game. Check your clock every five moves and save time for forcing positions. Avoid spending all your time in the opening.' : `Play one 10+5 game and consciously apply your ${focus[0].toLowerCase()} routine. Mark the moment you nearly forgot it.`, minutes: 30 },
    { day: 7, title: 'Recheck with new games', task: 'Analyze your latest games with the same site, time control and sample size. Compare mistakes per game, allowing for different opponents and positions. A small sample is not proof of improvement.', minutes: 15 },
  ];
}
export function renderTrainingPlan(report) {
  return `<section class="plan-section"><div class="section-heading"><div><p class="eyebrow">YOUR NEXT MOVE</p><h2>A week of focused practice</h2></div><button class="action" id="print-plan" type="button">Save / print plan</button></div><p class="section-intro">A practical routine based on this sample. 15–30 minutes a day.</p><div class="plan-grid">${trainingPlan(report).map(d=>`<article class="plan-day"><span class="day-label">DAY ${d.day} · ${d.minutes} MIN</span><h3>${escapeHtml(d.title)}</h3><p>${escapeHtml(d.task)}</p>${d.url ? `<a href="${d.url}" target="_blank" rel="noopener">Open practice →</a>` : ''}</article>`).join('')}</div></section>`;
}
export function renderCommerce(config) {
  const tip=safeUrl(config.tipUrl), shop=safeUrl(config.shop?.url);
  const sponsor=config.sponsor, sponsorUrl=safeUrl(sponsor?.url);
  let html='';
  if(shop || tip) html+=`<section class="support-panel"><div><p class="eyebrow">SUPPORT THE PROJECT</p><h2>Make your next session count.</h2><p>Analysis and your seven-day plan are free. ${shop ? 'Want a reusable practice system? Get the printable training journal.' : 'If this report helped, an optional contribution supports the project.'}</p></div><div class="support-actions">${shop ? `<a class="primary-link" data-event="Shop click" href="${shop}" target="_blank" rel="noopener">${escapeHtml(config.shop.label || 'Get the training journal')}</a>` : ''}${tip ? `<a class="action" data-event="Tip click" href="${tip}" target="_blank" rel="noopener">${escapeHtml(config.tipLabel || 'Support the project')}</a>` : ''}</div></section>`;
  if(sponsorUrl && sponsor.name) html+=`<aside class="sponsor-panel" aria-label="Sponsored placement"><span class="day-label">SPONSORED</span><div><strong>${escapeHtml(sponsor.name)}</strong><p>${escapeHtml(sponsor.description || '')}</p></div><a class="action" data-event="Sponsor click" href="${sponsorUrl}" target="_blank" rel="noopener sponsored">${escapeHtml(sponsor.label || 'Learn more')} →</a></aside>`;
  return html;
}
export function printablePlan(report) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chess practice plan — ${escapeHtml(report.username)}</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#172554}h1{font-size:32px}article{break-inside:avoid;border-top:1px solid #ccd4df;padding:12px 0}p{margin:8px 0}small{color:#536176}button{padding:10px 16px;cursor:pointer}@media print{button{display:none}body{margin:0;font-size:12px}h1{font-size:24px}}</style><button onclick="window.print()">Print / save PDF</button><h1>Your seven-day chess practice plan</h1><p>${escapeHtml(report.username)} · ${escapeHtml(report.site)} · ${report.games_analyzed} games</p><small>Focus: ${escapeHtml(report.weaknesses?.[0]?.name || 'Review and fundamentals')}. Based on a short engine sample, not a coaching assessment. ${report.demo ? 'Illustrative sample, not real player results.' : ''}</small>${trainingPlan(report).map(d=>`<article><h2>Day ${d.day}: ${escapeHtml(d.title)} <small>${d.minutes} min</small></h2><p>${escapeHtml(d.task)}</p>${d.url ? `<a href="${d.url}">Practice resource</a>`:''}<p>□ Completed &nbsp; Notes: ________________________________________</p></article>`).join('')}<p>Chess Weakness Finder · Recheck with fresh games after a week.</p></html>`;
}
const HISTORY_KEY='cwf-history-v1';
export function readHistory(storage) {
  try { const items=JSON.parse(storage.getItem(HISTORY_KEY)||'[]'); return Array.isArray(items) ? items.filter(x=>x && typeof x.username==='string' && ['lichess','chesscom'].includes(x.site) && ['blitz','rapid','both'].includes(x.timeControl) && [5,10,25,50,100].includes(x.numGames) && Number.isFinite(x.avg) && Number.isFinite(x.games) && Number.isFinite(x.at)).slice(0,5) : []; } catch { return []; }
}
export function saveHistory(storage, params, report, now=Date.now()) {
  const entry={...params, avg:report.avg_mistakes,games:report.games_analyzed,at:now};
  const list=[entry,...readHistory(storage)].slice(0,5);
  try { storage.setItem(HISTORY_KEY,JSON.stringify(list)); return true; } catch { return false; }
}
export function clearHistory(storage) { try {storage.removeItem(HISTORY_KEY);return true;}catch{return false;} }
