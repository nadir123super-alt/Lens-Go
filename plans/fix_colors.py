import re

# ===== 1. camera.tsx - 重拍/分析场景按钮改为粉色 =====
f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\camera.tsx', 'r', encoding='utf-8')
c = f.read()
f.close()

old = 'retakeBtn: {},\n  analyzeBtn: {},\n  analyzedBtn: {\n    backgroundColor: \'rgba(52,199,89,0.25)\',\n    borderColor: \'rgba(52,199,89,0.6)\',\n  },'
new = 'retakeBtn: {\n    backgroundColor: \'rgba(255,107,157,0.25)\',\n    borderColor: \'rgba(255,107,157,0.6)\',\n  },\n  analyzeBtn: {\n    backgroundColor: \'rgba(255,107,157,0.25)\',\n    borderColor: \'rgba(255,107,157,0.6)\',\n  },\n  analyzedBtn: {\n    backgroundColor: \'rgba(255,107,157,0.25)\',\n    borderColor: \'rgba(255,107,157,0.6)\',\n  },'
c = c.replace(old, new)

f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\camera.tsx', 'w', encoding='utf-8')
f.write(c)
f.close()
print('1. camera.tsx done')


# ===== 2. practice.tsx - 红色全部改为蓝色 =====
f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\practice.tsx', 'r', encoding='utf-8')
c = f.read()
f.close()

# ANCHOR constant
c = c.replace("const ANCHOR = '#FF6B6B';", "const ANCHOR = '#5B7FFF';")

# rgba(255,107,107,0.85) -> rgba(91,127,255,0.85)
c = c.replace('rgba(255,107,107,0.85)', 'rgba(91,127,255,0.85)')

# rgba(255,107,107,0.12) -> rgba(91,127,255,0.12)
c = c.replace('rgba(255,107,107,0.12)', 'rgba(91,127,255,0.12)')

# #FF4D4F -> #4A6FE0 (similar darkness level)
c = c.replace('#FF4D4F', '#4A6FE0')

# #FF3B30 -> #3558CC (similar darkness level)
c = c.replace('#FF3B30', '#3558CC')

f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\practice.tsx', 'w', encoding='utf-8')
f.write(c)
f.close()
print('2. practice.tsx done')


# ===== 3. search.tsx - 搜索按钮和🔍图标改为绿色 =====
f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\search.tsx', 'r', encoding='utf-8')
c = f.read()
f.close()

# searchButton backgroundColor
c = c.replace("backgroundColor: '#FF6B6B',\n    alignItems: 'center',\n    justifyContent: 'center',\n  },\n  searchButtonText:", "backgroundColor: '#44D66C',\n    alignItems: 'center',\n    justifyContent: 'center',\n  },\n  searchButtonText:")

# emptyIconWrap backgroundColor
c = c.replace("backgroundColor: 'rgba(255,107,107,0.12)'", "backgroundColor: 'rgba(68,214,108,0.12)'")

# empty state search icon color
c = c.replace('<Feather name="search" size={48} color="#FF6B6B" />', '<Feather name="search" size={48} color="#44D66C" />')

# speakButton backgroundColor + shadowColor
c = c.replace("backgroundColor: '#FF6B6B',\n    alignItems: 'center', justifyContent: 'center',\n    shadowColor: '#FF6B6B', shadowOffset:", "backgroundColor: '#44D66C',\n    alignItems: 'center', justifyContent: 'center',\n    shadowColor: '#44D66C', shadowOffset:")

# detailButton backgroundColor
c = c.replace("backgroundColor: '#FF6B6B',\n    gap: 8,\n  },\n  detailButtonText:", "backgroundColor: '#44D66C',\n    gap: 8,\n  },\n  detailButtonText:")

# retryButton backgroundColor
c = c.replace("backgroundColor: '#FF6B6B',\n  },\n  retryButtonText:", "backgroundColor: '#44D66C',\n  },\n  retryButtonText:")

# errorText color
c = c.replace("color: '#FF6B6B', marginTop: 16, textAlign: 'center'", "color: '#44D66C', marginTop: 16, textAlign: 'center'")

# suggestionHighlight backgroundColor
c = c.replace("backgroundColor: '#FF6B6B', color: '#FFFFFF', borderRadius: 2", "backgroundColor: '#44D66C', color: '#FFFFFF', borderRadius: 2")

f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\app\search.tsx', 'w', encoding='utf-8')
f.write(c)
f.close()
print('3. search.tsx done')


# ===== 4. VocabularyIcon.tsx - 蓝色改为橙色 =====
f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\components\VocabularyIcon.tsx', 'r', encoding='utf-8')
c = f.read()
f.close()

c = c.replace("const VOCABULARY_COLOR = '#576ad6';", "const VOCABULARY_COLOR = '#FF8C42';")

f = open(r'c:\Users\Lenovo\Desktop\MyAIEnglishApp\components\VocabularyIcon.tsx', 'w', encoding='utf-8')
f.write(c)
f.close()
print('4. VocabularyIcon.tsx done')


print('\nAll color changes completed!')