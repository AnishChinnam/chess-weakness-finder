import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js?v=20261022-overlay1';
import { fetchChesscom, fetchLichess } from './app.js?v=20261022-overlay1';
import { reviewGame, parseGame, STARTER_PGN, chances, evaluationText, feedback, principalLine, moveFromUci } from './review-core.js?v=20261022-overlay1';
import {BOARD_THEMES,LABELS,DEFAULT_APPEARANCE,loadAppearance,saveAppearance,reviewBoard} from './appearance.js?v=20261022-overlay1';

const $=id=>document.getElementById(id);
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let report=null, cursor=0, whiteBottom=true, controller=null, fetching=null, imported=[], variation=null, variationMoves=[], selected=null, variationEngine=null, variationController=null, variationRequest=0;
let beforeMode=false,appearance;
try{appearance=loadAppearance(window.localStorage);}catch{appearance={...DEFAULT_APPEARANCE};}
function selectTab(name){for(const key of ['overview','review','analysis']){$('pane-'+key).hidden=key!==name;$('tab-'+key).setAttribute('aria-selected',String(key===name));}}
const error=message=>{$('review-error').textContent=message;$('review-error').hidden=!message;};
function stopVariation(){variationRequest++;variationController?.abort();variationController=null;variationEngine?.quit();variationEngine=null;$('evaluate-variation').disabled=false;}
function busy(value){document.querySelectorAll('.import-panel button,.import-panel input,.import-panel textarea,.import-panel select').forEach(el=>el.disabled=value);}
function resetVariation(){stopVariation();variation=null;variationMoves=[];selected=null;$('variation-status').textContent='';}
function shownBoard(){return variation||new Chess(report.positions[beforeMode&&cursor>0?cursor-1:cursor].fen);}
function drawBoard(position=report.positions[cursor]){
  const board=shownBoard(), arrows=[],move=variation?null:report.moves[cursor-1];
  if(move)arrows.push({from:move.from,to:move.to,color:LABELS[move.label]?.color||'#7f9c59'});
  const best=beforeMode&&move?move.bestUci:!move?position.bestUci:null;
  if(!variation&&best)arrows.push({from:best.slice(0,2),to:best.slice(2,4),color:'#84b84d'});
  const legalSquares=selected?board.moves({verbose:true}).filter(m=>m.from===selected).map(m=>m.to):[];
  $('review-board').innerHTML=reviewBoard(board.fen(),{appearance,whiteBottom,move,selected,legal:legalSquares,arrows,before:beforeMode});
  const top=whiteBottom?'b':'w',bottom=whiteBottom?'w':'b';
  for(const [place,color] of [['top',top],['bottom',bottom]]){
    $(place+'-player').textContent=report.summary[color].name;
    $(place+'-rating').textContent=report.header[color==='w'?'WhiteElo':'BlackElo']||'';
    $(place+'-result').textContent=report.header.Result||'';
  }
  $('board-legend').innerHTML=move?`<span class="legend-dot" style="background:${LABELS[move.label]?.color}"></span><strong>${esc(move.label)}</strong><span>${esc(move.san)}${beforeMode?' · before move':''}</span>`:'<span>Initial position · choose a move or Start review</span>';
  const legal=board.game_over()?[]:board.moves({verbose:true});
  $('legal-move').innerHTML=legal.length?legal.map(m=>`<option value="${esc(m.san)}">${esc(m.san)}</option>`).join(''):'<option>No legal moves</option>';
  $('play-variation').disabled=!legal.length;$('evaluate-variation').disabled=board.game_over();
  $('variation-line').textContent=variationMoves.length?'Your variation: '+variationMoves.join(' '):'';
}
function setEval(position){$('position-eval').textContent=evaluationText(position);$('eval-white').style.height=chances(position.whiteCp)+'%';}
function graph(){
  const w=460,h=110,pad=7,n=report.positions.length-1;
  const points=report.positions.map((p,i)=>`${pad+(w-2*pad)*i/n},${pad+(h-2*pad)*(1-chances(p.whiteCp)/100)}`).join(' ');
  $('eval-graph').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Game evaluation graph"><rect width="${w}" height="${h}" fill="#0d131e" rx="5"/><line x1="0" y1="55" x2="460" y2="55" stroke="#394b60" stroke-dasharray="3 4"/><polyline points="${points}" fill="none" stroke="#5ce0c6" stroke-width="2"/><line x1="${pad+(w-2*pad)*cursor/n}" x2="${pad+(w-2*pad)*cursor/n}" y1="0" y2="110" stroke="#d8e4f5"/></svg>`;
}
function showPosition(index){
  resetVariation();beforeMode=false;$('before-move').checked=false;cursor=Math.max(0,Math.min(report.moves.length,index));const position=report.positions[cursor], move=report.moves[cursor-1];
  drawBoard();setEval(position);
  $('position-label').textContent=`Position ${cursor} / ${report.moves.length} · ${new Chess(position.fen).turn()==='w'?'White':'Black'} to move`;
  $('move-heading').textContent=move?`${move.number}${move.color==='w'?'.':'…'} ${move.san}`:'Initial position';
  $('move-class').textContent=move?.label||'Start';$('move-class').className='pill label-'+(move?.label||'good').toLowerCase();
  $('move-feedback').textContent=feedback(move);
  const linePosition=report.positions[move?cursor-1:cursor];
  const line=principalLine(linePosition.fen,linePosition.pv);
  $('line-context').textContent=move?'ENGINE ALTERNATIVE BEFORE THIS MOVE':'ENGINE CONTINUATION';
  $('show-best').textContent=move?'Compare engine line':'Play engine line';
  $('best-line').textContent=line.length?line.join(' '):position.terminal||'No continuation available from this search.';
  $('show-best').disabled=!line.length;$('move-slider').value=cursor;
  $('first-move').disabled=$('prev-move').disabled=cursor===0;
  $('last-move').disabled=$('next-move').disabled=cursor===report.moves.length;
  document.querySelectorAll('[data-ply]').forEach(b=>{const active=Number(b.dataset.ply)===cursor;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');});
  graph();
}
function render(){
  $('game-title').textContent=`${report.summary.w.name} vs ${report.summary.b.name}`;
  $('game-details').textContent=[report.header.Event,report.header.Date,report.header.Result,report.mode==='deeper'?'Deeper search':'Quick search',`${report.moves.length} half-moves`].filter(Boolean).join(' · ');
  $('player-summary').innerHTML=['w','b'].map(c=>{const s=report.summary[c];return `<article class="player-card"><h3>${c==='w'?'♔ White':'♚ Black'} · ${esc(s.name)}</h3><strong>${s.accuracy===null?'—':s.accuracy.toFixed(1)}</strong> <small>accuracy estimate / 100</small></article>`;}).join('');
  $('classification-summary').innerHTML=Object.entries(LABELS).map(([name,meta])=>`<div class="classification-row"><strong>${report.summary.w.counts[name]||0}</strong><span><i style="background:${meta.color}">${meta.symbol}</i>${name}</span><strong>${report.summary.b.counts[name]||0}</strong></div>`).join('');
  // A FEN can begin with Black to move; keep the first cell blank in that case.
  $('move-list').innerHTML=(report.moves[0].color==='b'?'<span></span>':'')+report.moves.map((m,i)=>`<button type="button" data-ply="${i+1}" aria-label="Move ${m.number} ${m.color==='w'?'White':'Black'} ${esc(m.san)}, ${m.label}"><span>${m.number}${m.color==='w'?'.':'…'} ${esc(m.san)}</span><small class="label-${m.label.toLowerCase()}">${m.label}</small></button>`).join('');
  $('move-slider').max=report.moves.length;$('review-output').hidden=false;document.body.classList.add('reviewing');selectTab('overview');showPosition(0);
  $('review-output').scrollIntoView({behavior:'smooth',block:'start'});
}
async function start(pgn){
  if(controller||fetching)return;
  error('');resetVariation();
  try{parseGame(pgn);}catch(e){error(e.message);return;}
  const run=new AbortController();controller=run;busy(true);$('review-progress').hidden=false;$('review-output').hidden=true;document.body.classList.remove('reviewing');$('review-bar').value=0;$('review-progress-text').textContent='Starting Stockfish…';
  try{
    const next=await reviewGame(pgn,{signal:run.signal,mode:$('search-mode').value,onProgress:(fraction,text)=>{if(controller!==run)return;$('review-bar').value=Math.round(fraction*100);$('review-progress-text').textContent=text+' · '+Math.round(fraction*100)+'%';}});
    if(controller!==run)return;report=next;whiteBottom=true;render();
  }catch(e){if(e.name!=='AbortError')error(e.message||'Review failed. Please retry.');}
  finally{if(controller===run){controller=null;busy(false);$('review-progress').hidden=true;}}
}
$('pgn-form').onsubmit=e=>{e.preventDefault();start($('pgn').value);};
$('load-example').onclick=()=>{$('pgn').value=STARTER_PGN;$('pgn').focus();};
$('pgn-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;error('');if(f.size>100000){error('Choose a PGN under 100 KB.');return;}$('pgn').value=await f.text();$('import-status').textContent=`Loaded ${f.name}. Choose Review this game to begin.`;};
$('recent-form').onsubmit=async e=>{
  e.preventDefault();if(fetching||controller)return;const user=$('review-user').value.trim();if(!user)return;
  error('');const run=new AbortController();fetching=run;busy(true);$('game-picker').hidden=true;$('import-status').textContent='Finding recent games…';
  try{
    const fetcher=$('review-site').value==='chesscom'?fetchChesscom:fetchLichess;
    const pgns=await fetcher(user,10,$('review-tc').value,run.signal);
    imported=pgns.map(pgn=>{try{return parseGame(pgn);}catch{return null;}}).filter(Boolean);
    if(!imported.length)throw new Error('No supported games found. Try pasting a PGN.');
    $('game-choice').innerHTML=imported.map((g,i)=>`<option value="${i}">${esc([g.header.Date,g.header.White+' vs '+g.header.Black,g.header.Result].filter(Boolean).join(' · '))}</option>`).join('');
    $('game-picker').hidden=false;$('import-status').textContent=`Found ${imported.length} games. Choose one to review.`;
  }catch(e){error(e.message||'Could not load games. Paste a PGN instead.');$('import-status').textContent='';}
  finally{fetching=null;busy(false);}
};
$('review-selected').onclick=()=>{const game=imported[Number($('game-choice').value)];if(game)start(game.pgn);};
$('review-cancel').onclick=()=>{controller?.abort();$('review-progress-text').textContent='Cancelling…';};
$('new-review').onclick=()=>{resetVariation();document.body.classList.remove('reviewing');$('review-output').hidden=true;document.querySelector('.import-panel').scrollIntoView({behavior:'smooth'});};
$('first-move').onclick=()=>showPosition(0);$('prev-move').onclick=()=>showPosition(cursor-1);$('next-move').onclick=()=>{selectTab('review');showPosition(cursor+1)};$('last-move').onclick=()=>showPosition(report.moves.length);
$('flip-board').onclick=()=>{whiteBottom=!whiteBottom;drawBoard();};
$('move-slider').oninput=e=>showPosition(Number(e.target.value));
$('move-list').onclick=e=>{const button=e.target.closest('[data-ply]');if(button){selectTab('review');showPosition(Number(button.dataset.ply));}};
$('next-mistake').onclick=()=>{const candidates=report.moves.map((m,i)=>m.loss>=5?i+1:null).filter(Boolean);const next=candidates.find(i=>i>cursor)??candidates[0];if(next!==undefined)showPosition(next);else $('move-feedback').textContent='No inaccuracies, mistakes or blunders were found in this search.';};
$('eval-graph').onclick=e=>{const bounds=$('eval-graph').getBoundingClientRect();showPosition(Math.round(Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width))*report.moves.length));};
document.addEventListener('keydown',e=>{if(!report||$('review-output').hidden||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();showPosition(cursor+(e.key==='ArrowRight'?1:-1));}});
function playMove(san){
  stopVariation();if(!variation)variation=new Chess(shownBoard().fen());selectTab('analysis');
  const move=variation.move(san);if(!move)return;variationMoves.push(move.san);selected=null;drawBoard();$('position-eval').textContent='Variation · not evaluated';$('position-label').textContent=variation.turn()==='w'?'White to move':'Black to move';$('variation-status').textContent='Choose Analyze this position for a fresh engine score.';
}
$('play-variation').onclick=()=>playMove($('legal-move').value);
$('review-board').onclick=e=>{const square=e.target.getAttribute('data-square');if(!square||!report)return;const board=shownBoard();if(selected){const matching=board.moves({verbose:true}).filter(m=>m.from===selected&&m.to===square);if(matching.length===1){playMove(matching[0].san);return;}if(matching.length>1){$('variation-status').textContent='Choose a promotion in the legal move selector, then Play move.';$('legal-move').value=matching.find(m=>m.promotion==='q').san;return;}}selected=board.get(square)?.color===board.turn()?square:null;drawBoard();};
$('reset-variation').onclick=()=>showPosition(cursor);
$('show-best').onclick=()=>{
  resetVariation();const p=report.positions[cursor>0?cursor-1:cursor];variation=new Chess(p.fen);
  for(const text of (p.pv||[]).slice(0,6)){const move=moveFromUci(variation,text);if(!move)break;variationMoves.push(move.san);}
  drawBoard();$('position-eval').textContent='Engine line · not evaluated';$('position-label').textContent=variation.turn()==='w'?'White to move':'Black to move';$('variation-status').textContent='Showing up to six half-moves of the engine alternative from before the selected move (or the initial position). Return to game to resume replay.';
};
$('evaluate-variation').onclick=async()=>{
  if(!report||variationEngine)return;const board=shownBoard();if(board.game_over())return;
  const id=++variationRequest, run=new AbortController(), engine=new Engine(run.signal);variationController=run;variationEngine=engine;$('evaluate-variation').disabled=true;$('variation-status').textContent='Evaluating this position…';
  try{await engine.init();const result=await engine.analyse(board.fen(),1000,{nodes:200000,details:true});if(id!==variationRequest)return;setEval(result);$('variation-status').textContent=`Depth ${result.depth} · Best line: ${principalLine(board.fen(),result.pv).join(' ')||'unavailable'}`;}
  catch(e){if(e.name!=='AbortError'&&id===variationRequest)$('variation-status').textContent=e.message;}
  finally{engine.quit();if(id===variationRequest){variationEngine=null;variationController=null;$('evaluate-variation').disabled=false;}}
};
$('download-review').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='chess-game-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

$('before-move').onchange=e=>{resetVariation();beforeMode=e.target.checked;drawBoard();const p=report.positions[beforeMode&&cursor>0?cursor-1:cursor];setEval(p);$('position-label').textContent=(beforeMode?'Before':'After')+' move '+cursor;};
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>selectTab(button.dataset.tab);
$('start-review').onclick=()=>{selectTab('review');showPosition(Math.min(1,report.moves.length));};
function applyAppearance(persist=false){
  document.body.dataset.surface=appearance.surface;
  $('board-theme').value=appearance.board;$('piece-theme').value=appearance.pieces;$('surface-theme').value=appearance.surface;
  for(const [key,id] of [['badges','show-badges'],['arrows','show-arrows'],['coordinates','show-coordinates'],['highlights','show-highlights']])$(id).checked=appearance[key];
  const demo=new Chess();demo.move('e4');
  $('appearance-preview').innerHTML=reviewBoard(demo.fen(),{appearance,move:{from:'e2',to:'e4',san:'e4',label:'Brilliant'},arrows:[{from:'e2',to:'e4',color:LABELS.Brilliant.color}]});
  if(report&&!$('review-output').hidden)drawBoard();
  if(persist){let saved=false;try{saved=saveAppearance(window.localStorage,appearance);}catch{}$('appearance-status').textContent=saved?'Appearance saved on this device.':'Applied for this visit. Browser storage is unavailable.';}
}
$('appearance-open').onclick=()=>$('appearance-dialog').showModal();$('appearance-close').onclick=()=>$('appearance-dialog').close();
for(const [id,key] of [['board-theme','board'],['piece-theme','pieces'],['surface-theme','surface']])$(id).onchange=e=>{appearance[key]=e.target.value;applyAppearance(true);};
for(const [id,key] of [['show-badges','badges'],['show-arrows','arrows'],['show-coordinates','coordinates'],['show-highlights','highlights']])$(id).onchange=e=>{appearance[key]=e.target.checked;applyAppearance(true);};
$('appearance-reset').onclick=()=>{appearance={...DEFAULT_APPEARANCE};applyAppearance(true);};
applyAppearance();
