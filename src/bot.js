require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const VERIFICATION_ROLE_ID = process.env.VERIFICATION_ROLE_ID || '';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '';
const REGISTER_GUILD_ID = process.env.GUILD_ID || '';

const VERIFICATION_WINDOW_MS = 20_000;
const WARNING_FILE = path.join(__dirname, '..', 'data', 'warnings.json');

const ROLE_TIERS = {
  basic: ['1480390867205230624', '1481126330962546709'],
  advanced: ['1481128292126818314'],
  full: ['1481128292126818314'],
};

const PROTECTION_SETTINGS = {
  spamLimit: 6,
  spamWindowMs: 10_000,
  spamTimeoutMinutes: 10,
  blockLinks: true,
  dangerousPatterns: [/@everyone/gi, /@here/gi, /discord\.gg\//gi, /https?:\/\//gi],
};

const recentMessages = new Map();
const pendingVerifications = new Map();

const COMMAND_TIERS = {
  timeout: 'basic',
  untimeout: 'basic',
  warn: 'basic',
  unwarn: 'basic',
  checkwarnings: 'basic',
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
  paniclock: 'full',
  unlockall: 'full',
  verify: 'everyone',
  help: 'everyone',
  ping: 'everyone',
};

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('عرض أوامر البوت'),
  new SlashCommandBuilder().setName('ping').setDescription('فحص استجابة البوت'),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('تايم لعضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('المدة بالدقائق').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('فك التايم عن عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('تحذير عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('إزالة آخر تحذير من عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkwarnings')
    .setDescription('عرض عدد التحذيرات لعضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('طرد عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('باند عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('حذف رسائل')
    .addIntegerOption((o) => o.setName('amount').setDescription('عدد الرسائل (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('تعديل السلومود')
    .addIntegerOption((o) => o.setName('seconds').setDescription('بالثواني (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder().setName('lock').setDescription('قفل الروم الحالية'),
  new SlashCommandBuilder().setName('unlock').setDescription('فتح الروم الحالية'),
  new SlashCommandBuilder().setName('paniclock').setDescription('قفل كل الرومات النصية العامة'),
  new SlashCommandBuilder().setName('unlockall').setDescription('فتح كل الرومات النصية العامة'),

  new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('إعطاء رول لعضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('الرول').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removerole')
    .setDescription('إزالة رول من عضو')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('الرول').setRequired(true)),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('إرسال رسالة عادية من البوت')
    .addStringOption((o) => o.setName('text').setDescription('النص').setRequired(true)),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('إرسال رسالة Embed')
    .addStringOption((o) => o.setName('title').setDescription('العنوان').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('المحتوى').setRequired(true)),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('إعلان قوي مع منشن الجميع')
    .addStringOption((o) => o.setName('title').setDescription('العنوان').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('المحتوى').setRequired(true)),

  new SlashCommandBuilder()
    .setName('anonmsg')
    .setDescription('إرسال رسالة خاصة لعضو بدون إظهار المرسل')
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('الرسالة').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('إدخال كود التحقق')
    .addStringOption((o) => o.setName('code').setDescription('كود التحقق 6 أرقام').setRequired(true)),
].map((c) => c.toJSON());

function ensureWarningStore() {
  if (!fs.existsSync(WARNING_FILE)) {
    fs.writeFileSync(WARNING_FILE, JSON.stringify({}, null, 2));
  }
}

function loadWarnings() {
  ensureWarningStore();
  try {
    return JSON.parse(fs.readFileSync(WARNING_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveWarnings(data) {
  fs.writeFileSync(WARNING_FILE, JSON.stringify(data, null, 2));
}

function hasTier(member, tier) {
  if (tier === 'everyone') return true;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  if (tier === 'basic') {
    const all = [...ROLE_TIERS.basic, ...ROLE_TIERS.advanced, ...ROLE_TIERS.full];
    return member.roles.cache.some((role) => all.includes(role.id));
  }

  if (tier === 'advanced') {
    const all = [...ROLE_TIERS.advanced, ...ROLE_TIERS.full];
    return member.roles.cache.some((role) => all.includes(role.id));
  }

  return member.roles.cache.some((role) => ROLE_TIERS.full.includes(role.id));
}

function canUse(member, commandName) {
  return hasTier(member, COMMAND_TIERS[commandName] || 'full');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function modLog(guild, title, description, color = 0x5865f2) {
  if (!LOG_CHANNEL_ID) return;
  const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function isManageable(invoker, target) {
  if (!target) return false;
  if (invoker.id === target.id) return false;
  if (target.id === invoker.guild.ownerId) return false;
  if (invoker.id === invoker.guild.ownerId) return true;
  return invoker.roles.highest.position > target.roles.highest.position;
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

  await member
    .send(
      `👋 أهلاً بك في **${member.guild.name}**\n` +
        `رمز التحقق الخاص بك: **${code}**\n` +
        `استخدم الأمر داخل السيرفر: **/verify code:${code}** خلال 20 ثانية.`
    )
    .catch(() => null);

  setTimeout(async () => {
    const active = pendingVerifications.get(member.id);
    if (!active || active.code !== code) return;
    pendingVerifications.delete(member.id);
    await member.kick('Verification timeout (20 seconds)').catch(() => null);
    await modLog(member.guild, '⏱️ Verification Timeout', `تم طرد ${member.user.tag} لعدم إكمال التحقق.`, 0xed4245);
  }, VERIFICATION_WINDOW_MS + 1000);
}

async function handleProtection(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return false;

  const now = Date.now();
  const bucket = recentMessages.get(message.author.id) || [];
  const filtered = bucket.filter((time) => now - time <= PROTECTION_SETTINGS.spamWindowMs);
  filtered.push(now);
  recentMessages.set(message.author.id, filtered);

  if (filtered.length >= PROTECTION_SETTINGS.spamLimit) {
    await message.member
      .timeout(PROTECTION_SETTINGS.spamTimeoutMinutes * 60 * 1000, 'Anti-spam protection')
      .catch(() => null);
    await message.reply('🛡️ تم إعطاؤك تايم تلقائي بسبب السبام.').catch(() => null);
    await modLog(
      message.guild,
      '🛡️ Anti-Spam',
      `تم عمل تايم تلقائي للعضو ${message.author.tag} لمدة ${PROTECTION_SETTINGS.spamTimeoutMinutes} دقائق.`,
      0xfaa61a
    );
    recentMessages.set(message.author.id, []);
    return true;
  }

  if (PROTECTION_SETTINGS.blockLinks) {
    for (const pattern of PROTECTION_SETTINGS.dangerousPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(message.content)) {
        await message.delete().catch(() => null);
        await message.channel.send(`🛡️ ${message.author}, تم حذف رسالتك تلقائياً (نظام الحماية).`).catch(() => null);
        await modLog(message.guild, '🧹 Auto Delete', `تم حذف رسالة مخالفة من ${message.author.tag}.`, 0xfaa61a);
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

client.once('ready', async () => {
  ensureWarningStore();
  if (!client.user) return;
  console.log(`Logged in as ${client.user.tag}`);

  if (REGISTER_GUILD_ID) {
    const guild = await client.guilds.fetch(REGISTER_GUILD_ID).catch(() => null);
    if (guild) {
      await guild.commands.set(commands);
      console.log(`Slash commands registered for guild ${guild.id}`);
      return;
    }
  }

  await client.application.commands.set(commands);
  console.log('Global slash commands registered');
});

client.on('guildMemberAdd', async (member) => {
  await startVerification(member);
});

client.on('messageCreate', async (message) => {
  await handleProtection(message);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild || !interaction.member) return;

  const cmd = interaction.commandName;
  const member = interaction.member;

  if (!canUse(member, cmd)) {
    await interaction.reply({ content: '❌ ما عندك صلاحية لهذا الأمر.', ephemeral: true });
    return;
  }

  try {
    if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📚 أوامر البوت (/commands)')
        .setDescription(
          '**Basic:** /timeout /untimeout /warn /unwarn /checkwarnings\n' +
            '**Advanced:** /kick /purge /slowmode /lock /unlock\n' +
            '**Full:** /ban /giverole /removerole /say /embed /announce /anonmsg /paniclock /unlockall\n' +
            '**Public:** /verify /help /ping'
        );
      return void interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (cmd === 'ping') {
      return void interaction.reply({ content: `🏓 Pong: ${client.ws.ping}ms`, ephemeral: true });
    }

    if (cmd === 'verify') {
      const code = interaction.options.getString('code', true).trim();
      const record = pendingVerifications.get(interaction.user.id);
      if (!record || record.guildId !== interaction.guild.id) {
        return void interaction.reply({ content: '❌ لا يوجد تحقق مطلوب لحسابك حالياً.', ephemeral: true });
      }
      if (Date.now() > record.expiresAt) {
        pendingVerifications.delete(interaction.user.id);
        return void interaction.reply({ content: '❌ انتهت مهلة التحقق.', ephemeral: true });
      }
      if (record.code !== code) {
        return void interaction.reply({ content: '❌ كود التحقق غير صحيح.', ephemeral: true });
      }

      pendingVerifications.delete(interaction.user.id);
      if (VERIFICATION_ROLE_ID) {
        await interaction.member.roles.remove(VERIFICATION_ROLE_ID).catch(() => null);
      }
      await modLog(interaction.guild, '✅ Verification', `تم توثيق ${interaction.user.tag} بنجاح.`, 0x57f287);
      return void interaction.reply({ content: '✅ تم التحقق بنجاح ودخولك للرومات العامة.', ephemeral: true });
    }

    if (cmd === 'timeout' || cmd === 'untimeout' || cmd === 'warn' || cmd === 'unwarn' || cmd === 'checkwarnings' || cmd === 'kick' || cmd === 'ban' || cmd === 'giverole' || cmd === 'removerole' || cmd === 'anonmsg') {
      await interaction.guild.members.fetch();
    }

    if (cmd === 'timeout') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك تايم هذا العضو.', ephemeral: true });
      }
      await target.timeout(minutes * 60 * 1000, reason);
      await modLog(interaction.guild, '⏳ Timeout', `${interaction.user.tag} -> ${target.user.tag}\nالمدة: ${minutes} دقيقة\nالسبب: ${reason}`);
      return void interaction.reply(`✅ تم تايم ${target.user.tag} لمدة ${minutes} دقيقة.`);
    }

    if (cmd === 'untimeout') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const reason = interaction.options.getString('reason') || 'Timeout removed';
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك فك تايم هذا العضو.', ephemeral: true });
      }
      await target.timeout(null, reason);
      await modLog(interaction.guild, '🔓 Untimeout', `${interaction.user.tag} فك التايم عن ${target.user.tag}\nالسبب: ${reason}`);
      return void interaction.reply(`✅ تم فك التايم عن ${target.user.tag}.`);
    }

    if (cmd === 'warn' || cmd === 'unwarn' || cmd === 'checkwarnings') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك إدارة تحذيرات هذا العضو.', ephemeral: true });
      }

      const allWarnings = loadWarnings();
      const guildWarnings = allWarnings[interaction.guild.id] || {};
      const list = guildWarnings[target.id] || [];

      if (cmd === 'warn') {
        const reason = interaction.options.getString('reason') || 'No reason provided';
        list.push({ moderatorId: interaction.user.id, reason, createdAt: new Date().toISOString() });
        guildWarnings[target.id] = list;
        allWarnings[interaction.guild.id] = guildWarnings;
        saveWarnings(allWarnings);
        await modLog(interaction.guild, '⚠️ Warn', `${interaction.user.tag} حذر ${target.user.tag}\nالسبب: ${reason}`);
        return void interaction.reply(`⚠️ تم تحذير ${target.user.tag}. العدد الحالي: ${list.length}.`);
      }

      if (cmd === 'unwarn') {
        if (!list.length) {
          return void interaction.reply({ content: '❌ العضو ما عنده تحذيرات.', ephemeral: true });
        }
        list.pop();
        guildWarnings[target.id] = list;
        allWarnings[interaction.guild.id] = guildWarnings;
        saveWarnings(allWarnings);
        await modLog(interaction.guild, '🧽 Unwarn', `${interaction.user.tag} أزال تحذير عن ${target.user.tag}`);
        return void interaction.reply(`✅ تمت إزالة تحذير من ${target.user.tag}. المتبقي: ${list.length}.`);
      }

      return void interaction.reply({ content: `📌 عدد تحذيرات ${target.user.tag}: ${list.length}`, ephemeral: true });
    }

    if (cmd === 'kick') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك طرد هذا العضو.', ephemeral: true });
      }
      await target.kick(reason);
      await modLog(interaction.guild, '👢 Kick', `${interaction.user.tag} طرد ${target.user.tag}\nالسبب: ${reason}`, 0xed4245);
      return void interaction.reply(`✅ تم طرد ${target.user.tag}.`);
    }

    if (cmd === 'ban') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك باند هذا العضو.', ephemeral: true });
      }
      await target.ban({ reason });
      await modLog(interaction.guild, '🔨 Ban', `${interaction.user.tag} باند ${target.user.tag}\nالسبب: ${reason}`, 0xed4245);
      return void interaction.reply(`✅ تم باند ${target.user.tag}.`);
    }

    if (cmd === 'purge') {
      const amount = interaction.options.getInteger('amount', true);
      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        return void interaction.reply({ content: '❌ هذا الأمر فقط بالرومات النصية.', ephemeral: true });
      }
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await modLog(interaction.guild, '🧹 Purge', `${interaction.user.tag} حذف ${deleted.size} رسالة في #${interaction.channel.name}`);
      return void interaction.reply({ content: `✅ تم حذف ${deleted.size} رسالة.`, ephemeral: true });
    }

    if (cmd === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds', true);
      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        return void interaction.reply({ content: '❌ هذا الأمر فقط بالرومات النصية.', ephemeral: true });
      }
      await interaction.channel.setRateLimitPerUser(seconds);
      await modLog(interaction.guild, '🐢 Slowmode', `${interaction.user.tag} ضبط السلومود إلى ${seconds} ثانية في #${interaction.channel.name}`);
      return void interaction.reply(`✅ تم ضبط السلومود إلى ${seconds} ثانية.`);
    }

    if (cmd === 'lock' || cmd === 'unlock') {
      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        return void interaction.reply({ content: '❌ هذا الأمر فقط بالرومات النصية.', ephemeral: true });
      }
      const everyone = interaction.guild.roles.everyone;
      const lockState = cmd === 'lock';
      await interaction.channel.permissionOverwrites.edit(everyone.id, {
        SendMessages: lockState ? false : null,
      });
      await modLog(interaction.guild, lockState ? '🔒 Lock' : '🔓 Unlock', `${interaction.user.tag} ${lockState ? 'قفل' : 'فتح'} #${interaction.channel.name}`);
      return void interaction.reply(lockState ? '🔒 تم قفل الروم.' : '🔓 تم فتح الروم.');
    }

    if (cmd === 'paniclock' || cmd === 'unlockall') {
      const everyone = interaction.guild.roles.everyone;
      const lockState = cmd === 'paniclock';
      const channels = interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
      let changed = 0;
      for (const [, ch] of channels) {
        await ch.permissionOverwrites.edit(everyone.id, { SendMessages: lockState ? false : null }).catch(() => null);
        changed += 1;
      }
      await modLog(interaction.guild, lockState ? '🚨 Panic Lock' : '🟢 Unlock All', `${interaction.user.tag} ${lockState ? 'قفل' : 'فتح'} ${changed} روم.`);
      return void interaction.reply(`✅ تم ${lockState ? 'قفل' : 'فتح'} ${changed} روم.`);
    }

    if (cmd === 'giverole' || cmd === 'removerole') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const role = interaction.options.getRole('role', true);
      if (!target || !isManageable(member, target)) {
        return void interaction.reply({ content: '❌ لا يمكنك تعديل رتب هذا العضو.', ephemeral: true });
      }
      if (interaction.guild.members.me.roles.highest.position <= role.position) {
        return void interaction.reply({ content: '❌ رتبة البوت أقل من الرتبة المطلوبة.', ephemeral: true });
      }

      if (cmd === 'giverole') {
        await target.roles.add(role);
        await modLog(interaction.guild, '🎖️ Give Role', `${interaction.user.tag} أعطى ${role.name} إلى ${target.user.tag}`);
        return void interaction.reply(`✅ تم إعطاء ${role.name} إلى ${target.user.tag}.`);
      }

      await target.roles.remove(role);
      await modLog(interaction.guild, '🧩 Remove Role', `${interaction.user.tag} أزال ${role.name} من ${target.user.tag}`);
      return void interaction.reply(`✅ تم إزالة ${role.name} من ${target.user.tag}.`);
    }

    if (cmd === 'say') {
      const text = interaction.options.getString('text', true);
      await interaction.reply({ content: '✅ تم الإرسال.', ephemeral: true });
      await interaction.channel.send(text);
      return;
    }

    if (cmd === 'embed') {
      const title = interaction.options.getString('title', true);
      const text = interaction.options.getString('text', true);
      const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(title).setDescription(text).setTimestamp();
      await interaction.reply({ content: '✅ تم إرسال Embed.', ephemeral: true });
      await interaction.channel.send({ embeds: [embed] });
      return;
    }

    if (cmd === 'announce') {
      const title = interaction.options.getString('title', true);
      const text = interaction.options.getString('text', true);
      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle(`📢 ${title}`)
        .setDescription(text)
        .setFooter({ text: `بواسطة ${interaction.user.tag}` })
        .setTimestamp();
      await interaction.reply({ content: '✅ تم نشر الإعلان.', ephemeral: true });
      await interaction.channel.send({ content: '@everyone', embeds: [embed] });
      return;
    }

    if (cmd === 'anonmsg') {
      const targetUser = interaction.options.getUser('member', true);
      const text = interaction.options.getString('text', true);
      await targetUser.send(`📩 لديك رسالة إدارية سرية:\n${text}`).catch(() => null);
      await modLog(interaction.guild, '✉️ Anonymous Message', `${interaction.user.tag} أرسل رسالة سرية إلى ${targetUser.tag}`);
      return void interaction.reply({ content: '✅ تم إرسال الرسالة السرية بنجاح.', ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.', ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.', ephemeral: true }).catch(() => null);
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing in environment variables.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
