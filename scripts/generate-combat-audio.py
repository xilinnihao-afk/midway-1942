#!/usr/bin/env python3
"""确定性离线拟音：无 API、无依赖，叠加燃烧脉冲、滤波噪声与衰减共振。"""
import json, math, pathlib, random, struct, wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/audio'
SR = 22050
RNG = random.Random(19420604)

def noise(n, smoothing=0.0):
    out, previous = [], 0.0
    for _ in range(n):
        previous = previous*smoothing + RNG.uniform(-1, 1)*(1-smoothing)
        out.append(previous)
    return out

def loop_blend(a):
    # 头尾以同一重叠窗口拼接，避免循环咔哒声；输出仍保留整数转速周期。
    length = int(SR*.12)
    for i in range(length):
        k = i/(length-1)
        a[i] = a[-length+i]*(1-k)+a[i]*k
    result = a[:-length]
    # 额外去除端点的离散跳变，使用 3ms 平滑连接，避免引擎循环点击。
    correction = result[-1]-result[0]
    for i in range(64): result[i] += correction*(1-i/64)**2
    return result

def engine():
    n = SR*6
    rough, hiss = noise(n,.87), noise(n,.25)
    data=[]
    for i in range(n):
        t=i/SR
        # 14 缸星形发动机燃烧节律，加上螺旋桨叶尖、气流和排气不均匀性。
        pulse=sum(math.sin(2*math.pi*freq*t+phase)*amp for freq,phase,amp in
                  [(35,0,.17),(70,.4,.12),(105,1,.08),(140,.8,.05),(245,0,.065),(490,.6,.022)])
        mod=.7+.15*math.sin(2*math.pi*17*t)+.15*math.sin(2*math.pi*35*t)
        data.append(math.tanh((pulse+rough[i]*mod*.9+hiss[i]*.04)*1.35))
    return loop_blend(data)

def transient(kind,duration):
    n=int(SR*duration); low=noise(n,.94); mid=noise(n,.56); high=noise(n)
    values=[]
    for i in range(n):
        t=i/SR
        if kind=='gun':
            v=high[i]*math.exp(-t*170)*1.7 + mid[i]*math.exp(-t*22)*.66
            v+=math.sin(2*math.pi*125*t)*math.exp(-t*36)*.42
            v+=high[i]*math.exp(-abs(t-.043)*130)*.15+low[i]*math.exp(-t*9)*.28
        elif kind=='cannon':
            v=high[i]*math.exp(-t*72)*1.7+mid[i]*math.exp(-t*11)*1.2
            v+=math.sin(2*math.pi*(63*t-9*t*t))*math.exp(-t*10)*.58+low[i]*math.exp(-t*3.3)*1.1
        elif kind in ['flak','explosion']:
            decay=4.8 if kind=='flak' else 2.4
            v=high[i]*math.exp(-t*50)*1.5+mid[i]*math.exp(-t*decay*2)*.8
            v+=low[i]*math.exp(-t*decay)*2+math.sin(2*math.pi*(52*t-6*t*t))*math.exp(-t*decay*2)*.55
            v+=high[i]*max(0,math.sin(t*87))**14*math.exp(-t*decay)*.1
        elif kind=='hit':
            v=high[i]*math.exp(-t*105)+sum(math.sin(2*math.pi*f*t)*math.exp(-t*d)*.22 for f,d in [(740,23),(1379,31),(2285,40)])
        elif kind=='whiz':
            envelope=math.sin(math.pi*t/duration)**3
            v=(mid[i]*1.8+math.sin(2*math.pi*(1900*t-1500*t*t))*.045)*envelope
        else: # 水柱的急促冲击以及细碎落水声。
            v=low[i]*math.exp(-t*4)*2+mid[i]*(1-math.exp(-t*35))*math.exp(-t*3)*.8+high[i]*math.exp(-t*45)*.6
        values.append(v*min(1,t*SR/8))
    return values

def save(name, values, loop=False):
    peak=max(abs(v) for v in values) or 1
    scale=.82/peak
    values=[v*scale for v in values]
    # 零结尾，避免短音源释放时产生不必要的数字点击。
    if not loop:
        for i in range(min(220,len(values))): values[-i-1]*=i/220
    data=struct.pack('<'+'h'*len(values),*(round(v*32767) for v in values))
    path=OUT/(name+'.wav')
    with wave.open(str(path),'wb') as f:
        f.setparams((1,2,SR,len(values),'NONE','not compressed')); f.writeframes(data)
    return {'path':str(path.relative_to(ROOT)),'duration':round(len(values)/SR,3),'loop':loop,'peak':round(max(abs(v) for v in values),4),'rms':round(math.sqrt(sum(v*v for v in values)/len(values)),4),'boundaryDelta':round(abs(values[0]-values[-1]),5),'source':'deterministic procedural sound design; no recording or external AI service'}

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest={'engine':save('engine',engine(),True),'wind':save('wind',loop_blend(noise(SR*4,.7)),True)}
    for key,duration in [('gun',.26),('cannon',1.15),('flak',1.25),('explosion',2.0),('hit',.32),('whiz',.29),('splash',1.5)]:
        manifest[key]=save(key,transient(key,duration))
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__': main()
