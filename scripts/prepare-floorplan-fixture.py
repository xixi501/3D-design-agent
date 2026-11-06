"""Create a clearly labelled synthetic image for tool/browser tests, never real-image acceptance."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

p = json.loads(Path('fixtures/s2c-synthetic.floorplan.json').read_text())
image = Image.new('RGB', (1000, 800), 'white')
draw = ImageDraw.Draw(image)
for wall in p['walls']:
    draw.line((wall['a']['x'],wall['a']['y'],wall['b']['x'],wall['b']['y']), fill='black', width=20)
for opening in p['openings']:
    wall=next(w for w in p['walls'] if w['id']==opening['wallId'])
    import math
    dx,dy=wall['b']['x']-wall['a']['x'],wall['b']['y']-wall['a']['y']
    length=math.hypot(dx,dy)
    coords=[]
    for sign in [-1,1]:
        t=(opening['offset']+sign*opening['width']/2)/length
        coords.extend([wall['a']['x']+dx*t,wall['a']['y']+dy*t])
    draw.line(coords,fill='white',width=22)
    draw.line(coords,fill='blue' if opening['type']=='window' else 'green',width=3)
for symbol in p['symbols']:
    x,y,w,d=symbol['x'],symbol['y'],symbol['w'],symbol['d']
    if symbol['rot'] in [90,270]: w,d=d,w
    draw.rectangle((x-w/2,y-d/2,x+w/2,y+d/2),outline='brown',width=2)
    draw.text((x-w/2+4,y),symbol['id'],fill='brown')
for room in p['rooms']:
    draw.text((room['at']['x'],room['at']['y']),room['id'],fill='black')
draw.text((60,15),'SYNTHETIC TOOL FIXTURE - NOT REAL FLOORPLAN ACCEPTANCE',fill='red')
draw.text((400,30),'9000 mm (wall centreline)',fill='black')
image.save('fixtures/s2c-synthetic.png')
