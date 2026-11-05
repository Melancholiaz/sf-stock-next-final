import postgres from 'postgres';

// ดึง Connection String จากไฟล์ .env.local หรือ Vercel Environment Variables
const connectionString = process.env.DATABASE_URL;

// สร้าง Connection Pool ไปยัง Neon PostgreSQL
const sqlInstance = postgres(connectionString, {
  ssl: 'require', // บังคับใช้ SSL (จำเป็นสำหรับ Neon)
  max: 10,        // จำนวน Connection สูงสุด
});

// ฟังก์ชันสำหรับส่งกลับ instance เพื่อให้หน้า api นำไปใช้
export function sql() {
  return sqlInstance;
}