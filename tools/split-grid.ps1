param([string]$Sheet, [string]$OutPrefix, [string]$Cols = '8,8', [int]$MinAlpha = 70)
# -MinAlpha: pixels more transparent than this count as background (raise it, e.g. 220, for sheets with a semi-transparent haze)
# Split a transparent sprite sheet laid out in rows into separate trimmed PNGs, numbered left→right, top→bottom:
# <OutPrefix>_1.png, _2.png, ...  -Cols = how many objects in each row, e.g. '8,8' or '7,8' or '8,8,8,8'.
# Rows are found from fully-empty horizontal gaps; objects in a row from empty columns (or, if they touch, the
# emptiest column near each 1/n point). Also removes faint pixels and the red halo some generators leave.
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'GridSplit2').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class GridSplit2 {
  static List<int[]> Bands(int[] cnt, int n, int minGap, int minLen){
    var bands=new List<int[]>(); int s=-1, gap=0;
    for(int x=0;x<=n;x++){ bool on = x<n && cnt[x]>2;
      if(on){ if(s<0) s=x; gap=0; }
      else if(s>=0){ gap++; if(gap>=minGap || x==n){ int e=x-gap; if(e-s>=minLen) bands.Add(new int[]{s,e}); s=-1; gap=0; } } }
    return bands;
  }
  public static string Run(string sheet, string prefix, int[] cols, int minA){
    var S=new Bitmap(sheet); int W=S.Width, H=S.Height;
    var bd=S.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); S.UnlockBits(bd); S.Dispose();
    for(int i=0;i<px.Length;i++){ int p=px[i]; int a=(p>>24)&255, r=(p>>16)&255, g=(p>>8)&255, b=p&255;
      if(a<minA){ px[i]=0; continue; }
      if(a<200 && r>195 && g>195 && b>190){ px[i]=0; continue; } // semi-transparent white haze background
      if(a<250 && r>90 && g<r*0.45 && b<r*0.45) px[i]=0; }
    Func<int,bool> on = i => ((px[i]>>24)&255)>=minA;
    var rowCnt=new int[H]; for(int y=0;y<H;y++) for(int x=0;x<W;x++) if(on(y*W+x)) rowCnt[y]++;
    var rows=Bands(rowCnt,H,12,40);
    if(rows.Count!=cols.Length) return "found "+rows.Count+" rows (expected "+cols.Length+")";
    var outs=new List<string>(); int k=0;
    for(int ri=0;ri<rows.Count;ri++){ int y0=rows[ri][0], y1=rows[ri][1], n=cols[ri];
      var colCnt=new int[W]; for(int y=y0;y<=y1;y++) for(int x=0;x<W;x++) if(on(y*W+x)) colCnt[x]++;
      var bands=Bands(colCnt,W,10,30);
      if(bands.Count!=n){
        int L=0; while(L<W&&colCnt[L]<=2) L++; int R=W-1; while(R>0&&colCnt[R]<=2) R--;
        bands.Clear(); int prev=L;
        for(int c=1;c<n;c++){ int m=L+(R-L)*c/n, w=(R-L)/(n*3), best=m;
          for(int x=Math.Max(L,m-w);x<=Math.Min(R,m+w);x++) if(colCnt[x]<colCnt[best]) best=x;
          bands.Add(new int[]{prev,best}); prev=best+1; }
        bands.Add(new int[]{prev,R});
      }
      foreach(var b in bands){ int x0=b[0], x1=b[1], ty=y1, by=y0;
        for(int y=y0;y<=y1;y++) for(int x=x0;x<=x1;x++) if(on(y*W+x)){ if(y<ty)ty=y; if(y>by)by=y; }
        int OW=x1-x0+1, OH=by-ty+1; var o=new int[OW*OH];
        for(int y=0;y<OH;y++) for(int x=0;x<OW;x++) o[y*OW+x]=px[(y+ty)*W+x+x0];
        var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); B.UnlockBits(ob);
        k++; B.Save(prefix+"_"+k+".png",ImageFormat.Png); B.Dispose(); outs.Add(OW+"x"+OH); }
    }
    return k+" parts: "+String.Join(" ", outs);
  }
}
"@
}
[GridSplit2]::Run($Sheet, $OutPrefix, [int[]]($Cols.Split(',') | ForEach-Object { [int]$_ }), $MinAlpha)
