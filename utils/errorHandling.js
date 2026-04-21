const { errorTable } = require("./loadDb");
const { supportUserId, supportChannelId } = require("./loadJson");

async function processError(error, interaction) {
    console.error(error);
    let errorName = "";

    // Determine the correct response method based on the interaction state
    const respond = (interaction.deferred || interaction.replied)
        ? (options) => interaction.editReply(options)
        : (options) => interaction.reply({ ...options, ephemeral: true });

    // Check if the error is due to a timeout
    if (
        error.name.includes("InteractionCollectorError") &&
        error.message.includes("Collector received no interactions")
    ) {
        // Simpler name for a standard timeout error
        errorName = "timeout";

        // Inform user about the timeout
        try {
            await respond({
                content: "You did not respond in time (60s).\nPlease try the command again if you wish to create a group.",
                ephemeral: true,
                components: [],
            });
        } catch (replyError) {
            console.error("Failed to send timeout message to user:", replyError);
        }
    } else {
        // Optionally send a message to the user if the error is different
        try {
            await respond({
                content:
                    `An error occurred while processing your request.\nIf this was a mistake, feel free to ping <@${supportUserId}> in <#${supportChannelId}>`,
                ephemeral: true,
                components: [],
            });
        } catch (replyError) {
            console.error("Failed to send error message to user:", replyError);
        }
    }

    // Send the error to the database
    try {
        await errorTable.create({
            error_name: errorName || error.name,
            error_message: error.message,
            user_id: interaction.user.id,
        });
    } catch (dbError) {
        console.error("Failed to log error to database:", dbError);
    }
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
