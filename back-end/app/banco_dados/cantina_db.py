import sqlite3

conn = sqlite3.connect(r"C:\Users\fa285\Downloads\cantina\back-end\data\cantina.db")

cursor = conn.cursor()

print("Conectado ao SQLite ")

cursor.execute("""CREATE TABLE IF NOT EXISTS salas(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name VARCHAR(10) NOT NULL,
               school_year VARCHAR(10) NOT NULL,
               created_at VARCHAR(27),
               updated_at VARCHAR(27),
)""")



cursor.execute("""CREATE TABLE IF NOT EXISTS alunos(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               cpf VARVHAR(11) UNIQUE,
               nome TEXT,
               class_id VARCHAR(32),
               photo_pat VARCHAR(100),
               created_at VARCHAR(27),
               updated_at VARCHAR(27),
)""")
               
cursor.execute("""CREATE TABLE IF NOT EXISTS usuarios(
               id INTERGER PRIMARY KEY AUTOINCREMENT,
               username
               

 )""")

cursor.execute(
     "INSERT INTO usuarios (nome, cpf, turma, sala) VALUES (?,?,?,? )",
     #pierre acrecenta as variaveis aqui para adicionar um aluno
     (nome, cpf, turma, sala)
 )



conn.commit()
conn.close()
