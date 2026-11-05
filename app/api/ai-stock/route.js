import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req) {
  try {
    const { text, zone, productList } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'ไม่พบข้อความคำสั่ง' }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
คุณคือผู้ช่วยจัดการสต็อกสินค้าอัจฉริยะ (SF Stock)
หน้าที่ของคุณคือแปลงคำพูดของพนักงานให้เป็นคำสั่งอัปเดตสต็อกในรูปแบบ JSON

โซนปัจจุบันที่พนักงานเปิดอยู่: "${zone}"
รายชื่อสินค้าในโซนนี้:
${JSON.stringify(productList || [])}

คำพูดของพนักงาน: "${text}"

กฎการวิเคราะห์:
1. จับคู่ชื่อสินค้าที่พูดให้ตรงกับ "id" และ "name" ในรายชื่อสินค้ามากที่สุด (แม้พูดชื่อย่อ พูดภาษาไทยปนอังกฤษ หรือออกเสียงเพี้ยน เช่น โค้ก=COKE, ป๊อปคอร์น=CORN, น้ำมัน=OIL, แก้ว=CUP, ฝา=LID)
2. แยกประเภทคำสั่ง (mode):
   - "add": ถ้าพูดว่า เพิ่ม, บวก, เติมเข้า หรือพูดชื่อสินค้าตามด้วยจำนวนที่จะเพิ่ม
   - "remove": ถ้าพูดว่า ลด, ลบ, หักออก, เอาออก
   - "set": ถ้าพูดว่า นับได้, ตั้งเป็น, มีอยู่, เหลือ
3. แยกหน่วย/ช่องที่จะใส่ (unitType):
   - "box": ถ้าพูดหน่วยเป็น ลัง, กล่อง, ถัง, แพ็ค, Store Daily
   - "piece": ถ้าพูดหน่วยเป็น ชิ้น, เศษ, ขวด, แก้ว, ถุง, กิโล, กก., กรัม, หรือไม่ได้ระบุหน่วย
   - "open": ถ้าพูดว่า ยอดเปิด, เปิด (สำหรับโซนหน้าร้าน)
   - "fg_add": ถ้าพูดว่า ยอดแอด, รับเพิ่มหน้าร้าน (สำหรับโซนหน้าร้าน)
4. หากพูดสินค้าเดียวแต่มีทั้งลังและเศษ (เช่น "เพิ่มโค้ก 2 ลัง กับอีก 5 ชิ้น") ให้แยกออกมาเป็น 2 รายการใน array items (รายการแรก unitType: "box" จำนวน 2, รายการที่สอง unitType: "piece" จำนวน 5)

ตอบกลับเป็น JSON ตามโครงสร้างนี้เท่านั้น:
{
  "success": true,
  "items": [
    {
      "id": "id ของสินค้าที่ตรงกัน (ต้องตรงกับในระบบ)",
      "name": "ชื่อสินค้าในระบบ",
      "mode": "add หรือ remove หรือ set",
      "unitType": "box หรือ piece หรือ open หรือ fg_add",
      "quantity": จำนวนตัวเลข (number)
    }
  ],
  "summary": "สรุปสั้นๆ ภาษาไทย เช่น เพิ่ม COKE 2 ลัง และ 5 เศษ"
}
`;

    const result = await model.generateContent(prompt);
    const parsedData = JSON.parse(result.response.text());

    return NextResponse.json(parsedData);
  } catch (error) {
    console.error('AI Stock Error:', error);
    return NextResponse.json(
      { error: 'ประมวลผลคำสั่งไม่สำเร็จ: ' + error.message },
      { status: 500 }
    );
  }
}