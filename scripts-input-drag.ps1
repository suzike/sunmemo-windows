param([int]$x, [int]$y, [int]$dx, [int]$dy)
# Press at (x,y), drag to (x+dx, y+dy) in steps, release.
Add-Type -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetCursorPos(int a, int b);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
' -Name U -Namespace W
[W.U]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 160
[W.U]::mouse_event(2, 0, 0, 0, 0)
Start-Sleep -Milliseconds 90
$steps = 6
for ($i = 1; $i -le $steps; $i++) {
  $cx = $x + [int]($dx * $i / $steps)
  $cy = $y + [int]($dy * $i / $steps)
  [W.U]::SetCursorPos($cx, $cy)
  Start-Sleep -Milliseconds 70
}
[W.U]::mouse_event(4, 0, 0, 0, 0)
exit 0
