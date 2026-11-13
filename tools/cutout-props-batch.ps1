param([string]$Root)
$tool = Join-Path $Root 'tools\cutout-building.ps1'
$out = Join-Path $Root 'public\sprites\props'
New-Item -ItemType Directory -Force $out | Out-Null
$sets = @(
  @('trees', 'tree', @(@(175,430),@(490,735),@(800,1045),@(1110,1360)), @(@(0,255),@(262,505),@(510,752),@(760,1015))),
  @('orchard', 'fruit', @(@(110,370),@(415,770),@(790,1120),@(1150,1445)), @(@(0,240),@(262,505),@(515,755),@(765,1023)))
)
foreach ($s in $sets) {
  $sheet = (Get-ChildItem -File (Join-Path $Root "art-src\props\$($s[0])") -Filter *.png | Select-Object -First 1).FullName
  $n = 1
  foreach ($r in $s[3]) { foreach ($c in $s[2]) {
    $res = & $tool -Sheet $sheet -Out (Join-Path $out "$($s[1])_$n.png") -X $c[0] -Y $r[0] -W ($c[1]-$c[0]) -H ($r[1]-$r[0]) -MinFrac 0.12
    Write-Output "$($s[1])_$n $res"; $n++
  } }
}
