"""Deterministic source fixtures; no external model or inference service required."""
from pathlib import Path
import json, math, struct, zlib, hashlib

root = Path(__file__).resolve().parents[1]
out = root / 'fixtures'
out.mkdir(exist_ok=True)
spec = {
    'name': '演境 · 客餐厅基准', 'height': 2800, 'phase': 'renovate', 'autoElec': False,
    'look': {'style': 'real', 'palette': 'plan'},
    'walls': [
        {'a':[0,0], 'b':[9000,0], 't':200, 'bearing':True, 'openings':[{'type':'window','from':1200,'to':3300,'sill':900}]},
        {'a':[9000,0], 'b':[9000,6000], 't':200, 'bearing':True},
        {'a':[9000,6000], 'b':[0,6000], 't':200, 'bearing':True, 'openings':[{'type':'door','from':400,'to':1300,'into':[1000,5000]}]},
        {'a':[0,6000], 'b':[0,0], 't':200, 'bearing':True},
    ],
    'rooms':[{'at':[4500,3000], 'name':'客餐厅', 'mat':'oak', 'wallMat':'latexWhite', 'ceil':{'type':'none'}}],
    'furniture':[
        {'key':'sofa','at':[2200,900]}, {'key':'coffeeTable','at':[2200,2400]},
        {'key':'tvCabinet','at':[2200,4800],'rot':180},
        {'key':'diningTable','at':[6500,2400]},
        {'key':'chair','at':[6100,1600]}, {'key':'chair','at':[7000,1600]},
        {'key':'chair','at':[6100,3200],'rot':180}, {'key':'chair','at':[7000,3200],'rot':180},
        {'key':'armchair','at':[6800,4900],'rot':180}, {'key':'floorLamp','at':[7900,4900]},
        {'key':'cabTall','at':[400,3600],'rot':90,'w':1500,'d':400,'h':2100},
        {'key':'freeBox','at':[4500,4900],'w':800,'d':500,'h':350}
    ]
}
(out/'living-dining.spec.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')

# Small textured lathed vase, right-handed glTF metres with Y up.
profile=[(.11,0),(.15,.04),(.16,.16),(.13,.30),(.075,.37),(.085,.40)]
verts=[]; normals=[]; uvs=[]; indices=[]; seg=24
for j,(r,y) in enumerate(profile):
    for i in range(seg+1):
        a=2*math.pi*i/seg
        verts.extend([r*math.cos(a),y,r*math.sin(a)])
        normals.extend([math.cos(a),0,math.sin(a)])
        uvs.extend([i/seg,j/(len(profile)-1)])
for j in range(len(profile)-1):
    for i in range(seg):
        a=j*(seg+1)+i;b=a+seg+1
        indices.extend([a,b,a+1,a+1,b,b+1])
def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes([0,32,110,145,220,175,90,0,220,175,90,32,110,145])))+chunk(b'IEND',b'')
payload=bytearray();views=[]
for data,target in [(struct.pack('<%sf'%len(verts),*verts),34962),(struct.pack('<%sf'%len(normals),*normals),34962),(struct.pack('<%sf'%len(uvs),*uvs),34962),(struct.pack('<%sH'%len(indices),*indices),34963),(png,None)]:
    while len(payload)%4:payload.append(0)
    v={'buffer':0,'byteOffset':len(payload),'byteLength':len(data)}
    if target:v['target']=target
    views.append(v);payload.extend(data)
gltf={'asset':{'version':'2.0','generator':'ActiScape deterministic acceptance fixture'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],
      'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':0}]}],
      'materials':[{'name':'blue-gold-checker','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':.55},'doubleSided':True}],
      'textures':[{'source':0}],'images':[{'bufferView':4,'mimeType':'image/png'}],
      'accessors':[{'bufferView':0,'componentType':5126,'count':len(verts)//3,'type':'VEC3','min':[-.16,0,-.16],'max':[.16,.4,.16]},
                   {'bufferView':1,'componentType':5126,'count':len(normals)//3,'type':'VEC3'},
                   {'bufferView':2,'componentType':5126,'count':len(uvs)//2,'type':'VEC2'},
                   {'bufferView':3,'componentType':5123,'count':len(indices),'type':'SCALAR'}],
      'bufferViews':views,'buffers':[{'byteLength':len(payload)}]}
js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*(-len(js)%4);payload+=b'\0'*(-len(payload)%4)
glb=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(payload))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(payload),0x004e4942)+payload
(out/'textured-vase.glb').write_bytes(glb)
(out/'textured-vase.metadata.json').write_text(json.dumps({'sha256':hashlib.sha256(glb).hexdigest(),'dimensionsMm':{'w':320,'d':320,'h':400},'up':'Y','unit':'metre','embeddedTextures':True,'draco':False},indent=2)+'\n')
print('Prepared living/dining HouseSpec and a textured 320 × 320 × 400 mm GLB.')
