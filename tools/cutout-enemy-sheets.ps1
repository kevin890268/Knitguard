param([string]$Root, [string]$Only = '', [switch]$NoSprites)
# Enemy evolution sheets (4 tiers x N views, title banners on the left, angle labels on top):
# 1) background -> transparent (most sheets already are; -flood ones have an opaque light background)
# 2) drop the label column / header row: every blob whose centre is left of LabelX or above HeaderY
# 3) grid by k-means row/column centres; every blob goes WHOLE to the nearest cell (no straight cuts through
#    wings); only blobs where two characters touch are split at the emptiest row/column -> views/v_1..N
# 4) copy the views to public/sprites/<id>_<tier>/<direction>.png using the column -> direction map
#    (directions are named by where the face points ON SCREEN; the sheets' "right" side faces screen-left)
# Column map: one entry per column, '' = not used (top-down view etc).
$STD = ',front,frontLeft45,sideLeft,back,back45,side,front45'   # 俯角45 正面 右前 右側 背面 左後 左側 左前
$jobs = @(
  # folder, sprite id, cols per row, LabelX, HeaderY, flood(1/0), column map, [ClipX, ClipY: hard-clear everything left of / above], [Erase: 'x,y,w,h;...' rectangles to clear, e.g. title labels]
  @('goblin','goblin',8,215,70,0,$STD),
  @('vampire-girl','vamp_girl',8,215,70,0,$STD),
  @('bat','bat',8,215,115,0,$STD),
  @('vampire','vampire',8,215,70,0,$STD),
  @('earth-giant','earth_giant',8,215,70,0,$STD),
  @('evil-treant','evil_treant',8,215,70,0,$STD),
  @('evil-treant-2','evil_treant2',8,215,70,1,$STD),
  @('dryad','dryad',8,215,70,0,$STD),
  @('evil-bull','evil_bull',8,215,70,0,$STD),
  @('evil-pig','evil_pig',8,215,70,0,$STD),
  @('imp','imp',7,120,0,0,'front,frontLeft45,sideLeft,back,,,front45',0,0,'0,80,156,95;0,310,156,100;0,535,156,105;0,810,156,110'),
  @('imp-2','imp2',7,0,0,0,'front,frontLeft45,sideLeft,back,,,front45'),
  @('fireling','fireling',8,215,70,0,$STD),
  @('fire-giant','fire_giant',8,215,70,0,$STD),
  @('yeti','yeti',8,215,70,1,$STD),
  @('slime','slime',8,215,70,0,$STD)
)
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'SheetPrep').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class SheetPrep {
  public static string Run(string sheet, string prefix, int labelX, int headerY, bool flood, int cols, int rows, int clipX, int clipY, int[] erase){
    var S0=new Bitmap(sheet); int W=S0.Width, H=S0.Height; var S=new Bitmap(W,H,PixelFormat.Format32bppArgb);
    using(var g=Graphics.FromImage(S)) g.DrawImage(S0,0,0,W,H); S0.Dispose();
    var bd=S.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); S.UnlockBits(bd); S.Dispose();
    if(flood){ // light, low-saturation background connected to the edges -> transparent; neighbours must also be close in colour
      Func<int,bool> light = i => { int p=px[i]; int a=(p>>24)&255, r=(p>>16)&255, gg=(p>>8)&255, b=p&255; int mx=Math.Max(r,Math.Max(gg,b)), mn=Math.Min(r,Math.Min(gg,b)); return a<70 || (mx>200 && mx-mn<30); };
      var seen=new bool[W*H]; var st=new Stack<int>();
      for(int x=0;x<W;x++){ st.Push(x); st.Push((H-1)*W+x); } for(int y=0;y<H;y++){ st.Push(y*W); st.Push(y*W+W-1); }
      while(st.Count>0){ int i=st.Pop(); if(seen[i]||!light(i)) continue; seen[i]=true; int x=i%W,y=i/W;
        if(x>0) st.Push(i-1); if(x<W-1) st.Push(i+1); if(y>0) st.Push(i-W); if(y<H-1) st.Push(i+W); }
      for(int i=0;i<W*H;i++) if(seen[i]) px[i]=0; }
    for(int i=0;i<W*H;i++) if(i%W<clipX || i/W<clipY) px[i]=0;
    for(int e=0;e+3<erase.Length;e+=4) for(int y=Math.Max(0,erase[e+1]);y<Math.Min(H,erase[e+1]+erase[e+3]);y++) for(int x=Math.Max(0,erase[e]);x<Math.Min(W,erase[e]+erase[e+2]);x++) px[y*W+x]=0;
    // blobs (8-neighbour, alpha >= 70); remove those centred in the label column / header row
    var lab=new int[W*H]; var st2=new Stack<int>(); int removed=0, id=0;
    for(int i0=0;i0<W*H;i0++){ if(lab[i0]!=0 || ((px[i0]>>24)&255)<70) continue; id++; var list=new List<int>(); lab[i0]=id; st2.Push(i0);
      int x0=W,y0=H,x1=0,y1=0;
      while(st2.Count>0){ int i=st2.Pop(); list.Add(i); int x=i%W,y=i/W; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H) continue; int j=ny*W+nx; if(lab[j]==0 && ((px[j]>>24)&255)>=70){ lab[j]=id; st2.Push(j);} } }
      int cx=(x0+x1)/2, cy=(y0+y1)/2;
      if(cx<labelX || cy<headerY || list.Count<40){ foreach(int i in list) px[i]=0; removed++; } }
    // also clear faint pixels left in the label column / header
    for(int i=0;i<W*H;i++){ int x=i%W,y=i/W; if(((px[i]>>24)&255)<70 && (x<labelX||y<headerY)) px[i]=0; }
    // halo cleanup like split-grid: faint pixels and reddish semi-transparent edge pixels
    for(int i=0;i<W*H;i++){ int p=px[i]; int a=(p>>24)&255, r=(p>>16)&255, gg=(p>>8)&255, b=p&255;
      if(a<70){ px[i]=0; continue; } if(a<250 && r>90 && gg<r*0.45 && b<r*0.45) px[i]=0; }
    // grid: row / column centres by 1-D k-means on the foreground histogram, cells cut at the midpoints
    var colH=new double[W]; var rowH=new double[H];
    for(int i=0;i<W*H;i++) if(((px[i]>>24)&255)>=70){ colH[i%W]++; rowH[i/W]++; }
    double[] cc=KMeans(colH,cols), rc=KMeans(rowH,rows);
    // Whole-sheet blobs. Each blob goes, uncut, to the cell nearest its centre. Only a blob whose box holds
    // two cell centres (two characters touching) is split, pixel by pixel, at the seams = emptiest row / column
    // between neighbouring centres. So wings / horns reaching over the halfway line are kept.
    Func<int,bool> on = i => ((px[i]>>24)&255)>=70;
    var rowSeam=new int[rows-1];
    for(int r=0;r+1<rows;r++){ int a=(int)(rc[r]+(rc[r+1]-rc[r])*0.2), b=(int)(rc[r]+(rc[r+1]-rc[r])*0.8), best=a; for(int y=a;y<=b;y++) if(rowH[y]<rowH[best]) best=y; rowSeam[r]=best; }
    var colSeam=new int[rows,cols-1];
    for(int r=0;r<rows;r++){ int y0=r==0?0:rowSeam[r-1], y1=r==rows-1?H-1:rowSeam[r]; var ch=new double[W];
      for(int y=y0;y<=y1;y++) for(int x=0;x<W;x++) if(on(y*W+x)) ch[x]++;
      for(int c=0;c+1<cols;c++){ int a=(int)(cc[c]+(cc[c+1]-cc[c])*0.2), b=(int)(cc[c]+(cc[c+1]-cc[c])*0.8), best=a; for(int x=a;x<=b;x++) if(ch[x]<ch[best]) best=x; colSeam[r,c]=best; } }
    Func<double[],double,int> nearest=(cs,v)=>{ int best=0; for(int i=1;i<cs.Length;i++) if(Math.Abs(v-cs[i])<Math.Abs(v-cs[best])) best=i; return best; };
    Func<double[],int,int,int> inside=(cs,lo,hi)=>{ int n=0; foreach(var c0 in cs) if(c0>lo&&c0<hi) n++; return n; };
    var cell=new int[W*H]; for(int i=0;i<W*H;i++) cell[i]=-1;
    var vis=new bool[W*H]; var st3=new Stack<int>(); int merged=0;
    for(int i0=0;i0<W*H;i0++){ if(vis[i0]||!on(i0)) continue; var list=new List<int>(); vis[i0]=true; st3.Push(i0);
      int x0=W,y0=H,x1=-1,y1=-1; long sx=0,sy=0;
      while(st3.Count>0){ int i=st3.Pop(); list.Add(i); int x=i%W,y=i/W; sx+=x; sy+=y; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H) continue; int j=ny*W+nx; if(!vis[j]&&on(j)){ vis[j]=true; st3.Push(j);} } }
      if(list.Count<30) continue; // dust
      bool split = inside(cc,x0,x1)>1 || inside(rc,y0,y1)>1;
      if(!split){ int c=nearest(rc,(double)sy/list.Count)*cols+nearest(cc,(double)sx/list.Count); foreach(int i in list) cell[i]=c; continue; }
      merged++;
      foreach(int i in list){ int x=i%W,y=i/W, r=0; while(r<rows-1&&y>rowSeam[r]) r++; int c=0; while(c<cols-1&&x>colSeam[r,c]) c++; cell[i]=r*cols+c; } }
    var bx=new int[rows*cols,4]; for(int c=0;c<rows*cols;c++){ bx[c,0]=W; bx[c,1]=H; bx[c,2]=-1; bx[c,3]=-1; }
    for(int i=0;i<W*H;i++){ int c=cell[i]; if(c<0) continue; int x=i%W,y=i/W; if(x<bx[c,0])bx[c,0]=x; if(y<bx[c,1])bx[c,1]=y; if(x>bx[c,2])bx[c,2]=x; if(y>bx[c,3])bx[c,3]=y; }
    var outs=new List<string>();
    for(int c=0;c<rows*cols;c++){
      if(bx[c,2]<0){ outs.Add("empty"); continue; }
      int OX=bx[c,0], OY=bx[c,1], OW=bx[c,2]-OX+1, OH=bx[c,3]-OY+1; var o=new int[OW*OH];
      for(int y=0;y<OH;y++) for(int x=0;x<OW;x++){ int i=(y+OY)*W+x+OX; if(cell[i]==c) o[y*OW+x]=px[i]; }
      var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); B.UnlockBits(ob);
      B.Save(prefix+"_"+(c+1)+".png",ImageFormat.Png); B.Dispose(); outs.Add(OW+"x"+OH); }
    removed = removed*1000+merged; 
    return "labels removed "+(removed/1000)+", touching blobs split "+(removed%1000)+" | "+String.Join(" ",outs);
  }
  static double[] KMeans(double[] h, int n){
    int L=0; while(L<h.Length-1&&h[L]<1) L++; int R=h.Length-1; while(R>0&&h[R]<1) R--;
    var c=new double[n]; for(int i=0;i<n;i++) c[i]=L+(R-L)*(i+0.5)/n;
    for(int it=0;it<50;it++){ var sw=new double[n]; var sx=new double[n];
      for(int x=L;x<=R;x++){ if(h[x]<=0) continue; int best=0; for(int i=1;i<n;i++) if(Math.Abs(x-c[i])<Math.Abs(x-c[best])) best=i; sw[best]+=h[x]; sx[best]+=h[x]*x; }
      for(int i=0;i<n;i++) if(sw[i]>0) c[i]=sx[i]/sw[i]; }
    return c;
  }
}
"@
}
foreach ($j in $jobs) {
  if ($Only -and $j[0] -ne $Only) { continue }
  $dir = Join-Path $Root "art-src\enemies\$($j[0])"
  $sheet = (Get-ChildItem -File $dir -Filter *.png | Select-Object -First 1).FullName
  $views = Join-Path $dir 'views'; New-Item -ItemType Directory -Force $views | Out-Null
  Get-ChildItem $views -Filter 'v_*.png' -ErrorAction SilentlyContinue | Remove-Item
  $n = $j[2]
  "$($j[0]): " + [SheetPrep]::Run($sheet, (Join-Path $views 'v'), $j[3], $j[4], [bool]$j[5], $n, 4, $(if ($j.Count -gt 7) { $j[7] } else { 0 }), $(if ($j.Count -gt 8) { $j[8] } else { 0 }), [int[]]@(if ($j.Count -gt 9 -and $j[9]) { $j[9].Split(';,') | % { [int]$_ } }))
  if ($NoSprites) { continue }
  $map = $j[6].Split(',')
  for ($t = 1; $t -le 4; $t++) {
    $out = Join-Path $Root "public\sprites\$($j[1])_$t"; New-Item -ItemType Directory -Force $out | Out-Null
    for ($c = 0; $c -lt $n; $c++) {
      if (-not $map[$c]) { continue }
      $src = Join-Path $views "v_$(($t - 1) * $n + $c + 1).png"
      if (Test-Path $src) { Copy-Item $src (Join-Path $out "$($map[$c]).png") -Force }
    }
  }
}
