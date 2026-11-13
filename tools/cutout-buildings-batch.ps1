param([string]$Root, [string]$Only = '')
# folder | sprite id | stage rects "x,y,w,h" x3 | erase rects
$B = '188,0,392,283|188,300,392,282|188,598,392,362'
$BE = '0,0,300,90;0,0,192,1024'
$jobs = @(
  @('barracks-bird','barracks_bird',$B,($BE + ';290,283,175,32')),
  @('barracks-bull','barracks_bull',$B,$BE),
  @('barracks-dog','barracks_dog',$B,$BE,'55'),
  @('barracks-treant','barracks_treant',$B,$BE),
  @('barracks-fish','barracks_fish',$B,$BE),
  @('barracks-sheep','barracks_sheep',$B,$BE),
  @('barracks-spider','barracks_spider','188,0,392,276|188,300,392,282|188,598,392,362',$BE),
  @('barracks-spiky','barracks_spiky',$B,$BE,'70'),
  @('barracks-wolf','barracks_wolf',$B,$BE),
  @('barracks-pig','barracks_pig',$B,$BE),
  @('diplomacy','diplomacy','188,0,400,283|188,300,400,270|195,598,400,362',$BE),
  @('brewery','brewery','160,0,370,295|160,325,370,290|140,640,400,345','250,628,220,26'),
  @('tavern','tavern','175,0,360,275|165,315,390,295|135,610,425,355','0,720,162,100'),
  @('nursery','nursery','165,0,360,290|160,330,370,285|160,665,365,315',''),
  @('market','market','170,0,355,280|165,330,375,268|120,595,415,380','0,725,158,90'),
  @('church','church','150,0,340,290|150,325,340,272|125,600,370,370','0,740,160,95'),
  @('watchtower','watchtower','225,0,280,275|225,315,280,280|215,630,290,345',''),
  @('lumber','lumber','160,0,370,290|165,335,365,280|145,665,385,315','0,745,148,90'),
  @('mine','mine','160,0,350,280|160,330,350,280|130,640,385,335','0,735,150,95'),
  @('castle','castle','170,0,330,280|165,315,355,295|170,630,370,340',''),
  @('cemetery','cemetery','165,0,330,285|160,330,355,275|150,650,368,320','0,745,150,90'),
  @('woodworks','woodworks','165,0,350,285|150,315,355,290|125,640,388,335','0,425,150,95;0,740,136,95'),
  @('plankyard','plankyard','145,0,375,290|130,330,375,280|125,640,390,340','0,420,165,92;0,735,158,90'),
  @('stone-tower','stone_tower','170,0,250,288|170,318,250,298|155,650,280,333','')
)
$tool = Join-Path $Root 'tools\cutout-building.ps1'
foreach ($j in $jobs) {
  if ($Only -and $j[0] -ne $Only) { continue }
  $sheet = (Get-ChildItem -File (Join-Path $Root "art-src\buildings\$($j[0])") -Filter *.png | Select-Object -First 1).FullName
  $rects = $j[2].Split('|')
  for ($s = 0; $s -lt 3; $s++) {
    $r = $rects[$s].Split(',') | ForEach-Object { [int]$_ }
    $out = Join-Path $Root "public\sprites\buildings\$($j[1])_$($s + 1).png"
    $thr = 42; if ($j.Count -gt 4) { $thr = [int]$j[4] }
    $res = & $tool -Sheet $sheet -Out $out -X $r[0] -Y $r[1] -W $r[2] -H $r[3] -Erase $j[3] -Thr $thr -MinFrac 0.12
    Write-Output "$($j[1])_$($s + 1): $res"
  }
}
