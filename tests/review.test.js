import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from '../static/vendor/chess.js';
import {parseGame,reviewGame,classifyMove,principalLine,STARTER_PGN,evaluationText} from '../static/review-core.js';
import {Engine} from '../static/engine.js';

test('PGN import rejects invalid, empty, oversized and multiple games',()=>{
  for(const pgn of ['not a game','[White "x"]','x'.repeat(100001),STARTER_PGN+'\n'+STARTER_PGN])assert.throws(()=>parseGame(pgn));
  assert.equal(parseGame(STARTER_PGN).moves.length,4);
});
test('move scoring uses the mover perspective and protects engine choices',()=>{
  const move={from:'a2',to:'a3',color:'w'};
  assert.equal(classifyMove({whiteCp:0,bestUci:'b2b3'},{whiteCp:-700},move).label,'Blunder');
  assert.equal(classifyMove({whiteCp:0,bestUci:'b7b6'},{whiteCp:700},{...move,from:'a7',to:'a6',color:'b'}).label,'Blunder');
  assert.equal(classifyMove({whiteCp:0,bestUci:'a2a3'},{whiteCp:-700},move).label,'Best');
  assert.equal(classifyMove({whiteCp:800,bestUci:null},{whiteCp:700},move).label,'Good');
});
test('principal variation converts only legal UCI moves to SAN including promotion',()=>{
  assert.deepEqual(principalLine(new Chess().fen(),['e2e4','e7e5','e1e8','g1f3']),['e4','e5']);
  assert.deepEqual(principalLine('7k/P7/8/8/8/8/8/7K w - - 0 1',['a7a8q']),['a8=Q+']);
});
test('review evaluates both players, handles mate locally, and always stops the engine',async()=>{
  let calls=0,quit=0;
  const evals=[{whiteCp:0,bestUci:'e2e4'},{whiteCp:-100,bestUci:'e7e5'},{whiteCp:-80,bestUci:'g2g3'},{whiteCp:-9999,bestUci:'d8h4'}];
  const result=await reviewGame(STARTER_PGN,{engineFactory:()=>({init:async()=>{},newGame(){},analyse:async()=>({...evals[calls++],pv:[],depth:8}),quit(){quit++;}})});
  assert.equal(calls,4);assert.equal(quit,1);assert.equal(result.positions.length,5);
  assert.equal(result.positions.at(-1).terminal,'Checkmate');assert.equal(result.moves.at(-1).label,'Best');
  assert.equal(result.moves[2].label,'Blunder');assert.ok(result.summary.w.accuracy<result.summary.b.accuracy);
  assert.equal(evaluationText(result.positions.at(-1)),'Checkmate');
});
test('custom FEN with Black to move preserves full move numbers',async()=>{
  const result=await reviewGame('[SetUp "1"]\n[FEN "7k/8/8/8/8/8/6r1/7K b - - 0 37"]\n\n37... Rg1+ *',{engineFactory:()=>({init:async()=>{},newGame(){},analyse:async()=>({whiteCp:-500,bestUci:null}),quit(){}})});
  assert.equal(result.moves[0].color,'b');assert.equal(result.moves[0].number,37);assert.equal(result.summary.w.accuracy,null);
});
test('review cancellation and engine failures never produce partial reports and clean up',async()=>{
  let quit=0;const controller=new AbortController();
  const engineFactory=()=>({init:async()=>{},newGame(){},analyse:async()=>{controller.abort();return {whiteCp:0,bestUci:null};},quit(){quit++;}});
  await assert.rejects(reviewGame(STARTER_PGN,{engineFactory,signal:controller.signal}),{name:'AbortError'});assert.equal(quit,1);
  await assert.rejects(reviewGame(STARTER_PGN,{engineFactory:()=>({init:async()=>{throw new Error('worker failed');},quit(){quit++;}})}),/worker failed/);assert.equal(quit,2);
});
test('review rejects absent engine scores',async()=>{
  await assert.rejects(reviewGame(STARTER_PGN,{engineFactory:()=>({init:async()=>{},newGame(){},analyse:async()=>({whiteCp:NaN}),quit(){}})}),/no score/);
});
test('detailed engine scores retain PV, depth and mate sign without accepting bound scores',async()=>{
  const worker={postMessage(){},terminate(){}};const engine=new Engine(null,{workerFactory:()=>worker});
  const search=engine.analyse(new Chess().fen(),250,{nodes:40000,details:true});
  engine.onMessage('info depth 12 score cp 40 pv e2e4 e7e5');
  engine.onMessage('info depth 14 score cp 90 lowerbound pv d2d4');
  engine.onMessage('bestmove e2e4');
  assert.deepEqual(await search,{whiteCp:40,bestUci:'e2e4',depth:12,pv:['e2e4','e7e5'],whiteMate:null});engine.quit();
});
