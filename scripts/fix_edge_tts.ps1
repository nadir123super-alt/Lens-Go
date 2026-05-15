$file = "c:\Users\Lenovo\Desktop\MyAIEnglishApp\services\edgeTtsService.ts"
$bytes = [System.IO.File]::ReadAllBytes($file)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# Fix 1: Line 124 - .replace(/\"/g, '"') -> .replace(/\"/g, '"')
# The file has hex 27 22 27 ('"') which should be 27 26 71 75 6f 74 3b 27 ('"')
# Use byte-level replacement to avoid any string escaping issues
$searchBytes = [byte[]]@(0x27, 0x22, 0x27)  # ' " '
$replaceBytes = [byte[]]@(0x27, 0x26, 0x71, 0x75, 0x6f, 0x74, 0x3b, 0x27)  # ' & q u o t ; '

# Find all positions of the search bytes
$positions = New-Object System.Collections.ArrayList
for ($i = 0; $i -le $bytes.Length - $searchBytes.Length; $i++) {
    $match = $true
    for ($j = 0; $j -lt $searchBytes.Length; $j++) {
        if ($bytes[$i + $j] -ne $searchBytes[$j]) {
            $match = $false
            break
        }
    }
    if ($match) {
        [void]$positions.Add($i)
    }
}

Write-Host "Found $($positions.Count) occurrences of the pattern"

# Replace from end to start to preserve indices
for ($i = $positions.Count - 1; $i -ge 0; $i--) {
    $at = $positions[$i]
    $newBytes = New-Object byte[] ($bytes.Length - $searchBytes.Length + $replaceBytes.Length)
    [Array]::Copy($bytes, 0, $newBytes, 0, $at)
    [Array]::Copy($replaceBytes, 0, $newBytes, $at, $replaceBytes.Length)
    [Array]::Copy($bytes, $at + $searchBytes.Length, $newBytes, $at + $replaceBytes.Length, $bytes.Length - $at - $searchBytes.Length)
    $bytes = $newBytes
}

# Now convert back to text for the remaining fixes
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# Fix 2: Line 137 - .join('\u0026apos;'n') -> .join('\n')
# Use single quotes for literal search (no escape processing)
$text = $text.Replace('].join(' + [char]39 + '\u0026apos;' + [char]39 + 'n' + [char]39 + ')', "].join('`n')")

# Fix 3: Line 145 - \u0026apos;'r\n' -> \r\n'
# The file has literal \u0026apos; followed by 'r\n'
$text = $text.Replace(
  [char]39 + '\u0026apos;' + [char]39 + 'r\n' + [char]39,
  [char]39 + '\r\n' + [char]39
)

# Fix 4: Line 160 - same as Fix 3
$text = $text.Replace(
  [char]39 + '\u0026apos;' + [char]39 + 'r\n' + [char]39,
  [char]39 + '\r\n' + [char]39
)

$newBytes = [System.Text.Encoding]::UTF8.GetBytes($text)
[System.IO.File]::WriteAllBytes($file, $newBytes)

Write-Host "Fixed edgeTtsService.ts"
