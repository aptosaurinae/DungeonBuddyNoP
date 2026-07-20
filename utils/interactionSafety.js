// Discord API error codes for interactions that can no longer be acknowledged
const UNKNOWN_INTERACTION = 10062; // token expired (not acknowledged within 3 seconds)
const ALREADY_ACKNOWLEDGED = 40060; // interaction has already been acknowledged

// Acknowledge a component interaction before doing any other work.
// Returns true when the interaction is (or already was) acknowledged,
// false when the token has expired so the caller must return early.
async function safeDeferUpdate(interaction) {
    if (interaction.deferred || interaction.replied) {
        return true;
    }

    try {
        await interaction.deferUpdate();
        return true;
    } catch (err) {
        if (err.code === UNKNOWN_INTERACTION || err.code === ALREADY_ACKNOWLEDGED) {
            console.warn(`Could not acknowledge interaction ${interaction.id} (code ${err.code}): ${err.message}`);
            return false;
        }
        throw err;
    }
}

module.exports = { safeDeferUpdate };
