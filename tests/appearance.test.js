import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from '../static/vendor/chess.js';
import {reviewBoard,normalizeAppearance,loadAppearance,saveAppearance} from '../static/appearance.js';
import {classifyMove,sacrificeCandidates} from '../static/review-core.js';
import {Engine} from '../static/engine.js';
test('appearance survives bad storage and rejects injected theme values',()=>{
  assert.equal(loadAppearance({getItem(){throw Error();}}).board,'green');
  assert.equal(normalizeAppearance({board:'<script>',badges:'false'}).board,'green');
  assert.equal(saveAppearance({setItem(){throw Error();}},{board:'ocean'}),false);
});
test('move badges sit on the destination for either orientation and disappear in variations',()=>{
  const c=new Chess();c.move('e4');const move={from:'e2',to:'e4',san:'e4',label:'Brilliant'};
  const html=reviewBoard(c.fen(),{move});
  assert.match(html,/data-move-badge="Brilliant"/);assert.match(html,/cx="194" cy="167"/);
  assert.match(reviewBoard(c.fen(),{move,whiteBottom:false}),/cx="154" cy="127"/);
  assert.doesNotMatch(reviewBoard(c.fen()),/data-move-badge/);
  assert.doesNotMatch(reviewBoard(c.fen(),{move,appearance:{badges:false}}),/data-move-badge/);
});
test('Great requires a same-depth second line, a real gap, and multiple legal choices',()=>{
  const before={whiteCp:0,bestUci:'e2e4',depth:12,variations:[{rank:2,depth:12,whiteCp:-250}]},move={from:'e2',to:'e4',color:'w',san:'e4'};
  assert.equal(classifyMove(before,{whiteCp:0},move,{legalCount:20}).label,'Great');
  assert.equal(classifyMove(before,{whiteCp:0},move,{legalCount:1}).label,'Best');
  assert.equal(classifyMove({...before,depth:13},{whiteCp:0},move,{legalCount:20}).label,'Best');
});
test('Brilliant requires separately verified sound sacrifice and excludes already winning positions',()=>{
  const move={from:'f3',to:'e5',color:'w',san:'Nxe5'},before={whiteCp:0,bestUci:'f3e5'};
  assert.equal(classifyMove(before,{whiteCp:0},move,{sacrificeVerified:true}).label,'Brilliant');
  assert.equal(classifyMove(before,{whiteCp:0},move).label,'Best');
  assert.equal(classifyMove({...before,whiteCp:800},{whiteCp:800},move,{sacrificeVerified:true}).label,'Best');
  assert.notEqual(classifyMove(before,{whiteCp:-500},move,{sacrificeVerified:true}).label,'Brilliant');
});
test('a discovered queen offer is a sacrifice candidate but equal trades and pawns are not',()=>{
  const c=new Chess();for(const m of ['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6'])c.move(m);
  const before=c.fen(),move=c.move('Nxe5');
  assert.ok(sacrificeCandidates(before,c.fen(),move).some(m=>m.san==='Bxd1'));
  const d=new Chess();const start=d.fen(),pawn=d.move('e4');assert.equal(sacrificeCandidates(start,d.fen(),pawn).length,0);
});
test('MultiPV preserves the best score and excludes a stale alternative depth',async()=>{
  const worker={postMessage(){},terminate(){}};const e=new Engine(null,{workerFactory:()=>worker});
  const p=e.analyse(new Chess().fen(),100,{details:true,multiPv:2});
  e.onMessage('info depth 10 multipv 1 score cp 25 pv e2e4 e7e5');
  e.onMessage('info depth 9 multipv 2 score cp -200 pv d2d4 d7d5');e.onMessage('bestmove e2e4');
  const result=await p;assert.equal(result.whiteCp,25);assert.equal(result.variations.length,1);e.quit();
});
