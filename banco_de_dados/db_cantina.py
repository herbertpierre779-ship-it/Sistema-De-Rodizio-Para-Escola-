import sqlite3


conect = sqlite3.connect(r"C:\Users\fa285\Downloads\cantina\banco_de_dados\cantina.db")

cursor = conect.cursor()

cursor.execute("""
               CREATE TABLE IF NOT EXISTS alunos(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               nome VARCHAR(100) NOT NULL,
               idade INTEGER NOT NULL,
               matricula INTEGER NOT NULL UNIQUE,
               sala INTEGER NOT NULL,
               turma VARCHAR NOT NULL 
               )""")


cursor.execute("""
INSERT INTO alunos(nome, idade, matricula, sala, turma)
VALUES (?, ?, ?, ?, ?)
""", ("pierre",17,1111112,6,"2B-tds" ))


conect.commit()
