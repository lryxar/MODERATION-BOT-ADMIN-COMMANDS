require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const PREFIX = process.env.PREFIX || '!';
const VERIFICATION_ROLE_ID = process.env.VERIFICATION_ROLE_ID || '';
const VERIFICATION_WINDOW_MS = 20_000;

const ROLE_TIERS = {
  basic: ['1480390867205230624', '1481126330962546709'],
  advanced: ['1481128292126818314'],
  full: ['1481128292126818314'],
};

const PERMISSION_MAP = {
  timeout: 'basic',
  untimeout: 'basic',
  warn: 'basic',
  unwarn: 'basic',
  kick: 'advanced',
  purge: 'advanced',
  slowmode: 'advanced',
  lock: 'advanced',
  unlock: 'advanced',
  ban: 'full',
  giverole: 'full',
  removerole: 'full',
  say: 'full',
  embed: 'full',
  announce: 'full',
  anonmsg: 'full',
  verify: 'everyone',
};

const COMMAND_ALIASES = {
  timeout: ['timeout', 'تايم', 'mute'],
  untimeout: ['untimeout', 'انتايم', 'فك-تايم', 'unmute'],
  warn: ['warn', 'تحذير'],
  unwarn: ['unwarn', 'ازالة-تحذير', 'حذف-تحذير'],
  kick: ['kick', 'طرد'],
  ban: ['ban', 'باند'],
  purge: ['purge', 'clear', 'مسح', 'حذف'],
  slowmode: ['slowmode', 'سلومود', 'slow'],
  lock: ['lock', 'قفل'],
  unlock: ['unlock', 'فتح'],
  giverole: ['giverole', 'addrole', 'اعطاء-رول', 'رول'],
  removerole: ['removerole', 'delrole', 'شيل-رول', 'ازالة-رول'],
  say: ['say', 'قول'],
  embed: ['embed', 'امبد'],
  announce: ['announce', 'اعلان'],
  anonmsg: ['anonmsg', 'secretmsg', 'رسالة-سرية', 'ارسل-سري'],
  verify: ['verify', 'تحقق'],
};

const PROTECTION_SETTINGS = {
  spamLimit: 6,
  spamWindowMs: 10_000,
  spamTimeoutMinutes: 10,
  blockLinks: true,
  dangerousPatterns: [
    /@everyone/gi,
    /@here/gi,
    /discord\.gg\//gi,
    /https?:\/\//gi,
  ],
};

const recentMessages = new Map();
const pendingVerifications = new Map();

const COMMAND_LOOKUP = Object.entries(COMMAND_ALIASES).reduce((acc, [base, aliases]) => {
  for (const alias of aliases) {
    acc[alias.toLowerCase()] = base;
  }
  return acc;
}, {});

const WARNING_FILE = path.join(__dirname, '..', 'data', 'warnings.json');

function ensureWarningStore() {
  if (!fs.existsSync(WARNING_FILE)) {
    fs.writeFileSync(WARNING_FILE, JSON.stringify({}, null, 2));
  }
}

function loadWarnings() {
  ensureWarningStore();
  return JSON.parse(fs.readFileSync(WARNING_FILE, 'utf8'));
}

function saveWarnings(data) {
  fs.writeFileSync(WARNING_FILE, JSON.stringify(data, null, 2));
}

function hasTier(member, tier) {
  if (tier === 'everyone') return true;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const tierRoles = new Set(ROLE_TIERS[tier]);
  if (tier === 'basic') {
    return member.roles.cache.some((role) =>
      [...ROLE_TIERS.basic, ...ROLE_TIERS.advanced, ...ROLE_TIERS.full].includes(role.id)
    );
  }

  if (tier === 'advanced') {
    return member.roles.cache.some((role) =>
      [...ROLE_TIERS.advanced, ...ROLE_TIERS.full].includes(role.id)
    );
  }

  return member.roles.cache.some((role) => tierRoles.has(role.id));
}

function canUse(member, command) {
  const tier = PERMISSION_MAP[command];
  return hasTier(member, tier);
}

function normalizeCommand(content) {
  const text = content.trim();
  if (!text.length) return null;

  const withoutPrefix = text.startsWith(PREFIX) ? text.slice(PREFIX.length).trim() : text;
  const [rawCommand, ...rest] = withoutPrefix.split(/\s+/);
  if (!rawCommand) return null;

  const baseCommand = COMMAND_LOOKUP[rawCommand.toLowerCase()];
  if (!baseCommand) return null;

  return { command: baseCommand, args: rest };
}

async function parseTargetMember(message, firstArg) {
  const mention = message.mentions.members.first();
  if (mention) return mention;

  if (!firstArg) return null;
  const cleanId = firstArg.replace(/[<@!>]/g, '');
  if (!/^\d+$/.test(cleanId)) return null;
  return message.guild.members.fetch(cleanId).catch(() => null);
}

