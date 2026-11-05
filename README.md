# SF Stock (Next.js)

ระบบนับสต็อก เวอร์ชัน Next.js — หลังบ้านเป็น API Route (`app/api/route.js`) ใช้ Postgres
หน้า Desktop (`public/desktop.html` + `public/script.js`) และหน้ามือถือ PWA (`public/mobile/`) หน้าตาและการทำงานเหมือนเดิม
ไม่มีหน้าล็อกอิน (ทุกคนที่เปิดลิงก์ได้ใช้งานทั้งหมด)

## โครงสร้าง

| ที่อยู่ | คืออะไร |
|---|---|
| `/` | หน้า Desktop |
| `/mobile` | หน้ามือถือ (ติดตั้งเป็นแอปได้) |
| `/api?action=...` | API (แทน api.php เดิม) |

## ติดตั้ง/ใช้งานบนเครื่องตัวเอง

```bash
npm install
cp .env.example .env.local     # แล้วแก้ DATABASE_URL
npm run dev                    # เปิด http://localhost:3000
```

ตารางในฐานข้อมูลจะถูกสร้างอัตโนมัติเมื่อเรียกใช้ครั้งแรก

## ตัวแปร (Environment Variables)

| ชื่อ | ความหมาย |
|---|---|
| `DATABASE_URL` | (จำเป็น) ลิงก์เชื่อมต่อ Postgres |
| `DEFAULT_NICKNAME` | ชื่อที่ขึ้นในประวัติการแก้ไข (ค่าเริ่มต้น `ผู้ใช้`) |
| `DEFAULT_ROLE` | `admin` (ทำได้ทุกอย่าง) หรือ `staff` (ลบสินค้า/บันทึกวันนี้/ดูประวัติแก้ไขไม่ได้) |

## ย้ายข้อมูลเก่าจาก MySQL

1. phpMyAdmin → ตาราง `products` → Export → รูปแบบ **CSV** (ติ๊ก "Put columns names in the first row") → ตั้งชื่อ `products.csv`
2. ทำเหมือนกันกับ `stock_history` → `stock_history.csv`
3. วางไว้ในโฟลเดอร์ `old-data` แล้วรัน
   ```bash
   DATABASE_URL="postgresql://..." npm run import:csv -- ./old-data
   ```

## Deploy บน Vercel

1. สร้างฐานข้อมูล Postgres ฟรีที่ Neon (neon.tech) หรือ Supabase แล้วคัดลอก connection string
2. อัปโหลดโปรเจกต์ขึ้น GitHub
3. Vercel → Add New Project → เลือก repo นี้
4. ก่อนกด Deploy ใส่ Environment Variable `DATABASE_URL`
5. Deploy เสร็จ เปิดลิงก์ได้เลย

## ข้อควรรู้

- ไม่มีล็อกอิน: ใครรู้ลิงก์ก็แก้/ลบข้อมูลได้ ควรเก็บลิงก์ไว้ในทีม หรือตั้ง `DEFAULT_ROLE=staff`
- ประวัติการแก้ไขจะขึ้นชื่อเดียวกันทุกคน แยกไม่ได้ว่าใครแก้
- สำรองข้อมูล: ปุ่มแอดมิน → สำรองข้อมูล จะดาวน์โหลดไฟล์ JSON ให้ (Vercel เก็บไฟล์ถาวรไม่ได้ จึงไม่มีสำรองอัตโนมัติ) Neon/Supabase มีระบบกู้คืนย้อนหลังของตัวเองด้วย
