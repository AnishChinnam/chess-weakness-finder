from pathlib import Path
from textwrap import wrap
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
file = OUT / 'Chess-Practice-Journal.pdf'
c = Canvas(str(file), pagesize=(612, 792))
c.setTitle('The 14-Day Chess Practice Journal')
c.setAuthor('Chess Weakness Finder')
INK=HexColor('#172554'); MUTED=HexColor('#586575'); LINE=HexColor('#D5DEE5'); ACCENT=HexColor('#167D70')
page=0
def new(title, subtitle=''):
    global page
    page+=1
    c.setFillColor(ACCENT);c.setFont('Helvetica-Bold',9);c.drawString(48,746,'CHESS WEAKNESS FINDER / PRACTICE JOURNAL')
    c.setFillColor(INK);c.setFont('Helvetica-Bold',25);c.drawString(48,700,title)
    c.setFillColor(MUTED);c.setFont('Helvetica',10);c.drawString(48,675,subtitle)
    c.setStrokeColor(LINE);c.line(48,657,564,657)
    c.setFont('Helvetica',9);c.drawString(48,32,'Personal use. Print again for your next training cycle.');c.drawRightString(564,32,str(page))
def para(text,y,width=89,size=11):
    c.setFillColor(INK);c.setFont('Helvetica',size)
    for line in wrap(text,width):c.drawString(48,y,line);y-=17
    return y-10
def label(text,y):
    c.setFillColor(ACCENT);c.setFont('Helvetica-Bold',10);c.drawString(48,y,text.upper())
def lines(y,n=3):
    c.setStrokeColor(LINE)
    for i in range(n):c.line(48,y-i*25,564,y-i*25)
def finish():c.showPage()
new('The 14-Day Chess Practice Journal','A reusable system for reviewing decisions and practicing one weakness at a time.')
y=para('A game review is useful when it changes your next decision. This journal helps you pick one recurring pattern, test a small habit, and reflect on what happened. Use any analysis tool or a physical board.',620)
for title,text in [('1. Find your focus','Review five recent games with the same time control. Choose one recurring mistake you can describe in plain language. Keep the original games or your exported report.'),('2. Practice deliberately','Spend 15 minutes on the daily task. On play days, allow up to 30 minutes for a 10+5 game. Write your reasoning before checking an engine.'),('3. Recheck thoughtfully','At each weekly review, use a fresh sample with the same settings. Different opponents and positions affect the result. A short sample cannot establish a rating gain.')]:
    label(title,y);y=para(text,y-24)-12
label('YOUR COMMITMENT',y);para('I will practice at __________ on __________ days. My pre-move habit is:',y-26);lines(y-85,3)
finish()
new('Your starting point','Fill this out once before Day 1. Reuse a blank copy for another cycle.')
for text,y in [('Username / site / time control',617),('Date / sample size / mistakes per game',535),('My main pattern, in one sentence',453),('A position or game link that shows it',346),('My pre-move habit: a specific action I can repeat',239),('How I will notice that I used the habit',132)]:label(text,y);lines(y-25,2)
finish()
tasks=[
('Find the moment','Review up to three flagged positions. For each, explain what changed after your move. Describe the threat or piece you overlooked.'),
('Train board vision','Use five positions from your games. Name undefended pieces for both sides. Check checks, captures and threats before selecting a move.'),
('Test the habit','Play one 10+5 game. Before every move, check the opponent\'s threat. Mark one moment when the routine helped or when you forgot it.'),
('Calculate before moving','Choose five tactics positions. Write a candidate and the opponent\'s strongest reply. Check the answer only after committing to a line.'),
('Revisit the opening','Review the first difficult decision in two games. Write a development, center-control or king-safety principle and explain a better plan.'),
('Play with a clock plan','Play one 10+5 game. Check your clock every five moves. Note where you spent time and whether the position justified it.'),
('Review the first week','Analyze a fresh sample with the same settings. Complete the Week 1 review. Keep the habit that was useful and choose one adjustment.'),
('Return to the pattern','Revisit a Day 1 position without the answer. Write a move and continuation, then compare. Explain any change in your reasoning.'),
('Practice an ending','Choose a basic king-and-pawn or rook ending. Play it from both sides. Write the key idea, not a memorized move sequence.'),
('Test under pressure','Play one 10+5 game. Apply the same habit even when the move looks obvious. Record one decision before checking the engine.'),
('Find your worst piece','Choose three quiet middlegame positions. Identify your worst piece, the opponent\'s threat and a useful improving move.'),
('Explain a tactical miss','Review a missed tactic from your games or a puzzle. Write why the move works and the defensive resource you nearly missed.'),
('Play one careful game','Play one 10+5 game. Focus on the habit you selected rather than the result. Record one successful decision and one unresolved question.'),
('Choose the next cycle','Review fresh games with the same settings. Complete the Week 2 review. Keep one habit and select the next recurring pattern to practice.')]
for day,(title,task) in enumerate(tasks,1):
    new(f'Day {day}: {title}','Date: __________________    Minutes practiced: ______    Completed: [ ]')
    label('TODAY\'S TASK',618);para(task,593)
    for text,y,n in [('Position / game link / move number',493,2),('My candidate and the opponent\'s best reply',402,3),('What I learned after checking',285,3),('One thing to remember next game',167,3)]:label(text,y);lines(y-24,n)
    finish()
for week in (1,2):
    new(f'Week {week}: reflect and adjust','Compare similar settings. Look at decisions as well as counts.')
    for text,y,n in [('New sample: date / games / time control / mistakes per game',618,2),('The pattern I noticed most often',526,2),('Evidence that I used my habit (give a move or position)',434,3),('What still confused me',317,3),('My next habit and practice task',200,3)]:label(text,y);lines(y-24,n)
    finish()
new('Your reusable review checklist','Keep this page beside your board. Duplicate a daily page for extra sessions.')
checks=[('Before checking the engine','What did I think the opponent threatened? Which checks, captures and threats did I consider? What response did I expect?'),('After checking the engine','What concrete detail did I miss? Can I explain the suggested move in words? Was the mistake tactical, strategic, or time-related?'),('Before the next game','What single action will I repeat? Can I phrase it as something I will do before moving?'),('At the next check-in','Are the time control and sample size comparable? Which positions support my conclusion? What should I practice next?')]
y=616
for title,text in checks:label(title,y);y=para(text,y-26)-25
para('Optional free resources: lichess.org/training for tactics and lichess.org/practice for endgames. This journal is independent of Lichess and Chess.com. It is a self-guided worksheet, not a puzzle collection or a promise of improvement.',y-5,size=10)
finish();c.save()
reader=PdfReader(str(file));assert len(reader.pages)==19
assert all(len(p.extract_text() or '')>100 for p in reader.pages)
print(f'Created {file} ({len(reader.pages)} pages)')
