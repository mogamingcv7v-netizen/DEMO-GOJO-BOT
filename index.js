const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, makeInMemoryStore } = require("@adiwajshing/baileys");
const fs = require("fs-extra");
const P = require("pino");
const moment = require("moment");
const axios = require("axios");
const chalk = require("chalk");

const { state, saveState } = useSingleFileAuthState('./auth.json');
const store = makeInMemoryStore({ logger: P().child({ level: 'silent', stream: 'store' }) });

store.readFromFile('./baileys_store.json');
setInterval(() => {
    store.writeToFile('./baileys_store.json');
}, 10_000);

const subscriptionDB = JSON.parse(fs.readFileSync("./subscription.json"));

function saveSubscription() {
    fs.writeFileSync("./subscription.json", JSON.stringify(subscriptionDB, null, 2));
}

function isGroupPremium(id) {
    const group = subscriptionDB.groups.find(g => g.group_id === id);
    if (!group) return false;
    if (group.isPremium) return true;
    if (group.expiryDate && new Date(group.expiryDate) > new Date()) return true;
    return false;
}

async function connectToWhatsApp() {
    const sock = makeWASocket({
        logger: P({ level: "silent" }),
        printQRInTerminal: true,
        auth: state,
        browser: ['GOJO BOT', 'Safari', '1.0.0'],
        syncFullHistory: false
    });

    store.bind(sock.ev);
    sock.ev.on("creds.update", saveState);

    sock.ev.on("group-participants.update", async (update) => {
        const metadata = await sock.groupMetadata(update.id);
        for (let participant of update.participants) {
            if (update.action === "add") {
                await sock.sendMessage(update.id, {
                    text: `👋 أهلاً بك في *${metadata.subject}*!
من فضلك املأ الاستمارة.`,
                });
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const message = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (message === "/تفعيل") {
            const exists = subscriptionDB.groups.find(g => g.group_id === from);
            if (!exists) {
                subscriptionDB.groups.push({
                    group_id: from,
                    isPremium: false,
                    trialUsed: false,
                    activatedAt: null,
                    expiryDate: null
                });
                saveSubscription();
                await sock.sendMessage(from, { text: "✅ تم تفعيل البوت لهذه المجموعة.
أرسل .تجربة أو .اشتراك لبدء الاستخدام." });
            } else {
                await sock.sendMessage(from, { text: "📌 هذه المجموعة مفعّلة مسبقًا." });
            }
        }

        if (message === ".تجربة") {
            const group = subscriptionDB.groups.find(g => g.group_id === from);
            if (!group) return sock.sendMessage(from, { text: "❌ فعل البوت أولاً باستخدام /تفعيل." });
            if (group.trialUsed) return sock.sendMessage(from, { text: "❌ تم استخدام التجربة المجانية مسبقًا." });

            const now = new Date();
            const expiry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
            group.trialUsed = true;
            group.isPremium = false;
            group.activatedAt = now;
            group.expiryDate = expiry;
            saveSubscription();

            await sock.sendMessage(from, { text: `🎉 تم تفعيل التجربة المجانية لمدة 3 أيام.
تنتهي في: ${moment(expiry).format("YYYY-MM-DD HH:mm")}` });
        }

        if (message === ".اشتراك") {
            await sock.sendMessage(from, {
                text: "💎 للاشتراك الدائم، تواصل مع: wa.me/201096715254",
                footer: "GOJO BOT PREMIUM",
                buttons: [
                    { buttonId: "/اشتراك", buttonText: { displayText: "طلب الاشتراك" }, type: 1 },
                    { buttonId: "/تجربة", buttonText: { displayText: "تجربة مجانية" }, type: 1 }
                ],
                headerType: 1
            });
        }
    });
}

connectToWhatsApp();