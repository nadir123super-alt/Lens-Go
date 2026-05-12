"""
build_dictionary.py — 将 ecdict.csv 转换为 SQLite 数据库

用法：
    python scripts/build_dictionary.py

输入：ecdict.csv（项目根目录）
输出：assets/dictionary.db
字段：word, phonetic, definition, translation（仅四列）
索引：CREATE INDEX idx_word ON words(word)
"""
import csv
import os
import sqlite3
import sys

CSV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'ecdict.csv')
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets', 'dictionary.db')

CHUNK = 5000  # 分批提交，避免事务过大

def build():
    print(f'📖 读取: {CSV_PATH}')
    if not os.path.isfile(CSV_PATH):
        print(f'❌ 未找到 {CSV_PATH}')
        sys.exit(1)

    # 逐行统计总行数（跳过表头）
    total = 0
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header
        total = sum(1 for _ in reader)
    print(f'📊 总行数: {total}')

    # 删除旧数据库
    if os.path.isfile(DB_PATH):
        os.remove(DB_PATH)
        print('🗑️ 移除旧数据库')

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 建表
    c.execute('''
        CREATE TABLE words (
            word        TEXT PRIMARY KEY,
            phonetic    TEXT DEFAULT '',
            definition  TEXT DEFAULT '',
            translation TEXT DEFAULT ''
        )
    ''')

    # 开始导入
    inserted = 0
    batch = []

    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header

        for row in reader:
            if not row or not row[0].strip():
                continue

            word = row[0].strip().lower()
            # 跳过空值/无效词
            if not word or len(word) > 100:
                continue

            phonetic = row[1].strip() if len(row) > 1 else ''
            definition = row[2].strip() if len(row) > 2 else ''
            translation = row[3].strip() if len(row) > 3 else ''

            # 跳过完全无内容的行
            if not definition and not translation:
                continue

            batch.append((word, phonetic, definition, translation))
            inserted += 1

            if len(batch) >= CHUNK:
                c.executemany(
                    'INSERT OR IGNORE INTO words(word, phonetic, definition, translation) VALUES (?,?,?,?)',
                    batch
                )
                conn.commit()
                batch = []
                print(f'  ⏳ {inserted}/{total}', end='\r')

        # 最后一批
        if batch:
            c.executemany(
                'INSERT OR IGNORE INTO words(word, phonetic, definition, translation) VALUES (?,?,?,?)',
                batch
            )
            conn.commit()

    print()
    print(f'✅ 写入 {inserted} 条记录')

    # 建立索引
    print('🔨 创建索引...')
    c.execute('CREATE INDEX idx_word ON words(word)')
    conn.commit()

    # 验证
    c.execute('SELECT COUNT(*) FROM words')
    count = c.fetchone()[0]
    c.execute('SELECT word, translation FROM words LIMIT 5')
    samples = c.fetchall()

    conn.close()

    db_size = os.path.getsize(DB_PATH)
    print(f'✅ 完成！数据库文件: {DB_PATH}')
    print(f'   📦 大小: {db_size / 1024 / 1024:.2f} MB')
    print(f'   📊 记录数: {count}')
    print(f'   🔍 索引: idx_word (B-tree)')
    print(f'   📝 示例:')
    for w, t in samples:
        print(f'       - {w}: {t[:40]}')

if __name__ == '__main__':
    build()
