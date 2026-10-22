import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js?v=20261022-overlay1';

export const SEARCH = { quick: {time:250,nodes:40000}, deeper:{time:750,nodes:150000} };
export const STARTER_PGN = '[Event "Fool’s mate example"]\n[White "White"]\n[Black "Black"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
export function parseGame(pgn) {
  if (typeof pgn !== 'string' || pgn.length > 100000) throw new Error('Paste one PGN under 100 KB.');
  if ((pgn.match(/^\s*\[Event\s/gm)||[]).length > 1) throw new Error('Please import one game at a time.');
  const game = new Chess();
  if (!game.load_pgn(pgn.trim(), {sloppy:true})) throw new Error('This PGN could not be read. Export a standard chess game as PGN and try again.');
  const header = game.header();
  if (header.Variant && !['standard','chess'].includes(header.Variant.toLowerCase())) throw new Error('Game review supports standard chess only.');
  const moves = game.history({verbose:true});
  if (!moves.length || moves.length > 600) throw new Error('Import a game with 1–600 half-moves.');
  const initialFen = header.SetUp === '1' && header.FEN ? header.FEN : new Chess().fen();
  return {header,moves,initialFen,pgn};
}
export function chances(cp) { return 100 / (1 + Math.exp(-0.00368208 * Math.max(-10000,Math.min(10000,cp)))); }
export function uci(move) { return move.from+move.to+(move.promotion||''); }
export function moveFromUci(board, text) {
  if (!/^(?:[a-h][1-8]){2}[qrbn]?$/.test(text||'')) return null;
  return board.move({from:text.slice(0,2),to:text.slice(2,4),promotion:text.slice(4)||undefined});
}
export function principalLine(fen, pv=[]) {
  const board=new Chess(fen), line=[];
  for(const text of pv.slice(0,10)) { const m=moveFromUci(board,text); if(!m) break; line.push(m.san); }
  return line;
}
export function classifyMove(before, after, move, {sacrificeVerified=false, legalCount=0}={}) {
  const sign=move.color==='w'?1:-1;
  const best=uci(move)===before.bestUci;
  const loss=best?0:Math.max(0,chances(sign*before.whiteCp)-chances(sign*after.whiteCp));
  let label=best?'Best':loss>=20?'Blunder':loss>=10?'Mistake':loss>=5?'Inaccuracy':loss>=2?'Good':'Excellent';
  const alternative=before.variations?.find(v=>v.rank===2 && v.depth>=8 && v.depth===before.depth);
  const gap=alternative?chances(sign*before.whiteCp)-chances(sign*alternative.whiteCp):0;
  if(best && legalCount>1 && gap>=10 && sign*before.whiteCp<500 && sign*after.whiteCp>=-50 && !move.san.endsWith('#'))label='Great';
  if(loss<2 && sacrificeVerified && sign*before.whiteCp<300 && sign*after.whiteCp>=-50 && !move.san.endsWith('#'))label='Brilliant';
  return {label,loss,quality:100*Math.exp(-loss/20),alternativeGap:gap};
}
const VALUE={p:100,n:300,b:300,r:500,q:900,k:0};
export function sacrificeCandidates(fenBefore,fenAfter,move){
  const fields=fenBefore.split(' ');fields[1]=move.color==='w'?'b':'w';fields[3]='-';
  const before=new Chess(fields.join(' ')),after=new Chess(fenAfter);
  const previouslyCapturable=before.moves({verbose:true}).filter(m=>m.captured);
  return after.moves({verbose:true}).filter(c=>{
    if(!c.captured || VALUE[c.captured]<300)return false;
    const oldSquare=c.to===move.to?move.from:c.to;
    if(previouslyCapturable.some(m=>m.to===oldSquare && m.captured===c.captured))return false;
    const reply=new Chess(fenAfter);reply.move(c);
    const recaptures=reply.moves({verbose:true}).filter(m=>m.to===c.to && m.captured);
    const recovered=recaptures.length?VALUE[c.piece]:0;
    return VALUE[c.captured]-(VALUE[move.captured]||0)-recovered>=200;
  }).slice(0,2);
}
export function terminalScore(board) {
  return {whiteCp:board.in_checkmate()?(board.turn()==='w'?-10000:10000):0,bestUci:null,depth:0,pv:[],whiteMate:board.in_checkmate()?0:null,terminal:board.in_checkmate()?'Checkmate':'Draw'};
}
export async function reviewGame(pgn,{signal,onProgress=()=>{},mode='deeper',engineFactory=s=>new Engine(s)}={}) {
  const parsed=parseGame(pgn), board=new Chess(parsed.initialFen), search=SEARCH[mode]||SEARCH.quick;
  const engine=engineFactory(signal), positions=[], moves=[];
  const abort=()=>{if(signal?.aborted)throw new DOMException('Review cancelled','AbortError');};
  const evaluate=async()=>board.game_over()?terminalScore(board):engine.analyse(board.fen(),search.time,{nodes:search.nodes,details:true,multiPv:2});
  try {
    abort(); await engine.init(); engine.newGame();
    let before=await evaluate();
    if(!Number.isFinite(before.whiteCp))throw new Error('The engine returned no score. Please retry.');
    positions.push({fen:board.fen(),...before});
    for(let i=0;i<parsed.moves.length;i++) {
      abort(); const mv=parsed.moves[i], fenBefore=board.fen();
      const legalCount=board.moves().length;
      board.move({from:mv.from,to:mv.to,promotion:mv.promotion});
      const after=await evaluate();
      if(!Number.isFinite(after.whiteCp))throw new Error('The engine returned no score. Please retry.');
      const bestBoard=new Chess(fenBefore), bestMove=moveFromUci(bestBoard,before.bestUci);
      const base=classifyMove(before,after,mv),sign=mv.color==='w'?1:-1;
      let sacrificeVerified=false;
      if(base.loss<2 && sign*before.whiteCp<300 && sign*after.whiteCp>=-50 && !board.game_over()){
        const candidates=sacrificeCandidates(fenBefore,board.fen(),mv);
        for(const capture of candidates){
          abort(); const branch=new Chess(board.fen());branch.move(capture);
          const result=branch.game_over()?terminalScore(branch):await engine.analyse(branch.fen(),search.time,{nodes:search.nodes,details:true,multiPv:1});
          if(Number.isFinite(result.whiteCp) && sign*result.whiteCp>=-50 && chances(sign*after.whiteCp)-chances(sign*result.whiteCp)<=2)sacrificeVerified=true;
        }
      }
      moves.push({...mv,...classifyMove(before,after,mv,{sacrificeVerified,legalCount}),sacrificeVerified,number:Number(fenBefore.split(' ')[5]),fenBefore,fenAfter:board.fen(),bestUci:before.bestUci,bestSan:bestMove?.san||'—',line:principalLine(fenBefore,before.pv),beforeCp:before.whiteCp,afterCp:after.whiteCp,depth:before.depth||0});
      positions.push({fen:board.fen(),...after}); before=after;
      onProgress((i+1)/parsed.moves.length,`Reviewing move ${moves.at(-1).number}${mv.color==='w'?'.':'…'} ${mv.san}`);
    }
    abort();
    const summary={};
    for(const color of ['w','b']) {
      const own=moves.filter(m=>m.color===color), counts={};
      for(const m of own)counts[m.label]=(counts[m.label]||0)+1;
      summary[color]={name:parsed.header[color==='w'?'White':'Black']|| (color==='w'?'White':'Black'),accuracy:own.length?own.reduce((s,m)=>s+m.quality,0)/own.length:null,counts};
    }
    return {...parsed,positions,moves,summary,mode};
  } finally {engine.quit();}
}
export function evaluationText(position) {
  if(position.terminal)return position.terminal;
  if(Number.isFinite(position.whiteMate))return (position.whiteMate>0?'+':'−')+'M'+Math.abs(position.whiteMate);
  return (position.whiteCp>=0?'+':'')+(position.whiteCp/100).toFixed(2);
}
export function feedback(move) {
  if(!move)return 'Start at the initial position, then step through the game. The green arrow shows the engine’s choice for the side to move.';
  if(move.san.endsWith('#'))return `${move.san} delivers checkmate.`;
  if(move.label==='Brilliant')return `${move.san} offers material while preserving a sound position. A separate engine search checked a legal capture of the offered piece. This is an estimated sacrifice classification, not Chess.com’s label.`;
  if(move.label==='Great')return `${move.san} is the only strong choice among the two engine lines searched: the alternative loses ${move.alternativeGap.toFixed(1)} winning-chance points. This is an estimated critical-move classification.`;
  if(move.label==='Best')return `${move.san} matches Stockfish’s first choice in this search.`;
  const detail=move.loss>=5?`The estimated winning chance fell by ${move.loss.toFixed(1)} percentage points.`:'This move keeps the position close to the engine’s evaluation.';
  return `${detail} Stockfish preferred ${move.bestSan}. Replay its line to compare the continuation. Labels can change with a deeper search.`;
}
