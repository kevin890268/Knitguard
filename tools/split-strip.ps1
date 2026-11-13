param([string]$Sheet, [string]$OutPrefix, [int]$Expect = 3)
# Split a transparent PNG strip (several objects side by side) into separate trimmed PNGs:
# <OutPrefix>_1.png, _2.png, ... from left to right.
# Also cleans the red halo some generators leave on semi-transparent edge pixels.
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'StripSplit').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class StripSplit {
  public static string Run(string sheet, string prefix, int expect){
    var S=new Bitmap(sheet); int W=S.Width, H=S.Height;
    var bd=S.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); S.UnlockBits(bd); S.Dispose();
    // 1) halo cleanup: faint pixels go away; reddish semi-transparent edge pixels go away
    for(int i=0;i<px.Length;i++){ int p=px[i]; int a=(p>>24)&255, r=(p>>16)&255, g=(p>>8)&255, b=p&255;
      if(a<70){ px[i]=0; continue; }
      if(a<250 && r>90 && g<r*0.45 && b<r*0.45) px[i]=0; }
    // 2) columns that contain something
    var col=new int[W];
    for(int y=0;y<H;y++) for(int x=0;x<W;x++) if(((px[y*W+x]>>24)&255)>=70) col[x]++;
    var bands=new List<int[]>(); int s=-1, gap=0;
    for(int x=0;x<=W;x++){ bool on = x<W && col[x]>2;
      if(on){ if(s<0) s=x; gap=0; }
      else if(s>=0){ gap++; if(gap>=20 || x==W){ int e=x-gap; if(e-s>=60) bands.Add(new int[]{s,e}); s=-1; gap=0; } } }
    if(bands.Count!=expect){
      // objects touch (e.g. shared grass): cut at the emptiest column near each 1/expect point
      int L=0; while(L<W&&col[L]<=2) L++; int R=W-1; while(R>0&&col[R]<=2) R--;
      bands.Clear(); int prev=L;
      for(int k=1;k<expect;k++){ int c=L+(R-L)*k/expect, w=(R-L)/8, best=c;
        for(int x=Math.Max(L,c-w);x<=Math.Min(R,c+w);x++) if(col[x]<col[best]) best=x;
        bands.Add(new int[]{prev,best}); prev=best+1; }
      bands.Add(new int[]{prev,R});
      // drop pixels of the neighbours that cross the cut: keep only the biggest blob per part (done by trimming rows below)
    }
    var outs=new List<string>();
    for(int k=0;k<bands.Count;k++){ int x0=bands[k][0], x1=bands[k][1], y0=H, y1=-1;
      for(int y=0;y<H;y++) for(int x=x0;x<=x1;x++) if(((px[y*W+x]>>24)&255)>=70){ if(y<y0)y0=y; if(y>y1)y1=y; }
      int OW=x1-x0+1, OH=y1-y0+1; var o=new int[OW*OH];
      for(int y=0;y<OH;y++) for(int x=0;x<OW;x++) o[y*OW+x]=px[(y+y0)*W+x+x0];
      var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); B.UnlockBits(ob);
      B.Save(prefix+"_"+(k+1)+".png",ImageFormat.Png); B.Dispose(); outs.Add(OW+"x"+OH); }
    return String.Join(" ", outs);
  }
}
"@
}
[StripSplit]::Run($Sheet, $OutPrefix, $Expect)
