param([string]$Root)
# Number strips (art-src/ui/numbers/<kind>數字.png, transparent): icon 0 1 2 3 4 5 6 7 8 9 + -
# -> public/sprites/ui/numbers/<kind>/icon.png, 0.png … 9.png, plus.png, minus.png
# Glyphs are found from empty columns; if there are not exactly 13, the widest gaps win.
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'NumSplit').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.IO; using System.Runtime.InteropServices;
public static class NumSplit {
  public static string Run(string sheet, string outDir, string[] names){
    Bitmap S; using(var fs=new FileStream(sheet,FileMode.Open,FileAccess.Read)) S=new Bitmap(fs);
    int W=S.Width, H=S.Height; var C=new Bitmap(W,H,PixelFormat.Format32bppArgb); using(var g=Graphics.FromImage(C)) g.DrawImage(S,0,0,W,H); S.Dispose();
    var bd=C.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); C.UnlockBits(bd); C.Dispose();
    for(int i=0;i<px.Length;i++) if(((px[i]>>24)&255)<40) px[i]=0;
    var col=new int[W]; for(int i=0;i<px.Length;i++) if(px[i]!=0) col[i%W]++;
    // runs of non-empty columns
    var runs=new List<int[]>(); int s=-1;
    for(int x=0;x<=W;x++){ bool on=x<W&&col[x]>0; if(on&&s<0) s=x; if(!on&&s>=0){ runs.Add(new int[]{s,x-1}); s=-1; } }
    // merge runs across the smallest gaps until we have names.Length glyphs
    while(runs.Count>names.Length){ int bi=0, bg=int.MaxValue; for(int i=0;i+1<runs.Count;i++){ int gp=runs[i+1][0]-runs[i][1]; if(gp<bg){bg=gp;bi=i;} }
      runs[bi]=new int[]{runs[bi][0],runs[bi+1][1]}; runs.RemoveAt(bi+1); }
    // glyphs that touch: split the run that is widest compared with its expected width (icon ~2 digits)
    // at its thinnest column (middle 60%)
    while(runs.Count<names.Length){
      double unit=(runs[runs.Count-1][1]-runs[0][0])/(names.Length+1.0);
      int bi=-1; double br=0;
      for(int i=0;i<runs.Count;i++){ double exp= i==0?2.0:1.0; double r=(runs[i][1]-runs[i][0])/(unit*exp); if(r>br){br=r;bi=i;} }
      int a=runs[bi][0], b=runs[bi][1], w=b-a, best=-1;
      // the first run may be icon+digit: aim at its expected split point
      for(int x=a+w/5;x<=b-w/5;x++) if(best<0||col[x]<col[best]) best=x;
      runs[bi]=new int[]{a,best-1}; runs.Insert(bi+1,new int[]{best+1,b});
    }
    Directory.CreateDirectory(outDir); var outs=new List<string>();
    for(int k=0;k<runs.Count;k++){ int x0=runs[k][0], x1=runs[k][1], y0=H, y1=-1;
      for(int y=0;y<H;y++) for(int x=x0;x<=x1;x++) if(px[y*W+x]!=0){ if(y<y0)y0=y; if(y>y1)y1=y; }
      int OW=x1-x0+1, OH=y1-y0+1; var o=new int[OW*OH];
      for(int y=0;y<OH;y++) for(int x=0;x<OW;x++) o[y*OW+x]=px[(y+y0)*W+x+x0];
      var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); B.UnlockBits(ob);
      B.Save(Path.Combine(outDir,names[k]+".png"),ImageFormat.Png); B.Dispose(); outs.Add(OW+"x"+OH); }
    return String.Join(" ",outs);
  }
}
"@
}
$kinds = @{ 'freeze'='冰凍'; 'bleed'='出血'; 'wood'='木材'; 'poison'='毒物'; 'wet'='潮濕'; 'fire'='火焰'; 'coal'='煤礦'; 'stone'='石礦'; 'slow'='緩速'; 'coin'='金幣'; 'gold_ore'='金礦'; 'food'='食物' }
$names = [string[]]@('icon','0','1','2','3','4','5','6','7','8','9','plus','minus')
foreach ($k in $kinds.Keys) {
  $sheet = Join-Path $Root "art-src\ui\numbers\$($kinds[$k])數字.png"
  "$k : " + [NumSplit]::Run($sheet, (Join-Path $Root "public\sprites\ui\numbers\$k"), $names)
}
