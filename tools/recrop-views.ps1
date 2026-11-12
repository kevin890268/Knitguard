# Re-crop views from a design sheet: find each views/v*.png on the sheet, grow the box to the whole character,
# and paint neighbouring characters / text with the background colour.
# Usage: powershell -File tools/recrop-views.ps1 -Sheet <sheet.png> -ViewsDir <views> -OutDir <out>
param([string]$Sheet, [string]$ViewsDir, [string]$OutDir, [int]$Pad = 110, [int]$Thr = 40, [int]$Margin = 8)
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'Recrop2').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Recrop2 {
  static int[] Px(Bitmap b){ var r=new Rectangle(0,0,b.Width,b.Height); var d=b.LockBits(r,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var a=new int[b.Width*b.Height]; Marshal.Copy(d.Scan0,a,0,a.Length); b.UnlockBits(d); return a; }
  static int Dist(int p,int q){ int dr=((p>>16)&255)-((q>>16)&255), dg=((p>>8)&255)-((q>>8)&255), db=(p&255)-(q&255); return (int)Math.Sqrt(dr*dr+dg*dg+db*db); }
  public static string Run(string sheetPath, string viewPath, string outPath, int pad, int thr, int margin){
    var S=new Bitmap(sheetPath); var V=new Bitmap(viewPath); int SW=S.Width, SH=S.Height, VW=V.Width, VH=V.Height;
    var s=Px(S); var v=Px(V); S.Dispose(); V.Dispose();
    // 1) locate the old crop on the sheet
    var rnd=new Random(1); int n=80; var sx=new int[n]; var sy=new int[n];
    for(int i=0;i<n;i++){ sx[i]=rnd.Next(VW); sy[i]=rnd.Next(VH); }
    long best=long.MaxValue; int bx=0, by=0;
    for(int y=0;y+VH<=SH;y++) for(int x=0;x+VW<=SW;x++){
      long e=0; for(int i=0;i<n && e<best;i++) e+=Dist(s[(y+sy[i])*SW+x+sx[i]], v[sy[i]*VW+sx[i]]);
      if(e<best){best=e;bx=x;by=y;}
    }
    // 2) region around it
    int rx0=Math.Max(0,bx-pad), ry0=Math.Max(0,by-pad), rx1=Math.Min(SW-1,bx+VW-1+pad), ry1=Math.Min(SH-1,by+VH-1+pad);
    int RW=rx1-rx0+1, RH=ry1-ry0+1;
    // background colour = median of the old crop border
    var rs=new List<int>(); var gs=new List<int>(); var bs=new List<int>();
    for(int x=bx;x<bx+VW;x++) foreach(int y in new int[]{by,by+VH-1}){ int p=s[y*SW+x]; rs.Add((p>>16)&255); gs.Add((p>>8)&255); bs.Add(p&255); }
    for(int y=by;y<by+VH;y++) foreach(int x in new int[]{bx,bx+VW-1}){ int p=s[y*SW+x]; rs.Add((p>>16)&255); gs.Add((p>>8)&255); bs.Add(p&255); }
    rs.Sort(); gs.Sort(); bs.Sort(); int m=rs.Count/2; int bg=(255<<24)|(rs[m]<<16)|(gs[m]<<8)|bs[m];
    // 3) flood background from the region border
    var isBg=new bool[RW*RH]; var st=new Stack<int>();
    Func<int,int> at=(i)=>s[(ry0+i/RW)*SW+rx0+i%RW];
    for(int x=0;x<RW;x++){ st.Push(x); st.Push((RH-1)*RW+x);} for(int y=0;y<RH;y++){ st.Push(y*RW); st.Push(y*RW+RW-1);}
    while(st.Count>0){ int i=st.Pop(); if(isBg[i]) continue; if(Dist(at(i),bg)>thr) continue; isBg[i]=true; int x=i%RW, y=i/RW;
      if(x>0) st.Push(i-1); if(x<RW-1) st.Push(i+1); if(y>0) st.Push(i-RW); if(y<RH-1) st.Push(i+RW); }
    // 4) connected foreground components (8-neighbour)
    var lab=new int[RW*RH]; var overlap=new List<int>{0}; var area=new List<int>{0};
    for(int i0=0;i0<RW*RH;i0++){ if(isBg[i0]||lab[i0]!=0) continue; int id=area.Count; int a=0, ov=0; lab[i0]=id; st.Push(i0);
      while(st.Count>0){ int i=st.Pop(); a++; int x=i%RW, y=i/RW; int gx=rx0+x, gy=ry0+y; if(gx>=bx&&gx<bx+VW&&gy>=by&&gy<by+VH) ov++;
        for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=RW||ny>=RH) continue; int j=ny*RW+nx; if(!isBg[j]&&lab[j]==0){lab[j]=id; st.Push(j);} } }
      area.Add(a); overlap.Add(ov); }
    int main=1; for(int k=1;k<area.Count;k++) if(overlap[k]>overlap[main]) main=k;
    // keep also big parts mostly inside the old crop (detached pieces of the same unit)
    var keep=new bool[area.Count]; keep[main]=true;
    for(int k=1;k<area.Count;k++) if(k!=main && overlap[k]>area[main]*0.02 && overlap[k]>area[k]*0.9) keep[k]=true;
    int x0=RW,y0=RH,x1=-1,y1=-1;
    for(int i=0;i<RW*RH;i++) if(lab[i]>0&&keep[lab[i]]){ int x=i%RW,y=i/RW; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    x0=Math.Max(0,x0-margin); y0=Math.Max(0,y0-margin); x1=Math.Min(RW-1,x1+margin); y1=Math.Min(RH-1,y1+margin);
    int OW=x1-x0+1, OH=y1-y0+1; var o=new int[OW*OH];
    for(int y=0;y<OH;y++) for(int x=0;x<OW;x++){ int i=(y+y0)*RW+x+x0; int l=lab[i]; o[y*OW+x]= (l>0 && !keep[l]) ? bg : at(i); }
    var B=new Bitmap(OW,OH,PixelFormat.Format32bppArgb); var bd=B.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(o,0,bd.Scan0,o.Length); B.UnlockBits(bd); B.Save(outPath,ImageFormat.Png); B.Dispose();
    return String.Format("old ({0},{1}) {2}x{3} err {4} -> new ({5},{6}) {7}x{8} parts {9}", bx,by,VW,VH,best/n, rx0+x0, ry0+y0, OW, OH, area.Count-1);
  }
}
"@
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($f in Get-ChildItem $ViewsDir -Filter 'v*.png') {
  "$($f.Name): " + [Recrop2]::Run($Sheet, $f.FullName, (Join-Path $OutDir $f.Name), $Pad, $Thr, $Margin)
}
