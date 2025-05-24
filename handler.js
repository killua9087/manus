// معالج الرسائل والأوامر الرئيسي

import config from './config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// الحصول على مسار المجلد الحالي (ضروري لوحدات ES)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// تحميل الأوامر ديناميكياً من مجلد commands
const commands = new Map();
async function loadCommands() {
    const commandsDir = path.join(__dirname, 'commands');
    try {
        const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            try {
                const commandPath = path.join(commandsDir, file);
                // استخدام الاستيراد الديناميكي لوحدات ES
                const commandModule = await import(`file://${commandPath}`);
                const command = commandModule.default; // افتراض أن كل ملف يصدر كائن الأمر كـ default

                if (command && command.name && command.execute) {
                    commands.set(command.name.toLowerCase(), command);
                    console.log(`[COMMAND LOADED] ${command.name}`);
                    // (اختياري) تحميل الأسماء المستعارة للأمر
                    if (command.aliases && Array.isArray(command.aliases)) {
                        command.aliases.forEach(alias => commands.set(alias.toLowerCase(), command));
                    }
                } else {
                    console.warn(`[COMMAND WARNING] الملف ${file} لا يصدر أمراً صالحاً (يجب أن يحتوي على name و execute).`);
                }
            } catch (error) {
                console.error(`[COMMAND ERROR] فشل تحميل الأمر من الملف ${file}:`, error);
            }
        }
    } catch (error) {
        console.error('[COMMAND LOAD ERROR] فشل قراءة مجلد الأوامر:', error);
        // إنشاء المجلد إذا لم يكن موجوداً
        if (!fs.existsSync(commandsDir)) {
            fs.mkdirSync(commandsDir);
            console.log('[COMMAND INFO] تم إنشاء مجلد الأوامر.');
        }
    }
}

// استدعاء تحميل الأوامر عند بدء التشغيل
loadCommands();

// الدالة الرئيسية لمعالجة الرسائل
async function handleMessages(sock, msg, store) {
    try {
        const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
        const isCommand = body.startsWith(config.prefix);

        if (!isCommand) return; // إذا لم تكن رسالة أمر، تجاهلها

        const args = body.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = commands.get(commandName);

        if (!command) {
            // يمكنك إضافة رد هنا إذا كان الأمر غير موجود
            // await sock.sendMessage(msg.key.remoteJid, { text: `الأمر '${commandName}' غير موجود.` }, { quoted: msg });
            return;
        }

        // --- معلومات إضافية مفيدة للأوامر ---
        const sender = msg.key.remoteJid.endsWith('@g.us') ? msg.key.participant : msg.key.remoteJid;
        const groupMetadata = msg.key.remoteJid.endsWith('@g.us') ? await sock.groupMetadata(msg.key.remoteJid) : null;
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const groupAdmins = isGroup ? groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id) : [];
        const isBotAdmin = isGroup ? groupAdmins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net') : false;
        const isAdmin = isGroup ? groupAdmins.includes(sender) : false;
        const isOwner = sender.split('@')[0] === config.ownerNumber; // التحقق من المالك

        // --- التحقق من الصلاحيات (مثال) ---
        if (command.adminOnly && !isAdmin) {
            return await sock.sendMessage(msg.key.remoteJid, { text: 'هذا الأمر للمشرفين فقط.' }, { quoted: msg });
        }
        if (command.ownerOnly && !isOwner) {
            return await sock.sendMessage(msg.key.remoteJid, { text: 'هذا الأمر للمالك فقط.' }, { quoted: msg });
        }
        if (command.groupOnly && !isGroup) {
            return await sock.sendMessage(msg.key.remoteJid, { text: 'هذا الأمر يعمل في المجموعات فقط.' }, { quoted: msg });
        }
        // يمكنك إضافة المزيد من التحققات هنا (مثل botAdminOnly)

        // --- تنفيذ الأمر ---
        await command.execute({ sock, msg, args, store, config, isAdmin, isOwner, isBotAdmin, groupMetadata });

    } catch (error) {
        console.error('[HANDLER ERROR] خطأ في معالجة الرسالة:', error);
        // يمكنك إرسال رسالة خطأ للمستخدم أو المالك هنا
        try {
            await sock.sendMessage(msg.key.remoteJid, { text: 'حدث خطأ أثناء تنفيذ الأمر.' }, { quoted: msg });
        } catch (sendError) {
            console.error('[HANDLER ERROR] فشل إرسال رسالة الخطأ:', sendError);
        }
    }
}

// تصدير الدالة الرئيسية لاستخدامها في index.js
export default handleMessages;

