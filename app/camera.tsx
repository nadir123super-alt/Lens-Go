/**
 * CameraScreen - 主相机界面
 *
 * 布局结构（从上到下）：
 * 1. 顶部搜索组件（Search Bar）- 浮动 TextInput，查词 Modal
 * 2. 实时检测覆盖层（DetectionOverlay）
 * 3. 底部导航坞（Bottom Dock）- 生词本 / 拍照 / 历史
 * 4. DetailCard - 识别结果气泡（含麦克风语音测评）
 *
 * 色彩方案：珊瑚红 (#FF6B6B) 主色调 + 圆角 + 微阴影
 */
import AchievementUnlockModal from '@/components/AchievementUnlockModal';
import { DetectionOverlay, DetectionPoint } from '@/components/detection-overlay';
import { useGlobalSpeech } from '@/hooks/useGlobalSpeech';
import { checkCameraAchievements } from '@/services/achievementService';
import { analyzeCroppedPatch, analyzeImage, fetchPhrasesForObject, fetchWordDetails, searchWordDefinition } from '@/services/aiService';
import { detector } from '@/services/realtimeDetection';
import { evaluateRecording, requestAudioPermission, startRecording, stopRecording } from '@/services/recordingService';
import { recordLearningActivity } from '@/services/studyStatsService';
import { autoAddVocabulary, getVocabulary, VocabEntry } from '@/services/vocabularyService';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    FlatList,
    Image,
    Linking,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);

type CameraMode = 'shooting' | 'preview';

interface PhraseItem {
  e: string;
  c: string;
}

interface AiObject {
  l: string;
  t: string;
  x: number;
  y: number;
  size?: string;
  phrases?: PhraseItem[];
}

interface AiData {
  intro: string;
  objects: AiObject[];
}

interface CroppedCacheEntry {
  word: string;
  translation: string;
  examples: Array<{ en: string; cn: string }>;
}

/**
 * 单词详情数据结构（来自 fetchWordDetails）
 */
interface WordDetailData {
  word: string;
  definition: string;
  example_en_1: string;
  example_cn_1: string;
  example_en_2: string;
  example_cn_2: string;
}

const ANCHOR_COLOR = '#FF6B6B';
const YELLOW_LEARN = '#FFD93D';
const API_KEY = 'f70c822d62bb4fa488e6cf93401a1ed6.MM9sPamtfzmwXDHv';
const DETECTION_INTERVAL = 200;
const CROP_SIZE = 300;
const { width: SCREEN_W } = Dimensions.get('window');

const DashedWords = ({text, style}: {text: string; style?: any}) => {
  const cleanedText = text.replace(/_/g, '').trim().replace(/\s+/g, ' ');
  let words = cleanedText.split(' ');
  if (words.length === 1 && cleanedText.length > 1) {
    words = cleanedText.split('');
  }
  const borderColor = 'rgba(255, 255, 255, 0.3)';

  const isPunctuationOnly = (word: string) => /^[。,.!?？！，]+$/.test(word);

  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', width: '100%'}}>
      {words.map((word, i) => {
        const hasBorder = !isPunctuationOnly(word);
        return (
          <View
            key={i}
            style={{
              alignSelf: 'flex-start',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              paddingBottom: hasBorder ? 0 : 0,
              marginRight: 10,
              marginBottom: 8,
              ...(hasBorder && {
                borderBottomWidth: 1.5,
                borderStyle: 'solid',
                borderBottomColor: borderColor,
              }),
            }}
          >
            <Text style={[style, {textAlign: 'center'}]}>{word}</Text>
          </View>
        );
      })}
    </View>
  );
};

let globalRequestId = 0;