async function parseTargetRole(message, arg) {
  const mention = message.mentions.roles.first();
  if (mention) return mention;
  if (!arg) return null;
  const cleanId = arg.replace(/[<@&>]/g, '');
  if (!/^\d+$/.test(cleanId)) return null;
  return message.guild.roles.fetch(cleanId).catch(() => null);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function startVerification(member) {
  const code = generateCode();
  pendingVerifications.set(member.id, {
    code,
    expiresAt: Date.now() + VERIFICATION_WINDOW_MS,
    guildId: member.guild.id,
  });

  if (VERIFICATION_ROLE_ID) {
    await member.roles.add(VERIFICATION_ROLE_ID).catch(() => null);
  }

  await member.send(
    `👋 أهلاً بك في **${member.guild.name}**\n` +
      `رمز التحقق الخاص بك: **${code}**\n` +
      `اكتب داخل السيرفر: verify ${code} خلال 20 ثانية.`
  ).catch(() => null);

  setTimeout(async () => {
    const active = pendingVerifications.get(member.id);
    if (!active || active.code !== code) return;
    pendingVerifications.delete(member.id);
    await member.kick('Verification timeout (20 seconds)').catch(() => null);
  }, VERIFICATION_WINDOW_MS + 1000);
}

async function handleProtection(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return false;

  const now = Date.now();
  const bucket = recentMessages.get(message.author.id) || [];
  const filtered = bucket.filter((time) => now - time <= PROTECTION_SETTINGS.spamWindowMs);
  filtered.push(now);
  recentMessages.set(message.author.id, filtered);

  if (filtered.length >= PROTECTION_SETTINGS.spamLimit) {
    await message.member.timeout(PROTECTION_SETTINGS.spamTimeoutMinutes * 60 * 1000, 'Anti-spam protection').catch(() => null);
    await message.reply('🛡️ تم إعطاؤك تايم تلقائي بسبب السبام.').catch(() => null);
    recentMessages.set(message.author.id, []);
    return true;
  }

  if (PROTECTION_SETTINGS.blockLinks) {
    for (const pattern of PROTECTION_SETTINGS.dangerousPatterns) {
      if (pattern.test(message.content)) {
        await message.delete().catch(() => null);
        await message.channel.send(`🛡️ ${message.author}, تم حذف رسالتك تلقائياً (نظام الحماية).`).catch(() => null);
        return true;
      }
    }
  }

  return false;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  ensureWarningStore();
});

