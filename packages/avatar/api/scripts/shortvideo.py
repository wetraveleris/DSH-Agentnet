#!/usr/bin/env python3
"""shortvideo.py — 文本 → 竖版字卡短片（edge-tts 配音 + PIL 字卡 + ffmpeg 合成）。确定性，无需人工。"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, json as _json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def tool(name, env):
    return os.environ.get(env) or shutil.which(name) or str(Path(sys.executable).with_name(name))

FFMPEG = tool('ffmpeg', 'FFMPEG')
FFPROBE = tool('ffprobe', 'FFPROBE')
EDGETTS = tool('edge-tts', 'EDGE_TTS')

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]

def font(size):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            try: return ImageFont.truetype(f, size)
            except Exception: pass
    return ImageFont.load_default()

def dur(path):
    out = subprocess.run([FFPROBE,"-v","error","-show_entries","format=duration","-of","csv=p=0",path],capture_output=True,text=True).stdout.strip()
    return float(out or 0)

def wrap(draw, text, fnt, maxw):
    lines=[]; cur=""
    for ch in text:
        if draw.textlength(cur+ch, font=fnt) > maxw:
            lines.append(cur); cur=ch
        else: cur += ch
    if cur: lines.append(cur)
    return lines

def card(text, path, size, title=""):
    W,H=size
    img=Image.new("RGB",(W,H),(12,14,22))
    d=ImageDraw.Draw(img)
    # 渐变背景
    for y in range(H):
        c=int(18+30*y/H)
        d.line([(0,y),(W,y)], fill=(c, c+4, c+10))
    if title:
        d.text((80,120), title[:18], font=font(54), fill=(255,201,60))
    f=font(64); lines=wrap(d,text,f,W-160)
    total=len(lines)*86
    y=(H-total)//2
    for ln in lines:
        d.text((80,y), ln, font=f, fill=(242,245,250)); y+=86
    d.text((80,H-140),"浩哥侃球", font=font(44), fill=(154,166,188))
    img.save(path,"JPEG",quality=92)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--size", default="1080x1920")
    ap.add_argument("--voice", default="zh-CN-YunjianNeural")
    ap.add_argument("--rate", default="+8%")
    a=ap.parse_args()
    W,H=[int(x) for x in a.size.lower().split("x")]
    text=re.sub(r"\s+"," ",a.text).strip()
    sents=[s for s in re.split(r"(?<=[。！？!?；;])", text) if s.strip()] or [text]
    # 控制每句长度
    parts=[]
    for s in sents:
        while len(s) > 26:
            parts.append(s[:26]); s=s[26:]
        if s: parts.append(s)
    out=Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    tmp=Path(tempfile.mkdtemp(prefix="short-"))
    segs=[]
    for i,p in enumerate(parts[:12]):
        mp3=tmp/f"{i}.mp3"; png=tmp/f"{i}.jpg"; mp4=tmp/f"{i}.mp4"
        subprocess.run([EDGETTS,"--voice",a.voice,"--rate",a.rate,"--text",p,"--write-media",str(mp3)],check=True,capture_output=True)
        d=max(1.2,dur(mp3)+0.25)
        card(p,str(png),(W,H),a.title if i==0 else "")
        subprocess.run([FFMPEG,"-y","-v","error","-loop","1","-i",str(png),"-i",str(mp3),
                        "-t",f"{d:.2f}","-c:v","libx264","-pix_fmt","yuv420p","-r","30","-c:a","aac","-b:a","128k",
                        "-shortest",str(mp4)],check=True,capture_output=True)
        segs.append(mp4)
    lst=tmp/"list.txt"
    lst.write_text("\n".join(f"file '{s}'" for s in segs))
    subprocess.run([FFMPEG,"-y","-v","error","-f","concat","-safe","0","-i",str(lst),"-c","copy",str(out)],check=True,capture_output=True)
    info={"ok":True,"out":str(out),"duration":round(dur(out),2),"size":[W,H],"segments":len(segs)}
    print(json.dumps(info,ensure_ascii=False))

if __name__=="__main__":
    main()
