const { Events } = require("discord.js");
const {
    isDungeonCustomId,
    isLegacyDungeonCustomId,
    handleDungeonButton,
    handleLegacyDungeonButton,
} = require("../utils/groupManager");

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Dungeon embed buttons are routed globally by customId instead of
        // through per-message collectors, so they keep working after a restart
        if (interaction.isButton()) {
            try {
                if (isDungeonCustomId(interaction.customId)) {
                    await handleDungeonButton(interaction);
                } else if (isLegacyDungeonCustomId(interaction.customId)) {
                    await handleLegacyDungeonButton(interaction);
                }
                // All other buttons belong to short-lived ephemeral views and
                // are handled by their own collectors
            } catch (error) {
                console.error(`Error handling button interaction ${interaction.customId}`);
                console.error(error);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`);
            console.error(error);
        }
    },
};