client.on('guildMemberAdd', async (member) => {
  await startVerification(member);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const blocked = await handleProtection(message);
  if (blocked) return;

  const parsed = normalizeCommand(message.content);
  if (!parsed) return;

  const { command, args } = parsed;

  if (!canUse(message.member, command)) {
    await message.reply('❌ ما عندك صلاحية لهذا الأمر.');
    return;
  }

  try {
    if (command === 'verify') {
      const record = pendingVerifications.get(message.author.id);
      if (!record || record.guildId !== message.guild.id) {
        return void message.reply('❌ لا يوجد تحقق مطلوب لحسابك حالياً.');
      }

      if (Date.now() > record.expiresAt) {
        pendingVerifications.delete(message.author.id);
        return void message.reply('❌ انتهت مهلة التحقق.');
      }

      if ((args[0] || '').trim() !== record.code) {
        return void message.reply('❌ كود التحقق غير صحيح.');
      }

      pendingVerifications.delete(message.author.id);
      if (VERIFICATION_ROLE_ID) {
        await message.member.roles.remove(VERIFICATION_ROLE_ID).catch(() => null);
      }
      return void message.reply('✅ تم التحقق بنجاح، الآن تقدر تدخل الرومات العامة.');
    }

    if (command === 'timeout' || command === 'untimeout') {
      const target = await parseTargetMember(message, args[0]);
      if (!target) return void message.reply('❌ حدد عضو صحيح.');

      if (command === 'timeout') {
        const minutes = Number(args[1] || 10);
        if (Number.isNaN(minutes) || minutes < 1 || minutes > 40320) {
          return void message.reply('❌ مدة التايم بالدقائق بين 1 و 40320.');
        }
        const reason = args.slice(2).join(' ') || 'No reason provided';
        await target.timeout(minutes * 60 * 1000, reason);
        return void message.reply(`✅ تم تايم ${target.user.tag} لمدة ${minutes} دقيقة.`);
      }

      await target.timeout(null, args.slice(1).join(' ') || 'Timeout removed');
      return void message.reply(`✅ تم فك التايم عن ${target.user.tag}.`);
    }

    if (command === 'warn' || command === 'unwarn') {
      const target = await parseTargetMember(message, args[0]);
      if (!target) return void message.reply('❌ حدد عضو صحيح.');

      const warnings = loadWarnings();
      const guildWarnings = warnings[message.guild.id] || {};
      const userWarnings = guildWarnings[target.id] || [];

      if (command === 'warn') {
        const reason = args.slice(1).join(' ') || 'No reason provided';
        userWarnings.push({
          moderatorId: message.author.id,
          reason,
          createdAt: new Date().toISOString(),
        });
        guildWarnings[target.id] = userWarnings;
        warnings[message.guild.id] = guildWarnings;
        saveWarnings(warnings);
        return void message.reply(`⚠️ تم تحذير ${target.user.tag}. عدد التحذيرات الآن: ${userWarnings.length}.`);
      }

      if (!userWarnings.length) {
        return void message.reply('❌ العضو ما عنده تحذيرات.');
      }

      userWarnings.pop();
      guildWarnings[target.id] = userWarnings;
      warnings[message.guild.id] = guildWarnings;
      saveWarnings(warnings);
      return void message.reply(`✅ تمت إزالة تحذير من ${target.user.tag}. المتبقي: ${userWarnings.length}.`);
    }

    if (command === 'kick') {
      const target = await parseTargetMember(message, args[0]);
      if (!target) return void message.reply('❌ حدد عضو صحيح.');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.kick(reason);
      return void message.reply(`✅ تم طرد ${target.user.tag}.`);
    }

    if (command === 'ban') {
      const target = await parseTargetMember(message, args[0]);
      if (!target) return void message.reply('❌ حدد عضو صحيح.');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.ban({ reason });
      return void message.reply(`✅ تم باند ${target.user.tag}.`);
    }

    if (command === 'purge') {
      const amount = Number(args[0]);
      if (Number.isNaN(amount) || amount < 1 || amount > 100) {
        return void message.reply('❌ اكتب رقم بين 1 و 100.');
      }
      const deleted = await message.channel.bulkDelete(amount, true);
      return void message.channel.send(`✅ تم حذف ${deleted.size} رسالة.`);
    }

    if (command === 'slowmode') {
      const seconds = Number(args[0]);
      if (Number.isNaN(seconds) || seconds < 0 || seconds > 21600) {
        return void message.reply('❌ السلومود لازم يكون من 0 إلى 21600 ثانية.');
      }
      await message.channel.setRateLimitPerUser(seconds);
      return void message.reply(`✅ تم ضبط السلومود إلى ${seconds} ثانية.`);
    }

    if (command === 'lock' || command === 'unlock') {
      if (message.channel.type !== ChannelType.GuildText) {
        return void message.reply('❌ الأمر يعمل فقط في الرومات النصية.');
      }

      const everyoneRole = message.guild.roles.everyone;
      const lockState = command === 'lock';
      await message.channel.permissionOverwrites.edit(everyoneRole.id, {
        SendMessages: lockState ? false : null,
      });
      return void message.reply(lockState ? '🔒 تم قفل الروم.' : '🔓 تم فتح الروم.');
    }

    if (command === 'giverole' || command === 'removerole') {
      const target = await parseTargetMember(message, args[0]);
      const role = await parseTargetRole(message, args[1]);
      if (!target || !role) {
        return void message.reply('❌ الصيغة: giverole @member @role');
      }

      if (command === 'giverole') {
        await target.roles.add(role);
        return void message.reply(`✅ تم إعطاء ${role.name} إلى ${target.user.tag}.`);
      }

      await target.roles.remove(role);
      return void message.reply(`✅ تم إزالة ${role.name} من ${target.user.tag}.`);
    }

    if (command === 'say') {
      const text = args.join(' ');
      if (!text) return void message.reply('❌ الصيغة: say نص الرسالة');
      await message.delete().catch(() => null);
      await message.channel.send(text);
      return;
    }

    if (command === 'embed') {
      const text = args.join(' ');
      if (!text) return void message.reply('❌ الصيغة: embed نص الرسالة');
      const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription(text).setTimestamp();
      await message.delete().catch(() => null);
      await message.channel.send({ embeds: [embed] });
      return;
    }

    if (command === 'announce') {
      const text = args.join(' ');
      if (!text) return void message.reply('❌ الصيغة: announce نص الإعلان');
      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle('📢 إعلان إداري')
        .setDescription(text)
        .setFooter({ text: `بواسطة ${message.author.tag}` })
        .setTimestamp();
      await message.channel.send({ content: '@everyone', embeds: [embed] });
      return;
    }

    if (command === 'anonmsg') {
      const target = await parseTargetMember(message, args[0]);
      if (!target) return void message.reply('❌ الصيغة: anonmsg @member نص الرسالة');
      const text = args.slice(1).join(' ');
      if (!text) return void message.reply('❌ اكتب نص الرسالة بعد المنشن.');

      await target.send(`📩 لديك رسالة سرية:\n${text}`).catch(() => null);
      return void message.reply('✅ تم إرسال الرسالة السرية بنجاح (بدون كشف المرسل).');
    }
  } catch (error) {
    console.error(error);
    await message.reply('❌ حدث خطأ أثناء تنفيذ الأمر. تأكد من صلاحيات البوت وترتيب الرتب.');
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing in environment variables.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
