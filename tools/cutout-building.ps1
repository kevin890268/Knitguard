param(
  [string]$Sheet, [string]$Out,
  [int]$X, [int]$Y, [int]$W, [int]$H,
  # rectangles (x,y,w,h in sheet coords, comma separated, ';' between) to treat as background, e.g. a title banner
  [string]$Erase = '',
  [int]$Thr = 42
)
# Cut a building out of a design sheet: background = smooth gradient estimated from the crop border,
# flood-filled from the border; keep the biggest part; write a transparent PNG (cropped to the object).
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'BCut').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class BCut {
  static double D(int p, double r, double g, double b){ double dr=((p>>16)&255)-r, dg=((p>>8)&255)-g, db=(p&255)-b; return Math.Sqrt(dr*dr+dg*dg+db*db); }
  public static string Run(string sheet, string outp, int X, int Y, int W, int H, int[] erase, int thr){
    var S=new Bitmap(sheet); var R=S.Clone(new Rectangle(X,Y,W,H), PixelFormat.Format32bppArgb); S.Dispose();
    var bd=R.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); R.UnlockBits(bd); R.Dispose();
    var er=new bool[W*H];
    for(int k=0;k+3<erase.Length;k+=4){ for(int y=Math.Max(0,erase[k+1]-Y);y<Math.Min(H,erase[k+1]-Y+erase[k+3]);y++) for(int x=Math.Max(0,erase[k]-X);x<Math.Min(W,erase[k]-X+erase[k+2]);x++) er[y*W+x]=true; }
    // background estimate: blend of row (left/right border) and column (top/bottom border) interpolation, borders smoothed
    Func<int,int,double[]> c=(x,y)=>{ int p=px[y*W+x]; return new double[]{(p>>16)&255,(p>>8)&255,p&255}; };
    int sm=6;
    Func<bool,int,int,double[]> edge=(vertical,fixedPos,i)=>{ double[] s=new double[3]; int n=0; for(int t=Math.Max(0,i-sm);t<=Math.Min((vertical?H:W)-1,i+sm);t++){ var v= vertical? c(fixedPos,t): c(t,fixedPos); s[0]+=v[0]; s[1]+=v[1]; s[2]+=v[2]; n++; } s[0]/=n; s[1]/=n; s[2]/=n; return s; };
    var L=new double[H][]; var Rr=new double[H][]; var T=new double[W][]; var B=new double[W][];
    for(int y=0;y<H;y++){ L[y]=edge(true,0,y); Rr[y]=edge(true,W-1,y); }
    for(int x=0;x<W;x++){ T[x]=edge(false,0,x); B[x]=edge(false,H-1,x); }
    var bg=new bool[W*H]; var st=new Stack<int>();
    for(int x=0;x<W;x++){ st.Push(x); st.Push((H-1)*W+x);} for(int y=0;y<H;y++){ st.Push(y*W); st.Push(y*W+W-1);}
    for(int i=0;i<W*H;i++) if(er[i]) st.Push(i);
    // smooth flood: background is blurry, so step from a background pixel to a neighbour only when the colour
    // changes very little (thr/10); sharp object edges stop it. Border pixels must still be near the border estimate.
    double step=Math.Max(2.5, thr/10.0);
    Func<int,int,double> nd=(a,b)=>{ int p=px[a], q=px[b]; double dr=((p>>16)&255)-((q>>16)&255), dg=((p>>8)&255)-((q>>8)&255), db=(p&255)-(q&255); return Math.Sqrt(dr*dr+dg*dg+db*db); };
    var from=new Stack<int>();
    while(st.Count>0){ int i=st.Pop(); if(bg[i]) continue; int x=i%W, y=i/W;
      bg[i]=true;
      for(int k=0;k<4;k++){ int nx=x+(k==0?1:k==1?-1:0), ny=y+(k==2?1:k==3?-1:0); if(nx<0||ny<0||nx>=W||ny>=H) continue; int j=ny*W+nx; if(bg[j]) continue;
        if(er[j] || nd(i,j)<=step) st.Push(j); } }
    // keep biggest foreground component (8-neighbour) + components >= 3% of it
    var lab=new int[W*H]; var area=new List<int>{0};
    for(int i0=0;i0<W*H;i0++){ if(bg[i0]||lab[i0]!=0) continue; int id=area.Count, a=0; lab[i0]=id; st.Push(i0);
      while(st.Count>0){ int i=st.Pop(); a++; int x=i%W,y=i/W; for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H) continue; int j=ny*W+nx; if(!bg[j]&&lab[j]==0){lab[j]=id; st.Push(j);} } }
      area.Add(a); }
    int max=0; for(int k=1;k<area.Count;k++) max=Math.Max(max,area[k]);
    var keep=new bool[W*H]; int x0=W,y0=H,x1=-1,y1=-1;
    for(int i=0;i<W*H;i++){ int l=lab[i]; if(l>0 && area[l]>=max*0.03){ keep[i]=true; int x=i%W,y=i/W; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
    // soft 1px edge: kept pixels touching background get half alpha
    int OW=x1-x0+1, OH=y1-y0+1; var o=new int[OW*OH];
    for(int y=0;y<OH;y++) for(int x=0;x<OW;x++){ int i=(y+y0)*W+x+x0; if(!keep[i]){ o[y*OW+x]=0; continue; }
      bool edgeP=false; int gx=x+x0, gy=y+y0; for(int k=0;k<4&&!edgeP;k++){ int nx=gx+(k==0?1:k==1?-1:0), ny=gy+(k==2?1:k==3?-1:0); if(nx<0||ny<0||nx>=W||ny>=H||!keep[ny*W+nx]) edgeP=true; }
      o[y*OW+x]= edgeP ? (px[i]&0x00FFFFFF)|(140<<24) : px[i]|unchecked((int)0xFF000000); }
    var Bm=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=Bm.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); Bm.UnlockBits(ob); Bm.Save(outp,ImageFormat.Png); Bm.Dispose();
    return String.Format("{0}x{1} parts {2}", OW, OH, area.Count-1);
  }
}
"@
}
$er = @(); if ($Erase) { foreach ($r in $Erase.Split(';')) { $er += $r.Split(',') | % { [int]$_ } } }
[BCut]::Run($Sheet, $Out, $X, $Y, $W, $H, [int[]]$er, $Thr)
