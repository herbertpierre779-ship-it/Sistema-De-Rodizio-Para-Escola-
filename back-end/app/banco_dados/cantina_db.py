import sqlite3

conn = sqlite3.connect(r'C:\Users\fa285\Downloads\cantina\back-end\app\banco_dados\cantina.db')

cursor = conn.cursor()

print("Conectado ao SQLite ")



cursor.execute("""CREATE TABLE IF NOT EXISTS alunos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome VARCHAR(100) NOT NULL,
    cpf INTEGER UNIQUE NOT NULL,
    turma VARCHAR(50),
    sala VARCHAR(10)
)""")

cursor.execute(
    "INSERT INTO usuarios (nome, cpf, turma, sala) VALUES (?,?,?,? )",
    #pierre acrecenta as variaveis aqui para adicionar um aluno
    (nome, cpf, turma, sala)
)



conn.commit()
conn.close()
