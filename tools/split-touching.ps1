param(
  [string]$Sheet, [string]$OutPrefix,
  # only this band of the sheet (y0,y1); objects are numbered left to right: <OutPrefix>_1.png, _2.png ...
  [int]$Y0 = 0, [int]$Y1 = 100000,
  [int]$Erode = 3, [int]$MinAlpha = 200, [double]$MinFrac = 0.15
)
# Split a transparent sheet whose objects TOUCH each other (e.g. a flail ball resting on the neighbour's legs)
# without straight cuts: erode the mask a few px so thin contacts break, label what is left (big parts =
# objects; small crumbs dropped), then grow every object back over the original mask (multi-source BFS),
# so each contact pixel goes to the nearer object. Faint pixels (alpha < MinAlpha, e.g. generator haze) are dropped.
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'TouchSplit').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class TouchSplit {
  public static string Run(string sheet, string prefix, int Y0, int Y1, int erode, int minA, double minFrac){
    var S=new Bitmap(sheet); int W=S.Width, H0=S.Height; var bd=S.LockBits(new Rectangle(0,0,W,H0),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var all=new int[W*H0]; Marshal.Copy(bd.Scan0,all,0,all.Length); S.UnlockBits(bd); S.Dispose();
    Y0=Math.Max(0,Y0); Y1=Math.Min(H0-1,Y1); int H=Y1-Y0+1; var px=new int[W*H]; Array.Copy(all,Y0*W,px,0,W*H);
    var on=new bool[W*H]; for(int i=0;i<W*H;i++){ if(((px[i]>>24)&255)>=minA) on[i]=true; else px[i]=0; }
    // erosion: a pixel survives if every pixel within the square of radius 'erode' is on
    var er=(bool[])on.Clone();
    for(int k=0;k<erode;k++){ var nx=new bool[W*H]; for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){ int i=y*W+x; nx[i]=er[i]&&er[i-1]&&er[i+1]&&er[i-W]&&er[i+W]&&er[i-W-1]&&er[i-W+1]&&er[i+W-1]&&er[i+W+1]; } er=nx; }
    // label eroded parts
    var lab=new int[W*H]; var areas=new List<int>{0}; var st=new Stack<int>();
    for(int i0=0;i0<W*H;i0++){ if(!er[i0]||lab[i0]!=0) continue; int id=areas.Count,a=0; lab[i0]=id; st.Push(i0);
      while(st.Count>0){ int i=st.Pop(); a++; int x=i%W,y=i/W; for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int xx=x+dx,yy=y+dy; if(xx<0||yy<0||xx>=W||yy>=H) continue; int j=yy*W+xx; if(er[j]&&lab[j]==0){lab[j]=id; st.Push(j);} } }
      areas.Add(a); }
    int max=0; foreach(var a in areas) max=Math.Max(max,a);
    for(int i=0;i<W*H;i++) if(lab[i]>0 && areas[lab[i]]<max*minFrac) lab[i]=0; // crumbs
    // grow back over the original mask (BFS from all objects at once)
    var q=new Queue<int>(); for(int i=0;i<W*H;i++) if(lab[i]>0) q.Enqueue(i);
    while(q.Count>0){ int i=q.Dequeue(); int x=i%W,y=i/W; for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int xx=x+dx,yy=y+dy; if(xx<0||yy<0||xx>=W||yy>=H) continue; int j=yy*W+xx; if(on[j]&&lab[j]==0){ lab[j]=lab[i]; q.Enqueue(j);} } }
    // boxes, sorted by left edge
    var ids=new List<int>(); var box=new Dictionary<int,int[]>();
    for(int i=0;i<W*H;i++){ int l=lab[i]; if(l<=0) continue; int x=i%W,y=i/W; int[] b; if(!box.TryGetValue(l,out b)){ b=new int[]{W,H,-1,-1}; box[l]=b; ids.Add(l);} if(x<b[0])b[0]=x; if(y<b[1])b[1]=y; if(x>b[2])b[2]=x; if(y>b[3])b[3]=y; }
    ids.Sort((a,b)=>box[a][0].CompareTo(box[b][0]));
    var outs=new List<string>(); int k2=0;
    foreach(int l in ids){ var b=box[l]; int OW=b[2]-b[0]+1, OH=b[3]-b[1]+1; var o=new int[OW*OH];
      for(int y=0;y<OH;y++) for(int x=0;x<OW;x++){ int i=(y+b[1])*W+x+b[0]; if(lab[i]==l) o[y*OW+x]=px[i]; }
      var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,ob.Scan0,o.Length); B.UnlockBits(ob);
      k2++; B.Save(prefix+"_"+k2+".png",ImageFormat.Png); B.Dispose(); outs.Add(String.Format("{0}:x{1} {2}x{3}",k2,b[0],OW,OH)); }
    return outs.Count+" parts  "+String.Join("  ",outs);
  }
}
"@
}
[TouchSplit]::Run($Sheet, $OutPrefix, $Y0, $Y1, $Erode, $MinAlpha, $MinFrac)
