param([string]$Root, [string]$Only = '')
# 3-tier enemy sheets (art-src/enemies/<folder>/, no labels): 3 rows (tiers), each row = a big 45-degree hero view
# + 8 small views. Two layouts (checked by eye, faces on screen):
#   B (zombie, mummy): front-left, left, back-left, back, back-right, right, front-right, front  (a full turn)
#   A (the others):    front-left, left, back-left, (between back-left and back: unused), back, back-right, right, front
#      -> no front-right view; the game mirrors front-left for it
# Every figure is its own blob, so each row band is split by blobs (tools/split-touching.ps1, left to right).
# -> art-src/enemies/<folder>/views/v_1..27 (row by row) and public/sprites/<id>_1..3/<direction>.png
# White-background sheets are flood-filled first (white connected to the edges -> transparent).
$MAPB = @('', 'frontLeft45', 'sideLeft', 'backLeft45', 'back', 'back45', 'side', 'front45', 'front')
$MAPA = @('', 'frontLeft45', 'sideLeft', 'backLeft45', '', 'back', 'back45', 'side', 'front')
$jobs = @(
  # folder, sprite id, white background (1/0), [erode: px to break touching figures apart, default 0], [layout 'A'/'B', default A]
  @('ice-slime','ice_slime',0), @('ice-queen','ice_queen',0), @('snow-sprite','snow_sprite',0),
  @('zombie','zombie',0,0,'B'), @('fire-sprite','fire_sprite',0), @('lizard-shaman','lizard_shaman',0),
  @('bone-lizard','bone_lizard',0), @('mummy','mummy',0,0,'B'), @('lizard-crossbow','lizard_crossbow',0),
  @('snow-beast','snow_beast',0), @('frost-troll','frost_troll',1), @('rainbow-slime','rainbow_slime',0),
  @('lizard-warrior','lizard_warrior',0,8), @('lizard-heavy','lizard_heavy',0,6), @('snowball','snowball',0)
)
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'Tier3Prep').Type) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.IO; using System.Runtime.InteropServices;
public static class Tier3Prep {
  // copy the sheet to outp (optionally flood the white background away); return the two row seams "y1,y2"
  public static string Run(string sheet, string outp, bool flood){
    Bitmap S0; using(var fs=new FileStream(sheet,FileMode.Open,FileAccess.Read)) S0=new Bitmap(fs);
    int W=S0.Width, H=S0.Height; var S=new Bitmap(W,H,PixelFormat.Format32bppArgb); using(var g=Graphics.FromImage(S)) g.DrawImage(S0,0,0,W,H); S0.Dispose();
    var bd=S.LockBits(new Rectangle(0,0,W,H),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb); var px=new int[W*H]; Marshal.Copy(bd.Scan0,px,0,px.Length); S.UnlockBits(bd); S.Dispose();
    if(flood){
      Func<int,bool> light = i => { int p=px[i]; int r=(p>>16)&255, gg=(p>>8)&255, b=p&255; int mx=Math.Max(r,Math.Max(gg,b)), mn=Math.Min(r,Math.Min(gg,b)); return mx>215 && mx-mn<26; };
      var seen=new bool[W*H]; var st=new Stack<int>();
      for(int x=0;x<W;x++){ st.Push(x); st.Push((H-1)*W+x); } for(int y=0;y<H;y++){ st.Push(y*W); st.Push(y*W+W-1); }
      while(st.Count>0){ int i=st.Pop(); if(seen[i]||!light(i)) continue; seen[i]=true; px[i]=0; int x=i%W,y=i/W;
        if(x>0) st.Push(i-1); if(x<W-1) st.Push(i+1); if(y>0) st.Push(i-W); if(y<H-1) st.Push(i+W); } }
    var rowH=new int[H]; for(int i=0;i<W*H;i++) if(((px[i]>>24)&255)>=200) rowH[i/W]++;
    Func<int,int,int> emptiest=(a,b)=>{ int best=a; for(int y=a;y<=b;y++) if(rowH[y]<rowH[best]) best=y; return best; };
    int s1=emptiest((int)(H*0.25),(int)(H*0.42)), s2=emptiest((int)(H*0.58),(int)(H*0.75));
    var B=new Bitmap(W,H,PixelFormat.Format32bppArgb); var ob=B.LockBits(new Rectangle(0,0,W,H),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb); Marshal.Copy(px,0,ob.Scan0,px.Length); B.UnlockBits(ob); B.Save(outp,ImageFormat.Png); B.Dispose();
    return s1+","+s2+","+(H-1);
  }
}
"@
}
$split = Join-Path $Root 'tools\split-touching.ps1'
$tmp = Join-Path $env:TEMP 'tier3_prep.png'
foreach ($j in $jobs) {
  if ($Only -and $j[0] -ne $Only) { continue }
  $dir = Join-Path $Root "art-src\enemies\$($j[0])"
  $sheet = (Get-ChildItem -File $dir -Filter *.png | Select-Object -First 1).FullName
  $seams = [Tier3Prep]::Run($sheet, $tmp, [bool]$j[2]).Split(',') | ForEach-Object { [int]$_ }
  $views = Join-Path $dir 'views'; New-Item -ItemType Directory -Force $views | Out-Null
  Get-ChildItem $views -Filter '*.png' -ErrorAction SilentlyContinue | Remove-Item
  $y0 = 0; $report = @()
  for ($r = 0; $r -lt 3; $r++) {
    $res = & $split -Sheet $tmp -OutPrefix (Join-Path $views "row$($r + 1)") -Y0 $y0 -Y1 $seams[$r] -Erode $(if ($j.Count -gt 3) { $j[3] } else { 0 }) -MinFrac 0.08
    $report += ($res -split ' ')[0]
    $y0 = $seams[$r] + 1
    for ($k = 1; $k -le 9; $k++) {
      $src = Join-Path $views "row$($r + 1)_$k.png"
      if (Test-Path $src) { Move-Item $src (Join-Path $views "v_$($r * 9 + $k).png") -Force }
    }
    Get-ChildItem $views -Filter "row$($r + 1)_*.png" -ErrorAction SilentlyContinue | Remove-Item # extra parts
    $out = Join-Path $Root "public\sprites\$($j[1])_$($r + 1)"; New-Item -ItemType Directory -Force $out | Out-Null
    Get-ChildItem $out -Filter '*.png' -ErrorAction SilentlyContinue | Remove-Item
    $MAP = $(if ($j.Count -gt 4 -and $j[4] -eq 'B') { $MAPB } else { $MAPA })
    for ($k = 2; $k -le 9; $k++) { if (-not $MAP[$k - 1]) { continue }; $src = Join-Path $views "v_$($r * 9 + $k).png"; if (Test-Path $src) { Copy-Item $src (Join-Path $out "$($MAP[$k - 1]).png") -Force } }
  }
  "$($j[0]): parts per row " + ($report -join '/')
}
Remove-Item $tmp -ErrorAction SilentlyContinue
