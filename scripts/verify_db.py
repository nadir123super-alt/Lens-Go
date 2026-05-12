import sqlite3
conn = sqlite3.connect('assets/dictionary.db')
c = conn.cursor()

# 测试精确查询
for word in ['apple', 'hello', 'test', 'book', 'cat']:
    c.execute("SELECT word, phonetic, definition, translation FROM words WHERE word=?", (word,))
    row = c.fetchone()
    if row:
        print(f'{word}: phonetic={row[1][:30] if row[1] else "N/A"} | trans={row[3][:50] if row[3] else "N/A"}')
    else:
        print(f'{word}: NOT FOUND')

# 测试 LIKE 前缀
c.execute("SELECT word, translation FROM words WHERE word LIKE ? LIMIT 5", ('app%',))
print('\nLIKE app%:', c.fetchall())

# 总数
c.execute("SELECT COUNT(*) FROM words")
print(f'\nTotal: {c.fetchone()[0]}')

conn.close()
