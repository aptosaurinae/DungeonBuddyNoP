const { errorTable } = require("./loadDb");
const { supportUserId, supportChannelId } = require("./loadJson");

async function processError(error, interaction) {
    console.log(error);
    let errorName = "";
    // Check if the error is due to a timeout
    if (
        error.name.includes("InteractionCollectorError") &&
        error.message.includes("Collector received no interactions")
    ) {
        // Simpler name for a standard timeout error
        errorName = "timeout";

        // Inform user about the timeout
        await interaction.editReply({
            content: "You did not respond in time (60s).\nPlease try the command again if you wish to create a group.",
            ephemeral: true,
            components: [],
        });
    } else {
        // Optionally send a message to the user if the error is different
        await interaction.editReply({
            content:
                `An error occurred while processing your request.\nIf this was a mistake, feel free to ping <@${supportUserId}> in <#${supportChannelId}>`,
            ephemeral: true,
            components: [],
        });
    }

    // Send the error to the database
    await errorTable.create({
        error_name: errorName || error.name,
        error_message: error.message,
        user_id: interaction.user.id,
    });
}

async function processSendEmbedError(error, reason, userId) {
    // Send the error to the database
    await errorTable.create({
        error_name: reason,
        error_message: error.message,
        user_id: userId,
    });
}

let deleteTimeouts = new Map();

async function createStatusEmbed(statusMessage, embedMessage) {
    const contactMessage = `\nPlease try /lfg again if you wish to create a group.`;

    await embedMessage
        .edit({
            content: statusMessage + contactMessage,
            embeds: [],
            components: [],
        })
        .catch(console.error);

    // Clear any previous timeout for this message
    if (deleteTimeouts.has(embedMessage.id)) {
        clearTimeout(deleteTimeouts.get(embedMessage.id));
        deleteTimeouts.delete(embedMessage.id);
    }

    // Automatically delete the status embed after 5 mins
    const timeout = setTimeout(async () => {
        try {
            if (embedMessage.deletable) {
                await embedMessage.delete();
            }
        } catch (e) {
            console.error(e);
        } finally {
            deleteTimeouts.delete(embedMessage.id); // Always clean up the map entry
        }
    }, 300_000);

    // Store the timeout ID
    deleteTimeouts.set(embedMessage.id, timeout);
}

module.exports = { processError, processSendEmbedError, createStatusEmbed };