// ======================== 主组件 ========================
export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // 读取路由参数：mode === 'identify' 则为纯净拍照识别模式
  const searchParams = useLocalSearchParams<{ mode?: string }>();
  const identifyMode = searchParams.mode === 'identify';

  const [mode, setMode] = useState<CameraMode>('shooting');
  const [photo, setPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiData, setAiData] = useState<AiData | null>(null);
  const [zoom, setZoom] = useState(0);
  const baseZoom = useRef(0);

  // 选中 & 例句
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedPhrases, setSelectedPhrases] = useState<PhraseItem[] | null>(null);
  const [isLoadingPhrase, setIsLoadingPhrase] = useState(false);
  
  // 追踪预览图片的实际显示尺寸（用于坐标校准）
  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  // 图片的实际宽高比（从压缩后的图片获取，用于 AnchorPointComponent 坐标映射）
  const [imageAspectRatio, setImageAspectRatio] = useState(4 / 3);

  // 自动收藏反馈提示
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');

  // 清除反馈信息（3 秒后）
  useEffect(() => {
    if (!saveMsg) return;
    const t = setTimeout(() => setSaveMsg(null), 3000);
    return () => clearTimeout(t);
  }, [saveMsg]);

  // 实时检测
  const [detectionPoints, setDetectionPoints] = useState<DetectionPoint[]>([]);
  const [modelLoading, setModelLoading] = useState(true);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDetectionRunning = useRef(false);
  const croppedCacheRef = useRef<Map<string, CroppedCacheEntry>>(new Map());
  const preloadCacheRef = useRef<Map<string, WordDetailData>>(new Map());
  const isPreloadingRef = useRef(false);
  const hasAutoSpoken = useRef(false);

  // 搜索组件
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    l: string;
    t: string;
    pos: string;
    usage: string;
    examples: PhraseItem[];
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // 生词本 Modal
  const [showVocabModal, setShowVocabModal] = useState(false);
  const [vocabList, setVocabList] = useState<VocabEntry[]>([]);
  const [isLoadingVocab, setIsLoadingVocab] = useState(false);

  // 录音状态（口语练习）
  const [recordingPhraseIdx, setRecordingPhraseIdx] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordScore, setRecordScore] = useState<{ score: number; level: string; feedback: string } | null>(null);

  // 分析中 ref — 用于 cleanup 守卫，防止卸载时中断保存进程
  const isAnalyzingRef = useRef(false);

  // 成就解锁弹窗
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const [unlockedBadgeId, setUnlockedBadgeId] = useState('');

  // ====== 全局 TTS 发音管理器 ======
  const { speak, stop: stopSpeech } = useGlobalSpeech();

  // ====== 模型加载 ======
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await detector.loadModel();
        if (mounted) setModelLoading(false);
      } catch {
        if (mounted) setModelLoading(false);
      }
    })();
    return () => {
      mounted = false;
      // 防止正在分析时释放模型资源（会导致保存中断）
      if (isAnalyzingRef.current) {
        console.log("⚠️ 正在分析中，延迟释放 TensorFlow 模型资源");
        return;
      }
      detector.dispose();
    };
  }, []);

  // ====== "退出即停"：页面卸载时自动停止所有音频 ======
  // 防止用户开着 DetailCard 播放声音时离开页面，声音仍在后台播放
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  // ====== 实时检测循环（已禁用 — COCO-SSD 已 Bypass，纯手动拍照模式）=====>
  // 保留空 interval 守卫，确保任何残留 setInterval 在 mode 切换时被清除
  useEffect(() => {
    // 任何条件下都不启动自动检测
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
  }, [mode]);

  // ====== 拍照 ======
  const handleTakePicture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const result = await cameraRef.current.takePictureAsync();
      if (!result?.uri) throw new Error('拍照失败');
      const compressed = await ImageManipulator.manipulateAsync(
        result.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhoto(compressed.uri);
      // 保存压缩后图片的实际宽高比（用于后续 AI 锚点坐标映射）
      if (compressed.width && compressed.height) {
        setImageAspectRatio(compressed.width / compressed.height);
      }
      setMode('preview');
      setAiData(null);
      setSelectedId(null);
      setSelectedIndex(null);
      setSelectedPhrases(null);
      setDetectionPoints([]);
    } catch (error) {
      console.error('拍照失败:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const handleRetake = useCallback(() => {
    setPhoto(null);
    setMode('shooting');
    setAiData(null);
    setSelectedId(null);
    setSelectedIndex(null);
    setSelectedPhrases(null);
    setDetectionPoints([]);
    croppedCacheRef.current.clear();
    preloadCacheRef.current.clear();
    isPreloadingRef.current = false;
  }, []);

  // ====== AI 全场景分析：立即显示红点 + 后台静默保存 ======
  const handleAnalyzeScene = useCallback(async () => {
    if (!photo) return;
    setIsAnalyzing(true);
    setAiData(null);
    setSelectedId(null);
    setSelectedIndex(null);
    setSelectedPhrases(null);
    try {
      // 1. AI 分析场景内容（阻塞等待完整 JSON 返回）
      console.log("🚀 开始 AI 场景分析，图片:", photo.substring(0, 50));
      const result = (await analyzeImage(photo, API_KEY)) as AiData;
      
      // 检查结果是否有效
      if (!result || !result.intro || !Array.isArray(result.objects)) {
        throw new Error('AI 返回数据格式不正确');
      }
      
      // 如果没有识别到任何物体，友好提示用户
      if (result.objects.length === 0) {
        setIsAnalyzing(false);
        Alert.alert(
          '没有识别到物体',
          '请重新拍摄一张更清晰的照片，或者拍摄包含更多物体的场景。',
          [{ text: '好的', style: 'default' }]
        );
        return;
      }
      
      console.log("✅ AI 分析完成，识别到", result.objects.length, "个物体");

      // 2. 【立即显示 UI】先把红点气泡渲染出来
      setAiData(result);
      setIsAnalyzing(false);

      // 3. 【后台异步静默保存】不阻塞用户交互
      console.log("💾 后台批量自动入库（静默）...");
      (async () => {
        for (const obj of result.objects) {
          try {
            // 用 fetchPhrasesForObject 获取地道例句
            let phrases: PhraseItem[] = [];
            try {
              phrases = obj.phrases && obj.phrases.length > 0
                ? obj.phrases.map((p: PhraseItem) => ({ e: p.e, c: p.c }))
                : await fetchPhrasesForObject(obj.l, API_KEY, false, 'camera');
            } catch {
              console.warn(`   ⚠️ 单词 "${obj.l}" AI 无法生成例句，跳过保存`);
              continue;
            }
            if (!phrases || phrases.length === 0) {
              console.warn(`   ⚠️ 单词 "${obj.l}" 例句为空，跳过保存`);
              continue;
            }
            await autoAddVocabulary(obj.l, obj.t, phrases, 'camera', '', undefined);
            // 记录学习活动（异步，不阻塞）
            // 分数设为 0，因为还没有进行口语练习；分数会在口语练习后更新，取最高分
            recordLearningActivity(obj.l, 0, 'camera').catch((e) =>
              console.warn(`   ⚠️ 记录学习活动失败: ${obj.l}`, e)
            );
          } catch (objError) {
            console.warn(`   ⚠️ 单词 "${obj.l}" 保存失败:`, objError);
          }
        }
        console.log('✅ 后台批量入库全部完成');
      })();

      // 4. 【异步后台预加载】静默预加载所有识别单词的详情
      console.log("🔄 启动异步后台预加载...");
      preloadCacheRef.current.clear();
      isPreloadingRef.current = true;
      (async () => {
        for (const obj of result.objects) {
          if (!isPreloadingRef.current) break;
          const word = obj.l.toLowerCase().trim();
          if (preloadCacheRef.current.has(word)) continue;
          try {
            const detail = await fetchWordDetails(word, API_KEY);
            if (detail && isPreloadingRef.current) {
              preloadCacheRef.current.set(word, detail);
              console.log(`📦 预加载完成: ${word}`);
            }
          } catch (error: any) {
            console.warn(`   ⚠️ 预加载失败: ${word}`, error?.message || error);
          }
        }
        isPreloadingRef.current = false;
        console.log('✅ 异步后台预加载全部完成');
      })();
    } catch (error: any) {
      console.error('智谱 AI 分析失败:', error);
      setIsAnalyzing(false);
      const msg = error.message || '未知错误';
      
      // 更友好的错误提示
      if (typeof msg === 'string' && msg.startsWith('TIMEOUT:')) {
        Alert.alert('请求超时', msg.replace('TIMEOUT:', '') + '\n\n网络有点慢，是否重试？', [
          { text: '取消', style: 'cancel' },
          { text: '重试', onPress: () => handleAnalyzeScene() },
        ]);
      } else if (typeof msg === 'string' && (msg.includes('无法解析') || msg.includes('格式'))) {
        Alert.alert(
          '识别失败',
          '照片可能太模糊，或者没有清晰的物体。请重新拍摄一张更清晰的照片试试。',
          [{ text: '好的', style: 'default' }]
        );
      } else if (typeof msg === 'string' && msg.includes('网络')) {
        Alert.alert(
          '网络问题',
          '请检查网络连接后重试。',
          [
            { text: '取消', style: 'cancel' },
            { text: '重试', onPress: () => handleAnalyzeScene() },
          ]
        );
      } else {
        Alert.alert(
          '分析失败',
          '请重新拍摄一张更清晰的照片试试。\n\n错误详情: ' + msg,
          [{ text: '好的', style: 'default' }]
        );
      }
    }
  }, [photo]);

  // ====== 裁剪图片 + AI 识别（异步非阻塞）=====>
  //
  // Pipeline 逻辑：
  // 1. 裁剪 ROI → AI 识别 → 得到单词+翻译+例句
  // 2. 立即返回数据给 UI 气泡，不等待保存完成
  // 3. 后台异步静默保存（fire-and-forget），通过 saveMsg 反馈
  // =================================
  const cropAndAnalyze = useCallback(
    async (point: DetectionPoint, snapUri?: string): Promise<{ word: string; translation: string; examples: Array<{ en: string; cn: string }>; saved: boolean } | null> => {
      try {
        const cached = croppedCacheRef.current.get(point.id);
        if (cached) {
          return { ...cached, saved: false };
        }

        let sourceUri = snapUri;
        if (!sourceUri) {
          if (!cameraRef.current) return null;
          const snap = await cameraRef.current.takePictureAsync({ quality: 0.6 });
          if (!snap?.uri) return null;
          sourceUri = snap.uri;
        }

        const info = await ImageManipulator.manipulateAsync(sourceUri, [], { format: ImageManipulator.SaveFormat.JPEG });
        const imgW = info.width;
        const imgH = info.height;
        if (!imgW || !imgH) return null;

        // 计算裁剪区域
        const roiX = point.bbox?.[0] ?? (point.x / 100) * imgW;
        const roiY = point.bbox?.[1] ?? (point.y / 100) * imgH;
        const roiW = point.bbox?.[2] ?? Math.min(imgW * 0.3, 200);
        const roiH = point.bbox?.[3] ?? Math.min(imgH * 0.3, 200);

        const centerX = roiX + roiW / 2;
        const centerY = roiY + roiH / 2;
        const halfCrop = CROP_SIZE / 2;

        let cropX = Math.max(0, centerX - halfCrop);
        let cropY = Math.max(0, centerY - halfCrop);
        let cropW = CROP_SIZE;
        let cropH = CROP_SIZE;

        if (cropX + cropW > imgW) { cropX = Math.max(0, imgW - cropW); }
        if (cropY + cropH > imgH) { cropY = Math.max(0, imgH - cropH); }
        if (cropX + cropW > imgW) { cropW = imgW - cropX; }
        if (cropY + cropH > imgH) { cropH = imgH - cropY; }

        const cropped = await ImageManipulator.manipulateAsync(
          sourceUri,
          [{ crop: { originX: Math.round(cropX), originY: Math.round(cropY), width: Math.round(cropW), height: Math.round(cropH) } }],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8, base64: true }
        );
        if (!cropped.base64) return null;

        // Step 1: AI 识别 → 同步等待完整 JSON 解析
        const result = await analyzeCroppedPatch(cropped.base64, API_KEY);

        // Step 2: 数据校验 — AI 必须返回例句，否则报错
        if (!result.examples || result.examples.length === 0) {
          console.error('❌ AI 返回的例句为空');
          throw new Error('AI 未能生成例句，请重试');
        }
        const finalExamples = result.examples.map((ex: { en: string; cn: string }) => ({ e: ex.en, c: ex.cn }));

        const entry: CroppedCacheEntry = { word: result.word, translation: result.translation, examples: finalExamples.map(ex => ({ en: ex.e, cn: ex.c })) };
        croppedCacheRef.current.set(point.id, entry);

        // Step 3: 【立即返回 UI 气泡】不等待保存
        // 后台异步保存（fire-and-forget）
        console.log("🚀 AI 识别完成，立即弹出气泡，后台静默保存中...");
        const wordForSave = result.word;
        const transForSave = result.translation;
        const examplesForSave = [...finalExamples];
        (async () => {
          try {
            const status = await autoAddVocabulary(wordForSave, transForSave, examplesForSave, 'camera', '', undefined);
            const saved = (status === 'saved');
            if (saved) {
              console.log('✅ 后台保存成功（新词）:', wordForSave);
              setSaveMsg('✅ 已自动同步至生词本');
              setSaveMsgType('success');
            } else {
              console.log('ℹ️ 后台跳过（重复词）:', wordForSave);
            }
            // 记录学习活动（异步，不阻塞）
            // 分数设为 0，因为还没有进行口语练习；分数会在口语练习后更新，取最高分
            recordLearningActivity(wordForSave, 0, 'camera').catch((e: any) =>
              console.warn(`   ⚠️ 记录学习活动失败: ${wordForSave}`, e)
            );
            // 检查勋章解锁（拍照相关）
            checkCameraAchievements(wordForSave, 0).then((newlyUnlocked) => {
              if (newlyUnlocked.length > 0) {
                // 显示成就解锁弹窗（取第一个解锁的勋章）
                setUnlockedBadgeId(newlyUnlocked[0]);
                setShowAchievementModal(true);
              }
            }).catch((e: any) =>
              console.warn('   ⚠️ 检查勋章失败:', e)
            );
          } catch (saveError: any) {
            const errMsg = saveError?.message || '';
            console.error('❌ 后台保存失败:', wordForSave, errMsg);
            // 数据完整性校验失败 → 显示用户友好的错误提示
            if (errMsg.includes('数据生成不完整') || errMsg.includes('数据完整性校验失败')) {
              setSaveMsg('⚠️ 数据生成不完整，请尝试重新识别');
              setSaveMsgType('error');
            } else {
              setSaveMsg('❌ 存储写入失败，请检查磁盘空间');
              setSaveMsgType('error');
            }
          }
        })();

        return { word: result.word, translation: result.translation, examples: entry.examples, saved: true };
      } catch (error) {
        console.error('裁剪识别失败:', error);
        return null;
      }
    },
    []
  );

  // ====== 点击检测点 ======
  const handleDetectionPress = useCallback(
    async (point: DetectionPoint) => {
      if (selectedId === point.id) { setSelectedId(null); return; }
      setSelectedId(point.id);
      setIsLoadingPhrase(true);
      setSelectedPhrases(null);
      setSelectedIndex(-1);

      const requestId = ++globalRequestId;
      const cached = croppedCacheRef.current.get(point.id);
      if (cached) {
        setTimeout(() => {
          if (requestId === globalRequestId) {
            setSelectedPhrases(cached.examples.map(ex => ({ e: ex.en, c: ex.cn })));
            setIsLoadingPhrase(false);
          }
        }, 300);
        return;
      }

      isAnalyzingRef.current = true;
      let entry: Awaited<ReturnType<typeof cropAndAnalyze>> = null;
      try {
        entry = await cropAndAnalyze(point);
      } finally {
        isAnalyzingRef.current = false;
      }
      if (requestId !== globalRequestId) return;

      if (entry) {
        setSelectedPhrases(entry.examples.map(ex => ({ e: ex.en, c: ex.cn })));
        // 保存是后台异步进行的 — 气包始终显示"已自动收藏"的标识
        // save toast 由 cropAndAnalyze 内部的 fire-and-forget 触发
      } else {
        // cropAndAnalyze 返回 null → 显示错误 Toast
        setSaveMsg('❌ 存储写入失败，请检查磁盘空间');
        setSaveMsgType('error');
        try {
          const phrases = await fetchPhrasesForObject(point.l, API_KEY, false, 'camera');
          if (requestId === globalRequestId) setSelectedPhrases(phrases);
        } catch {
          if (requestId === globalRequestId) setSelectedPhrases([]);
        }
      }
      if (requestId === globalRequestId) setIsLoadingPhrase(false);
    },
    [selectedId, cropAndAnalyze]
  );

  // ====== 点击 AI 锚点 ======
  const handleAnchorPress = useCallback(
    async (obj: AiObject, index: number) => {
      if (selectedIndex === index) { setSelectedIndex(null); setSelectedPhrases(null); setSelectedId(null); return; }
      setSelectedIndex(index);
      setSelectedId(null);
      setIsLoadingPhrase(true);
      setSelectedPhrases(null);

      if (obj.phrases && obj.phrases.length > 0) { setSelectedPhrases(obj.phrases); setIsLoadingPhrase(false); return; }

      // 优先检查预加载缓存
      const wordKey = obj.l.toLowerCase().trim();
      const preloaded = preloadCacheRef.current.get(wordKey);
      if (preloaded) {
        const phrases: PhraseItem[] = [
          { e: preloaded.example_en_1, c: preloaded.example_cn_1 },
          { e: preloaded.example_en_2, c: preloaded.example_cn_2 },
        ];
        setSelectedPhrases(phrases);
        setIsLoadingPhrase(false);
        console.log(`📦 预加载缓存命中: ${wordKey}`);
        return;
      }

      const requestId = ++globalRequestId;
      try {
        const phrases = await fetchPhrasesForObject(obj.l, API_KEY, false, 'camera');
        if (requestId !== globalRequestId) return;
        if (aiData) {
          const updated = [...aiData.objects];
          if (updated[index]) updated[index] = { ...updated[index], phrases };
          setAiData({ ...aiData, objects: updated });
        }
        setSelectedPhrases(phrases);
      } catch {
        if (requestId === globalRequestId) setSelectedPhrases([]);
      } finally {
        if (requestId === globalRequestId) setIsLoadingPhrase(false);
      }
    },
    [selectedIndex, aiData]
  );

  // ====== 自动 TTS ======
  const handleSpeakWord = useCallback((text: string) => {
    speak(text);
  }, [speak]);

  useEffect(() => {
    if (selectedId && selectedPhrases && selectedPhrases.length > 0 && !isLoadingPhrase) {
      const label = detectionPoints.find(p => p.id === selectedId)?.l;
      if (label && !hasAutoSpoken.current) {
        hasAutoSpoken.current = true;
        const timer = setTimeout(() => handleSpeakWord(label), 300);
        return () => clearTimeout(timer);
      }
    } else {
      hasAutoSpoken.current = false;
    }
  }, [selectedId, selectedPhrases, isLoadingPhrase, detectionPoints, handleSpeakWord]);

  // ====== 搜索查词 ======
  const handleSearchSubmit = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchResult(null);
    try {
      const result = await searchWordDefinition(q, API_KEY);
      setSearchResult(result);
      setShowSearchModal(true);
      // 查词结果不自动保存，用户点击五角星时才手动收藏
    } catch (error: any) {
      Alert.alert('查词失败', error.message || '未知错误');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // ====== 生词本 ======
  const loadVocab = useCallback(async () => {
    setIsLoadingVocab(true);
    try {
      const list = await getVocabulary();
      setVocabList(list);
    } catch {} finally { setIsLoadingVocab(false); }
  }, []);

  const handleOpenVocab = useCallback(async () => {
    await loadVocab();
    setShowVocabModal(true);
  }, [loadVocab]);

  // ====== 录音（口语练习） ======
  const handleStartRecording = useCallback(async (phraseIdx: number) => {
    try {
      const granted = await requestAudioPermission();
      if (!granted) {
        Alert.alert('需要麦克风权限', '请在设置中允许麦克风权限以使用口语练习功能。');
        return;
      }
      setRecordingPhraseIdx(phraseIdx);
      setIsRecording(true);
      setRecordScore(null);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await startRecording();
    } catch (error) {
      console.error('录音启动失败:', error);
      setIsRecording(false);
      setRecordingPhraseIdx(null);
    }
  }, []);

  const handleStopRecording = useCallback(async () => {
    setIsRecording(false);
    try {
      const uri = await stopRecording();
      if (uri) {
        // 模拟评测
        const score = evaluateRecording('');
        setRecordScore(score);
        Alert.alert(
          '发音评测结果',
          `得分: ${score.score}/100\n等级: ${score.level}\n\n${score.feedback}`,
          [{ text: '知道了' }]
        );
      }
    } catch (error) {
      console.error('录音停止失败:', error);
    }
    setRecordingPhraseIdx(null);
  }, []);

  // ====== 选中锚点超出安全区时自动清除 ======
  // ⚠️ 此 useEffect 必须在所有条件返回之前声明，确保 Hook 调用顺序一致
  const previewButtonHeight = 42;
  const previewDockReservedHeight = previewButtonHeight + 10 + Math.max(insets.bottom, 10);
  const NO_TARGET_ZONE = {
    top: Math.max(0, 100 - (previewDockReservedHeight / PREVIEW_HEIGHT) * 100),
    bottom: 100,
  };
  useEffect(() => {
    if (
      selectedIndex !== null &&
      aiData &&
      selectedIndex >= 0 &&
      selectedIndex < aiData.objects.length &&
      aiData.objects[selectedIndex]?.y != null &&
      aiData.objects[selectedIndex]!.y > NO_TARGET_ZONE.top
    ) {
      setSelectedIndex(null);
      setSelectedPhrases(null);
      setSelectedId(null);
    }
  }, [selectedIndex, aiData, NO_TARGET_ZONE.top]);

  // ====== 权限 ======
  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>需要相机权限</Text>
          <Text style={styles.permissionDescription}>
            为了能够拍照并分析场景中的英语内容，我们需要访问您的相机。
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => {
              if (Platform.OS === 'ios') Linking.openURL('app-settings:');
              else requestPermission();
            }}>
            <Text style={styles.permissionButtonText}>重新授权</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const selectedObject = (selectedIndex !== null && selectedIndex >= 0 && aiData?.objects[selectedIndex]) || null;
  const selectedDetectionPoint = selectedId && selectedId.startsWith('det_')
    ? detectionPoints.find((p) => p.id === selectedId) || null
    : null;
  const displayLabel = selectedObject?.l || selectedDetectionPoint?.l || '';
  const displayTranslation = selectedObject?.t || selectedDetectionPoint?.t || '';

  const shootingDockReservedHeight = 96 + Math.max(insets.bottom, 12);
  const shootingNoTargetZoneStart = Math.max(0, 100 - (shootingDockReservedHeight / PREVIEW_HEIGHT) * 100);
  const filteredDetectionPoints = detectionPoints.filter((point) => point.y <= shootingNoTargetZoneStart);

  const visibleAnchorObjects = aiData?.objects
    .map((obj, idx) => ({ obj, idx }))
    .filter(({ obj }) => obj.y <= NO_TARGET_ZONE.top) ?? [];


  const onPinchGestureEvent = (event: any) => {
    const scale = event.nativeEvent.scale;
    const nextZoom = Math.min(1, Math.max(0, baseZoom.current + (scale - 1) * 0.8));
    setZoom(nextZoom);
  };

  const onPinchHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED || event.nativeEvent.state === State.FAILED) {
      baseZoom.current = zoom;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden={mode === 'shooting'} />

      {mode === 'shooting' ? (
        <>
          {/* CameraView 不包含任何子节点 — 所有 UI 作为同级 absolute 覆盖层 */}
          <PinchGestureHandler
            onGestureEvent={onPinchGestureEvent}
            onHandlerStateChange={onPinchHandlerStateChange}
          >
            <View style={styles.cameraWrap}>
              <CameraView ref={cameraRef} style={styles.camera} facing="back" ratio="4:3" zoom={zoom} />

            {/* 实时检测覆盖层 — 仅模型加载成功后才显示 */}
            {!modelLoading && detector.loaded && (
              <DetectionOverlay
                detections={filteredDetectionPoints}
                selectedId={selectedId}
                scanningId={isLoadingPhrase && selectedId?.startsWith('det_') ? selectedId : null}
                onPress={handleDetectionPress}
                style={{ bottom: shootingDockReservedHeight }}
              />
            )}

            {/* 模型加载提示 */}
            {modelLoading && (
              <View style={styles.modelLoadingBanner}>
                <ActivityIndicator size="small" color="#FF6B6B" />
                <Text style={styles.modelLoadingText}>正在加载实时检测模型...</Text>
              </View>
            )}

            {/* 检测到的物体计数 */}
            {!modelLoading && detectionPoints.length > 0 && (
              <View style={styles.detectionCountBanner}>
                <Text style={styles.detectionCountText}>🔍 {detectionPoints.length} 个物体</Text>
              </View>
            )}

          </View>
          </PinchGestureHandler>

          {/* 拍照快门 — 悬浮在底部导航栏上方 */}
          <View style={[styles.shutterArea, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TouchableOpacity
              style={styles.shutterButton}
              onPress={handleTakePicture}
              disabled={isCapturing}
              activeOpacity={0.7}>
              {isCapturing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <View style={styles.shutterOuterRing} />
                  <View style={styles.shutterInnerCircle} />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* 自动收藏反馈提示 */}
          {saveMsg && (
            <View style={[styles.saveToast, saveMsgType === 'error' && styles.saveToastError]}>
              <Text style={styles.saveToastText}>{saveMsg}</Text>
            </View>
          )}

          {/* DetailCard */}
          {selectedDetectionPoint && (
            <DetailCard
              label={displayLabel}
              translation={displayTranslation}
              phrases={selectedPhrases}
              isLoading={isLoadingPhrase}
              onSpeak={handleSpeakWord}
              onClose={() => {
                setSelectedId(null);
                setSelectedPhrases(null);
                stopSpeech();
              }}
            />
          )}
        </>
      ) : (
        <View style={styles.previewContainer}>
          {/* ====== 上方：图片展示区 ====== */}
          <View style={styles.previewImageArea}>
            <View style={styles.imageWrapper} onLayout={(e) => {
              const { width, height, x, y } = e.nativeEvent.layout;
              setImageLayout({ width, height, offsetX: x, offsetY: y });
            }}>
              {photo && (
                <Image
                  source={{ uri: photo }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              )}
              {visibleAnchorObjects.map(({ obj, idx }) => (
                <AnchorPointComponent
                  key={`${obj.l}-${idx}`}
                  obj={obj}
                  isSelected={selectedIndex === idx}
                  isLoadingPhrase={isLoadingPhrase && selectedIndex === idx}
                  onPress={() => handleAnchorPress(obj, idx)}
                  imageLayout={imageLayout}
                  imageAspect={imageAspectRatio}
                />
              ))}
            </View>

            {isAnalyzing && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>正在进行扫描识别，大约需要 20 秒</Text>
              </View>
            )}
          </View>

          {/* ====== 下方：黑色控制操作区（固定高度，不遮挡图片） ====== */}
          <View style={[styles.previewControlsBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={styles.previewControlsInner}>
              <TouchableOpacity style={[styles.dockActionBtn, styles.retakeBtn]} onPress={handleRetake} activeOpacity={0.7}>
                <Feather name="rotate-ccw" size={18} color="#fff" />
                <Text style={styles.dockActionText}>重拍</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dockActionBtn, aiData ? styles.analyzedBtn : styles.analyzeBtn]}
                onPress={handleAnalyzeScene}
                activeOpacity={0.7}
                disabled={isAnalyzing}>
                <Feather name="zap" size={18} color="#fff" />
                <Text style={styles.dockActionText}>{aiData ? '重新分析' : '分析场景'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {selectedObject && (
            <DetailCard
              label={selectedObject.l}
              translation={selectedObject.t}
              phrases={selectedPhrases}
              isLoading={isLoadingPhrase}
              onSpeak={handleSpeakWord}
              onClose={() => {
                setSelectedIndex(null);
                setSelectedPhrases(null);
                stopSpeech();
              }}
            />
          )}
        </View>
      )}

      {/* 查词结果 Modal */}
      <Modal visible={showSearchModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>查词结果</Text>
              <TouchableOpacity onPress={() => setShowSearchModal(false)}>
                <Feather name="x" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {searchResult ? (
              <ScrollView>
                <View style={styles.searchWordRow}>
                  <View>
                    <Text style={styles.searchWordLabel}>{searchResult.l}</Text>
                    <Text style={styles.searchWordTranslation}>{searchResult.t}</Text>
                  </View>
                  <TouchableOpacity style={styles.speakBtnSmall} onPress={() => handleSpeakWord(searchResult.l)}>
                    <Feather name="volume-2" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                <View style={styles.divider} />
                {searchResult.examples.map((example, i) => (
                  <View key={i} style={styles.searchPhraseItem}>
                    <Text style={styles.searchPhraseEn}>• {example.e}</Text>
                    <Text style={styles.searchPhraseCn}>{example.c}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.searchEmpty}>
                <Text style={styles.searchEmptyText}>{isSearching ? '查询中...' : '未找到结果'}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* 生词本 Modal */}
      <Modal visible={showVocabModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📖 生词本 ({vocabList.length})</Text>
              <TouchableOpacity onPress={() => setShowVocabModal(false)}>
                <Feather name="x" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {isLoadingVocab ? (
              <ActivityIndicator size="large" color="#FF6B6B" style={{ marginTop: 40 }} />
            ) : vocabList.length === 0 ? (
              <View style={styles.searchEmpty}>
                <Text style={styles.searchEmptyText}>还没有生词，拍照识别后自动添加</Text>
              </View>
            ) : (
              <FlatList
                data={vocabList}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.vocabItem}>
                    <View style={styles.vocabItemLeft}>
                      <Text style={styles.vocabWord}>{item.word}</Text>
                      <Text style={styles.vocabTrans}>{item.translation}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleSpeakWord(item.word)} style={styles.vocabSpeakBtn}>
                      <Feather name="volume-2" size={18} color="#FF6B6B" />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* 成就解锁弹窗 */}
      <AchievementUnlockModal
        isVisible={showAchievementModal}
        badgeId={unlockedBadgeId}
        onClose={() => setShowAchievementModal(false)}
      />
    </View>
  );
}

// ======================== DetailCard 组件 ========================
/**
 * DetailCard — 拍照识图结果气泡组件
 *
 * ⚠️ 功能边界：
 *   拍照识图模块仅为展示+朗读，不含任何录音/评测逻辑。
 *   所有例句右侧使用 🔊 播放按钮（TTS 朗读），无麦克风/录音按钮。
 *
 *   口语练习模块的录音评测逻辑在 app/practice.tsx 中单独实现。
 */
function DetailCard({
  label,
  translation,
  phrases,
  isLoading,
  onSpeak,
  onClose,
}: {
  label: string;
  translation: string;
  phrases: PhraseItem[] | null;
  isLoading: boolean;
  onSpeak: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.detailCard}>
      <View style={styles.detailCardContent}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 单词行 */}
          <View style={styles.wordRow}>
            <View style={styles.wordInfo}>
              <Text
                style={styles.wordLabel}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {label}
              </Text>
              <Text style={styles.wordTranslation}>{translation}</Text>
            </View>
            <View style={styles.wordActions}>
              <TouchableOpacity style={styles.speakButton} onPress={() => onSpeak(label)}>
                <Feather name="volume-2" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.divider} />
          <Text style={styles.phrasesTitle}>例句</Text>

          {isLoading && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color="#FF6B6B" />
              <Text style={styles.thinkingText}>Targeting...</Text>
            </View>
          )}

          {!isLoading && phrases && phrases.length > 0 && phrases.map((phrase, idx) => (
            <View key={idx} style={styles.phraseItem}>
              <View style={styles.phraseRow}>
                <View style={styles.phraseTextArea}>
                  <View style={styles.exampleHeader}>
                    <View style={styles.exampleNum}>
                      <Text style={styles.exampleNumText}>{idx + 1}</Text>
                    </View>
                  </View>
                  <DashedWords text={phrase.e} style={styles.phraseEn} />
                  <DashedWords text={phrase.c} style={styles.phraseCn} />
                </View>
                {/* 🔊 播放按钮：点击 TTS 朗读例句，无录音/评测 */}
                <TouchableOpacity
                  style={styles.phraseSpeakBtn}
                  onPress={() => onSpeak(phrase.e)}
                  activeOpacity={0.7}
                >
                  <Feather name="volume-2" size={18} color="#FF6B6B" />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {!isLoading && phrases && phrases.length === 0 && (
            <Text style={styles.noPhraseText}>暂无例句</Text>
          )}
        </ScrollView>
      </View>
      <TouchableOpacity style={styles.closeCardButton} onPress={onClose}>
        <Text style={styles.closeCardText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ======================== 辅助函数 ========================
function base64ToPixelData(base64: string, size: number): Uint8Array {
  return new Uint8Array(size * size * 4).fill(128);
}

// ======================== AnchorPointComponent（预览模式） ========================
function AnchorPointComponent({
  obj,
  isSelected,
  isLoadingPhrase,
  onPress,
  imageLayout,
  imageAspect,
}: {
  obj: AiObject;
  isSelected: boolean;
  isLoadingPhrase: boolean;
  onPress: () => void;
  imageLayout: { width: number; height: number; offsetX: number; offsetY: number };
  imageAspect: number;
}) {
  const dotSize = obj.size === 'S' ? 8 : 16;
  const scaleAnim = useRef(new Animated.Value(isSelected ? 1.5 : 1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isSelected) {
      Animated.spring(scaleAnim, { toValue: 1.5, friction: 4, useNativeDriver: true }).start();
      if (isLoadingPhrase) {
        pulseAnim.setValue(0);
        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
          ])
        );
        pulseRef.current.start();
      } else {
        if (pulseRef.current) { pulseRef.current.stop(); pulseRef.current = null; }
        pulseAnim.setValue(0);
      }
    } else {
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }).start();
      if (pulseRef.current) { pulseRef.current.stop(); pulseRef.current = null; }
      pulseAnim.setValue(0);
    }
  }, [isSelected, isLoadingPhrase, scaleAnim, pulseAnim]);

  const combinedScale = Animated.multiply(
    scaleAnim,
    isLoadingPhrase ? Animated.add(1, Animated.multiply(pulseAnim, 0.15)) : new Animated.Value(1)
  );

  const dotBorderStyle = isSelected ? styles.anchorDotSelected : styles.anchorDotDefault;
  const dotBgColor = isSelected ? YELLOW_LEARN : ANCHOR_COLOR;
  const showTooltipAbove = obj.y > 15;

  // 基于实际图片尺寸计算坐标位置
  // obj.x 和 obj.y 是 0-100 的百分比，需要转换为实际像素位置
  //
  // ⚠️ 关键修正：图片使用 resizeMode="contain"，实际显示区域可能小于容器
  // 需要计算图片在容器内的实际显示 rect（考虑 letterboxing），
  // 然后基于实际图片显示区域进行坐标映射。
  const dotPositionStyle = (() => {
    if (imageLayout.width > 0 && imageLayout.height > 0) {
      // 计算图片在 contain 模式下的实际显示尺寸
      // 使用容器宽高比与图片实际宽高比对比，确定 letterboxing 方向
      const containerAspect = imageLayout.width / imageLayout.height;
      // 使用从压缩图片获取的实际宽高比（见 handleTakePicture 中的 setImageAspectRatio）
      // 这确保了 AI 看到的图片比例与显示时的图片比例一致

      let displayWidth: number;
      let displayHeight: number;
      let offsetX = 0;
      let offsetY = 0;

      if (containerAspect > imageAspect) {
        // 容器更宽 → 上下有黑边（letterboxing）
        displayHeight = imageLayout.height;
        displayWidth = displayHeight * imageAspect;
        offsetX = (imageLayout.width - displayWidth) / 2;
        offsetY = 0;
      } else {
        // 容器更高 → 左右有黑边（pillarboxing）
        displayWidth = imageLayout.width;
        displayHeight = displayWidth / imageAspect;
        offsetX = 0;
        offsetY = (imageLayout.height - displayHeight) / 2;
      }

      // 将 AI 返回的百分比坐标映射到实际图片显示区域
      const left = Math.round((obj.x / 100) * displayWidth + offsetX);
      const top = Math.round((obj.y / 100) * displayHeight + offsetY);

      return {
        position: 'absolute' as const,
        left,
        top,
        width: dotSize,
        height: dotSize,
        marginLeft: -dotSize / 2,
        marginTop: -dotSize / 2,
      };
    }
    // 回退到百分比定位（图片尺寸未加载时）
    return {
      position: 'absolute' as const,
      left: `${obj.x}%`,
      top: `${obj.y}%`,
      width: dotSize,
      height: dotSize,
      marginLeft: -dotSize / 2,
      marginTop: -dotSize / 2,
    };
  })() as any;

  return (
    <View
      style={[
        styles.anchorWrapper,
        dotPositionStyle,
      ]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        <View
          style={[
            styles.anchorDot,
            { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: dotBgColor },
            dotBorderStyle,
          ]}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { borderRadius: dotSize / 2, transform: [{ scale: combinedScale }] }]}
          />
        </View>
      </TouchableOpacity>
      {isSelected && (
        <View
          style={[
            styles.tooltip,
            showTooltipAbove ? { bottom: dotSize / 2 + 12 } : { top: dotSize / 2 + 12 },
          ]}
          pointerEvents="none">
          <Text style={styles.tooltipText} numberOfLines={1}>{obj.l}</Text>
          {isLoadingPhrase && <ActivityIndicator size="small" color="#FFD93D" style={{ marginLeft: 6 }} />}
          <View style={[styles.tooltipArrow, showTooltipAbove ? styles.tooltipArrowDown : styles.tooltipArrowUp]} />
        </View>
      )}
    </View>
  );
}

// ======================== 样式 ========================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cameraWrap: { height: PREVIEW_HEIGHT, width: '100%', position: 'relative' },
  camera: { flex: 1 },
  previewContainer: { flex: 1, backgroundColor: '#000' },
  previewImageArea: { flex: 1, position: 'relative' },
  imageWrapper: { flex: 1, position: 'relative' },
  previewImage: { flex: 1, width: '100%', height: '100%', resizeMode: 'contain' },
  previewControlsBar: {
    backgroundColor: '#000000',
    paddingTop: 16,
  },
  previewControlsInner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },

  // 顶部搜索组件
  topArea: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, zIndex: 30,
    alignItems: 'center',
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12, paddingHorizontal: 12, height: 44,
    marginRight: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, color: '#333' },
  closeButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  // 底部导航坞
  bottomDock: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    zIndex: 25,
  },
  dockItem: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minWidth: 60 },
  dockIconWrapper: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  dockLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginTop: 4 },

  // 纯净模式底部（只有快门，无背景遮挡相机预览）
  identifyBottomDock: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingTop: 12, zIndex: 25,
  },
  // 快门区域 — 居中 + 底部留白
  shutterArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingTop: 12, zIndex: 25,
  },
  // 拍照按钮
  shutterButton: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  shutterOuterRing: {
    position: 'absolute', width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterInnerCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  // 预览底部控制按钮
  dockActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minWidth: 120, height: 44, paddingHorizontal: 16, borderRadius: 14,
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  dockActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  retakeBtn: {
    backgroundColor: 'rgba(255,182,193,0.35)',
    borderColor: 'rgba(255,182,193,0.7)',
  },
  analyzeBtn: {
    backgroundColor: 'rgba(255,182,193,0.35)',
    borderColor: 'rgba(255,182,193,0.7)',
  },
  analyzedBtn: {
    backgroundColor: 'rgba(255,182,193,0.35)',
    borderColor: 'rgba(255,182,193,0.7)',
  },

  // DetailCard
  detailCard: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    backgroundColor: '#262626', borderRadius: 16,
    paddingTop: 20, paddingBottom: 16, paddingHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 16, zIndex: 80, maxHeight: 300,
  },
  detailCardContent: { maxHeight: 240 },
  wordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordInfo: { flex: 1, marginRight: 12, minWidth: 0 },
  wordLabel: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', flexWrap: 'nowrap', flexShrink: 1 },
  wordTranslation: { fontSize: 16, color: '#BBBBBB', marginTop: 2 },
  wordActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  speakButton: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', marginLeft: 12,
  },
  autoSavedBadge: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    marginRight: 8,
  },
  autoSavedBadgeText: {
    fontSize: 12, color: '#34C759', fontWeight: '600',
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 14 },
  phrasesTitle: {
    fontSize: 14, fontWeight: '700', color: '#BBBBBB',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },

  // 例句行（含麦克风）
  phraseItem: { paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  phraseRow: { flexDirection: 'row', alignItems: 'center' },
  exampleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  exampleNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF6B6B',
    alignItems: 'center', justifyContent: 'center',
  },
  exampleNumText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  phraseTextArea: { flex: 1 },
  phraseEn: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', lineHeight: 22 },
  phraseCn: { fontSize: 14, color: '#BBBBBB', marginTop: 8, lineHeight: 20 },
  phraseSpeakBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: '#FF6B6B',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  micButton: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: '#FF6B6B',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  micButtonActive: { backgroundColor: '#FF6B6B' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingLeft: 4 },
  scoreText: { fontSize: 18, fontWeight: '800', marginRight: 8 },
  scoreLevel: { fontSize: 14, color: '#666' },

  thinkingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  thinkingText: { marginLeft: 8, fontSize: 15, color: '#FFD93D', fontWeight: '700' },
  noPhraseText: { fontSize: 14, color: '#BBBBBB', fontStyle: 'italic', paddingVertical: 8 },
  closeCardButton: {
    position: 'absolute', top: 8, right: 12,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeCardText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  // 权限
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  permissionIcon: { fontSize: 64, marginBottom: 20 },
  permissionTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  permissionDescription: {
    color: 'rgba(255,255,255,0.7)', fontSize: 15, textAlign: 'center',
    lineHeight: 22, marginBottom: 32,
  },
  permissionButton: { backgroundColor: '#fff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  permissionButtonText: { color: '#000', fontSize: 16, fontWeight: '600' },

  // 模型加载 & 检测计数
  modelLoadingBanner: {
    position: 'absolute', bottom: 100, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', zIndex: 15,
  },
  modelLoadingText: { color: '#fff', fontSize: 14, marginLeft: 8 },
  detectionCountBanner: {
    position: 'absolute', top: 60, right: 16,
    backgroundColor: 'rgba(255,107,107,0.8)', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6, zIndex: 15,
  },
  detectionCountText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // 自动收藏反馈 Toast
  saveToast: {
    position: 'absolute', bottom: 80, alignSelf: 'center',
    backgroundColor: 'rgba(52,199,89,0.92)',
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10,
    zIndex: 90,
    shadowColor: '#34C759', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 12,
  },
  saveToastError: {
    backgroundColor: 'rgba(255,59,48,0.92)',
    shadowColor: '#FF3B30',
  },
  saveToastText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // 锚点
  anchorWrapper: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  anchorDotDefault: {
    borderWidth: 3, borderColor: 'rgba(255, 107, 107, 0.5)',
    shadowColor: ANCHOR_COLOR, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 10, elevation: 10,
  },
  anchorDotSelected: {
    borderWidth: 3, borderColor: 'rgba(255, 215, 0, 0.6)',
    shadowColor: YELLOW_LEARN, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 14, elevation: 14,
  },
  anchorDot: {},
  tooltip: {
    position: 'absolute', backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', zIndex: 20,
    shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 8, elevation: 8,
  },
  tooltipText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  tooltipArrow: {
    position: 'absolute', width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', alignSelf: 'center',
  },
  tooltipArrowUp: { top: -6, borderBottomWidth: 6, borderBottomColor: 'rgba(0,0,0,0.85)' },
  tooltipArrowDown: { bottom: -6, borderTopWidth: 6, borderTopColor: 'rgba(0,0,0,0.85)' },

  // Intro (已移除 — 不再显示英文引导提示框)
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  loadingText: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '70%', minHeight: '40%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  searchWordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchWordLabel: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  searchWordTranslation: { fontSize: 18, color: '#666', marginTop: 4 },
  speakBtnSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center' },
  searchPhraseItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  searchPhraseEn: { fontSize: 16, fontWeight: '600', color: '#333', lineHeight: 22 },
  searchPhraseCn: { fontSize: 14, color: '#888', marginTop: 4, lineHeight: 20 },
  searchEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  searchEmptyText: { fontSize: 15, color: '#999' },

  // 生词本
  vocabItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  vocabItemLeft: { flex: 1 },
  vocabWord: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  vocabTrans: { fontSize: 14, color: '#666', marginTop: 2 },
  vocabSpeakBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,107,107,0.1)', alignItems: 'center', justifyContent: 'center' },
});
