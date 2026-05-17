# 读取文件
$filePath = "c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\(tabs)\ai-conversation.tsx"
$lines = Get-Content $filePath -Encoding UTF8
$newLines = @()

$inEndCall = $false
$braceCount = 0

foreach ($line in $lines) {
    # 找到 endCall 函数的开始
    if ($line -match "const endCall = useCallback") {
        $inEndCall = $true
        $braceCount = 0
        
        # 写入新的 endCall 函数
        $newLines += "  const endCall = useCallback(async () => {"
        $newLines += "    // 计算通话时长"
        $newLines += "    const duration = callStartTime > 0 ? Math.floor((Date.now() - callStartTime) / 1000) : 0;"
        $newLines += ""
        $newLines += "    // 保存对话记录到数据库"
        $newLines += "    if (messages.length > 0) {"
        $newLines += "      console.log('[AIConversation] 保存对话记录，共', messages.length, '条消息');"
        $newLines += "      await saveOralSession(messages, duration);"
        $newLines += "    }"
        $newLines += ""
        $newLines += "    clearInactivityTimer();"
        $newLines += "    cleanupRecording();"
        $newLines += "    stopAll();"
        $newLines += "    setIsActive(false);"
        $newLines += "    setStatus('"'"'idle'"'"');"
        $newLines += "    setAiText('"'"''"'"');"
        $newLines += "    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));"
        $newLines += "    vadLockedRef.current = false;"
        $newLines += "    setIsProcessing(false);"
        $newLines += "    conversationHistoryRef.current = [];"
        $newLines += "    setCallStartTime(0);"
        $newLines += "  }, [messages, callStartTime, cleanupRecording]);"
        continue
    }
    
    # 如果在 endCall 函数中，跳过原内容直到函数结束
    if ($inEndCall) {
        # 统计大括号
        $braceCount += ($line.ToCharArray() | Where-Object {$_ -eq '{'}).Count
        $braceCount -= ($line.ToCharArray() | Where-Object {$_ -eq '}'}).Count
        
        # 函数结束
        if ($braceCount -le 0 -and $line -match '\}, \[router') {
            $inEndCall = $false
        }
        continue
    }
    
    $newLines += $line
}

# 写回文件
$newLines | Set-Content $filePath -Encoding UTF8
Write-Host "endCall 函数修改完成"
