// الملف الرئيسي لتشغيل البوت والاتصال بواتساب

import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidDecode
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import os from 'os';
import qrcode from 'qrcode-terminal';
import config from './config.js'; // استيراد ملف الإعدادات
// import handleMessages from './handler.js'; // سيتم استيراد معالج الرسائل لاحقاً

// إعداد مسجل الأحداث (Logger)
const logger = pino({ level: 'silent' }).child({ level: 'silent' }); // يمكنك تغيير silent إلى info لرؤية سجلات أكثر تفصيلاً

// إعداد مخزن بيانات في الذاكرة (يمكن استبداله بقاعدة بيانات إذا لزم الأمر)
const store = makeInMemoryStore({ logger });
store?.readFromFile('./session/baileys_store.json');
// حفظ المخزن بشكل دوري
setInterval(() => {
    store?.writeToFile('./session/baileys_store.json');
}, 10_000); // كل 10 ثوانٍ

// دالة لبدء الاتصال
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[INFO] Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true, // طباعة QR code في الطرفية بشكل افتراضي
        auth: state,
        browser: ['ManusBot', 'Chrome', '1.0.0'], // تعريف المتصفح الذي يظهر في واتساب ويب
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return {
                conversation: 'hello there'
            }
        }
    });

    store?.bind(sock.ev);

    // دعم ربط الكود (Pairing Code) إذا لم يكن هناك QR code
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = config.ownerNumber.replace(/[^0-9]/g, ''); // الحصول على رقم المالك من الإعدادات
                if (!phoneNumber) {
                    console.log('يرجى إضافة رقم هاتف المالك (ownerNumber) في ملف config.js لاستخدام ربط الكود.');
                    return;
                }
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`[PAIRING CODE] رمز الربط الخاص بك: ${code}`);
            } catch (error) {
                console.error('[PAIRING CODE ERROR] فشل في طلب رمز الربط:', error);
            }
        }, 3000); // انتظار 3 ثوانٍ قبل طلب الكود
    }

    // معالجة تحديثات الاتصال
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) &&
                                    lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[CONNECTION] Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            // إعادة الاتصال إذا لم يكن السبب هو تسجيل الخروج
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('[CONNECTION] Opened connection');
            // إرسال رسالة للمالك عند بدء التشغيل (اختياري)
            // sock.sendMessage(config.ownerNumber + '@s.whatsapp.net', { text: `${config.botName} بدأ العمل!` });
        }

        // إذا كان هناك QR code جديد، يتم عرضه في الطرفية
        // if (qr) {
        //     console.log('[QR CODE] امسح الرمز التالي لربط البوت:');
        //     qrcode.generate(qr, { small: true });
        // }
    });

    // حفظ بيانات الاعتماد عند تحديثها
    sock.ev.on('creds.update', saveCreds);

    // معالجة الرسائل الواردة (سيتم استدعاء المعالج الفعلي هنا)
    sock.ev.on('messages.upsert', async (m) => {
        // console.log(JSON.stringify(m, undefined, 2)); // لطباعة تفاصيل الرسالة الواردة (للتصحيح)
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') { // تجاهل رسائل البوت نفسه والرسائل القديمة
            // console.log('Received message:', msg);
            // await handleMessages(sock, msg, store); // <--- استدعاء المعالج الرئيسي هنا لاحقاً
        }
    });

    // معالجة تحديثات المجموعات (للترحيب، الوداع، الإشعارات)
    sock.ev.on('group-participants.update', async (update) => {
        // console.log('[GROUP UPDATE]', update); // لطباعة تفاصيل التحديث (للتصحيح)
        // سيتم إضافة منطق الترحيب والوداع والإشعارات هنا أو في المعالج
    });

    // معالجة تحديثات وصف/اسم المجموعة
    sock.ev.on('groups.update', async (updates) => {
        // console.log('[GROUPS UPDATE]', updates); // لطباعة تفاصيل التحديث (للتصحيح)
        // سيتم إضافة منطق إشعارات تغيير الاسم/الوصف هنا أو في المعالج
    });

    console.log('[INFO] Bot starting...');
}

// بدء تشغيل البوت
startBot().catch(err => console.error("[STARTUP ERROR]", err));

// التعامل مع إيقاف التشغيل غير المتوقع
process.on('uncaughtException', console.error);

