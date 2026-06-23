import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

url = os.getenv("DATABASE_URL")
print("Connecting...")
conn = psycopg2.connect(url)
cur = conn.cursor()
cur.execute("SELECT NOW();")
print("Connected! Server time:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*) FROM extractions;")
print("Rows currently in extractions table:", cur.fetchone()[0])
cur.close()
conn.close()
print("Connection closed cleanly.")